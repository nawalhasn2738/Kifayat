import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareFinancialHistoryStarts,
  financialHistoryStartToKarachiCalendarDate,
  INVALID_HISTORY_START_REASON,
  karachiCalendarDateToFinancialHistoryStart,
  validateFinancialHistoryStartedAt,
} from '../src/lib/finance/history-start';

const now = new Date('2026-10-20T12:00:00.000Z');
const invalid = { status: 'invalid', reason: INVALID_HISTORY_START_REASON } as const;

test('history start: accepts exact canonical UTC instants through the reference time', () => {
  const earlier = validateFinancialHistoryStartedAt('2024-02-29T19:00:00.000Z', now);
  const boundary = validateFinancialHistoryStartedAt(now.toISOString(), now);

  assert.equal(earlier.status, 'valid');
  if (earlier.status === 'valid') {
    assert.equal(earlier.value, '2024-02-29T19:00:00.000Z');
    assert.equal(earlier.instant.toISOString(), earlier.value);
  }
  assert.equal(boundary.status, 'valid');
});

test('history start: rejects malformed, impossible, noncanonical, and non-string values', () => {
  const rejected = [
    '',
    'not-a-date',
    '2025-02-29T00:00:00.000Z',
    '2026-02-30T00:00:00.000Z',
    '2026-05-01',
    '2026-05-01T00:00:00Z',
    '2026-05-01T00:00:00.000+00:00',
    '2026-05-01T05:00:00.000+05:00',
    '2026-05-01T00:00:00.000z',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date('2026-05-01T00:00:00.000Z'),
    null,
    undefined,
  ];

  for (const value of rejected) {
    assert.deepEqual(validateFinancialHistoryStartedAt(value, now), invalid, String(value));
  }
});

test('history start: rejects an instant one millisecond beyond the injected current time', () => {
  assert.deepEqual(
    validateFinancialHistoryStartedAt('2026-10-20T12:00:00.001Z', now),
    invalid,
  );
  assert.throws(
    () => validateFinancialHistoryStartedAt('2026-01-01T00:00:00.000Z', new Date(Number.NaN)),
    /valid reference time/,
  );
});

test('history start: converts Karachi calendar dates to exact canonical UTC instants', () => {
  assert.equal(
    karachiCalendarDateToFinancialHistoryStart('2026-05-01'),
    '2026-04-30T19:00:00.000Z',
  );
  assert.equal(
    karachiCalendarDateToFinancialHistoryStart('2026-01-01'),
    '2025-12-31T19:00:00.000Z',
  );
  assert.equal(
    karachiCalendarDateToFinancialHistoryStart('2024-02-29'),
    '2024-02-28T19:00:00.000Z',
  );
  assert.equal(
    karachiCalendarDateToFinancialHistoryStart('2026-12-31'),
    '2026-12-30T19:00:00.000Z',
  );
});

test('history start: rejects invalid Karachi calendar dates without normalization', () => {
  for (const value of ['', '2026-5-01', '2026-05-1', '0000-01-01', '2025-02-29', '2026-02-30', '2026-13-01']) {
    assert.throws(
      () => karachiCalendarDateToFinancialHistoryStart(value),
      /valid Karachi calendar date in YYYY-MM-DD format/,
      value,
    );
  }
});

test('history start: displays validated instants as Karachi dates across UTC day boundaries', () => {
  const beforeMidnight = financialHistoryStartToKarachiCalendarDate(
    '2026-04-30T18:59:59.999Z',
    now,
  );
  const atMidnight = financialHistoryStartToKarachiCalendarDate(
    '2026-04-30T19:00:00.000Z',
    now,
  );

  assert.equal(beforeMidnight.status, 'valid');
  assert.equal(atMidnight.status, 'valid');
  if (beforeMidnight.status === 'valid' && atMidnight.status === 'valid') {
    assert.equal(beforeMidnight.calendarDate, '2026-04-30');
    assert.equal(atMidnight.calendarDate, '2026-05-01');
  }
  assert.deepEqual(
    financialHistoryStartToKarachiCalendarDate('2026-10-20T12:00:00.001Z', now),
    invalid,
  );
});

test('history start: conversion and display are independent of the machine timezone', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utcHost = karachiCalendarDateToFinancialHistoryStart('2026-05-01');
    const utcDisplay = financialHistoryStartToKarachiCalendarDate(utcHost, now);

    process.env.TZ = 'America/Los_Angeles';
    const pacificHost = karachiCalendarDateToFinancialHistoryStart('2026-05-01');
    const pacificDisplay = financialHistoryStartToKarachiCalendarDate(pacificHost, now);

    assert.equal(pacificHost, utcHost);
    assert.deepEqual(pacificDisplay, utcDisplay);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('history start: equality compares validated canonical values only', () => {
  const value = '2026-04-30T19:00:00.000Z';
  assert.deepEqual(compareFinancialHistoryStarts(value, value, now), {
    status: 'valid',
    equal: true,
  });
  assert.deepEqual(
    compareFinancialHistoryStarts(value, '2026-04-30T19:00:00.001Z', now),
    { status: 'valid', equal: false },
  );
  assert.deepEqual(
    compareFinancialHistoryStarts(value, '2026-05-01T00:00:00.000+05:00', now),
    invalid,
  );
});
