# Kifayat Mobile

Kifayat is the primary native Expo/React Native product. Its local SQLite financial ledger and deterministic finance features do not require the web database or an AI provider.

**Handover and Android-phone steps:** [FINAL-MOBILE-READINESS.md](docs/FINAL-MOBILE-READINESS.md). That is the current status/checklist; phase reports retain their original test evidence.

## Run the existing workspace

Dependencies are already present in this workspace; this handover installs nothing. Use Node supported by the installed packages (local checks: Node 24.14.0/npm 11.9.0; Mobile CI: Node 22). Use a Node version satisfying the locked packages' engines; local verification uses Node 24.14.0.

For a fresh checkout, run `npm ci` inside `mobile/` to install the committed lockfile. No installation is performed as part of this handover.

```sh
cd mobile
npm start
```

`start` runs `expo start`; the configured phone route is Expo Go with SDK 58 compatibility. The project has Expo SDK 58, Expo Router entry, bundled-compatible native dependencies, no `expo-dev-client`, no EAS profile and no custom SQLite extensions. See the final guide for the evidence and QR steps. This establishes the intended workflow, **configuration evidence; Android acceptance is separately owner-reported**. Do not substitute a new development-build/emulator/SDK setup if the installed phone runtime is incompatible; record that blocker.

`npm run android` is `expo start --android`, an automatic connected Android target launcher; it is not an APK build or a requirement for QR testing. `npm run ios` similarly launches an available iOS target. Neither requires you to set up an emulator for this acceptance task.

On a physical Android device, use Expo Go compatible with SDK 58 and the same reachable LAN as the development computer. Run `npm start`, scan the terminal QR code in Expo Go, and wait for local data preparation. Follow the final readiness checklist with an isolated QA ledger. If the runtime is incompatible, record the blocker. Never clear an installation containing valuable data. The owner reports Android acceptance; device/runtime details and SDK 58 acceptance are not independently recorded.

## Automated checks

From `mobile/`:

```sh
npm test
npm run typecheck
npm run lint
```

`npm run check` runs typecheck, lint, then tests. From the repository root, `npm run mobile:start` and `npm run mobile:check` delegate to the mobile scripts. Final local result: **316 tests passed, 0 failed**; typecheck/lint passed. Tests use disposable host SQLite, not the real `kifayat.db`. [Mobile CI](../.github/workflows/mobile-ci.yml) runs these commands separately; a remote CI success is not claimed.

## Architecture and ownership

`screens -> hooks/controllers -> services/repositories -> Drizzle -> Expo SQLite`.

- `src/app`: native routes, stack and tabs; `package.json` entry is `expo-router/entry`.
- `src/lib/db`: schema, native singleton, startup configuration and idempotent seed.
- `src/lib/repositories`: owned persistence and atomic transaction/balance operations.
- `src/lib/services`: existing financial rules, readiness, snapshots and UI controllers.
- `src/lib/finance`: Karachi calendar, formatting and presentation helpers.
- `drizzle`: bundled migrations, applied before routes render.

The app-sandboxed `kifayat.db` uses fixed `LOCAL_USER_ID = 1`. It is separate from the secondary web/Prisma `DATABASE_URL`; no automatic import, synchronization, authentication or backup/restore exists. New installs have empty transactions plus seeded accounts/profile/category/goal values. Subsequent seed runs preserve edits. History starts unconfirmed; opening balances are separately confirmed. Do not use a valuable existing ledger for QA.

## Migrations and seed behavior

Startup applies checked-in `drizzle/` migrations before rendering routes, then seeds only when local user 1 is absent. The initial profile is PKR 120,000 monthly income and PKR 240,000 emergency target; three accounts start at zero with unconfirmed opening balances, history is unconfirmed, and no transactions are seeded. Existing user edits survive startup. Settings are available in the Overview header. Schema work requires review: `npm run db:generate` generates migration files; inspect SQL and metadata before committing. Do not run generation for routine startup or manually migrate a real ledger during QA.

## Optional AI

Leave `EXPO_PUBLIC_AI_PROXY_URL` empty/unset for supported deterministic on-device chat. To test an already configured trusted backend, set the **full HTTPS endpoint** in `mobile/.env.local`:

```env
EXPO_PUBLIC_AI_PROXY_URL=https://your-secure-service.example/api/mobile-chat
```

Restart Expo after changes. `GROQ_API_KEY` and optional `GROQ_MODEL` belong only in the backend's environment/root `.env.local`, never in mobile or `EXPO_PUBLIC_*`. Monthly/planning aggregates and up to 12 recent messages leave the phone only when an endpoint is configured; raw transaction records/account names are excluded from that financial snapshot. User-authored chat text can still contain private details. Provider composition is constrained and validated against local facts. See [the chat contract](docs/phase-4-mobile-chat.md) and final guide for fallback versus retry behavior. `/api/chat` is the separate Prisma demo route and must not be used by mobile.

## Limits and evidence

Forecasts require three preceding complete confirmed Karachi months; eligible empty months count as zero. Goal progress uses a shared recorded-net-savings pool, not allocations. Purchase planning requires amount and a whole 1-120 month horizon; zero-month purchases are rejected. Chat supports a bounded set of questions. The editors create records at the current instant and preserve their original date on edit; they do not expose historical-date entry. Android acceptance is owner-reported; device/runtime details, SDK 58 restart acceptance and live AI are not independently verified. Automated checks and owner acceptance are not an independent security or penetration test. Production authentication, multi-user cloud authorization, cloud synchronization and production backup/restore are not implemented.

[Integrated verification and fixes](docs/phase-6-integrated-verification.md) contains root causes and fixture evidence. [Final readiness](docs/FINAL-MOBILE-READINESS.md) contains the one current acceptance checklist. No new financial/schema/dependency work is part of this handover.
