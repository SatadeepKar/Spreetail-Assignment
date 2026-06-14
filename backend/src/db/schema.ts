import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Groups ───────────────────────────────────────────────────────────────────
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Group Memberships (with timeline) ────────────────────────────────────────
export const groupMemberships = pgTable("group_memberships", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .references(() => groups.id, { onDelete: "cascade" })
    .notNull(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  joinedAt: date("joined_at").notNull(),
  leftAt: date("left_at"), // null = still active
});

// ─── Guests (non-registered participants like Kabir) ──────────────────────────
export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  groupId: integer("group_id").references(() => groups.id, { onDelete: "cascade" }),
  notes: text("notes"),
});

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .references(() => groups.id, { onDelete: "cascade" })
    .notNull(),
  description: text("description").notNull(),
  paidBy: integer("paid_by").references(() => users.id), // null if unknown (pending)
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // always in INR
  originalAmount: numeric("original_amount", { precision: 12, scale: 2 }),
  originalCurrency: text("original_currency").default("INR"),
  exchangeRate: numeric("exchange_rate", { precision: 10, scale: 4 }).default("1.0"),
  expenseDate: date("expense_date").notNull(),
  // equal | exact | percentage | ratio | settlement | refund
  splitType: text("split_type").notNull(),
  status: text("status").default("active").notNull(), // active | pending | deleted
  importRow: integer("import_row"), // CSV row number for traceability
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Expense Participants ──────────────────────────────────────────────────────
export const expenseParticipants = pgTable("expense_participants", {
  id: serial("id").primaryKey(),
  expenseId: integer("expense_id")
    .references(() => expenses.id, { onDelete: "cascade" })
    .notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  guestId: integer("guest_id").references(() => guests.id, { onDelete: "cascade" }),
  shareValue: numeric("share_value", { precision: 10, scale: 4 }), // ratio unit / percentage / exact
  calculatedAmount: numeric("calculated_amount", { precision: 12, scale: 2 }).notNull(),
});

// ─── Settlements ──────────────────────────────────────────────────────────────
export const settlements = pgTable("settlements", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .references(() => groups.id, { onDelete: "cascade" })
    .notNull(),
  paidBy: integer("paid_by")
    .references(() => users.id)
    .notNull(),
  paidTo: integer("paid_to")
    .references(() => users.id)
    .notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  settledAt: date("settled_at").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Import Sessions ──────────────────────────────────────────────────────────
export const importSessions = pgTable("import_sessions", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").references(() => groups.id, { onDelete: "cascade" }),
  importedBy: integer("imported_by").references(() => users.id),
  filename: text("filename"),
  totalRows: integer("total_rows").default(0),
  importedRows: integer("imported_rows").default(0),
  skippedRows: integer("skipped_rows").default(0),
  anomalyCount: integer("anomaly_count").default(0),
  status: text("status").default("pending_review"), // pending_review | completed | cancelled
  usdToInrRate: numeric("usd_to_inr_rate", { precision: 8, scale: 4 }).default("84.0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ─── Import Anomalies ─────────────────────────────────────────────────────────
export const importAnomalies = pgTable("import_anomalies", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .references(() => importSessions.id, { onDelete: "cascade" })
    .notNull(),
  rowNumber: integer("row_number"),
  anomalyType: text("anomaly_type").notNull(),
  severity: text("severity").notNull(), // error | warning | info
  description: text("description").notNull(),
  rawData: jsonb("raw_data"),
  autoFixed: boolean("auto_fixed").default(false),
  autoFixDescription: text("auto_fix_description"),
  resolution: text("resolution").default("pending"), // pending | approved | rejected | auto_fixed
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
});

// ─── Import Staged Rows ───────────────────────────────────────────────────────
// Holds parsed rows waiting for user approval before final import
export const importStagedRows = pgTable("import_staged_rows", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .references(() => importSessions.id, { onDelete: "cascade" })
    .notNull(),
  rowNumber: integer("row_number").notNull(),
  rawData: jsonb("raw_data").notNull(), // original CSV row
  parsedData: jsonb("parsed_data"), // cleaned/normalized data
  status: text("status").default("pending"), // pending | approved | rejected
  expenseId: integer("expense_id").references(() => expenses.id), // set after commit
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  groupMemberships: many(groupMemberships),
  expenses: many(expenses),
  settlements: many(settlements),
}));

export const groupsRelations = relations(groups, ({ many, one }) => ({
  memberships: many(groupMemberships),
  expenses: many(expenses),
  settlements: many(settlements),
  createdBy: one(users, { fields: [groups.createdBy], references: [users.id] }),
}));

export const groupMembershipsRelations = relations(groupMemberships, ({ one }) => ({
  group: one(groups, { fields: [groupMemberships.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMemberships.userId], references: [users.id] }),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  group: one(groups, { fields: [expenses.groupId], references: [groups.id] }),
  paidByUser: one(users, { fields: [expenses.paidBy], references: [users.id] }),
  participants: many(expenseParticipants),
}));

export const expenseParticipantsRelations = relations(expenseParticipants, ({ one }) => ({
  expense: one(expenses, {
    fields: [expenseParticipants.expenseId],
    references: [expenses.id],
  }),
  user: one(users, { fields: [expenseParticipants.userId], references: [users.id] }),
  guest: one(guests, { fields: [expenseParticipants.guestId], references: [guests.id] }),
}));

export const settlementsRelations = relations(settlements, ({ one }) => ({
  group: one(groups, { fields: [settlements.groupId], references: [groups.id] }),
  paidByUser: one(users, { fields: [settlements.paidBy], references: [users.id] }),
  paidToUser: one(users, { fields: [settlements.paidTo], references: [users.id] }),
}));

export const importSessionsRelations = relations(importSessions, ({ many, one }) => ({
  anomalies: many(importAnomalies),
  stagedRows: many(importStagedRows),
  group: one(groups, { fields: [importSessions.groupId], references: [groups.id] }),
}));
