import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(new URL('../drizzle/0000_unknown_karma.sql', import.meta.url), 'utf8');
const statementBreakpoint = '--> statement-breakpoint';

/** @param {(database: DatabaseSync) => void} run */
function withInMemoryDatabase(run) {
  const database = new DatabaseSync(':memory:');

  try {
    run(database);
  } finally {
    database.close();
  }
}

/** @param {DatabaseSync} database */
function applyMigration(database) {
  for (const statement of migration.split(statementBreakpoint)) {
    if (statement.trim()) database.exec(statement);
  }
}

test('database-contract smoke: applies the generated migration and creates expected schema objects', () => {
  withInMemoryDatabase((database) => {
    applyMigration(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    const indexes = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.deepEqual(tables, [
      'accounts',
      'categories',
      'conversations',
      'messages',
      'savings_goals',
      'transactions',
      'user_profiles',
      'users',
    ]);
    assert.deepEqual(indexes, [
      'accounts_user_name_unique',
      'categories_name_unique',
      'goals_user_name_unique',
      'messages_conversation_created_idx',
      'transactions_account_idx',
      'transactions_client_id_unique',
      'transactions_user_category_idx',
      'transactions_user_date_idx',
      'user_profiles_user_id_unique',
      'users_email_unique',
    ]);
  });
});

test('database-contract smoke: enables and enforces an existing foreign key', () => {
  withInMemoryDatabase((database) => {
    database.exec('PRAGMA foreign_keys = ON');
    applyMigration(database);

    const foreignKeysEnabled = database.prepare('PRAGMA foreign_keys').get();
    assert.equal(foreignKeysEnabled?.foreign_keys, 1);
    assert.throws(
      () => database.prepare("INSERT INTO accounts (user_id, name, type) VALUES (?, 'Synthetic Cash', 'cash')").run(999_999),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get()?.count, 0);
  });
});

test('database-contract smoke: rolls back a successful write after a later failure', () => {
  withInMemoryDatabase((database) => {
    applyMigration(database);
    database.exec('BEGIN');

    let failure;
    try {
      const insert = database.prepare('INSERT INTO users (email, name) VALUES (?, ?)');
      insert.run('synthetic@example.test', 'Synthetic User');
      insert.run('synthetic@example.test', 'Duplicate Synthetic User');
    } catch (error) {
      failure = error;
    } finally {
      database.exec('ROLLBACK');
    }

    assert.ok(failure instanceof Error);
    assert.match(failure.message, /UNIQUE constraint failed/);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get()?.count, 0);
  });
});
