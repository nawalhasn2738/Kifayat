import { db } from '@/lib/db/client';
import { createTransactionRepository } from '@/lib/repositories/transactions-core';

const transactionRepository = createTransactionRepository(db);

export const {
  listTransactions,
  getTransaction,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} = transactionRepository;
