import { Router, Request, Response } from "express";
import { eq, and, or, isNull, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { groups, groupMemberships, users } from "../db/schema";
import { requireAuth } from "../middleware/auth";

const router = Router();

// GET /api/groups — list groups for current user
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const memberships = await db
    .select({
      group: groups,
      joinedAt: groupMemberships.joinedAt,
      leftAt: groupMemberships.leftAt,
    })
    .from(groupMemberships)
    .innerJoin(groups, eq(groupMemberships.groupId, groups.id))
    .where(eq(groupMemberships.userId, userId));

  res.json({ groups: memberships });
});

// POST /api/groups — create a group
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const schema = z.object({
    name: z.string().min(2).max(100),
    description: z.string().optional(),
    memberIds: z.array(z.number()).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { name, description, memberIds = [] } = parsed.data;
  const userId = req.user!.userId;

  const [group] = await db
    .insert(groups)
    .values({ name, description, createdBy: userId })
    .returning();

  // Add creator as member
  const allMemberIds = Array.from(new Set([userId, ...memberIds]));
  const today = new Date().toISOString().split("T")[0];

  await db.insert(groupMemberships).values(
    allMemberIds.map((uid) => ({
      groupId: group.id,
      userId: uid,
      joinedAt: today,
    }))
  );

  res.status(201).json({ group });
});

// GET /api/groups/:id — group detail with members
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.id);
  const userId = req.user!.userId;

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  // Check user is a member
  const membership = await db
    .select()
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.groupId, groupId),
        eq(groupMemberships.userId, userId),
        isNull(groupMemberships.leftAt)
      )
    )
    .limit(1);

  // Allow access even if user is an ex-member (leftAt is set) for viewing
  const isMember = await db
    .select()
    .from(groupMemberships)
    .where(
      and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId))
    )
    .limit(1);

  if (isMember.length === 0) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }

  const members = await db
    .select({
      userId: groupMemberships.userId,
      name: users.name,
      email: users.email,
      joinedAt: groupMemberships.joinedAt,
      leftAt: groupMemberships.leftAt,
    })
    .from(groupMemberships)
    .innerJoin(users, eq(groupMemberships.userId, users.id))
    .where(eq(groupMemberships.groupId, groupId));

  res.json({ group, members });
});

// POST /api/groups/:id/members — add member
router.post("/:id/members", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.id);
  const schema = z.object({
    userId: z.number(),
    joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { userId, joinedAt } = parsed.data;

  // Check existing active membership
  const existing = await db
    .select()
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.groupId, groupId),
        eq(groupMemberships.userId, userId),
        isNull(groupMemberships.leftAt)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "User is already an active member" });
    return;
  }

  const [membership] = await db
    .insert(groupMemberships)
    .values({ groupId, userId, joinedAt })
    .returning();

  res.status(201).json({ membership });
});

// PATCH /api/groups/:id/members/:userId/leave — mark member as left
router.patch("/:id/members/:userId/leave", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.id);
  const userId = parseInt(req.params.userId);
  const schema = z.object({ leftAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  await db
    .update(groupMemberships)
    .set({ leftAt: parsed.data.leftAt })
    .where(
      and(
        eq(groupMemberships.groupId, groupId),
        eq(groupMemberships.userId, userId),
        isNull(groupMemberships.leftAt)
      )
    );

  res.json({ success: true });
});

// GET /api/groups/:id/members — get all members (with timeline)
router.get("/:id/members", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.id);

  const members = await db
    .select({
      userId: groupMemberships.userId,
      name: users.name,
      email: users.email,
      joinedAt: groupMemberships.joinedAt,
      leftAt: groupMemberships.leftAt,
    })
    .from(groupMemberships)
    .innerJoin(users, eq(groupMemberships.userId, users.id))
    .where(eq(groupMemberships.groupId, groupId))
    .orderBy(groupMemberships.joinedAt);

  res.json({ members });
});

export default router;
