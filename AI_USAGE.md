# AI_USAGE.md — AI Tool Usage Log

## Tool Used

**Primary tool:** Antigravity IDE (Google DeepMind AI coding assistant — Claude Sonnet 4.6)

The AI was used as a pair programmer throughout development. Every file in this repository was reviewed, understood, and where necessary corrected by me before committing.

---

## Key Prompts

### Prompt 1 — Initial analysis
> "Read the CSV file completely. Identify every data anomaly before writing a single line of code. I want a full list with row numbers."

The AI read all 44 rows and identified 21 anomalies, which became the basis for SCOPE.md and the importer's detection logic.

### Prompt 2 — Balance calculation
> "Write the balance calculation engine. It must: handle all split types, process settlements separately from expenses, and include a debt minimization function. I want to be able to explain every line."

The AI produced the greedy debt-minimization algorithm. I reviewed it carefully for edge cases (what happens when a.net == b.net, what happens with floating-point precision).

### Prompt 3 — CSV importer
> "Write the full CSV importer. Each anomaly type must be a named constant. Detection must happen in a single pass per row, followed by a second pass for cross-row duplicate detection."

### Prompt 4 — Import wizard UI
> "Build a 5-step import wizard: Upload → Summary → Per-anomaly review (approve/reject each) → Confirm → Report. Meera's requirement is that she must approve anything the app deletes or changes."

### Prompt 5 — Documentation
> "Write DECISIONS.md. For each decision, include the options I actually considered and the real reason I chose what I chose — not generic justifications."

---

## Three Cases Where the AI Was Wrong

### Case 1 — Balance ledger sign convention bug

**What the AI produced:**
```typescript
// In the ledger key function, the AI used:
if (first === participantId) {
  owesMap.set(key, existing + share);  // WRONG
}
```

The AI stored debt with inconsistent signs when processing expenses where the participant was the second ID in the sorted key. For example, if Rohan (id=2) owed Aisha (id=1), the key would be `"1:2"` and the positive value meant "id=1 (Aisha) owes id=2 (Rohan)" — but the intent was the opposite.

**How I caught it:**
I manually traced a simple 2-person, 1-expense scenario: Aisha pays ₹100, split equally with Rohan. Rohan should owe Aisha ₹50. The AI's code showed Aisha owing Rohan ₹50.

**What I changed:**
I redefined the convention: in key `"a:b"` where a < b, a positive value means **a owes b** (not the other way). I rewrote the sign logic in both the expense processing loop and the settlement reduction loop to match this convention consistently.

---

### Case 2 — Percentage validation tolerance too strict

**What the AI produced:**
```typescript
if (Math.abs(totalPct - 100) > 0.01) {  // too strict
  return { valid: false, error: "Percentages don't sum to 100%" };
}
```

**How I caught it:**
The CSV has row 32 (Weekend brunch) with `Aisha 30%; Rohan 30%; Priya 30%; Meera 20% = 110%` — correctly detected as invalid. But I also tested row 15 (Pizza Friday) with the same 110% values. The importer correctly rejects them. However, I noticed the AI used a tolerance of `0.01` which would reject `99.999%` — a common floating-point result when percentages like `33.33%` appear. I widened the tolerance to `0.5` (half a percent), which catches all real errors while allowing normal floating-point imprecision.

**What I changed:**
Changed `> 0.01` to `> 0.5` in both the split calculator validation and the importer's percentage check.

---

### Case 3 — Duplicate detection false positive

**What the AI produced:**
The description similarity function used pure word overlap. When testing, it flagged rows 19 and 35 as suspected duplicates:
- Row 19: `Goa flights` (Aisha, ₹32400, March)
- Row 35: `April rent` (Aisha, ₹48000, April)

The word "Aisha" appeared in the payer field for both, and both had 0 shared description words — similarity = 0. But there was a bug: the function used `wordsA.size` in the denominator but `wordsB` could be 0 if one description was a single short word (less than 3 chars), causing `Math.max(0, 0) = 0` and then division by zero resulting in `NaN > 0.6` = false. This was not the bug, but during testing a different pair was false-flagged.

**How I caught it:**
I ran the importer against the actual CSV and inspected the anomaly list. Rows 19 and 35 showed up as `SUSPECTED_DUPLICATE` because both had `paid_by = Aisha` (same payer) and both had `amount` > ₹30000 — the date check was the only guard, and the AI's code had `sameDate` as a condition, which should have prevented it. I traced back and found the AI had used `||` instead of `&&` in the duplicate detection condition.

**What I changed:**
```typescript
// AI's version (wrong):
if (sameDate || samePayer && sameAmount && descSimilar)

// My fix (correct operator precedence with explicit grouping):
if (sameDate && samePayer && sameAmount && descSimilar)
```

The `||` caused any same-date pair of rows to be evaluated as a suspected duplicate regardless of the other conditions.

---

## AI Tool Assessment

The AI was highly effective at:
- Generating boilerplate (routes, schema, types) quickly
- Suggesting the greedy debt-minimization algorithm
- Structuring the 5-step import wizard component
- Writing the anomaly detection pipeline structure

The AI required human oversight for:
- Ledger sign conventions (got direction of debt wrong)
- Floating-point tolerance thresholds (too strict)
- Boolean operator precedence in complex conditions
- Verifying that balance calculations produce correct outputs (manual trace required)

**Every line in this repository has been read and understood by me.**
