# Phase 5 Task 1: editable financial profile

## Storage and supported fields

The native `/profile-settings` stack screen is reachable through the Overview header's Settings button, including when Overview data fails to load. It edits only `user_profiles.monthly_income` and `user_profiles.emergency_fund_target`. The existing risk tolerance, dependents, personal notes, financial-history start date, identifiers and ownership are preserved. No new storage, migrations, dependencies or calculation formulas were added.

The catalog repository exposes `getProfileSettings(): Promise<FinancialProfileInput | null>` and `saveProfileSettings(input): Promise<FinancialProfileInput>`. The latter validates both values, updates only those two columns on the existing owned row using the repository's fixed user ID, and returns the saved values with SQLite RETURNING. There is no caller-selected identity or upsert. The production repository keeps `LOCAL_USER_ID = 1`.

Missing profiles return null and are displayed as unconfigured, never as zero. The screen links to the existing Financial Planning recovery flow. A read failure has a retry state and cannot enable saving. Existing monetary columns are non-null; saved numeric zero is displayed as `0`, while an empty edit is rejected and never converted to zero. There is no historical metadata identifying whether existing nonzero values were seeded or user-confirmed; the screen explicitly explains that existing values may include initial defaults.

## Input and persistence

Both fields accept whole PKR digits (outer whitespace is trimmed) from 0 through the existing `MAX_PKR_AMOUNT` of 2,147,483,647. Empty values, fractions, negative numbers, formatted comma input, exponent notation, nonnumeric values and excessive values are rejected. Repository validation also checks numeric type, safe integer and range, independently of the screen.

The screen uses a scroll view, keyboard avoidance, numeric keyboards, accessible labels, saving/error/success states and a synchronous controller lock. Failed saves preserve typed edits, show no success, and allow retry. Inputs and save operations are blocked during loading/saving. Saving updates the existing row atomically and does not require a separate refresh to confirm persistence.

`seedLocalProfile()` remains unchanged: it returns when the local user exists, preserving saved edits on subsequent launches. Its new-install defaults remain PKR 120,000 monthly income and PKR 240,000 emergency target. It does not repair an existing user's missing profile; that continues to use the explicit recovery flow. Settings do not alter the separately stored savings goal target or recorded money.

## Calculation flow

Existing services read `catalog.getProfile()` afresh for each calculation, so subsequent risk, affordability and mobile-chat purchase assessments see saved values. `getRisk` / `calculateRisk` use monthly income for the spending-to-income component. `createAffordabilityService` uses the emergency target through the unchanged `calculateAffordability`: the buffer is max(profile target, three times qualifying complete-month average expenses). Forecasts and recorded-income summaries use transactions rather than configured monthly income, so their numerical results remain unchanged.

Overview refreshes on navigation focus. Planning refreshes history/forecast on focus and clears the previously displayed affordability assessment; the next assessment reads current settings. An emergency target is a reserve rule, not confirmed savings or an account balance. Updating it does not modify any transactions, account balances, financial-history confirmation or savings goals.

## Verification and limitations

`profile-settings.test.ts` covers loading, strict validation, zero versus missing data, safe read/write failures, retained edits and duplicate/overlapping submission protection. `profile-repository.test.mjs` uses migrated disposable SQLite databases to cover owned updates, unrelated-field preservation, seed preservation, failed-write atomicity, actual file close/reopen persistence, and updated settings reaching existing dependent calculations. Existing forecast/affordability suites remain part of focused and full verification.

No real `kifayat.db` is opened by these tests. Native-device navigation, keyboard behavior and a native app restart have not been exercised; close/reopen persistence is verified with the disposable SQLite fixture. No web profile feature was added.

Final checks: 36 focused profile/affordability/forecast tests passed; full mobile `npm test` passed all 260 tests; mobile typecheck, mobile lint and `git diff --check` passed.

Files added or changed for this task (earlier Phase 4 work was preserved):

- `src/app/profile-settings.tsx`
- `src/app/_layout.tsx`
- `src/app/(tabs)/_layout.tsx`
- `src/app/(tabs)/index.tsx`
- `src/app/(tabs)/planning.tsx`
- `src/lib/api.ts`
- `src/lib/repositories/catalog-core.ts`
- `src/lib/repositories/catalog.ts`
- `src/lib/services/profile-settings-ui.ts`
- `src/lib/validation/profile.ts`
- `tests/profile-settings.test.ts`
- `tests/profile-repository.test.mjs`
- `docs/phase-5-profile-settings.md`
