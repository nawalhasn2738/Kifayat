# Phase 3 Financial Policy Decision Record

## Status and purpose

This record captures approved and proposed answers to financial-policy questions identified after Phase 2. It is documentation only and does not itself implement application behavior, schema changes, migrations, synchronization, or revised calculations.

The reporting-timezone and forecast-readiness policies are **APPROVED**. Every unrelated policy below remains **PROPOSED — NOT YET APPROVED** and must be approved, rejected, or amended by the product owner before implementation begins.

The mobile client is the current local financial source of truth. It opens its own Expo SQLite `kifayat.db` through Drizzle. The retained web application uses Prisma and its separately configured `DATABASE_URL`; its calculations and records are not a shared live mobile ledger. Where mobile and legacy web behavior differ, this record treats them separately.

## Current evidence and constraints

- Mobile reporting stores canonical UTC transaction instants and now uses the approved `Asia/Karachi` calendar utility for monthly buckets, current/previous-month selection, month-to-date categories, and projection boundaries.
- Mobile savings are income minus expenses in each populated monthly bucket; transfers are excluded.
- Mobile forecast readiness uses the three complete Karachi reporting months immediately before the current month, zero-fills qualifying post-start empty months, excludes the partial current month, and returns `forecast: null` with a stable reason when unavailable. Ready forecasts retain the existing total calculation; category forecast output remains empty.
- Mobile creation idempotency uses a unique client request ID. Identical reuse returns the existing row; conflicting or cross-user reuse is rejected. This is a local mutation contract, not a cross-device synchronization design.
- The mobile schema has one account per transaction and no transfer link, destination account, explicit opening balance, refund link, category applicability type, or synchronization metadata.
- Read-only reconciliation reports `candidate opening balance = stored balance - signed transaction effects` and does not repair data.
- `formatPKR` currently removes signs with `Math.abs`, including for values where a negative sign is financially meaningful.
- Legacy web reporting still derives its separate savings figure from negative transfer rows. That rule is not proposed for mobile.

## Decision summary

| Policy | Recommended option | Status |
| --- | --- | --- |
| Reporting timezone | Fixed `Asia/Karachi` calendar boundaries for the PKR-only release | **APPROVED** |
| Financial-history start | Explicit persisted per-user history-start instant | **APPROVED** |
| Forecast minimum | Three complete consecutive months after history begins | **APPROVED** |
| Empty months | Zero-fill complete empty months after history begins | **APPROVED** |
| Synchronization identity | Keep the current release local-only; design globally unique immutable operation IDs before sync | **PROPOSED — NOT YET APPROVED** |
| Transfers | Dedicated transfer record with two linked, equal-and-opposite account effects | **PROPOSED — NOT YET APPROVED** |
| Opening balances | Explicit signed integer opening balance per account, introduced through reconciliation-led migration | **PROPOSED — NOT YET APPROVED** |
| Category applicability | Dedicated constrained applicability field, independent of display hierarchy | **PROPOSED — NOT YET APPROVED** |
| Refunds | Linked refund records that reduce expenses in the refund posting period | **PROPOSED — NOT YET APPROVED** |
| Signed formatting | Signed totals/availability; absolute transaction amounts with explicit direction | **PROPOSED — NOT YET APPROVED** |

## 1. Reporting timezone and calendar-month boundaries

**Status: APPROVED**

### Unresolved question

Which timezone determines the first and last instant of a reporting month, the current partial month, historical complete months, and forecast windows?

### Options considered

1. Device-local timezone at the time a report is viewed.
2. A fixed application timezone, `Asia/Karachi`, for the PKR-only release.
3. A persisted user-selected IANA timezone.
4. UTC calendar months.

### Approved decision

**APPROVED:** `Asia/Karachi` is the fixed mobile reporting timezone for the initial PKR-focused release. Transaction timestamps remain stored as canonical UTC instants. Reporting calendar months use `Asia/Karachi` boundaries, with the start of each month inclusive and the start of the following month exclusive.

This is preferred over device-local time because travel or a device setting change would otherwise move historical transactions between months. It is preferred over raw UTC because the product is currently PKR- and Pakistan-focused. A persisted user-selected timezone can replace the fixed setting only through a later explicit product change.

### Effects

- Reporting: dashboard, category, savings, risk, and monthly totals use the same month boundaries.
- Forecasts: the current partial month and three preceding complete months become deterministic.
- Balances: no balance arithmetic changes; only period attribution changes.
- User experience: month totals remain stable when the device timezone changes.

### Migration and compatibility

No transaction timestamp rewrite is recommended. Existing UTC instants should be re-bucketed at read time. Historical totals near UTC month boundaries may change. The legacy web application must not be assumed to match until its date helpers explicitly adopt the same policy.

### Approval record

The product owner explicitly approved this policy for Mini-task 3.3. Mini-task 3.3 added the named-timezone calendar utility and focused boundary tests. Mini-task 3.7 integrated that utility into `finance-core.ts` monthly reporting. Transaction timestamps remain canonical UTC instants; no forecast-readiness policy was approved by that integration.

## 2. Beginning of usable financial history

**Status: APPROVED**

### Decision question

What date proves that a complete financial record exists, so earlier missing months are treated as unavailable history rather than zero activity?

### Options considered

1. Date of the earliest transaction.
2. Account creation date.
3. First app installation or seed date.
4. An explicit persisted per-user financial-history start chosen or confirmed during onboarding/import.

### Approved decision

Persist an explicit per-user `financialHistoryStartedAt` instant. It should mean: “From this reporting instant onward, Kifayat is expected to contain the user’s complete financial activity.” New users confirm it during onboarding or import. For an existing user with transactions, offer the earliest valid transaction instant only as a suggested start; the user must confirm it or choose an alternative date. A user with no transactions must also be able to establish a start explicitly. The value must not be inferred repeatedly from the earliest transaction because a user can have a genuine zero-activity month or delete the earliest transaction.

### Effects

- Reporting: periods before the start are “unavailable,” not zero.
- Forecasts: readiness can distinguish missing history from complete empty months.
- Balances: no direct balance effect.
- User experience: users understand why a forecast is unavailable despite having some transactions.

### Migration and compatibility

The separately reviewed additive schema migration is present in the current working tree and leaves existing values null without backfill. For existing installations, the earliest valid transaction may be offered as a suggestion but must not silently claim completeness. Users with no transactions require an explicit way to confirm a start date; absence of transactions is not evidence that a month was completely tracked. The value remains separate from opening-balance semantics. Expo SQLite device migration behavior is not yet verified.

### Approval outcome

Approved and implemented at schema/service level: an explicit persisted per-user history-start instant, using the earliest valid transaction only as a suggested date for existing users, with explicit confirmation/correction commands and no automatic backfill. The user-facing flow for users with or without transactions remains unimplemented.

## 3. Minimum forecast-history requirements

**Status: APPROVED**

### Decision question

How much complete history is required before Kifayat may label a number as a forecast?

### Options considered

1. Forecast from any available month.
2. Forecast from one or two months but mark confidence as low.
3. Require exactly three complete consecutive months and otherwise return no forecast.
4. Require three complete months for the official forecast but optionally show clearly labelled historical observations while readiness is insufficient.

### Approved decision

Require the three complete consecutive reporting months immediately before the current month. If fewer than three complete months exist after `financialHistoryStartedAt`, return a structured `insufficient_history` result and do not present a numeric value as a next-month forecast. The UI may show available historical totals, clearly labelled as history rather than a provisional forecast.

### Effects

- Forecasts: prevents a partial current month or sparse older buckets from being presented as a three-month forecast.
- Reporting: ordinary current-month actuals remain available.
- Balances: no effect.
- User experience: the planning screen explains how many complete months are available and when forecasting becomes ready.

### Migration and compatibility

No persisted transaction values were rewritten. The mobile forecast response type and planning unavailable state now implement the contract, so existing users receive no numeric forecast until readiness is established. The missing history-start UI prevents users from completing that workflow in the current app. The legacy web forecast still lacks this readiness contract.

### Approval outcome

Approved: three complete consecutive preceding Karachi months are the minimum, and no numeric forecast is returned while history is insufficient.

## 4. Empty months after history begins

**Status: APPROVED**

### Decision question

Does a complete month with no transactions count as zero activity, get skipped, or make the forecast invalid?

### Options considered

1. Skip it and substitute an older populated month.
2. Treat it as zero once it is known to be within complete financial history.
3. Mark any empty month as incomplete and block forecasting.

### Approved decision

Treat a complete empty month on or after `financialHistoryStartedAt` as zero income, zero expenses, and zero savings. Keep it in its chronological position. Never replace it with an older populated month. Months before history begins remain unavailable rather than zero.

### Effects

- Reporting: monthly series becomes consecutive and explicitly includes zero-activity months.
- Forecasts: zero activity affects the mean and variation honestly.
- Balances: no effect.
- User experience: charts show a zero month instead of silently jumping over it.

### Migration and compatibility

This is implemented as a read-model change, not a transaction rewrite. Existing averages and forecasts can differ from the earlier populated-bucket behavior. It depends on the confirmed persisted history start and does not rewrite transactions.

### Approval outcome

Approved: complete empty months after confirmed history begins count as zero; pre-history and partial-first months remain unavailable.

## Approved unified forecast-readiness contract

**Status: APPROVED**

This subsection records the product owner's approved history-start, minimum-history, empty-month, response, reason-code, UI-guidance, deletion-stability, correction/audit, and required-testing policies. Subsequent task-specific authorizations produced the schema and service implementation described below; the policy approval itself did not authorize unrelated work.

### Current implementation evidence

The current mobile schema includes nullable `financialHistoryStartedAt` profile state and an append-only confirmation/correction audit table. Services validate and display the canonical value, derive advisory suggestions without writing, explicitly recover a genuinely missing profile with a null start, and atomically confirm or correct the start with audit records. Forecast readiness reads that state, selects exactly the three immediately preceding complete `Asia/Karachi` months, zero-fills qualifying empty months, excludes the partial current month, and returns `forecast: null` with a stable reason when unavailable. Focused host-side tests cover these paths. No mobile screen currently exposes confirmation, correction, or recovery, and Expo SQLite device behavior remains unverified.

### Approved qualifying-history rules

1. Determine the current reporting month using the approved `Asia/Karachi` timezone and its start-inclusive, end-exclusive boundaries.
2. Exclude the entire current reporting month from forecast history, even when it contains transactions. It is incomplete until the next Karachi month boundary.
3. Consider only the three calendar months immediately preceding the current reporting month. Do not replace one of them with an older populated month.
4. A month qualifies only if the app's complete financial history covers that whole month:
   - if `financialHistoryStartedAt` is exactly the start of that Karachi month, the month qualifies after it ends;
   - if history begins after the month has started, that first partial month does not qualify;
   - months before the established history start are unavailable, not zero.
5. A qualifying complete month with no transactions counts as a zero-activity month. It remains in the three-month series with zero income, zero expenses, and zero savings.
6. Forecast readiness is `ready` only when all three immediately preceding months qualify. Otherwise it is `insufficient_history`.
7. Transfers remain excluded under the existing mobile reporting rule. This readiness proposal does not change the forecast formula itself.

### Approved service result contract

When ready, return a result that identifies the three qualifying month keys and contains the numerical forecast. When history is insufficient, return structured readiness metadata and no numerical forecast:

```text
status: insufficient_history
requiredCompleteMonths: 3
availableCompleteMonths: 0 | 1 | 2
qualifyingMonths: [ordered Asia/Karachi YYYY-MM keys]
forecast: null
reason: stable machine-readable reason plus user-facing explanation
```

The UI should state that three complete calendar months are required, show how many are currently available, and identify when another month will become complete. It may show clearly labelled historical actuals, but it must not display a provisional value as “next-month forecast,” a forecast range, or an affordability input derived from that unavailable forecast.

The stable reason values are `history_start_unconfirmed`, `insufficient_complete_months`, and fail-closed `invalid_history_start`. The exact TypeScript shape remains an implementation-design detail. Insufficient or invalid history carries no numerical forecast, and clearly labelled historical actuals and readiness guidance may appear while waiting.

### Testable examples

All month boundaries below use `Asia/Karachi`.

| Scenario | Example at report time | Qualifying history | Approved result |
| --- | --- | --- | --- |
| New user | Current month is May 2026; no confirmed `financialHistoryStartedAt` and no complete history | None | `insufficient_history`, `availableCompleteMonths: 0`, `forecast: null` |
| One complete month | History is confirmed complete from April 1; report time is May 10 | April only | `insufficient_history`, `availableCompleteMonths: 1`, `forecast: null` |
| Two complete months | History is confirmed complete from March 1; report time is May 10 | March and April | `insufficient_history`, `availableCompleteMonths: 2`, `forecast: null` |
| Three complete months | History is confirmed complete from February 1; report time is May 10 | February, March, and April | `ready`; forecast uses exactly February–April |
| Empty month inside established history | History begins February 1; March has no transactions; report time is May 10 | February, March=`0`, April | `ready`; March remains the middle observation and is not replaced |
| Partial current month | History begins January 1; April contains transactions; report time is April 15 | January, February, and March | `ready`; all April activity is excluded from forecast history |
| Partial first history month | History is confirmed from February 10; report time is June 10 | March, April, and May | `ready`; partial February does not qualify |

### Approval record

The product owner explicitly approved the recommended forecast-readiness package: persisted and confirmed per-user history start; explicit existing-user and no-transaction-user confirmation; validated corrections with audit history; deletion stability; three complete consecutive preceding Karachi months; post-start empty months as zero; pre-history and partial-first months unavailable; `forecast: null` while insufficient; stable reasons `history_start_unconfirmed`, `insufficient_complete_months`, and fail-closed `invalid_history_start`; labelled historical actuals and readiness guidance; and the required regression, compatibility, and UI tests.

The product owner first authorized a design-only schema-migration review and later issued task-specific implementation authorizations. The additive schema/migration and service code are present in the current working tree and are host-tested. This record does not authorize further schema work, real-device migration, UI work, or persisted-data changes.

## 5. Cross-device synchronization and request identity

**Status: PROPOSED — NOT YET APPROVED**

### Unresolved question

Should the local client request ID become a cross-device identity, and what guarantees are required before synchronization exists?

### Options considered

1. Reuse the current generated client ID unchanged as a global sync identity.
2. Introduce globally unique immutable operation IDs plus device and synchronization metadata.
3. Use server-assigned IDs only.
4. Keep the current release explicitly local-only and defer synchronization design.

### Recommended option

Keep the current release explicitly local-only. Preserve the implemented client-request-ID idempotency contract for local transaction creation. Before adding synchronization, design a separate immutable globally unique operation identity—such as a UUID—with an explicit user namespace, origin-device identity, conflict/version metadata, and server acknowledgement state. Do not infer cross-device safety from the current `local-${Date.now()}-${random}` generator.

### Effects

- Reporting and balances: no current change; avoids merging unproven duplicate or conflicting mutations.
- Forecasts: no current change.
- User experience: data remains device-local until synchronization is intentionally delivered.

### Migration and compatibility

Future synchronization will require schema changes and a policy for assigning global IDs to existing local rows without changing their financial effects. The separate web Prisma database must not be treated as an implicit synchronization backend or merged automatically.

### Exact decision needed

Approve that Phase 3 remains local-only and that cross-device synchronization requires a separate design using global immutable operation IDs rather than treating current request IDs as sufficient.

## 6. Transfer representation and reporting

**Status: PROPOSED — NOT YET APPROVED**

### Unresolved question

How should one logical transfer produce two atomic account effects while remaining identifiable, editable, and reportable as one operation?

### Options considered

1. Two ordinary transaction rows sharing a transfer ID.
2. One dedicated transfer row with source and destination account fields, with balances updated directly.
3. A dedicated transfer entity plus two linked account-effect rows.
4. Continue using unlinked positive and negative `transfer` rows.

### Recommended option

Use a dedicated transfer entity plus two linked account-effect legs. The transfer stores user, positive whole-PKR amount, source account, destination account, effective instant, request identity, and descriptive fields. Its two effects are equal and opposite and are created, edited, or deleted atomically.

Reporting must exclude both legs from income, expenses, and primary savings. Total net worth must not change. Account activity may show each directional effect, while transaction history may group them as one transfer. A savings-account transfer may be a separate contribution metric but is not earned savings.

### Effects

- Balances: source decreases and destination increases by exactly the same amount in one transaction.
- Reporting: no income, expense, savings, or net-worth change from the transfer itself.
- Forecasts: transfer legs remain excluded.
- User experience: one transfer can be viewed, edited, or deleted as one logical action.

### Migration and compatibility

A reviewed migration is mandatory. Existing single-account legacy transfer rows cannot be assumed to form valid pairs; they require classification, pairing evidence, or preservation as read-only legacy records. Stored balances must not be silently recalculated. The legacy web seed’s conventionally paired rows are not structurally guaranteed pairs.

### Exact decision needed

Approve the dedicated-transfer-plus-two-effects model, grouped presentation, transfer exclusion rules, and a non-destructive review policy for legacy transfer rows.

## 7. Opening-balance representation and reconciliation

**Status: PROPOSED — NOT YET APPROVED**

### Unresolved question

How should pre-Kifayat money be represented without fabricating historical transactions or changing existing stored balances?

### Options considered

1. Insert a synthetic opening-balance transaction.
2. Store a signed integer `openingBalance` on each account.
3. Derive opening balance on every read from stored balance minus transactions.
4. Reset existing balances to the sum of recorded transactions.

### Recommended option

Store an explicit signed whole-PKR `openingBalance` per account, distinct from ordinary income and transactions. Preserve the invariant:

```text
expected balance = opening balance + sum of active account effects
difference = stored balance - expected balance
```

For new accounts, require the user to enter or confirm the opening balance, defaulting visibly to zero. For existing accounts, use the current read-only candidate calculation as migration evidence, preserve the stored balance, and do not create synthetic income or silently repair discrepancies.

### Effects

- Balances: opening money becomes explicit without affecting income or savings reports.
- Reporting and forecasts: opening balances are excluded from income, expenses, savings, and forecasts.
- User experience: users can distinguish starting funds from money earned during a report period.

### Migration and compatibility

This requires a reviewed migration and fixtures representing matched, nonzero-candidate, malformed, and legacy-transfer accounts. A candidate opening balance is diagnostic, not automatically trustworthy. Existing installations require confirmation or a documented review state before a candidate is accepted.

### Exact decision needed

Approve a signed integer per-account opening balance, exclusion from performance reporting, and a migration that preserves stored balances while requiring review of derived candidates.

## 8. Authoritative category/type applicability

**Status: PROPOSED — NOT YET APPROVED**

### Unresolved question

How should the repository decide whether a category is valid for an income, expense, transfer, or future refund?

### Options considered

1. Infer applicability from category names.
2. Treat the existing free-text `parent` value as authoritative.
3. Add one constrained category type.
4. Add an explicit constrained applicability model capable of representing one or more allowed financial types.

### Recommended option

Add an explicit constrained applicability model independent of display hierarchy. For the current single-purpose seed categories, an enum-like value such as `income`, `expense`, or `transfer` is sufficient; if product requirements need a category valid for multiple types, use a normalized applicability relation or validated set rather than overloading `parent`.

Repository validation must be authoritative. `parent` remains presentation/grouping metadata. `null` category remains allowed for income and expense unless separately prohibited.

### Effects

- Reporting: prevents income from being assigned an expense category and vice versa.
- Balances: no arithmetic change.
- Forecasts: improves category forecast integrity.
- User experience: category choices are consistent between UI filtering and persisted validation.

### Migration and compatibility

Requires a reviewed mapping for every existing category, especially `savings_transfer`, `anomaly`, and any user-created or arbitrary-parent rows. Unknown mappings must be surfaced for review rather than inferred from names. SQL constraints may require a SQLite table rebuild.

### Exact decision needed

Approve a dedicated constrained applicability model, decide whether categories may apply to multiple financial types, and approve the migration mapping for all existing category data.

## 9. Refund representation and reporting periods

**Status: PROPOSED — NOT YET APPROVED**

### Unresolved question

How should returned money link to an expense and affect balances and reports, especially when the refund occurs in a later month?

### Options considered

1. Record refunds as ordinary income.
2. Mutate or delete the original expense.
3. Add a linked refund record and restate the original expense period.
4. Add a linked refund record and reduce expenses in the refund posting period.

### Recommended option

Represent a refund as a distinct positive account effect linked to an original expense. It increases the receiving account but is not income. Report it as a reduction of expenses in the refund’s own posting period, while preserving the original period as historically recorded. Permit partial refunds up to a clearly defined cumulative limit no greater than the original expense unless an explicit adjustment policy is later approved.

### Effects

- Balances: receiving account increases by the refund amount.
- Reporting: refund-period expenses decrease; income does not increase; original-period reports are not silently rewritten.
- Forecasts: use net expense after refunds in each posting period, subject to future forecast-method approval.
- User experience: the refund is traceable to its purchase and historical reports remain reproducible.

### Migration and compatibility

Requires schema support for refund type/linkage and repository rules for ownership, account choice, cumulative amount, deletion, and atomic effects. Existing ordinary income must not be automatically reclassified. Negative net expense categories or months need explicit display and forecast tests.

### Exact decision needed

Approve linked refunds, refund-period expense reduction rather than original-period restatement, partial-refund limits, and treatment of negative net expense totals.

## 10. Negative balance/availability display and signed PKR formatting

**Status: PROPOSED — NOT YET APPROVED**

### Unresolved question

Which monetary values should display a negative sign, and which should display an absolute amount with a separate direction indicator?

### Options considered

1. Continue applying `Math.abs` to all formatted PKR values.
2. Always render the stored signed number.
3. Use separate signed-total and absolute-transaction formatters according to financial meaning.

### Recommended option

Use separate formatting contracts:

- Preserve the minus sign for account balances, total balance, available-after-buffer, savings, cash flow, shortfall-adjacent calculations when negative, reconciliation differences, and projected balances.
- Display income and expense transaction magnitudes as positive PKR amounts only when an explicit `+`/`−` indicator, label, or color communicates direction.
- Display report expense totals as positive magnitudes because the label already defines them as expenses.
- Do not use color alone to communicate a sign.

Use integer PKR storage unchanged; formatting must not round or alter persisted values.

### Effects

- Reporting and balances: users can see debt, overspending, and negative availability accurately.
- Forecasts: nonnegative expense forecast ranges remain magnitudes; signed savings forecasts, if later added, retain signs.
- User experience: removes the current risk that `PKR 5,000` visually hides an underlying `-5,000` balance or availability.

### Migration and compatibility

No database migration is required. UI call sites and accessibility labels require review and focused tests. Existing screenshots or snapshots may change.

### Exact decision needed

Approve separate signed-total and absolute-transaction formatting contracts, including the listed fields that must preserve signs.

## Approval checklist

Only explicitly approved decisions are checked below.

- [x] Fixed `Asia/Karachi` reporting timezone and half-open month boundaries approved.
- [x] Persist `financialHistoryStartedAt`, including field ownership, nullability, validation, and existing-user handling, approved.
- [x] Existing-user suggestion and confirmation flow approved.
- [x] No-transaction-user history-start flow approved.
- [x] Correction/audit behavior and deletion stability for a confirmed start approved.
- [x] Three-complete-consecutive-month threshold approved.
- [x] Zero-fill policy for complete empty post-start months and unavailable pre-history or partial-first months approved.
- [x] `insufficient_history` with `forecast: null` approved.
- [x] Machine-readable reasons `history_start_unconfirmed`, `insufficient_complete_months`, and fail-closed `invalid_history_start` approved.
- [x] Historical actuals and readiness guidance while insufficient approved.
- [x] Required regression, compatibility, service-contract, and UI tests approved.
- [x] Design review and the current additive schema/migration were separately authorized and implemented; real-device migration and further schema work remain unapproved.
- [ ] Local-only Phase 3 scope and separate future synchronization identity approved.
- [ ] Dedicated transfer plus two linked effects and legacy review policy approved.
- [ ] Explicit opening balance and reconciliation-led migration approved.
- [ ] Authoritative category applicability model and mapping approved.
- [ ] Linked refund and refund-period reporting policy approved.
- [ ] Signed-total versus absolute-transaction formatting contract approved.

## Implementation gate

This document is not authorization to modify code or data. Later task-specific approvals authorized the current additive schema/migration and history-start/readiness service implementation; they did not authorize further migrations, real-device data changes, user-facing workflow work, or unrelated policies. Cross-device synchronization, transfers, opening balances, category applicability, refunds, and signed formatting remain proposed and unapproved.
