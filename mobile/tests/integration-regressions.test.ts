import assert from 'node:assert/strict';
import test from 'node:test';
import { createPurchaseAssessmentController } from '../src/lib/services/purchase-assessment-ui';
import { createResourceLoader } from '../src/lib/services/resource-loader-core';
import { userFacingError } from '../src/lib/services/user-facing-error';
import { createOpeningBalanceRunner } from '../src/lib/services/opening-balance-workflow-ui';
import { readFileSync } from 'node:fs';
const assessment = { status: 'insufficient_information' as const, result: null, guidance: 'Fixture' };

test('integration regression: edited purchase inputs or ledger changes clear results and discard old assessment responses', async () => {
  let release!: (value: typeof assessment) => void, calls = 0;
  const controller = createPurchaseAssessmentController({ changed: () => {}, assess: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const draft = { itemName: 'Phone', price: '30000', monthsAhead: '2' };
  const pending = controller.check(draft); await controller.check(draft); assert.equal(calls, 1);
  controller.invalidate(); release(assessment); await pending;
  assert.equal(controller.getState().result, null); assert.equal(controller.getState().checking, false);
  const fresh = controller.check({ ...draft, itemName: 'Laptop' }); release(assessment); await fresh;
  assert.equal(controller.getState().result!.itemName, 'Laptop');
  controller.invalidate(); assert.equal(controller.getState().result, null);
});

test('integration regression: purchase validation retains zero-horizon rule and service failures expose no database details', async () => {
  let calls = 0;
  const controller = createPurchaseAssessmentController({ changed: () => {}, assess: async () => { calls++; throw new Error('Failed query: SELECT private balances'); } });
  await controller.check({ itemName: 'Phone', price: '30000', monthsAhead: '0' }); assert.equal(calls, 0); assert.match(controller.getState().error!, /1 to 120/);
  await controller.check({ itemName: 'Phone', price: '30000', monthsAhead: '2' }); assert.equal(calls, 1);
  assert.doesNotMatch(controller.getState().error!, /SELECT|private/);
});

test('integration regression: resource reads on detail/editor screens discard stale results, errors and unmounted reads', async () => {
  const loaded: (string | null)[] = [], errors: (string | null)[] = [];
  const loader = createResourceLoader<string>({ loaded: value => loaded.push(value), error: value => errors.push(value), loading: () => {} });
  let release!: (value: string) => void;
  const old = loader.load(() => new Promise(resolve => { release = resolve; }));
  await loader.load(async () => 'updated'); release('old'); await old; assert.deepEqual(loaded, ['updated']);
  const pending = loader.load(() => new Promise(resolve => { release = resolve; })); loader.invalidate(); release('unmounted'); await pending;
  assert.deepEqual(loaded, ['updated']);
  const dbError = Object.assign(new Error('SQLITE_ERROR: SELECT secret'), { code: 'SQLITE_ERROR' });
  await loader.load(async () => { throw dbError; });
  assert.equal(loaded.at(-1), null); assert.doesNotMatch(errors.at(-1)!, /secret|SELECT|SQLITE/);
  assert.equal(userFacingError(new Error('Enter a positive amount.'), 'fallback'), 'Enter a positive amount.');
  assert.equal(userFacingError(new Error('outer', { cause: dbError }), 'safe'), 'safe');
  const root = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(root, /\{databaseError\.message\}/);
});

test('integration regression: an old opening-balance read cannot overwrite post-save rows; blur invalidates reads', async () => {
  const rows: string[] = [];
  const runner = createOpeningBalanceRunner<string>({ saving: () => {}, error: () => {}, loaded: value => rows.push(value), savedButStale: () => {} });
  let release!: (value: string) => void;
  const old = runner.load(() => new Promise(resolve => { release = resolve; }));
  await runner.submit(async () => {}, async () => 'confirmed:100'); release('unconfirmed:0'); await old;
  assert.deepEqual(rows, ['confirmed:100']);
  const pending = runner.load(() => new Promise(resolve => { release = resolve; })); runner.invalidate(); release('old account'); await pending;
  assert.deepEqual(rows, ['confirmed:100']);
});

test('integration regression: an account read started before a mutation cannot overwrite the saved account state', async () => {
  const { createAccountManagementRunner } = await import('../src/lib/services/account-management-ui');
  const rows: string[] = [];
  const runner = createAccountManagementRunner<string>({ loading: () => {}, saving: () => {}, loaded: value => rows.push(value), error: () => {}, notice: () => {} });
  let release!: (value: string) => void;
  const old = runner.load(() => new Promise(resolve => { release = resolve; }));
  await runner.submit('rename', 'Renamed.', async () => {}, async () => 'updated');
  release('old name'); await old;
  assert.deepEqual(rows, ['updated']);
});
