/**
 * Split Calculator
 *
 * Handles all 4 split types found in the CSV:
 * - equal: divide total equally among all participants
 * - exact: each person has a specified INR amount (validation: sum == total)
 * - percentage: each person has a % share (validation: sum == 100)
 * - ratio: each person has a numeric weight (e.g., 1, 2, 1) — proportional split
 *
 * Also handles:
 * - refund: negative amount, reverse of original split
 */

export type SplitType = "equal" | "exact" | "percentage" | "ratio" | "settlement" | "refund";

export interface Participant {
  userId?: number;
  guestId?: number;
  shareValue?: number; // meaning depends on split type
}

export interface ComputedShare {
  userId?: number;
  guestId?: number;
  shareValue: number;
  calculatedAmount: number; // final INR amount this person owes
}

export interface SplitResult {
  shares: ComputedShare[];
  valid: boolean;
  error?: string;
}

/**
 * Calculate each participant's share given a total amount and split type.
 * Amount should always be in INR (converted before calling this).
 */
export function calculateSplit(
  totalAmount: number,
  splitType: SplitType,
  participants: Participant[]
): SplitResult {
  if (participants.length === 0) {
    return { shares: [], valid: false, error: "No participants provided" };
  }

  // Refunds are negative amounts — treated as equal refund to original participants
  const absAmount = Math.abs(totalAmount);
  const sign = totalAmount < 0 ? -1 : 1;

  switch (splitType) {
    case "equal":
    case "refund": {
      const perPerson = round2(absAmount / participants.length);
      const shares = participants.map((p, i) => ({
        userId: p.userId,
        guestId: p.guestId,
        shareValue: 1,
        calculatedAmount: sign * perPerson,
      }));
      // Distribute rounding remainder to first participant
      const total = perPerson * participants.length;
      const remainder = round2(absAmount - total);
      if (Math.abs(remainder) > 0.001 && shares.length > 0) {
        shares[0].calculatedAmount = round2(shares[0].calculatedAmount + sign * remainder);
      }
      return { shares, valid: true };
    }

    case "exact": {
      const totalShareValue = participants.reduce((s, p) => s + (p.shareValue ?? 0), 0);
      if (Math.abs(totalShareValue - absAmount) > 0.5) {
        return {
          shares: [],
          valid: false,
          error: `Exact amounts sum to ${totalShareValue.toFixed(2)} but total is ${absAmount.toFixed(2)}`,
        };
      }
      const shares = participants.map((p) => ({
        userId: p.userId,
        guestId: p.guestId,
        shareValue: p.shareValue ?? 0,
        calculatedAmount: sign * round2(p.shareValue ?? 0),
      }));
      return { shares, valid: true };
    }

    case "percentage": {
      const totalPct = participants.reduce((s, p) => s + (p.shareValue ?? 0), 0);
      if (Math.abs(totalPct - 100) > 0.5) {
        return {
          shares: [],
          valid: false,
          error: `Percentages sum to ${totalPct.toFixed(1)}% instead of 100%`,
        };
      }
      const shares = participants.map((p) => ({
        userId: p.userId,
        guestId: p.guestId,
        shareValue: p.shareValue ?? 0,
        calculatedAmount: sign * round2((absAmount * (p.shareValue ?? 0)) / 100),
      }));
      return { shares, valid: true };
    }

    case "ratio": {
      const totalRatio = participants.reduce((s, p) => s + (p.shareValue ?? 0), 0);
      if (totalRatio === 0) {
        return { shares: [], valid: false, error: "Ratio values sum to zero" };
      }
      const shares = participants.map((p) => ({
        userId: p.userId,
        guestId: p.guestId,
        shareValue: p.shareValue ?? 0,
        calculatedAmount: sign * round2((absAmount * (p.shareValue ?? 0)) / totalRatio),
      }));
      return { shares, valid: true };
    }

    case "settlement": {
      // Settlement: single participant, full amount
      if (participants.length !== 1) {
        return { shares: [], valid: false, error: "Settlement must have exactly one participant" };
      }
      return {
        shares: [
          {
            userId: participants[0].userId,
            guestId: participants[0].guestId,
            shareValue: totalAmount,
            calculatedAmount: totalAmount,
          },
        ],
        valid: true,
      };
    }

    default:
      return { shares: [], valid: false, error: `Unknown split type: ${splitType}` };
  }
}

/**
 * Parse split_details string from CSV into participant share values.
 * Examples:
 * - "Rohan 700; Priya 400; Meera 400" → exact amounts
 * - "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%" → percentages
 * - "Aisha 1; Rohan 2; Priya 1; Dev 2" → ratio shares
 */
export function parseSplitDetails(
  details: string,
  splitType: string
): Map<string, number> {
  const result = new Map<string, number>();
  if (!details || details.trim() === "") return result;

  const parts = details.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (!part) continue;
    const match = part.match(/^(.+?)\s+([\d.]+)%?$/);
    if (match) {
      const name = normalizeName(match[1].trim());
      const value = parseFloat(match[2]);
      if (!isNaN(value)) {
        result.set(name, value);
      }
    }
  }
  return result;
}

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
