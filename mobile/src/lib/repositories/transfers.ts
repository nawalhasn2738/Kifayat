import { db } from '@/lib/db/client';
import { createTransferRepository } from '@/lib/repositories/transfers-core';

const repository = createTransferRepository(db);

export const { createTransfer, updateTransfer, deleteTransfer, getTransfer, listTransfers } = repository;
