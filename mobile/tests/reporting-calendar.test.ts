import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPORTING_TIME_ZONE,
  nextReportingMonthStart,
  reportingMonthKey,
  reportingMonthRange,
  reportingMonthStart,
} from '../src/lib/finance/reporting-calendar';

test('reporting calendar: uses the approved named timezone', () => {
  assert.equal(REPORTING_TIME_ZONE, 'Asia/Karachi');
});

test('reporting calendar: assigns exact inclusive and exclusive month boundaries', () => {
  const april = reportingMonthRange('2026-04');

  assert.equal(april.start.toISOString(), '2026-03-31T19:00:00.000Z');
  assert.equal(april.endExclusive.toISOString(), '2026-04-30T19:00:00.000Z');
  assert.equal(reportingMonthKey(april.start), '2026-04');
  assert.equal(reportingMonthKey('2026-04-30T18:59:59.999Z'), '2026-04');
  assert.equal(reportingMonthKey(april.endExclusive), '2026-05');
});

test('reporting calendar: maps UTC-midnight-adjacent instants to Karachi dates', () => {
  assert.equal(reportingMonthKey('2026-01-31T18:59:59.999Z'), '2026-01');
  assert.equal(reportingMonthKey('2026-01-31T19:00:00.000Z'), '2026-02');
  assert.equal(reportingMonthKey('2026-01-31T23:30:00.000Z'), '2026-02');
});

test('reporting calendar: handles December-to-January rollover', () => {
  assert.equal(reportingMonthStart('2026-12').toISOString(), '2026-11-30T19:00:00.000Z');
  assert.equal(nextReportingMonthStart('2026-12').toISOString(), '2026-12-31T19:00:00.000Z');
  assert.deepEqual(reportingMonthRange('2027-01'), {
    month: '2027-01',
    start: new Date('2026-12-31T19:00:00.000Z'),
    endExclusive: new Date('2027-01-31T19:00:00.000Z'),
  });
});

test('reporting calendar: handles leap-year and non-leap-year February', () => {
  const leap = reportingMonthRange('2024-02');
  const nonLeap = reportingMonthRange('2025-02');

  assert.equal(leap.start.toISOString(), '2024-01-31T19:00:00.000Z');
  assert.equal(leap.endExclusive.toISOString(), '2024-02-29T19:00:00.000Z');
  assert.equal((leap.endExclusive.getTime() - leap.start.getTime()) / 86_400_000, 29);
  assert.equal(nonLeap.start.toISOString(), '2025-01-31T19:00:00.000Z');
  assert.equal(nonLeap.endExclusive.toISOString(), '2025-02-28T19:00:00.000Z');
  assert.equal((nonLeap.endExclusive.getTime() - nonLeap.start.getTime()) / 86_400_000, 28);
});

test('reporting calendar: results do not depend on the machine timezone', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utcHost = reportingMonthRange('2026-04');
    const utcHostKey = reportingMonthKey('2026-03-31T20:00:00.000Z');

    process.env.TZ = 'America/Los_Angeles';
    const pacificHost = reportingMonthRange('2026-04');
    const pacificHostKey = reportingMonthKey('2026-03-31T20:00:00.000Z');

    assert.deepEqual(pacificHost, utcHost);
    assert.equal(utcHostKey, '2026-04');
    assert.equal(pacificHostKey, utcHostKey);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('reporting calendar: rejects invalid instants and month keys', () => {
  for (const instant of ['', '2026-02-30T00:00:00.000Z', '2026-01-01', new Date(Number.NaN)]) {
    assert.throws(() => reportingMonthKey(instant), /Enter a valid date\./);
  }

  for (const month of ['', '2026-1', '2026-00', '2026-13', '0000-01', 'not-a-month']) {
    assert.throws(() => reportingMonthRange(month), /Enter a valid reporting month in YYYY-MM format\./);
  }
});
