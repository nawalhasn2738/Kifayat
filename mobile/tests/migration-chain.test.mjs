import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { createHistoryStartStateService } from '../src/lib/services/history-start-state-core.ts';
import {
  appendSyntheticMigration,
  loadBundledMigrationConfig,
  migrateWithExpoPath,
  withDisposableDatabase,
} from './helpers/migration-chain.mjs';

function migrationJournal(sqlite) {
  return sqlite.prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at').all()
    .map((row) => Number(row.created_at));
}

function tableExists(sqlite, name) {
  return sqlite.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?",
  ).get(name).count === 1;
}

function baselineOnly(config) {
  return {
    journal: { ...config.journal, entries: config.journal.entries.slice(0, 1) },
    migrations: { m0000: config.migrations.m0000 },
  };
}

function tableColumns(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((column) => ({
    name: column.name,
    notNull: column.notnull,
    defaultValue: column.dflt_value,
  }));
}

function schemaState(sqlite) {
  return sqlite.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
}

function enableForeignKeys(sqlite) {
  sqlite.pragma('foreign_keys = ON');
  assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
}

function insertAuditRow(sqlite, userId, changedAt, id) {
  const columns = id === undefined
    ? '(user_id, new_started_at, change_kind, changed_at)'
    : '(id, user_id, new_started_at, change_kind, changed_at)';
  const placeholders = id === undefined ? '(?, ?, ?, ?)' : '(?, ?, ?, ?, ?)';
  const values = id === undefined
    ? [userId, '2026-01-01T00:00:00.000Z', 'confirmation', changedAt]
    : [id, userId, '2026-01-01T00:00:00.000Z', 'confirmation', changedAt];

  return sqlite.prepare(`
    INSERT INTO financial_history_start_audit ${columns}
    VALUES ${placeholders}
  `).run(...values);
}

test('migration chain: fresh database applies every bundled migration through the Expo path', async () => {
  await withDisposableDatabase(async (sqlite) => {
    const config = loadBundledMigrationConfig();
    await migrateWithExpoPath(sqlite, config);
    assert.equal(tableExists(sqlite, 'users'), true);
    assert.equal(tableExists(sqlite, 'transactions'), true);
    assert.equal(tableExists(sqlite, '__drizzle_migrations'), true);
    assert.deepEqual(migrationJournal(sqlite), config.journal.entries.map((entry) => entry.when));
  });
});

test('migration chain: audit foreign key and index match the design', async () => {
  await withDisposableDatabase(async (sqlite) => {
    await migrateWithExpoPath(sqlite);
    const fk = sqlite.prepare('PRAGMA foreign_key_list(financial_history_start_audit)').get();
    assert.equal(fk.table, 'users');
    assert.equal(fk.from, 'user_id');
    assert.equal(fk.to, 'id');
    assert.equal(fk.on_update, 'NO ACTION');
    assert.equal(fk.on_delete, 'CASCADE');
    const index = sqlite.prepare('PRAGMA index_info(financial_history_start_audit_user_changed_idx)').all();
    assert.deepEqual(index.map((column) => column.name), ['user_id', 'changed_at']);
  });
});

test('migration chain: audit foreign key rejects a nonexistent user', async () => {
  await withDisposableDatabase(async (sqlite) => {
    enableForeignKeys(sqlite);
    await migrateWithExpoPath(sqlite);

    assert.throws(
      () => insertAuditRow(sqlite, 999, '2026-01-02T00:00:00.000Z'),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM financial_history_start_audit').get().count,
      0,
    );
  });
});

test('migration chain: deleting a user cascades to its audit rows', async () => {
  await withDisposableDatabase(async (sqlite) => {
    enableForeignKeys(sqlite);
    await migrateWithExpoPath(sqlite);
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)')
      .run('cascade@example.test', 'Cascade');
    insertAuditRow(sqlite, 1, '2026-01-02T00:00:00.000Z');

    sqlite.prepare('DELETE FROM users WHERE id = 1').run();

    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM financial_history_start_audit').get().count,
      0,
    );
  });
});

test('migration chain: updating a referenced user id is rejected by NO ACTION', async () => {
  await withDisposableDatabase(async (sqlite) => {
    enableForeignKeys(sqlite);
    await migrateWithExpoPath(sqlite);
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)')
      .run('update@example.test', 'Update');
    insertAuditRow(sqlite, 1, '2026-01-02T00:00:00.000Z');

    assert.throws(
      () => sqlite.prepare('UPDATE users SET id = 2 WHERE id = 1').run(),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(sqlite.prepare('SELECT id FROM users').get().id, 1);
    assert.equal(
      sqlite.prepare('SELECT user_id FROM financial_history_start_audit').get().user_id,
      1,
    );
  });
});

test('migration chain: audit primary keys auto-generate uniquely and reject duplicates', async () => {
  await withDisposableDatabase(async (sqlite) => {
    await migrateWithExpoPath(sqlite);
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)')
      .run('primary-key@example.test', 'Primary Key');

    const first = insertAuditRow(sqlite, 1, '2026-01-02T00:00:00.000Z');
    const second = insertAuditRow(sqlite, 1, '2026-01-03T00:00:00.000Z');

    assert.notEqual(first.lastInsertRowid, second.lastInsertRowid);
    assert.deepEqual(
      sqlite.prepare('SELECT id FROM financial_history_start_audit ORDER BY id').all(),
      [{ id: Number(first.lastInsertRowid) }, { id: Number(second.lastInsertRowid) }],
    );
    assert.throws(
      () => insertAuditRow(sqlite, 1, '2026-01-04T00:00:00.000Z', first.lastInsertRowid),
      /UNIQUE constraint failed: financial_history_start_audit.id/,
    );
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM financial_history_start_audit').get().count,
      2,
    );
  });
});

test('migration chain: history-start schema matches the approved nullable design', async () => {
  await withDisposableDatabase(async (sqlite) => {
    await migrateWithExpoPath(sqlite);
    const profileColumn = tableColumns(sqlite, 'user_profiles')
      .find((column) => column.name === 'financial_history_started_at');
    assert.deepEqual(profileColumn, {
      name: 'financial_history_started_at', notNull: 0, defaultValue: null,
    });
    assert.deepEqual(tableColumns(sqlite, 'financial_history_start_audit'), [
      { name: 'id', notNull: 1, defaultValue: null },
      { name: 'user_id', notNull: 1, defaultValue: null },
      { name: 'previous_started_at', notNull: 0, defaultValue: null },
      { name: 'new_started_at', notNull: 1, defaultValue: null },
      { name: 'change_kind', notNull: 1, defaultValue: null },
      { name: 'changed_at', notNull: 1, defaultValue: null },
    ]);
  });
});

test('migration chain: failed later migration preserves data and can retry cleanly', async () => {
  await withDisposableDatabase(async (sqlite) => {
    const baseline = loadBundledMigrationConfig();
    await migrateWithExpoPath(sqlite, baseline);
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)')
      .run('failure@example.test', 'Failure Fixture');
    sqlite.prepare(`
      INSERT INTO user_profiles (user_id, monthly_income, emergency_fund_target)
      VALUES (1, 5000, 9000)
    `).run();
    sqlite.prepare(`
      INSERT INTO accounts (id, user_id, name, type, balance)
      VALUES (1, 1, ?, ?, 750)
    `).run('Cash', 'cash');
    sqlite.prepare(`
      INSERT INTO transactions (client_id, user_id, account_id, date, amount, type)
      VALUES (?, 1, 1, ?, 750, ?)
    `).run('failure-existing', '2026-01-01T00:00:00.000Z', 'income');
    const fixturesBefore = {
      profile: sqlite.prepare('SELECT * FROM user_profiles WHERE user_id = 1').get(),
      account: sqlite.prepare('SELECT * FROM accounts WHERE id = 1').get(),
      transaction: sqlite.prepare('SELECT * FROM transactions WHERE client_id = ?')
        .get('failure-existing'),
    };
    const journalBefore = migrationJournal(sqlite);
    const failing = appendSyntheticMigration(baseline, {
      tag: '0001_test_failure',
      sql: 'CREATE TABLE migration_chain_rolled_back (id integer);\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);',
    });
    await assert.rejects(migrateWithExpoPath(sqlite, failing), /Failed to run the query/);
    assert.equal(tableExists(sqlite, 'migration_chain_rolled_back'), false);
    assert.deepEqual(migrationJournal(sqlite), journalBefore);
    assert.deepEqual(sqlite.prepare('SELECT * FROM user_profiles WHERE user_id = 1').get(), fixturesBefore.profile);
    assert.deepEqual(sqlite.prepare('SELECT * FROM accounts WHERE id = 1').get(), fixturesBefore.account);
    assert.deepEqual(
      sqlite.prepare('SELECT * FROM transactions WHERE client_id = ?').get('failure-existing'),
      fixturesBefore.transaction,
    );

    const retry = appendSyntheticMigration(baseline, {
      tag: '0001_test_failure',
      sql: 'CREATE TABLE migration_chain_rolled_back (id integer);',
    });
    await migrateWithExpoPath(sqlite, retry);
    assert.equal(tableExists(sqlite, 'migration_chain_rolled_back'), true);
    assert.deepEqual(migrationJournal(sqlite), [
      ...journalBefore,
      retry.journal.entries.at(-1).when,
    ]);
    await migrateWithExpoPath(sqlite, retry);
    assert.deepEqual(migrationJournal(sqlite), [
      ...journalBefore,
      retry.journal.entries.at(-1).when,
    ]);
  });
});

test('migration chain: fresh-chain failure leaves only an empty journal and retries', async () => {
  await withDisposableDatabase(async (sqlite) => {
    const current = loadBundledMigrationConfig();
    const failing = appendSyntheticMigration(current, {
      tag: '0002_fresh_chain_failure',
      sql: 'CREATE TABLE fresh_chain_rolled_back (id integer);\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);',
    });

    await assert.rejects(migrateWithExpoPath(sqlite, failing), /Failed to run the query/);
    assert.equal(tableExists(sqlite, '__drizzle_migrations'), true);
    assert.deepEqual(migrationJournal(sqlite), []);
    assert.equal(tableExists(sqlite, 'users'), false);
    assert.equal(tableExists(sqlite, 'financial_history_start_audit'), false);
    assert.equal(tableExists(sqlite, 'fresh_chain_rolled_back'), false);

    await migrateWithExpoPath(sqlite, current);
    assert.equal(tableExists(sqlite, 'users'), true);
    assert.equal(tableExists(sqlite, 'financial_history_start_audit'), true);
    assert.deepEqual(
      migrationJournal(sqlite),
      current.journal.entries.map((entry) => entry.when),
    );
  });
});

test('migration chain: genuine 0000 database upgrades without backfill or data changes', async () => {
  await withDisposableDatabase(async (sqlite) => {
    const current = loadBundledMigrationConfig();
    const baseline = baselineOnly(current);
    await migrateWithExpoPath(sqlite, baseline);
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)').run('upgrade@example.test', 'Upgrade');
    sqlite.prepare('INSERT INTO user_profiles (user_id, monthly_income, emergency_fund_target) VALUES (1, 5000, 9000)').run();
    sqlite.prepare('INSERT INTO accounts (id, user_id, name, type, balance) VALUES (1, 1, ?, ?, 750)').run('Cash', 'cash');
    sqlite.prepare('INSERT INTO transactions (client_id, user_id, account_id, date, amount, type) VALUES (?, 1, 1, ?, 750, ?)').run('existing', '2026-01-01T00:00:00.000Z', 'income');
    const profileBefore = sqlite.prepare('SELECT * FROM user_profiles').get();
    const accountBefore = sqlite.prepare('SELECT * FROM accounts').get();
    const transactionBefore = sqlite.prepare('SELECT * FROM transactions').get();
    await migrateWithExpoPath(sqlite, current);
    const { financial_history_started_at: historyStart, ...profileAfter } = sqlite.prepare('SELECT * FROM user_profiles').get();
    assert.deepEqual(profileAfter, profileBefore);
    assert.equal(historyStart, null);
    assert.deepEqual(sqlite.prepare('SELECT * FROM accounts').get(), accountBefore);
    assert.deepEqual(sqlite.prepare('SELECT * FROM transactions').get(), transactionBefore);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM financial_history_start_audit').get().count, 0);
    assert.deepEqual(migrationJournal(sqlite), current.journal.entries.map((entry) => entry.when));

    const state = createHistoryStartStateService(drizzle(sqlite, { schema }), {
      userId: 1,
      now: () => new Date('2026-10-20T12:00:00.000Z'),
    });
    assert.deepEqual(await state.getFinancialHistoryState(), {
      status: 'unconfirmed',
      reason: 'history_start_unconfirmed',
      suggestion: {
        value: '2025-12-31T19:00:00.000Z',
        calendarDate: '2026-01-01',
        sourceTransactionDate: '2026-01-01T00:00:00.000Z',
      },
    });
  });
});

test('migration chain: rerun preserves schema, fixtures, and migration journal', async () => {
  await withDisposableDatabase(async (sqlite) => {
    const config = loadBundledMigrationConfig();
    await migrateWithExpoPath(sqlite, config);
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)')
      .run('rerun@example.test', 'Rerun');
    sqlite.prepare(`
      INSERT INTO user_profiles (user_id, monthly_income, emergency_fund_target)
      VALUES (1, 5000, 9000)
    `).run();
    sqlite.prepare(`
      INSERT INTO accounts (id, user_id, name, type, balance)
      VALUES (1, 1, ?, ?, 750)
    `).run('Cash', 'cash');
    sqlite.prepare(`
      INSERT INTO transactions (client_id, user_id, account_id, date, amount, type)
      VALUES (?, 1, 1, ?, 750, ?)
    `).run('rerun-existing', '2026-01-01T00:00:00.000Z', 'income');

    const schemaBefore = schemaState(sqlite);
    const journalBefore = migrationJournal(sqlite);
    const profileBefore = sqlite.prepare('SELECT * FROM user_profiles WHERE user_id = 1').get();
    const transactionBefore = sqlite.prepare(
      'SELECT * FROM transactions WHERE client_id = ?',
    ).get('rerun-existing');
    insertAuditRow(sqlite, 1, '2026-01-02T00:00:00.000Z');
    const auditBefore = sqlite.prepare(
      'SELECT * FROM financial_history_start_audit ORDER BY id',
    ).all();

    await migrateWithExpoPath(sqlite, config);

    assert.deepEqual(schemaState(sqlite), schemaBefore);
    assert.deepEqual(migrationJournal(sqlite), journalBefore);
    assert.deepEqual(
      sqlite.prepare('SELECT * FROM user_profiles WHERE user_id = 1').get(),
      profileBefore,
    );
    assert.deepEqual(
      sqlite.prepare('SELECT * FROM transactions WHERE client_id = ?').get('rerun-existing'),
      transactionBefore,
    );
    assert.deepEqual(
      sqlite.prepare('SELECT * FROM financial_history_start_audit ORDER BY id').all(),
      auditBefore,
    );
  });
});
