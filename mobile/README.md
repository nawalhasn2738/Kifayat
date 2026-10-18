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
- `src/lib/validation`: input validation at the persistence boundary.
- `drizzle`: generated, versioned SQL migrations bundled into the app.

The app opens `kifayat.db`, applies migrations before rendering routes, enables foreign keys and WAL, then idempotently creates the single local profile, default accounts, categories, and emergency-fund goal. Amounts use signed integer PKR units: income is positive, expense is negative, and transfers retain their direction. Each transaction has a unique client ID to guard against accidental duplicate writes. Create, update, and delete operations update account balances in the same SQLite transaction.

## Data migration

The original Prisma entities were mapped to Drizzle: users, profiles, accounts, categories, transactions, savings goals, conversations, and messages. Existing server SQLite data is not silently imported because Expo stores its database in the app sandbox. A future explicit importer can accept a reviewed JSON export; installing this build does not delete a legacy server database.

## AI and environment configuration

Financial records never require a network connection. Chat history is local. AI generation is optional and must go through a trusted HTTPS backend:

```env
EXPO_PUBLIC_AI_PROXY_URL=https://your-secure-service.example
```

Only the backend may hold `GROQ_API_KEY`, model credentials, or embedding credentials. Never place secrets in an `EXPO_PUBLIC_*` variable or in the mobile bundle. Without the proxy URL, chat explains that AI is unavailable while the rest of Kifayat remains usable.

## Known limitations

- The first local install starts with empty transactions; legacy Prisma data requires an explicit export/import flow.
- Forecasting uses a transparent three-month local mean and standard deviation; it intentionally does not run the old server-side embedding pipeline.
- A device/emulator is needed to exercise native SQLite persistence and platform-specific interaction tests.
