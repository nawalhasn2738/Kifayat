import type { CatalogCategory } from '@/lib/repositories/catalog-core';

export type SelectableTransactionType = 'income' | 'expense';

export function categoryAppliesTo(
  category: CatalogCategory,
  transactionType: SelectableTransactionType,
) {
  return category.applicableTransactionTypes.includes(transactionType);
}

export function selectableCategories(
  categories: readonly CatalogCategory[],
  transactionType: SelectableTransactionType,
) {
  return categories.filter((category) => categoryAppliesTo(category, transactionType));
}

export function reconcileCategorySelection(
  categories: readonly CatalogCategory[],
  transactionType: SelectableTransactionType,
  selectedCategoryId: number | null,
) {
  if (selectedCategoryId === null) return null;
  return categories.some((category) => (
    category.id === selectedCategoryId && categoryAppliesTo(category, transactionType)
  )) ? selectedCategoryId : null;
}

export function categoryOptionsForEditor(
  categories: readonly CatalogCategory[],
  transactionType: SelectableTransactionType,
  selectedCategoryId: number | null,
  originalCategoryId: number | null,
  originalTransactionType: SelectableTransactionType | null,
) {
  const selectable = selectableCategories(categories, transactionType);
  if (selectedCategoryId === null
    || selectedCategoryId !== originalCategoryId
    || transactionType !== originalTransactionType) return selectable;
  const legacyCategory = categories.find((category) => (
    category.id === selectedCategoryId && !categoryAppliesTo(category, transactionType)
  ));
  return legacyCategory ? [legacyCategory, ...selectable] : selectable;
}

export function isCategorySelectionAllowed(
  categories: readonly CatalogCategory[],
  transactionType: SelectableTransactionType,
  selectedCategoryId: number | null,
  originalCategoryId: number | null,
  originalTransactionType: SelectableTransactionType | null,
) {
  if (selectedCategoryId === null) return true;
  const category = categories.find((candidate) => candidate.id === selectedCategoryId);
  if (!category) return false;
  if (categoryAppliesTo(category, transactionType)) return true;
  return selectedCategoryId === originalCategoryId && transactionType === originalTransactionType;
}
