# Phase 3 Financial History Start Implementation Plan

## Status and approval boundary

**APPROVED PLANNING FRAMEWORK — TASKS WERE LATER AUTHORIZED INDIVIDUALLY**

The product owner approved the design in `phase-3-financial-history-start-migration-design.md`, including its eight reviewed recommendations, and later authorized implementation tasks individually. The current repository contains the additive schema/migration, history-start services and commands, forecast readiness, workflow orchestration, and Planning-screen confirmation/correction/explicit-recovery UI described by those later tasks. Host-side tests cover service, repository, and UI-orchestration behavior. Rendered React Native interaction and Expo SQLite device/release verification remain incomplete. This plan is a historical scope and dependency record; it does not authorize further work or migration of actual device databases.

This plan divides implementation into small, separately reviewable tasks. Approval of one task does not authorize a later task. No task may install a dependency, rewrite transactions, recalculate balances, infer a history start, or touch a user's real `kifayat.db` unless a later instruction explicitly says otherwise.

## Approved target summarized

- Add nullable `user_profiles.financial_history_started_at`; null means unconfirmed.
- Add an append-only, per-user history-start audit table.
- Store strict canonical UTC instants; users select an `Asia/Karachi` calendar date whose Karachi midnight is converted to UTC.
- Leave all existing users null; never backfill or confirm automatically.
- Fail closed for missing profiles, invalid/future history starts, and invalid transaction dates used for suggestions.
- Reject canonical-equal no-op corrections without an audit event.
- Omit correction reasons and speculative actor/device metadata initially.
- Do not support reset-to-unconfirmed initially.
- Never change the confirmed start or audit history when transactions are deleted.
- Keep design, migration code, persisted writes, forecast behavior, UI, and real-device rollout as separate approval gates.

## Planned mini-tasks

### 1. Full migration-chain test foundation

**Purpose:** Make migration tests apply the journal-ordered bundled chain rather than hard-coding only `0000`.

**Expected scope:** Migration test helpers and focused tests under `mobile/tests/`; no schema or migration change.

**Required evidence:**

- Fresh disposable SQLite database applies the complete current chain.
- A database already at `0000` applies only later migrations when they exist.
- Committed migrations are skipped on rerun.
- Forced failure does not leave a falsely committed journal entry.
- Tests never open the device `kifayat.db`.

**Persistence:** Writes disposable test databases only.

**Approval needed:** Test-code implementation approval. This task should precede schema work so the new migration can be tested safely.

### 2. Schema declarations and additive migration

**Purpose:** Implement only the approved database structure.

**Expected scope:**

- Add nullable `financialHistoryStartedAt` mapping to `userProfiles` in `mobile/src/lib/db/schema.ts`.
- Add the append-only audit table with owner, previous value, new value, change kind, and change time.
- Add the `(user_id, changed_at)` index and approved foreign-key behavior.
- Generate a new migration after `0000`; never edit the baseline.
- Review generated SQL, journal/snapshot metadata, and `mobile/drizzle/migrations.js` together.

**Explicit exclusions:** No `UPDATE`, backfill, audit seed, profile creation, transaction rewrite, balance change, service use, UI, or real database execution.

**Required tests:** Fresh and `0000` upgrade paths, exact column/table/index/foreign-key shape, existing rows unchanged, null default, rerun, forced rollback, and old-code/additive-schema compatibility on disposable fixtures.

**Persistence:** Schema changes only in disposable test databases. Generating migration files changes repository artifacts but not user data.

**Approval needed:** Explicit schema-and-migration-code authorization. Design approval alone is insufficient.

### 3. Strict history-start value and calendar-date conversion

**Purpose:** Create pure, testable validation and conversion behavior without database writes.

**Expected scope:** A small finance/domain utility using the existing named-timezone calendar conventions.

**Contract:**

- Accept only exact canonical UTC strings in the approved representation.
- Reject malformed, impossible, noncanonical, non-finite, and impermissibly future instants.
- Convert a valid Karachi calendar date at `00:00:00.000 Asia/Karachi` to canonical UTC.
- Round-trip for display without device-timezone dependence.
- Compare validated canonical instants for no-op detection.

**Required tests:** Exact UTC values, month/year rollover, leap and non-leap February, invalid dates, future boundary with an injected clock, alternate offsets, device-timezone independence, and canonical-equal comparison.

**Persistence:** None.

**Approval needed:** Application/test-code authorization. This does not authorize repository writes or forecast changes.

### 4. Read-only profile state and suggestion service

**Purpose:** Read history-start state and suggest an existing user's earliest transaction without mutation.

**Expected scope:** User-scoped repository/service reads and result types only.

**Contract:**

- Missing profile fails closed as a distinct integrity/setup result; it is not `history_start_unconfirmed`.
- Null maps to `history_start_unconfirmed`.
- Invalid/future stored values map to `invalid_history_start` with no numerical forecast consumer value.
- Suggestion generation validates every relevant owned transaction date.
- Any invalid relevant date blocks the suggestion; no invalid row is skipped.
- No transactions returns no fabricated suggestion.
- No profile, audit, transaction, or balance row is written.

**Required tests:** Ownership isolation, missing user/profile, null/valid/invalid/future values, invalid earliest/later transaction, mixed users, empty ledger, deterministic earliest valid suggestion, and zero writes.

**Persistence:** Read-only.

**Approval needed:** Read-service implementation approval. Profile recovery remains outside this task.

### 5. Explicit missing-profile recovery

**Purpose:** Provide the approved fail-closed recovery command without confirming history.

**Contract:** Verify the current user, recheck profile absence inside one transaction, create only an owned profile with null history start, and create no history-start audit row. Reject wrong ownership, an existing profile, and concurrent duplicate creation safely.

**Required tests:** Missing user, wrong user, existing/concurrent profile, uniqueness failure, forced rollback, and successful null profile with no audit event.

**Persistence:** Creates a profile row. This is the first proposed task that writes application data.

**Approval needed:** Explicit persisted-profile-write authorization. It must not be bundled implicitly with migration approval.

### 6. Confirmation and correction repository commands

**Purpose:** Implement the only authorized path for setting or changing a history start.

**Contract:**

- Scope by the current user and require an existing owned profile.
- Validate the new canonical UTC instant and future boundary.
- Initial confirmation requires a null current value and writes a `confirmation` audit event.
- Correction requires a valid non-null current value and writes a `correction` event containing old and new values.
- Reject stale expected values and canonical-equal no-ops with zero writes.
- Reject clearing to null; no reset feature exists.
- Atomically update the profile and append the audit record.
- Omit correction reason and actor/device columns.

**Required tests:** Confirmation, replacement of a suggestion, correction, ownership, invalid/future input, stale update, no-op, clear rejection, forced failure rollback, audit ordering, and retry behavior.

**Persistence:** Writes profile and audit records.

**Approval needed:** Explicit persisted profile/audit-write authorization after Tasks 2–4 are reviewed. UI is not included.

### 7. Forecast-readiness integration

**Purpose:** Apply the already approved forecast contract after persistence/read paths are proven.

**Contract:** Use the three immediately preceding complete Karachi months; exclude the current partial month; count qualifying empty post-start months as zero; keep pre-history and partial-first months unavailable; return `forecast: null` with stable readiness metadata when unconfirmed, invalid, or insufficient.

**Explicit exclusions:** No formula redesign, balance change, transaction mutation, or UI work.

**Required tests:** All approved readiness examples, exact month boundaries, zero-filled middle/edge months, deletion stability, reason codes, serialization, and consumers not treating null as zero.

**Persistence:** Read-only financial reporting behavior, but user-visible forecast results change.

**Approval needed:** Separate forecast-behavior implementation authorization.

### 8. Onboarding, confirmation, correction, and readiness UI

**Purpose:** Expose the approved interactions only after service contracts stabilize.

**Expected scope:** Karachi calendar-date selection, suggestion confirmation/replacement, no-transaction onboarding, correction confirmation, missing-profile recovery entry point, and readiness guidance.

**Required tests:** Date display/round-trip, cancellation, accessibility, reason-specific messaging, historical-actual labels, unavailable/ready transitions, and absence of an official forecast while `forecast` is null.

**Persistence:** User confirmations and corrections call the separately approved Task 6 commands; profile repair calls Task 5.

**Approval needed:** Separate UI and persisted-action wiring authorization.

### 9. Compatibility and recovery qualification

**Purpose:** Produce release evidence without touching a live user database.

**Expected scope:** Disposable or protected copied fixtures for fresh installs, existing users with/without transactions, missing profiles, interrupted migration, rerun, and old-code/new-schema compatibility.

**Required evidence:** Before/after migration journal and schema state, foreign keys, indexes, row counts, balances, unchanged transactions, null existing values, startup gating, and a rehearsed recovery path that preserves confirmed values and audit records.

**Persistence:** Test/copied fixtures only.

**Approval needed:** Compatibility-test authorization and an approved method for obtaining/protecting any copied fixture. No live migration.

### 10. Real-device release gate

**Purpose:** Decide whether migration execution is safe after all earlier work is reviewed.

Before authorization, the product owner must receive:

- complete test/typecheck/lint results;
- the final generated migration and schema diff;
- compatibility evidence;
- an approved device-data protection method;
- a tested recovery procedure that preserves history-start and audit data; and
- known rollback limitations.

**Persistence:** Would execute the schema migration on real device databases.

**Approval needed:** Explicit release authorization in a later task. No earlier approval implies this authorization.

## Recommended next task

The smallest safe next task is **Full migration-chain test foundation**. It changes tests only, operates on disposable databases, and supplies the safety harness needed before generating the new migration. Its approval should not include schema edits or application behavior.

## Cross-task invariants

Every implementation task must preserve:

- user ownership checks;
- atomic profile/audit writes;
- canonical UTC timestamps and named `Asia/Karachi` boundaries;
- no inferred history start or fabricated transactions;
- no balance or transaction rewrite;
- deletion stability;
- fail-closed persisted-data validation;
- no dependency installation without prior explanation and approval;
- focused tests first, then applicable mobile tests, typecheck, lint, and `git diff --check`;
- no staging, committing, pushing, branch switching, or unrelated-file cleanup.

## Review decision requested

Approve, reject, reorder, or amend the ten-task sequence. Approval of this plan should identify the first mini-task authorized for implementation. Approval of the plan by itself must not be interpreted as authorization to begin any task.
