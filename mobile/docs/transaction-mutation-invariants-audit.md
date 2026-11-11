# Transaction Mutation Invariants Audit

## Scope and evidence

This audit records the mobile income/expense mutation invariants established through Phase 2 and preserved by the Phase 3 work. Evidence comes from `repositories/transactions-core.ts`, the schema and migration chain, `transaction-validation.test.ts`, and the in-memory repository suite. Static structure is not treated as runtime proof. On October 21, 2026, `npm test` from `mobile/` passed 146 host-side tests with 0 failures; this does not establish Expo SQLite device parity.

## Invariant matrix

| Operation or invariant | Actual implementation | Test evidence | Status | Risk or next action |
| --- | --- | --- | --- | --- |
| Create income/expense | Complete input is validated; income is stored positive and expense negative; row and balance writes share one Drizzle transaction. | Happy-path integration tests verify both signs and exact balances. | **PASS** | Preserve the signed-storage rule. |
| Input type and amount | Shared validation accepts income/expense and positive whole PKR through 2,147,483,647. Transfer, signed, fractional, malformed, zero, and excessive inputs reject before writes. | Unit boundaries and repository non-mutation tests pass. | **PASS** | SQLite still lacks type/sign `CHECK` constraints. |
| Canonical date | Shared validation requires a calendar-valid canonical UTC ISO timestamp. | Leap-year, impossible-date, malformed-format, create, and update non-mutation tests pass. | **PASS** | Reporting timezone remains a separate policy decision. |
| Account ownership on create | Selected account lookup requires account ID plus configured user ID. | Foreign-account create rejects without row or balance changes. | **PASS** | No composite SQL ownership constraint exists. |
| Existing-account ownership on update/delete | Both paths validate the current transaction account belongs to the configured user before any effect reversal. | Deliberately inconsistent rows reject with complete snapshots unchanged. | **PASS** | Preserve guard ordering. |
| Edit amount/type effect | Update reverses the old stored effect, replaces the row, and applies the newly derived effect atomically. | Expense-to-income and income-to-expense tests verify exact balances. | **PASS** | Transfers are separately blocked. |
| Edit across accounts | Old account effect is reversed and the new account effect applied. | Happy path and overdraft movement cases verify both balances. | **PASS** | Preserve atomic transaction boundary. |
| Delete income/expense | Row deletion and exact stored-effect reversal share one transaction. | Happy-path deletion verifies absence and exact balance reversal. | **PASS** | Repeated deletion retains normal not-found behavior. |
| Create rollback | Insert followed by a forced balance-update failure rolls back fully. | Trigger test proves no transaction row and unchanged account balance. | **PASS** | Proven on better-sqlite3, not Expo SQLite. |
| Update rollback | A trigger aborts after the old account effect is reversed. | Complete transaction and both account snapshots are restored. | **PASS** | Proven on better-sqlite3, not Expo SQLite. |
| Delete rollback | A trigger aborts the balance reversal after row deletion. | Complete transaction/account snapshots are restored. | **PASS** | Proven on better-sqlite3, not Expo SQLite. |
| Overdraft policy | Repository calculates projection from current balances inside the transaction. Confirmation is bound to exact account ID and projection; stale confirmation rejects. | Create, same-account update, moved-expense, exact-confirmation, stale-confirmation, and snapshot tests pass. | **PASS** | React Native Alert interactions lack component tests. |
| Overdraft API/UI | Local API preserves typed error details. Add/edit UI identifies account/projection, provides Cancel/Confirm, disables duplicate submission, and retries with the exact token. | Type-check/lint plus repository contract tests; no component harness. | **PARTIAL** | Add component coverage when React Native test infrastructure exists. |
| Legacy transfer update/delete | Existing transfer rows are loaded and ownership-checked, then rejected before any row or balance write. | Direct legacy fixtures prove update/delete rejection and complete snapshot equality. | **PASS** | Full transfer support remains deferred. |
| Category existence | Positive ID or null is accepted; SQLite FK enforcement rejects nonexistent IDs when enabled. | Contract smoke tests prove FK enforcement generally; no category-specific repository mutation test. | **PARTIAL** | Add focused tests if this becomes a Phase 2 mutation requirement. |
| Category applicability | No authoritative type field or constraint exists; UI parent filtering is not repository policy. | No mismatch test can be authoritative under the current model. | **MISSING** | Await the documented category policy decision. |
| Client ID idempotency | The current mobile create flow requires a non-empty client request ID. Identical reuse returns the existing row without a second balance effect; conflicting or cross-user reuse rejects. | Replay, conflict, rollback retry, overdraft replay, and same-tick duplicate tests pass. | **PASS FOR CURRENT MOBILE CREATE FLOW** | This does not define cross-device synchronization or idempotency for the separate web API. |
| Hard deletion | No soft-delete field exists; supported deletion physically removes the row. | Happy-path and rollback tests cover hard deletion. | **NOT APPLICABLE** | Soft deletion is explicitly future scope. |

## Confirmed mutation flow

### Create

1. Validate date, positive amount, type, IDs, and text fields.
2. Derive the signed effect.
3. Begin a synchronous SQLite transaction.
4. Load the owned account and current balance.
5. Require exact overdraft confirmation when the projected expense balance is negative.
6. Insert the transaction and update the account balance.
7. Commit and reload.

### Update

1. Validate the complete replacement input.
2. Begin a transaction and load the user-scoped existing row.
3. Verify current-account ownership.
4. Reject a legacy transfer.
5. Load the owned replacement account and calculate the authoritative projection, accounting for the old effect when the account is unchanged.
6. Require exact overdraft confirmation when necessary.
7. Reverse the old effect, replace the row, and apply the new effect atomically.

### Delete

1. Begin a transaction and load the user-scoped row.
2. Verify current-account ownership.
3. Reject a legacy transfer.
4. Delete the supported income/expense row and reverse its stored effect atomically.

## Remaining decisions and limitations

- Category applicability has no approved authoritative representation.
- Mobile create idempotency is defined and tested; cross-device synchronization and a corresponding web API contract remain undefined.
- SQLite type/sign constraints require a reviewed migration and legacy-data policy.
- Ubuntu/Node 22 and Expo SQLite device/emulator parity remain unverified.
- React Native overdraft dialog behavior lacks automated component tests.
- Transfer creation and equal/opposite effects require a future schema design; current legacy transfers are intentionally read-only.
