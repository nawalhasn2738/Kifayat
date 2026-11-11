# Phase 5 Task 2: savings goals, recommendations and installment arithmetic

## Inspection and reuse

Mobile already had the `savings_goals` table and an `Emergency Fund` seed (target PKR 240,000, stored current amount zero). There was no mobile goal repository, progress service, recommendation service, installment service or goal management UI. The web `goalProgress` function reads the stored `currentAmount`; no mobile process updated it from records. The web recommendation and installment functions existed inside a Prisma-dependent module.

This task adds an owned repository over the existing table and a section in the existing Planning screen. It reuses the mobile transaction/catalog repositories, financial-history state, `monthly`, `meanMoney`, `transactionsAtOrBefore`, summary and forecast readiness services, and exclusive submission guard. Pure recommendation/installment functions and their existing 20%/30% constants were extracted into `mobile/src/lib/finance/planning-rules.ts`. The existing web wrappers call that same pure implementation; mobile never imports the Prisma context builder or web demo ledger. No schema, migration, dependency or web UI feature was added.

## Progress definition and its limits

The mobile progress source is shared recorded net savings from the confirmed financial-history start, inclusive, through the captured cutoff: sum of recorded income minus recorded expenses using the existing monthly arithmetic. Transactions before that start and after the cutoff are excluded. Transfer rows and the separate transfers table do not create income or expenses. No account balance or emergency target is treated as a contribution.

This is a cash-flow comparison pool, not an allocation or a confirmed spendable cash balance. Each goal compares with the same pool; displayed goal amounts must not be added together. Positive progress is max(0, net savings); deficits remain visible separately. Remaining is max(0, target minus positive progress). The percentage/bar is capped at 100%, while the full positive amount is retained. Missing/unconfirmed/invalid history or unreadable records has null progress and remaining, not zero. Confirmed empty records are allowed to produce zero.

The existing stored `currentAmount` is preserved and shown separately. It is neither automatically overwritten nor added to the shared pool, preventing double counting. The mobile seeded zero had no transaction linkage; presenting that static value as automatically tracked progress would misrepresent users with recorded net savings. Web allocation progress remains unchanged. Mobile does not add manual allocations, contributions, account earmarking, or a claim that each goal has independently saved the pool amount. The chosen shared-pool definition was stated during implementation after an optional clarification; no confirmation provenance or new contribution storage is introduced.

## Goal management

Planning lists all owned goals with name, date, target, recorded progress, remaining and percentage. Existing targets can be edited. A new goal requires a name, positive integer-PKR target and an explicit valid Karachi target date; no deadline is invented. Zero, empty, negative, fractional and excessive targets are rejected using existing PKR limits (maximum 2,147,483,647). Name and date validation also run at the repository boundary. Creates set stored current amount to zero. Updates modify only the owned goal target and preserve name, date and stored progress. The user ID comes from repository dependencies, never mutation payloads.

The section uses the existing off-white theme with separators instead of new nested cards. Numeric inputs, keyboard avoidance, scroll behavior, accessibility labels/progress values, loading, empty, error, success and saved-but-refresh-failed states are included. The save guard prevents duplicate writes; typed values survive rejected saves. Goal refreshes run on focus, history confirmation/correction and pull-to-refresh. A refresh requested during an active operation queues the latest read. Stale read results are discarded, and failed reads hide old conclusions.

## Recommendations and concrete defect correction

Recommendations require the same three preceding complete Karachi months as the existing forecast readiness service. The current partial month is excluded and eligible empty months count as zero. Income and expenses are rounded averages of those actual recorded monthly summaries, not profile defaults. The shared rule considers 20% of recorded average income, capped by nonnegative income-minus-expenses headroom. The three largest category totals across those months are shown as spending patterns to review; no hypothetical category reduction or savings amount is invented. Missing category/summary data produces an explicit unavailable explanation.

Concrete existing defect corrected: the old rule used `dynamicCap > 0 ? dynamicCap : target`, so zero or negative headroom could still recommend a positive transfer. The shared implementation caps to headroom even when zero. All other rule arithmetic is retained. Estimates are labelled as considerations rather than promised savings or automatic transfers. The emergency profile target is separate from both the goal target and actual recorded progress.

## Existing installment support

The optional Planning flow exposes the existing EMI/30%-of-disposable-income calculation. It requires an explicit whole-PKR price, whole horizon of 1–120 months and APR percentage of 0–100 (zero must be entered explicitly). It uses recorded complete-month average income and average essential spending from the same three months. Unknown expense classifications prevent a conclusion instead of assuming they are discretionary. Zero APR, nonzero APR, ceiling/rounding and the 30% comparison preserve the existing calculation. Output includes the payment, rule explanation, history basis, and caveats about fees/unrecorded obligations. This is arithmetic, not a credit offer, product recommendation or guaranteed affordability.

## Verification and boundaries

Tests use migrated in-memory SQLite or uniquely named temporary fixture files. They cover goal creation/update, validation, fixed ownership, failed-write atomicity, retained stored progress, full remaining/progress arithmetic, percentage cap, deficits, true transfers and legacy transfer rows, profile emergency-target separation, history readiness, empty months, unavailable summaries, grounded category totals, zero headroom, installment calculations and validation, duplicate saves, queued refreshes, and close/reopen persistence with seed preservation. Goal saves and planning reads preserve transactions, account balances, profile settings and history.

No real `kifayat.db` was opened or modified. Earlier modified and untracked work was preserved. No Git staging, commits, pushes, resets, cleaning or branch switching occurred. Native-device layout, keyboard interaction and native app restart were not exercised. The extracted pure financial rules are tested from mobile; the root web build/runtime was not verified because its dependencies are absent from this workspace. Next's local packaged guides are also absent; no Next API, route or page was added or changed.

## Files changed for this task

- `mobile/src/app/(tabs)/planning.tsx`
- `mobile/src/components/savings-planning.tsx`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/finance/planning-rules.ts`
- `mobile/src/lib/repositories/savings-goals-core.ts`
- `mobile/src/lib/repositories/savings-goals.ts`
- `mobile/src/lib/services/savings-planning-core.ts`
- `mobile/src/lib/services/savings-planning.ts`
- `mobile/src/lib/services/savings-goal-ui.ts`
- `mobile/src/lib/validation/savings-goal.ts`
- `mobile/tests/savings-planning.test.ts`
- `mobile/tests/savings-repository.test.mjs`
- `src/lib/finance/constants.ts`
- `src/lib/finance/rules.ts`
- `mobile/docs/phase-5-savings-planning.md`

Final verification: 45 focused savings/planning tests passed; all 275 full mobile tests passed; mobile typecheck, mobile lint and `git diff --check` passed.
