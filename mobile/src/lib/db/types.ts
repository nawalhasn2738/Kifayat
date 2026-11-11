import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

export type AppDatabase<TRunResult> = BaseSQLiteDatabase<'sync', TRunResult, typeof schema>;
