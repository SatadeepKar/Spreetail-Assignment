import { Router, Request, Response } from "express";
import { ilike } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { requireAuth } from "../middleware/auth";

const router = Router();

// GET /api/users/search?q=name
router.get("/search", requireAuth, async (req: Request, res: Response) => {
  const q = (req.query.q as string) ?? "";
  if (q.length < 2) {
    res.json({ users: [] });
    return;
  }

  const results = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(ilike(users.name, `%${q}%`))
    .limit(10);

  res.json({ users: results });
});

export default router;
