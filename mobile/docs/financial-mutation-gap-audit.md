# Financial Mutation Gap Audit

## Scope

This audit distinguishes completed Phase 1 safety work from later financial features. Evidence is based on current source and the Windows x64 / Node 24.14.0 / npm 11.9.0 baseline of 32 passing tests. Passing tests do not imply complete coverage, Linux portability, or Expo SQLite parity.

## Status matrix

| # | Rule | Status | Current evidence and remaining gap |
| --- | --- | --- | --- |
| 1 | PKR-only whole-rupee input; reject decimals | **IMPLEMENTED AND TESTED** | Shared strict raw parsing is used for transaction and affordability inputs. Maximum PKR 2,147,483,647 and malformed/boundary cases are tested without truncation. |
| 2 | Positive input and income/expense signs | **IMPLEMENTED AND TESTED** | Zod accepts positive income/expense input only; repository derives stored signs. Create and both type-change directions are tested. |
| 3 | Valid transaction dates | **IMPLEMENTED AND TESTED** | Canonical UTC ISO timestamps are calendar-validated. Impossible, malformed, leap-year, create, and update cases are tested. Reporting timezone is still deferred. |
| 4 | Balance reconciliation and opening balances | **PARTIALLY IMPLEMENTED** | Read-only, user-scoped reconciliation reports stored balance, effect total, candidate opening balance, and discrepancy without writes. No explicit opening-balance field or migration exists. |
| 5 | Atomic transfers | **DEFERRED** | Current schema cannot represent paired effects. New transfer mutations reject; legacy transfer update/delete also reject without writes. Representation and migration remain future work. |
| 6 | Explicit overdraft confirmation | **IMPLEMENTED; UI TEST COVERAGE INCOMPLETE** | Repository rechecks authoritative projection inside its transaction and binds confirmation to exact account/projection. API/UI supports Cancel, Confirm, stale re-prompt, and duplicate prevention. Repository tests pass; Alert interactions lack component tests. |
| 7 | Savings equals income minus expenses | **NOT IMPLEMENTED** | Finance service still derives savings from negative transfer rows. Correct reporting belongs to a later calculation phase. |
| 8 | Refund handling | **DEFERRED** | Refunds are explicitly unsupported and have no mutation path. Future linkage and reporting policy remain undefined. |
| 9 | Three complete forecast months and empty-month handling | **NOT IMPLEMENTED** | Current service uses populated buckets and may include the current month; no insufficient-history result exists. Reporting timezone must be approved first. |
| 10 | Safe income/expense deletion | **IMPLEMENTED AND TESTED** | UI confirms deletion; repository hard-deletes and reverses the stored effect atomically. Forced failure proves rollback. Legacy transfers reject. |
| 11 | Ownership and cross-user isolation | **IMPLEMENTED AND TESTED** | Create, update, and delete enforce owned accounts; inconsistent legacy rows reject before effects. |
| 12 | Category validity | **POLICY DECISION REQUIRED** | FK supports existence, but no authoritative applicability field exists. UI `parent` conventions are not repository policy. |
| 13 | Mutation rollback | **IMPLEMENTED AND TESTED** | Deterministic create, update, and delete failures prove complete rollback in the Windows better-sqlite3 environment. Seed rollback remains untested. |
| 14 | Signed formatting | **NOT IMPLEMENTED** | Shared formatter still applies `Math.abs`; signed presentation requires later correction. |
| 15 | Idempotent retries | **POLICY DECISION REQUIRED** | Unique generated client IDs do not provide stable retry identity. |
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

1. Savings and forecast outputs do not yet implement the approved reporting rules.
2. Category applicability has no approved authoritative model.
3. Opening balances and database constraints require reviewed migrations and legacy-data handling.
4. Stable retry/idempotency semantics remain undefined.
5. Cross-platform CI and Expo runtime parity remain unverified.

## Sequenced future roadmap

### 1. Approve category applicability and idempotency policies

Define authoritative category typing and a stable retry identity before enforcement or migration.

### 2. Design transfers and opening-balance migrations

Choose a paired-leg or dedicated transfer model, classify legacy data, preserve stored balances, and use reconciliation evidence before migration.

### 3. Correct savings, signed formatting, and reporting windows

After approving a reporting timezone, implement income-minus-expense savings, transfer exclusion, three complete consecutive months, empty-month zero filling, and insufficient-history results.

### 4. Expand integration and platform verification

Add seed/chat coverage, React Native component tests, Ubuntu/Node 22 execution, CI, and Expo SQLite device/emulator parity.

### 5. Address separate security and future-feature work

Enforce chat conversation ownership; later specify refunds, pending states, soft deletion, and other explicitly unsupported features.

## Next recommended action

Perform a documentation-reviewed Phase 1 closure, then move to Phase 2 without expanding Phase 1 into transfer, opening-balance, or reporting implementation. Preserve the documented Windows-only and UI-test limitations in the handoff.
