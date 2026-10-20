# Kifayat Mobile

Kifayat is a local-first personal-finance app for Android and iOS. It uses Expo SDK 57, React Native 0.86, TypeScript, Expo Router, Expo SQLite, and Drizzle ORM. Core finance records and calculations work offline.

## Requirements and commands

- Node.js 20 or newer and npm
- Expo Go for quick device testing, or Android Studio/Xcode for native builds

```sh
cd mobile
npm install
npm start
npm run android
npm run ios
npm run check
npm run doctor
npx expo export --platform android
```

`npm run check` runs TypeScript, ESLint, and Node tests. `npm run db:generate` creates a new migration after a schema change; review and commit the generated SQL.

## Architecture

The dependency direction is `screens -> hooks -> services/repositories -> Drizzle -> Expo SQLite`.

- `src/app`: Expo Router stack, tabs, and screens.
- `src/components`: reusable native UI.
- `src/hooks`: async loading state.
- `src/lib/db`: typed schema, connection, database pragmas, and first-run seed.
- `src/lib/repositories`: persistence and atomic transaction/balance operations.
- `src/lib/services`: local summaries, forecasts, affordability, and risk analysis.
- `src/lib/finance`: Karachi reporting-calendar and financial-history-start validation/conversion utilities.
- `src/lib/validation`: input validation at the persistence boundary.
- `drizzle`: generated, versioned SQL migrations bundled into the app.

The app opens `kifayat.db`, applies migrations before rendering routes, enables foreign keys and WAL, then idempotently creates the single local profile, default accounts, categories, and emergency-fund goal. Amounts use signed integer PKR units: income is positive, expense is negative, and transfers retain their direction. Mobile transaction creation requires a client request ID: identical reuse returns the existing row without another balance effect, while conflicting reuse is rejected. Create, update, and delete operations update account balances in the same SQLite transaction.

Reporting uses fixed `Asia/Karachi` calendar boundaries while transaction timestamps remain canonical UTC instants. The history-start service supports read-only state and suggestions, explicit missing-profile recovery, and atomic confirmation/correction with audit rows. Forecast readiness requires a confirmed start and the three immediately preceding complete Karachi months; qualifying empty months count as zero, the current partial month is excluded, and unavailable forecasts return `forecast: null` with a stable reason. These service paths exist, but the app does not yet provide user-facing screens to confirm, correct, or recover history-start state.

## Data migration

The original Prisma entities were mapped to Drizzle: users, profiles, accounts, categories, transactions, savings goals, conversations, and messages. Mobile opens its own Expo SQLite `kifayat.db`; the retained web application uses Prisma and its separately configured `DATABASE_URL`. These are separate persistence paths, not one shared live financial database. Existing server SQLite data is not silently imported because Expo stores its database in the app sandbox. A future explicit importer can accept a reviewed JSON export; installing this build does not delete a legacy server database.

## AI and environment configuration

Financial records never require a network connection. Chat history is local. AI generation is optional and must go through a trusted HTTPS backend:

```env
EXPO_PUBLIC_AI_PROXY_URL=https://your-secure-service.example
```

Only the backend may hold `GROQ_API_KEY`, model credentials, or embedding credentials. Never place secrets in an `EXPO_PUBLIC_*` variable or in the mobile bundle. Without the proxy URL, chat explains that AI is unavailable while the rest of Kifayat remains usable.

The current mobile chat request does not transmit or synchronize the device's SQLite ledger. The backend route in this repository builds its financial tools from the separate web/Prisma database for a hard-coded demo user, so it must not be described as grounded in the mobile user's local finances.

## Test evidence

On October 20, 2026, `npm test` run from `mobile/` completed with 146 passing host-side tests and 0 failures; `npm run typecheck` and `npm run lint` also passed. The suite uses Node SQLite and `better-sqlite3` with disposable databases. It covers supported financial mutations, migration-chain behavior, history-start services and commands, Karachi boundaries, and forecast readiness, but it is not an Expo SQLite emulator/device run. The repository's current GitHub Actions workflow does not run the mobile check command.

## Known limitations

- The first local install starts with empty transactions; legacy Prisma data requires an explicit export/import flow.
- Forecasting uses the existing transparent three-month local mean and standard deviation only after the readiness contract succeeds; category forecasts remain empty.
- History-start confirmation, correction, and recovery have service APIs but no user-facing workflow.
- Web and mobile use separate databases; cross-device synchronization, automatic import, backup, and restore are not implemented.
- The retained web/backend uses a hard-coded demo user and is not an authenticated mobile-ledger service.
- A device/emulator is needed to exercise native SQLite persistence and platform-specific interaction tests.
- Root/web checks were unavailable in the latest audit environment because root dependencies were not installed.
