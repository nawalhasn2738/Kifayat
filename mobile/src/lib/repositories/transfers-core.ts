import { and, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { accounts, transfers } from '@/lib/db/schema';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import type { AppDatabase } from '@/lib/db/types';
import type { TransferInput } from '@/lib/validation/transfer';
import { validatePersistedTransfer, validateTransferInput } from '@/lib/validation/transfer';

export type TransferRepositoryDependencies = {
  userId: number;
  now: () => Date;
};

export type Transfer = {
  id: number;
  clientId: string;
  date: string;
  amount: number;
  description: string | null;
  sourceAccount: { id: number; name: string; type: string };
  destinationAccount: { id: number; name: string; type: string };
};

const productionDependencies: TransferRepositoryDependencies = {
  userId: LOCAL_USER_ID,
  now: () => new Date(),
};

function checkedAdd(value: number, effect: number) {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(effect)) throw new Error('Transfer balances require safe integer monetary values.');
  const result = value + effect;
  if (!Number.isSafeInteger(result)) throw new Error('Transfer balances require safe integer monetary values.');
  return result;
}

export function createTransferRepository<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: TransferRepositoryDependencies = productionDependencies,
) {
  function selectBase() {
    const source = alias(accounts, 'source_accounts');
    const destination = alias(accounts, 'destination_accounts');
    return database.select({
      id: transfers.id, clientId: transfers.clientId, userId: transfers.userId,
      date: transfers.date, amount: transfers.amount, description: transfers.description,
      sourceAccountId: transfers.sourceAccountId,
      destinationAccountId: transfers.destinationAccountId,
      sourceAccountUserId: source.userId,
      destinationAccountUserId: destination.userId,
      sourceAccountName: source.name, sourceAccountType: source.type,
      destinationAccountName: destination.name, destinationAccountType: destination.type,
    }).from(transfers)
      .innerJoin(source, eq(transfers.sourceAccountId, source.id))
      .innerJoin(destination, eq(transfers.destinationAccountId, destination.id));
  }

  type Selected = Awaited<ReturnType<typeof selectBase>>[number];
  const mapTransfer = (row: Selected): Transfer => {
    validatePersistedTransfer(row);
    if (row.userId !== dependencies.userId || row.sourceAccountUserId !== row.userId
      || row.destinationAccountUserId !== row.userId) throw new Error(`Invalid persisted transfer ${row.id}.`);
    return {
      id: row.id, clientId: row.clientId, date: row.date, amount: row.amount,
      description: row.description,
      sourceAccount: { id: row.sourceAccountId, name: row.sourceAccountName, type: row.sourceAccountType },
      destinationAccount: { id: row.destinationAccountId, name: row.destinationAccountName, type: row.destinationAccountType },
    };
  };

  async function getTransfer(id: number) {
    const [row] = await selectBase().where(and(eq(transfers.id, id), eq(transfers.userId, dependencies.userId))).limit(1);
    return row ? mapTransfer(row) : null;
  }

  async function listTransfers() {
    return (await selectBase().where(eq(transfers.userId, dependencies.userId))
      .orderBy(desc(transfers.date), desc(transfers.id))).map(mapTransfer);
  }

  function ownedAccounts(tx: Parameters<Parameters<typeof database.transaction>[0]>[0], ids: number[]) {
    const rows = tx.select().from(accounts).where(and(
      inArray(accounts.id, ids),
      eq(accounts.userId, dependencies.userId),
    )).all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (ids.some((id) => !byId.has(id))) throw new Error('A selected transfer account does not exist.');
    return byId;
  }

  function calculateEffects(
    balances: Map<number, number>,
    effects: [number, number][],
  ) {
    const result = new Map(balances);
    for (const [accountId, effect] of effects) {
      result.set(accountId, checkedAdd(result.get(accountId)!, effect));
    }
    return result;
  }

  function writeBalances(tx: Parameters<Parameters<typeof database.transaction>[0]>[0], balances: Map<number, number>) {
    for (const [accountId, balance] of balances) {
      tx.update(accounts).set({ balance }).where(and(
        eq(accounts.id, accountId), eq(accounts.userId, dependencies.userId),
      )).run();
    }
  }

  async function createTransfer(raw: TransferInput, clientId: string) {
    const input = validateTransferInput(raw);
    if (!clientId.trim()) throw new Error('A transfer request ID is required.');
    if (new Date(input.date).getTime() > dependencies.now().getTime()) throw new Error('Future-dated transfers are not supported.');
    const id = database.transaction((tx) => {
      const accountRows = ownedAccounts(tx, [input.sourceAccountId, input.destinationAccountId]);
      const [existing] = tx.select().from(transfers).where(and(
        eq(transfers.userId, dependencies.userId), eq(transfers.clientId, clientId),
      )).limit(1).all();
      if (existing) {
        validatePersistedTransfer(existing);
        const identical = existing.sourceAccountId === input.sourceAccountId
          && existing.destinationAccountId === input.destinationAccountId
          && existing.amount === input.amount && existing.date === input.date
          && existing.description === (input.description || null);
        if (!identical) throw new Error('This transfer request ID was already used with different details.');
        return existing.id;
      }
      const source = accountRows.get(input.sourceAccountId)!;
      const destination = accountRows.get(input.destinationAccountId)!;
      if (source.archivedAt !== null || destination.archivedAt !== null) {
        throw new Error('Archived accounts cannot be used for new transfers.');
      }
      const sourceBalance = checkedAdd(source.balance, -input.amount);
      if (sourceBalance < 0) throw new Error('The source account has insufficient funds.');
      const destinationBalance = checkedAdd(destination.balance, input.amount);
      const [created] = tx.insert(transfers).values({
        clientId, userId: dependencies.userId,
        sourceAccountId: input.sourceAccountId, destinationAccountId: input.destinationAccountId,
        amount: input.amount, date: input.date, description: input.description || null,
      }).returning({ id: transfers.id }).all();
      writeBalances(tx, new Map([
        [source.id, sourceBalance], [destination.id, destinationBalance],
      ]));
      return created.id;
    });
    const created = await getTransfer(id);
    if (!created) throw new Error('Transfer was saved but could not be reloaded.');
    return created;
  }

  async function updateTransfer(id: number, raw: TransferInput) {
    const input = validateTransferInput(raw);
    database.transaction((tx) => {
      const [existing] = tx.select().from(transfers).where(and(
        eq(transfers.id, id), eq(transfers.userId, dependencies.userId),
      )).limit(1).all();
      if (!existing) throw new Error('Transfer not found.');
      validatePersistedTransfer(existing);
      if (new Date(input.date).getTime() > dependencies.now().getTime() && input.date !== existing.date) {
        throw new Error('Future-dated transfers are not supported.');
      }
      const ids = [...new Set([
        existing.sourceAccountId, existing.destinationAccountId,
        input.sourceAccountId, input.destinationAccountId,
      ])];
      const rows = ownedAccounts(tx, ids);
      if ((input.sourceAccountId !== existing.sourceAccountId && rows.get(input.sourceAccountId)!.archivedAt !== null)
        || (input.destinationAccountId !== existing.destinationAccountId
          && rows.get(input.destinationAccountId)!.archivedAt !== null)) {
        throw new Error('Archived accounts cannot receive reassigned transfers.');
      }
      const balances = new Map([...rows].map(([accountId, account]) => [accountId, account.balance]));
      const proposedBalances = calculateEffects(balances, [
        [existing.sourceAccountId, existing.amount],
        [existing.destinationAccountId, -existing.amount],
        [input.sourceAccountId, -input.amount],
        [input.destinationAccountId, input.amount],
      ]);
      if (proposedBalances.get(input.sourceAccountId)! < 0) throw new Error('The source account has insufficient funds.');
      writeBalances(tx, proposedBalances);
      tx.update(transfers).set({
        sourceAccountId: input.sourceAccountId, destinationAccountId: input.destinationAccountId,
        amount: input.amount, date: input.date, description: input.description || null,
        updatedAt: dependencies.now().toISOString(),
      }).where(and(eq(transfers.id, id), eq(transfers.userId, dependencies.userId))).run();
    });
    return getTransfer(id);
  }

  async function deleteTransfer(id: number) {
    database.transaction((tx) => {
      const [existing] = tx.select().from(transfers).where(and(
        eq(transfers.id, id), eq(transfers.userId, dependencies.userId),
      )).limit(1).all();
      if (!existing) throw new Error('Transfer not found.');
      validatePersistedTransfer(existing);
      const rows = ownedAccounts(tx, [existing.sourceAccountId, existing.destinationAccountId]);
      const balances = new Map([...rows].map(([accountId, account]) => [accountId, account.balance]));
      const proposedBalances = calculateEffects(balances, [
        [existing.sourceAccountId, existing.amount],
        [existing.destinationAccountId, -existing.amount],
      ]);
      writeBalances(tx, proposedBalances);
      tx.delete(transfers).where(and(eq(transfers.id, id), eq(transfers.userId, dependencies.userId))).run();
    });
  }

  return { createTransfer, updateTransfer, deleteTransfer, getTransfer, listTransfers };
}
