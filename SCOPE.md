# SCOPE.md — Anomaly Log & Database Schema

## Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | TEXT | |
| email | TEXT UNIQUE | |
| password_hash | TEXT | bcrypt hash |
| created_at | TIMESTAMP | |

### `groups`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | TEXT | |
| description | TEXT | optional |
| created_by | INTEGER FK → users | |
| created_at | TIMESTAMP | |

### `group_memberships`
Tracks who was in which group and when. Enables member timeline queries.
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| group_id | INTEGER FK | |
| user_id | INTEGER FK | |
| joined_at | DATE | Required |
| left_at | DATE | NULL = still active |

### `guests`
Non-registered participants (e.g., Dev's friend Kabir).
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | TEXT | |
| group_id | INTEGER FK | |
| notes | TEXT | |

### `expenses`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| group_id | INTEGER FK | |
| description | TEXT | |
| paid_by | INTEGER FK → users | NULL = pending |
| amount | NUMERIC(12,2) | Always in INR |
| original_amount | NUMERIC(12,2) | If foreign currency |
| original_currency | TEXT | INR default |
| exchange_rate | NUMERIC(10,4) | 1.0 default |
| expense_date | DATE | |
| split_type | TEXT | equal/exact/percentage/ratio/settlement/refund |
| status | TEXT | active/pending/deleted |
| import_row | INTEGER | CSV row number for tracing |
| notes | TEXT | |
| created_at | TIMESTAMP | |

### `expense_participants`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| expense_id | INTEGER FK | |
| user_id | INTEGER FK | NULL if guest |
| guest_id | INTEGER FK | NULL if user |
| share_value | NUMERIC(10,4) | raw share (ratio/pct/exact) |
| calculated_amount | NUMERIC(12,2) | Final INR share |

### `settlements`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| group_id | INTEGER FK | |
| paid_by | INTEGER FK → users | |
| paid_to | INTEGER FK → users | |
| amount | NUMERIC(12,2) | |
| settled_at | DATE | |
| notes | TEXT | |

### `import_sessions`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| group_id | INTEGER FK | |
| imported_by | INTEGER FK → users | |
| filename | TEXT | |
| total_rows | INTEGER | |
| imported_rows | INTEGER | |
| skipped_rows | INTEGER | |
| anomaly_count | INTEGER | |
| status | TEXT | pending_review/completed/cancelled |
| usd_to_inr_rate | NUMERIC(8,4) | Exchange rate used |
| created_at | TIMESTAMP | |
| completed_at | TIMESTAMP | |

### `import_anomalies`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| session_id | INTEGER FK | |
| row_number | INTEGER | CSV row |
| anomaly_type | TEXT | e.g. DUPLICATE_EXACT |
| severity | TEXT | error/warning/info |
| description | TEXT | Human-readable |
| raw_data | JSONB | Original row data |
| auto_fixed | BOOLEAN | Was it auto-corrected? |
| auto_fix_description | TEXT | What was changed |
| resolution | TEXT | pending/auto_fixed/approved/rejected |
| resolved_at | TIMESTAMP | |
| resolved_by | INTEGER FK → users | |

### `import_staged_rows`
| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| session_id | INTEGER FK | |
| row_number | INTEGER | |
| raw_data | JSONB | Original CSV row |
| parsed_data | JSONB | Cleaned data |
| status | TEXT | pending/approved/rejected |
| expense_id | INTEGER FK | Set after commit |

---

## Anomaly Log — All 21 Data Problems Found in `Expenses Export.csv`

### ANOMALY 1 — Exact Duplicate Entry
- **Rows:** 5 and 6
- **Problem:** `08-02-2026, Dev, Dinner at Marina Bites / dinner - marina bites, ₹3200` — same date, payer, amount, split; only description casing differs
- **Detection:** `DUPLICATE_EXACT` — same date + payer + amount + description similarity > 60%
- **Policy:** Flag row 6 as duplicate. Surface to user for approval. **User must approve deletion.** Row 5 is kept.

### ANOMALY 2 — Comma in Amount
- **Row:** 7
- **Problem:** Amount is `"1,200"` — CSV comma inside quotes used as thousands separator
- **Detection:** `FORMAT_AMOUNT` — amount contains non-numeric characters after unquoting
- **Policy:** **Auto-fix:** Strip commas, parse as 1200. Log the transformation.

### ANOMALY 3 — Unknown Payer Name
- **Row:** 11
- **Problem:** `paid_by = "Priya S"` — no member named "Priya S"
- **Detection:** `UNKNOWN_PAYER` — prefix match suggests "Priya"
- **Policy:** Flag with suggestion "Priya". User approves mapping before import.

### ANOMALY 4 — Name Casing/Spacing Issues
- **Rows:** 9 (`priya`), 27 (`rohan ` with trailing space)
- **Problem:** Names not consistently title-cased or have trailing spaces
- **Detection:** `NAME_NORMALIZATION` — after trim+title-case, name differs from raw
- **Policy:** **Auto-fix:** Normalize all names via trim + title-case. Log each change.

### ANOMALY 5 — Settlement Logged as Expense
- **Row:** 14
- **Problem:** "Rohan paid Aisha back ₹5000" — notes say "this is a settlement not an expense??"
- **Detection:** `IS_SETTLEMENT` — note contains "settlement", description contains "paid back"
- **Policy:** Flag as settlement. User approves converting to a Settlement record. Excluded from expense balance calculation.

### ANOMALY 6 — Percentages Sum to 110%
- **Row:** 15
- **Problem:** Pizza Friday split: `Aisha 30% + Rohan 30% + Priya 30% + Meera 20% = 110%`
- **Detection:** `INVALID_PERCENTAGE` — sum of percentages != 100 (tolerance ±0.5)
- **Policy:** Flag as error. Row is held in `pending_review`. User must correct the percentages or reject the row.

### ANOMALY 7 — Missing Payer
- **Row:** 13
- **Problem:** `paid_by` is blank. Note: "can't remember who paid"
- **Detection:** `MISSING_PAYER` — empty paid_by field
- **Policy:** Import as `status=pending`. Expense appears in the app with "Unknown payer" until user assigns one. Does NOT affect balance calculations until resolved.

### ANOMALY 8 — Excess Decimal Precision
- **Row:** 10
- **Problem:** Amount is `899.995` — three decimal places
- **Detection:** `EXCESS_PRECISION` — decimal part has > 2 digits
- **Policy:** **Auto-fix:** Round to 2 decimal places → ₹900.00. Log rounding.

### ANOMALY 9 — Foreign Currency (USD)
- **Rows:** 20, 21, 23, 26
- **Problem:** Goa trip expenses in USD. The original sheet uses raw USD values as if they were INR — Priya's complaint.
- **Detection:** `FOREIGN_CURRENCY` — currency field = "USD"
- **Policy:** Flag all USD rows. During import, user enters exchange rate (default ₹84/$). Store both original USD amount and converted INR amount in the database. All balance calculations use INR.

### ANOMALY 10 — Unknown Participant (Guest)
- **Row:** 23
- **Problem:** `split_with` includes "Dev's friend Kabir" — not a registered user
- **Detection:** `UNKNOWN_MEMBER` — participant not found in member list
- **Policy:** Create a guest entry "Kabir" in the `guests` table. Kabir's share is calculated but does NOT affect any user's balance. Flagged for user review.

### ANOMALY 11 — Suspected Duplicate (Different Amounts)
- **Rows:** 24 and 25
- **Problem:** "Dinner at Thalassa" (Aisha, ₹2400) and "Thalassa dinner" (Rohan, ₹2450) on same date. Note on row 25: "Aisha also logged this I think hers is wrong"
- **Detection:** `SUSPECTED_DUPLICATE` — same date, similar description, different amounts/payers
- **Policy:** Flag both. Surface to user with note. User decides which to keep. Both are shown in the review step; user rejects one.

### ANOMALY 12 — Negative Amount (Refund)
- **Row:** 26
- **Problem:** `Parasailing refund, Dev, -30, USD` — negative amount
- **Detection:** `NEGATIVE_AMOUNT` — amount < 0
- **Policy:** Treat as a **refund** (not an error). Split type set to "refund". Each participant's calculated share is negative → credits their balance. No user approval needed; logged as info.

### ANOMALY 13 — Non-Standard Date Format
- **Row:** 27
- **Problem:** Date is `Mar-14` — not DD-MM-YYYY
- **Detection:** `DATE_FORMAT` — date matches `Mon-DD` pattern instead of standard
- **Policy:** **Auto-fix:** Parse as March 14, 2026. Log the transformation.

### ANOMALY 14 — Missing Currency
- **Row:** 28
- **Problem:** `Groceries DMart, 2105, currency=<blank>`
- **Detection:** `MISSING_CURRENCY` — currency field is empty
- **Policy:** **Auto-fix:** Default to INR (consistent with all other domestic expenses). Log assumption.

### ANOMALY 15 — Zero Amount Expense
- **Row:** 31
- **Problem:** `Dinner order Swiggy, 0, INR` — amount is zero. Note: "counted twice earlier - fixing later"
- **Detection:** `ZERO_AMOUNT` — amount == 0 after parsing
- **Policy:** **Reject.** Zero-amount expenses have no financial effect and clutter the ledger. The note indicates it's a placeholder. Logged with explanation.

### ANOMALY 16 — Ambiguous Date
- **Row:** 34
- **Problem:** Date `04-05-2026` — could be April 5 (DD-MM) or May 4 (MM-DD). Note: "is this April 5 or May 4? format is a mess"
- **Detection:** `AMBIGUOUS_DATE` — both first and second numeric parts ≤ 12
- **Policy:** Flag for user confirmation. Default to DD-MM-YYYY (April 5, 2026) consistent with the rest of the file. User must confirm in the review step.

### ANOMALY 17 — Member Left But Still in Split
- **Row:** 36
- **Problem:** April 2 expense `Groceries BigBasket` includes Meera in `split_with`. Meera left March 31. Note: "oops Meera still in the group list"
- **Detection:** `MEMBER_LEFT` — expense date > member's leftAt date in the timeline
- **Policy:** Flag. Suggest removing Meera and re-splitting 3 ways (Aisha, Rohan, Priya). User approves the change in the review step.

### ANOMALY 18 — Deposit/Transfer Looks Like Settlement
- **Row:** 38
- **Problem:** `Sam deposit share, Sam, ₹15000, split_with=Aisha` — Sam paying Aisha his security deposit
- **Detection:** `POSSIBLE_SETTLEMENT` — description contains "deposit", single recipient in split_with, not a shared group expense
- **Policy:** Flag as possible settlement. User chooses: record as settlement (Sam paid Aisha ₹15,000 → reduces Aisha's balance) or leave as-is as a regular expense.

### ANOMALY 19 — Conflicting Split Type and Details
- **Row:** 42
- **Problem:** `split_type = "equal"` but `split_details` are provided (`Aisha 1; Rohan 1; Priya 1; Sam 1`)
- **Detection:** `CONFLICTING_SPLIT` — equal type but share details also present
- **Policy:** **Auto-fix:** Ignore the share details, apply equal split (which produces the same result here anyway). Log the conflict.

### ANOMALY 20 — Non-Standard Split Type "unequal"
- **Row:** 12
- **Problem:** `split_type = "unequal"` — not a recognized type
- **Detection:** `NONSTANDARD_SPLIT_TYPE` — split_type not in {equal, exact, percentage, ratio, share, settlement}
- **Policy:** **Auto-fix:** Map "unequal" → "exact" (specific amounts are given in split_details: Rohan 700, Priya 400, Meera 400). Log the mapping.

### ANOMALY 21 — Ratio/Share Split Type
- **Rows:** 22, 35
- **Problem:** `split_type = "share"` — not in the standard set but clearly valid (ratio-based split)
- **Detection:** `RATIO_SPLIT` — split_type = "share"
- **Policy:** **Auto-fix:** Map "share" → "ratio". Fully supported as the 4th split type. Log the mapping.

---

## Split Types Supported

| Type | Description | Source |
|---|---|---|
| `equal` | Total divided equally | Most expenses |
| `exact` | Each person's exact INR amount | Birthday cake (row 12), mapped from "unequal" |
| `percentage` | Each person's % share | Pizza Friday (row 15), Weekend brunch (row 32) |
| `ratio` | Weighted proportional split | Scooter rentals (row 22), April rent (row 35); mapped from "share" |
| `settlement` | Direct payment, not a shared expense | Mapped from settlements detected |
| `refund` | Negative amount, credits participants | Parasailing refund (row 26) |

## Member Timeline

| Member | Joined | Left | Notes |
|---|---|---|---|
| Aisha | Feb 1, 2026 | — | Took Meera's room in April |
| Rohan | Feb 1, 2026 | — | |
| Priya | Feb 1, 2026 | — | |
| Meera | Feb 1, 2026 | Mar 31, 2026 | Moved out |
| Dev | Feb 8, 2026 | — | Guest, not a flatmate |
| Kabir | — | — | One-time guest (Goa parasailing) |
| Sam | Apr 8, 2026 | — | Joined mid-April |
