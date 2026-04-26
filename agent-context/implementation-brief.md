# SQL Agent — Implementation Brief (Phase 1 + 2A + 2B + 2B-B + 2C + 2D)

This brief summarizes the current state of the SQL Agent service. It is
intended as context for a downstream agent that will continue
implementation. Everything below describes **what exists today**. A
separate "Phase 2 scope" section lists what's explicitly NOT built so
you don't duplicate or re-scope committed work.

---

## 1. Project identity

- **Name**: sql-agent
- **Purpose**: convert natural-language analytics questions into
  validated MySQL `SELECT` statements and execute them against
  tenant-scoped databases in a multi-tenant SaaS.
- **Posture**: controlled analytics system. Validation is never
  skipped. The LLM never sees credentials.
- **Language**: JavaScript (ES modules). JSDoc typedefs + runtime
  schema validators substitute for TypeScript. Do NOT introduce
  TypeScript or `.ts` files.
- **Runtime**: Node.js 18+. Express. LangGraph JS. mysql2. node-sql-parser.
- **Location**: `/Users/hardik/Projects/SQL_agent/`

---

## 2. Architecture boundaries

The service sits between three external components:

```
┌─────────────┐   POST /insights/query   ┌──────────────┐
│ api-gateway │ ────────────────────────▶│  sql-agent   │
│ (OpenResty) │   HMAC-signed headers    │  (this repo) │
└─────────────┘                          └──────┬───────┘
                                                │
                   POST /tenant/resolve         │
                   ┌────────────────────────────┘
                   ▼
            ┌────────────────┐         ┌──────────────────┐
            │  tenant-router │────────▶│   tenant MySQL   │
            │ (control plane)│ metadata│ (one DB / brand) │
            └────────────────┘         └──────────────────┘
```

### api-gateway (upstream)

- OpenResty-based gateway at `dashboard/api-gateway/`.
- Verifies JWT, injects `x-user-id`, `x-brand-id`, `x-role`,
  `x-permissions`, plus an HMAC-signed `x-gw-ts` + `x-gw-sig` pair.
- HMAC payload: `sub|brand_id|role|ts`. Secret is
  `GATEWAY_SHARED_SECRET`.
- Strips `Authorization` before forwarding. CORS is gateway-side.
- No request-id / traceparent header — sql-agent generates its own
  `x-correlation-id` when absent.

### tenant-router (sibling control plane)

- Service at `dashboard/tenant-router/`.
- One endpoint used by this service: `POST /tenant/resolve` with body
  `{ brand_id }`.
- Response shape (snake_case, flat):
  `brand_id, shard_id, rds_proxy_endpoint, database, user, password,
  port, status ("active"|"suspended"|…)`.
- Error codes: `400 missing_brand_id`, `404 tenant_not_found`,
  `403 tenant_suspended`, `503 routing_unavailable`. Error body is
  `{ error: "<code>" }`.
- Accepts `x-pipeline-key` as an internal bypass header for
  service-to-service calls that skip the gateway.
- Has its own 10-minute cache with stale-on-failure fallback.
- `GET /health` returns `{ status: "ok", service: "tenant-router" }`.

**This service must never bypass tenant-router for tenant resolution.**

### Schema source (Phase 2A)

- The validation layer needs a `SchemaContext` describing the
  tenant's allowed tables and columns.
- **Today** (Phase 2A): the schema is loaded once per process from a
  checked-in MySQL dump at `schema/schema.sql` (51 tables) and cached
  in-process. Same schema for every tenant.
- **Tomorrow** (Phase 2B+): the source will be replaced with a
  semantic-layer lookup or a live `information_schema` query.
  Consumers don't change — the `SchemaContext` shape is stable.

---

## 3. Current phase scope

**Phase 1 (built)**: validation layer, tenant-aware execution, contracts,
LangGraph orchestration skeleton, one API route, gateway-trust
middleware.

**Phase 2A (built)**: schema context provider that parses
`schema/schema.sql` into a normalized `SchemaContext`, with in-process
caching and a dedicated `load_schema` orchestrator node that runs first
in the graph.

**Phase 2B-A (built)**: LLM-backed planner. The planner node now
supports two modes — `mock` (deterministic, default) and `llm` (real
OpenAI JSON-mode call). Mode is controlled by `PLANNER_MODE`. The LLM
client lives in `lib/llm.js` and lazy-imports `@langchain/openai` only
when actually invoked. Output is contract-validated via
`assertQueryPlan`; non-JSON or invalid shapes raise `ContractError`.

**Phase 2B (built)**: Context-aware planner with clarification
handling. The `QueryPlan` contract is widened with `status`
(`"ready"|"needs_clarification"`), `clarificationQuestion`,
`assumptions`, and `metricDefinitions`. The planner consumes optional
`globalContext` (brand metric catalog / glossary) and `chatContext`
(per-conversation hints / confirmed formulas) — both attached as
optional fields on `AgentState`. Compact prompt context is built by
`modules/planner/plannerContext.js`. When the planner can't
disambiguate a metric (e.g., "cancellation rate" with no formula in
context), it returns `status="needs_clarification"`. A conditional
edge after the planner short-circuits the graph straight to `END` in
that case — SQL generation, validation, and execution don't run. The
controller surfaces a dedicated `clarification_required` response
shape via the exported `buildResponseFromState` helper.

**Phase 2B-B (built)**: LLM-backed SQL generator. The SQL node now
supports two modes — `mock` (deterministic, default) and `llm` (real
OpenAI JSON-mode call) — controlled by `SQL_MODE`. Compact prompt
context is built by `modules/sql/sqlContext.js`, which scopes the
schema digest to `plan.targetTables` so token usage stays bounded
even on tenants with many tables. The generator implements the
planner's `metricDefinitions` literally (no algebraic substitution).
Output is validated by `assertSqlDraft`; non-JSON, empty SQL, missing
fields, or non-`mysql` dialect raise `ContractError`. A defensive
guard rejects `needs_clarification` plans that somehow reach the
node, so the graph's conditional edge is the single source of truth.
The deterministic validation layer remains the sole gate for SQL
safety — the SQL node does NOT regex-check DDL/DML.

**Phase 2C (built)**: bounded correction loop. When validation fails,
a conditional `validationRouter` edge sends the request to a new
`correct` node (`apps/api/src/orchestrator/nodes/correction.node.js`)
which receives the failing SQL plus the structured `V_*` issues and
emits a replacement `SqlDraft`. The corrected draft loops back into
`validate`. The loop is capped at `MAX_CORRECTION_ATTEMPTS`
(env-overridable, default 2). When attempts exhaust, the graph routes
to `END`; the controller renders the existing `E_VALIDATION` failure
envelope with `correctionAttempts` + `correctionHistory` in
`error.details` and a `422` HTTP status. The `validate` node no
longer throws on invalid SQL — failure is a normal state transition
the router consumes. The correction node mirrors the
planner/SQL-generator pattern (factory, mock/llm modes, prompt
context builder); mock mode returns the failing SQL unchanged so the
loop exits at the cap without fabricating fixes.

**Phase 2D (built)**: semantic layer + context persistence + hybrid
retrieval. A new `load_context` node runs between `load_schema` and
`planner`, populating `state.chatContext`, `state.globalContext`, and
`state.retrievalContext`. Three pluggable providers are wired:
**Redis** (chat memory), **MongoDB** (semantic catalog of metric
formulas/synonyms), and **Qdrant** (vector candidates over an
embedding service). Each provider is **fully optional** — when its
env URL is unset, an in-memory fallback with the same async API
keeps the system running with reduced grounding intelligence. The
hybrid retrieval pipeline is `chat memory → vector candidates →
catalog round-trip → globalContext`; vector hits are NEVER fed
directly to SQL — they always flow through the catalog (the truth)
before reaching the planner. After successful execution the
controller writes a chat-memory delta via `extractMemoryFromPlan`
(question + metric refs + filter refs + chat-confirmed metric
definitions only — never SQL or LLM prose).

**Not built** (Phase 2E+): result explanation, caching beyond the
schema cache, advanced planner logic, vector-store ingestion
pipeline, admin UI for `retrievalContext` traces.

---

## 4. Directory layout

```
SQL_agent/
├── apps/api/src/
│   ├── controllers/insight.controller.js
│   ├── routes/insight.routes.js
│   ├── middleware/tenantContext.middleware.js
│   ├── orchestrator/
│   │   ├── graph.js
│   │   ├── state.js
│   │   └── nodes/{schema,plan,sql,validate,execute}.node.js
│   ├── modules/
│   │   ├── schema/                     ← Phase 2A
│   │   │   ├── schema.types.js
│   │   │   ├── schemaParser.js
│   │   │   ├── schemaCache.js
│   │   │   └── schemaProvider.js
│   │   ├── planner/                    ← Phase 2B
│   │   │   └── plannerContext.js
│   │   ├── sql/                        ← Phase 2B-B
│   │   │   └── sqlContext.js
│   │   ├── correction/                 ← Phase 2C
│   │   │   └── correctionContext.js
│   │   ├── context/                    ← Phase 2D
│   │   │   └── contextLoader.js
│   │   ├── chatMemory/                 ← Phase 2D
│   │   │   ├── chatMemoryProvider.js
│   │   │   └── memoryExtractor.js
│   │   ├── semantic/                   ← Phase 2D
│   │   │   ├── semantic.types.js
│   │   │   └── semanticProvider.js
│   │   ├── vector/                     ← Phase 2D
│   │   │   ├── embeddingService.js
│   │   │   └── vectorClient.js
│   │   ├── validation/
│   │   │   ├── validator.js
│   │   │   ├── rules/{syntax,safety,schema,cost}.rule.js
│   │   │   └── validation.types.js
│   │   ├── execution/
│   │   │   ├── executor.js
│   │   │   ├── poolManager.js
│   │   │   └── execution.types.js
│   │   ├── tenant/
│   │   │   ├── tenantClient.js
│   │   │   └── tenant.types.js
│   │   └── contracts/
│   │       ├── queryRequest.js
│   │       ├── queryPlan.js
│   │       ├── sqlDraft.js
│   │       ├── validationResult.js
│   │       ├── executionResult.js
│   │       └── agentState.js
│   ├── lib/{llm,parser,runtimeValidators}.js
│   ├── utils/{logger,errors,constants,helpers}.js
│   ├── config/{env,models}.js
│   ├── app.js
│   └── server.js
├── shared/{db/mysql.types,types/common.types}.js
├── prompts/{planner,sql,correction}.prompt.md
├── schema/schema.sql                   ← real tenant DDL (51 tables)
├── tests/{validation,execution,orchestrator,middleware,schema,contracts,planner,sql,correction,context,semantic,vector,chatMemory,controllers}/*.test.js
├── docs/GATEWAY_INTEGRATION.md
├── agent-context/{system-context,implementation-brief}.md
├── Dockerfile
├── .env.example
├── jsconfig.json
├── package.json
└── README.md
```

---

## 5. API surface

### `POST /insights/query`

**Gateway headers required** (sql-agent rejects unsigned requests with
401 when `GATEWAY_SHARED_SECRET` is set):

```
x-brand-id:    <BRAND>
x-user-id:     <uuid>
x-role:        viewer|author|admin
x-permissions: comma,separated (optional)
x-gw-ts:       unix seconds
x-gw-sig:      hex HMAC-SHA256(sub|brand_id|role|ts, GATEWAY_SHARED_SECRET)
x-correlation-id: optional; generated if absent
```

**Body** (validated against the `QueryRequest` contract):

```json
{
  "question": "How many orders per day in the last 30 days?",
  "context": { /* optional caller context */ }
}
```

**Response envelope**:

```json
{
  "ok": true,
  "correlationId": "…",
  "result": {
    "ok": true,
    "columns": ["day", "order_count"],
    "rows": [ /* up to EXEC_MAX_ROWS */ ],
    "stats": { "rowCount": 30, "elapsedMs": 42, "truncated": false }
  }
}
```

### `GET /health`

Returns `{ ok: true }`. Used by Docker healthchecks.

---

## 6. Request lifecycle

```
client → gateway → tenantContextMiddleware → insight.controller → orchestrator
                      │                                                │
                      ├─ verify HMAC (x-gw-sig)                        ├─ load_schema  [REAL]
                      ├─ tenant-router POST /tenant/resolve            ├─ load_context [REAL — Redis|Mongo|Qdrant + in-memory fallbacks]
                      └─ normalize → req.tenant                        ├─ plan node    [REAL: mock|llm; clarification-aware]
                                                                       ├─ (conditional) → END if needs_clarification
                                                                       ├─ sql node     [REAL: mock|llm]
                                                                       ├─ validate     [REAL — non-throwing]
                                                                       ├─ (conditional) → correct (loop, ≤ MAX) | END (exhausted)
                                                                       ├─ correct      [REAL: mock|llm] → validate
                                                                       └─ execute      [REAL] → (controller fire-and-forget memory write)
                                                                              │
                                                                              ▼
                                                                     tenant MySQL pool
```

Graph edges (with Phase 2B planner conditional, Phase 2C correction
loop, and Phase 2D context loader):

```
START → load_schema → load_context → planner ─┬─→ generate_sql → validate ─┬─→ execute → END
                                               └─→ END (clarification)      ├─→ correct → validate (loop, ≤ MAX_CORRECTION_ATTEMPTS)
                                                                            └─→ END   (correction exhausted; controller emits 422)
```

> **Node id note**: the planner node is registered as `planner` (not
> `plan`) because LangGraph rejects node names that collide with state
> channel keys. The conceptual order from the spec is preserved.

> **Conditional edge (Phase 2B)**: after the planner node runs, a
> `planRouter(state)` function inspects `state.plan.status`. If the
> plan is `needs_clarification`, the graph routes straight to `END`.
> The controller then renders a `clarification_required` envelope via
> `buildResponseFromState`. SQL generation, validation, and execution
> NEVER run in that branch. `planRouter` is exported for direct
> testing.

> **Conditional edge (Phase 2C)**: after the validate node runs, a
> `validationRouter(state)` function inspects
> `state.validation.valid` and `state.correctionAttempts`. Three
> outcomes:
>
>   - valid → `execute`
>   - invalid AND attempts < `env.correction.maxAttempts` → `correct`
>   - invalid AND attempts ≥ max → `END`
>
> When the loop exhausts, the controller's `buildResponseFromState`
> returns the `E_VALIDATION` envelope with the failing `V_*` issues
> and the full `correctionHistory` in `error.details`. HTTP status
> is 422. `validationRouter` is exported for direct testing.

> **load_context node (Phase 2D)**: runs between `load_schema` and
> `planner`. Reads chat memory (Redis or in-memory), runs hybrid
> retrieval over the semantic catalog (Mongo or in-memory) +
> vector store (Qdrant or in-memory), and attaches `chatContext`,
> `globalContext`, and `retrievalContext` to state. Never calls an
> LLM. Never calls tenant-router or the tenant DB. Never mutates
> `schemaContext`. All three external services are optional —
> unset URLs trigger an in-memory fallback for that provider.
> `retrievalContext.source` is one of
> `memory|catalog|vector|hybrid|none` for trace observability.

> **Memory write (Phase 2D)**: after a successful execution the
> controller calls `extractMemoryFromPlan({request, plan, result})`
> and writes the resulting delta via the chat memory provider.
> Fire-and-forget — failures are logged and swallowed so a Redis
> hiccup never breaks an otherwise-successful query. The delta
> NEVER contains SQL, raw LLM output, or planner assumptions; only
> the question, metric refs, filter refs, chat-confirmed metric
> definitions, and a tiny structural result summary
> (`rows=N; truncated=...`).

---

## 7. Module status — REAL vs MOCKED

### REAL (production-shaped, used as-is)

| Area                | File                                                     |
|---------------------|----------------------------------------------------------|
| Tenant client       | `modules/tenant/tenantClient.js`                         |
| Tenant normalizer   | `modules/tenant/tenant.types.js`                         |
| Gateway-trust mw    | `middleware/tenantContext.middleware.js`                 |
| **Schema parser**   | `modules/schema/schemaParser.js`                         |
| **Schema cache**    | `modules/schema/schemaCache.js`                          |
| **Schema provider** | `modules/schema/schemaProvider.js`                       |
| **Schema types**    | `modules/schema/schema.types.js`                         |
| **load_schema node**| `orchestrator/nodes/schema.node.js`                      |
| Validator pipeline  | `modules/validation/validator.js`                        |
| Syntax rule         | `modules/validation/rules/syntax.rule.js`                |
| Safety rule         | `modules/validation/rules/safety.rule.js`                |
| Schema rule         | `modules/validation/rules/schema.rule.js`                |
| Cost rule           | `modules/validation/rules/cost.rule.js`                  |
| Executor            | `modules/execution/executor.js`                          |
| Pool manager        | `modules/execution/poolManager.js`                       |
| Runtime validators  | `lib/runtimeValidators.js`                               |
| Contracts           | `modules/contracts/*.js`                                 |
| LangGraph compile   | `orchestrator/graph.js` + `state.js`                     |
| Validate/Execute nodes | `orchestrator/nodes/{validate,execute}.node.js`       |
| **Plan node (mock + llm + clarification)** | `orchestrator/nodes/plan.node.js`         |
| **Planner context builder** | `modules/planner/plannerContext.js` — pure function: schema digest + merged metric definitions |
| **Plan router (conditional edge)** | `orchestrator/graph.js` — `planRouter(state)` exported for tests |
| **SQL node (mock + llm)** | `orchestrator/nodes/sql.node.js` — Phase 2B-B; mirrors planner factory pattern |
| **SQL context builder** | `modules/sql/sqlContext.js` — pure function; scopes schema digest to `plan.targetTables` |
| **Correction node (mock + llm)** | `orchestrator/nodes/correction.node.js` — Phase 2C; mirrors planner/SQL factory pattern; consumes failing draft + `V_*` issues |
| **Correction context builder** | `modules/correction/correctionContext.js` — pure function; reuses `buildSqlSchemaDigest` |
| **Validation router (conditional edge)** | `orchestrator/graph.js` — `validationRouter(state)` exported for tests |
| **load_context node**          | `orchestrator/nodes/context.node.js` — Phase 2D; factory `createContextNode({ loader })` for test injection; reads `request.context.{userId,conversationId}` |
| **Context loader**             | `modules/context/contextLoader.js` — Phase 2D; `createContextLoader({chatMemory, semantic, vector, topK})` pure DI surface; `createDefaultContextLoader()` env-driven default |
| **Chat memory provider**       | `modules/chatMemory/chatMemoryProvider.js` — Phase 2D; Redis (lazy-import) + in-memory TTL fallback; tenant-scoped key `sql-agent:chat:{brandId}:{userId}:{conversationId}` |
| **Memory extractor**           | `modules/chatMemory/memoryExtractor.js` — Phase 2D; pure `extractMemoryFromPlan({request, plan, result})` — never returns SQL or LLM prose |
| **Semantic catalog**           | `modules/semantic/semanticProvider.js` — Phase 2D; MongoDB (lazy-import) + in-memory fallback; `metricsToGlobalContext` pure projection |
| **Embedding service**          | `modules/vector/embeddingService.js` — Phase 2D; OpenAI (`@langchain/openai` lazy-import) + deterministic SHA-256 unit-normalised mock |
| **Vector client**              | `modules/vector/vectorClient.js` — Phase 2D; Qdrant via `undici` (no extra dep) + in-memory cosine fallback; tenant-scoped filter |
| **Controller response builder + status + memory write** | `controllers/insight.controller.js` — `buildResponseFromState` + `httpStatusForState` exported for tests; fire-and-forget `writeMemoryDelta` after execution |
| **LLM client**      | `lib/llm.js` — `getLlm(role)` returns `{ invokeJson }`, OpenAI JSON-mode |
| Error hierarchy     | `utils/errors.js`                                        |
| Logger (redacted)   | `utils/logger.js`                                        |
| Env validation      | `config/env.js`                                          |

### MOCKED (placeholders, swap-ready)

_None as of Phase 2B-B. The remaining mock fallbacks (planner mock,
SQL mock) are CI-mode behaviour of REAL nodes — they're the
deterministic path of the same modules._

### Plan node modes

`plan.node.js` runs in one of two modes (controlled by `PLANNER_MODE`):

| Mode | When | Behavior |
|------|------|----------|
| `mock` (default) | `PLANNER_MODE` unset, or any value other than `llm` | Returns deterministic plan targeting `gross_summary` — no LLM call, no API key required. Mock output now carries the full Phase 2B shape (`status:"ready"`, empty `assumptions`, empty `metricDefinitions`). |
| `llm` | `PLANNER_MODE=llm` (requires `OPENAI_API_KEY`) | Builds compact planner context via `buildPlannerContext` (question + schema digest + `globalContext` metrics + `chatContext` confirmations + glossary + recent questions), loads system prompt from `prompts/planner.prompt.md`, invokes the LLM via `lib/llm.js` in JSON mode, strips forbidden keys (`sql`, `query`, …), validates against `assertQueryPlan` (which normalizes legacy fields and cross-validates ready/clarification rules). Non-JSON or invalid shapes raise `ContractError`. |

Both modes produce identical-shape `QueryPlan` output. The factory
`createPlanNode({ mode, llm })` allows tests to inject a fake LLM
client without touching env or pulling in `@langchain/openai`.

### Plan node clarification flow (Phase 2B)

When the LLM returns `status: "needs_clarification"`:
- `targetTables` may be empty.
- `clarificationQuestion` MUST be a non-empty string (enforced by
  `assertQueryPlan`'s cross-validation).
- The planner sets `state.status = AGENT_STATUS.CLARIFICATION_REQUIRED`
  (vs `PLANNED`) so the orchestration status is observable in logs.
- The conditional edge `planRouter` routes to `END` immediately —
  `generate_sql`, `validate`, `execute` do not run.
- The controller's `buildResponseFromState` returns a
  `clarification_required` envelope; no execution payload.

The planner is told (via `planner.prompt.md`) to return
`needs_clarification` for any business metric whose formula isn't in
the provided `globalContext` / `chatContext` AND whose name has more
than one reasonable interpretation (cancellation rate, conversion
rate, churn, AOV, LTV, "active users", etc.).

### SQL node modes (Phase 2B-B)

`sql.node.js` mirrors the planner's mode design. Mode is controlled
by `SQL_MODE`:

| Mode | When | Behavior |
|------|------|----------|
| `mock` (default) | `SQL_MODE` unset, or any value other than `llm` | Returns deterministic `SELECT date, overall_sale, gross_sales FROM gross_summary ORDER BY date DESC LIMIT 30`. CI-safe; no API key required. |
| `llm` | `SQL_MODE=llm` (requires `OPENAI_API_KEY`) | Builds compact SQL context via `buildSqlContext` (question + plan + schema digest scoped to `plan.targetTables` + metric definitions + assumptions), loads system prompt from `prompts/sql.prompt.md`, invokes the LLM via `getLlm('sql').invokeJson(...)` in JSON mode, strips forbidden keys, sanitizes (trim + remove ≤ 1 trailing semicolon), validates against `assertSqlDraft`. Empty SQL / wrong dialect / missing fields raise `ContractError`. |

Both modes produce identical-shape `SqlDraft` output. The factory
`createSqlNode({ mode, llm })` allows tests to inject a fake LLM
client without touching env or pulling in `@langchain/openai`.

### SQL node guarantees (Phase 2B-B)

- **Pre-conditions**: throws `ContractError` if `state.request`,
  `state.plan`, or `state.schemaContext` is missing.
- **Clarification guard**: if `plan.status === "needs_clarification"`
  somehow reaches this node (graph-routing bug), the node throws
  `ContractError` rather than compiling SQL the user never confirmed.
- **Plan fidelity**: the prompt forbids re-planning. The generator
  implements the planner's `metricDefinitions` literally — no
  algebraic substitution.
- **Sanitization is minimal**: trim + strip ≤ 1 trailing semicolon.
  Anything beyond that — DDL/DML detection, schema fidelity,
  cross-database refs — is the deterministic validation layer's job.
  The SQL node intentionally does NOT regex-check safety.

### Correction node modes (Phase 2C)

`correction.node.js` mirrors the planner and SQL nodes. Mode is
controlled by `CORRECTION_MODE`:

| Mode | When | Behavior |
|------|------|----------|
| `mock` (default) | `CORRECTION_MODE` unset, or any value other than `llm` | Returns the failing SQL unchanged with rationale `"[mock correction] unchanged"`. The next validate run fails with the same issues; loop exits at `MAX_CORRECTION_ATTEMPTS`. Conservative + CI-safe. |
| `llm` | `CORRECTION_MODE=llm` (requires `OPENAI_API_KEY`) | Builds compact correction context via `buildCorrectionContext`, loads system prompt from `prompts/correction.prompt.md`, invokes the LLM via `getLlm('correction').invokeJson(...)` in JSON mode. Same sanitization (trim + ≤ 1 trailing semicolon) and same `assertSqlDraft` validation as the SQL node. |

Both modes produce identical-shape `SqlDraft` output. The factory
`createCorrectionNode({ mode, llm })` allows tests to inject a fake
LLM client.

### Correction node guarantees (Phase 2C)

- **Pre-conditions**: throws `ContractError` if any of
  `request`, `plan`, `schemaContext`, `sqlDraft`, `validation` is
  missing; if `validation.valid === true`; if `validation.issues` is
  empty; or if `plan.status === "needs_clarification"`. The router
  should never route to correction in those cases — these are
  defence-in-depth guards.
- **Bounded loop**: `MAX_CORRECTION_ATTEMPTS` (default 2,
  env-overridable, floor 0). Setting it to 0 disables the correction
  loop entirely (single-shot validate).
- **Plan fidelity**: prompt instructs "fix only the reported
  `V_*` issues; do not re-plan; implement `metricDefinitions`
  literally". A per-V_*-code fix-by-code table is in the prompt.
- **State accumulation**:
  - `state.correctionAttempts` — incremented monotonically (0 → N).
  - `state.correctionHistory` — append-only audit trail of
    `{attempt, issues, previousSql, correctedSql, mode}` entries.
    Never contains credentials or routing data.
- **Failure mode**: empty `sql` from the LLM (the prompt's
  unfixable-plan escape) trips `assertSqlDraft` → `ContractError`.
- **No SQL execution**. The correction node ONLY produces a
  replacement draft. Validation must always run after correction
  (graph edge `correct → validate` enforces this).

### Context loader / providers (Phase 2D)

`modules/context/contextLoader.js` is the only orchestrator-facing
entry point for the three external services. It accepts injected
providers (`chatMemory`, `semantic`, `vector`) so tests stay hermetic.

**Hybrid retrieval pipeline**:

1. Read chat memory for `(brandId, userId, conversationId)`.
2. Vector search over `tenantId`-filtered points (best-effort —
   failures are logged and skipped, the catalog still works).
3. Round-trip vector candidate `metricId`s through the semantic
   catalog to get authoritative formulas.
4. Project the catalog hits into `globalContext.metrics` via
   `metricsToGlobalContext`.
5. Stamp `retrievalContext` with the source label and a debug blob.

**Priority order** (planner enforces this; the loader just
surfaces all sources):

1. `chatContext.confirmedMetricDefinitions` — user confirmations.
2. `globalContext.metrics` — semantic catalog truth.
3. (Vector hits not in the catalog never reach the planner.)
4. Otherwise: planner returns `needs_clarification`.

**Fallback semantics** (each provider, independently):

| Provider | When env URL set | When unset / package missing |
|---|---|---|
| Redis chat memory | Lazy-imports `redis`, real connection | In-memory `Map` with `expiresAt`-based TTL |
| MongoDB semantic catalog | Lazy-imports `mongodb`, real connection | In-memory `Map` keyed by `${tenantId}:${metricId}` |
| Qdrant vector store | Direct REST via `undici` (no extra dep) | In-memory `Map` + cosine similarity full-scan |
| OpenAI embeddings | `@langchain/openai`, real model | Deterministic SHA-256-based unit-normalised stub |

**Fallback discriminator**: each provider exposes a `mock: boolean`
property and tests assert against it.

### Memory write (Phase 2D)

Side-effect on success path. The controller calls
`extractMemoryFromPlan` and persists the delta via the chat memory
provider. **Storage rules** (also enforced by the extractor's
test suite):

- ✅ user's `question` → appended to `previousQuestions` (capped at 10)
- ✅ `plan.requiredMetrics` → `lastMetricRefs`
- ✅ `plan.filters` → `lastFilterRefs`
- ✅ `plan.metricDefinitions` where `source === 'chat_context'`
  → `confirmedMetricDefinitions` (those are user-confirmed; global
  formulas live in the catalog and would just shadow it)
- ✅ tiny structural `lastResultSummary` ("rows=N; truncated=…") —
  never rows themselves, never LLM-generated prose
- ❌ never SQL (any form), never raw LLM rationale, never planner
  assumptions, never tenant credentials / routing

Memory write failures are caught and logged; they NEVER affect the
HTTP response.

### Validate node behaviour change (Phase 2C)

`validate.node.js` no longer throws `ValidationError` on invalid SQL.
Failure is now a normal state transition: the node returns the
failing `ValidationResult` and the `validationRouter` decides whether
to route to correction (loop), `END` (exhausted), or `execute` (when
valid). Pre-condition errors (missing `sqlDraft` / `schemaContext`)
still throw — those are programmer errors, not user errors.

The controller picks up validation-failure-after-exhaustion via
`buildResponseFromState`, which emits the existing `E_VALIDATION`
envelope with `correctionAttempts` + `correctionHistory` in
`error.details`. HTTP status is `422` (returned by the new
`httpStatusForState` helper).

---

## 8. Contracts (stable interfaces)

Defined in `apps/api/src/modules/contracts/`,
`apps/api/src/modules/tenant/tenant.types.js`, and
`apps/api/src/modules/schema/schema.types.js`. Every module boundary
validates against them via `runtimeValidators.js`. Changing a contract
means updating both the JSDoc typedef and the `assert*` function in the
same file.

```js
QueryRequest         { brandId, question, correlationId?, context? }

// Phase 2B widened
MetricDefinition     { name, formula?, description?, source: 'global_context'|'chat_context'|'planner_assumption' }
QueryPlan            { intent, targetTables[], requiredMetrics[], filters?, timeGrain?, notes?,
                       status: 'ready'|'needs_clarification',
                       clarificationQuestion: string|null,
                       assumptions: string[],
                       metricDefinitions: MetricDefinition[] }

SqlDraft             { sql, dialect: 'mysql', tables[], rationale? }
ValidationIssue      { code: 'V_*', message, severity: 'error'|'warning', meta? }
ValidationResult     { valid, issues[], normalizedSql? }
ExecutionStats       { rowCount, elapsedMs, truncated }
ExecutionResult      { ok, columns[], rows[], stats, error?, errorCode? }

// Phase 2B placeholders, populated for real in Phase 2D
GlobalContext        { metrics?: Record<name, { formula?, description?, synonyms? }>,
                       glossary?: Record<term, definition>,
                       synonyms?: Record<term, canonical> }
ChatContext          { previousQuestions?: string[],
                       confirmedMetricDefinitions?: Record<name, formula>,
                       lastUsedFilters?: object[], lastResultSummary?: string|null,
                       lastMetricRefs?: string[], lastFilterRefs?: object[] }   // ← Phase 2D widening

// Phase 2C
CorrectionHistoryEntry { attempt, issues, previousSql, correctedSql?, mode: 'mock'|'llm' }

// Phase 2D
RetrievalContext     { vectorCandidates?: Array<{ metricId, score }>,
                       resolvedMetricIds?: string[],
                       source?: 'memory'|'catalog'|'vector'|'hybrid'|'none',
                       debug?: Record<string, unknown> }
SemanticMetric       { metricId, tenantId, formula?, description?, synonyms?, tables?, columns?, version? }

AgentState           { correlationId, request, tenant,
                       schemaContext?, globalContext?, chatContext?, retrievalContext?,
                       plan?, sqlDraft?, validation?, execution?,
                       correctionAttempts?, correctionHistory?,
                       status, error? }
TenantExecutionContext { brandId, database, host, port, shardId?, poolKey, credentials: { user, password } }

// Phase 2A
SchemaColumn         { name, type, nullable: boolean|null, defaultValue: string|null,
                       isPrimaryKey, isForeignKey, references: {table,column}|null }
SchemaTable          { name, columns: Record<string, SchemaColumn>, primaryKey: string[], foreignKeys: SchemaForeignKey[] }
SchemaForeignKey     { column, referencesTable, referencesColumn }
SchemaJoin           { fromTable, fromColumn, toTable, toColumn }
SchemaContext        { dialect: 'mysql', source: string, database: string|null,
                       tables: Record<string, SchemaTable>,
                       allowedTables: string[],
                       allowedColumns: Record<string, string[]>,
                       allowedJoins: SchemaJoin[] }
```

`assertSchemaContext` enforces both shape AND cross-references: every
entry in `allowedTables` must exist in `tables`, and every column in
`allowedColumns[t]` must exist in `tables[t].columns`.

`assertQueryPlan` (Phase 2B) **normalizes** missing newer fields to
safe defaults (`status="ready"`, `clarificationQuestion=null`,
`assumptions=[]`, `metricDefinitions=[]`) so legacy / minimal /
mock-shape inputs still round-trip. It also **cross-validates**:
`status="needs_clarification"` requires a non-empty
`clarificationQuestion`; `status="ready"` requires non-empty
`targetTables`. Both produce `ContractError` with explicit messages.

---

## 9. Validation rules (stable V_* codes)

Defined in `utils/constants.js`. Safe for clients to match against.

```
V_EMPTY_SQL             Syntax: input is empty or whitespace
V_PARSE_FAILED          Syntax: parser threw
V_MULTIPLE_STATEMENTS   Syntax: more than one statement
V_NOT_SELECT            Syntax: not a SELECT
V_DDL_FORBIDDEN         Safety: DDL anywhere in the AST
V_DML_FORBIDDEN         Safety: DML anywhere in the AST
V_CROSS_DATABASE        Safety: table qualified with a different db
V_TABLE_NOT_ALLOWED     Schema: table not in allowedTables
V_COLUMN_NOT_ALLOWED    Schema: column not in allowedColumns[table]
V_GROUP_BY_INVALID      Cost: unaggregated column_ref not in GROUP BY
V_MISSING_LIMIT         Cost: LIMIT required by policy (warning only)
V_COST_EXCEEDED         Cost: more joins than policy.maxJoins
```

Pipeline halts after syntax rule failure (downstream rules need the
AST). Safety/schema/cost all run and accumulate — clients see every
problem, not just the first.

---

## 10. API error taxonomy (stable E_* codes)

```
400 E_CONTRACT               malformed request body
400 E_MISSING_BRAND_ID       x-brand-id header absent
401 E_GATEWAY_AUTH           missing/bad/expired HMAC signature
403 E_TENANT_SUSPENDED       tenant-router tenant_suspended
404 E_TENANT_NOT_FOUND       tenant-router tenant_not_found
413 E_ROW_LIMIT              query exceeded max rows
422 E_VALIDATION             SQL failed validation; details.issues[]
502 E_TENANT_ROUTER          tenant-router non-2xx
502 E_TENANT_INVALID_PAYLOAD tenant-router returned malformed data
503 E_TENANT_UNAVAILABLE     tenant-router unreachable / routing_unavailable
504 E_QUERY_TIMEOUT          MySQL query timeout
500 E_INTERNAL               unhandled
```

All errors emit as JSON with shape
`{ ok: false, correlationId, error: { code, message, details? } }`.

---

## 11. Execution layer guarantees

Enforced at the session level in `modules/execution/executor.js` on
every connection:

- `SET SESSION TRANSACTION READ ONLY` — blocks any write at DB level
  regardless of the SQL that got through validation.
- `SET SESSION MAX_EXECUTION_TIME=<timeoutMs>` — MySQL-enforced
  timeout.
- Row limit truncation server-side with `stats.truncated: true` flag.
- Per-tenant connection pool keyed by
  `brandId:host:port:database` (see `poolManager.js`). Pools are created
  lazily on first request, reused across requests, closed on SIGTERM.
- Credentials are never logged (pino redacts `credentials`, `password`,
  `authorization`, `apiKey`).

---

## 12. Gateway trust model (security-critical)

`middleware/tenantContext.middleware.js`:

1. Reads `x-brand-id` only from the header — **never** from the body.
2. Verifies the HMAC signature using `timingSafeEqual` (constant-time).
3. Rejects signatures older than 5 minutes.
4. If `GATEWAY_SHARED_SECRET` is unset and `GATEWAY_TRUST_BYPASS=true`,
   trusts `x-brand-id` verbatim (DEV ONLY — logs a loud warning).
5. If `GATEWAY_SHARED_SECRET` is unset and bypass is not enabled,
   throws `GatewayAuthError` on every request.

---

## 13. Schema provider (Phase 2A)

### Source

`schema/schema.sql` — checked-in `mysqldump` output for one tenant
database. 51 tables, 0 foreign keys, composite primary keys (some
with prefix-length specifiers like `landing_page_path(200)`), generated
columns, MySQL-specific type modifiers (`int unsigned`, `tinyint
unsigned`, etc.).

The same dump is used for every tenant. There's no per-tenant schema
variation today — that comes with the semantic layer in a later phase.

### Parser

`modules/schema/schemaParser.js` is a paren-aware MySQL-dump parser.
It is NOT a general SQL parser. Strategy:

1. Strip MySQL conditional comments (`/*! ... */`) and `--` line
   comments.
2. Locate every `CREATE TABLE \`name\` (...)` block by walking the
   text and tracking paren depth (string-aware).
3. Split each block body into top-level entries by comma at depth 0
   (so column definitions with embedded parens like `decimal(5,2)`
   stay intact).
4. Classify each entry: column / PRIMARY KEY / FOREIGN KEY /
   `CONSTRAINT ... FOREIGN KEY`. KEY / UNIQUE KEY / FULLTEXT / INDEX /
   CHECK constraints are ignored.
5. For columns: extract name, lower-cased type with any
   `unsigned/signed/zerofill` modifier preserved, nullability,
   default value (literal text), and inline `PRIMARY KEY` flag.

### Cache

`modules/schema/schemaCache.js` — a thin Map-backed cache with
`get/set/has/delete/clear/size`. One key today: `schema_dump:v1`.
Cleared per-process; not persisted.

### Provider

`modules/schema/schemaProvider.js` — `getSchemaContext({ tenant?,
correlationId?, schemaPath? })`:

- On cache miss: reads the dump from disk, parses, caches the parsed
  intermediate, and logs `schema.load` once with `tableCount` +
  `joinCount`.
- Always returns a fresh `SchemaContext` envelope (cheap), but reuses
  the cached `tables` reference so the heavy work happens once.
- `database` is set from `tenant?.database ?? null` for observability
  only — it does NOT change which schema is loaded.
- Validates output via `assertSchemaContext` before returning.

### load_schema node

`orchestrator/nodes/schema.node.js` runs FIRST in the graph. Requires
`state.tenant`. Calls `getSchemaContext`. Attaches `schemaContext` to
state. No LLM, no tenant-router, no SQL execution. If anything throws,
the graph terminates before any downstream work.

---

## 14. Tests

Run: `npm test`. Lint: `npm run lint` (tsc with `checkJs`).

| Suite                                           | Count | Focus                                              |
|-------------------------------------------------|-------|----------------------------------------------------|
| `tests/validation/validator.test.js`            | 11    | All four rules; valid + invalid cases (canonical SchemaContext shape) |
| `tests/execution/executor.test.js`              | 5     | ExecutionInput contract validation                 |
| `tests/orchestrator/graph.test.js`              | 8     | initialState, each node, missing-schema rejection, compiled-graph adjacency (now includes `correct` node + validation conditional edges) |
| `tests/orchestrator/nodes/plan.node.test.js`    | 14    | Mock-mode determinism, mock has Phase 2B shape, LLM-mode parsing, forbidden-key stripping, schema digest in prompt, ContractError on bad output, clarification flow for `cancellation_rate`, ready when formula in `globalContext`, chat-confirmed formula supersedes global, `planRouter` routes correctly |
| `tests/orchestrator/nodes/sql.node.test.js`     | 15    | Mock-mode determinism (no LLM call), LLM-mode parsing, trailing-semicolon stripped, prompt carries question + plan + schema digest + metricDefinitions + assumptions, missing inputs rejected, needs_clarification refused at SQL node, empty SQL / wrong dialect / missing fields rejected, transport errors wrapped, factory injection honoured |
| `tests/orchestrator/nodes/correction.node.test.js` | 25 | Mock-mode unchanged-SQL determinism + history accumulation + no-credential guarantee, LLM-mode parsing + prompt contents (question, plan, failed SQL, V_* codes, schema digest), trailing-semicolon stripped, empty SQL / wrong dialect / transport-error rejection, **8 pre-condition guards** (missing fields, valid validation, empty issues, needs_clarification plan), **`validationRouter` routing matrix** (valid → execute, invalid + attempts < max → correct, invalid + exhausted → END, missing attempts → 0) |
| `tests/contracts/queryPlan.test.js`             | 7     | Phase 2B widened shape, normalization defaults, `needs_clarification` w/ empty `targetTables`, cross-rule rejections, bad source enum, empty clarification |
| `tests/planner/plannerContext.test.js`          | 6     | Schema digest format, global+chat metric merge precedence, synonyms folding, recent-questions cap, no-credentials guarantee, missing-question error |
| `tests/sql/sqlContext.test.js`                  | 11    | Question / plan / dialect passthrough, `metricDefinitions` + `assumptions` carried, scoped to `targetTables` only — unrelated tables never leak, projected tables carry types + PK, defensive fallback to all tables on empty target list, no credentials / tenant routing / raw dump in serialized output, missing-input errors, `buildSqlSchemaDigest` table scoping |
| `tests/correction/correctionContext.test.js`    | 6     | Question + plan + failed SQL + dialect passthrough, V_* issue codes preserved, `metricDefinitions`/`assumptions` carried, scoped to `targetTables` — unrelated tables never leak, attempt + maxAttempts metadata, no credentials / tenant routing / raw dump, missing-input errors |
| `tests/orchestrator/nodes/context.node.test.js` | 5     | Phase 2D — attaches all three contexts, missing-input guards, planner consumes the new patch shape, **graph wiring** verifies `load_schema → load_context → planner` and `load_schema` does NOT skip `load_context` |
| `tests/context/contextLoader.test.js`           | 11    | Phase 2D hybrid retrieval — empty grounding when nothing seeded, vector → catalog round-trip builds `globalContext.metrics`, chat memory surfaces in `chatContext`, **vector failures non-fatal** (graceful), missing-input errors, **memoryExtractor only persists chat-confirmed metric definitions**, never stores SQL |
| `tests/chatMemory/chatMemoryProvider.test.js`   | 7     | Phase 2D — normalize/merge helpers (capping, delta-precedence), in-memory get/update, **TTL respected**, **tenant-scoped keys**, env fallback discriminator |
| `tests/semantic/semanticProvider.test.js`       | 6     | Phase 2D — tenant-scoped `getMetricsByIds` (never returns other brand), synonym lookup (case-insensitive), `metricsToGlobalContext` projection, env fallback |
| `tests/vector/vectorClient.test.js`             | 6     | Phase 2D — deterministic embeddings stable + unit-normalised, in-memory cosine ranking, **tenant-scoped vector filter**, empty-input guards, env fallback |
| `tests/controllers/insight.controller.test.js`  | 6     | Clarification envelope; execution envelope still works for `ready`; works without log; `E_VALIDATION` envelope after correction exhausted (with `correctionAttempts` + `correctionHistory` in details); `httpStatusForState` returns 422 / 200 correctly |
| `tests/middleware/tenantContext.test.js`        | 4     | Missing/bad/expired signature; body-brandId ignored|
| `tests/schema/schemaProvider.test.js`           | 12    | Parser real-dump coverage, cache reuse, credential leak guard, assertSchemaContext invariants |

Current status: **169/169 passing, 0 lint errors.**

> **Hermetic test runner**: `npm test` now sets
> `PLANNER_MODE=mock SQL_MODE=mock CORRECTION_MODE=mock` via `env`
> prefix on each spawned `node --test` so tests don't pick up
> developer `.env` overrides (which often have `=llm` set for live
> dev runs).

> **Test runner note**: `npm test` uses
> `find tests -name '*.test.js' -print0 | xargs -0 node --test` rather
> than a shell glob, so subdirectory test files (e.g.
> `tests/orchestrator/nodes/`) are discovered correctly under
> non-globstar shells.

Tests do NOT exercise live MySQL or tenant-router. They cover the
contract surface only. Integration testing requires a fixture DB and
mock tenant-router — not yet wired up.

---

## 15. Environment variables

Defined in `.env.example`. Runtime validation in `config/env.js`.

| Var | Required | Purpose |
|-----|----------|---------|
| `TENANT_ROUTER_URL` | yes | e.g., `http://tenant-router:3004` |
| `TENANT_ROUTER_TIMEOUT_MS` | default 3000 | |
| `X_PIPELINE_KEY` | optional | internal-bypass header for tenant-router calls |
| `GATEWAY_SHARED_SECRET` | for prod | HMAC key shared with api-gateway |
| `GATEWAY_TRUST_BYPASS` | dev only | skip signature check when secret unset |
| `EXEC_QUERY_TIMEOUT_MS` | default 15000 | |
| `EXEC_MAX_ROWS` | default 10000 | |
| `POOL_CONNECTION_LIMIT` | default 10 | per-tenant pool size |
| `POOL_IDLE_TIMEOUT_MS` | default 600000 | |
| `OPENAI_API_KEY` | when any `*_MODE=llm` | OpenAI key for any LLM-backed node. Not required in mock mode. |
| `LLM_MODEL` | default `gpt-4o-mini` | Model used by `lib/llm.js` for all roles (`planner`, `sql`, `correction`). Per-role overrides live in `config/models.js`. |
| `PLANNER_MODE` | default `mock` | `mock` (deterministic) or `llm` (real LLM call). Anything else = `mock` (fail-safe). |
| `SQL_MODE` | default `mock` | `mock` (deterministic SELECT against `gross_summary`) or `llm` (real SQL generator). Anything else = `mock` (fail-safe). |
| `CORRECTION_MODE` | default `mock` | `mock` (return failing SQL unchanged — loop exits at cap) or `llm` (real correction). Anything else = `mock` (fail-safe). |
| `MAX_CORRECTION_ATTEMPTS` | default `2` | Cap on correction retries before `E_VALIDATION` is returned. Set to `0` to disable correction (single-shot validate). Must be ≥ 0. |
| `REDIS_URL` | optional (Phase 2D) | When set, chat memory uses real Redis. Unset → in-memory provider. |
| `CHAT_MEMORY_TTL_SECONDS` | default `86400` | Chat memory TTL. Same setting honoured by both Redis and in-memory paths. |
| `MONGO_URI` | optional (Phase 2D) | When set, semantic catalog uses real Mongo. Unset → in-memory empty catalog. |
| `MONGO_DB` | default `sql_agent` | Mongo database name when `MONGO_URI` is set. |
| `MONGO_METRICS_COLLECTION` | default `metrics` | Collection name for `SemanticMetric` documents. |
| `QDRANT_URL` | optional (Phase 2D) | When set, vector store uses Qdrant via REST. Unset → in-memory cosine fallback. |
| `QDRANT_API_KEY` | optional | Sent as `api-key` header when present. |
| `QDRANT_COLLECTION` | default `semantic_metrics` | Qdrant collection name. |
| `EMBEDDING_MODEL` | default `text-embedding-3-small` | Model used when an OpenAI key is set. Otherwise the deterministic SHA-256 mock is used. |
| `EMBEDDING_DIMENSIONS` | default `1536` | Vector dimension for the embedding service (mock + real). |
| `VECTOR_TOP_K` | default `5` | How many vector candidates to fetch before the catalog round-trip. |
| `PORT` | default 4000 | |
| `LOG_LEVEL` | default info | |

---

## 16. Deployment artefacts

- **Dockerfile** — non-root Alpine runtime, `/health` healthcheck,
  port 4000.
- **.dockerignore** — excludes tests, node_modules, .env.
- **docs/GATEWAY_INTEGRATION.md** — nginx + docker-compose patches for
  wiring sql-agent behind the shared api-gateway.

sql-agent's port is NOT exposed to the host — the gateway is the only
public entry point.

---

## 17. What a continuing agent should NOT redo

- JSDoc vs TypeScript — this project is JS-only by explicit directive.
- Validation rule scope — Phase 1 validation is complete and
  deterministic. Do not add LLM-driven validation rules.
- Contract shapes — treat them as stable. Widening them is fine; don't
  rename or narrow.
- Tenant-router integration — the client is aligned to the real
  service's contract. Don't re-abstract behind another layer.
- Gateway-trust model — the HMAC pattern is the one used by
  `dashboard/api-gateway/gateway/lua/auth.lua`. Do not replace with a
  different scheme.
- Rate limiting — handled at the gateway, not in this service.
- **Schema provider plumbing** — the `SchemaContext` shape, the
  `load_schema` node, and the cache key are stable. To swap the source
  (dump → information_schema → semantic layer), only the inside of
  `schemaProvider.js` needs to change.
- **Node ordering** — `load_schema` must always run first. Do not
  reintroduce a hard-coded schema in `validate.node.js`.
- **Planner two-mode design** — mock and llm modes both produce the
  same `QueryPlan`. Do not collapse them into a single mode; the mock
  fallback is the test/CI/no-key path and must keep working without a
  network call. The `createPlanNode({ mode, llm })` factory is the
  testing entry point — do not introduce module-level mutable globals
  for LLM injection.
- **LLM JSON-mode plumbing** — `lib/llm.js` enforces OpenAI's
  `response_format: { type: 'json_object' }` and parses on the way
  out. Do not remove that — it's what makes non-JSON output a
  recoverable contract violation rather than a silent string parse
  on the caller side.
- **Planner contract** — `QueryPlan` shape is stable. Do not add
  fields without updating both the JSDoc typedef and
  `assertQueryPlan`. The planner must NOT emit `sql` / `query` keys
  (the prompt forbids it; `plan.node.js` strips them as defence in
  depth).
- **QueryPlan normalization + cross-validation** — `assertQueryPlan`
  intentionally normalizes missing newer fields and cross-checks
  ready/clarification rules. Don't move that logic into callers;
  keep one place that defines what a valid plan looks like.
- **Clarification short-circuit** — the conditional edge after the
  planner is the single canonical place that stops the graph for
  `needs_clarification`. Do not add bypasses inside `generate_sql`,
  `validate`, or `execute` that try to "do the right thing"
  themselves — those nodes assume a `ready` plan and may be removed
  from the graph on this branch entirely.
- **`buildResponseFromState` shape** — the `clarification_required`
  envelope is part of the public API contract. Frontends key off
  `result.type === "clarification_required"`. Don't rename or change
  its shape; only widen.
- **`globalContext` / `chatContext` are placeholders** — the
  state-channel slots and `assertAgentState` validation are in place,
  but no persistence layer populates them yet. Do not couple the
  planner to a specific catalog/store; keep the contract on the
  shape, not the source.
- **Planner does not invent formulas** — when a metric is ambiguous
  and no formula is provided, the planner MUST return
  `needs_clarification`. Do not add a "default formula" fallback in
  the prompt or the node code.
- **SQL node does not own SQL safety** — `sql.node.js`'s
  `sanitizeSql` only does whitespace trim + ≤ 1 trailing-semicolon
  strip. Do NOT add regex-based DDL/DML detection, schema-fidelity
  checks, or cross-database guards there. The deterministic
  validation pipeline (`modules/validation/`) is the only SQL safety
  gate. Re-implementing safety in the SQL node creates two sources
  of truth that drift.
- **SQL node does not re-plan** — the prompt and node code both
  assume `plan` is authoritative. The generator implements the
  planner's `metricDefinitions` literally, even when the formula
  could be expressed equivalently another way. Do not add "smart"
  plan rewriting or formula normalization in the SQL node.
- **SQL node clarification guard** — `sql.node.js` rejects
  `plan.status === "needs_clarification"` even though the graph's
  conditional edge should already prevent it. Keep that guard;
  defence-in-depth here is cheap and catches future routing bugs.
- **`buildSqlContext` scopes to `targetTables`** — sending the full
  schema to the SQL generator on every request wastes tokens and
  invites the LLM to wander into unrelated tables. Keep the digest
  scoped to the plan's chosen tables.
- **`validate.node.js` does not throw on invalid SQL** — Phase 2C
  changed the contract. Failure is a state transition that the
  `validationRouter` consumes. Reintroducing a `throw` here would
  bypass the correction loop and make the tests fail. Pre-condition
  errors (missing `sqlDraft` / `schemaContext`) DO still throw —
  those are programmer errors.
- **Correction node NEVER executes SQL** — the only thing it
  produces is a replacement `SqlDraft`. Validation MUST run after
  every correction. The graph edge `correct → validate` enforces
  this; do not add a path that skips validate.
- **Bounded correction loop** — `env.correction.maxAttempts` is
  the single source of truth. Don't bypass it from inside the
  correction node. The `validationRouter` is the gatekeeper that
  routes to `END` when attempts exhaust.
- **`correctionHistory` is append-only** — the correction node
  reads previous history off state and writes
  `[...prev, newEntry]`. Tests rely on prior entries being
  preserved across attempts. Don't change it to last-write-only.
- **No credentials / routing in `correctionHistory`** — the entry
  shape is `{attempt, issues, previousSql, correctedSql, mode}`.
  Tests verify nothing else leaks. Don't widen with sensitive
  fields.
- **`E_VALIDATION` is the only error code after exhausted
  correction** — the controller's
  validation-failure-after-exhaustion branch deliberately reuses the
  existing code so frontend behaviour for "SQL failed validation"
  is unchanged whether correction was tried or not. Don't introduce
  a new code like `E_CORRECTION_EXHAUSTED`.
- **Vector → catalog round-trip is mandatory (Phase 2D)** — the
  vector store returns `metricId` candidates only. NEVER feed
  vector hits into `globalContext.metrics`, `requiredMetrics`, or
  the SQL prompt directly. Always look the candidate up in the
  semantic catalog first — that's the truth. Adding a code path
  that uses vector payloads as authoritative breaks the priority
  ordering the planner depends on.
- **Provider fallbacks must remain pluggable** — every external
  service (Redis, Mongo, Qdrant, embeddings) MUST keep its
  in-memory fallback. Removing a fallback would make tests require
  the corresponding service to be running, breaking CI. The
  `mock: boolean` discriminator on each provider is the
  test-injection seam.
- **Lazy-import optional packages** — `redis`, `mongodb`, and
  `@langchain/openai` are imported with a variable specifier so TS
  doesn't try to resolve them at compile time. Don't replace those
  with static `import` statements; the packages are intentionally
  optional.
- **Tenant scoping in providers is by composite key** — the
  in-memory variants use `${tenantId}:${id}` keys (semantic catalog
  + vector store) and the chat memory key is
  `sql-agent:chat:${brandId}:${userId}:${conversationId}`. This is
  belt-and-braces with the per-call `tenantId` parameter; do not
  rely on the parameter alone.
- **Memory write is fire-and-forget** — the controller calls
  `writeMemoryDelta(finalState).catch(() => {})`. Make it block /
  await the response and a Redis hiccup will start failing user
  requests. Keep it post-response.
- **`memoryExtractor` is a strict allow-list** — only the listed
  fields are persisted (question, metric refs, filter refs,
  chat-confirmed metric definitions, structural result summary).
  Don't add SQL, raw rationale, or planner assumptions; the test
  suite verifies these specifically.
- **`load_context` runs between `load_schema` and `planner` —
  always.** Reordering or skipping it means the planner runs without
  any grounding from chat memory or the semantic catalog,
  regressing Phase 2D entirely.

---

## 18. Suggested Phase 2 entry points

In priority order. Each is a focused change; none should cascade into
other modules if contracts are respected.

### ~~A. Replace the planner node with an LLM call~~ — DONE (Phase 2B-A)
- File: `apps/api/src/orchestrator/nodes/plan.node.js`.
- Prompt: `prompts/planner.prompt.md`.
- LLM client: `lib/llm.js` (`getLlm('planner').invokeJson(messages)`).
- Output contract: `QueryPlan` — asserted via `assertQueryPlan()`.
- Mock fallback retained behind `PLANNER_MODE` for tests + CI.
- Factory `createPlanNode({ mode, llm })` for test injection.

### ~~B. Context-aware planner with clarification handling~~ — DONE (Phase 2B)
- `QueryPlan` widened: `status`, `clarificationQuestion`,
  `assumptions`, `metricDefinitions`. Cross-validated.
- `AgentState` widened with optional `globalContext` and
  `chatContext` (placeholders; no persistence yet).
- New module: `modules/planner/plannerContext.js` — pure builder
  that merges global + chat metric definitions (chat wins),
  produces compact prompt payload, never leaks credentials.
- Conditional graph edge after planner via exported
  `planRouter(state)`. `needs_clarification` → END.
- Controller emits `clarification_required` envelope via exported
  `buildResponseFromState`.

### ~~A. Replace the SQL generator node with an LLM call~~ — DONE (Phase 2B-B)
- File: `apps/api/src/orchestrator/nodes/sql.node.js`.
- Prompt: `prompts/sql.prompt.md` (active, rewritten for plan
  fidelity + metric-definition-literal rule).
- LLM client: `lib/llm.js` (`getLlm('sql').invokeJson(messages)`).
- Output contract: `SqlDraft` — asserted via `assertSqlDraft()`.
- Mock fallback retained behind `SQL_MODE` for tests + CI.
- Factory `createSqlNode({ mode, llm })` for test injection.
- Compact prompt context built by `modules/sql/sqlContext.js`.
- Defensive guards reject missing inputs and `needs_clarification`
  plans.
- Validation layer remains the sole SQL safety gate — the SQL node
  intentionally does not regex-check DDL/DML.

### ~~A. Add the correction loop~~ — DONE (Phase 2C)
- Prompt: `prompts/correction.prompt.md` (active; per-V_*-code
  fix-by-code table).
- Node: `apps/api/src/orchestrator/nodes/correction.node.js`.
- Context builder: `apps/api/src/modules/correction/correctionContext.js`.
- Conditional edge: `validationRouter` in `graph.js`
  (valid → execute, invalid + attempts < max → correct, exhausted
  → END). Both `planRouter` and `validationRouter` exported for
  direct testing.
- Cap: `env.correction.maxAttempts` (`MAX_CORRECTION_ATTEMPTS`
  env var, default 2; floor 0 disables correction entirely).
- LLM client: `getLlm('correction').invokeJson(messages)` (role
  already configured in `config/models.js`).
- Mock mode returns failing SQL unchanged so the loop exits at
  the cap without fabricating fixes (CI-safe).
- `validate.node.js` no longer throws on invalid SQL; controller
  emits `E_VALIDATION` envelope with `correctionAttempts` +
  `correctionHistory` in `error.details` after exhaustion.

### ~~A. Introduce a semantic layer + populate global/chat context~~ — DONE (Phase 2D)
- New `load_context` node between `load_schema` and `planner`.
- Three pluggable providers (Redis / Mongo / Qdrant) with in-memory
  fallbacks; system runs without any of them.
- Hybrid retrieval: chat memory → vector candidates → semantic
  catalog round-trip → `globalContext.metrics`.
- Memory write after successful execution via
  `extractMemoryFromPlan` (strict allow-list — never SQL).
- All factory-injectable for tests.

### A. Add result explanation (Phase 2E) — NEXT
- New node after `execute`. Takes `ExecutionResult` + original
  `QueryRequest`, produces a natural-language summary.
- Keep it optional and behind a feature flag — not every caller wants
  it.
- Mirror the `createXxxNode({ mode, llm })` pattern (mock = no-op
  passthrough; llm = LLM summary). Reuse `lib/llm.js` with role
  `'explanation'` (add to `config/models.js`).
- Output a new optional `state.explanation` field plus a controller
  branch that surfaces it in the success envelope.

### B. Vector ingestion pipeline (Phase 2F)
- Today's vector store is read-only inside the request path. There
  is no batch job that takes the Mongo semantic catalog and embeds
  + upserts metric records into Qdrant. Build a small CLI / cron
  utility that reads the catalog, calls `embedText` over
  `metricId + description + synonyms`, and upserts via
  `vectorClient.upsertPoints`. Idempotent. Tenant-scoped.

### C. Caching beyond the schema cache (Phase 2G)
- The schema dump cache exists. Semantic catalog hits and vector
  candidates currently re-fetch on every request. A short-TTL cache
  keyed on `(brandId, question)` would cut Mongo + Qdrant load on
  repeated queries within a session. Must respect chat memory
  updates — either include a memory fingerprint in the key or use a
  tight TTL (e.g. 60s).

---

## 19. Reference files (read first)

1. `agent-context/system-context.md` — system-level rules.
2. `README.md` — architecture + run instructions.
3. `apps/api/src/modules/contracts/*.js` — stable data shapes.
4. `apps/api/src/modules/schema/schema.types.js` — canonical
   SchemaContext + assertSchemaContext.
5. `apps/api/src/modules/schema/schemaProvider.js` — entry point for
   getting a SchemaContext.
6. `apps/api/src/orchestrator/graph.js` — wiring; the "map" of the
   system.
7. `apps/api/src/orchestrator/nodes/plan.node.js` — planner with
   mock+llm modes AND clarification handling; reference for the
   `createXxxNode({ mode, llm })` pattern.
8. `apps/api/src/orchestrator/nodes/sql.node.js` — SQL generator with
   mock+llm modes; one of the references for the
   `createXxxNode({ mode, llm })` pattern.
9. `apps/api/src/orchestrator/nodes/correction.node.js` — Phase 2C
   correction node; same factory pattern, plus `correctionAttempts` /
   `correctionHistory` accumulation and pre-condition guards.
10. `apps/api/src/modules/planner/plannerContext.js` — pure-function
    prompt-context builder for the planner.
11. `apps/api/src/modules/sql/sqlContext.js` — pure-function
    prompt-context builder for the SQL generator (scopes digest to
    `plan.targetTables`).
12. `apps/api/src/modules/correction/correctionContext.js` — pure
    builder that mirrors `sqlContext.js` and adds the failing-SQL +
    `V_*` issues + attempt metadata.
13. `apps/api/src/orchestrator/nodes/context.node.js` — Phase 2D
    `load_context` node; reference for nodes that wrap async
    provider chains.
14. `apps/api/src/modules/context/contextLoader.js` — hybrid
    retrieval orchestrator. Pure-DI surface
    (`createContextLoader({chatMemory, semantic, vector})`) is the
    test-injection seam.
15. `apps/api/src/modules/chatMemory/chatMemoryProvider.js` —
    Redis-or-in-memory provider with TTL. Includes
    `normalizeChatContext` and `mergeChatContext` helpers used by
    both the loader and the memory writer.
16. `apps/api/src/modules/chatMemory/memoryExtractor.js` — pure
    `extractMemoryFromPlan`. Strict allow-list — never returns SQL
    or LLM prose.
17. `apps/api/src/modules/semantic/semanticProvider.js` —
    Mongo-or-in-memory catalog. `metricsToGlobalContext` is the
    pure projection used by the loader.
18. `apps/api/src/modules/vector/vectorClient.js` —
    Qdrant-via-undici-or-in-memory vector store; tenant-scoped
    cosine search.
19. `apps/api/src/modules/vector/embeddingService.js` —
    OpenAI-or-deterministic embedding service.
20. `apps/api/src/modules/contracts/queryPlan.js` — Phase 2B widened
    contract with normalization + cross-validation. Read this before
    touching the planner output shape.
21. `apps/api/src/modules/contracts/sqlDraft.js` — SQL output
    contract; the SQL and correction nodes validate against this.
22. `apps/api/src/lib/llm.js` — shared LLM facade
    (`getLlm(role).invokeJson(messages)`).
23. `apps/api/src/orchestrator/graph.js` — `planRouter` and
    `validationRouter` conditional edges; pattern to extend for
    further conditional flows.
24. `apps/api/src/controllers/insight.controller.js` —
    `buildResponseFromState` (clarification + execution +
    validation-failure envelopes), `httpStatusForState`, and the
    fire-and-forget `writeMemoryDelta` Phase 2D hook.
25. `apps/api/src/modules/validation/validator.js` — the deterministic
    safety layer you must not bypass.
26. `apps/api/src/modules/validation/rules/schema.rule.js` — how the
    SchemaContext is consumed by the validator.
27. `schema/schema.sql` — the authoritative tenant schema.
28. `docs/GATEWAY_INTEGRATION.md` — deployment context.
29. `prompts/planner.prompt.md` — active. The prompt for the LLM-backed
    planner with clarification rules.
30. `prompts/sql.prompt.md` — active. The prompt for the LLM-backed
    SQL generator with plan-fidelity / metric-literal rules.
31. `prompts/correction.prompt.md` — active. The prompt for the
    Phase 2C correction node, with the per-V_*-code fix-by-code
    table.

---

## 20. One-page mental model

> Every request enters via `POST /insights/query` behind an HMAC-signed
> gateway. The middleware verifies the signature, resolves the brand's
> tenant via tenant-router, and attaches a normalized execution context
> to `req`. A LangGraph workflow runs
> `load_schema → planner → (conditional) → generate_sql → validate → execute`.
> `load_schema` parses the checked-in MySQL dump
> (`schema/schema.sql`) once per process and attaches the resulting
> `SchemaContext` to state. The planner runs in `mock` or `llm` mode
> (controlled by `PLANNER_MODE`); both modes produce the same widened
> `QueryPlan` shape (`status`, `clarificationQuestion`, `assumptions`,
> `metricDefinitions`). LLM mode reads optional `globalContext` (brand
> metric catalog) and `chatContext` (per-conversation confirmations)
> off state, builds a compact prompt context via
> `buildPlannerContext`, invokes OpenAI in JSON mode via `lib/llm.js`
> with the `prompts/planner.prompt.md` system prompt, and validates
> against `assertQueryPlan`. When the planner can't disambiguate a
> business metric (e.g., "cancellation rate" with no formula
> provided), it returns `status: "needs_clarification"` and a
> conditional edge (`planRouter`) routes the graph straight to `END`.
> The controller renders a `clarification_required` envelope via
> `buildResponseFromState` — SQL generation, validation, and
> execution never run on that branch. The SQL generator (Phase 2B-B)
> mirrors the planner: two modes (`mock` / `llm`) controlled by
> `SQL_MODE`, factory `createSqlNode({ mode, llm })` for tests, prompt
> context built by `buildSqlContext` and scoped to `plan.targetTables`
> so token usage stays bounded. The LLM is told to **implement the
> planner's `metricDefinitions` literally** — no algebraic
> substitution — and the node runtime strips one trailing semicolon
> and validates against `assertSqlDraft`. Empty SQL, missing fields,
> or a non-`mysql` dialect raises `ContractError`. The SQL node does
> NOT regex-check safety — that responsibility belongs to the
> deterministic validation layer (the only SQL safety gate in the
> graph). Validate is parser-based and LLM-free, enforcing four
> rules (syntax, safety, schema, cost) using the SchemaContext from
> state. Validate no longer throws on failure (Phase 2C): a
> `validationRouter` conditional edge sends valid drafts to
> `execute`, invalid drafts to the correction node while attempts
> remain, and exhausted attempts to `END`. The correction node
> mirrors the planner/SQL pattern (factory, mock/llm modes, prompt
> context builder, JSON-mode LLM call), receives the failing SQL plus
> the structured `V_*` issues, and emits a replacement `SqlDraft`.
> The loop is bounded by `MAX_CORRECTION_ATTEMPTS` (env, default 2;
> 0 disables). Mock correction returns the failing SQL unchanged so
> the loop exits at the cap rather than fabricating fixes. After
> exhaustion the controller emits the existing `E_VALIDATION` error
> envelope (HTTP 422) with `correctionAttempts` and
> `correctionHistory` in `error.details`. Phase 2D inserts a
> `load_context` node between `load_schema` and `planner`. It hits
> three pluggable providers — Redis for chat memory, MongoDB for
> the semantic catalog of metric formulas, and Qdrant for vector
> candidates over an embedding service. Each provider has an
> in-memory fallback that kicks in when its env URL is unset, so
> the system runs (with reduced grounding intelligence) without any
> external service. The retrieval pipeline is `chat memory →
> vector candidates → catalog round-trip → globalContext`; vector
> hits are NEVER fed directly to SQL — they're always rounded
> through the catalog (the truth) before reaching the planner.
> After successful execution the controller writes a chat-memory
> delta via `extractMemoryFromPlan` (question + metric refs +
> filter refs + chat-confirmed metric definitions only — never SQL
> or LLM prose). The write is fire-and-forget; Redis hiccups never
> affect the response. Execution is tenant-isolated via per-brand
> mysql2 pools with server-level READ ONLY and timeout enforcement.
> Credentials never appear in logs, in `correctionHistory`, or in
> `chatContext`. All module-boundary data is validated at runtime
> against JSDoc-typed contracts. The remaining Phase 2 work is an
> optional result-explanation node after `execute` (Phase 2E), a
> vector-ingestion CLI to populate Qdrant from the Mongo catalog
> (Phase 2F), and a short-TTL retrieval cache (Phase 2G) — none of
> which require touching validation, execution, the gateway
> middleware, the correction loop, the context loader, or the
> existing contracts.
