import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { CATEGORY_SEED, seedLocalProfile } from '../src/lib/db/seed.ts';
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { loadBundledMigrationConfig, migrateWithExpoPath } from './helpers/migration-chain.mjs';

test('product migration audit: every released prefix upgrades and reruns without losing the same legacy ledger', async () => {
  const config = loadBundledMigrationConfig();
  const through = count => ({ journal: { ...config.journal, entries: config.journal.entries.slice(0, count) },
    migrations: Object.fromEntries(Object.entries(config.migrations).filter(([key]) => Number(key.slice(1)) < count)) });
  for (let count = 1; count <= config.journal.entries.length; count++) {
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite, through(1));
      sqlite.prepare('INSERT INTO users (id,email,name) VALUES (101,?,?)').run('upgrade@example.test', 'Upgrade');
      sqlite.prepare('INSERT INTO user_profiles (user_id,monthly_income,emergency_fund_target) VALUES (101,50000,70000)').run();
      sqlite.prepare('INSERT INTO accounts (id,user_id,name,type,balance) VALUES (1,101,?,?,500)').run('Legacy bank', 'checking');
      const category = sqlite.prepare('INSERT INTO categories (name,parent,is_essential,is_high_risk) VALUES (?,?,?,?)');
      for (const [name, parent, essential, risky] of CATEGORY_SEED) category.run(name, parent, Number(essential), Number(risky));
      sqlite.prepare("INSERT INTO transactions (client_id,user_id,account_id,date,amount,type) VALUES ('upgrade-income',101,1,'2026-10-01T00:00:00.000Z',500,'income')").run();
      await migrateWithExpoPath(sqlite, through(count));
      await migrateWithExpoPath(sqlite); await migrateWithExpoPath(sqlite);
      const db = drizzle(sqlite, { schema }), catalog = createCatalogRepository(db, { userId: 101 });
      assert.equal((await catalog.getProfile()).monthlyIncome, 50_000, `prefix ${count}`);
      assert.equal((await catalog.getProfile()).emergencyFundTarget, 70_000);
      assert.equal((await catalog.getProfile()).financialHistoryStartedAt, null);
      assert.equal((await catalog.listAccounts())[0].balance, 500);
      const rows = await createTransactionRepository(db, { userId: 101, now: () => new Date('2026-11-11T12:00:00.000Z') }).listAllTransactions();
      assert.equal(rows.length, 1); assert.equal(rows[0].amount, 500); assert.equal(rows[0].clientId, 'upgrade-income');
      assert.equal(sqlite.prepare('SELECT count(*) AS total FROM __drizzle_migrations').get().total, config.journal.entries.length);
      assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    } finally { sqlite.close(); }
  }
});

test('product initialization audit: a failed seed rolls back every new row and retries cleanly', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON'); await migrateWithExpoPath(sqlite);
    const db = drizzle(sqlite, { schema });
    sqlite.exec("CREATE TRIGGER fail_seed BEFORE INSERT ON user_profiles BEGIN SELECT RAISE(ABORT, 'disposable seed failure'); END");
    await assert.rejects(seedLocalProfile(db));
    for (const table of ['users', 'user_profiles', 'accounts', 'categories', 'savings_goals']) assert.equal(sqlite.prepare(`SELECT count(*) AS total FROM ${table}`).get().total, 0);
    sqlite.exec('DROP TRIGGER fail_seed'); await seedLocalProfile(db); await seedLocalProfile(db);
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM users').get().total, 1);
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM accounts').get().total, 3);
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM categories').get().total, CATEGORY_SEED.length);
    assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
  } finally { sqlite.close(); }
});
