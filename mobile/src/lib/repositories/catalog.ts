import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { accounts, categories, userProfiles } from '@/lib/db/schema';

export const listAccounts = () => db.select().from(accounts).where(eq(accounts.userId, LOCAL_USER_ID)).orderBy(asc(accounts.name));
export const listCategories = () => db.select().from(categories).orderBy(asc(categories.name));
export async function getProfile() {
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, LOCAL_USER_ID)).limit(1);
  if (!profile) throw new Error('Local profile is unavailable.');
  return profile;
}
