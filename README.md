# Kifayat

Kifayat is a local-first personal-finance application centered on its Expo/React Native mobile client. Financial records are stored on-device with Expo SQLite and accessed through Drizzle ORM, so accounts, transactions, summaries, and planning features do not require the web API. The existing Next.js/Prisma backend remains available for server-side capabilities such as secure AI requests; private provider credentials must never be bundled into the mobile app.

Start with [Final Mobile Readiness and Android acceptance](mobile/docs/FINAL-MOBILE-READINESS.md). [mobile/README.md](mobile/README.md) is the short developer entry point.

## Current engineering status

The native mobile implementation is complete for the supported local single-user scope. Current stack: Expo SDK 58, React Native 0.88.1, React 19.3, Expo Router, Drizzle ORM and Expo SQLite. The secondary web application uses Next.js 16, React 19 and Prisma with a separate SQLite database. Production multi-user deployment is outside the completed scope.

The project owner reports successful physical Android acceptance. Device/runtime versions and individual checklist results were not supplied with this handover; acceptance of the SDK 58 upgrade is not independently established. Automated checks are separate from device acceptance and are not an independent security or penetration test.

Phase 0 established the protected mobile SQLite/Drizzle baseline while retaining the existing Next.js/Prisma backend. Phase 1 established the financial-rule and testing foundation. Phase 2 completed the supported financial-core reliability work:

- catalog, transaction, and chat repositories have injectable cores; production wrappers retain the Expo SQLite singleton;
- fresh in-memory SQLite tests cover generated migrations, foreign keys, transaction rollback, and repository mutations;
- income/expense creation, edits, account moves, and deletion use checked integer arithmetic and atomic balance updates;
- client request IDs make transaction creation idempotent and reject conflicting reuse;
- persisted transaction rows are validated before reporting, reconciliation, or mutation logic uses them;
- reporting retrieves complete transaction history, calculates savings as income minus expenses, and excludes transactions later than a shared report cutoff;
- affordability validates whole-month horizons from 1 through 120 and checks monetary intermediates;
- new future-dated income and expense transactions are rejected; existing legacy future rows remain preserved under the documented policy.

Phase 4-6 additionally implement grounded local-ledger chat, editable financial settings, savings goals/recommendations, installment arithmetic, filtered and paginated Activity, and the completed native Overview. Integrated repository/service/controller journeys and migration safety are host-verified; physical Android acceptance is owner-reported; live-provider acceptance remains unverified.

Phase 3 adds the approved `Asia/Karachi` reporting calendar, financial-history readiness and UI workflows, category applicability, signed PKR presentation, dedicated transfers, and explicit opening-balance reconciliation with append-only audits. These capabilities are implemented and host-tested; physical Android acceptance is owner-reported, with no independently recorded device/runtime details.

## Financial data integrity

Supported income and expense mutations currently enforce these invariants:

- user-entered PKR amounts are complete positive whole-rupee strings, capped at PKR 2,147,483,647, with no silent truncation or rounding;
- canonical UTC transaction dates and supported income/expense signs are validated at the repository boundary;
- create, update, account moves, and deletion keep transaction rows and balance effects in one SQLite transaction with checked safe-integer arithmetic;
- account ownership, idempotent request reuse, conflicting request-ID reuse, and inconsistent stored account references are rejected before unsafe mutation;
- forced-failure tests prove rollback for create, update, and delete in the host SQLite test environment;
- persisted transaction rows are validated before list/get/reporting/reconciliation use, and invalid data fails clearly without repair;
- opening balances remain distinct from current balances and ledger activity; nullable values are unconfirmed, suggestions are never automatic, and confirmations/corrections are stale-safe, audited, and atomic;
- expenses that would create a negative balance require an exact repository-generated overdraft confirmation tied to the account and projected balance; stale confirmations are rejected;
- future-dated income/expense creation and date-changing edits are rejected, while existing future rows remain preserved and may be deleted atomically;
- dedicated transfers apply equal-and-opposite account effects atomically and remain excluded from income, expenses, savings, and forecasts; legacy single-account transfer rows stay readable and mutation-blocked.

Category applicability is enforced through the existing explicit mapping table; display grouping is not an assignment rule.

## Testing and validation

The mobile suite uses Node's test runner through `tsx`. Database-contract smoke tests use `node:sqlite`; repository integration tests use Drizzle with `better-sqlite3@12.11.1` and `Database(':memory:')`. Tests do not open the production `kifayat.db`.

From `mobile/`:

```sh
npm test
npm run typecheck
npm run lint
npm run check
```

Final local mobile verification (11 November 2026): **316 tests passed, 0 failed**, with typecheck and lint passing. Tests include migrations, disposable SQLite integration, complete ledger journeys and mocked chat providers. They do not prove native Expo SQLite behavior, physical navigation or live AI. The dedicated [Mobile CI workflow](.github/workflows/mobile-ci.yml) runs the same mobile commands; remote execution has not been verified in this handover. Root/web CI is separate.

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

For a fresh checkout, install the locked mobile dependencies with `cd mobile` then `npm ci`. This handover does not install packages. Start the mobile client:

```sh
cd mobile
npm start
```

Useful commands from the repository root include:

```sh
npm run mobile:start
npm run mobile:check
```

Database schema changes require a reviewed migration. Run `npm run db:generate` from `mobile/` only when intentionally changing the schema, then inspect the generated SQL and metadata before committing them. Keep real `.env` files, credentials, local databases, native signing material, dependency directories, and generated exports such as `mobile/dist-android/` out of source commits.

## Secondary web/backend setup

The root project is separate from mobile. For a fresh web development checkout, run `npm ci` at the root, create a private `.env.local` using `.env.example` as a reference, and configure `DATABASE_URL` for a disposable web SQLite database (for example `file:./dev.db`, relative to the Prisma schema). The root example currently documents the optional AI endpoint and server variables; `DATABASE_URL` must be supplied separately. Run `npx prisma generate` and `npx prisma migrate deploy` before `npm run dev`. These are developer instructions, not commands executed against any real database during this handover. Never point them at the mobile ledger.

Root scripts include `npm run dev`, `build`, `start`, `test`, `typecheck`, `lint` and `check`. Root/web verification is separate and is not claimed here. Keep `GROQ_API_KEY` and optional `GROQ_MODEL` server-only. Mobile configuration uses `mobile/.env.example`; copy it to `mobile/.env.local` only if needed and restart Expo after edits.

## Known limitations and next steps

The following work is not complete:

- owner-reported Android acceptance lacks a device/version checklist record; SDK 58 device acceptance should be recorded;
- existing legacy future-dated rows can still make stored balances differ from cutoff-filtered reporting actuals;
- refunds, pending transactions, and soft deletion remain unsupported;
- independently recorded rendered chat evidence and live-provider verification remain unavailable; seed rollback, conversation persistence/retries and integrated journeys have disposable-database coverage;
- React Native overdraft-dialog interactions do not yet have automated component tests;
- root/web checks were not runnable in the latest audit environment because root dependencies were absent;
- the app uses `LOCAL_USER_ID=1`; production authentication, cloud synchronization, multi-user cloud authorization and production backup/restore are not implemented.

Mobile chat uses a minimal SQLite-backed monthly/planning aggregate snapshot for supported recorded-total, category, forecast and purchase-affordability questions. Its dedicated `/api/mobile-chat` route has no Prisma demo tools and validates constrained explanations of the supplied facts. The older web chat remains a separate demo-ledger surface. No mobile-to-web financial synchronization exists. See [the mobile chat contract and setup](mobile/docs/phase-4-mobile-chat.md).

Optional AI generation requires a separately operated secure HTTPS backend. Only that backend may hold provider API keys; no secret should be placed in an `EXPO_PUBLIC_*` variable.

## Roadmap

The owner reports Android acceptance. Retain device/runtime and SDK 58 acceptance records using the final readiness checklist; optional live-provider behavior is not verified. Mobile CI is configured but no remote run is claimed. Synchronization, backup/recovery, refunds, and authenticated mobile-ledger AI access remain separate future decisions.
