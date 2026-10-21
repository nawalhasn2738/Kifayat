import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../drizzle/0000_unknown_karma.sql', import.meta.url), 'utf8');
const applicabilityMigration = readFileSync(new URL('../drizzle/0002_noisy_pretty_boy.sql', import.meta.url), 'utf8');
const applicabilitySnapshot = JSON.parse(readFileSync(new URL('../drizzle/meta/0002_snapshot.json', import.meta.url), 'utf8'));
const transferMigration = readFileSync(new URL('../drizzle/0003_nappy_revanche.sql', import.meta.url), 'utf8');
const transferSnapshot = JSON.parse(readFileSync(new URL('../drizzle/meta/0003_snapshot.json', import.meta.url), 'utf8'));
const migrationJournal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
const migrationBundle = readFileSync(new URL('../drizzle/migrations.js', import.meta.url), 'utf8');

test('migration protects transaction identity and lookup paths', () => {
  assert.match(migration, /transactions_client_id_unique/);
  assert.match(migration, /transactions_user_date_idx/);
  assert.match(migration, /FOREIGN KEY \(`account_id`\).*ON DELETE restrict/);
});

test('migration preserves all Prisma-era local entities', () => {
  for (const table of ['users', 'user_profiles', 'accounts', 'categories', 'transactions', 'savings_goals', 'conversations', 'messages']) {
    assert.match(migration, new RegExp(`CREATE TABLE .${table}.`));
  }
});

test('category applicability migration, snapshot, journal, and Expo bundle agree', () => {
  assert.match(applicabilityMigration, /CREATE TABLE `category_applicability`/);
  assert.match(applicabilityMigration, /PRIMARY KEY\(`category_id`, `transaction_type`\)/);
  assert.match(applicabilityMigration, /ON UPDATE no action ON DELETE cascade/);
  assert.match(applicabilityMigration, /CHECK\(.+transaction_type.+in \('income', 'expense', 'transfer'\)\)/);
  assert.match(applicabilityMigration, /CREATE TEMP TABLE `category_applicability_seed_guard`/);

  const table = applicabilitySnapshot.tables.category_applicability;
  assert.deepEqual(Object.keys(table.columns), ['category_id', 'transaction_type']);
  assert.deepEqual(
    table.compositePrimaryKeys.category_applicability_category_id_transaction_type_pk.columns,
    ['category_id', 'transaction_type'],
  );
  assert.deepEqual(
    table.foreignKeys.category_applicability_category_id_categories_id_fk,
    {
      name: 'category_applicability_category_id_categories_id_fk',
      tableFrom: 'category_applicability', tableTo: 'categories',
      columnsFrom: ['category_id'], columnsTo: ['id'],
      onDelete: 'cascade', onUpdate: 'no action',
    },
  );
  assert.ok(table.checkConstraints.category_applicability_transaction_type_check);
  assert.ok(migrationJournal.entries.some((entry: { tag: string }) => entry.tag === '0002_noisy_pretty_boy'));
  assert.match(migrationBundle, /import m0002 from '.\/0002_noisy_pretty_boy\.sql'/);
  assert.match(migrationBundle, /\bm0002\b/);
});

test('transfer migration, snapshot, journal, and Expo bundle agree', () => {
  assert.match(transferMigration, /CREATE TABLE `transfers`/);
  assert.match(transferMigration, /transfers_distinct_accounts_check/);
  assert.match(transferMigration, /transfers_amount_check/);
  assert.match(transferMigration, /transfers_user_client_unique/);
  assert.match(transferMigration, /ON DELETE restrict/);
  const table = transferSnapshot.tables.transfers;
  assert.ok(table);
  assert.deepEqual(table.indexes.transfers_user_client_unique.columns, ['user_id', 'client_id']);
  assert.equal(table.indexes.transfers_user_client_unique.isUnique, true);
  assert.ok(table.checkConstraints.transfers_distinct_accounts_check);
  assert.ok(table.checkConstraints.transfers_amount_check);
  assert.ok(migrationJournal.entries.some((entry: { tag: string }) => entry.tag === '0003_nappy_revanche'));
  assert.match(migrationBundle, /import m0003 from '.\/0003_nappy_revanche\.sql'/);
  assert.match(migrationBundle, /\bm0003\b/);
});

test('opening balance migration, snapshot, journal, and Expo bundle agree', () => {
  const sql = readFileSync(new URL('../drizzle/0004_big_cargill.sql', import.meta.url), 'utf8');
  const snapshot = JSON.parse(readFileSync(new URL('../drizzle/meta/0004_snapshot.json', import.meta.url), 'utf8'));
  assert.match(sql, /ALTER TABLE `accounts` ADD `opening_balance` integer/);
  assert.match(sql, /CREATE TABLE `opening_balance_audit`/);
  assert.ok(snapshot.tables.accounts.columns.opening_balance);
  assert.ok(snapshot.tables.opening_balance_audit);
  assert.equal(migrationJournal.entries.at(-1).tag, '0004_big_cargill');
  assert.match(migrationBundle, /import m0004 from '.\/0004_big_cargill\.sql'/);
});
