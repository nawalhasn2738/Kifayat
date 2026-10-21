import { db } from '@/lib/db/client';
import { createOpeningBalanceRepository } from './opening-balances-core';

const repository = createOpeningBalanceRepository(db);
export const { getState: getOpeningBalanceState, confirm: confirmOpeningBalance,
  correct: correctOpeningBalance, history: getOpeningBalanceHistory } = repository;
