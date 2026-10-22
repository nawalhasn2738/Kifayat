# Kifayat Mobile Financial Rules

## 1. Purpose and scope

This document defines the approved financial rules for Kifayat's mobile application before implementation changes are made. Expo SQLite is the mobile source of truth, and Drizzle ORM is the data-access layer. The retained backend may provide secure AI services, but it does not define or silently replace the mobile ledger.

Three labels are used throughout:

- **Existing behavior** describes behavior verified in the current source at checkpoint `36019d9`.
- **Approved target** is the rule future implementation work must satisfy.
- **Future recommendation** is explicitly deferred and is not current functionality.

This specification covers PKR amounts, transactions, balances, transfers, savings, reporting, forecasts, deletion, and data integrity. It does not claim that the approved targets are already implemented.

## 2. Definitions

### Income

- **Approved target:** Money received from an external source. The user enters a positive whole-rupee amount, and the transaction increases the selected account balance.
- Income is included in income totals for its reporting period.
- A transfer or refund is not ordinary income.

### Expense

- **Approved target:** Money paid to an external destination. The user enters a positive whole-rupee amount, and the transaction decreases the selected account balance.
- Expenses are included in expense totals for their reporting period.

### Transfer

- **Approved target:** One logical movement of a positive amount from one local account to another account owned by the same local user.
- A transfer decreases the source balance and increases the destination balance atomically.
- It does not count as income or expense and does not change total net worth.
- Moving money to a savings account does not by itself create newly earned savings.

### Account balance

- **Approved target invariant:** `account balance = opening balance + sum of active financial transaction effects`.
- An income effect is positive, an expense effect is negative, and a transfer has equal and opposite effects on its two accounts.
- **Existing behavior:** `accounts.balance` remains the current balance. A separate nullable signed `openingBalance` is unconfirmed when null; seeded and migrated accounts remain null until explicit confirmation.

### Savings

- **Approved target:** `income - expenses` over the same reporting period.
- Transfers are excluded from both sides of this calculation.
- Goal contributions may be reported separately but must not be added to primary savings as income.
- **Current mobile behavior:** savings is income minus expenses within each populated monthly reporting bucket. Transfer rows are excluded from income, expenses, and primary savings. The retained web/Prisma reporting helper still derives its separate legacy savings figure from negative transfer rows; that behavior does not define the mobile ledger.

### Forecast

- **APPROVED target:** An estimate based on the three complete, consecutive `Asia/Karachi` calendar months immediately before the current month, excluding the current partial month and excluding transfers.
- A historical average is not itself a forecast; the UI must label historical values and future estimates distinctly.

## 3. Approved financial rules

### 3.1 Currency and precision

1. The initial release supports PKR only.
2. User-entered money is a positive whole number of rupees.
3. Decimal input is rejected explicitly. It must never be truncated or silently rounded.
4. Monetary values are stored as integers. Display formatting is separate from storage and must preserve negative signs where financially meaningful.
5. Currency conversion and multi-currency accounts are unsupported in the initial release.

**Current verified behavior:** SQLite uses integer monetary columns. Transaction and affordability price inputs use the shared strict `parsePkrAmount` boundary, capped at PKR 2,147,483,647; malformed, signed, decimal, exponent, zero, and out-of-range inputs are rejected without truncation. Affordability planning horizons are whole numbers from 1 through 120 months; malformed, fractional, non-finite, unsafe, and out-of-range values are rejected. General PKR formatting preserves signed safe-integer values, including negative balances and availability. Transaction presentation uses a separate explicit direction-plus-magnitude formatter.

**Current future-date policy:** the repository rejects new future-dated income and expense transactions and edits that newly make an income or expense future-dated, using canonical UTC instants and its injected current-time source. Existing future-dated rows are preserved; an idempotent replay may return an existing row, an unchanged-date edit remains supported, and deletion uses the existing atomic balance reversal. Scheduled transactions are unsupported. History-start remains separate from opening-balance and current-balance state.

**Current creation-idempotency behavior:** each mobile create attempt supplies a non-empty client request ID. Reusing that ID with the same user and identical normalized transaction details returns the existing row without applying another balance effect. Reusing it for different details or another user is rejected. This is implemented and covered by repository integration tests; it does not imply cross-device synchronization or a retry contract for the separate web/Prisma transaction API.

### 3.2 Income and expense creation

1. Validate the complete input before beginning a mutation.
2. Confirm the selected account belongs to the local user.
3. If a category is supplied, confirm that it exists and is valid for the transaction type.
4. Income increases the selected account by the entered amount.
5. Expense decreases the selected account by the entered amount.
6. Insert the transaction and update the account in one SQLite transaction.
7. Failure at any step must leave neither a partial transaction nor a partial balance change.

### 3.3 Insufficient funds

1. Before creating or editing an expense, compare its resulting effect with the selected account's current balance.
2. If the result would be negative, show a clear warning that identifies the account and resulting balance.
3. Do not save until the user explicitly confirms the overdraft.
4. After confirmation, allow the negative balance.
5. The initial rule is a warning-and-confirmation policy, not an account-type-specific overdraft policy.
6. **Deferred:** distinct policies for cash, checking, savings, credit, or other future account types.

**Current verified behavior:** create and update calculate the authoritative projected balance inside the SQLite transaction. A negative result throws a typed error containing the account and projection. The API/UI displays a confirmation dialog and retries with an exact account/projection token; stale tokens are rejected. Repository behavior is covered by in-memory tests, but React Native dialog interactions do not yet have automated component coverage.

### 3.4 Transfers

Implemented mobile SQLite/Drizzle representation:

- Store one dedicated transfer row with source and destination account references.
- Treat those references and the positive amount as equal-and-opposite ledger effects.
- Require source and destination account IDs, positive whole amount, date, and client-generated idempotency ID.
- Require different accounts owned by the same local user.
- Create, edit, or delete both effects in one SQLite transaction.

Migration 0003 adds this representation without converting legacy single-account transfer transaction rows. Legacy rows remain readable and mutation-blocked.

Transfer reporting rules:

- Exclude both legs from income and expense.
- Net-worth effect must be zero.
- Account activity may display both legs or one grouped transfer, but totals must not double-count it.
- A transfer to savings may be shown as a contribution metric separately from primary savings.

### 3.5 Editing

1. Load the existing active transaction for the local user.
2. Validate the complete replacement state.
3. Within one SQLite transaction, reverse the old financial effect and apply the new effect.
4. Changing accounts must reverse the old account and apply the new account.
5. Changing income to expense or expense to income must reverse the old sign and apply the new sign.
6. Editing a transfer must update both linked effects atomically.
7. If a revised expense would overdraw its account, require explicit confirmation.

**Existing behavior:** income and expense edits retain their existing behavior. Dedicated transfers can be corrected atomically; legacy single-account transfer rows remain read-only.

### 3.6 Deletion

1. Hard deletion is permitted in the initial MVP.
2. The user must confirm before deletion.
3. Deletion and reversal of every balance effect must be atomic.
4. Deleting a transfer must reverse both account effects.
5. A failed deletion must leave the original transaction and balances unchanged.

**Existing behavior:** transaction and dedicated-transfer detail screens confirm deletion. Dedicated transfer deletion reverses both effects atomically; legacy transfer rows remain protected.

**Future recommendation:** consider reversal records or soft deletion if audit history becomes a requirement. Do not implement that as part of the initial MVP rules.

## 4. Opening balances and balance consistency

Accounts have a nullable signed opening balance. Null means unconfirmed, including for seeded and migrated accounts; zero becomes confirmed only through explicit action. Reliable suggestions include ordinary effects and both sides of owned dedicated transfers. Any legacy single-account transfer or invalid dedicated-transfer relationship makes the suggestion ambiguous and blocks confirmation or replacement. Corrections preserve subsequent activity with `new current = current + (new opening - old opening)` and append an atomic audit record.

### Approved introduction approach

1. Do not infer an opening balance by rewriting existing transactions.
2. Before adding a field, define the migration baseline for existing installations:
   - preserve each existing stored balance;
   - calculate the sum of active transaction effects;
   - derive a candidate opening balance as `stored balance - transaction effects`;
   - report discrepancies for review rather than silently rewriting data.
3. After review, store an explicit integer `openingBalance` per account, defaulting to zero only for new accounts.
4. Migration and reconciliation must be tested against copies or fixtures, not real user databases during development.
5. All later balance mutations must pass through one canonical repository/domain service.

### Reconciliation requirement

Provide a read-only reconciliation calculation:

```text
expected balance = opening balance + sum of active effects
difference = stored balance - expected balance
```

- A difference of zero is consistent.
- A nonzero difference is reported with account ID and magnitude.
- Detection must not silently repair data.
- Any repair mechanism is a separate, explicitly confirmed operation.

## 5. Reporting rules

### Calendar periods

1. **APPROVED:** Define mobile reporting months in `Asia/Karachi` while retaining transaction timestamps as canonical UTC instants.
2. Current-month totals cover the first day of the current month through the reporting time.
3. Historical monthly values cover complete calendar months.
4. Reporting-month ranges are start-inclusive and end-exclusive: `[monthStart, nextMonthStart)`.
5. **APPROVED:** Forecast history uses the three complete consecutive months immediately before the current month.
6. Future-dated records are excluded from historical and current actual totals until their effective date.
7. **APPROVED:** Financial risk uses the current partial `Asia/Karachi` reporting month plus the two immediately preceding complete reporting months. Its expense window is start-inclusive at the oldest month boundary and includes transactions through the report `asOf` instant; later transactions are excluded.

The named-timezone reporting-calendar utility is integrated into mobile monthly bucketing, current/previous-month selection, month-to-date categories, projection boundaries, financial-risk selection, and the separately authorized forecast-readiness service.

### Empty months

- **APPROVED:** For a qualifying forecast window, a complete month after the confirmed financial-history start with no matching transactions contributes zero.
- **APPROVED:** Do not skip qualifying empty months and replace them with older populated months; months before confirmed history begins and partial first months remain unavailable.
- **APPROVED:** If fewer than three qualifying complete months exist, return structured `insufficient_history` metadata with `forecast: null`; do not present a provisional number as the official forecast.
- **APPROVED:** Use stable reasons `history_start_unconfirmed`, `insufficient_complete_months`, and fail-closed `invalid_history_start`.

### Totals

- Total balance is the signed sum of account balances.
- Income contains income transactions only.
- Expenses contain expense transactions only, with positive display totals.
- Primary savings is income minus expenses for the identical period.
- Transfers are excluded from income, expense, and primary savings.
- Hard-deleted records do not appear in active totals.
- Refunds and pending transactions receive no special handling until those features are implemented.

### Forecast

**APPROVED AND IMPLEMENTED SERVICE CONTRACT:** The initial forecast-readiness contract retains the transparent mean and variation measure and:

- uses exactly the preceding three complete consecutive months;
- includes zero-activity months;
- excludes transfers;
- reports insufficient history;
- identifies the output as an estimate;
- documents the method in user-facing text.

**Current behavior:** the readiness service requires a valid confirmed `financialHistoryStartedAt` and exactly the three complete `Asia/Karachi` months immediately before the current reporting month. Qualifying empty months contribute zero, and the partial current month is excluded. Unconfirmed, invalid, or insufficient history returns typed readiness metadata with `forecast: null`. Ready total and category estimates use the same rounded three-month mean and population-standard-deviation range; category gaps within the window are zero-filled, uncategorized expenses are grouped explicitly, and categories seen only outside the window are excluded. Each category estimate is rounded independently, so displayed category estimates are not required to sum exactly to the independently calculated overall estimate; no rounding redistribution policy has been approved. The Planning screen exposes explicit history-start confirmation, correction, and missing-profile recovery.

## 6. Data-integrity requirements

### Application validation

Enforce in UI/domain/repository validation:

- strict whole-rupee parsing;
- positive input amounts;
- supported transaction type;
- valid date under the chosen calendar policy;
- account ownership;
- category existence and applicability;
- different source and destination accounts for transfers;
- insufficient-funds warning and explicit confirmation;
- idempotency for retried mutations;
- complete transfer balance equality.

The repository/domain layer is authoritative. Screens must not implement independent balance arithmetic.

### SQLite constraints where practical

Future migrations should consider enforcing:

- not-null required fields;
- foreign keys;
- unique client/idempotency identifiers;
- allowed transaction and account types with `CHECK` constraints;
- positive canonical input/transfer amounts where compatible with the chosen ledger representation;
- source and destination inequality for a dedicated transfer entity;
- indexes supporting user/date, account, category, and transfer lookups.

SQLite constraints complement application validation; they do not replace ownership, warning, or user-confirmation logic.

### Atomicity

Create, edit, delete, and transfer operations must use one SQLite transaction for every affected record and balance. Any thrown error must abort the complete mutation.

## 7. Unsupported functionality in the initial release

The following are explicitly unsupported unless a later specification approves them:

- Dedicated refunds or expense reversals.
- Pending, authorized, cleared, or reconciled transaction states.
- Multiple currencies and exchange rates.
- Fractional-rupee entry.
- Bank synchronization.
- Automatic overdraft policies by account type.
- Credit-card debt and credit limits.
- Split transactions.
- Recurring-transaction generation.
- Soft deletion and immutable audit history.

Ordinary income must not be silently reinterpreted as a refund.

### Future refund recommendation

A future refund should link to its original expense, increase the receiving account, and reduce the relevant expense reporting without counting as earned income. Its reporting-period policy must be approved before implementation.

## 8. Current-versus-target gaps

| Area | Current behavior | Target behavior and status | Likely files affected | Required change | Risk or migration consideration |
|---|---|---|---|---|---|
| Transfers | Dedicated user-owned transfer rows identify source, destination, amount, date, request identity, and description; balances change atomically and source overdrafts reject. Activity groups each new transfer once. Legacy transaction transfer rows remain readable and read-only. | Implemented on mobile; excluded from income, expenses, savings, and forecasts | Transfer schema/migration, repository, validation, API, and add/detail/list screens | Verify Expo SQLite and rendered UI on a device | No account-specific activity screen; legacy rows are not automatically paired |
| Balance consistency | Stored balance is updated atomically alongside supported CRUD. Reconciliation reports signed effects and an advisory opening-balance candidate without repair. | Opening balance plus active effects equals stored balance | Schema, migrations, account/transaction/transfer/opening-balance repositories, seed, tests | Preserve the implemented confirmation, correction, and audit invariants | Candidate opening balance is diagnostic and ambiguous ledgers fail closed |
| Opening balances | Nullable signed opening balance, append-only audit, reconciliation-led confirmation/correction, and Planning UI are implemented; null is unconfirmed and zero requires explicit confirmation | Approved behavior is implemented and host-tested | Schema/migration, repository, API, Planning screen, and tests | Verify Expo SQLite and rendered interaction on a device | Existing stored balances are preserved; ambiguous ledgers fail closed |
| Amount parsing | Shared strict parsing is used by transaction and affordability inputs; the maximum is PKR 2,147,483,647. | Reject the complete non-whole input without truncation | Add-transaction and planning screens, validation utilities, tests | Completed for current monetary input paths | Future monetary inputs must reuse the same boundary |
| Savings | Mobile reporting calculates income minus expenses within each populated `Asia/Karachi` monthly bucket and excludes transfers; the separate legacy web helper still uses negative transfer rows | Income minus expenses over the same period | Finance service, types, dashboard, tests | Mobile primary savings and approved calendar attribution are aligned; retain transfer exclusion | Web behavior remains separate |
| Forecasts | Readiness uses the previous three complete Karachi months, zero-fills qualifying post-start empty months, excludes the partial current month, and returns `forecast: null` with stable reasons when unavailable; ready total and category estimates use the same mean and population-standard-deviation method | Approved readiness contract and category estimates are implemented | Finance service, history-start/readiness services, types, planning screen, tests | Verify Expo SQLite and rendered UI behavior on a device | Device-specific behavior remains unverified |
| Negative formatting | General PKR formatting preserves signs; transaction rows explicitly separate direction from magnitude | Preserve signs for balances/availability; use explicit sign only where presentation requires it | Money-format utility, dashboard, planning, transaction screens | Verify rendered output on an emulator or device | Device typography and screen-level rendering remain unverified |
| Insufficient funds | Repository rechecks the projection in its SQLite transaction and requires exact account/projection confirmation; API/UI provides Cancel and Confirm. | Warn, require explicit confirmation, then allow | Add/edit screen, repository/domain mutation input, tests | Repository/API/UI flow completed | Dialog behavior lacks automated React Native component tests |
| Category integrity | Explicit normalized applicability rows drive UI choices and repository validation; null remains valid for income/expense; historical unmapped assignments remain readable | Approved mapping and enforcement are implemented and host-tested | Schema/migration/seed, catalogue, transaction repository, UI helper, and tests | Verify Expo SQLite and rendered interaction on a device | `anomaly`, `savings_transfer`, and custom categories remain unmapped unless explicitly configured |
| Database constraints | Text types lack SQL `CHECK` constraints | Enforce stable invariants where practical | Schema and new migration | Add constraints only after compatibility review | SQLite table-rebuild migrations can risk data loss |
| Tests | On October 22, 2026, `npm test` from `mobile/` passed 210 host-side tests with 0 failures. | Mutation, rollback, migration-chain, reporting, history/start, readiness, UI-orchestration, category, transfer, opening-balance, and formatting coverage | Mobile test setup and finance/repository tests | Continue with rendered UI, CI, and Expo SQLite device coverage | Host tests do not prove Expo SQLite/device parity; root/web checks remain outside this evidence |

## 9. Historical implementation sequence

The sequence below records the implementation order that guided the work. Steps 1–6 are now implemented with host-side coverage. It is retained as historical rationale, not as a list of missing features; rendered Expo/React Native and Expo SQLite device qualification remain deferred.

### 1. Establish real SQLite integration-test capability

- Create isolated, disposable test databases.
- Test migration application, foreign keys, transactions, and rollback.
- Never open the user's application database.
- Acceptance: tests prove a failed multi-step mutation leaves all rows and balances unchanged.

### 2. Formalize financial mutation and balance invariants

- Centralize create/edit/delete effects in a domain mutation service or the existing canonical repository.
- Add balance-effect unit cases and real-database integration tests.
- Add read-only reconciliation against the current model before adding opening balances.
- Acceptance: every mutation preserves the documented invariant, and discrepancies are detectable.

### 3. Implement strict PKR amount parsing and validation

- Validate raw strings before numeric conversion.
- Reject decimals, signs, exponent notation, empty input, overflow, and mixed characters.
- Reuse the same rule in transaction and affordability inputs.
- Acceptance: no invalid input is truncated or rounded.

### 4. Introduce transfer representation and atomic behavior

- Choose linked legs or a dedicated transfer entity.
- Design and test the migration, including any pre-existing `transfer` rows.
- Implement source/destination validation and atomic create/edit/delete.
- Acceptance: account effects are equal and opposite and total net worth is unchanged.

### 5. Align savings and reporting calculations

- Define explicit calendar windows.
- Compute primary savings as income minus expenses.
- Exclude transfers consistently.
- Preserve signed balances in presentation.
- Acceptance: dashboard figures derive from documented fixtures and identical periods.

### 6. Correct forecast windows and preserve reconciliation checks

This policy, service behavior, and Planning-screen workflow were separately authorized and implemented after the original design review. Remaining qualification is rendered UI and Expo SQLite device/runtime verification; no further schema or persisted-data change is implied here.

- Use the previous three complete consecutive months.
- Zero-fill complete empty months.
- return an insufficient-history state where appropriate.
- Preserve the existing read-only account reconciliation reporting while forecast behavior changes.
- Acceptance: month-boundary, empty-month, partial-current-month, and drift fixtures pass.

Opening-balance schema and workflow work was subsequently completed after the migration and reconciliation prerequisites were established.

## 10. Remaining deferred decisions

### Implemented policy: category applicability

**Verified current state:**

- Categories use the normalized `category_applicability` relation with constrained transaction types.
- The existing **parent** column remains display-only metadata and is not authoritative for applicability.
- New transaction category options come from explicit applicability rows, not names or parent values.
- Transaction create/update validate explicit applicability before balance arithmetic or writes. Distinct typed outcomes cover nonexistent, unmapped, and incompatible categories; `null` remains permitted for income and expense.
- Repository logic must not infer applicability from category names.

**Approved and implemented behavior:**

1. Applicability is represented by explicit normalized rows, including multiple types only through multiple rows.
2. Seeded income and expense mappings are explicit; `anomaly`, `savings_transfer`, and custom categories remain unmapped unless configured.
3. Historical unmapped assignments remain readable and may be retained only for an otherwise unrelated update with unchanged type and category.

Repository enforcement remains authoritative. The add-transaction catalogue derives options from explicit mappings and clears incompatible selections when transaction type changes.

Migration, seed mapping, repository enforcement, catalogue filtering, and regression tests are implemented. Expo SQLite and rendered-device behavior remain unverified.

### Policies still deferred

- Any future change from the approved fixed `Asia/Karachi` mobile reporting timezone.
- Account-type-specific overdraft policies.
- Refund reporting across original and refund periods.
- Pending/cleared balances.
- Whether savings-goal contributions use transfers, allocations, or separate records.
- Multi-currency representation.
- Soft deletion and immutable audit history.
- Cloud synchronization, backup, and conflict resolution.
- Import rules for legacy Prisma data.
- Whether forecasts evolve beyond the transparent three-month method.

These decisions must be specified before implementation; none should be inferred from the current schema or UI.
