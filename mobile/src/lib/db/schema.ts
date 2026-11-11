import { relations, sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  openingBalance: integer('opening_balance'),
  archivedAt: text('archived_at'),
}, (table) => [
  uniqueIndex('accounts_user_name_unique').on(table.userId, table.name),
  uniqueIndex('accounts_user_name_nocase_unique').on(table.userId, sql`lower(${table.name})`),
]);

export const openingBalanceAudit = sqliteTable('opening_balance_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  previousOpeningBalance: integer('previous_opening_balance'),
  newOpeningBalance: integer('new_opening_balance').notNull(),
  changeKind: text('change_kind', { enum: ['confirmation', 'correction'] }).notNull(),
  changedAt: text('changed_at').notNull(),
}, (table) => [
  index('opening_balance_audit_account_changed_idx').on(table.accountId, table.changedAt),
  check('opening_balance_audit_kind_check', sql`${table.changeKind} in ('confirmation', 'correction')`),
]);

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  parent: text('parent'),
  isEssential: integer('is_essential', { mode: 'boolean' }).notNull().default(false),
  isHighRisk: integer('is_high_risk', { mode: 'boolean' }).notNull().default(false),
});

export const categoryApplicability = sqliteTable('category_applicability', {
  categoryId: integer('category_id').notNull().references(() => categories.id, {
    onUpdate: 'no action',
    onDelete: 'cascade',
  }),
  transactionType: text('transaction_type', { enum: ['income', 'expense', 'transfer'] }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.categoryId, table.transactionType] }),
  check('category_applicability_transaction_type_check', sql`${table.transactionType} in ('income', 'expense', 'transfer')`),
]);

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

export const transfers = sqliteTable('transfers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: text('client_id').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceAccountId: integer('source_account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  destinationAccountId: integer('destination_account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  amount: integer('amount').notNull(),
  date: text('date').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex('transfers_user_client_unique').on(table.userId, table.clientId),
  index('transfers_user_date_idx').on(table.userId, table.date),
  index('transfers_source_account_idx').on(table.sourceAccountId),
  index('transfers_destination_account_idx').on(table.destinationAccountId),
  check('transfers_distinct_accounts_check', sql`${table.sourceAccountId} <> ${table.destinationAccountId}`),
  check('transfers_amount_check', sql`${table.amount} > 0 and ${table.amount} <= 2147483647`),
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
export const categoryRelations = relations(categories, ({ many }) => ({
  applicability: many(categoryApplicability),
}));
export const categoryApplicabilityRelations = relations(categoryApplicability, ({ one }) => ({
  category: one(categories, { fields: [categoryApplicability.categoryId], references: [categories.id] }),
}));

export type AccountRow = typeof accounts.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type CategoryApplicabilityRow = typeof categoryApplicability.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type TransferRow = typeof transfers.$inferSelect;
