# Phase 3 Forecast-Readiness Approval Review

## Review status

**FORECAST-READINESS POLICY PACKAGE APPROVED BY THE PRODUCT OWNER.**

**PACKAGE STATUS: APPROVED.**

This review records the product owner's explicit approval of the recommended forecast-readiness package. The fixed `Asia/Karachi` reporting timezone remains approved and is the calendar basis for these decisions.

This approval originally recorded policy only. Subsequent, separately authorized tasks added the schema/migration and history-start/readiness services now present in the working tree. This review does not authorize additional schema, UI, device-migration, or persisted-data work.

## Reconciled decision status

| Forecast-readiness decision | Repository status |
| --- | --- |
| Persist and confirm `financialHistoryStartedAt` | **APPROVED** |
| Require three complete consecutive preceding Karachi months | **APPROVED** |
| Zero-fill complete empty post-start months | **APPROVED** |
| Return `insufficient_history` with `forecast: null` | **APPROVED** |
| Show labelled historical actuals and readiness guidance while insufficient | **APPROVED** |

These statuses match `phase-3-policy-decisions.md`. The approved `Asia/Karachi` calendar policy remains unchanged.

The approved reporting-calendar utility is integrated into `finance-core.ts`. The current readiness service also enforces the three immediately preceding complete Karachi months, zero-fills qualifying post-start empty months, excludes the partial current month, and returns `forecast: null` with stable reasons when unavailable. History-start read, recovery, confirmation, correction, and audit services exist. The user-facing history-start workflow remains unimplemented, and Expo SQLite device behavior remains unverified.

## Approved product-owner decisions

### 1. Persist the beginning of complete financial history

**Approved decision:** Persist `financialHistoryStartedAt` per user. It means that Kifayat expects the user's financial records to be complete from that instant onward. For an existing user, offer the earliest valid transaction instant only as a suggested date and require confirmation or an alternative date. A user with no transactions must also be able to establish a start explicitly.

**Consequence:** The app can distinguish an unavailable month before tracking began from a genuine zero-activity month after tracking began. If the start falls after the beginning of a Karachi calendar month, that first partial month would not count as complete forecast history.

**Risks:** A wrong or silently inferred start date could make incomplete data look complete and produce misleading forecasts. Deleting an early transaction must not move the confirmed history start.

### 2. Require three complete consecutive months

**Approved decision:** Produce an official forecast only when the three complete, consecutive `Asia/Karachi` calendar months immediately before the current month all qualify as complete history. Never substitute an older populated month.

**Consequence:** Forecast inputs are stable and comparable. The current partial month is excluded even when it contains transactions. A new user waits until three qualifying months have ended before receiving an official numerical forecast.

**Risks:** Existing users do not receive a numerical forecast until Kifayat has a confirmed start and three qualifying months. The service now enforces this rule, but users cannot complete confirmation through the current UI.

### 3. Count complete empty months as zero activity

**Approved decision:** A complete month after the confirmed history start with no transactions remains in the three-month series as zero income, zero expenses, and zero savings. Months before the confirmed start remain unavailable rather than zero.

**Consequence:** A real inactive month affects the forecast instead of being skipped and replaced by older spending. Consecutive calendar history remains intact.

**Risks:** Forecast values may decrease materially when a genuine empty month is included. Without a trustworthy history start, the app cannot safely distinguish zero activity from missing records.

### 4. Return no numerical forecast when history is insufficient

**Approved decision:** Return structured `insufficient_history` metadata with `forecast: null` whenever fewer than three qualifying months exist. Do not display a provisional number as the official forecast.

The metadata should at least communicate:

- three required complete months;
- the number currently available;
- the ordered qualifying month keys;
- a stable reason and user-facing explanation.

**Consequence:** Services and UI can represent readiness honestly instead of returning a number derived from incomplete history.

**Risks:** The forecast response type and consumers must change after approval. Any affordability or other feature that later depends on forecast output must handle the unavailable state explicitly rather than treating `null` as zero.

### 5. Optionally show labelled historical actuals while waiting

**Approved decision:** While readiness is insufficient, the UI may display available historical actuals, the qualifying-month count, and an explanation of when forecasting becomes ready. Historical values must be labelled as actuals and must not appear as a forecast, projected range, or official estimate.

**Consequence:** Users still receive useful context without being misled by a premature forecast.

**Risks:** Ambiguous labels, chart styling, or copy could make historical actuals look predictive. The final UI wording and machine-readable reason values need focused review and tests.

## Approved existing-user handling

For an existing user with transactions, offer the earliest valid transaction instant as a **suggested** `financialHistoryStartedAt` value only. Do not silently store or treat it as confirmed: earlier activity may be missing, imported incompletely, or intentionally absent. The user must confirm or choose an appropriate start under an approved migration/onboarding flow.

A user with no transactions also needs a way to establish the history start. The absence of transactions cannot distinguish a new account from a complete zero-activity period. The product owner must decide whether such a user confirms a start during onboarding, account setup, migration review, or another explicit workflow.

## Schema and migration outcome

The separate design review and later task-specific authorizations produced the nullable profile field, additive migration, and audit table currently present in the working tree. The reviewed design covered:

- field ownership and nullability;
- canonical UTC storage and Karachi calendar interpretation;
- existing users with transactions;
- existing users without transactions;
- confirmation, correction, and audit behavior;
- rollback and compatibility with databases created before the migration.

The migration has no default or silent backfill, and host-side tests cover fresh and `0000` upgrade paths. No Expo SQLite device migration or real-user data change is established by that evidence. Further schema, migration, or persisted-data changes require separate review and approval.

## Explicit approval record

The product owner explicitly approved all recommended forecast-readiness policies, including:

- per-user nullable `financialHistoryStartedAt` stored as a canonical UTC instant, with validation and no silent backfill;
- earliest-transaction suggestions that require confirmation or replacement, plus an explicit start flow for users without transactions;
- deliberate validated corrections with an audit trail, and no implicit change after deleting the earliest or all transactions;
- three complete consecutive preceding `Asia/Karachi` months, excluding the current partial month and never substituting older populated months;
- complete empty post-start months as zero, with pre-history and partial-first months unavailable;
- `forecast: null` while history is insufficient or invalid, with qualifying-month metadata and no official provisional number;
- stable reasons `history_start_unconfirmed`, `insufficient_complete_months`, and fail-closed `invalid_history_start` for invalid or impermissibly future persisted values;
- clearly labelled historical actuals, qualifying-month counts, readiness guidance, and the required regression, compatibility, service-contract, and UI tests.

The product owner separately authorized the design review and later authorized the individual implementation tasks reflected in the current working tree. Those authorizations did not approve a real-device migration, additional schema work, or unrelated financial policies.

## Pre-approval recommendation record (superseded)

The material below preserves the alternatives and unchecked review form that existed before explicit approval. Its awaiting-approval labels and unchecked boxes are historical and do not override the approval record above.

The following record is intentionally decision-ready but not approved. Every recommendation has package status **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** and repository approval status **PROPOSED — NOT YET APPROVED**. Alternatives are listed so that accepting the recommendation is an explicit product choice rather than an inferred default.

| # | Decision | Recommended default | Alternatives and consequences | Dependencies and required tests | Approval status |
| --- | --- | --- | --- | --- | --- |
| 1 | Persist complete-history start | Persist a per-user `financialHistoryStartedAt` canonical UTC instant independently from transactions; never silently backfill or confirm it. | Derive it from the earliest transaction, account creation, or installation date, or do not track it. Derived dates can move or falsely claim completeness; no start means empty and unavailable months cannot be distinguished safely. | Depends on decisions 2–6 and a separately authorized migration design. Test that readiness reads the confirmed value and never silently infers, backfills, or confirms one. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 2 | Ownership, nullability, and existing users | Store one nullable value owned by the local user/profile; `null` means not confirmed. Existing users remain `null` until an approved confirmation flow completes. | Per-account ownership makes cross-account forecasting ambiguous. A non-null default or silent backfill can assert completeness without evidence. A separate confirmation-state field is possible but increases schema and state complexity. | Requires schema-location, foreign-key, UTC-storage, validation, compatibility, and rollback decisions before migration design. Test ownership isolation, `null`, confirmed values, old databases, and users with and without transactions. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 3 | Existing users with transactions | Suggest the earliest valid transaction instant, but require the user to confirm it or choose another valid date. | Automatically accept it, use account creation, or require manual entry without a suggestion. Automatic acceptance risks incomplete history; manual-only entry adds friction. | Depends on decisions 1–2 and the confirmation UI/API contract. Test suggestion-only behavior, confirmation, replacement, cancellation, invalid dates, and no silent persistence. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 4 | Users without transactions | Let the user explicitly choose or confirm a start during onboarding, account setup, or migration review; do not infer completeness from an empty ledger. | Wait for the first transaction, use installation/account creation automatically, or leave readiness unavailable indefinitely. Waiting delays the first qualifying month; automatic dates may be false; indefinite `null` prevents forecasts. | Depends on decisions 1–2 and a product-selected entry point. Test zero-transaction confirmation, cancellation, a complete empty month after confirmation, and continued unavailability while unconfirmed. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 5 | Correction and audit | Permit deliberate correction under defined validation rules, never alter the value implicitly, and retain an audit trail for corrections. | Make the date immutable, allow unaudited overwrite, or model append-only revisions. Immutability traps mistakes; unaudited edits reduce traceability; revisions add schema and UI complexity. | Audit representation and retention require an explicit decision before migration design. Test authorization, valid/invalid corrections, readiness recalculation, cancellation, and audit creation. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 6 | Transaction deletion stability | Deleting the earliest transaction—or all transactions—does not change or clear a confirmed history start. Only the explicit correction flow may change it. | Recalculate from the next transaction or clear the date when the ledger becomes empty. Either option makes readiness depend on deletion and can reclassify previously complete periods. | Depends on independent persistence from decision 1. Test earliest deletion, all-transactions deletion, non-earliest deletion, empty qualifying months, and unchanged history-start storage. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 7 | Forecast threshold and window | Require the three complete consecutive `Asia/Karachi` reporting months immediately before the current month; exclude the current partial month and never substitute an older populated month. | Require one, two, or more months; allow nonconsecutive populated months; or include the current month. Shorter/sparse windows become available sooner but are less comparable; longer windows delay readiness; current-month inclusion creates partial-period bias. | Depends on the approved Karachi calendar and decisions 1 and 8. Test 0–3 qualifying months, exact month boundaries, year rollover, leap February, current-month exclusion, and no older substitution. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 8 | Empty, partial-first, and pre-history periods | Count a complete empty month as zero only after the confirmed start. A first month that begins before the confirmed instant is partial and does not qualify; all pre-history periods are unavailable, not zero. | Skip empty months, block on any empty month, or count partial/pre-history months as zero. Skipping distorts chronology; blocking treats genuine inactivity as missing; zero before completeness can understate activity. | Depends on decisions 1 and 7. Test an empty middle month, empty edge months, start exactly at a Karachi boundary, mid-month start, and pre-history transactions/months. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 9 | Insufficient-history service contract and reasons | Return `status: insufficient_history`, `forecast: null`, required/available month counts, ordered qualifying month keys, and one stable reason: `history_start_unconfirmed` or `insufficient_complete_months`. Keep user-facing text separate from reason codes and never present a provisional number as official. | Return a provisional number, throw an error, return zero, or use free-text-only reasons. A number can mislead, errors treat normal readiness as failure, zero looks financial, and free text is unstable for consumers. | Depends on decisions 1, 7, and 8 and requires a response-type change. Test both reason codes, exact counts/keys, `forecast: null`, ready results, serialization, and consumers never treating `null` as zero. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 10 | Waiting-state UI | Show clearly labelled historical actuals, the qualifying complete-month count, and concise reason-specific next-step guidance; visually and verbally distinguish actuals from forecasts. Do not render an official forecast, range, or forecast-derived affordability value. | Show only an unavailable message, hide the feature, or show a provisional estimate. Minimal messaging is simpler but less helpful; hiding reduces discoverability; provisional estimates risk being mistaken for forecasts. | Depends on decision 9 and approved copy/design. Test labels, counts, reason-specific guidance, accessibility, ready/insufficient transitions, and absence of forecast presentation while unavailable. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 11 | Required verification | Require deterministic calendar/unit tests, forecast-contract tests, repository integration tests where persistence is involved, UI state tests, and migration compatibility/rollback tests only after a migration is separately approved. | Rely only on unit tests, manual checks, or current reporting tests. Narrower coverage can miss persistence, consumer, boundary, and existing-database regressions. | Depends on the approved choices and later implementation scope. The complete minimum test list follows this table. | **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** |
| 12 | Schema-migration design review | Authorize a separate design-only review after forecast choices 1–11 are decided. The review must not edit schemas or data and is not migration approval. | Defer the review, reject persistence, or authorize implementation immediately. Deferral blocks persisted readiness; rejecting persistence requires a different completeness model; immediate implementation bypasses compatibility and rollback review. | Depends on explicit approval of persistence-related policy choices. A later design must cover placement, nullability, ownership, UTC semantics, backfill prohibition, confirmation, correction/audit, rollback, and existing-user test fixtures. | **NOT AUTHORIZED UNTIL THE PRODUCT OWNER EXPLICITLY CONFIRMS IT** |

### Reason-code coverage requiring confirmation

The two recommended codes cover the normal readiness states currently identified:

- `history_start_unconfirmed`: no confirmed history-start value exists.
- `insufficient_complete_months`: a confirmed start exists, but fewer than the required complete consecutive months qualify.

An invalid, malformed, or impermissibly future persisted history-start value is a data-validation or integrity failure, not automatically an ordinary readiness state. The product owner and later technical design must decide whether such corruption fails closed as an error or receives an additional stable reason code. This record does not invent or approve that behavior. A user who can correct a valid confirmed date remains covered by the deliberate-correction policy rather than a new readiness code.

### Minimum required tests before implementation is complete

- Existing-user suggestion, confirmation, cancellation, and replacement dates.
- New users without transactions, including explicit confirmation and remaining unconfirmed.
- Unconfirmed, malformed, impossible, noncanonical, and impermissibly future start dates.
- Canonical UTC instants immediately before and exactly at Karachi reporting-month boundaries.
- Zero, one, two, and three qualifying complete months.
- Exclusion of the current partial reporting month.
- Complete empty months after the confirmed start, including empty middle and edge months.
- Pre-history periods and a partial first history month.
- No substitution of older populated months for a required consecutive month.
- Deletion of the earliest transaction, all transactions, and unrelated later transactions without implicit start-date changes.
- Explicit start-date correction, authorization, validation, readiness recalculation, and audit behavior.
- Service/API `forecast: null`, qualifying-month metadata, stable reason codes, serialization, and consumer handling.
- UI treatment of insufficient history, labelled historical actuals, qualifying counts, next-step guidance, accessibility, and ready-state transitions.
- Migration compatibility, old-database handling, rollback, ownership isolation, and no silent backfill only if migration design and implementation are separately authorized.

## Separate migration-design authorization

**Authorize a design-only schema-migration review?**

**Current status: NOT AUTHORIZED UNTIL THE PRODUCT OWNER EXPLICITLY CONFIRMS IT.**

- Approval of the recommended forecast policies does not authorize migration design.
- Authorization for migration design does not authorize migration implementation.
- Migration implementation requires separate approval after the design, compatibility risks, rollback plan, and existing-user handling have been reviewed.
- This task authorizes no schema, migration, database, or persisted-data change.

## Approval choices

Every recommendation below is **RECOMMENDED — AWAITING EXPLICIT PRODUCT-OWNER APPROVAL** and remains **PROPOSED — NOT YET APPROVED** in the repository. The product owner should explicitly approve, reject, or amend each item independently:

- [ ] **Persistence:** Recommended option — persist `financialHistoryStartedAt` per user. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Field design:** Recommended option — define explicit user ownership, nullable-before-confirmation behavior, and existing-user handling. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Existing users with transactions:** Recommended option — offer the earliest valid transaction only as a suggestion and require confirmation or an alternative date. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Users without transactions:** Recommended option — provide an explicit onboarding, account-setup, or migration-review action to establish the start. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Correction and audit:** Recommended option — allow an explicit correction flow and decide whether changes require audit metadata; never change the value implicitly. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Deletion stability:** Recommended option — keep the confirmed start unchanged when the earliest transaction, or all transactions, are deleted. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Readiness threshold:** Recommended option — require the immediately preceding three complete consecutive Karachi months; otherwise specify another exact threshold. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Empty months:** Recommended option — zero-fill complete empty post-start months and keep pre-start or partial-start months unavailable. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Insufficient history:** Recommended option — return structured `insufficient_history` metadata with `forecast: null` and no official provisional forecast. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Reason codes:** Recommended option — define a stable finite set of machine-readable readiness reasons separately from user-facing explanations. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Waiting-state UI:** Recommended option — permit clearly labelled historical actuals, qualifying-month counts, and readiness guidance while insufficient. Approval status — **PROPOSED — NOT YET APPROVED**.
- [ ] **Migration design gate:** Recommended option — authorize a separate schema-migration design review only. Approval status — **PROPOSED — NOT YET APPROVED**; this would not approve a migration or persisted-data change.

Until explicit approval is recorded, all twelve boxes remain unchecked and no forecast-readiness implementation should begin. Approval of forecast behavior would not by itself authorize the `financialHistoryStartedAt` schema migration.
