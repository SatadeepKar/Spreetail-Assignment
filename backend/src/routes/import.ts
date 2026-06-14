import { Router, Request, Response } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  importSessions,
  importAnomalies,
  importStagedRows,
  expenses,
  expenseParticipants,
  settlements,
  users,
  guests,
  groupMemberships,
} from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { parseAndAnalyzeCsv, ParsedExpense } from "../services/importer";
import { calculateSplit } from "../services/splitCalculator";

const router = Router({ mergeParams: true });

// Multer: parse CSV into memory (max 5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

// ─── Step 1: Upload CSV and get anomaly report ────────────────────────────────
// POST /api/groups/:groupId/import/parse
router.post(
  "/parse",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const groupId = parseInt(req.params.groupId);

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const usdToInrRate = parseFloat(req.body.usdToInrRate ?? "84.0");

    // Fetch known member names from DB
    const members = await db
      .select({ name: users.name })
      .from(groupMemberships)
      .innerJoin(users, eq(groupMemberships.userId, users.id))
      .where(eq(groupMemberships.groupId, groupId));

    const memberNames = members.map((m) => m.name);
    // Add common guest names
    const allKnownNames = [...memberNames, "Dev", "Kabir", "Dev's Friend Kabir"];

    const csvContent = req.file.buffer.toString("utf-8");
    const result = parseAndAnalyzeCsv(csvContent, allKnownNames);

    // Create import session
    const [session] = await db
      .insert(importSessions)
      .values({
        groupId,
        importedBy: req.user!.userId,
        filename: req.file.originalname,
        totalRows: result.summary.totalRows,
        anomalyCount: result.summary.anomalyCount,
        status: "pending_review",
        usdToInrRate: usdToInrRate.toFixed(4),
      })
      .returning();

    // Store anomalies
    if (result.anomalies.length > 0) {
      await db.insert(importAnomalies).values(
        result.anomalies.map((a) => ({
          sessionId: session.id,
          rowNumber: a.rowNumber,
          anomalyType: a.type,
          severity: a.severity,
          description: a.description,
          rawData: a.rawData,
          autoFixed: a.autoFixed,
          autoFixDescription: a.autoFixDescription ?? null,
          resolution: a.autoFixed ? "auto_fixed" : a.resolution,
        }))
      );
    }

    // Store staged rows
    if (result.rows.length > 0) {
      await db.insert(importStagedRows).values(
        result.rows.map((r) => ({
          sessionId: session.id,
          rowNumber: r.rowNumber,
          rawData: {
            date: r.date,
            description: r.description,
            paidByName: r.paidByName,
            amount: r.amount,
            currency: r.currency,
            splitType: r.splitType,
            splitWith: r.splitWith,
            notes: r.notes,
          },
          parsedData: {
            date: r.date,
            description: r.description,
            paidByName: r.paidByName,
            amount: r.amount,
            currency: r.currency,
            splitType: r.splitType,
            splitWith: r.splitWith,
            splitDetails: Object.fromEntries(r.splitDetails),
            notes: r.notes,
            isRefund: r.isRefund,
          },
          status: r.status,
        }))
      );
    }

    // ── KEY FIX: fetch anomalies back from DB so they have real PK IDs ──────
    // The in-memory result.anomalies have no IDs; we need the DB-assigned IDs
    // so the frontend can call PATCH /anomalies/:id to approve/reject.
    const savedAnomalies = await db
      .select()
      .from(importAnomalies)
      .where(eq(importAnomalies.sessionId, session.id))
      .orderBy(importAnomalies.rowNumber);

    // Build a lookup of suggestedAction from the in-memory parser result
    const suggestionMap = new Map(
      result.anomalies.map((a) => [`${a.rowNumber}:${a.type}`, a.suggestedAction])
    );

    res.json({
      sessionId: session.id,
      summary: result.summary,
      anomalies: savedAnomalies.map((a) => ({
        id: a.id,                          // ← real DB id, enables PATCH
        rowNumber: a.rowNumber,
        type: a.anomalyType,
        severity: a.severity,
        description: a.description,
        autoFixed: a.autoFixed,
        autoFixDescription: a.autoFixDescription,
        resolution: a.resolution,
        suggestedAction: suggestionMap.get(`${a.rowNumber}:${a.anomalyType}`) ?? null,
      })),
      rows: result.rows.map((r) => ({
        rowNumber: r.rowNumber,
        date: r.date,
        description: r.description,
        paidByName: r.paidByName,
        amount: r.amount,
        currency: r.currency,
        splitType: r.splitType,
        splitWith: r.splitWith,
        status: r.status,
        anomalyTypes: r.anomalies.map((a) => a.type),
      })),
    });
  }
);

// ─── Step 2: Get session + anomalies for review UI ────────────────────────────
// GET /api/groups/:groupId/import/:sessionId
router.get("/:sessionId", requireAuth, async (req: Request, res: Response) => {
  const sessionId = parseInt(req.params.sessionId);

  const [session] = await db
    .select()
    .from(importSessions)
    .where(eq(importSessions.id, sessionId))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "Import session not found" });
    return;
  }

  const anomaliesList = await db
    .select()
    .from(importAnomalies)
    .where(eq(importAnomalies.sessionId, sessionId))
    .orderBy(importAnomalies.rowNumber);

  const stagedRowsList = await db
    .select()
    .from(importStagedRows)
    .where(eq(importStagedRows.sessionId, sessionId))
    .orderBy(importStagedRows.rowNumber);

  res.json({ session, anomalies: anomaliesList, stagedRows: stagedRowsList });
});

// ─── Step 3: Resolve individual anomalies ────────────────────────────────────
// PATCH /api/groups/:groupId/import/:sessionId/anomalies/:anomalyId
router.patch(
  "/:sessionId/anomalies/:anomalyId",
  requireAuth,
  async (req: Request, res: Response) => {
    const anomalyId = parseInt(req.params.anomalyId);
    const schema = z.object({
      resolution: z.enum(["approved", "rejected"]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed" });
      return;
    }

    const [updated] = await db
      .update(importAnomalies)
      .set({
        resolution: parsed.data.resolution,
        resolvedAt: new Date(),
        resolvedBy: req.user!.userId,
      })
      .where(eq(importAnomalies.id, anomalyId))
      .returning();

    res.json({ anomaly: updated });
  }
);

// ─── Step 4: Update a staged row (e.g., fix payer, adjust split) ──────────────
// PATCH /api/groups/:groupId/import/:sessionId/rows/:rowId
router.patch(
  "/:sessionId/rows/:rowId",
  requireAuth,
  async (req: Request, res: Response) => {
    const rowId = parseInt(req.params.rowId);
    const schema = z.object({
      status: z.enum(["approved", "rejected", "pending"]).optional(),
      parsedData: z.record(z.unknown()).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed" });
      return;
    }

    const [updated] = await db
      .update(importStagedRows)
      .set(parsed.data)
      .where(eq(importStagedRows.id, rowId))
      .returning();

    res.json({ row: updated });
  }
);

// ─── Step 5: Commit import — finalize all approved rows ──────────────────────
// POST /api/groups/:groupId/import/:sessionId/commit
router.post(
  "/:sessionId/commit",
  requireAuth,
  async (req: Request, res: Response) => {
    const groupId = parseInt(req.params.groupId);
    const sessionId = parseInt(req.params.sessionId);

    const [session] = await db
      .select()
      .from(importSessions)
      .where(eq(importSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const usdToInr = parseFloat(session.usdToInrRate ?? "84.0");

    // Get staged rows to import (ready or approved)
    const toImport = await db
      .select()
      .from(importStagedRows)
      .where(
        and(
          eq(importStagedRows.sessionId, sessionId),
          // Treat 'pending' as approved for ready rows; only truly rejected rows are skipped
        )
      );

    // Build user name → id map
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
    const userMap = new Map(allUsers.map((u) => [u.name.toLowerCase(), u.id]));

    // Build/find guest map
    const guestCache = new Map<string, number>();

    let importedCount = 0;
    let skippedCount = 0;
    const importedExpenseIds: number[] = [];

    for (const stagedRow of toImport) {
      if (stagedRow.status === "rejected") {
        skippedCount++;
        continue;
      }

      const data = stagedRow.parsedData as any;
      if (!data) { skippedCount++; continue; }

      // Convert currency
      const originalAmount = parseFloat(data.amount) || 0;
      const currency = (data.currency || "INR").toUpperCase();
      const inrAmount =
        currency === "USD" ? originalAmount * usdToInr : originalAmount;

      // Zero amount → skip
      if (inrAmount === 0) { skippedCount++; continue; }

      // Find payer user id
      const paidByName = (data.paidByName || "").toLowerCase();
      const paidById = paidByName ? (userMap.get(paidByName) ?? null) : null;

      // Determine if settlement
      const isSettlement = data.splitType === "settlement";

      if (isSettlement) {
        // Find recipient from splitWith
        const recipientName = (data.splitWith?.[0] || "").toLowerCase();
        const recipientId = userMap.get(recipientName) ?? null;

        if (paidById && recipientId) {
          await db.insert(settlements).values({
            groupId,
            paidBy: paidById,
            paidTo: recipientId,
            amount: Math.abs(inrAmount).toFixed(2),
            settledAt: data.date,
            notes: data.notes || `Imported from CSV row ${stagedRow.rowNumber}`,
          });
          importedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }

      // Build participants
      const splitWith: string[] = data.splitWith || [];
      const splitDetails: Record<string, number> = data.splitDetails || {};
      const splitType: string = data.splitType || "equal";

      const participants = await buildParticipants(
        splitWith,
        splitDetails,
        splitType,
        userMap,
        guestCache,
        groupId
      );

      const splitResult = calculateSplit(inrAmount, splitType as any, participants);
      if (!splitResult.valid) {
        skippedCount++;
        continue;
      }

      // Insert expense
      const [expense] = await db
        .insert(expenses)
        .values({
          groupId,
          description: data.description || "Imported expense",
          paidBy: paidById,
          amount: Math.abs(inrAmount).toFixed(2),
          originalAmount: currency !== "INR" ? originalAmount.toFixed(2) : null,
          originalCurrency: currency,
          exchangeRate: currency === "USD" ? usdToInr.toFixed(4) : "1.0",
          expenseDate: data.date,
          splitType: data.isRefund ? "refund" : splitType,
          status: paidById ? "active" : "pending",
          notes: data.notes || null,
          importRow: stagedRow.rowNumber,
        })
        .returning();

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

      // Update staged row with expense id
      await db
        .update(importStagedRows)
        .set({ expenseId: expense.id, status: "approved" })
        .where(eq(importStagedRows.id, stagedRow.id));

      importedExpenseIds.push(expense.id);
      importedCount++;
    }

    // Mark session complete
    await db
      .update(importSessions)
      .set({
        status: "completed",
        importedRows: importedCount,
        skippedRows: skippedCount,
        completedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));

    res.json({
      success: true,
      importedRows: importedCount,
      skippedRows: skippedCount,
      importedExpenseIds,
    });
  }
);

// ─── Get import report ────────────────────────────────────────────────────────
// GET /api/groups/:groupId/import/:sessionId/report
router.get("/:sessionId/report", requireAuth, async (req: Request, res: Response) => {
  const sessionId = parseInt(req.params.sessionId);

  const [session] = await db
    .select()
    .from(importSessions)
    .where(eq(importSessions.id, sessionId))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const anomaliesList = await db
    .select()
    .from(importAnomalies)
    .where(eq(importAnomalies.sessionId, sessionId))
    .orderBy(importAnomalies.rowNumber);

  const report = {
    importSession: {
      id: session.id,
      filename: session.filename,
      importedAt: session.completedAt,
      totalRows: session.totalRows,
      importedRows: session.importedRows,
      skippedRows: session.skippedRows,
      anomalyCount: session.anomalyCount,
      usdToInrRate: session.usdToInrRate,
      status: session.status,
    },
    anomalies: anomaliesList.map((a) => ({
      row: a.rowNumber,
      type: a.anomalyType,
      severity: a.severity,
      description: a.description,
      autoFixed: a.autoFixed,
      autoFixDescription: a.autoFixDescription,
      resolution: a.resolution,
    })),
    summary: {
      autoFixed: anomaliesList.filter((a) => a.autoFixed).length,
      approvedByUser: anomaliesList.filter((a) => a.resolution === "approved").length,
      rejectedByUser: anomaliesList.filter((a) => a.resolution === "rejected").length,
      pending: anomaliesList.filter((a) => a.resolution === "pending").length,
    },
  };

  res.json({ report });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildParticipants(
  splitWith: string[],
  splitDetails: Record<string, number>,
  splitType: string,
  userMap: Map<string, number>,
  guestCache: Map<string, number>,
  groupId: number
) {
  const participants = [];

  for (const name of splitWith) {
    const lname = name.toLowerCase();
    const userId = userMap.get(lname);

    if (userId) {
      const shareValue = splitDetails[name] ?? splitDetails[Object.keys(splitDetails).find(k => k.toLowerCase() === lname) ?? ""] ?? (splitType === "equal" ? 1 : undefined);
      participants.push({ userId, shareValue });
    } else {
      // Guest
      let guestId = guestCache.get(lname);
      if (!guestId) {
        const existing = await db
          .select()
          .from(guests)
          .where(and(eq(guests.groupId, groupId), eq(guests.name, name)))
          .limit(1);

        if (existing.length > 0) {
          guestId = existing[0].id;
        } else {
          const [newGuest] = await db
            .insert(guests)
            .values({ name, groupId, notes: "Created during CSV import" })
            .returning();
          guestId = newGuest.id;
        }
        guestCache.set(lname, guestId);
      }

      const shareValue = splitDetails[name] ?? (splitType === "equal" ? 1 : undefined);
      participants.push({ guestId, shareValue });
    }
  }

  return participants;
}

export default router;
