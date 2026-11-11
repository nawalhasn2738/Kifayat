import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivityBrowser } from '../src/lib/services/activity-browser-core';
import { activityDateRange, activityFilterKey, normalizeActivityFilters, validateActivityQuery, type ActivityQuery } from '../src/lib/validation/activity';
import type { ActivityPage, ActivityItem } from '../src/lib/services/activity-core';
const item = (id: number): ActivityItem => ({ kind: 'transaction', id, clientId: String(id), date: '2028-02-29T12:00:00.000Z', amount: -10,
  type: 'expense', merchant: null, description: null, isAnomaly: false, category: null, account: { id: 1, name: 'Bank', type: 'checking' } });
const cursor = (id: number, filters = { type: 'all' as const }) => ({ id, kind: 'transaction' as const, date: item(id).date, filterKey: activityFilterKey(filters) });
const page = (id: number, next = false): ActivityPage => ({ items: [item(id)], nextCursor: next ? cursor(id) : null, pageSize: 50 });

test('activity filters: Karachi month/year/leap ranges and half-open custom dates are exact', () => {
  assert.deepEqual(activityDateRange('month', '2028-02', '', ''), { start: '2028-01-31T19:00:00.000Z', endExclusive: '2028-02-29T19:00:00.000Z' });
  assert.deepEqual(activityDateRange('month', '2027-12', '', ''), { start: '2027-11-30T19:00:00.000Z', endExclusive: '2027-12-31T19:00:00.000Z' });
  assert.deepEqual(activityDateRange('range', '', '2028-02-29', '2028-03-01'), { start: '2028-02-28T19:00:00.000Z', endExclusive: '2028-02-29T19:00:00.000Z' });
  assert.deepEqual(activityDateRange('all', '', '', ''), {});
  assert.equal(activityDateRange('range', '', '', '2028-01-01').endExclusive, '2027-12-31T19:00:00.000Z');
  for (const [from, before] of [['2027-02-29', '2027-03-01'], ['2028-03-01', '2028-03-01'], ['2028-04-01', '2028-03-01'], ['', '']]) assert.throws(() => activityDateRange('range', '', from, before));
  assert.throws(() => activityDateRange('month', '2028-13', '', ''));
  assert.deepEqual(normalizeActivityFilters({ type: 'expense', search: '  Market  ' }), { type: 'expense', search: 'Market' });
  for (const query of [{ pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { filters: { type: 'other' } },
    { filters: { type: 'all', accountId: -1 } }, { filters: { type: 'all', search: 'x'.repeat(201) } }]) assert.throws(() => validateActivityQuery(query as ActivityQuery));
});

test('activity browser: filters persist across next/previous pages with one page of rows retained', async () => {
  const calls: ActivityQuery[] = [];
  const filters = { type: 'expense' as const, accountId: 1, search: 'Market' };
  const browser = createActivityBrowser({ changed: () => {}, fetchPage: async query => {
    calls.push(query); return { ...page(query.cursor ? 2 : 3, !query.cursor), nextCursor: query.cursor ? null : { ...cursor(3), filterKey: activityFilterKey(filters) } };
  } });
  await browser.apply(filters); await browser.next();
  assert.equal(browser.getState().pageIndex, 1);
  assert.deepEqual(browser.getState().items.map(row => row.id), [2]);
  assert.ok(calls.every(call => JSON.stringify(call.filters) === JSON.stringify(filters)));
  await browser.previous(); assert.equal(browser.getState().pageIndex, 0);
  assert.deepEqual(browser.getState().items.map(row => row.id), [3]);
  await browser.refresh(); assert.equal(calls.at(-1)!.cursor, null);
  assert.deepEqual(browser.getState().filters, filters);
  await browser.apply({ type: 'all' }); assert.deepEqual(browser.getState().filters, { type: 'all' });
});

test('activity browser: duplicate page taps are blocked synchronously', async () => {
  let release!: (value: ActivityPage) => void, calls = 0;
  const browser = createActivityBrowser({ changed: () => {}, fetchPage: async () => { calls++; if (calls === 1) return page(3, true); return new Promise(resolve => { release = resolve; }); } });
  await browser.refresh(); const next = browser.next();
  await browser.next(); assert.equal(calls, 2); release(page(2)); await next;
  assert.deepEqual(browser.getState().items.map(row => row.id), [2]);
});

test('activity browser: filter changes, refreshes and blur discard stale asynchronous responses', async () => {
  let release!: (value: ActivityPage) => void; let calls = 0;
  const browser = createActivityBrowser({ changed: () => {}, fetchPage: async () => { calls++; if (calls === 1) return new Promise(resolve => { release = resolve; }); return page(2); } });
  const old = browser.refresh(); await browser.apply({ type: 'income' }); release(page(99)); await old;
  assert.equal(browser.getState().items[0].id, 2); assert.equal(browser.getState().filters.type, 'income');
  let releaseBlur!: (value: ActivityPage) => void;
  const blurred = createActivityBrowser({ changed: () => {}, fetchPage: () => new Promise(resolve => { releaseBlur = resolve; }) });
  const pending = blurred.refresh(); blurred.invalidate(); releaseBlur(page(99)); await pending;
  assert.deepEqual(blurred.getState().items, []); assert.equal(blurred.getState().loading, false);
});

test('activity browser: safe failures preserve filters and retry the failed cursor without duplicate rows', async () => {
  let fail = true;
  const browser = createActivityBrowser({ changed: () => {}, fetchPage: async query => {
    if (!query.cursor) return page(3, true);
    if (fail) throw new Error('private SQL detail'); return page(2);
  } });
  await browser.refresh(); await browser.next();
  assert.match(browser.getState().error!, /filters are preserved/);
  assert.doesNotMatch(browser.getState().error!, /private/);
  assert.equal(browser.getState().pageIndex, 0); assert.equal(browser.getState().items[0].id, 3);
  fail = false; await browser.retry(); assert.equal(browser.getState().pageIndex, 1);
  assert.deepEqual(browser.getState().items.map(row => row.id), [2]);
});

test('activity browser: refresh after mutations resets to fresh page zero with the same filters', async () => {
  let current: ActivityPage = page(3, true);
  const browser = createActivityBrowser({ changed: () => {}, fetchPage: async () => current });
  const filters = { type: 'income' as const };
  await browser.apply(filters); await browser.next();
  for (const fresh of [page(4), page(5), { items: [], nextCursor: null, pageSize: 50 }]) {
    current = fresh; await browser.refresh();
    assert.equal(browser.getState().pageIndex, 0); assert.deepEqual(browser.getState().filters, filters);
    assert.deepEqual(browser.getState().items, fresh.items);
  }
});
