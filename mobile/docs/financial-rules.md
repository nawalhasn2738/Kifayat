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
- **Existing behavior:** `accounts.balance` is stored independently and is updated by the transaction repository. No opening-balance field exists. Seeded accounts start at zero.

### Savings

- **Approved target:** `income - expenses` over the same reporting period.
- Transfers are excluded from both sides of this calculation.
- Goal contributions may be reported separately but must not be added to primary savings as income.
- **Existing behavior:** savings is the sum of negative transfer amounts. Because supported UI/repository mutations cannot create transfers, this value normally remains zero.

### Forecast

- **Approved target:** An estimate based on the last three complete, consecutive calendar months, excluding the current partial month and excluding transfers.
- A historical average is not itself a forecast; the UI must label historical values and future estimates distinctly.

## 3. Approved financial rules

### 3.1 Currency and precision

1. The initial release supports PKR only.
2. User-entered money is a positive whole number of rupees.
3. Decimal input is rejected explicitly. It must never be truncated or silently rounded.
4. Monetary values are stored as integers. Display formatting is separate from storage and must preserve negative signs where financially meaningful.
5. Currency conversion and multi-currency accounts are unsupported in the initial release.

**Current verified behavior:** SQLite uses integer monetary columns. Transaction and affordability price inputs use the shared strict `parsePkrAmount` boundary, capped at PKR 2,147,483,647; malformed, signed, decimal, exponent, zero, and out-of-range inputs are rejected without truncation. Affordability planning horizons are whole numbers from 1 through 120 months; malformed, fractional, non-finite, unsafe, and out-of-range values are rejected. `formatPKR` still applies `Math.abs`, which can hide negative signs in totals and affordability values.

**Current future-date policy:** the repository rejects new future-dated income and expense transactions and edits that newly make an income or expense future-dated, using canonical UTC instants and its injected current-time source. Existing future-dated rows are preserved; an idempotent replay may return an existing row, an unchanged-date edit remains supported, and deletion uses the existing atomic balance reversal. Scheduled transactions are unsupported. Opening-balance semantics remain separate and unresolved.

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

Recommended SQLite/Drizzle representation for the approved target:

- Add a stable transfer identifier shared by two linked transaction legs, or add a dedicated transfer entity plus its two account effects.
- Record a negative source leg and an equal positive destination leg.
- Require source and destination account IDs, positive whole amount, date, and client-generated idempotency ID.
- Require different accounts owned by the same local user.
- Create, edit, or delete both effects in one SQLite transaction.

The current schema needs a migration because it has one `accountId` per transaction and no destination account, transfer ID, or link between paired effects. The existing `type = transfer` text value is insufficient to guarantee a balanced transfer.

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

**Existing behavior:** income and expense edits reverse and reapply balance effects atomically in repository source. An existing transfer is loaded by the UI as an expense and cannot be edited correctly.

### 3.6 Deletion

1. Hard deletion is permitted in the initial MVP.
2. The user must confirm before deletion.
3. Deletion and reversal of every balance effect must be atomic.
4. Deleting a transfer must reverse both account effects.
5. A failed deletion must leave the original transaction and balances unchanged.

**Existing behavior:** the detail screen confirms deletion, and income/expense deletion reverses the stored signed effect in one repository transaction.

**Future recommendation:** consider reversal records or soft deletion if audit history becomes a requirement. Do not implement that as part of the initial MVP rules.

## 4. Opening balances and balance consistency

No opening-balance field currently exists. Seeded accounts use a stored balance of zero, and later transaction mutations directly change that balance.

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

1. Define reporting months using one documented local-calendar timezone policy.
2. Current-month totals cover the first day of the current month through the reporting time.
3. Historical monthly values cover complete calendar months.
4. Forecast history uses the three complete consecutive months immediately before the current month.
5. Future-dated records are excluded from historical and current actual totals until their effective date.

The exact timezone is deferred, but it must be chosen before date-boundary implementation and tests are approved.

### Empty months

- For a valid three-month window, a complete month with no matching transactions contributes zero.
- Do not skip empty months and replace them with older populated months.
- If less than three complete months exist since the user's finance history began, return an explicit insufficient-history indicator alongside any provisional estimate.

### Totals

- Total balance is the signed sum of account balances.
- Income contains income transactions only.
- Expenses contain expense transactions only, with positive display totals.
- Primary savings is income minus expenses for the identical period.
- Transfers are excluded from income, expense, and primary savings.
- Hard-deleted records do not appear in active totals.
- Refunds and pending transactions receive no special handling until those features are implemented.

### Forecast

The initial forecast may use a transparent mean and variation measure, provided that it:

- uses exactly the preceding three complete consecutive months;
- includes zero-activity months;
- excludes transfers;
- reports insufficient history;
- identifies the output as an estimate;
- documents the method in user-facing text.

**Existing behavior:** the service uses the last three populated monthly buckets and may include the current partial month. Its category forecast is empty.

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

| Area | Current behavior | Approved target behavior | Likely files affected | Required change | Risk or migration consideration |
|---|---|---|---|---|---|
| Transfers | Schema/type mention `transfer`; UI and validator accept only income/expense; one account per row. Existing legacy transfer rows are read-only: update/delete reject them without writes. | Atomic source-to-destination movement, excluded from income/expense | `db/schema.ts`, migration files, transaction repository, validation, types, add/detail/list screens | Add linked two-leg or dedicated transfer representation and mutation flow | Existing raw transfer rows need classification; migration must preserve them |
| Balance consistency | Stored balance is updated atomically alongside supported CRUD. Read-only reconciliation reports signed effects, candidate opening balance, and discrepancies without repair. | Opening balance plus active effects equals stored balance | Schema, migrations, account/transaction repositories, seed, tests | Preserve reconciliation and later add an approved opening-balance model | Candidate opening balance is diagnostic and may reflect missing history |
| Opening balances | No field; seeded balances start at zero | Explicit integer opening balance for new and migrated accounts | Schema, migration, seed, account creation/import | Add only after auditing existing balance-versus-ledger differences | Preserve current stored balances; do not default existing accounts blindly |
| Amount parsing | Shared strict parsing is used by transaction and affordability inputs; the maximum is PKR 2,147,483,647. | Reject the complete non-whole input without truncation | Add-transaction and planning screens, validation utilities, tests | Completed for current monetary input paths | Future monetary inputs must reuse the same boundary |
| Savings | Sum of negative transfers; savings rate uses that value | Income minus expenses over the same period | Finance service, types, dashboard, tests | Replace primary savings definition; report contributions separately | Historical displayed savings figures will change |
| Forecasts | Last three populated buckets, potentially including current month; empty category forecast | Previous three complete consecutive months, zero-filled gaps, insufficient-history state | Finance service, types, planning screen, tests | Build explicit month window and result status | Existing forecast values will change; timezone policy required |
| Negative formatting | Shared formatter removes the sign with `Math.abs` | Preserve signs for balances/availability; use explicit sign only where presentation requires it | `lib/api.ts`, dashboard, planning, transaction screens | Separate signed money formatting from absolute transaction display | UI snapshots and user interpretation change |
| Insufficient funds | Repository rechecks the projection in its SQLite transaction and requires exact account/projection confirmation; API/UI provides Cancel and Confirm. | Warn, require explicit confirmation, then allow | Add/edit screen, repository/domain mutation input, tests | Repository/API/UI flow completed | Dialog behavior lacks automated React Native component tests |
| Category integrity | Positive/null ID validation; SQLite FK handles existence when enabled | Confirm category exists and is valid for type | Validation/domain repository and tests | Add repository validation before mutation | Category policy must be defined; legacy uncategorized rows remain valid |
| Database constraints | Text types lack SQL `CHECK` constraints | Enforce stable invariants where practical | Schema and new migration | Add constraints only after compatibility review | SQLite table-rebuild migrations can risk data loss |
| Tests | Contract smoke tests plus Drizzle repository integration tests use fresh in-memory databases. The Windows/Node 24 baseline is 32 passing tests. | Real SQLite mutation, rollback, calculation, boundary, and reconciliation tests | Mobile test setup and finance/repository tests | Continue later with seed/chat and Expo parity coverage | Ubuntu/Node 22 and Expo SQLite parity remain unverified |

## 9. Implementation order for future mini-tasks

Steps 1-3 below are complete for the current Windows/Node 24 foundation: database-contract smoke tests, injected repository tests with create/update/delete rollback and reconciliation, and strict PKR parsing. Overdraft protection and legacy-transfer mutation guards are also complete at repository level. The remaining numbered items retain their dependency order.

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

- Use the previous three complete consecutive months.
- Zero-fill complete empty months.
- return an insufficient-history state where appropriate.
- Preserve the existing read-only account reconciliation reporting while forecast behavior changes.
- Acceptance: month-boundary, empty-month, partial-current-month, and drift fixtures pass.

Opening-balance schema work should occur only after steps 1 and 2 establish safe migration fixtures and quantify how existing balances relate to recorded transactions.

## 10. Decisions deferred for a future release

### Unresolved policy decision: category applicability

**Verified current state:**

- Categories have no dedicated transaction-type field and no SQL applicability constraint.
- The existing **parent** column is nullable and accepts arbitrary text.
- The UI's **Income** and **Transfer** parent conventions are presentation/filtering behavior, not an approved authoritative repository policy.
- Transaction create and update accept any existing category ID or **null**. The foreign key checks category existence only; it does not establish compatibility with income or expense.
- Repository logic must not infer applicability from category names.

**Decision options awaiting approval:**

1. Add a dedicated, constrained category type and migrate existing category data.
2. Formally approve a finite set of **parent** values and constrain them, if that model is proven sufficient for all required category groupings and transaction types.
3. Explicitly allow categories without a type and define how typed and untyped categories behave for each transaction type.

**Recommendation awaiting approval:** use a dedicated constrained category-type model. It makes applicability explicit, avoids coupling financial integrity to display hierarchy, and gives migrations and repository tests a stable contract. This is a recommendation, not an approved schema decision.

Production applicability enforcement and create/update mismatch regression tests remain deferred until the policy is approved and existing seed/category data can be mapped safely. The current implementation evidence is summarized in **transaction-mutation-invariants-audit.md**; this decision remains unresolved and is not fixed by this documentation change.

- The precise local-calendar timezone for reporting.
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
