# Kifayat Phase 3 Master Tracker

## A. Purpose and numbering guide

This file is the Phase 3 overview and status index. The detailed specifications remain in the linked policy, design, and implementation-plan documents.

Phase 3 has two numbering systems:

1. **Original mini-tasks (`3.0`–`3.15`, including `3.3A`)** cover repository audit, documentation reconciliation, policy proposals and approvals, reporting-calendar work, and financial-history-start design review.
2. **Financial-history-start implementation Tasks 1–10** are the controlled implementation sequence defined in `phase-3-financial-history-start-implementation-plan.md` after the policy/design work.

These are not parallel copies and their numbers do not map one-to-one. An original documentation or design task may establish requirements for several implementation tasks. Completing or approving documentation does not mean the described application behavior exists. This tracker summarizes relationships and status; it does not replace the detailed implementation plan or authorize work.

## B. Overall progress summary

### Original mini-task stream

- 17 entries are tracked: `3.0`–`3.15` plus `3.3A`.
- 16 have identifiable documentation, implementation, test, or review outcomes in current records/task reports.
- Mini-task `3.11` is not confirmed as a completed numbered task from repository records. Mini-task `3.12` and the product owner's explicit follow-up record the forecast-readiness approval.
- Reporting-calendar utility and reporting integration are implemented and reported tested.
- Forecast-readiness policy, service behavior, and the Planning-screen confirmation/correction/explicit-recovery workflow are implemented and host-tested at the orchestration layer.
- The financial-history-start design was reviewed and approved; later task-specific authorizations produced the current schema, migration, services, and tests. Design approval alone did not authorize those later changes.

### Ten-task implementation stream

- Tasks 1–8 are implemented and covered by the current host-side suite, including the Planning-screen workflow and focused UI-orchestration tests.
- Task 8 includes service/API workflow integration and the user-facing Planning-screen UI described by the original implementation plan.
- Task 9 has host-side migration and compatibility evidence, but old installed-binary/new-schema behavior and Expo SQLite device recovery remain unverified.
- Task 10 completed host configuration/release-gate inspection only; no emulator or physical device was available, so device release remains unverified.

### Approved versus implemented

Approved policies include the fixed `Asia/Karachi` reporting calendar, canonical UTC instants, half-open month boundaries, confirmed per-user history start, three complete preceding months, post-start empty months as zero, `forecast: null` while insufficient, stable readiness reasons, guidance, correction/audit expectations, and deletion stability.

Implemented and host-tested work includes the reporting calendar and reporting integration, migration-chain foundation, additive history-start schema/migration, strict value conversion, read/suggestion and recovery services, atomic confirmation/correction with audit records, forecast readiness, and service workflow integration. Expo SQLite device compatibility, real-device recovery procedure, rendered-device interaction verification, and the release gate remain outstanding.

No reliable overall completion percentage is stated because policy, design, implementation, verification, and release authorization are distinct states.

## C. Original Phase 3 mini-task register

Statuses describe the task artifact/stage, not automatic completion of the underlying feature.

| Mini-task | Purpose | Status | Evidence/reference | Remaining work |
| --- | --- | --- | --- | --- |
| 3.0 | Repository and financial-workflow audit | Reported complete; not rerun for this tracker | Audit findings carried into `financial-rules.md` and later policy records | Re-audit only if repository behavior materially changes |
| 3.1 | Reconcile financial documentation with verified mobile behavior | Documentation outcome present | `financial-rules.md`, README/audit documents; mobile/web separation and savings/idempotency wording | Preserve accuracy as implementation changes |
| 3.2 | Create financial-policy decision record | Documentation complete | `phase-3-policy-decisions.md` | Maintain approvals and unresolved unrelated policies |
| 3.3 | Add named reporting-calendar utilities and focused tests | Implemented and reported tested | `src/lib/finance/`, `tests/reporting-calendar.test.ts`; policy record cites Mini-task 3.3 | Device/runtime parity remains part of later compatibility work |
| 3.3A | Record reporting-timezone approval | Documentation complete | Reporting-timezone section in `phase-3-policy-decisions.md` | None for approval record |
| 3.4 | Define proposed forecast-readiness contract | Documentation complete at proposal stage | Forecast sections and examples in policy records | Later approval and service implementation are recorded separately |
| 3.5 | Prepare forecast-readiness approval review without approving | Documentation complete | `phase-3-forecast-readiness-approval-review.md` | Historical pre-approval section remains explicitly superseded |
| 3.6 | Reconcile forecast-readiness proposals | Documentation complete | Policy and approval-review documents | Keep approved/proposed labels synchronized |
| 3.7 | Integrate reporting calendar into mobile reporting | Implemented and reported tested | `finance-core.ts`, `finance-reporting.test.ts`, policy evidence | Does not implement forecast readiness |
| 3.8 | Review forecast-readiness decisions and required choices | Review reported complete | Consolidated recommendations in the Phase 3 policy/review documents | Decisions subsequently required explicit approval |
| 3.9 | Reconcile contradictions and prepare explicit approval choices | Documentation outcome present | Approved/current-versus-target language in `financial-rules.md` and policy records | Continue guarding implementation boundaries |
| 3.10 | Prepare final forecast-policy decision record | Documentation outcome present | Decision tables and approval checklist in Phase 3 policy documents | No implementation was authorized by the record |
| 3.11 | Finalize forecast-readiness policy decisions | **Not confirmed from available records** | An attachment/task reference existed, but current repository documents do not reliably attribute a completed outcome to this number | Locate/confirm the task report before changing status |
| 3.12 | Record explicit forecast-readiness approval | Approval recorded | Product-owner decision and approval sections in the Phase 3 policy documents | Implementation followed through separately authorized tasks |
| 3.13 | Design financial-history-start migration | Design document created | `phase-3-financial-history-start-migration-design.md` | Design questions were handled in 3.14 and reviewed in 3.15 |
| 3.14 | Resolve eight migration-design questions | Documentation complete | Decision table and eight recommendation sections in the migration design | Recommendations later received explicit design approval |
| 3.15 | Final financial-history-start design review | Review complete; verdict ready for approval | Final review report plus migration-design document | Product owner subsequently approved the design; implementation uses the separate ten-task sequence |

The product owner's explicit messages approved the forecast-readiness package, migration design, and all eight reviewed recommendations. Later task-specific authorizations—not the policy approval alone—authorized implementation.

## D. Ten-task financial-history-start implementation register

The task names and boundaries come from `phase-3-financial-history-start-implementation-plan.md`.

| Task | Current repository status | Evidence | Remaining limitation |
| --- | --- | --- | --- |
| 1. Full migration-chain test foundation | **Implemented and host-tested** | Journal-ordered disposable-database helper and migration-chain tests | Host driver is not Expo SQLite |
| 2. Schema declarations and additive migration | **Implemented and host-tested** | Nullable profile field, audit table, `0001`, snapshot, journal, bundle, fresh/upgrade/rerun/rollback tests | Real-device upgrade is unverified |
| 3. Strict history-start value and calendar-date conversion | **Implemented and host-tested** | Canonical UTC validation, Karachi date conversion, future/leap/boundary tests | Device runtime parity is unverified |
| 4. Read-only profile state and suggestion service | **Implemented and host-tested** | Typed states, owned reads, advisory earliest-date suggestion, invalid-history failure | Rendered-device behavior is unverified |
| 5. Explicit missing-profile recovery | **Implemented and host-tested** | Explicit validated recovery, transaction rollback, isolation, null history start; explicit Planning-screen entry | Rendered-device behavior is unverified |
| 6. Confirmation and correction repository commands | **Implemented and host-tested** | Atomic profile/audit writes, stale-value/no-op protection, ownership tests; Planning-screen actions | Rendered-device behavior is unverified |
| 7. Forecast-readiness integration | **Implemented and host-tested** | Three complete preceding Karachi months, zero-filled qualifying gaps, `forecast: null`, stable reasons, total and category forecasts | Expo SQLite/device behavior is unverified |
| 8. Workflow integration and UI | **Implemented and host-tested** | Service/API orchestration, Planning-screen confirmation/correction/recovery/readiness states, refresh sequencing, submission locking, and focused orchestration tests | No rendered React Native emulator/physical-device verification |
| 9. Compatibility and recovery qualification | **Partially verified** | Host fresh/upgrade/rerun/failure/data-preservation coverage | Old installed-binary/new-schema and Expo device recovery remain unverified |
| 10. Expanded runtime/release gate | **Not verified on device** | Host suite, typecheck, lint, Expo config inspection | No emulator/physical-device migration run, backup rehearsal, or release approval |

These statuses report current repository evidence, not new authorization. No task status establishes production readiness or permission to migrate real device data.

## E. Relationship and dependency map

```text
Audit and documentation reconciliation
  -> approved Karachi reporting calendar
  -> calendar utility and reporting integration
  -> forecast-readiness policy and history-start design
  -> approved ten-task implementation plan
       1 migration test foundation
       2 additive schema/migration
       3 strict value/date conversion
       4 read-only state and suggestion
       5 profile recovery writes
       6 confirmation/correction writes
       7 forecast-readiness behavior
       8 workflow integration and Planning-screen UI
       9 compatibility/recovery qualification
       10 separately authorized device release
```

The original stream establishes evidence, product rules, calendar behavior, and design constraints. The ten-task stream implements the approved financial-history-start design in risk order. Tasks 1–8, including the Planning-screen UI, are present. Tasks 9 and 10 remain limited because host tests do not prove device migration safety. There is no forced one-to-one mapping between original mini-tasks and implementation tasks.

## F. Approval and safety register

| Area | Current decision state | Implementation/release state |
| --- | --- | --- |
| Fixed `Asia/Karachi` reporting timezone, canonical UTC instants, half-open months | **Approved** | Calendar utility and reporting integration implemented/reported tested |
| Confirmed per-user financial-history start and no silent backfill | **Approved** | Schema, read/write services, and Planning-screen workflow implemented and host-tested |
| Three complete preceding months; current partial month excluded | **Approved** | Readiness service implemented and host-tested |
| Complete empty post-start months as zero; pre-history/partial-first unavailable | **Approved** | Readiness service implemented and host-tested |
| `forecast: null`, readiness reasons, labelled actuals/guidance | **Approved** | Service and Planning-screen unavailable/ready states implemented and host-tested |
| Financial-history-start migration design and eight recommendations | **Approved by explicit product-owner message after 3.15** | Does not itself authorize implementation or release |
| Implementation-plan Tasks 1–8 | Separately authorized in sequence | Implemented and host-tested in the current repository |
| Task 8 workflow integration | Separately authorized | Service/API orchestration and Planning-screen UI implemented; rendered-device verification remains deferred |
| Task 9 compatibility/recovery qualification | Separately reviewed within disposable/host constraints | Device and old-binary compatibility remain unverified |
| Task 10 real-device migration | Explicit release authorization still required | Not verified or release-approved; never implied by host checks |

Dedicated transfers, opening balances, normalized category applicability, and signed PKR formatting were subsequently approved and implemented with host-side coverage. Cross-device synchronization and refunds remain proposed and unapproved. This tracker grants no new authorization for them.

### Broader Phase 3 mobile implementation status

| Area | Status | Current evidence | Remaining limitation |
| --- | --- | --- | --- |
| Transaction management | **Implemented and host-tested** | User-scoped create/read/update/delete, idempotent creation, atomic balance effects, overdraft confirmation, detail/list/add-edit UI, repository and integration tests | Rendered-device behavior and Expo SQLite parity are unverified |
| Dedicated transfers | **Implemented and host-tested** | Additive `0003` migration, atomic create/correct/delete, equal-and-opposite effects, grouped activity, add/detail UI, fail-closed persisted reads | Legacy single-account transfer rows remain read-only; device verification is deferred |
| Category applicability | **Implemented and host-tested** | Additive `0002` relation/mappings, repository typed enforcement, applicability-driven catalogue/UI selection, historical-retention rules | Unmapped custom-category administration is not implemented; device verification is deferred |
| Opening balances | **Implemented and host-tested** | Additive `0004` nullable field/audit, reconciliation, atomic confirmation/correction, stale-value protection, Planning UI | Ambiguous ledgers intentionally block writes; device verification is deferred |
| Forecasts | **Implemented and host-tested** | Approved readiness contract, total/category three-month estimates, unavailable-state presentation | Rendered-device behavior is unverified; formula redesign is outside this work |
| Financial risk | **Implemented and host-tested** | Existing score/reasons plus approved current partial Karachi month and two preceding complete months, inclusive through `asOf` | Mini-task 3.1 changes are currently uncommitted; device verification is deferred |
| Signed PKR presentation | **Implemented and host-tested** | Signed totals, explicit transaction direction/magnitude/tone, invalid-value rejection | Rendered typography/accessibility remains unverified |

## G. Next actions

1. Add the mobile checks to CI and rerun root/web checks with existing installed dependencies when available.
2. Perform separately authorized Expo SQLite emulator/device compatibility, rendered-workflow, and recovery verification before release.
3. Resolve cross-device synchronization and refund policy only through separate product decisions and implementation scopes.

## H. Update rules

- Change status only from explicit task reports, product-owner decisions, and inspectable evidence.
- Keep completed historical work visible; do not rewrite history to match later numbering.
- Record the exact document, source, test, command result, or approval supporting completion.
- Distinguish proposed, approved, authorized, implemented, tested, verified, and release-authorized states.
- Keep `phase-3-financial-history-start-implementation-plan.md` as the detailed specification rather than duplicating or replacing it here.
- Record uncertainty, blockers, compatibility limits, and scope changes explicitly.
- Never expand one task's authorization into later code, persisted writes, UI, compatibility work, or device migration.

## Evidence note

This tracker was reconciled against the current source, tests, documentation, and task authorizations. On October 22, 2026, `npm test` from `mobile/` passed 210 host-side tests with 0 failures after the financial-risk window change; mobile typecheck and lint also passed. These Node-hosted tests include disposable SQLite repository/migration coverage and UI-orchestration logic, but they do not establish rendered React Native behavior, Expo SQLite device compatibility, authentication, synchronization, backup/restore, or production readiness.
