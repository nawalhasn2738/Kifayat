import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAffordability } from '../src/lib/services/finance-core';
import { MAX_PLANNING_HORIZON_MONTHS, parsePlanningHorizon, validatePlanningHorizon } from '../src/lib/validation/affordability';

function summary(overrides: Partial<Parameters<typeof calculateAffordability>[1]> = {}) {
  return {
    totalBalance: 100_000,
    spend: { threeMonthAvg: 20_000 },
    savings: { threeMonthAvg: 10_000 },
    ...overrides,
  } as Parameters<typeof calculateAffordability>[1];
}

function profile(overrides: Partial<Parameters<typeof calculateAffordability>[2]> = {}) {
  return { emergencyFundTarget: 50_000, ...overrides };
}

function input(overrides: Partial<Parameters<typeof calculateAffordability>[0]> = {}) {
  return { itemName: 'Phone', price: 70_000, monthsAhead: 6, ...overrides };
}

test('affordability: preserves valid emergency-buffer and shortfall calculations', () => {
  assert.deepEqual(calculateAffordability(input(), summary(), profile()), {
    canAfford: true,
    available: 100_000,
    buffer: 60_000,
    shortfall: 0,
    monthsNeededAtCurrentRate: 0,
    reason: 'The purchase preserves your emergency buffer.',
  });

  const protectedResult = calculateAffordability(input({ price: 120_000 }), summary(), profile({ emergencyFundTarget: 90_000 }));
  assert.equal(protectedResult.canAfford, false);
  assert.equal(protectedResult.buffer, 90_000);
  assert.equal(protectedResult.available, 70_000);
  assert.equal(protectedResult.shortfall, 50_000);
  assert.equal(protectedResult.monthsNeededAtCurrentRate, 5);
});

test('affordability: handles zero savings and zero income boundaries without inventing saving time', () => {
  const result = calculateAffordability(input({ price: 50_000, monthsAhead: 1 }), summary({
    totalBalance: 70_000,
    spend: { threeMonthAvg: 0 },
    savings: { threeMonthAvg: 0 },
  }), profile({ emergencyFundTarget: 30_000 }));

  assert.equal(result.available, 40_000);
  assert.equal(result.shortfall, 10_000);
  assert.equal(result.monthsNeededAtCurrentRate, -1);
});

test('affordability: accepts whole planning horizons from one through 120 months', () => {
  assert.equal(parsePlanningHorizon('1'), 1);
  assert.equal(parsePlanningHorizon('001'), 1);
  assert.equal(parsePlanningHorizon(String(MAX_PLANNING_HORIZON_MONTHS)), MAX_PLANNING_HORIZON_MONTHS);
  assert.equal(validatePlanningHorizon(MAX_PLANNING_HORIZON_MONTHS), MAX_PLANNING_HORIZON_MONTHS);
});

test('affordability: rejects malformed and out-of-range planning horizons', () => {
  for (const raw of ['', ' ', '0', '-1', '+1', '1.5', '1e2', '1months', '121', 'Infinity', 'NaN', '9007199254740992']) {
    assert.throws(() => parsePlanningHorizon(raw), /whole number of months/);
  }
  for (const value of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 121]) {
    assert.throws(() => validatePlanningHorizon(value), /whole number of months/);
  }
});

test('affordability: rejects malformed profile values and unsafe monetary intermediates', () => {
  for (const emergencyFundTarget of [Number.NaN, Infinity, 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateAffordability(input(), summary(), profile({ emergencyFundTarget })), /Affordability requires safe whole-PKR monetary values/);
  }
  assert.throws(() => calculateAffordability(input(), summary({ totalBalance: Number.MAX_SAFE_INTEGER }), profile()), /Affordability requires safe whole-PKR monetary values/);
  assert.throws(() => calculateAffordability(input(), summary({ spend: { threeMonthAvg: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1 } }), profile()), /Affordability requires safe whole-PKR monetary values/);
  assert.throws(() => calculateAffordability(input({ monthsAhead: 120 }), summary({ savings: { threeMonthAvg: Math.floor(Number.MAX_SAFE_INTEGER / 120) + 1 } }), profile()), /Affordability requires safe whole-PKR monetary values/);
});