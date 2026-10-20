# Phase 3 Financial History Start Migration Design

## Status and authorization

**APPROVED DESIGN — CURRENT SCHEMA AND SERVICE IMPLEMENTATION WAS AUTHORIZED IN LATER TASKS**

This document began as a design-only proposal. The product owner later approved the design and separately authorized the additive schema/migration and history-start/readiness service tasks now present in the working tree. Those later authorizations did not approve real-device migration, additional schema work, the missing UI, or unrelated financial policies. Proposal and approval labels retained below record the state at the time of design review rather than the current implementation status.

The approved reporting calendar remains `Asia/Karachi`. Transaction and history-start values are canonical UTC instants; calendar eligibility is derived from those instants with start-inclusive, end-exclusive Karachi month boundaries.

## Repository evidence

- `mobile/src/lib/db/schema.ts` defines a one-to-one `user_profiles` row through a unique, non-null `user_id` foreign key to `users.id`. Financial profile values already live there.
- Transactions are independently owned by `transactions.user_id`; deleting transactions does not currently update a profile row.
- `mobile/src/lib/db/seed.ts` creates the local user and profile in one transaction and uses `LOCAL_USER_ID`. It does not repair an existing user's missing profile.
- `mobile/src/lib/db/client.ts` opens the device-local Expo SQLite database `kifayat.db` and enables WAL, foreign keys, and a busy timeout.
- `mobile/src/app/_layout.tsx` runs bundled Drizzle migrations before database configuration, seeding, and rendering the application. A migration error produces a blocking setup error.
- `mobile/drizzle.config.ts`, `mobile/drizzle/migrations.js`, and `mobile/drizzle/meta/_journal.json` define the Drizzle Kit SQL migration chain. The current working tree contains baseline `0000_unknown_karma.sql` and additive `0001_sticky_thundra.sql`.
- The installed Drizzle SQLite migrator selects the latest `__drizzle_migrations` entry, runs all newer migrations in one database transaction, and records each applied migration before commit. A thrown statement rolls that transaction back.
- Current host-side migration-chain tests exercise fresh installation, a genuine `0000` upgrade, reruns, forced rollback, journal state, and data preservation through the bundled path. Expo SQLite emulator/device compatibility remains unverified.

## A. Field and ownership

### Recommended current-value location

Add a nullable text column to `user_profiles`:

```text
financial_history_started_at TEXT NULL
```

The corresponding Drizzle property should be `financialHistoryStartedAt`. `user_profiles` is preferable to `users` because this value is a financial-profile assertion, not authentication identity, and the table already enforces at most one profile per user. It must not live on an account or transaction: the approved policy is per user and remains stable when transactions are deleted.

All reads and writes must be scoped by the authenticated/local user ID. The service must update the profile selected by `user_profiles.user_id`, never by an unscoped profile ID supplied by a caller. The existing local-only application still uses `LOCAL_USER_ID`; this design does not claim that it supplies multi-device identity or authorization.

### Representation and validation

- `NULL` means the user has not confirmed when complete financial history begins. It maps to readiness reason `history_start_unconfirmed`.
- A non-null value must be an exact canonical UTC instant, recommended as `YYYY-MM-DDTHH:mm:ss.sssZ`, round-tripping without normalization to a different string.
- A malformed, non-canonical, non-finite, or impermissibly future stored value must fail closed as `invalid_history_start`, with `forecast: null`. It must not be silently normalized, clamped, cleared, or replaced from transactions.
- Write validation and persisted-read validation must share the same strict validator and use an injected/reference clock in tests. Karachi month conversion occurs only after UTC validation.
- SQLite's text affinity alone cannot prove calendar validity or canonical UTC form. Application validation is therefore required even if a limited SQL `CHECK` is later considered.

The permitted upper bound is the confirmation/correction operation's current UTC instant; no future tolerance is recommended unless clock-skew requirements are separately approved.

### Confirmation state

No separate `is_confirmed` flag is recommended. `NULL` versus a validated instant is the complete current-state distinction. A second flag could drift into contradictory combinations. Confirmation and later correction events belong in an audit table, not in duplicate current-state booleans.

### Proposed audit storage

Create a separate append-only `financial_history_start_audit` table, recommended minimum columns:

```text
id                    INTEGER PRIMARY KEY AUTOINCREMENT
user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
previous_started_at   TEXT NULL
new_started_at        TEXT NOT NULL
change_kind           TEXT NOT NULL
changed_at            TEXT NOT NULL
```

Add an index on `(user_id, changed_at)`. `change_kind` should be a repository-validated finite value such as `confirmation` or `correction`. `changed_at` is an application-supplied canonical UTC instant from the same injected clock used for validation. The initial confirmation is audited with a null previous value; each correction records both old and new values. The profile update and audit insert must be one SQLite transaction with an ownership check and an exact expected previous value, so concurrent/stale updates cannot lose history.

A user-visible correction reason, device identifier, or distinct actor ID would require product and synchronization decisions that do not exist in the current local schema. They are open questions, not implied capabilities.

## B. Existing users and onboarding

The schema migration must leave every existing `financial_history_started_at` value `NULL`. It must not backfill a candidate, create an audit event, or assert completeness for the user.

For an existing user with transactions, application code may calculate the earliest valid owned transaction instant as a read-only suggestion. It must:

1. validate persisted transaction dates rather than relying on lexical minimum over untrusted text;
2. present the value as a suggestion, not a confirmed fact;
3. require the user to confirm it or select a different non-future UTC-equivalent date; and
4. write the selected value and its confirmation audit event atomically only after explicit action.

If persisted transaction dates needed for the suggestion are invalid, the flow should fail safely and surface a data-integrity condition rather than silently skipping records and claiming a later complete start. The exact user-facing recovery copy is an implementation-design detail.

For a user with no transactions, onboarding must still offer an explicit date-selection and confirmation flow. No transaction is not proof of complete zero activity. Freshly seeded profiles also remain null until this action occurs.

On every readiness read, a malformed or impermissibly future non-null value produces `invalid_history_start`. This is deliberately distinct from `history_start_unconfirmed`; the application must not overwrite the invalid value automatically because that would erase evidence needed for recovery.

## C. Corrections and transaction deletion

A correction is an explicit user command, not a recalculation from ledger contents. The correction service must:

- validate canonical UTC form and the non-future rule;
- verify the profile belongs to the current user;
- reject a no-op or define it explicitly without creating misleading audit history;
- atomically insert the audit event and update the profile; and
- recalculate readiness on later reads without rewriting transactions, balances, or monthly totals.

The recommended correction policy permits any validated non-future instant because the field represents the user's assertion of completeness, not the date of a particular transaction. If the product wants a stricter lower bound or limits on moving the date forward, that must be explicitly approved before implementation.

Deleting the earliest transaction or all transactions must affect only transaction and balance behavior already defined elsewhere. It must not update `user_profiles.financial_history_started_at` or delete audit rows. Likewise, importing or creating an earlier transaction must not silently move the confirmed start. Only the explicit correction command may change it.

Clearing a confirmed date back to null is not part of the approved policy. The proposed table shape intentionally requires a non-null audit `new_started_at`. If reset-to-unconfirmed is desired, its authorization, audit event, and readiness behavior need a new product decision.

## D. Proposed migration and compatibility

### Exact additive schema change

After implementation approval, update the Drizzle schema and generate a new numbered migration after `0000`; do not edit or replace the baseline migration. The generated SQL should be reviewed to be equivalent to:

```sql
ALTER TABLE `user_profiles`
  ADD `financial_history_started_at` text;

CREATE TABLE `financial_history_start_audit` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `previous_started_at` text,
  `new_started_at` text NOT NULL,
  `change_kind` text NOT NULL,
  `changed_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `financial_history_start_audit_user_changed_idx`
  ON `financial_history_start_audit` (`user_id`, `changed_at`);
```

This is a structural migration only: no `UPDATE`, inferred backfill, audit insertion, transaction rewrite, or balance change belongs in it. The generated SQL, journal metadata, snapshots, and bundled `migrations.js` entry must agree.

### Startup and version compatibility

- Existing database: the additive column is null for every profile and the empty audit table is created. Existing financial records and balances are untouched.
- Fresh database: migration `0000` creates the baseline, then the new migration adds the field/table. Seeding creates a profile whose history start defaults to null.
- New app with an old database: `_layout.tsx` must finish the pending migration before configuration, seeding, or app rendering. On failure, startup remains blocked and no feature should read the new field.
- Old app after the additive migration: the current code should ignore the extra nullable column and table. This must be verified on a copied fixture; compatibility must not be assumed solely from SQLite's additive behavior.
- Migration succeeds but later application startup fails: the migration journal remains committed. A subsequent launch should skip the applied migration and retry application startup. The old app compatibility test is the fallback evidence.
- Application bundle expects the field but migration fails: the existing startup gate should prevent that code from running. Tests must confirm this ordering.

### Ordering, atomicity, reruns, and recovery

The new migration must have a journal timestamp after `0000` and must be exported by the bundled migration module. The installed async SQLite dialect wraps pending statements and their journal inserts in one transaction. Therefore an ordinary statement failure should roll back both schema work and its migration record.

Repeat execution is safe through the migration journal: once committed, Drizzle skips migrations whose timestamp is not newer than the latest applied entry. The raw `ALTER TABLE` is not independently idempotent and must not be manually replayed. Interrupted-migration behavior must be proven against the Expo-compatible path or a faithful SQLite test, including absence of a falsely committed journal entry.

Recovery should prefer fixing the migration/app and moving forward. Before any manual repair, inspect both `PRAGMA table_info`, the audit table, and `__drizzle_migrations`; never add a journal row merely to bypass an error.

### Rollback limitations

The repository has no demonstrated automated down-migration path. Removing a SQLite column may require a table rebuild, and dropping the audit table would destroy evidence. Once users confirm or correct a start, a destructive rollback must not silently discard the current value or audit records. A rollback plan must instead preserve/export both, verify restoration, and either keep the additive schema for an older compatible app or use a separately reviewed forward repair. No destructive rollback is authorized by this design.

## E. Required tests and rollout evidence

Before release, add focused tests for:

- applying the full migration chain to an existing `0000` database and to an empty database;
- exact schema, foreign key, index, null default, and absence of data backfill;
- existing rows, balances, transactions, and ownership remaining unchanged;
- fresh seeding producing a null history start;
- nullable/unconfirmed and confirmed values across database close/reopen;
- strict canonical UTC parsing and Karachi boundary conversion, including midnight, year rollover, and leap dates;
- existing users with transactions receiving only a validated suggestion and users without transactions receiving no fabricated suggestion;
- explicit confirmation, replacement of a suggestion, correction, no-op behavior, ownership rejection, and atomic audit creation;
- malformed and impermissibly future write rejection plus fail-closed reads using `invalid_history_start` and `forecast: null`;
- earliest-transaction and all-transaction deletion leaving the confirmed value and audit history unchanged;
- migration rerun skipping committed work;
- a forced failure/interruption rolling back schema statements and the journal entry, followed by a successful retry;
- old-app/new-schema and new-app/old-schema startup compatibility, including the blocking migration-error screen;
- all existing repository integration, migration contract, reporting-calendar, finance reporting, typecheck, and lint checks.

Migration tests must stop assuming `0000` is the complete schema. A reusable helper should apply the bundled/journal-ordered migrations so future additions are tested. Tests must use disposable in-memory or temporary databases and must never run against a user's `kifayat.db`.

Rollout should first exercise copied, anonymized fixtures representing: a current database with transactions, a user with no transactions, and a fresh install. Record schema/journal state before and after, then verify startup, balances, counts, and null current values. Device rollout that executes the migration is a persisted schema change and requires separate implementation/release approval.

## F. Smallest safe implementation sequence

1. **Finalize and approve this design.** Documentation only; no persisted writes.
2. **Approve schema-migration implementation separately.** Approval must name the nullable profile column, audit table, and no-backfill rule.
3. **Add schema declarations and generate/review a new migration.** Changes source, generated SQL, journal/snapshot, and migration bundle; does not intentionally touch a user database, but is not authorized yet.
4. **Upgrade migration test infrastructure and fixtures.** Applies migrations only to disposable test databases; no production/device writes.
5. **Separately authorize strict validation and forecast-readiness code.** Migration-design approval does not authorize this behavior change.
6. **Design read-only suggestion generation.** Validate every owned transaction date and make no persisted write.
7. **Explicitly authorize confirmation/correction repository commands.** Profile and audit writes need separate persisted-data approval.
8. **Review onboarding and correction UI.** The proposed Karachi calendar-date interaction still needs approval.
9. **Verify compatibility and recovery with disposable or protected copied fixtures.** Never use a live user database.
10. **Obtain separate release authorization before migrating actual device databases.**

Each step should be reviewed before the next; forecast calculation changes must not be bundled into the schema migration.

## Resolved design recommendations

These recommendations resolve the questions for review; they do not turn newly proposed behavior into approved behavior.

| Question | Recommendation | Approval status | Implementation dependency |
| --- | --- | --- | --- |
| Missing profile | Fail closed; offer only an explicit, ownership-checked recovery operation | **PROPOSED — persisted repair requires product-owner approval** | Repository command, recovery UI, ownership/atomicity tests |
| No-op correction | Reject after strict validation and canonical equality; write no audit row | **PROPOSED — design review required** | Shared validator and repository tests |
| Correction reason | Omit for the initial local-only release | **PROPOSED — design review required** | No field/UI; revisit with compliance or sync requirements |
| Actor/device metadata | Use owned `user_id` only; add no speculative columns | **PROPOSED — design review required** | Future synchronization design |
| Reset to unconfirmed | Do not expose reset in the initial release | Silent clearing is prohibited; explicit reset is **NOT APPROVED** | Separate policy, audit, repository, and UI approval |
| Date selection | Ask for a Karachi date and persist its Karachi-midnight UTC instant | **PROPOSED — product-owner approval required** | Calendar conversion and UI/boundary tests |
| Invalid suggestion inputs | Fail safely if any relevant owned transaction date is invalid | **PROPOSED — design review required** | Integrity result and later recovery UI |
| Backup and rollout | Block device release until protection and recovery are approved and tested | **PROPOSED RELEASE GATE** | Platform plan, fixtures, recovery rehearsal, release approval |

### 1. Missing `user_profiles` row

Treat a missing owned profile as a setup/data-integrity state, not as an unconfirmed profile and not as permission to insert one silently. Reads fail closed and must not return `history_start_unconfirmed` for a row that does not exist. A future explicit recovery operation should verify that the user exists and is the current local user, recheck absence inside the write transaction, and create a profile with a null history start. It must not infer a start or create an audit event.

This fits the local-only application: seeding normally creates the profile, but the schema does not guarantee one. Null/unconfirmed and no-silent-confirmation are approved; profile repair is not. Any recovery write and UI require separate approval. Test missing user/profile, wrong ownership, concurrent creation, uniqueness failure, rollback, and recovery to null without confirmation.

### 2. No-op corrections

Reject a correction whose proposed value equals the existing validated instant, with no profile update or audit insert. Strictly validate both values first. Accepted storage is canonical, so compare canonical serialized UTC strings; an epoch-millisecond comparison may be defensive, but a non-canonical spelling must be rejected rather than normalized into acceptance.

This keeps the approved audit trail meaningful and prevents unchanged form submissions from looking like changes. The exact no-op response remains a design recommendation. Test zero writes, zero audit rows, atomicity, and rejection of alternate-offset/non-canonical input even when it denotes the same instant.

### 3. Correction reason

Omit a correction-reason field for the initial local-only release. The minimum approved audit contains owner, old/new values, change kind, and change time. A required reason creates a new product input; optional free text adds unclear privacy and retention obligations. No reason field currently exists or is approved. Revisit this recommendation for compliance, support administration, synchronization, or multiple actors, and test that the minimum audit event is complete without it.

### 4. Actor and device metadata

Add no actor, device, synchronization, or authentication columns now. In the current model, audit `user_id` identifies whose setting changed; it does not prove a separately authenticated actor. Cross-device identity remains unapproved and needs its own threat model and conflict rules. Ownership tests must reject cross-user access; schema tests must assert only the reviewed minimum fields.

### 5. Reset to unconfirmed

A confirmed start cannot be silently or implicitly cleared, and the initial correction command should not expose reset-to-null. Transaction deletion already must not clear it. Explicit reset would require a separate decision defining authorization, confirmation UX, an audit event with a nullable destination, and recovery behavior. Until approved, a clear attempt produces no write or audit entry. Test deletion stability, direct clear rejection, rollback, and unchanged readiness.

### 6. User date-selection experience

Ask for an `Asia/Karachi` calendar date, not an exact timestamp. Convert Karachi midnight at the start of that date to canonical UTC for storage. For example, `2026-05-01` becomes `2026-04-30T19:00:00.000Z`. Month eligibility compares that stored instant with canonical UTC instants representing Karachi month boundaries.

Keep three concepts distinct: the user selects a Karachi date; the database stores its canonical UTC instant; readiness evaluates that instant against Karachi boundaries. This avoids an unjustified timestamp picker and lets a first-of-month selection qualify the full month after it ends. The timezone/UTC policy is approved, but this input granularity and conversion UX are **PROPOSED — NOT YET APPROVED**. Test exact conversion, first/mid-month eligibility, leap day, year rollover, device-timezone independence, and display round-trip without date drift.

### 7. Invalid transaction dates during suggestion generation

If any relevant owned transaction has an invalid, non-canonical, or non-finite date, fail suggestion generation with a data-integrity outcome. Do not skip it and present a potentially misleading later start. The operation remains read-only: it does not repair a transaction, create a profile, set a start, or add an audit row. Exact messaging and recovery UI are deferred. Test invalid earliest/later rows, mixed ownership, empty and valid ledgers, and no writes on failure.

### 8. Backup, recovery, and staged rollout

Real-device data protection is a release gate. The repository establishes no backup/export or staged rollback procedure, so none is claimed. Before device migration, require:

1. automated tests using only disposable databases;
2. an approved way to protect or recover real-device data;
3. before/after verification of `__drizzle_migrations`, profile columns, audit table/index, foreign keys, row counts, balances, and unchanged transactions;
4. a rehearsed recovery path that preserves confirmed values and audit records; and
5. separate product-owner authorization to execute the migration on devices.

Use copied fixtures for fresh/existing databases, users with/without transactions, a missing profile, interruption, and rerun. The platform-specific backup and staged-release mechanisms remain evidence gaps, not invented capabilities.

## Remaining evidence gaps

- No repository-backed device backup/export, staged rollout, or automated down migration exists.
- The schema does not guarantee a profile for every user; recovery is only proposed.
- No separate authenticated actor or stable device identity exists for audit attribution.
- Integrity/recovery messaging remains for a later UI task.

## Review gate

Approval of this proposal would approve only the design. A later instruction must explicitly authorize schema/migration implementation. Another explicit approval must cover commands or UI flows that write `financialHistoryStartedAt` or audit records to persisted user databases.
