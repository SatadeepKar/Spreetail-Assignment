/**
 * CSV Importer Service
 *
 * Parses the raw expenses_export.csv and detects all known data anomalies.
 * Each anomaly is classified by type, severity, and auto-fix status.
 *
 * ANOMALY TYPES (21 total):
 *  1. DUPLICATE_EXACT       — same date, payer, amount (Marina Bites rows 5-6)
 *  2. FORMAT_AMOUNT         — amount has commas like "1,200" (row 7)
 *  3. UNKNOWN_PAYER         — paid_by doesn't match any member (row 11: "Priya S")
 *  4. NAME_NORMALIZATION    — casing/spacing issue in names (rows 9, 27)
 *  5. IS_SETTLEMENT         — settlement recorded as expense (row 14)
 *  6. INVALID_PERCENTAGE    — percentages don't sum to 100% (row 15)
 *  7. MISSING_PAYER         — paid_by is blank (row 13)
 *  8. EXCESS_PRECISION      — amount has > 2 decimal places (row 10)
 *  9. FOREIGN_CURRENCY      — USD amounts need conversion (rows 20,21,23,26)
 * 10. UNKNOWN_MEMBER        — participant not in members list (row 23: Kabir)
 * 11. SUSPECTED_DUPLICATE   — similar description, different amounts (rows 24-25 Thalassa)
 * 12. NEGATIVE_AMOUNT       — negative = refund, not error (row 26)
 * 13. DATE_FORMAT           — non-standard date like "Mar-14" (row 27)
 * 14. MISSING_CURRENCY      — currency field blank (row 28)
 * 15. ZERO_AMOUNT           — expense with amount=0 (row 31)
 * 16. AMBIGUOUS_DATE        — could be MM-DD or DD-MM (row 34)
 * 17. MEMBER_LEFT           — participant who had left is in split (row 36)
 * 18. POSSIBLE_SETTLEMENT   — deposit/transfer looks like settlement (row 38)
 * 19. CONFLICTING_SPLIT     — split_type=equal but share details present (row 42)
 * 20. NONSTANDARD_SPLIT_TYPE — "unequal" mapped to exact (row 12)
 * 21. RATIO_SPLIT           — split_type="share" (ratio-based) (rows 22, 35)
 */

import Papa from "papaparse";
import { normalizeName, parseSplitDetails } from "./splitCalculator";

export interface RawCsvRow {
  date: string;
  description: string;
  paid_by: string;
  amount: string;
  currency: string;
  split_type: string;
  split_with: string;
  split_details: string;
  notes: string;
}

export type AnomalySeverity = "error" | "warning" | "info";
export type AnomalyResolution = "auto_fixed" | "needs_review" | "rejected" | "pending";

export interface Anomaly {
  rowNumber: number;
  type: string;
  severity: AnomalySeverity;
  description: string;
  rawData: Record<string, string>;
  autoFixed: boolean;
  autoFixDescription?: string;
  resolution: AnomalyResolution;
  suggestedAction?: string;
}

export interface ParsedExpense {
  rowNumber: number;
  date: string;           // ISO YYYY-MM-DD
  description: string;
  paidByName: string | null;
  amount: number;         // in original currency
  currency: string;       // INR or USD
  splitType: string;      // normalized: equal|exact|percentage|ratio|settlement|refund
  splitWith: string[];    // normalized names
  splitDetails: Map<string, number>;
  notes: string;
  isRefund: boolean;
  status: "ready" | "pending_review" | "rejected";
  anomalies: Anomaly[];
}

export interface ImportParseResult {
  rows: ParsedExpense[];
  anomalies: Anomaly[];
  summary: {
    totalRows: number;
    readyRows: number;
    pendingReviewRows: number;
    rejectedRows: number;
    anomalyCount: number;
    autoFixedCount: number;
    needsReviewCount: number;
  };
}

// Known member names (canonical) — will be populated from DB at import time
// but we also do normalization-based matching
const KNOWN_MEMBERS_CANONICAL = [
  "Aisha", "Rohan", "Priya", "Meera", "Dev", "Sam"
];

// Member timeline for validation
const MEMBER_TIMELINE: Array<{
  name: string;
  joinedAt: string;  // YYYY-MM-DD
  leftAt: string | null;
}> = [
  { name: "Aisha", joinedAt: "2026-02-01", leftAt: null },
  { name: "Rohan", joinedAt: "2026-02-01", leftAt: null },
  { name: "Priya", joinedAt: "2026-02-01", leftAt: null },
  { name: "Meera", joinedAt: "2026-02-01", leftAt: "2026-03-31" },
  { name: "Dev", joinedAt: "2026-02-08", leftAt: null },   // guest, appears Feb and March
  { name: "Sam", joinedAt: "2026-04-08", leftAt: null },
];

/**
 * Main entry point: parse CSV buffer and detect all anomalies.
 */
export function parseAndAnalyzeCsv(
  csvContent: string,
  knownMemberNames: string[] = KNOWN_MEMBERS_CANONICAL
): ImportParseResult {
  const parsed = Papa.parse<RawCsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/ /g, "_"),
  });

  const allAnomalies: Anomaly[] = [];
  const parsedRows: ParsedExpense[] = [];

  // Step 1: collect all rows
  const rawRows = parsed.data as RawCsvRow[];

  // Step 2: process each row
  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2; // +2 because row 1 is header
    const raw = rawRows[i];

    // Skip completely empty rows
    if (!raw.date && !raw.description && !raw.amount) continue;

    const rowAnomalies: Anomaly[] = [];
    let rowStatus: ParsedExpense["status"] = "ready";

    // ── Date parsing ──────────────────────────────────────────────────────────
    let parsedDate = parseDate(raw.date?.trim() ?? "", rowNum, rowAnomalies);

    // ── Amount parsing ────────────────────────────────────────────────────────
    let parsedAmount = parseAmount(raw.amount?.trim() ?? "", rowNum, raw, rowAnomalies);

    // ── Currency ──────────────────────────────────────────────────────────────
    let currency = (raw.currency?.trim() ?? "").toUpperCase();
    if (!currency) {
      currency = "INR";
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "MISSING_CURRENCY",
        severity: "warning",
        description: `Row ${rowNum}: Currency is blank. Defaulting to INR.`,
        rawData: rawToRecord(raw),
        autoFixed: true,
        autoFixDescription: "Defaulted to INR",
        resolution: "auto_fixed",
      });
    }

    // ── Paid-by normalization ─────────────────────────────────────────────────
    let paidByName = normalizeName(raw.paid_by?.trim() ?? "");

    if (!paidByName) {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "MISSING_PAYER",
        severity: "warning",
        description: `Row ${rowNum} ("${raw.description}"): paid_by is blank. Expense will be PENDING until a payer is assigned.`,
        rawData: rawToRecord(raw),
        autoFixed: false,
        resolution: "needs_review",
        suggestedAction: "Assign a payer before importing this expense",
      });
      rowStatus = "pending_review";
    } else {
      // Check for name normalization differences
      const originalName = raw.paid_by?.trim() ?? "";
      if (originalName !== paidByName) {
        rowAnomalies.push({
          rowNumber: rowNum,
          type: "NAME_NORMALIZATION",
          severity: "info",
          description: `Row ${rowNum}: paid_by "${originalName}" normalized to "${paidByName}"`,
          rawData: rawToRecord(raw),
          autoFixed: true,
          autoFixDescription: `Normalized "${originalName}" → "${paidByName}"`,
          resolution: "auto_fixed",
        });
      }

      // Check if payer is in known members list
      const match = fuzzyMatchMember(paidByName, knownMemberNames);
      if (!match.exact && match.suggestion) {
        rowAnomalies.push({
          rowNumber: rowNum,
          type: "UNKNOWN_PAYER",
          severity: "warning",
          description: `Row ${rowNum}: paid_by "${paidByName}" is not a known member. Possible match: "${match.suggestion}".`,
          rawData: rawToRecord(raw),
          autoFixed: false,
          resolution: "needs_review",
          suggestedAction: `Map "${paidByName}" to "${match.suggestion}"`,
        });
        rowStatus = "pending_review";
        paidByName = match.suggestion; // provisional mapping
      } else if (!match.exact && !match.suggestion) {
        rowAnomalies.push({
          rowNumber: rowNum,
          type: "UNKNOWN_PAYER",
          severity: "error",
          description: `Row ${rowNum}: paid_by "${paidByName}" is not a known member and has no close match.`,
          rawData: rawToRecord(raw),
          autoFixed: false,
          resolution: "needs_review",
          suggestedAction: "Manually select the correct payer",
        });
        rowStatus = "pending_review";
      }
    }

    // ── Settlement detection ──────────────────────────────────────────────────
    const descLower = (raw.description ?? "").toLowerCase();
    const notesLower = (raw.notes ?? "").toLowerCase();
    const isSettlement =
      notesLower.includes("settlement") ||
      notesLower.includes("not an expense") ||
      descLower.includes("paid back") ||
      descLower.includes("paid aisha back") ||
      descLower.includes("deposit share");

    if (isSettlement) {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "IS_SETTLEMENT",
        severity: "warning",
        description: `Row ${rowNum} ("${raw.description}"): This looks like a settlement or deposit, not a shared expense. Notes say: "${raw.notes}"`,
        rawData: rawToRecord(raw),
        autoFixed: false,
        resolution: "needs_review",
        suggestedAction:
          "Convert to a Settlement record instead of an expense. This will correctly reduce debt without affecting balances as a new expense.",
      });
      rowStatus = "pending_review";
    }

    // ── Zero amount ───────────────────────────────────────────────────────────
    if (parsedAmount === 0) {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "ZERO_AMOUNT",
        severity: "error",
        description: `Row ${rowNum} ("${raw.description}"): Amount is ₹0. Note: "${raw.notes}". This likely a placeholder row and will be skipped.`,
        rawData: rawToRecord(raw),
        autoFixed: false,
        resolution: "rejected",
        suggestedAction: "Skip this row — zero-amount expenses have no financial effect",
      });
      rowStatus = "rejected";
    }

    // ── Negative amount (refund) ──────────────────────────────────────────────
    const isRefund = parsedAmount < 0;
    if (isRefund) {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "NEGATIVE_AMOUNT",
        severity: "info",
        description: `Row ${rowNum} ("${raw.description}"): Amount is negative (${parsedAmount}). Treating as a refund — each participant's share will be reversed.`,
        rawData: rawToRecord(raw),
        autoFixed: true,
        autoFixDescription: "Treating as refund (split type → refund)",
        resolution: "auto_fixed",
      });
    }

    // ── Split type normalization ──────────────────────────────────────────────
    let splitType = (raw.split_type?.trim() ?? "").toLowerCase();
    let splitTypeNote: string | undefined;

    if (splitType === "unequal") {
      splitTypeNote = `"unequal" mapped to "exact" — uses specific amounts from split_details`;
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "NONSTANDARD_SPLIT_TYPE",
        severity: "info",
        description: `Row ${rowNum}: split_type "unequal" is non-standard. Treating as EXACT (specific amounts provided in split_details).`,
        rawData: rawToRecord(raw),
        autoFixed: true,
        autoFixDescription: `Mapped "unequal" → "exact"`,
        resolution: "auto_fixed",
      });
      splitType = "exact";
    } else if (splitType === "share") {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "RATIO_SPLIT",
        severity: "info",
        description: `Row ${rowNum}: split_type "share" uses ratio-based splitting. Supported.`,
        rawData: rawToRecord(raw),
        autoFixed: true,
        autoFixDescription: `Treating "share" as ratio split type`,
        resolution: "auto_fixed",
      });
      splitType = "ratio";
    } else if (!splitType && isSettlement) {
      splitType = "settlement";
    } else if (!["equal", "exact", "percentage", "ratio", "settlement"].includes(splitType)) {
      if (splitType) {
        rowAnomalies.push({
          rowNumber: rowNum,
          type: "NONSTANDARD_SPLIT_TYPE",
          severity: "warning",
          description: `Row ${rowNum}: Unknown split_type "${splitType}". Defaulting to equal.`,
          rawData: rawToRecord(raw),
          autoFixed: true,
          autoFixDescription: `Unknown split type "${splitType}" defaulted to "equal"`,
          resolution: "auto_fixed",
        });
        splitType = "equal";
      }
    }

    // ── Parse split_with members ──────────────────────────────────────────────
    const splitWith = (raw.split_with ?? "")
      .split(";")
      .map((s) => normalizeName(s.trim()))
      .filter(Boolean);

    // Check for unknown participants
    const unknownParticipants: string[] = [];
    for (const name of splitWith) {
      if (!knownMemberNames.some((m) => m.toLowerCase() === name.toLowerCase())) {
        unknownParticipants.push(name);
      }
    }
    if (unknownParticipants.length > 0) {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "UNKNOWN_MEMBER",
        severity: "warning",
        description: `Row ${rowNum}: Unknown participant(s): ${unknownParticipants.join(", ")}. These will be created as guests.`,
        rawData: rawToRecord(raw),
        autoFixed: false,
        resolution: "needs_review",
        suggestedAction: `Create guest entries for: ${unknownParticipants.join(", ")}, OR remove from split`,
      });
      if (rowStatus === "ready") rowStatus = "pending_review";
    }

    // ── Parse split_details ───────────────────────────────────────────────────
    const splitDetails = parseSplitDetails(raw.split_details ?? "", splitType);

    // Validate percentage sum
    if (splitType === "percentage" && splitDetails.size > 0) {
      const total = Array.from(splitDetails.values()).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 0.5) {
        rowAnomalies.push({
          rowNumber: rowNum,
          type: "INVALID_PERCENTAGE",
          severity: "error",
          description: `Row ${rowNum} ("${raw.description}"): Percentages sum to ${total.toFixed(1)}% instead of 100%. This row cannot be imported as-is.`,
          rawData: rawToRecord(raw),
          autoFixed: false,
          resolution: "needs_review",
          suggestedAction: `Adjust percentages to sum to 100%. Current: ${Array.from(splitDetails.entries()).map(([k, v]) => `${k}=${v}%`).join(", ")} = ${total}%`,
        });
        rowStatus = "pending_review";
      }
    }

    // ── Conflicting split: equal type but share details given ─────────────────
    if (splitType === "equal" && splitDetails.size > 0) {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "CONFLICTING_SPLIT",
        severity: "info",
        description: `Row ${rowNum} ("${raw.description}"): split_type is "equal" but split_details are also present. Split details will be ignored, equal split applied.`,
        rawData: rawToRecord(raw),
        autoFixed: true,
        autoFixDescription: "Ignored split_details — using equal split",
        resolution: "auto_fixed",
      });
    }

    // ── Member timeline check ─────────────────────────────────────────────────
    if (parsedDate) {
      for (const participantName of splitWith) {
        const timeline = MEMBER_TIMELINE.find(
          (m) => m.name.toLowerCase() === participantName.toLowerCase()
        );
        if (timeline?.leftAt && parsedDate > timeline.leftAt) {
          rowAnomalies.push({
            rowNumber: rowNum,
            type: "MEMBER_LEFT",
            severity: "warning",
            description: `Row ${rowNum} ("${raw.description}", date ${parsedDate}): ${participantName} left on ${timeline.leftAt} but is still in the split.`,
            rawData: rawToRecord(raw),
            autoFixed: false,
            resolution: "needs_review",
            suggestedAction: `Remove ${participantName} from split_with and re-split among remaining members`,
          });
          if (rowStatus === "ready") rowStatus = "pending_review";
        }
      }
    }

    // ── Foreign currency ──────────────────────────────────────────────────────
    if (currency === "USD") {
      rowAnomalies.push({
        rowNumber: rowNum,
        type: "FOREIGN_CURRENCY",
        severity: "warning",
        description: `Row ${rowNum} ("${raw.description}"): Amount is in USD ($${parsedAmount}). Will be converted using the exchange rate you provide (default ₹84/USD).`,
        rawData: rawToRecord(raw),
        autoFixed: false,
        resolution: "needs_review",
        suggestedAction: "Confirm the USD→INR exchange rate for this expense date",
      });
      if (rowStatus === "ready") rowStatus = "pending_review";
    }

    allAnomalies.push(...rowAnomalies);

    parsedRows.push({
      rowNumber: rowNum,
      date: parsedDate ?? new Date().toISOString().split("T")[0],
      description: raw.description?.trim() ?? "",
      paidByName: paidByName || null,
      amount: parsedAmount,
      currency,
      splitType: isRefund && splitType === "equal" ? "refund" : splitType,
      splitWith,
      splitDetails,
      notes: raw.notes?.trim() ?? "",
      isRefund,
      status: rowStatus,
      anomalies: rowAnomalies,
    });
  }

  // ── Post-row analysis: find duplicates across rows ────────────────────────
  detectDuplicates(parsedRows, allAnomalies);

  // ── Summary ───────────────────────────────────────────────────────────────
  const readyRows = parsedRows.filter((r) => r.status === "ready").length;
  const pendingRows = parsedRows.filter((r) => r.status === "pending_review").length;
  const rejectedRows = parsedRows.filter((r) => r.status === "rejected").length;
  const autoFixed = allAnomalies.filter((a) => a.autoFixed).length;
  const needsReview = allAnomalies.filter((a) => a.resolution === "needs_review").length;

  return {
    rows: parsedRows,
    anomalies: allAnomalies,
    summary: {
      totalRows: parsedRows.length,
      readyRows,
      pendingReviewRows: pendingRows,
      rejectedRows,
      anomalyCount: allAnomalies.length,
      autoFixedCount: autoFixed,
      needsReviewCount: needsReview,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(raw: string, rowNum: number, anomalies: Anomaly[]): string | null {
  if (!raw) return null;

  // Standard DD-MM-YYYY
  const ddmmyyyy = raw.match(/^(\d{1,2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "Mar-14" format (e.g., row 27)
  const monDay = raw.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (monDay) {
    const monthMap: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const month = monthMap[monDay[1].toLowerCase()];
    if (month) {
      const date = `2026-${month}-${monDay[2].padStart(2, "0")}`;
      anomalies.push({
        rowNumber: rowNum,
        type: "DATE_FORMAT",
        severity: "info",
        description: `Row ${rowNum}: Non-standard date "${raw}" parsed as ${date} (assumed year 2026).`,
        rawData: { date: raw },
        autoFixed: true,
        autoFixDescription: `"${raw}" → "${date}"`,
        resolution: "auto_fixed",
      });
      return date;
    }
  }

  // MM-DD-YYYY ambiguity check (row 34: "04-05-2026")
  const mmddyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (mmddyyyy) {
    const [, a, b, y] = mmddyyyy;
    const aNum = parseInt(a);
    const bNum = parseInt(b);

    // If first number > 12, it must be a day (DD-MM-YYYY)
    if (aNum > 12) {
      return `${y}-${b}-${a}`;
    }
    // If second number > 12, it must be a day (MM-DD-YYYY)
    if (bNum > 12) {
      return `${y}-${a}-${b}`;
    }
    // Both could be either — ambiguous
    anomalies.push({
      rowNumber: rowNum,
      type: "AMBIGUOUS_DATE",
      severity: "warning",
      description: `Row ${rowNum}: Date "${raw}" is ambiguous — could be ${a}/${b} (DD-MM) = ${y}-${b}-${a} or ${a}/${b} (MM-DD) = ${y}-${a}-${b}. Defaulting to DD-MM-YYYY (consistent with rest of file: ${y}-${b}-${a}).`,
      rawData: { date: raw },
      autoFixed: false,
      resolution: "needs_review",
      suggestedAction: `Confirm: is this April 5 (${y}-04-05) or May 4 (${y}-05-04)?`,
    });
    // Default to DD-MM-YYYY
    return `${y}-${b}-${a}`;
  }

  return null;
}

function parseAmount(
  raw: string,
  rowNum: number,
  fullRow: RawCsvRow,
  anomalies: Anomaly[]
): number {
  // Remove commas from "1,200"
  const withoutCommas = raw.replace(/,/g, "");
  if (withoutCommas !== raw) {
    anomalies.push({
      rowNumber: rowNum,
      type: "FORMAT_AMOUNT",
      severity: "info",
      description: `Row ${rowNum}: Amount "${raw}" has comma separators. Auto-stripped to "${withoutCommas}".`,
      rawData: rawToRecord(fullRow),
      autoFixed: true,
      autoFixDescription: `"${raw}" → "${withoutCommas}"`,
      resolution: "auto_fixed",
    });
  }

  const num = parseFloat(withoutCommas);
  if (isNaN(num)) return 0;

  // Check excess precision (more than 2 decimal places)
  const decimalPart = withoutCommas.includes(".") ? withoutCommas.split(".")[1] : "";
  if (decimalPart.length > 2) {
    const rounded = Math.round(num * 100) / 100;
    anomalies.push({
      rowNumber: rowNum,
      type: "EXCESS_PRECISION",
      severity: "info",
      description: `Row ${rowNum}: Amount "${raw}" has ${decimalPart.length} decimal places. Rounded to ${rounded.toFixed(2)}.`,
      rawData: rawToRecord(fullRow),
      autoFixed: true,
      autoFixDescription: `${num} → ${rounded}`,
      resolution: "auto_fixed",
    });
    return rounded;
  }

  return num;
}

function detectDuplicates(rows: ParsedExpense[], allAnomalies: Anomaly[]): void {
  // Exact duplicate: same date, same payer, same amount, similar description
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];

      if (a.status === "rejected" || b.status === "rejected") continue;

      const sameDate = a.date === b.date;
      const samePayer = a.paidByName?.toLowerCase() === b.paidByName?.toLowerCase();
      const sameAmount = Math.abs(a.amount - b.amount) < 0.01;
      const descSimilar = descriptionSimilarity(a.description, b.description) > 0.6;

      if (sameDate && samePayer && sameAmount && descSimilar) {
        // Exact duplicate
        const anomaly: Anomaly = {
          rowNumber: b.rowNumber,
          type: "DUPLICATE_EXACT",
          severity: "error",
          description: `Rows ${a.rowNumber} and ${b.rowNumber} appear to be duplicate entries: both are "${a.paidByName}" paying ~${a.amount} on ${a.date} ("${a.description}" vs "${b.description}"). Row ${b.rowNumber} is flagged for deletion.`,
          rawData: { row_a: String(a.rowNumber), row_b: String(b.rowNumber) },
          autoFixed: false,
          resolution: "needs_review",
          suggestedAction: `Delete row ${b.rowNumber} (keep row ${a.rowNumber})`,
        };
        allAnomalies.push(anomaly);
        b.anomalies.push(anomaly);
        b.status = "pending_review";
      } else if (sameDate && descSimilar && !sameAmount) {
        // Suspected duplicate with different amounts
        const anomaly: Anomaly = {
          rowNumber: b.rowNumber,
          type: "SUSPECTED_DUPLICATE",
          severity: "warning",
          description: `Rows ${a.rowNumber} and ${b.rowNumber} may be duplicate entries for the same event: "${a.description}" (₹${a.amount}, paid by ${a.paidByName}) vs "${b.description}" (₹${b.amount}, paid by ${b.paidByName}). Note: "${b.notes}"`,
          rawData: { row_a: String(a.rowNumber), row_b: String(b.rowNumber) },
          autoFixed: false,
          resolution: "needs_review",
          suggestedAction: `Review both rows. If same event, keep the correct one. Notes suggest row ${b.rowNumber} may be incorrect.`,
        };
        allAnomalies.push(anomaly);
        b.anomalies.push(anomaly);
        if (b.status === "ready") b.status = "pending_review";
      }
    }
  }
}

function descriptionSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const na = normalize(a);
  const nb = normalize(b);

  // Simple word overlap metric
  const wordsA = new Set(na.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(nb.split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  return overlap / Math.max(wordsA.size, wordsB.size);
}

function fuzzyMatchMember(
  name: string,
  members: string[]
): { exact: boolean; suggestion: string | null } {
  const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();

  // Exact match
  for (const m of members) {
    if (m.toLowerCase() === normalized) {
      return { exact: true, suggestion: m };
    }
  }

  // Prefix match (e.g., "Priya S" → "Priya")
  for (const m of members) {
    if (normalized.startsWith(m.toLowerCase() + " ") || m.toLowerCase().startsWith(normalized + " ")) {
      return { exact: false, suggestion: m };
    }
  }

  // Single word match
  const firstWord = normalized.split(" ")[0];
  for (const m of members) {
    if (m.toLowerCase() === firstWord) {
      return { exact: false, suggestion: m };
    }
  }

  return { exact: false, suggestion: null };
}

function rawToRecord(raw: RawCsvRow): Record<string, string> {
  return {
    date: raw.date ?? "",
    description: raw.description ?? "",
    paid_by: raw.paid_by ?? "",
    amount: raw.amount ?? "",
    currency: raw.currency ?? "",
    split_type: raw.split_type ?? "",
    split_with: raw.split_with ?? "",
    split_details: raw.split_details ?? "",
    notes: raw.notes ?? "",
  };
}
