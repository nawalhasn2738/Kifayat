# Final Mobile Readiness and Android Acceptance

**Handover date: 11 November 2026. Primary product: native mobile Kifayat.**

| Status | Evidence / boundary |
| --- | --- |
| Automated verification complete | 316 local mobile tests passed; typecheck, lint and `git diff --check` passed. |
| Ready for physical-device acceptance | Yes: the existing SDK 58 Expo Go/QR procedure below is established from project configuration and installed CLI behavior. A compatible phone runtime and an isolated QA ledger are prerequisites. |
| Confirmed on a physical device | **Owner-reported pass.** The owner reports successful physical Android acceptance. Device/runtime versions, per-row results and whether SDK 58 was tested were not supplied; this is not independent verification. |
| Live-provider verification | **Not complete.** Provider/HTTP integration is mocked in automated tests. |
| Remote CI verification | **Not claimed.** Workflow configuration was inspected; no remote run result was obtained. |

## What is implemented

Overview (recorded totals, trends, projections, reserve/risk explanations, goals and bounded recent activity); account management and opening balances; income/expense create/edit/delete; separate atomic transfers; history confirmation/correction and forecast readiness; editable profile income/emergency target; savings targets, shared-pool progress and grounded recommendations; affordability and installment arithmetic; combined Activity filters/search/historical browsing with 50-event cursor pages; and constrained local-ledger chat with persistent conversations. Existing details and financial definitions are in the [Phase 5 reports](phase-5-overview-dashboard.md) and [integrated verification report](phase-6-integrated-verification.md), not duplicated here.

Mobile uses app-sandboxed **`kifayat.db` -> Expo SQLite -> Drizzle**, with fixed **`LOCAL_USER_ID = 1`** and owned repositories. Routes wait for migrations, database configuration and the idempotent seed. Fresh installations have no transactions, three default accounts with unconfirmed opening balances, unconfirmed history, initial profile values (PKR 120,000 income / 240,000 emergency target) and a separate seeded Emergency Fund goal. Seed reruns preserve edits. The secondary web/Prisma `DATABASE_URL` is a separate database; there is no automatic import, synchronization or multi-user authentication. Never point manual QA at valuable financial data.

## Existing run procedure - no new tooling or build workflow

This workspace already has mobile dependencies. **This documentation handover installs no dependencies or tooling.** The preceding authorized SDK upgrade installed SDK 58 and aligned dependencies with `expo install --fix`; automated checks passed afterward.

From the repository root:

```sh
cd mobile
npm start
```

Or use the existing root alias `npm run mobile:start`. The script is exactly `expo start`; the entry is `expo-router/entry`, and `src/app/_layout.tsx` gates startup on the bundled migrations/seed.

For your physical Android phone:

1. Use a phone/runtime with **Expo Go supporting SDK 58**, and an isolated Kifayat QA ledger. Put phone and development computer on the same reachable Wi-Fi/LAN.
2. Run `npm start` from `mobile/`. Keep that terminal running. Open Expo Go's QR scanner and scan the terminal QR code (or use its existing manual URL entry). Allow access to the development server if the host firewall asks.
3. Wait for “Preparing your private local data…” to finish, then follow the acceptance table below. Record actual phone, Android and Expo Go versions and the result.
4. If Expo Go reports an unsupported SDK or a missing native module, **stop and record the launch blocker**. Do not silently change SDK versions or introduce a development build, emulator, Android SDK or EAS setup in this handover.

Why this workflow is supported by configuration, rather than assumed: `app.json` uses standard Router/Splash/SQLite plugins without SQLCipher/custom SQLite extensions; there is no `expo-dev-client` dependency, EAS profile or checked-in native project. Installed native package versions match the SDK 58 bundle (including SQLite 58.0.16, Reanimated 4.7.1 and Worklets 0.13.0). The installed Expo CLI chooses Expo Go when there is no direct dev-client dependency. Expo's [SDK 58 SQLite](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/) and [Reanimated](https://docs.expo.dev/versions/v58.0.0/sdk/reanimated/) documentation mark these libraries as included in Expo Go; its [start guide](https://docs.expo.dev/get-started/start-developing/) describes QR/LAN opening. This is **configuration evidence, not a successful phone test or proof that a compatible Expo Go is currently installed on your phone**.

`npm run android` is `expo start --android`: it launches an available connected Android target, not an APK build. It is unnecessary for QR testing. No new development-build instructions are introduced. This development workflow needs Metro to serve JavaScript on initial/reloaded launches; offline finance after the app loads is not proof of offline cold-start behavior for a standalone binary. If LAN opening fails, record the network/runtime error; no new tunnel tool is required by this checklist.

## Local versus live AI

All ledger operations, reporting, forecasts/readiness, planning and supported deterministic chat work without a provider. For baseline QA, leave the optional public URL unset or use this in **`mobile/.env.local`**, then restart Expo:

```env
EXPO_PUBLIC_AI_PROXY_URL=
```

For optional live testing, use an **already provisioned trusted HTTPS backend** and change only the public mobile endpoint:

```env
EXPO_PUBLIC_AI_PROXY_URL=https://YOUR-TRUSTED-HOST/api/mobile-chat
```

The full path is required. Do not use `/api/chat` (the separate web demo route), a base URL, `http://localhost`, or a plain-HTTP LAN address. The client rejects HTTP, embedded URL credentials, query/hash values and redirects; a phone's localhost is not the development computer.

On the backend host only, configure the existing server environment/root `.env.local`:

```env
GROQ_API_KEY=YOUR_SERVER_ONLY_KEY
GROQ_MODEL=openai/gpt-oss-120b
```

`GROQ_MODEL` is optional; that value is the current route default, not a guarantee of provider availability. No provider key belongs in mobile files or `EXPO_PUBLIC_*`. The existing backend command is root `npm run dev:phone` (`next dev -H 0.0.0.0`); it serves development HTTP and alone does **not** satisfy the mobile HTTPS requirement. Use the already configured trusted HTTPS deployment/proxy for phone requests. Root dependencies are absent from this workspace and were not installed; backend startup, HTTPS exposure and live credentials are therefore not verified here. No Prisma seed/database is required by the dedicated mobile handler, and mobile data must not be copied into the web demo ledger. If no ready backend exists, mark live testing pending and continue local acceptance.

Behavior to expect:

- No mobile endpoint: deterministic on-device answers, with no chat network request.
- Endpoint but no server key: deterministic server response from supplied mobile facts.
- Provider failure/invalid selection: server deterministic fallback; invalid returned prose/amounts: client deterministic fallback against the original local snapshot.
- Network errors, non-success HTTP and client timeout: a retryable error, not an invented answer. Retry should not duplicate the saved user message.
- The backend receives monthly/planning aggregates plus at most 12 recent messages (2,000 characters each); the provider receives approved sentences only. Raw financial rows/account names/merchants/descriptions/record IDs are excluded from the aggregate snapshot. User-authored chat text can still contain private details; use QA text.

The [chat contract](phase-4-mobile-chat.md) defines exact supported questions and validation. Live AI/provider mode remains unverified until explicitly recorded on device.

## Automated checks and CI

Exact commands, from `mobile/`:

```sh
npm test
npm run typecheck
npm run lint
```

From repository root:

```sh
git diff --check
```

Final local results: **316 tests passed / 0 failed**, source and test-project typecheck passed, lint passed, whitespace check passed. Local versions: Node **24.14.0**, npm **11.9.0**. `npm run check` is the existing combined typecheck -> lint -> test script; no app/provider start is part of it.

Evidence includes disposable in-memory/file SQLite, fresh installation, every released migration-prefix upgrade, reruns, rollback/failure injection, owned atomic financial mutations, seed preservation, and all five shared-ledger journeys. File close/reopen verifies profile, goals, transactions, transfers, balances and 14 persisted conversation messages. This does not establish Expo SQLite device parity. See [Phase 6 verification](phase-6-integrated-verification.md) for root causes and test files.

[`.github/workflows/mobile-ci.yml`](../../.github/workflows/mobile-ci.yml) uses Node 22 on Ubuntu, `mobile/package-lock.json`, `npm ci` in its CI runner, then **the same typecheck, lint and test commands**, plus a changed-file whitespace check. The relevant mobile tests include migrations and the dedicated mocked mobile-chat handler. This handover fixes its path filters to include the two root mobile-chat handler/route files: previously root-only mobile-chat changes could bypass Mobile CI. Existing push scope remains `feature/mobile-only-drizzle-sqlite`; pull requests are path-filtered without that branch restriction. A push on another branch alone does not prove Mobile CI ran. Root `ci.yml` is separate web/Prisma verification and was not changed. Local Node 24 versus configured CI Node 22 is an environment difference, not evidence of remote success; no remote job or Node 22 run was executed here.

## Android acceptance - execute in this order

**Use a fresh or isolated QA ledger. Do not clear/uninstall/reset an installation containing valuable data, open the real database, or import personal financial records for these checks.** Record each row as PASS / FAIL / PENDING, with device/version, time, actual values and an error screenshot if useful. A pending case is not a pass. “MTD” below means the current **Karachi** month; avoid running across midnight/month rollover without recording that change.

The example sequence deliberately leaves one income of 20,000, one expense of 5,000, and one transfer of 3,000. Preserve these checkpoints until after the goal/chat checks.

| # | Exact user action | Expected result | Failure |
| --- | --- | --- | --- |
| 1 | Start Metro, scan QR in compatible Expo Go, launch isolated Kifayat. | Setup finishes; Overview/Activity/Planning/Chat tabs and Overview Settings/Accounts entries work. No transactions; history/risk/forecast readiness is explained rather than assumed. | Crash, endless setup, missing route/module, or fake financial activity. Record SDK mismatch as a blocker. |
| 2 | Overview -> Accounts: create **QA Reserve**, Savings, opening **0**. Planning -> Opening balances: explicitly confirm **Main Account = 10000**. | QA Reserve shows confirmed zero; Main Account balance 10,000; total 10,000. Income/expense/net savings stay zero. | Empty value silently becomes zero, repeated create, opening confirmation becomes income, or balances disagree. |
| 3 | Activity -> Add: Income **20000**, salary, Main Account, source **QA income**, description **QA salary**; save (try a rapid second tap). | One income; Main Account/total 30,000; MTD income 20,000, expense 0, net savings 20,000. | Duplicate row/effect, lost amount, wrong account or non-integer input accepted. |
| 4 | Add Expense **5000**, groceries, Main Account, merchant/description **QA groceries**. | Total 25,000; income 20,000, expenses 5,000, net savings 15,000. | Wrong sign, total or category; unsupported category assignment accepted. |
| 5 | Open that expense -> Edit to **6000** -> save -> return; delete it (first cancel the dialog, then confirm); recreate the original **5000** QA groceries expense. | Edit gives total 24,000 / expenses 6,000 / net 14,000. Cancel changes nothing. Delete gives total 30,000 / expenses 0 / net 20,000. Recreate restores total 25,000 / expenses 5,000 / net 15,000. Detail/Overview refresh. | Stale old values, duplicate effects, cancel deleting data or incorrect reversal. |
| 6 | Activity -> Transfer money: **3000**, Main Account -> QA Reserve, note **QA move**. | Main 22,000; QA Reserve 3,000; total still 25,000. Income 20,000 / expenses 5,000 / net 15,000 unchanged. Transfer has its own detail route. | Transfer becomes income/expense/savings, changes total, or appears twice. |
| 7 | Activity -> Filters: Expense + groceries + Main Account + current Calendar month + search **QA groceries** -> Apply. Try Transfer + All categories + QA Reserve. Try a category with Transfer. Clear filters. | One expense matches the first combination; one native transfer matches the second; selecting a category excludes native transfers (they have no category). Active state is visible; clear restores all events without deleting them. | Filters ignored/lost, other accounts leak, transfer classified as expense, or empty results lack a useful explanation. |
| 8 | Dates: visit previous/next month, December/January and **2024-02**. Custom range: From today's displayed Karachi date, Before tomorrow; then set Before to today with no start bound. | Month/year/leap navigation stays exact; empty historical months say no matches. Today's events are included in the first range and excluded by Before today. Invalid/inverted dates fail validation. | UTC/device timezone shift, end date included, impossible date accepted, or rows disappear after clearing filters. |
| 9 | Overview -> Settings: save monthly income **20000**, emergency target **1000**. Try empty/negative/fractional input, then explicit **0**, then restore **20000 / 1000**. | Validation errors retain saved values; explicit zero is accepted and visibly different from empty. Settings persist; actual ledger totals stay 25,000 / 20,000 / 5,000 / 15,000. Separate Emergency Fund goal target is not silently changed. | Settings alter transaction income/balances, edits revert to seeded defaults, zero treated as missing, or empty treated as zero. |
| 10 | On this QA-only ledger, first note unavailable forecast/assessment before confirmation. Then Planning -> confirm complete history from the first day **three Karachi months before the current month**, with intentionally empty prior QA months (for November 2026: **2026-08-01**). | Before confirmation: guidance, not guessed estimates. After: three preceding complete empty months qualify; forecast is legitimately **0**, not current MTD spending. Current partial month is excluded. | Missing history treated as confirmed zero, current spending enters training, or confirmation corrupts balances. Do not make this historical claim about a real personal ledger. |
| 11 | Return to Overview; inspect cash flow, trends, risk reasons and emergency reserve. Change configured income temporarily to **1000**, return, then restore **20000**. | Recorded MTD stays 20,000 / 5,000 / 15,000; total 25,000. Full-month estimates and partial actuals are labelled. Reserve rule is 1,000 with active eligible balance 25,000 (24,000 above reserve); it is not actual savings. Risk uses settings/reasons and changes for the income test; low <=30, moderate 31-60, high >60. | Fake low risk when unavailable, old profile values used, unlabeled estimates, false positive-width zero bars, or reserve added to savings. |
| 12 | Planning -> Add savings goal: **QA Laptop**, target **20000**, a valid future YYYY-MM-DD date. Change target to **30000**. | Shared net-savings pool 15,000: first remaining 5,000 / 75%; then remaining 15,000 / 50%. Other goals compare with the same pool, not separate money. Prior QA months are empty, so the complete-month recommendation is 0, even though current MTD is positive. | Goal/target edits move money, progress double-counts transfers/emergency target, empty/zero target accepted, or rate treated as guaranteed saving. |
| 13 | Can I afford it?: item **QA purchase**, price **2000**, horizon **1** -> Check. Change price to **30000**, check; then horizon **0**. Expand Installment calculation: price **1200**, months **12**, APR **0**. | First purchase preserves 1,000 buffer; second has 6,000 shortfall. Editing input clears the old answer. Horizon 0 rejects. Installment payment is 100/month; with the three intentionally empty recorded-income months it exceeds the existing disposable-income rule. No transaction/balance changes. | Old answer relabelled for new input, zero horizon accepted, invented historical income/headroom, or calculator moves money. |
| 14 | Chat with URL empty: ask “How much did I spend this month?”, “What is my biggest spending category?”, “How much did I save this month?”, “What is my forecast?”, “Can I afford PKR 2000 in 1 month?”, then omit horizon and use “What if I wait two months?”. | Grounded answers: 5,000; groceries 5,000; net 15,000; forecast 0; the same affordability rules. Missing horizon clarifies; supported delay follow-up reuses the user amount. UI identifies deterministic calculations. Unsupported broad advice gets capability guidance. | Invented numbers/demo ledger, missing warnings, arbitrary advice, duplicate conversation messages or required backend despite no URL. |
| 15 | Across screens, use Android Back, scroll to bottom, open/close keyboard, test save/error/retry and use TalkBack if available. Once JS is loaded, test local finance without provider/network; restore Metro connectivity before reopening the dev experience. | Usable controls/labels, readable signed PKR, no clipped save buttons, duplicate actions or internal SQL errors; input edits survive failed saves. Local finance needs no provider. | Inaccessible/unreachable action, stale results after return, hidden error, duplicate save or leaked diagnostics. Record exact screen/action. |
| 16 | Close Kifayat/Expo Go normally (do not clear data/uninstall). Reopen the **same** experience using Metro/QR. | Profile 20,000/1,000, QA Reserve balance 3,000, total 25,000, goal target 30,000, history, transactions/transfer and completed chat messages persist. Applied Activity filters may reset; they are not restart-persisted. | Lost ledger/chat/settings, repeated seed overwrites or migration/setup loop. Native restart is only verified after this actual phone check. |
| 17 | **Pagination, after numeric checks:** clear filters; if an isolated ledger has >50 events, traverse Older/Newer. Repeat with combined filters only when >50 events match them. If not, either add enough clearly numbered 1-PKR QA expense entries to exceed 50 events, or mark phone pagination PENDING. | At most 50 visible-page events, stable order, no repeated/skipped numbered entries, filters retained, refresh resets to fresh first page. Re-baseline totals if extra entries were added. Automated fixtures already cover 5,107 rows, but do not count as a phone pass. | Full ledger loaded/hangs, page duplication/omission, lost filters or stale rows after mutation. |
| 18 | **Optional live AI:** configure the trusted HTTPS URL/server key as above, restart Expo, repeat supported questions; interrupt/restore connectivity and retry. | Financial answers remain identical; successful composition may show model-selected mode. No server key uses server fallback; provider/invalid replies use deterministic fallback; network/timeouts show recoverable retry with no duplicate user message. | Demo facts, altered amounts/warnings, secret in mobile config, unrecoverable error or duplicated message. Mark PENDING without a ready endpoint/provider. |

**Native limitations relevant to this plan:** editors create records at the current instant and preserve the original date when edited; there is no native backdate/date-edit control or QA data importer. Therefore historical navigation can be tested with empty periods on a fresh phone ledger, but nonzero historical forecast/boundary scenarios need an already approved isolated historical QA ledger; their current evidence is automated fixture coverage. Do not promise manual nonzero history can be entered through a nonexistent date picker. Native high-volume pagination remains pending if row 17 is not executed.

## Known limits and sign-off

Single local user; PKR integer amounts only; no sync/import/backup/restore or user authentication. Goals use shared recorded net savings, not allocations. Forecasts need confirmed coverage of the three **preceding complete Karachi months**; eligible empty months are zero and current partial months are excluded. Monthly mean/range and run-rate projections remain estimates. Purchase planning needs an amount and a whole 1-120 month horizon; immediate/zero-month purchases are unsupported. Installments are the existing recorded-average arithmetic, not a financial product or guarantee. Chat supports recorded totals/categories, limited month comparisons, forecasts and explicit purchase scenarios, not arbitrary financial questions. Legacy single-account transfer rows stay readable but mutation-blocked. Existing legacy future rows may make stored balances differ from cutoff-filtered actuals.

No known automated code/data-consistency blocker remains for starting device acceptance. The owner reports successful Android acceptance; retain completed applicable phone rows and a recorded SDK/runtime result, including acceptance after the SDK 58 upgrade; live-provider mode needs separate evidence if part of delivery. Host Windows/Node 24 tests are not remote Ubuntu/Node 22 CI evidence. Standalone APK release/build, native offline cold start, production backend deployment/authentication, device accessibility and live AI have not been certified. No new implementation phase is started by this handover.

Acceptance record (fill in, do not pre-mark): device/Android/Expo Go versions; QA ledger identity; test date and Karachi month; each row PASS/FAIL/PENDING; actual balance checkpoints; restart result; backend URL host (no keys)/provider mode if used; issue reproduction/screenshots; tester and sign-off. Current Android acceptance is **OWNER-REPORTED PASS**, without supplied device/runtime or row-level records. SDK 58-specific device acceptance and live-provider status remain **UNVERIFIED**. This evidence is not an independent security or penetration test. Production authentication, multi-user cloud authorization and production backup/restore are not implemented.
