# Phase 5 Task 3: filtered Activity and historical browsing

## Inspection and implementation

Activity previously read at most 5,000 transactions plus every transfer, merged/sorted them in JavaScript, and exposed no filters. The legacy `api.transactions` facade also ignored its page parameter and used a 5,000-row read to calculate a capped total. No mobile screen used that facade, so it was removed. Reporting services continue to use the existing complete, uncapped `listAllTransactions` method; no financial calculations changed.

Existing transaction/transfer repositories, joined row mappings and financial validators were reused. The added `listTransactionActivity` and `listTransferActivity` methods apply filters in SQLite and return at most pageSize + 1 rows from each source. The page service merges those bounded results and supplies the next cursor. No full transfer or transaction list is loaded for browsing.

## Filters and dates

The Activity filter panel supports all types, income, expenses or transfers; a category or uncategorized transaction records; any owned account including archived accounts; all dates, a historical calendar month with previous/next month navigation, or an open/closed custom range; and local literal substring search over merchant and description. Transfer search uses its supported description field. Search is parameterized and escapes `%`, `_` and backslash; SQLite's existing text-case behavior applies. No filter/search value is sent to a backend.

Filters combine with AND. Applied filters remain visible above the list, while draft changes take effect only on Apply. Clear resets both drafts and applied filters and returns to page one. Empty matches explain how to broaden the period or clear filters. Category and account choices reuse existing catalogs. Account matching for native transfers includes either endpoint. Native transfers have no category and are excluded when any category filter is selected, including uncategorized; legacy transaction-table transfers can match their stored category. Income and expense modes never include either form of transfer.

Date controls use `reportingCalendarDateStart` and `reportingMonthRange`, preserving the named `Asia/Karachi` timezone and IANA boundary resolution. Custom ranges include start midnight and exclude end midnight; the labels explicitly say From (inclusive) and Before (exclusive). Either custom bound may be omitted. Months cover their exact half-open reporting interval, including leap days and year transitions. Invalid dates, impossible leap days, and inverted/empty ranges are rejected. Activity row dates and detail dates explicitly use Karachi time rather than the device timezone.

## Pagination and refresh

Activity uses 50-event pages, retaining only one page of full rows in React state. Newer/Older controls traverse the history; only cursor metadata is retained for previous-page navigation. The repository boundary allows page sizes from 1 to 100. A page's two underlying queries each read at most pageSize + 1 records; there is no 5,000-row browsing ceiling or in-memory full-ledger sort.

Global ordering is date DESC, native-transfer kind before transaction kind at equal timestamps, and record ID DESC within each kind. The keyset cursor includes date/kind/ID plus a canonical filter fingerprint. For the same kind, the next page selects earlier dates or smaller IDs at the same date; across kinds the inclusive/exclusive date comparison preserves the global ordering. IDs from separate tables never collide in Activity keys. Using cursors avoids OFFSET scans; search and secondary filters can still scan qualifying rows in SQLite. A disposable-fixture EXPLAIN check confirmed the existing user/date index serves a representative ordered date query. No schema changes, indexes or migrations were added.

The browser controller locks duplicate page taps synchronously and uses request generations to discard results/errors after filter changes, refresh or blur. Filters are retained across pages and retries. Failures preserve the last successfully loaded page and do not advance its cursor. Refresh and focus reload page zero with the current applied filters, avoiding stale cursors after mutations. Existing detail, edit, delete and transfer routes remain in use. Detail screens also refresh on focus after editing. Legacy transfers still route to transaction detail and retain their existing mutation restrictions. Pages scroll back to the top when their rows change. Loading/retry feedback is available beside the page controls as well as above the list.

## Ownership, preservation and verification

Transaction browsing requires both the transaction and its joined account to belong to the configured user. Native transfer browsing requires its owner and both endpoint accounts to match. Inconsistent cross-user account relationships are excluded before mapping, so foreign account labels cannot leak through a browsed event. No caller-selected user ID is accepted by the page query.

Tests cover combined filters, income/expense/native/legacy transfer separation, archived accounts and endpoint matching, literal search and injection-like strings, exact start/end boundaries, leap months and year transitions, tied timestamps with colliding table IDs, pagination/filter continuity, cursor mismatch rejection, duplicate taps, stale responses and blur, retry, refresh after transaction and transfer create/edit/delete, empty results, repository failures, fixed ownership, and a 5,107-row history without omissions or duplicates. All database fixtures are disposable; the real `kifayat.db` was never opened or modified. Browsing does not write records or balances.

Filter state is retained while the Activity screen remains mounted; it is not persisted across app restarts. Page context reports the current loaded count and page number rather than an expensive exact full-match count. Browsing is live, not a frozen multi-page database snapshot; return focus or refresh after mutations starts a fresh traversal. Native-device navigation, keyboard interaction, screen-reader behavior and layout were not exercised. No web feature or dependency was added. Earlier modified/untracked work was preserved, with no staging, commits, pushing, resetting, cleaning or branch switching.

## Files changed in this task

- `mobile/src/app/(tabs)/transactions.tsx`
- `mobile/src/app/transaction/[id].tsx`
- `mobile/src/app/transfer/[id].tsx`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/repositories/transactions-core.ts`
- `mobile/src/lib/repositories/transactions.ts`
- `mobile/src/lib/repositories/transfers-core.ts`
- `mobile/src/lib/repositories/transfers.ts`
- `mobile/src/lib/services/activity-core.ts`
- `mobile/src/lib/services/activity.ts`
- `mobile/src/lib/services/activity-browser-core.ts`
- `mobile/src/lib/validation/activity.ts`
- `mobile/tests/activity-repository.test.mjs`
- `mobile/tests/activity-browser.test.ts`
- `mobile/docs/phase-5-activity-browsing.md`

Final verification: 75 focused activity/repository/calendar/transfer tests passed; full mobile `npm test` passed all 290 tests. Mobile typecheck, mobile lint and `git diff --check` passed.
