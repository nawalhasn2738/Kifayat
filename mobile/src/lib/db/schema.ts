import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userProfiles = sqliteTable('user_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  monthlyIncome: integer('monthly_income').notNull(),
  emergencyFundTarget: integer('emergency_fund_target').notNull(),
  riskTolerance: text('risk_tolerance', { enum: ['low', 'medium', 'high'] }).notNull().default('medium'),
  dependents: integer('dependents').notNull().default(0),
  notesAboutSelf: text('notes_about_self'),
  financialHistoryStartedAt: text('financial_history_started_at'),
});

export const financialHistoryStartAudit = sqliteTable('financial_history_start_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  previousStartedAt: text('previous_started_at'),
  newStartedAt: text('new_started_at').notNull(),
  changeKind: text('change_kind', { enum: ['confirmation', 'correction'] }).notNull(),
  changedAt: text('changed_at').notNull(),
}, (table) => [
  index('financial_history_start_audit_user_changed_idx').on(table.userId, table.changedAt),
]);

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['checking', 'savings', 'cash'] }).notNull(),
  balance: integer('balance').notNull().default(0),
}, (table) => [uniqueIndex('accounts_user_name_unique').on(table.userId, table.name)]);

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  parent: text('parent'),
  isEssential: integer('is_essential', { mode: 'boolean' }).notNull().default(false),
  isHighRisk: integer('is_high_risk', { mode: 'boolean' }).notNull().default(false),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: text('client_id').notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
  date: text('date').notNull(),
  amount: integer('amount').notNull(),
  type: text('type', { enum: ['income', 'expense', 'transfer'] }).notNull(),
  merchant: text('merchant'),
  description: text('description'),
  isAnomaly: integer('is_anomaly', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('transactions_user_date_idx').on(table.userId, table.date),
  index('transactions_user_category_idx').on(table.userId, table.categoryId),
  index('transactions_account_idx').on(table.accountId),
]);

export const savingsGoals = sqliteTable('savings_goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  targetAmount: integer('target_amount').notNull(),
  targetDate: text('target_date').notNull(),
  currentAmount: integer('current_amount').notNull().default(0),
}, (table) => [uniqueIndex('goals_user_name_unique').on(table.userId, table.name)]);

export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt: text('started_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: integer('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
  content: text('content').notNull(),
  toolCalls: text('tool_calls'),
  toolResults: text('tool_results'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index('messages_conversation_created_idx').on(table.conversationId, table.createdAt)]);

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles), accounts: many(accounts), transactions: many(transactions),
  goals: many(savingsGoals), conversations: many(conversations),
}));
export const transactionRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
}));

export type AccountRow = typeof accounts.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
