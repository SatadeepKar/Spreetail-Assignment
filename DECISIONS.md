# DECISIONS.md — Engineering Decision Log

Each significant decision made during development is documented here with the options considered and the rationale for the choice made.

---

## D1 — Database: PostgreSQL vs SQLite

**Decision:** PostgreSQL

**Options considered:**
1. SQLite — zero config, single file, easy for local dev
2. PostgreSQL — relational, scalable, proper production DB

**Why PostgreSQL:**
Render's free tier resets SQLite data on each deploy (ephemeral filesystem). The assignment requires a public deployed app URL, which means persistent data across deploys. Render provides a free PostgreSQL managed instance with persistent storage. Additionally, PostgreSQL's `JSONB` column type is ideal for storing anomaly data (raw CSV rows, parsed results), and `NUMERIC(12,2)` precision is better for currency than SQLite's floating-point.

---

## D2 — ORM: Drizzle vs Prisma vs raw SQL

**Decision:** Drizzle ORM

**Options considered:**
1. Raw SQL + pg — maximum control, most transparent
2. Prisma — popular, great DX, but heavier bundle
3. Drizzle — SQL-first, TypeScript-native, lightweight

**Why Drizzle:**
The assignment evaluates understanding of every line submitted. Drizzle's SQL-first API means the queries look like SQL — it's easy to explain exactly what each query does without hidden magic. Prisma's generated Prisma Client abstracts too much. Drizzle also generates migrations as plain SQL files, which makes the schema auditable.

---

## D3 — Split Types: How Many to Support

**Decision:** 4 types (equal, exact, percentage, ratio) + 2 special (settlement, refund)

**Options considered:**
1. Only the 3 standard Splitwise types (equal, exact, percentage)
2. Also add ratio ("share") — found in the CSV
3. Also add settlement and refund as first-class types

**Why this set:**
The CSV explicitly uses `split_type = "share"` for Scooter rentals (row 22) and April rent (row 35). Ignoring it would mean those rows either fail or are misclassified. Similarly, negative amounts (row 26 refund) need special handling — treating them as equal splits with negative amounts preserves the correct financial intent.

Settlement as a type: recording the Rohan→Aisha ₹5,000 transfer (row 14) as an expense would incorrectly add ₹5,000 to the total owed. Recording it as a settlement reduces Rohan's debt to Aisha. This is the financially correct model.

---

## D4 — Negative Amounts: Error or Refund?

**Decision:** Treat as refund (not an error)

**Options considered:**
1. Treat negative amounts as errors — reject the row
2. Treat as refund — reverse the split, credit each participant's balance

**Why refund:**
Row 26 explicitly notes "one slot got cancelled." The context is clear: ₹-30 (actually -$30) should be credited back to the same 4 people who paid for parasailing. Rejecting it would leave ₹-30 USD worth of unaccounted credit. The importer treats negative amounts as `split_type=refund`, which uses the same split logic but with negative `calculatedAmount` values — each participant's balance is credited.

---

## D5 — Debt Minimization: Greedy vs Optimal

**Decision:** Greedy (largest creditor/debtor first)

**Options considered:**
1. No minimization — show every pair's net balance
2. Greedy algorithm — O(n log n), close to optimal
3. LP/graph-based optimal minimization

**Why greedy:**
For groups of 4–8 people, the greedy approach produces results identical to the theoretical optimum in almost all cases. The optimal approach requires solving a min-cost flow problem, which is overkill for this use case and harder to explain in a live session. The greedy approach is easy to reason about: always match the biggest debtor with the biggest creditor.

---

## D6 — CSV Import: Silent Auto-fix vs Require All Approvals

**Decision:** Hybrid — auto-fix safe transformations, flag ambiguous ones

**Options considered:**
1. Fix everything automatically with no user input
2. Require user approval for every single anomaly
3. Auto-fix "safe" transformations (normalization, format errors), surface "risky" ones (duplicates, settlements, member-left violations)

**Why hybrid:**
Option 1 is the "silent guess" the assignment explicitly says is a failing answer. Option 2 would require approving 40+ items for a 43-row file, most of which are obvious (lowercase name → title case). The hybrid approach auto-fixes transformations where the intent is unambiguous (stripping commas from "1,200", normalizing "priya" → "Priya"), and surfaces decisions that have real financial consequence (duplicate detection, settlement classification, member-left violations).

---

## D7 — Unknown Members: Guest vs Reject

**Decision:** Create guest entries; don't reject the row

**Options considered:**
1. Reject any row with an unknown participant
2. Skip the unknown participant (split among remaining known members)
3. Create a guest entity for the unknown participant

**Why guest:**
Row 23 (parasailing) includes Kabir (Dev's friend). Rejecting the row would lose the entire $150 USD parasailing expense. Skipping Kabir would incorrectly calculate everyone else's share (should be $30 each, not $37.50 if split 4 ways instead of 5). Guest entities allow the correct split to be recorded without requiring Kabir to have an account. Guests don't affect user balances (no one can collect money from a guest via the app), but their share is correctly excluded from the other users' calculated amounts.

---

## D8 — Currency Storage: Convert at Import vs Store Both

**Decision:** Store both original currency and INR-converted amount

**Options considered:**
1. Convert to INR at import time, store only INR
2. Store original currency and amount, convert on-the-fly
3. Store both

**Why store both:**
Storing only INR loses traceability — you can't verify the conversion later. Converting on-the-fly requires storing the exchange rate and doing math on every balance query, which adds complexity. Storing both (`original_amount`, `original_currency`, `exchange_rate`, `amount` in INR) gives the best of both worlds: balance calculations use the pre-converted INR amount (fast, no runtime math), while the UI can show users "₹2,520 (= $30 × ₹84)" for transparency.

---

## D9 — Member Timeline: Enforce vs Warn

**Decision:** Warn during import; enforce optionally

**Options considered:**
1. Hard-block: reject any expense where a departed member is in split_with
2. Soft-warn: flag the violation, let user decide
3. Ignore: don't validate against member timeline

**Why soft-warn:**
Hard-blocking creates problems for legitimate edge cases (e.g., an expense incurred on a member's last day that was logged late). The assignment itself gives this as Sam's concern ("Why would March electricity affect my balance?"), which implies the app should be aware of timelines, not that it should make unilateral deletions. The importer flags MEMBER_LEFT violations and suggests removing the departed member, but the user has final say — consistent with Meera's requirement that she must approve anything the app changes.

---

## D10 — Rounding Rule: Round Each Share vs Adjust Last Person

**Decision:** Adjust first participant to absorb rounding remainder

**Options considered:**
1. Round each share independently (may not sum to total)
2. Adjust the last participant
3. Adjust the first participant (payer often first)

**Why first:**
Equal splits of amounts like ₹1199 ÷ 4 = ₹299.75 each. Storing rounded values (₹300 × 4 = ₹1200) introduces a ₹1 discrepancy. The standard approach (used by Splitwise) adjusts one person to absorb the rounding error. We adjust the **first** participant, who is often the payer. Since the payer's balance is net zero on their own expense, this adjustment is less visible than if it were applied to a non-payer.
