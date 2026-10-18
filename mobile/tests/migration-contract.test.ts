import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../drizzle/0000_unknown_karma.sql', import.meta.url), 'utf8');

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
