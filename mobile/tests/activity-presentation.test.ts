import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDetailRoute, activityKey } from '../src/lib/finance/activity-presentation';

test('activity identity distinguishes transaction and transfer rows sharing an id', () => {
  const transaction = { kind: 'transaction' as const, id: 7 };
  const transfer = { kind: 'transfer' as const, id: 7 };
  assert.equal(activityKey(transaction), 'transaction:7');
  assert.equal(activityKey(transfer), 'transfer:7');
  assert.notEqual(activityKey(transaction), activityKey(transfer));
  assert.deepEqual(activityDetailRoute(transaction), { pathname: '/transaction/[id]', params: { id: '7', from: 'Transactions' } });
  assert.deepEqual(activityDetailRoute(transfer), { pathname: '/transfer/[id]', params: { id: '7' } });
});
