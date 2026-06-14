import { Router, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { settlements, users } from "../db/schema";
import { requireAuth } from "../middleware/auth";

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/settlements
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.groupId);

  const list = await db
    .select({
      id: settlements.id,
      paidBy: settlements.paidBy,
      paidTo: settlements.paidTo,
      amount: settlements.amount,
      settledAt: settlements.settledAt,
      notes: settlements.notes,
      paidByName: users.name,
    })
    .from(settlements)
    .innerJoin(users, eq(settlements.paidBy, users.id))
    .where(eq(settlements.groupId, groupId))
    .orderBy(settlements.settledAt);

  res.json({ settlements: list });
});

// POST /api/groups/:groupId/settlements
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.groupId);

  const schema = z.object({
    paidBy: z.number(),
    paidTo: z.number(),
    amount: z.number().positive(),
    settledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const [settlement] = await db
    .insert(settlements)
    .values({
      groupId,
      ...parsed.data,
      amount: parsed.data.amount.toFixed(2),
    })
    .returning();

  res.status(201).json({ settlement });
});

// DELETE /api/groups/:groupId/settlements/:id
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const settlementId = parseInt(req.params.id);

  await db.delete(settlements).where(eq(settlements.id, settlementId));
  res.json({ success: true });
});

export default router;
