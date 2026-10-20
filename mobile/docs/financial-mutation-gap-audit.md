# Financial Mutation Gap Audit

## Scope

This audit began as a Phase 1 record and has been reconciled with the current mobile implementation. On October 20, 2026, `npm test` from `mobile/` passed 146 host-side tests with 0 failures. Passing Node SQLite and better-sqlite3 tests do not imply complete UI coverage, CI portability, or Expo SQLite device parity.

## Status matrix

| # | Rule | Status | Current evidence and remaining gap |
| --- | --- | --- | --- |
| 1 | PKR-only whole-rupee input; reject decimals | **IMPLEMENTED AND TESTED** | Shared strict raw parsing is used for transaction and affordability inputs. Maximum PKR 2,147,483,647 and malformed/boundary cases are tested without truncation. |
| 2 | Positive input and income/expense signs | **IMPLEMENTED AND TESTED** | Zod accepts positive income/expense input only; repository derives stored signs. Create and both type-change directions are tested. |
| 3 | Valid transaction dates | **IMPLEMENTED AND TESTED** | Canonical UTC ISO timestamps are calendar-validated. Impossible, malformed, leap-year, create, and update cases are tested. Reporting timezone is still deferred. |
| 4 | Balance reconciliation and opening balances | **PARTIALLY IMPLEMENTED** | Read-only, user-scoped reconciliation reports stored balance, effect total, candidate opening balance, and discrepancy without writes. No explicit opening-balance field or migration exists. |
| 5 | Atomic transfers | **DEFERRED** | Current schema cannot represent paired effects. New transfer mutations reject; legacy transfer update/delete also reject without writes. Representation and migration remain future work. |
| 6 | Explicit overdraft confirmation | **IMPLEMENTED; UI TEST COVERAGE INCOMPLETE** | Repository rechecks authoritative projection inside its transaction and binds confirmation to exact account/projection. API/UI supports Cancel, Confirm, stale re-prompt, and duplicate prevention. Repository tests pass; Alert interactions lack component tests. |
| 7 | Savings equals income minus expenses | **IMPLEMENTED AND TESTED** | The mobile finance service calculates income minus expenses and excludes transfers. Forecast readiness separately zero-fills qualifying empty history months. The legacy web helper still derives its separate savings figure from negative transfers. |
| 8 | Refund handling | **DEFERRED** | Refunds are explicitly unsupported and have no mutation path. Future linkage and reporting policy remain undefined. |
| 9 | Three complete forecast months and empty-month handling | **IMPLEMENTED AND HOST-TESTED; UI INCOMPLETE** | The readiness service uses the three immediately preceding complete Karachi months, zero-fills qualifying post-start empty months, excludes the partial current month, and returns `forecast: null` with stable reasons when unavailable. Users still lack the history-start confirmation/correction/recovery UI needed to make the workflow usable end to end. |
| 10 | Safe income/expense deletion | **IMPLEMENTED AND TESTED** | UI confirms deletion; repository hard-deletes and reverses the stored effect atomically. Forced failure proves rollback. Legacy transfers reject. |
| 11 | Ownership and cross-user isolation | **IMPLEMENTED AND TESTED** | Create, update, and delete enforce owned accounts; inconsistent legacy rows reject before effects. |
| 12 | Category validity | **POLICY DECISION REQUIRED** | FK supports existence, but no authoritative applicability field exists. UI `parent` conventions are not repository policy. |
| 13 | Mutation rollback | **IMPLEMENTED AND TESTED** | Deterministic create, update, and delete failures prove complete rollback in the Windows better-sqlite3 environment. Seed rollback remains untested. |
| 14 | Signed formatting | **NOT IMPLEMENTED** | Shared formatter still applies `Math.abs`; signed presentation requires later correction. |
| 15 | Idempotent transaction creation | **IMPLEMENTED AND TESTED FOR THE CURRENT MOBILE CREATE FLOW** | A non-empty client request ID identifies the create attempt. Identical reuse returns the existing row without another balance effect; conflicting or cross-user reuse rejects. Cross-device synchronization and the separate web API remain outside this contract. |
| 16 | Chat conversation ownership | **NOT IMPLEMENTED** | Message read/write still does not independently validate conversation ownership; this remains separate security work. |

## Completed Phase 1 foundation

- Database-contract smoke tests apply the exact migration and verify objects, foreign keys, and raw rollback.
- Drizzle repository tests run against fresh better-sqlite3 in-memory databases.
- Catalog and transaction cores are injectable; production wrappers remain Expo-backed.
- Supported income/expense create, update, delete, ownership, sign, overdraft, and rollback behavior is covered.
- Read-only reconciliation is implemented and tested.
- Unsupported new transfer mutations and legacy transfer update/delete operations reject without writes.
- Strict PKR amount and canonical transaction-date validation are shared and tested.

## Highest remaining risks

1. History-start and forecast-readiness services are implemented, but their user-facing confirmation/correction/recovery workflow and Expo SQLite device verification remain incomplete.
2. Category applicability has no approved authoritative model.
3. Opening balances and database constraints require reviewed migrations and legacy-data handling.
4. Mobile create idempotency is implemented, but cross-device synchronization and any equivalent web API contract remain undefined.
5. Cross-platform CI and Expo runtime parity remain unverified.

## Sequenced future roadmap

### 1. Approve category applicability and broader synchronization policies

Define authoritative category typing and any cross-device synchronization identity. Preserve the implemented mobile client-request-ID create contract.

### 2. Design transfers and opening-balance migrations

Choose a paired-leg or dedicated transfer model, classify legacy data, preserve stored balances, and use reconciliation evidence before migration.

### 3. Complete history-start UI and signed formatting

Expose the implemented history-start workflow without weakening the three-complete-month, empty-month, and `forecast: null` contract. Then correct signed balance and availability presentation under a separately approved formatting policy.

### 4. Expand integration and platform verification

Add seed/chat coverage, React Native component tests, Ubuntu/Node 22 execution, CI, and Expo SQLite device/emulator parity.

### 5. Address separate security and future-feature work

Enforce chat conversation ownership; later specify refunds, pending states, soft deletion, and other explicitly unsupported features.

## Next recommended action

For Phase 3, approve the reporting timezone and forecast-history contract before changing calendar windows. Keep transfers, opening balances, category applicability, refunds, and broader synchronization behavior unresolved until their separate policies and migration risks are reviewed.
