import { db } from '@/lib/db/client';
import { createMissingProfileRecoveryService } from '@/lib/services/history-start-recovery-core';

const missingProfileRecoveryService = createMissingProfileRecoveryService(db);

export const { recoverMissingProfile } = missingProfileRecoveryService;
