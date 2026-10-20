# Kifayat SQLite Integration Test Plan

## 1. Purpose and status

Kifayat uses three complementary layers:

1. Database-contract smoke tests against the checked-in migration.
2. Repository integration tests through Drizzle and an injected in-memory database.
3. Expo SQLite device/emulator tests through the production runtime.

Layers 1 and 2 are active on the current Windows environment. Layer 3 remains unverified. On October 20, 2026, `npm test` from `mobile/` passed 146 host-side tests with 0 failures. This does not prove CI portability or Expo SQLite emulator/device parity.

## 2. Current evidence

### Verified on Windows x64 / Node.js 24.14.0 / npm 11.9.0

- `better-sqlite3` is pinned to 12.11.1 in the mobile development dependencies and lockfile.
- The native driver loads and supports in-memory read/write and forced rollback.
- The exact migration applies using `--> statement-breakpoint` markers.
- `drizzle-orm/better-sqlite3` initializes with Drizzle 0.45.4 and the Kifayat schema.
- Node `node:sqlite` contract tests verify migration objects, foreign-key enforcement, invalid-reference rejection, and raw rollback using fresh in-memory databases.
- Catalog and transaction cores have been exercised through injected Drizzle databases.
- Catalog tests cover account/profile/category scope and ordering plus read-only reconciliation.
- Transaction tests cover signs, create/update/delete balance effects, account movement, ownership, rejection safety, overdraft confirmation/staleness, legacy-transfer guards, and forced rollback for all three mutations.
- Production wrappers continue using the Expo-backed singleton.
- Chat has an injectable core, and seed uses the shared driver-neutral database type with a synchronous transaction callback; neither currently has integration coverage.
- `npm test` reports 146 passed and 0 failed. Typecheck and lint pass.

The test command is `tsx --test --test-isolation=none tests/**/*.test.ts tests/**/*.test.mjs`. Disabling isolation is the local workaround for observed `spawn EPERM`; it is not evidence of CI portability.

### Not yet verified

- Ubuntu x64 / Node 22 installation, native loading, or execution.
- Cross-platform mobile CI.
- Expo SQLite device/emulator migration and repository parity.
- Seed success and rollback behavior.
- Chat repository behavior and its unresolved message-ownership risk.
- React Native overdraft dialog interactions through a component test harness.

## 3. Layered strategy

| Layer | Runtime | Purpose | Status |
| --- | --- | --- | --- |
| Database contract | `node:sqlite` | Migration, objects, constraints, foreign keys, raw rollback | **Verified on Windows/Node 24** |
| Repository integration | better-sqlite3 12.11.1 + Drizzle | Injected catalog/transaction operations and rollback against fresh in-memory databases | **Verified on Windows/Node 24; Linux gate outstanding** |
| Production parity | Expo SQLite device/emulator | Production driver/runtime behavior | **Not verified** |

`node:sqlite` emits an experimental warning locally and does not exercise repository code. better-sqlite3 coverage does not prove Expo SQLite behavior.

## 4. Injection design and safe lifecycle

```text
production consumer -> wrapper -> injectable core -> Expo singleton -> kifayat.db
integration test     -> injectable core -> Drizzle better-sqlite3 -> :memory:
```

The shared `AppDatabase` type is schema-aware and driver-neutral. Repository cores do not import the production client, Expo SQLite, or better-sqlite3. Every database test creates a fresh in-memory database, enables and asserts foreign keys, applies the checked-in migration, uses synthetic fixtures, and closes the connection in `finally`.

## 5. Test matrix

| Area | Case | Actual status |
| --- | --- | --- |
| Migration | Exact migration applies; expected tables/indexes exist | **Verified: contract smoke** |
| Integrity | Foreign keys enabled; invalid reference rejected | **Verified: contract smoke** |
| Raw rollback | Write followed by failure rolls back | **Verified: contract smoke** |
| Catalog | Account/profile/category shape, scope, order | **Verified: repository integration** |
| Reconciliation | Signed effects, no activity, discrepancy, user scope, read-only behavior | **Verified: repository integration** |
| Transaction | Income/expense create and signed balance effects | **Verified: repository integration** |
| Transaction | Update reverses old and applies replacement effect | **Verified: repository integration** |
| Transaction | Delete reverses stored effect | **Verified: repository integration** |
| Transaction rollback | Forced create/update/delete failures restore rows and balances | **Verified: repository integration** |
| Ownership | Foreign and inconsistent account ownership rejects without writes | **Verified: repository integration** |
| Validation | PKR boundaries, dates, supported types, rejection non-mutation | **Verified** |
| Overdraft | Reject, exact confirm, stale confirm, same/moved account | **Verified at repository level; UI component coverage absent** |
| Legacy transfer | Update/delete reject without writes | **Verified: repository integration** |
| Chat | Conversation/message operations | **Ready architecturally; not tested** |
| Seed | Expected rows and rollback | **Ready architecturally; not tested** |
| Expo | Migration and representative operations | **Not verified** |
| Full transfer | Equal/opposite account movement | **Deferred: representation not implemented** |

## 6. Next implementation order

1. Keep the Windows contract and repository suite as the fast baseline.
2. Validate the pinned lockfile and suite on Ubuntu x64 / Node 22 before relying on it in CI.
3. Add mobile checks to CI after the Linux gate succeeds.
4. Add seed and chat integration coverage, including seed rollback and chat ownership behavior.
5. Add React Native component tests for the overdraft dialog when a suitable harness is approved.
6. Add Expo SQLite device/emulator parity tests for migrations and representative repository operations.
7. Add later financial-rule cases only after their policies and schema designs are approved.

## 7. Known limitations and risks

- Windows native-driver success is not Linux evidence.
- Expo SQLite may differ from host SQLite.
- Disabled test isolation requires avoiding shared global state.
- Repository tests currently cover catalog and transaction cores, not chat or seed.
- UI overdraft behavior is statically verified and type-checked but not component-tested.
- Category applicability remains a policy decision. The `Asia/Karachi` reporting timezone and forecast-readiness contract are approved and implemented in the host-tested service path. Mobile transaction creation idempotency is implemented for client request IDs; cross-device synchronization and an equivalent contract for the separate web API remain undefined.
- Transfers, opening-balance migrations, refunds, signed formatting, history-start UI, and device qualification remain later work. Mobile savings use income minus expenses and exclude transfers.
- Chat message listing/saving lacks independent conversation-ownership validation.

## 8. Acceptance gates

- [x] Contract smoke tests cover migration objects, foreign keys, and raw rollback.
- [x] Windows/Node 24 validates better-sqlite3 12.11.1, migration, rollback, and Drizzle.
- [x] Catalog, transaction, and chat cores accept injected databases.
- [x] Production wrappers remain Expo-backed.
- [x] Catalog repository behavior and reconciliation pass in memory.
- [x] Supported transaction behavior and create/update/delete rollback pass in memory.
- [x] Overdraft repository contract and legacy-transfer guards pass in memory.
- [x] Current host-side baseline reports 146 passing tests; typecheck and lint pass.
- [ ] Ubuntu/Node 22 installation, native loading, and suite execution pass.
- [ ] Cross-platform mobile CI is configured and passing.
- [ ] Seed and chat integration/rollback coverage passes.
- [ ] React Native overdraft component coverage exists.
- [ ] Expo SQLite device/emulator parity passes.

## 9. Deferred cases

Full transfer behavior, opening-balance migration, category applicability, cross-device synchronization, refunds, pending/deleted semantics, signed formatting, history-start UI, health-score refinements, and chat ownership remain explicitly deferred. Mobile income-minus-expense savings, transfer exclusion, client-request-ID creation idempotency, and forecast readiness are implemented in host-tested service paths; their web equivalents are not implied. Host-side coverage does not establish Expo SQLite device behavior.
