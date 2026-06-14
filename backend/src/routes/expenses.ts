import { Router, Request, Response } from "express";
import { and, eq, ne, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  expenses,
  expenseParticipants,
  users,
  groupMemberships,
  guests,
} from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { calculateSplit, Participant } from "../services/splitCalculator";

const router = Router({ mergeParams: true });

// GET /api/groups/:groupId/expenses
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.groupId);

  const expenseList = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      originalAmount: expenses.originalAmount,
      originalCurrency: expenses.originalCurrency,
      exchangeRate: expenses.exchangeRate,
      expenseDate: expenses.expenseDate,
      splitType: expenses.splitType,
      status: expenses.status,
      notes: expenses.notes,
      importRow: expenses.importRow,
      paidBy: expenses.paidBy,
      paidByName: users.name,
    })
    .from(expenses)
    .leftJoin(users, eq(expenses.paidBy, users.id))
    .where(and(eq(expenses.groupId, groupId), ne(expenses.status, "deleted")))
    .orderBy(expenses.expenseDate);

  res.json({ expenses: expenseList });
});

// GET /api/groups/:groupId/expenses/:id — with full participant breakdown
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const expenseId = parseInt(req.params.id);

  const [expense] = await db
    .select()
    .from(expenses)
    .where(eq(expenses.id, expenseId))
    .limit(1);

  if (!expense) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }

  const participants = await db
    .select({
      id: expenseParticipants.id,
      userId: expenseParticipants.userId,
      guestId: expenseParticipants.guestId,
      shareValue: expenseParticipants.shareValue,
      calculatedAmount: expenseParticipants.calculatedAmount,
      userName: users.name,
      userEmail: users.email,
    })
    .from(expenseParticipants)
    .leftJoin(users, eq(expenseParticipants.userId, users.id))
    .where(eq(expenseParticipants.expenseId, expenseId));

  const [paidByUser] = expense.paidBy
    ? await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, expense.paidBy))
        .limit(1)
    : [null];

  res.json({ expense, participants, paidByUser });
});

// POST /api/groups/:groupId/expenses
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const groupId = parseInt(req.params.groupId);

  const schema = z.object({
    description: z.string().min(1),
    paidBy: z.number().nullable().optional(),
    amount: z.number(),
    originalAmount: z.number().optional(),
    originalCurrency: z.string().default("INR"),
    exchangeRate: z.number().default(1.0),
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    splitType: z.enum(["equal", "exact", "percentage", "ratio", "settlement", "refund"]),
    participants: z.array(
      z.object({
        userId: z.number().optional(),
        guestId: z.number().optional(),
        shareValue: z.number().optional(),
      })
    ),
    notes: z.string().optional(),
    importRow: z.number().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;

  // Calculate splits
  const splitResult = calculateSplit(
    data.amount,
    data.splitType,
    data.participants as Participant[]
  );

  if (!splitResult.valid) {
    res.status(400).json({ error: splitResult.error });
    return;
  }

  // Insert expense
  const [expense] = await db
    .insert(expenses)
    .values({
      groupId,
      description: data.description,
      paidBy: data.paidBy ?? null,
      amount: data.amount.toFixed(2),
      originalAmount: data.originalAmount?.toFixed(2),
      originalCurrency: data.originalCurrency,
      exchangeRate: data.exchangeRate.toFixed(4),
      expenseDate: data.expenseDate,
      splitType: data.splitType,
      status: data.paidBy ? "active" : "pending",
      notes: data.notes,
      importRow: data.importRow,
    })
    .returning();

  // Insert participants
  if (splitResult.shares.length > 0) {
    await db.insert(expenseParticipants).values(
      splitResult.shares.map((s) => ({
        expenseId: expense.id,
        userId: s.userId ?? null,
        guestId: s.guestId ?? null,
        shareValue: s.shareValue.toFixed(4),
        calculatedAmount: s.calculatedAmount.toFixed(2),
      }))
    );
  }

  res.status(201).json({ expense });
});

// PATCH /api/groups/:groupId/expenses/:id — update or soft-delete
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  const expenseId = parseInt(req.params.id);

  const schema = z.object({
    status: z.enum(["active", "pending", "deleted"]).optional(),
    notes: z.string().optional(),
    description: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const [updated] = await db
    .update(expenses)
    .set(parsed.data)
    .where(eq(expenses.id, expenseId))
    .returning();

  res.json({ expense: updated });
});

// DELETE /api/groups/:groupId/expenses/:id — soft delete
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const expenseId = parseInt(req.params.id);

  await db
    .update(expenses)
    .set({ status: "deleted" })
    .where(eq(expenses.id, expenseId));

  res.json({ success: true });
});

export default router;
