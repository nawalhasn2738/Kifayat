import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryAppliesTo,
  categoryOptionsForEditor,
  isCategorySelectionAllowed,
  reconcileCategorySelection,
  selectableCategories,
} from '../src/lib/finance/category-selection';
import type { CatalogCategory } from '../src/lib/repositories/catalog-core';

const categories: CatalogCategory[] = [
  { id: 1, name: 'salary', parent: 'Not authoritative', isEssential: false, isHighRisk: false, applicableTransactionTypes: ['income'] },
  { id: 2, name: 'groceries', parent: 'Income', isEssential: true, isHighRisk: false, applicableTransactionTypes: ['expense'] },
  { id: 3, name: 'anomaly', parent: 'Expense', isEssential: false, isHighRisk: true, applicableTransactionTypes: [] },
  { id: 4, name: 'shared', parent: null, isEssential: false, isHighRisk: false, applicableTransactionTypes: ['expense', 'income'] },
];

test('category options use explicit applicability without consulting parent metadata', () => {
  assert.deepEqual(selectableCategories(categories, 'income').map((category) => category.name), ['salary', 'shared']);
  assert.deepEqual(selectableCategories(categories, 'expense').map((category) => category.name), ['groceries', 'shared']);
  assert.equal(categoryAppliesTo(categories[2], 'expense'), false);
});

test('type changes retain only an explicitly compatible selection', () => {
  assert.equal(reconcileCategorySelection(categories, 'expense', 1), null);
  assert.equal(reconcileCategorySelection(categories, 'income', 2), null);
  assert.equal(reconcileCategorySelection(categories, 'income', 4), 4);
  assert.equal(reconcileCategorySelection(categories, 'expense', 4), 4);
});

test('uncategorized selection stays supported and empty catalogues fail closed', () => {
  assert.equal(reconcileCategorySelection(categories, 'income', null), null);
  assert.equal(reconcileCategorySelection([], 'expense', 2), null);
  assert.deepEqual(selectableCategories([], 'income'), []);
});

test('an existing legacy category remains readable but cannot become a new assignment', () => {
  assert.deepEqual(
    categoryOptionsForEditor(categories, 'expense', 3, 3, 'expense').map((category) => category.name),
    ['anomaly', 'groceries', 'shared'],
  );
  assert.equal(isCategorySelectionAllowed(categories, 'expense', 3, 3, 'expense'), true);
  assert.equal(isCategorySelectionAllowed(categories, 'income', 3, 3, 'expense'), false);
  assert.equal(isCategorySelectionAllowed(categories, 'expense', 3, null, null), false);
  assert.equal(isCategorySelectionAllowed(categories, 'income', null, null, null), true);
});
