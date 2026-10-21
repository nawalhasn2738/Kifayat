export type ActivityIdentity = { kind: 'transaction' | 'transfer'; id: number };

export function activityKey(item: ActivityIdentity) { return `${item.kind}:${item.id}`; }

export function activityDetailRoute(item: ActivityIdentity) {
  return item.kind === 'transfer'
    ? { pathname: '/transfer/[id]' as const, params: { id: String(item.id) } }
    : { pathname: '/transaction/[id]' as const, params: { id: String(item.id), from: 'Transactions' } };
}
