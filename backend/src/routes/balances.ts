import { Router, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { users, groupMemberships } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { calculateGroupBalances, getUserExpenseBreakdown } from "../services/balance";

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/balances
// Returns: per-person net balance + simplified who-pays-whom transactions
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.groupId);
  const { balances, transactions } = await calculateGroupBalances(groupId);
  res.json({ balances, transactions });
});

// GET /api/groups/:groupId/balances/:userId/breakdown
// Returns: list of expenses that make up this user's balance (Rohan's requirement)
router.get("/:userId/breakdown", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.groupId);
  const targetUserId = parseInt(req.params.userId);
  const breakdown = await getUserExpenseBreakdown(groupId, targetUserId);
  res.json({ breakdown });
});

export default router;
