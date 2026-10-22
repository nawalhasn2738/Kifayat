import { db } from '@/lib/db/client';
import { createAccountRepository } from '@/lib/repositories/accounts-core';

const repository = createAccountRepository(db);

export const {
  listManagedAccounts,
  createAccount,
  renameAccount,
  archiveAccount,
  restoreAccount,
  deleteUnusedAccount,
} = repository;
