import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { CATEGORY_APPLICABILITY_SEED, CATEGORY_SEED, seedLocalProfile } from '../src/lib/db/seed.ts';
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

function throughMigration(config, count) {
  const entries = config.journal.entries.slice(0, count);
  return {
    journal: { ...config.journal, entries },
    migrations: Object.fromEntries(entries.map((entry) => {
      const key = `m${String(entry.idx).padStart(4, '0')}`;
      return [key, config.migrations[key]];
    })),
  };
}

function insertCategories(sqlite, names = CATEGORY_SEED.map(([name]) => name)) {
  const insert = sqlite.prepare('INSERT INTO categories (name) VALUES (?)');
  for (const name of names) insert.run(name);
}

function applicabilityRows(sqlite) {
  return sqlite.prepare(`
    SELECT categories.name, category_applicability.transaction_type AS transactionType
    FROM category_applicability
    INNER JOIN categories ON categories.id = category_applicability.category_id
    ORDER BY categories.name, category_applicability.transaction_type
  `).all();
}

const approvedApplicability = CATEGORY_APPLICABILITY_SEED
  .map(([name, transactionType]) => ({ name, transactionType }))
  .sort((left, right) => left.name.localeCompare(right.name));

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

test('category applicability: fresh migration and atomic seed create exactly the approved mappings', async () => {
  await withDisposableDatabase(async (sqlite) => {
    enableForeignKeys(sqlite);
    await migrateWithExpoPath(sqlite);
    assert.deepEqual(applicabilityRows(sqlite), []);

    const database = drizzle(sqlite, { schema });
    await seedLocalProfile(database);
    await seedLocalProfile(database);

    assert.deepEqual(applicabilityRows(sqlite), approvedApplicability);
    assert.deepEqual(
      sqlite.prepare(`
        SELECT transaction_type AS transactionType, COUNT(*) AS count
        FROM category_applicability
        GROUP BY transaction_type
        ORDER BY transaction_type
      `).all(),
      [{ transactionType: 'expense', count: 15 }, { transactionType: 'income', count: 2 }],
    );
    assert.deepEqual(
      sqlite.prepare(`
        SELECT name
        FROM categories
        WHERE id NOT IN (SELECT category_id FROM category_applicability)
        ORDER BY name
      `).all(),
      [{ name: 'anomaly' }, { name: 'savings_transfer' }],
    );
  });
});

test('category applicability: existing 0001 catalogue upgrades without changing financial records', async () => {
  await withDisposableDatabase(async (sqlite) => {
    const current = loadBundledMigrationConfig();
    await migrateWithExpoPath(sqlite, throughMigration(current, 2));
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)').run('category-upgrade@example.test', 'Upgrade');
    sqlite.prepare('INSERT INTO user_profiles (user_id, monthly_income, emergency_fund_target) VALUES (1, 5000, 9000)').run();
    sqlite.prepare('INSERT INTO accounts (id, user_id, name, type, balance) VALUES (1, 1, ?, ?, 750)').run('Cash', 'cash');
    insertCategories(sqlite, [...CATEGORY_SEED.map(([name]) => name), 'custom_existing']);
    const salaryId = sqlite.prepare('SELECT id FROM categories WHERE name = ?').get('salary').id;
    sqlite.prepare(`
      INSERT INTO transactions (client_id, user_id, account_id, category_id, date, amount, type)
      VALUES (?, 1, 1, ?, ?, 750, ?)
    `).run('category-upgrade-existing', salaryId, '2026-01-01T00:00:00.000Z', 'income');
    const before = {
      profile: sqlite.prepare('SELECT * FROM user_profiles').all(),
      accounts: sqlite.prepare('SELECT * FROM accounts').all(),
      transactions: sqlite.prepare('SELECT * FROM transactions').all(),
      categories: sqlite.prepare('SELECT * FROM categories ORDER BY id').all(),
    };

    await migrateWithExpoPath(sqlite, current);

    assert.deepEqual(applicabilityRows(sqlite), approvedApplicability);
    assert.deepEqual(sqlite.prepare('SELECT * FROM user_profiles').all(), before.profile);
    const upgradedAccounts = sqlite.prepare('SELECT * FROM accounts').all();
    assert.deepEqual(upgradedAccounts.map(({ opening_balance, ...account }) => account), before.accounts);
    assert.ok(upgradedAccounts.every((account) => account.opening_balance === null));
    assert.deepEqual(sqlite.prepare('SELECT * FROM transactions').all(), before.transactions);
    assert.deepEqual(sqlite.prepare('SELECT * FROM categories ORDER BY id').all(), before.categories);
    assert.deepEqual(
      sqlite.prepare(`
        SELECT name FROM categories
        WHERE name IN ('anomaly', 'savings_transfer', 'custom_existing')
          AND id NOT IN (SELECT category_id FROM category_applicability)
        ORDER BY name
      `).all(),
      [{ name: 'anomaly' }, { name: 'custom_existing' }, { name: 'savings_transfer' }],
    );
  });
});

test('category applicability: every missing approved category aborts and rolls back 0002', async () => {
  const current = loadBundledMigrationConfig();
  const through0001 = throughMigration(current, 2);
  for (const [missingName] of CATEGORY_APPLICABILITY_SEED) {
    await withDisposableDatabase(async (sqlite) => {
      await migrateWithExpoPath(sqlite, through0001);
      sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)')
        .run(`${missingName}@example.test`, 'Partial Catalogue');
      const retainedNames = CATEGORY_SEED.map(([name]) => name).filter((name) => name !== missingName);
      insertCategories(sqlite, retainedNames);
      const categoriesBefore = sqlite.prepare('SELECT * FROM categories ORDER BY id').all();
      const journalBefore = migrationJournal(sqlite);

      await assert.rejects(
        migrateWithExpoPath(sqlite, current),
        (error) => error?.cause?.code === 'SQLITE_CONSTRAINT_CHECK',
      );
      assert.equal(tableExists(sqlite, 'category_applicability'), false, missingName);
      assert.deepEqual(migrationJournal(sqlite), journalBefore, missingName);
      assert.deepEqual(sqlite.prepare('SELECT * FROM categories ORDER BY id').all(), categoriesBefore, missingName);
    });
  }
});

test('category applicability: an existing user without a category catalogue fails closed', async () => {
  await withDisposableDatabase(async (sqlite) => {
    const current = loadBundledMigrationConfig();
    await migrateWithExpoPath(sqlite, throughMigration(current, 2));
    sqlite.prepare('INSERT INTO users (id, email, name) VALUES (1, ?, ?)').run('missing-catalogue@example.test', 'Missing Catalogue');
    const journalBefore = migrationJournal(sqlite);

    await assert.rejects(
      migrateWithExpoPath(sqlite, current),
      (error) => error?.cause?.code === 'SQLITE_CONSTRAINT_CHECK',
    );
    assert.equal(tableExists(sqlite, 'category_applicability'), false);
    assert.deepEqual(migrationJournal(sqlite), journalBefore);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  });
});

test('category applicability: constraints and category cascade match the approved schema', async () => {
  await withDisposableDatabase(async (sqlite) => {
    enableForeignKeys(sqlite);
    await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await seedLocalProfile(database);
    const salaryId = sqlite.prepare('SELECT id FROM categories WHERE name = ?').get('salary').id;

    assert.deepEqual(
      sqlite.prepare('PRAGMA table_info(category_applicability)').all()
        .map((column) => ({ name: column.name, notNull: column.notnull, primaryKeyPosition: column.pk })),
      [
        { name: 'category_id', notNull: 1, primaryKeyPosition: 1 },
        { name: 'transaction_type', notNull: 1, primaryKeyPosition: 2 },
      ],
    );
    const [foreignKey] = sqlite.prepare('PRAGMA foreign_key_list(category_applicability)').all();
    assert.deepEqual(
      { table: foreignKey.table, from: foreignKey.from, to: foreignKey.to,
        onUpdate: foreignKey.on_update, onDelete: foreignKey.on_delete },
      { table: 'categories', from: 'category_id', to: 'id', onUpdate: 'NO ACTION', onDelete: 'CASCADE' },
    );

    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO category_applicability (category_id, transaction_type)
        VALUES (?, 'income')
      `).run(salaryId),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO category_applicability (category_id, transaction_type)
        VALUES (?, 'refund')
      `).run(salaryId),
      /CHECK constraint failed/,
    );

    sqlite.prepare('DELETE FROM categories WHERE id = ?').run(salaryId);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM category_applicability WHERE category_id = ?').get(salaryId).count,
      0,
    );
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM category_applicability').get().count, 16);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM categories').get().count, 18);
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
    insertCategories(sqlite);
    sqlite.prepare('INSERT INTO transactions (client_id, user_id, account_id, date, amount, type) VALUES (?, 1, 1, ?, 750, ?)').run('existing', '2026-01-01T00:00:00.000Z', 'income');
    const profileBefore = sqlite.prepare('SELECT * FROM user_profiles').get();
    const accountBefore = sqlite.prepare('SELECT * FROM accounts').get();
    const transactionBefore = sqlite.prepare('SELECT * FROM transactions').get();
    const categoriesBefore = sqlite.prepare('SELECT * FROM categories ORDER BY id').all();
    await migrateWithExpoPath(sqlite, current);
    const { financial_history_started_at: historyStart, ...profileAfter } = sqlite.prepare('SELECT * FROM user_profiles').get();
    assert.deepEqual(profileAfter, profileBefore);
    assert.equal(historyStart, null);
    const { opening_balance: openingBalance, ...accountAfter } = sqlite.prepare('SELECT * FROM accounts').get();
    assert.deepEqual(accountAfter, accountBefore);
    assert.equal(openingBalance, null);
    assert.deepEqual(sqlite.prepare('SELECT * FROM transactions').get(), transactionBefore);
    assert.deepEqual(sqlite.prepare('SELECT * FROM categories ORDER BY id').all(), categoriesBefore);
    assert.deepEqual(applicabilityRows(sqlite), approvedApplicability);
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
