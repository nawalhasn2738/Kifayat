# Phase 5 Task 4: native Overview dashboard

## Existing implementation and SRS comparison

Overview already showed total stored balance, month-to-date expenses/income, the engine savings rate, risk score/band/reasons, a spending-only monthly bar list, and top three spending categories. It used one Promise.all for summary/risk, so a risk/profile failure hid every financial section. It omitted net savings, reserve position, savings goals, income-versus-expense trends, forecast/projection comparisons and recent activity. The prior spending bars gave zero values a nonzero minimum width and did not qualify incomplete periods.

The original `SRS.md` FR-1 and FR-9 call for KPI, trend, category, risk-factor, forecast and goal information. Its numerical boundary statements explicitly define low ≤30 and high >60. Existing mobile code used `<30` and `<60`, mislabelling exactly 30 and 60. This task corrects those mobile band boundaries only; the score's arithmetic, weights and component rules are unchanged. SRS descriptions of web technology, seed-user examples and different forecast methods were not ported: mobile retains its existing financial engine, readiness rules and native components. Existing web chart components depend on web/Recharts and are not suitable native components; the native charts use accessible labelled Views without new dependencies.

## Added indicators and meaningful comparisons

Overview now shows stored current balance, recorded income/expenses/net savings MTD, existing recent-month savings rate, existing daily-pace month-end spending estimate, risk score and five weighted components, emergency reserve position, paired historical income/expense bars, recorded-versus-forecast spending, top category shares, compact goal progress/recommendation, and five recent events.

All amounts reuse existing services. The rate remains the summary engine's ratio of rounded average savings to rounded average income over its latest up to three recorded months, potentially including the current partial month; it is labelled accordingly and is unavailable when the denominator is zero. No separate MTD rate or alternative income calculation was introduced. The balance includes stored balances across the summary's accounts, including archived accounts; it is not a historical reconstruction or an earmarked goal balance.

Historical charts cover complete Karachi months within the previous six calendar months. The current partial month is shown separately as MTD cash flow. Months before confirmed complete coverage have null chart values and are omitted instead of being zero-filled. Confirmed eligible empty months are zero. Zero monetary amounts have zero-width bars, not a decorative minimum width. Income and expense bars share a common scale. Labels and accessible text include actual PKR values and full year-month context.

The daily-pace projection uses `summary.spend.thisMonthProjected` and requires confirmed history coverage from this month's start. The separate three-complete-month forecast uses the unchanged forecast service/readiness result, including its range, qualifying-month method and current-month exclusion. Recorded MTD, previous full-month actual and monthly forecast are separately labelled; the UI explicitly warns that these durations differ and forecasts are not guarantees.

## Reserve and goal definitions

Reserve position compares current active checking/savings balances against the existing affordability buffer. To avoid synthetic purchase inputs or duplicated arithmetic, existing eligible-account selection/summation and complete-month averaging were factored into `affordabilityFunds` and `completeMonthAverages`; the existing buffer expression was extracted into `calculateEmergencyBuffer`. Affordability itself calls the same helpers. The formula stays max(profile emergency target, three times average spending across the three qualifying complete months). Position is the checked whole-PKR difference between eligible balance and required buffer. Missing profile/readiness/accounts yields unavailable, never a made-up reserve amount. A required buffer is explicitly distinct from actual savings or goal allocation.

Goal progress and recommendations reuse `getSavingsPlanning` with the dashboard cutoff. The existing shared recorded-net-savings definition remains: this is a common cash-flow pool, not independent allocations to each goal. Up to three goals are shown, with full amounts, remaining target, capped percentage and an explicit shared-pool warning. Missing progress is null, deficits remain explained, and the Planning link exposes full management. Recommendation estimates retain the recorded-data rule and its readiness; they are not promised savings or transfers.

## Risk explanations and readiness

`calculateRisk` now exposes its five existing component values and weights alongside score/band/reasons. Existing spending/income, volatility and savings reasons remain. The category-share and anomaly-share explanation triggers match the already existing web explanation conditions (>25% and >5% respectively); these add explanations only, not new score components. The fallback wording now refers to rule thresholds rather than making a broad health claim. A prior timezone test was updated to expect the newly exposed category-share explanation while continuing to assert the identical score of 28 and timezone independence.

Dashboard risk requires a valid financial profile, at least one account, and confirmed coverage of the risk engine's actual current-month-plus-two-preceding-month window. These are presentation-readiness checks; unavailable or incomplete inputs are not represented as a low score. Ready risk is explicitly qualified as using a current partial month. Configured monthly income and the five component/weight percentages make its actual inputs visible. The engine still uses saved monthly income where it did before.

## Sources, cutoff and refresh

`createDashboardService` composes existing summary, history-state, profile, forecast, risk, savings-planning, active-account and paginated Activity providers. It captures one cutoff and passes it through supported services; `getSavingsPlanning` gained an optional asOf argument while retaining its previous default for existing callers. Sections settle independently, so an unavailable forecast/profile/goal read does not hide valid recorded totals or recent events. Errors have safe section-specific explanations. Empty accounts are distinct from a valid zero-valued ledger.

Recent activity calls the existing filtered/keyset service with pageSize 5 and a half-open upper bound one millisecond after the cutoff. It does not use an uncapped activity read, although financial aggregates still use their existing complete-record calculation services. Native and legacy transfers remain separate from income/expenses, keep their detail routes, and show source/destination or historical transaction information. Dates are Karachi calendar dates; merchant/category, description and PKR amount are displayed. A clear route opens full filtered Activity.

Overview refreshes on focus and pull-to-refresh, with an accessible Refresh Overview button. Returning from transactions, transfers, profile settings or goal management therefore reads current values. The new controller discards late responses after newer refreshes or blur. It hides prior financial figures during refresh/failure rather than presenting stale conclusions as current. Existing Overview Settings and Accounts navigation remain intact. The off-white/green native theme and KPI grid are retained, with simple separated sections instead of nested chart cards.

## Tests, limits and files

Disposable SQLite integration tests verify service consistency, MTD totals/savings, reserve equivalence with affordability, goal progress, historical/forecast chart inputs, bounded recent events with future exclusion and transfer handling, missing/partial history, missing profile, empty accounts/ledger, section failures, and fresh values after financial mutations. Unit tests cover SRS band boundaries, reserve overflow safety, leap/year trend periods, missing-versus-zero chart values, refresh races, blur and error recovery. Existing finance, forecast, affordability and profile suites are included in focused/full checks.

No schema/migration/dependency changes were made. No real `kifayat.db` was opened, no web parity was added and earlier work was preserved. No staging, commits, pushes, resets, cleaning or branch changes occurred. Native-device layout, keyboard/navigation, screen-reader behavior and screenshots were not verified. Historical trend display is intentionally limited to the previous six calendar months; Activity remains the full-history browsing destination. These are stored-record indicators, not a full picture of unrecorded obligations or funds.

Files changed for this task:

- `mobile/src/app/(tabs)/index.tsx`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/types.ts`
- `mobile/src/lib/services/dashboard-core.ts`
- `mobile/src/lib/services/dashboard.ts`
- `mobile/src/lib/services/dashboard-ui.ts`
- `mobile/src/lib/services/finance-core.ts`
- `mobile/src/lib/services/affordability-core.ts`
- `mobile/src/lib/services/savings-planning-core.ts`
- `mobile/tests/dashboard.test.ts`
- `mobile/tests/dashboard-repository.test.mjs`
- `mobile/tests/finance-reporting.test.ts`
- `mobile/docs/phase-5-overview-dashboard.md`

Verification: 59 focused dashboard/finance/forecast/affordability/profile tests passed. Full mobile `npm test` passed all 299 tests. Mobile typecheck and lint passed. `git diff --check` passed.
