# Kifayat

Kifayat is a local-first personal-finance application centered on its Expo/React Native mobile client. Financial records are stored on-device with Expo SQLite and accessed through Drizzle ORM, so accounts, transactions, summaries, and planning features do not require the web API. The existing Next.js/Prisma backend remains available for server-side capabilities such as secure AI requests; private provider credentials must never be bundled into the mobile app.

Detailed mobile setup and architecture notes are available in [mobile/README.md](mobile/README.md).

## Current engineering status

Phase 0 established a protected mobile SQLite/Drizzle baseline on the `feature/mobile-only-drizzle-sqlite` branch while retaining the existing backend. Phase 1 established the financial-rule and testing foundation:

- repository logic is separated into injectable catalog, transaction, and chat cores while production wrappers continue to use the Expo SQLite singleton;
- a shared, schema-aware SQLite database type supports production and isolated test drivers;
- generated migrations and repository behavior are exercised with fresh in-memory SQLite databases;
- approved rules, remaining gaps, and integration-test boundaries are documented under `mobile/docs`.

Phase 1 is a safety and verification foundation, not a claim that every planned financial feature is complete or that the application is production-ready.

## Financial data integrity

Supported income and expense mutations currently enforce these invariants:

- user-entered PKR amounts are complete positive whole-rupee strings, capped at PKR 2,147,483,647, with no silent truncation or rounding;
- transaction dates use calendar-valid canonical UTC ISO timestamps;
- income effects are stored positive and expense effects negative;
- create, update, and delete keep transaction rows and account-balance effects inside one SQLite transaction;
- account ownership is checked before balance changes, including defensive handling of inconsistent stored rows;
- forced-failure tests prove rollback for create, update, and delete in the host SQLite test environment;
- read-only reconciliation compares stored balances with recorded signed transaction effects without automatically repairing data;
- expenses that would create a negative balance require an exact, repository-generated overdraft confirmation tied to the affected account and projected balance; stale confirmations are rejected;
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

The current verified local baseline is 32 passing tests on Windows x64 with Node.js 24.14.0 and npm 11.9.0. The test command uses `--test-isolation=none` as a workaround for a local `spawn EPERM` restriction. This baseline does not establish Ubuntu/Node 22 CI portability or Expo SQLite device/emulator parity.

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
- savings, signed formatting, and forecast windows still need alignment with the approved reporting rules;
- the reporting timezone, category applicability, and stable retry/idempotency policies remain undecided;
- refunds, pending transactions, and soft deletion remain unsupported;
- seed and chat repositories do not yet have full integration/rollback coverage, and chat message ownership requires separate hardening;
- React Native overdraft-dialog interactions do not yet have automated component tests;
- Ubuntu/Node 22 CI execution and Expo SQLite device/emulator parity remain unverified.

Optional AI generation requires a separately operated secure HTTPS backend. Only that backend may hold provider API keys; no secret should be placed in an `EXPO_PUBLIC_*` variable.

## Roadmap

Phase 2 is the next development step: continue making the financial core reliable without weakening the Phase 1 invariants. Planned work includes resolving the remaining financial policy decisions, designing safe migrations for transfers and opening balances, correcting savings and reporting calculations, and expanding cross-platform and production-driver verification. These items are planned, not completed.
