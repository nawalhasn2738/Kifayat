# Phase 6 Task 1 - integrated mobile verification and fixes

## Scope and evidence

Reviewed the current Overview, Accounts, transaction and transfer editors/details, opening balances/history, Planning, affordability, savings/installation calculations, filtered Activity, profile settings, chat, SQLite startup/seed, migration bundle and existing Phase 4/5 implementation reports. These features already exist; this task adds verification and fixes rather than replacing their financial rules or introducing new product features.

Automated end-to-end below means **repository/service/controller-level journeys against a migrated disposable SQLite ledger**, with mocked HTTP/provider responses for chat. Native taps, routing transitions, keyboard behavior and a live provider were not executed. Native route registration and handlers were traced in source. No claim of device E2E coverage is made.

## Journeys verified on one ledger

`mobile-product-journeys.test.mjs` builds the real dependency graph over one temporary SQLite file and runs these sequential journeys:

| Journey | Verified behavior |
| --- | --- |
| A - setup | Full Expo migration path, local seed/rerun, account creation, explicit opening balance confirmation, history confirmation, forecast readiness. |
| B - daily finances | Three complete months of real income/expenses, current income/expenses, transaction edit/delete/recreate, creation retries with the same client ID, native transfer/retry, exact total and per-account balances, transfer-aware opening reconciliation, income/expenses/net savings unchanged by transfer. |
| C - planning | Saved monthly income/emergency target, goal create/update, shared recorded-net-savings progress, recorded-data recommendation, forecast, affordable/unaffordable purchases, preserved emergency buffer, zero-month rejection and installment calculation/validation. Profile/target changes preserve account and transaction rows. |
| D - Activity/Overview | Combined category/account/type/date/search filters across keyset pages, historical month changes, detail repository reads followed by edits/deletes, fresh Overview values after each mutation, bounded recent events, separate MTD/projection/forecast periods. |
| E - chat | Persistent conversation asking MTD spending, biggest category, recorded savings, forecast, affordability, missing-horizon clarification and delay follow-up. Both client and handler operate on the same ledger snapshots. Unsupported provider prose produces deterministic answers. Context excludes private merchants/descriptions/account names/record IDs, recent messages remain bounded, and provider sees approved sentences only. |
| Reopen | Close/reopen the file, rerun migrations and seed, and compare all account/profile/goal/transaction/transfer/summary values. All 14 conversation messages persist. Integrity and foreign-key checks pass. |

The new integrated ownership test inserts an intentionally malformed transaction-to-account owner relationship in a separate disposable database. Detail/list/full-report/chat reads reject it without exposing foreign account labels; paginated Activity excludes it; Overview reports unavailable totals safely.

## Genuine defects fixed

| Defect/root cause | Correct layer and fix | Regression evidence |
| --- | --- | --- |
| Transaction detail/full-history reads validated the row's IDs but not the joined account owner. A malformed row could leak an account label and contaminate calculations, although paginated Activity already guarded it. | Transaction selection includes account owner; the shared mapper fails closed unless row and account both match the configured owner. Wire transaction objects still exclude owner IDs. | Integrated ownership regression covers detail, list, full history, chat context, Activity and Overview. |
| Planning kept an affordability assessment after editing its item/amount/horizon; the label could change while the underlying assessment stayed old. Old async results could reappear after refresh or ledger changes. | A purchase-assessment controller captures the assessed item, locks duplicate submissions, validates existing inputs and invalidates results/errors on input, focus/blur, refresh, history mutation and opening-balance mutation. UI disables assessment while history is saving/loading. | Regression tests cover duplicate requests, changed inputs/ledger, late results, captured label, zero-month validation and safe service failures. |
| Opening-balance rows loaded only on mount, and an older read could overwrite rows returned by a save. Balance changes did not clear other Planning conclusions. | Opening rows refresh on focus. The runner discards obsolete reads, queues focus refreshes during writes, and retains saved-but-refresh-failed distinctions. Successful mutations invalidate parent assessments and refresh Planning/savings. | Opening read/save/blur race regression plus existing opening repository/UI suites and setup/daily journeys. |
| Generic detail/editor resource reads and account-management reads could publish old results after a newer request or mutation. | A generation-aware resource loader backs `useApi`; cleanup invalidates requests and failed reads clear old figures. Account runner invalidates pre-mutation reads and queues refreshes during writes. | Resource and account race regressions; existing account/detail/repository coverage remains green. |
| SQLite/Drizzle diagnostics could be displayed by shared loading, editor, detail action, account/opening or startup error paths. | A shared error formatter suppresses driver/query diagnostics (including nested causes) while preserving actionable domain messages. Startup uses a safe fixed explanation. Purchase failures also use a fixed message. | Regression tests exercise SQL error codes, nested causes, generic UI failures, preserved validation text and absence of raw startup error rendering. |
| Removing category record IDs from chat forecast labels could generate the same key as a genuine category and silently overwrite one forecast amount. | Privacy disambiguation reserves all original names and assigns unique display labels before serialization. Amounts/method/readiness are unchanged. | Collision fixture proves both labels/amounts survive and the record ID is removed. |
| Planning's minimum 3% category bar width depicted a positive amount for a zero forecast estimate. | Presentation helper gives zero estimates zero width and retains small positive values proportionally. | Forecast presentation regression covers zero, all-zero scale and a small positive estimate. |

No financial arithmetic, accounting rules, emergency-buffer formula, forecast readiness, risk thresholds, purchase horizons, ownership convention or schema was changed in this task. Reads now reject inconsistent ownership instead of exposing/using it. The existing zero-month purchase limitation and 1-120 month horizons remain in force.

## Migration and persistence safety

- Existing chain tests exercise fresh installation, selected historical upgrades, FK/index contracts, failed later migrations and retry/rollback, and rerun preservation.
- New `product-migration-audit.test.mjs` additionally upgrades a populated legacy ledger from **every released migration prefix**, then reruns the complete bundle. Existing profile, account balance and transaction values survive, history remains unconfirmed rather than backfilled, and migrated repositories read the rows successfully.
- A new seed failure injection aborts profile insertion and verifies all newly inserted users/profiles/accounts/categories/goals roll back. Removing the disposable trigger permits a clean, idempotent retry.
- File close/reopen persistence verifies transactions, native transfers, profile edits, targets, account balances and conversation messages together.
- Existing mutation tests continue to cover transaction/transfer reversals, overdraft validation, rollback and ownership boundaries.

All tests use `:memory:` databases or uniquely named temporary fixture files. Temporary files are closed and removed explicitly. The application's real `kifayat.db` was never opened or modified. Database initialization code was inspected without importing its native singleton into tests.

## Security/reliability review

- Mobile chat imports local repositories/context; no mobile source imports Prisma or a demo-user identifier. The dedicated server route imports the mobile handler rather than the demo tool builder. Static assertions and mocked client/handler tests cover this separation.
- `GROQ_API_KEY` is read only by the server route. No provider key is placed in mobile `EXPO_PUBLIC_*` settings. No environment secrets were read for this audit.
- The provider receives approved sentence catalogues rather than conversations, transaction rows or tool/database access. Client responses are checked against the original local snapshot. Unsupported claims/warnings/amounts fall back deterministically.
- Chat retains the existing 12-message request window, local conversation persistence, retries and submission lock. The integrated conversation exceeds the window while retaining all local messages.
- Repository searches and financial mutations remain parameterized through Drizzle/SQLite bindings. Activity applies fixed ownership and retains native/legacy transfer separation.
- Existing/new generation guards and save locks cover Activity, Overview, profile, goals, chat, resource reads, purchases, accounts and opening balances where applicable. No credentials or query parameter values are intentionally rendered/logged by the modified error paths.
- Existing constrained chat scope, shared-pool goal progress and recorded-average installment rule remain product limitations, not newly missing features. No unrelated investment/credit product or web parity was added.

## Automated results

- Full mobile `npm test`: **316 passed, 0 failed** (baseline before this task: 299).
- Targeted integrated/migration/privacy/opening/forecast checks: 45 passed before the final account-race regression; the final full suite includes that regression and every targeted test.
- Mobile typecheck: passed (`tsc --noEmit` and test project).
- Mobile lint: passed with the obsolete suppression removed.
- Migration/disposable-SQLite integration tests: included and passed.
- `git diff --check`: passed.

No dependencies were installed, no migrations were added/changed, no root/web dependencies were installed to force unrelated checks, and no Git staging, commits, pushes, resets, cleaning or branch changes occurred. Every earlier modified/untracked file was preserved.

## Manual acceptance and delivery blockers

No known automated code/data-consistency blocker remains for **final manual device testing**. This audit does not establish native-release or live-provider acceptance. Final delivery sign-off still needs:

1. An isolated QA installation/test ledger on the intended native platforms: navigation, keyboard/scroll behavior, small displays, loading/retry states and screen-reader controls.
2. Device restart persistence and return-from-editor/settings/goal/opening-balance refresh behavior through actual native controls.
3. If live AI mode is part of delivery, the configured trusted HTTPS backend/provider path on device, including real network interruption, timeout and fallback behavior. Automated provider tests here are mocked; local deterministic mode does not require a provider key.

No additional major feature or schema change is proposed as a delivery prerequisite. Unverified device/provider behavior must not be described as tested. Existing source-review and fixture evidence makes the implementation ready to enter those manual acceptance checks.

## Files added/changed in this verification task

- `mobile/src/app/_layout.tsx`
- `mobile/src/app/(tabs)/planning.tsx`
- `mobile/src/app/add-transaction.tsx`
- `mobile/src/app/add-transfer.tsx`
- `mobile/src/app/transaction/[id].tsx`
- `mobile/src/app/transfer/[id].tsx`
- `mobile/src/hooks/use-api.ts`
- `mobile/src/lib/repositories/transactions-core.ts`
- `mobile/src/lib/services/account-management-ui.ts`
- `mobile/src/lib/services/opening-balance-workflow-ui.ts`
- `mobile/src/lib/services/chat-context-core.ts`
- `mobile/src/lib/services/purchase-assessment-ui.ts`
- `mobile/src/lib/services/resource-loader-core.ts`
- `mobile/src/lib/services/user-facing-error.ts`
- `mobile/src/lib/finance/forecast-presentation.ts`
- `mobile/tests/chat-context.test.ts`
- `mobile/tests/forecast-presentation.test.ts`
- `mobile/tests/integration-regressions.test.ts`
- `mobile/tests/mobile-product-journeys.test.mjs`
- `mobile/tests/product-migration-audit.test.mjs`
- `mobile/docs/phase-6-integrated-verification.md`
