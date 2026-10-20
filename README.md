# Kifayat

Kifayat is a local-first personal-finance application centered on its Expo/React Native mobile client. Financial records are stored on-device with Expo SQLite and accessed through Drizzle ORM, so accounts, transactions, summaries, and planning features do not require the web API. The existing Next.js/Prisma backend remains available for server-side capabilities such as secure AI requests; private provider credentials must never be bundled into the mobile app.

Detailed mobile setup and architecture notes are available in [mobile/README.md](mobile/README.md).

## Current engineering status

Phase 0 established the protected mobile SQLite/Drizzle baseline while retaining the existing Next.js/Prisma backend. Phase 1 established the financial-rule and testing foundation. Phase 2 completed the supported financial-core reliability work:

- catalog, transaction, and chat repositories have injectable cores; production wrappers retain the Expo SQLite singleton;
- fresh in-memory SQLite tests cover generated migrations, foreign keys, transaction rollback, and repository mutations;
- income/expense creation, edits, account moves, and deletion use checked integer arithmetic and atomic balance updates;
- client request IDs make transaction creation idempotent and reject conflicting reuse;
- persisted transaction rows are validated before reporting, reconciliation, or mutation logic uses them;
- reporting retrieves complete transaction history, calculates savings as income minus expenses, and excludes transactions later than a shared report cutoff;
- affordability validates whole-month horizons from 1 through 120 and checks monetary intermediates;
- new future-dated income and expense transactions are rejected; existing legacy future rows remain preserved under the documented policy.

This is a reliability foundation for supported income and expense workflows, not a claim that every planned financial feature or production runtime environment is complete.

Phase 3 adds the approved `Asia/Karachi` reporting calendar, a nullable per-user financial-history start with confirmation/correction audit records, and forecast readiness based on the three immediately preceding complete reporting months. These capabilities are implemented and covered by host-side tests. The user-facing history-start confirmation, correction, and recovery workflow is still missing, and Expo SQLite behavior has not been verified on an emulator or physical device.

## Financial data integrity

Supported income and expense mutations currently enforce these invariants:

- user-entered PKR amounts are complete positive whole-rupee strings, capped at PKR 2,147,483,647, with no silent truncation or rounding;
- canonical UTC transaction dates and supported income/expense signs are validated at the repository boundary;
- create, update, account moves, and deletion keep transaction rows and balance effects in one SQLite transaction with checked safe-integer arithmetic;
- account ownership, idempotent request reuse, conflicting request-ID reuse, and inconsistent stored account references are rejected before unsafe mutation;
- forced-failure tests prove rollback for create, update, and delete in the host SQLite test environment;
- persisted transaction rows are validated before list/get/reporting/reconciliation use, and invalid data fails clearly without repair;
- read-only reconciliation uses checked arithmetic and reports a diagnostic candidate opening balance without automatically repairing data;
- expenses that would create a negative balance require an exact repository-generated overdraft confirmation tied to the account and projected balance; stale confirmations are rejected;
- future-dated income/expense creation and date-changing edits are rejected, while existing future rows remain preserved and may be deleted atomically;
- new transfer mutations are unsupported, and existing legacy transfer rows cannot be updated or deleted until a balanced transfer representation is implemented.

Category applicability remains an explicit policy decision. The current UI category grouping is not an authoritative repository rule.

## Testing and validation

The mobile suite uses Node's test runner through `tsx`. Database-contract smoke tests use `node:sqlite`; repository integration tests use Drizzle with `better-sqlite3@12.11.1` and `Database(':memory:')`. Tests do not open the production `kifayat.db`.

From `mobile/`:

```sh
npm install
npm test
npm run typecheck
npm run lint
npm run check
```

On October 20, 2026, running `npm test` from `mobile/` completed with 146 passing tests and 0 failures. The host-side suite covers transaction and rollback behavior, ownership, idempotency, overdraft handling, persisted-row validation, reporting calendars, migrations, financial-history state and commands, and forecast readiness. It uses Node SQLite and `better-sqlite3`; it does not prove Expo SQLite emulator/device compatibility. Mobile typecheck and lint also passed. Root/web test, typecheck, and lint commands could not run in that audit environment because the root dependencies were not installed, and no dependencies were installed to change that state.

## Repository structure

- `mobile/src/app/` — Expo Router screens and navigation.
- `mobile/src/lib/db/` — Expo SQLite client, Drizzle schema, seed logic, and shared database types.
- `mobile/src/lib/repositories/` — injectable repository cores and Expo-backed production wrappers.
- `mobile/src/lib/validation/` — authoritative transaction amount, date, type, and identifier validation.
- `mobile/src/lib/services/` — summaries, affordability, forecasts, and risk calculations.
- `mobile/drizzle/` — checked-in generated migration SQL, metadata, and bundled migration loader.
- `mobile/tests/` — validation, migration-contract, database-contract, and repository integration tests.
- `mobile/docs/` — approved financial rules, mutation audits, gap analysis, and SQLite test strategy.
- `src/`, `prisma/`, and related root files — retained Next.js/Prisma backend and server-side services.

The two applications do not share a live database. Mobile uses its app-sandboxed `kifayat.db`; web and its AI tools use the separately configured Prisma database. Cross-device synchronization and automatic import between them are not implemented.

## Development workflow

Start the mobile client:

```sh
cd mobile
npm install
npm start
```

Useful commands from the repository root include:

```sh
npm run mobile:start
npm run mobile:check
```

Database schema changes require a reviewed migration. Run `npm run db:generate` from `mobile/` only when intentionally changing the schema, then inspect the generated SQL and metadata before committing them. Keep real `.env` files, credentials, local databases, native signing material, dependency directories, and generated exports such as `mobile/dist-android/` out of source commits.

## Known limitations and next steps

The following work is not complete:

- transfers need an approved paired-leg or dedicated transfer representation and migration;
- explicit opening balances require a reviewed migration informed by reconciliation results;
- the financial-history and forecast-readiness services exist, but mobile has no user-facing confirmation, correction, or missing-profile recovery screen;
- category-applicability policy and enforcement remain unresolved;
- existing legacy future-dated rows can still make stored balances differ from cutoff-filtered reporting actuals;
- signed balance/availability formatting still needs improvement because the shared formatter uses absolute values;
- refunds, pending transactions, and soft deletion remain unsupported;
- seed and chat repositories do not yet have full integration/rollback coverage, and chat message ownership requires separate hardening;
- React Native overdraft-dialog interactions do not yet have automated component tests;
- the mobile checks are not part of the current GitHub Actions workflow;
- root/web checks were not runnable in the latest audit environment because root dependencies were absent;
- Expo SQLite device/emulator parity, backup/restore, authentication, and production readiness remain unverified or unimplemented.

Mobile AI generation is also not yet grounded in the device's SQLite ledger. The current backend chat tools read the separate web Prisma database for a hard-coded demo user; no mobile-to-web financial synchronization exists.

Optional AI generation requires a separately operated secure HTTPS backend. Only that backend may hold provider API keys; no secret should be placed in an `EXPO_PUBLIC_*` variable.

## Roadmap

Remaining Phase 3 work should expose the implemented history-start workflow in the mobile UI, qualify migrations and behavior on Expo SQLite, add mobile checks to CI, and reconcile release documentation. Transfer and opening-balance models, category applicability, signed financial formatting, synchronization, backup/recovery, and authenticated AI access remain separate future decisions.
