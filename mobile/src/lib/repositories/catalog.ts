import { db } from '@/lib/db/client';
import { createCatalogRepository } from '@/lib/repositories/catalog-core';

const catalogRepository = createCatalogRepository(db);

export const { listAccounts, listActiveAccounts, listCategories, getProfile, reconcileAccountBalances } = catalogRepository;
