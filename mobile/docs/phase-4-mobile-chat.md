# Mobile-ledger chat contract (Phase 4 Tasks 1 and 2)

## Scope and calculation

`chat-context-core.ts` captures one cutoff and reads the existing owned account/transaction repositories. It reuses `createSummaryService` for monthly income, expense, savings and current stored balances, and the reporting calendar for exact `Asia/Karachi` boundaries. Category totals use the same cutoff-filtered expense rows and checked integer addition. Transfers do not count as income or expenses. The snapshot covers this month through the cutoff and the immediately preceding complete calendar month. It contains aggregates, not transaction IDs, merchants, descriptions, account names, emails or user IDs.

History is separately marked complete-from-period-start, partial, unconfirmed or unavailable. A complete-from-start current month is still month-to-date, never a completed month. Zero means no recorded matching entries; it is not presented as proof of complete finances when history is incomplete. Existing history and forecast-readiness services supply status. Balances are explicitly current stored balances, not historical cutoff reconstructions. No financial mutation rules, schema or migrations change.

Current supported scope includes recorded income/expenses/net savings, biggest or named categories, current MTD versus previous-month expense comparisons, forecast explanations and purchase affordability with explicit inputs. The planning details and limited delay follow-up are described below. Arbitrary periods, transaction search, general risk advice and unrestricted financial questions are not supported. No automatic database synchronization or server financial storage exists. For final setup and Android acceptance, see [FINAL-MOBILE-READINESS.md](FINAL-MOBILE-READINESS.md).

## Wire contract

Set `EXPO_PUBLIC_AI_PROXY_URL` in **mobile/.env.local** to the full trusted HTTPS endpoint, for example `https://your-backend.example/api/mobile-chat`. Restart Expo after changing public environment configuration. The client POSTs directly to that URL: it does not append `/chat`. The old web `/api/chat` endpoint streams demo-ledger replies and is incompatible. HTTPS redirects are rejected to avoid disclosing context to an unexpected destination.

The shared dependency-free contract is `mobile/src/lib/chat/contract.ts`. The root server imports this pure module only; it never imports an Expo database singleton. Retain the `mobile/src/lib/chat/` source when packaging the backend.

Request JSON:

```ts
{
  version: 1,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: {
    source: 'mobile_sqlite', asOf: string, timeZone: 'Asia/Karachi',
    history: { status: 'confirmed' | 'unconfirmed' | 'unavailable'; startedAt: string | null },
    forecast: { status: 'ready' | 'insufficient_history'; availableCompleteMonths: number; requiredCompleteMonths: 3 },
    balances: { total: number; accountCount: number; basis: 'current_stored_balance' },
    current: Period, previous: Period,
    planning?: PlanningContext // ForecastResult, parsed purchase or null, stripped assessment or null
  }
}
// Period = { month, start, endExclusive, through, coverage, income, expense, savings, categories: [{name,total}] }
```

Dates are canonical UTC ISO strings; months name Karachi reporting periods. `through` is inclusive; `endExclusive` is exclusive. Current `through` equals `asOf`; previous `through` is the last millisecond before the current period. Coverage is `complete | partial | unconfirmed | unavailable`. Whole-PKR amounts must be safe integers; income/expense are nonnegative, savings equals income minus expense, and category totals equal expense. At most 200 distinct category labels per period are accepted; over-limit data fails clearly without truncating financial totals.

Only the latest 12 messages, each at most 2000 characters, travel to the backend; full history remains local. Latest message must be a user question. Unknown properties, identities and invalid/inconsistent dates, totals or coverage are rejected. Requests are limited to 100 KB. Error responses are HTTP 400 `{error: 'Invalid mobile chat request.'}`. The client never displays raw server error bodies.

Success JSON:

```ts
{ version: 1, text: string, source: 'mobile_sqlite', mode: 'model_selected' | 'deterministic', asOf: string }
```

The client rebuilds the answer catalogue from its original snapshot and validates exact sentence membership, required answer/coverage sentences, and matching source/cutoff. A streaming web reply, malformed JSON or arbitrary prose is rejected and replaced with the original snapshot's deterministic fallback. Network/server/timeouts remain retryable errors. Client timeout is 25 seconds; server provider timeout is 20 seconds, both with abort signals. Server/provider errors are not logged with financial content or returned verbatim.

## Grounding and provider setup

The mobile handler has no Prisma, demo-user, web prompt or web tool imports. It cannot query another ledger. Its numbers are client-provided aggregates, not server-authenticated financial truth; this is a single-local-user explanation service, not an authorization or multi-user financial API.

The handler builds deterministic answer, calculation and completeness sentences from validated aggregates. The optional model receives only that sentence catalogue and required IDs, not raw conversational instructions or financial database rows. It returns JSON `{sentenceIds: [...]}` to select/order existing explanatory sentences. Unknown IDs, missing warnings, arbitrary claims or extra fields fall back to the full deterministic explanation. The mobile client independently checks returned text. This is intentionally constrained composition, not unrestricted LLM prose or semantic transaction retrieval. The older regex validator's amount tolerance alone would not catch swapped income/expense claims, so this path uses exact facts and sentence validation instead.

Keep `GROQ_API_KEY` and optional `GROQ_MODEL` exclusively in the root backend's server environment (e.g. root `.env.local`). Run the retained backend using its existing dependency/setup process; no Prisma seed or database is required by this mobile route. Without a server provider key, or on provider failure/invalid output, the route returns a deterministic grounded response. Without a mobile endpoint, the app computes that response entirely on-device and identifies that AI wording was not used. With an endpoint configured, monthly/planning aggregates and recent chat messages leave the device; use only a trusted service. No API key belongs in `EXPO_PUBLIC_*`.

Prompt-injection tests demonstrate bounded outputs for the tested cases, not complete protection. There is no deployment authentication or provider abuse quota added in this task. Existing web/demo routes remain separate and unchanged. Native network/platform behavior and live-provider operation require separate verification.

## Conversation and verification

Chat history is retained in the existing tables. Reads/writes verify conversation ownership, and ordering uses creation time plus row ID. A synchronous session lock prevents double taps, waits for initial history load, and retries failed requests without duplicating the stored user message. If assistant persistence fails, retry reuses its already validated response. An app restart retains successful messages but not the in-memory pending-retry state; no new persistence schema was introduced.

Tests cover context arithmetic, Karachi month/year/leap boundaries, transfers/future cutoffs, incomplete/empty states, real disposable SQLite ownership, mocked HTTP/provider integration, exact grounding, invalid inputs/responses, configuration, network/server/timeout failures, long histories, duplicate submissions, retries and persistence/reload. Provider tests are mocked; no live provider call or native runtime run is implied.

## Phase 4 Task 2: planning explanations

The context additionally carries a strict `planning` aggregate: the existing `ForecastResult`, a parsed purchase amount/horizon (or null), and a stripped affordability result (or status/guidance). No account rows or identifiers from the affordability assessment leave the device. `createForecastReadinessService`, `createSummaryService`, and `createAffordabilityService` remain the calculation sources. The affordability adapter reuses the captured summary and forecast, and reads the existing profile and active-account repositories. Existing financial calculations, migrations, and readiness rules are unchanged.

Forecast questions support estimated total/range, ranked categories, readiness reasons, reliability caveats and comparison with the previous calendar month's recorded expenses. Estimates are not promises or calibrated probabilities. The preceding three complete Karachi months are used; the current month is excluded, and eligible empty months retain zero values.

Purchase questions accept a positive whole-PKR amount and a whole horizon of 1–120 months. Missing inputs prompt clarification; “now” and zero months explain the existing immediate-purchase limitation. “What if I wait two months?” reuses an explicit amount from the most recent purchase question within the existing 12-message window and recomputes against fresh local facts. Assistant prose never supplies financial inputs. Emergency-buffer questions explain the rule; a numerical purchase assessment requires amount and horizon. Safe-spend capacity is the existing result's projected `available` funds after the buffer, conditional on that horizon; it is not guaranteed spending money.

All planning answer sentences are mandatory, including warnings and reasons. Invalid backend text now returns the original snapshot's deterministic fallback on the client; transport failures remain retryable. Backend credentials, provider selection, request limits, persistence, and duplicate-submission behavior are unchanged. The model sees only approved sentences. The backend receives the bounded recent conversation plus monthly/planning aggregates, not transactions or account names. Legacy contexts without planning remain accepted and cannot produce invented forecast amounts.
