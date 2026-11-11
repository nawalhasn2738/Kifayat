import { eq } from 'drizzle-orm';
import { userProfiles, users } from '@/lib/db/schema';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import type { AppDatabase } from '@/lib/db/types';
import { MAX_PKR_AMOUNT } from '@/lib/validation/transaction';

export type MissingProfileRecoveryInput = {
  monthlyIncome: unknown;
  emergencyFundTarget: unknown;
};

export type MissingProfileRecoveryResult =
  | {
    status: 'recovered';
    profile: {
      userId: number;
      monthlyIncome: number;
      emergencyFundTarget: number;
      financialHistoryStartedAt: null;
    };
  }
  | {
    status: 'rejected';
    reason: 'invalid_input';
    invalidFields: (keyof MissingProfileRecoveryInput)[];
  }
  | { status: 'rejected'; reason: 'user_not_found' }
  | { status: 'rejected'; reason: 'profile_exists' }
  | { status: 'rejected'; reason: 'write_failed' };

export type MissingProfileRecoveryDependencies = {
  userId: number;
  afterProfileInsert?: () => void;
};

const productionDependencies: MissingProfileRecoveryDependencies = {
  userId: LOCAL_USER_ID,
};

function isValidProfileMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
    && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PKR_AMOUNT;
}

export function createMissingProfileRecoveryService<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: MissingProfileRecoveryDependencies = productionDependencies,
) {
  async function recoverMissingProfile(
    input: MissingProfileRecoveryInput,
  ): Promise<MissingProfileRecoveryResult> {
    const invalidFields: (keyof MissingProfileRecoveryInput)[] = [];
    if (!isValidProfileMoney(input?.monthlyIncome)) invalidFields.push('monthlyIncome');
    if (!isValidProfileMoney(input?.emergencyFundTarget)) invalidFields.push('emergencyFundTarget');
    if (invalidFields.length) return { status: 'rejected', reason: 'invalid_input', invalidFields };

    try {
      return database.transaction((tx) => {
        const user = tx.select({ id: users.id }).from(users)
          .where(eq(users.id, dependencies.userId)).limit(1).get();
        if (!user) return { status: 'rejected', reason: 'user_not_found' } as const;

        const existingProfile = tx.select({ id: userProfiles.id }).from(userProfiles)
          .where(eq(userProfiles.userId, dependencies.userId)).limit(1).get();
        if (existingProfile) return { status: 'rejected', reason: 'profile_exists' } as const;

        tx.insert(userProfiles).values({
          userId: dependencies.userId,
          monthlyIncome: input.monthlyIncome as number,
          emergencyFundTarget: input.emergencyFundTarget as number,
          financialHistoryStartedAt: null,
        }).run();
        dependencies.afterProfileInsert?.();

        return {
          status: 'recovered',
          profile: {
            userId: dependencies.userId,
            monthlyIncome: input.monthlyIncome as number,
            emergencyFundTarget: input.emergencyFundTarget as number,
            financialHistoryStartedAt: null,
          },
        } as const;
      });
    } catch {
      try {
        const [existingProfile] = await database.select({ id: userProfiles.id }).from(userProfiles)
          .where(eq(userProfiles.userId, dependencies.userId)).limit(1);
        if (existingProfile) return { status: 'rejected', reason: 'profile_exists' };
      } catch {
        return { status: 'rejected', reason: 'write_failed' };
      }
      return { status: 'rejected', reason: 'write_failed' };
    }
  }

  return { recoverMissingProfile };
}
