import { listTransactionActivity } from '../repositories/transactions';
import { listTransferActivity } from '../repositories/transfers';
import { createActivityService } from './activity-core';
export const getActivity = createActivityService({ listTransactionActivity, listTransferActivity });
