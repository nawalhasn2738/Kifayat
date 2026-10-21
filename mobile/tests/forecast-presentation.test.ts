import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORECAST_CATEGORY_LABEL,
  FORECAST_TOTAL_LABEL,
  forecastBasisLabel,
  forecastCategoryRows,
} from '../src/lib/finance/forecast-presentation';

test('forecast presentation labels estimates, PKR, categories, and exact history periods', () => {
  assert.match(FORECAST_TOTAL_LABEL, /ESTIMATED/);
  assert.match(FORECAST_TOTAL_LABEL, /PKR/);
  assert.match(FORECAST_CATEGORY_LABEL, /Estimated/);
  assert.match(FORECAST_CATEGORY_LABEL, /category/);
  assert.equal(
    forecastBasisLabel(['2026-04', '2026-05', '2026-06']),
    'Based on complete Karachi months: 2026-04, 2026-05, 2026-06.',
  );
});

test('forecast presentation retains every category and orders estimates by blend', () => {
  const byCategory = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
    `category_${index + 1}`,
    { blend: index + 1, low: 0, high: index + 2 },
  ]));
  const rows = forecastCategoryRows({
    total: { blend: 45, low: 0, high: 54 },
    byCategory,
    method: 'test',
    asOf: '2026-07-15T12:00:00.000Z',
  });
  assert.equal(rows.length, 9);
  assert.equal(rows[0][0], 'category_9');
  assert.equal(rows[8][0], 'category_1');
});

test('forecast presentation orders tied categories by name and keeps collision labels distinct', () => {
  const rows = forecastCategoryRows({
    total: { blend: 20, low: 0, high: 40 },
    byCategory: {
      zebra: { blend: 10, low: 0, high: 20 },
      'uncategorized [category 7]': { blend: 10, low: 0, high: 20 },
      uncategorized: { blend: 10, low: 0, high: 20 },
      alpha: { blend: 10, low: 0, high: 20 },
    },
    method: 'test',
    asOf: '2026-07-15T12:00:00.000Z',
  });

  assert.deepEqual(rows.map(([name]) => name), [
    'alpha',
    'uncategorized',
    'uncategorized [category 7]',
    'zebra',
  ]);
});
