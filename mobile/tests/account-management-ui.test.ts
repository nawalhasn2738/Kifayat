import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountManagementRunner } from '../src/lib/services/account-management-ui';

function fixture() {
  const events: string[] = [];
  const runner = createAccountManagementRunner<string[]>({
    loading: (value) => events.push(`loading:${value}`),
    saving: (key) => events.push(`saving:${key}`),
    loaded: (value) => events.push(`loaded:${value.join(',')}`),
    error: (message) => events.push(`error:${message}`),
    notice: (message) => events.push(`notice:${message}`),
  });
  return { events, runner };
}

test('account UI loads account data and exposes recoverable load errors', async () => {
  const first = fixture();
  assert.deepEqual(await first.runner.load(async () => ['Cash', 'Savings']), ['Cash', 'Savings']);
  assert.deepEqual(first.events, ['loading:true', 'loaded:Cash,Savings', 'error:null', 'loading:false']);

  const failed = fixture();
  assert.equal(await failed.runner.load(async () => { throw new Error('read failed'); }), null);
  assert.deepEqual(failed.events, ['loading:true', 'error:read failed', 'loading:false']);
});

test('account UI serializes mutations and refreshes after create, rename, archive, restore, or delete', async () => {
  const { events, runner } = fixture();
  let release!: () => void;
  const first = runner.submit(
    'create',
    'Account created.',
    () => new Promise<void>((resolve) => { release = resolve; }),
    async () => ['New account'],
  );
  assert.equal(runner.isActive(), true);
  assert.equal(await runner.submit('rename:1', 'Renamed.', async () => {}, async () => ['Duplicate']), null);
  release();
  assert.deepEqual(await first, { status: 'saved', value: ['New account'] });
  assert.equal(runner.isActive(), false);
  assert.ok(events.includes('loaded:New account'));
  assert.ok(events.includes('notice:Account created.'));
  assert.equal(events.at(-1), 'saving:null');
});

test('account UI distinguishes rejected writes from saved changes with failed refresh', async () => {
  const rejected = fixture();
  assert.deepEqual(
    await rejected.runner.submit('delete:1', 'Deleted.', async () => { throw new Error('account in use'); }, async () => ['wrong']),
    { status: 'rejected', previous: null },
  );
  assert.ok(rejected.events.includes('error:account in use'));
  assert.equal(rejected.events.some((event) => event === 'loaded:wrong'), false);

  const stale = fixture();
  await stale.runner.load(async () => ['Before']);
  assert.deepEqual(
    await stale.runner.submit('archive:1', 'Archived.', async () => {}, async () => { throw new Error('read failed'); }),
    { status: 'saved_refresh_failed', previous: ['Before'] },
  );
  assert.ok(stale.events.includes('error:Change saved, but accounts could not be refreshed: read failed'));
  assert.equal(stale.events.includes('notice:Archived.'), false);
});
