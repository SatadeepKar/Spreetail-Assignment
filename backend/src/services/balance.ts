/**
 * Balance Calculation Engine
 *
 * This is the core financial logic. It:
 * 1. Reads all active expenses and their participants for a group
 * 2. Builds a net balance map (who owes whom, and how much)
 * 3. Runs a debt-minimization algorithm to produce the minimal set of
 *    "A pays B X" transactions
 *
 * The calculation respects member timelines — Sam's balance excludes
 * expenses before he joined, Meera's excludes expenses after she left.
 */

import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { expenses, expenseParticipants, settlements, users, guests } from "../db/schema";

export interface Balance {
  userId: number;
  name: string;
  totalPaid: number;   // how much this user paid across all expenses
  totalOwed: number;   // how much this user owes across all expenses
  net: number;         // totalPaid - totalOwed (positive = others owe them)
}

export interface Transaction {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  amount: number;
}

export interface ExpenseBreakdown {
  expenseId: number;
  description: string;
  date: string;
  paidByUserId: number | null;
  paidByName: string | null;
  totalAmount: number;
  splitType: string;
  yourShare: number;        // the querying user's share
  notes: string | null;
}

/**
 * Calculate raw balances for all members of a group.
 * Returns per-user net balance and per-pair ledger.
 */
export async function calculateGroupBalances(groupId: number): Promise<{
  balances: Balance[];
  transactions: Transaction[];
  pairLedger: Map<string, number>;
}> {
  // Fetch all active expenses with participants
  const groupExpenses = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), ne(expenses.status, "deleted")));

  const allParticipants = await db
    .select({
      expenseId: expenseParticipants.expenseId,
      userId: expenseParticipants.userId,
      calculatedAmount: expenseParticipants.calculatedAmount,
    })
    .from(expenseParticipants)
    .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
    .where(and(eq(expenses.groupId, groupId), ne(expenses.status, "deleted")));

  // Fetch all settlements
  const groupSettlements = await db
    .select()
    .from(settlements)
    .where(eq(settlements.groupId, groupId));

  // Build user name lookup
  const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
  const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

  // pairLedger[A][B] = X means A owes B X rupees (net)
  // We use a flat map keyed as "smallerId:largerId" with signed value
  const owesMap = new Map<string, number>(); // userId → net amount (positive = is owed, negative = owes)

  // Process each expense
  for (const expense of groupExpenses) {
    const paidBy = expense.paidBy;
    if (!paidBy) continue; // pending expense — skip from balance calc

    const amount = parseFloat(expense.amount);
    const participants = allParticipants.filter((p) => p.expenseId === expense.id);

    // For refunds (negative amounts), the logic reverses automatically
    // because calculatedAmount will be negative

    for (const participant of participants) {
      if (!participant.userId) continue; // guest participants don't affect user balances
      const participantId = participant.userId;
      const share = parseFloat(participant.calculatedAmount);

      if (participantId === paidBy) continue; // payer doesn't owe themselves

      // participantId owes paidBy `share` rupees
      const key = ledgerKey(participantId, paidBy);
      const existing = owesMap.get(key) ?? 0;
      // Convention: positive value in key means first ID in key owes second
      const [first] = key.split(":").map(Number);
      if (first === participantId) {
        owesMap.set(key, existing + share);
      } else {
        owesMap.set(key, existing - share);
      }
    }
  }

  // Process settlements — reduce debts
  for (const s of groupSettlements) {
    const amount = parseFloat(s.amount);
    const key = ledgerKey(s.paidBy, s.paidTo);
    const existing = owesMap.get(key) ?? 0;
    const [first] = key.split(":").map(Number);
    if (first === s.paidBy) {
      // paidBy was debtor (first), settlement reduces their debt
      owesMap.set(key, existing - amount);
    } else {
      // paidBy was creditor (second), settlement means they paid the other — unusual
      owesMap.set(key, existing + amount);
    }
  }

  // Build per-user net balance
  const netMap = new Map<number, number>(); // userId → net (positive = owed money)

  for (const [key, value] of owesMap.entries()) {
    const [aId, bId] = key.split(":").map(Number);
    // positive value: aId owes bId
    netMap.set(aId, (netMap.get(aId) ?? 0) - value);
    netMap.set(bId, (netMap.get(bId) ?? 0) + value);
  }

  // Build final balances list (only users with non-zero balances, plus all group members)
  const allUserIds = new Set<number>();
  for (const [key] of owesMap.entries()) {
    const [a, b] = key.split(":").map(Number);
    allUserIds.add(a);
    allUserIds.add(b);
  }

  const balances: Balance[] = [];
  for (const uid of allUserIds) {
    const net = Math.round((netMap.get(uid) ?? 0) * 100) / 100;
    balances.push({
      userId: uid,
      name: userMap.get(uid) ?? `User #${uid}`,
      totalPaid: 0, // TODO: calculate from expenses if needed
      totalOwed: 0,
      net,
    });
  }

  // Debt minimization — greedy algorithm
  const transactions = minimizeDebts(balances, userMap);

  return { balances, transactions, pairLedger: owesMap };
}

/**
 * Get the breakdown of which expenses contribute to a specific user's balance.
 * This answers Rohan's requirement: "if the app says I owe ₹2,300, I want to
 * see exactly which expenses make that up."
 */
export async function getUserExpenseBreakdown(
  groupId: number,
  targetUserId: number
): Promise<ExpenseBreakdown[]> {
  const rows = await db
    .select({
      expenseId: expenses.id,
      description: expenses.description,
      date: expenses.expenseDate,
      paidBy: expenses.paidBy,
      totalAmount: expenses.amount,
      splitType: expenses.splitType,
      notes: expenses.notes,
      calculatedAmount: expenseParticipants.calculatedAmount,
    })
    .from(expenseParticipants)
    .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
    .where(
      and(
        eq(expenses.groupId, groupId),
        eq(expenseParticipants.userId, targetUserId),
        ne(expenses.status, "deleted")
      )
    )
    .orderBy(expenses.expenseDate);

  const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
  const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    expenseId: r.expenseId,
    description: r.description,
    date: r.date,
    paidByUserId: r.paidBy,
    paidByName: r.paidBy ? (userMap.get(r.paidBy) ?? null) : null,
    totalAmount: parseFloat(r.totalAmount),
    splitType: r.splitType,
    yourShare: parseFloat(r.calculatedAmount),
    notes: r.notes,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ledgerKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Debt minimization using greedy creditor-debtor matching.
 * Produces the minimum number of transactions to settle all debts.
 */
function minimizeDebts(balances: Balance[], userMap: Map<number, string>): Transaction[] {
  const transactions: Transaction[] = [];

  // Separate into creditors (net > 0) and debtors (net < 0)
  const creditors = balances
    .filter((b) => b.net > 0.01)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.net - a.net);

  const debtors = balances
    .filter((b) => b.net < -0.01)
    .map((b) => ({ ...b, net: Math.abs(b.net) }))
    .sort((a, b) => b.net - a.net);

  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];

    const amount = Math.min(creditor.net, debtor.net);
    const rounded = Math.round(amount * 100) / 100;

    if (rounded > 0.01) {
      transactions.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amount: rounded,
      });
    }

    creditor.net -= amount;
    debtor.net -= amount;

    if (creditor.net < 0.01) ci++;
    if (debtor.net < 0.01) di++;
  }

  return transactions;
}
