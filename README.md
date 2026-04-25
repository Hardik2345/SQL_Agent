# SQL Agent

A multi-tenant SQL agent for a SaaS analytics platform. It converts
natural-language analytics questions into **validated** MySQL `SELECT`
statements and executes them against a tenant-scoped database.

This is a **controlled** analytics system — not a free-form autonomous
agent. Validation is never skipped. The LLM never sees credentials.

Current implementation includes tenant resolution, schema loading,
planning, SQL generation, validation, and tenant-scoped execution. Planner
and SQL generation can run in deterministic mock mode or LLM mode. The
correction loop, insight explanation, and result summarization are not wired
yet.

---

## Architecture

```
┌───────────────┐       ┌──────────────────────┐
│   Client      │──1──▶ │  POST /insights/query │
└───────────────┘       └──────────┬────────────┘
                                   │
                         (tenantContextMiddleware)
                                   │
                                   ▼
                   ┌──────────────────────────┐
                   │   tenant-router (remote) │
                   │   POST /tenant/resolve   │
                   └──────────┬───────────────┘
                              │ normalized context
                              ▼
           ┌─────────────────────────────────────────┐
           │        LangGraph Orchestrator           │
           │ START → load_schema → planner           │
           │       → generate_sql → validate         │
           │       → execute → END                   │
           └─────────────────┬───────────────────────┘
                             │ validated SQL
                             ▼
                    ┌──────────────────┐
                    │ mysql2 tenant pool│
                    └──────────────────┘
```

- **tenant-router** is the authoritative control-plane for brand ⇒ tenant
  routing. This service resolves each request before orchestration.
- `load_schema` reads the checked-in `schema/schema.sql` dump, parses it
  into a `SchemaContext`, and caches the parsed schema in-process.
- `planner` can stop early with `needs_clarification`; in that case SQL
  generation, validation, and execution are skipped.
- `generate_sql` produces a `SqlDraft`; validation is deterministic and
  must pass before execution.
- Connection pooling is owned entirely by this service, keyed by
  `brandId:host:port:database`.

## Project layout

```
sql-agent/
├── apps/api/src/
│   ├── controllers/       # HTTP controllers
│   ├── routes/            # Express routes
│   ├── middleware/        # Request-scoped middleware (tenant resolution)
│   ├── orchestrator/      # LangGraph workflow + nodes
│   │   ├── graph.js
│   │   ├── state.js
│   │   └── nodes/
│   ├── modules/
│   │   ├── planner/       # Planner prompt context builders
│   │   ├── sql/           # SQL generation context builders
│   │   ├── schema/        # Schema dump parser, provider, cache
│   │   ├── validation/    # SQL validation pipeline
│   │   ├── execution/     # mysql2 pool + executor
│   │   ├── tenant/        # tenant-router client
│   │   └── contracts/     # Shared JSDoc contracts + runtime validators
│   ├── lib/               # LLM facade, SQL parser, runtime validator core
│   ├── config/            # env + model registry
│   ├── utils/             # logger, errors, constants, helpers
│   ├── app.js
│   └── server.js
├── shared/                # Cross-package typedefs
├── prompts/               # Prompt templates (wired in Phase 2)
├── schema/                # Reference tenant schema
├── tests/
└── agent-context/         # System rules consumed by the agent
```

This project is JavaScript-only ESM with JSDoc type checking. Do not add
TypeScript source files or a `tsconfig`.

## Contracts

All inter-module boundaries are validated at runtime via
`apps/api/src/lib/runtimeValidators.js`.

Contracts:

| Contract              | File                                                                   |
|-----------------------|------------------------------------------------------------------------|
| `QueryRequest`        | `apps/api/src/modules/contracts/queryRequest.js`                       |
| `QueryPlan`           | `apps/api/src/modules/contracts/queryPlan.js`                          |
| `SqlDraft`            | `apps/api/src/modules/contracts/sqlDraft.js`                           |
| `SchemaContext`       | `apps/api/src/modules/schema/schema.types.js`                          |
| `ValidationResult`    | `apps/api/src/modules/contracts/validationResult.js`                   |
| `ExecutionResult`     | `apps/api/src/modules/contracts/executionResult.js`                    |
| `AgentState`          | `apps/api/src/modules/contracts/agentState.js`                         |
| `TenantExecutionContext` | `apps/api/src/modules/tenant/tenant.types.js`                       |

## Orchestrator Flow

The compiled graph is:

```text
START
  → load_schema
  → planner
  → END          when plan.status === "needs_clarification"
  → generate_sql when plan.status === "ready"
  → validate
  → execute
  → END
```

Node responsibilities:

- `load_schema` attaches a schema context from `schema/schema.sql`.
- `planner` returns a validated `QueryPlan` in `mock` or `llm` mode.
- `generate_sql` returns a validated MySQL `SqlDraft` in `mock` or `llm`
  mode.
- `validate` runs deterministic SQL validation. A failure currently raises
  `ValidationError` and returns HTTP `422`.
- `execute` runs only after validation passes.

## Planner and SQL Modes

Planner mode is controlled by `PLANNER_MODE`:

- `mock` — deterministic plan, no OpenAI key required.
- `llm` — uses `getLlm("planner").invokeJson(...)`.

SQL generation mode is controlled by `SQL_MODE`:

- `mock` — deterministic SQL against `gross_summary`, no OpenAI key
  required.
- `llm` — uses `getLlm("sql").invokeJson(...)`.

Only the literal value `llm` enables LLM calls. Any other value falls back
to `mock`.

The deterministic mock SQL is:

```sql
SELECT `date`, `overall_sale`, `gross_sales`
FROM `gross_summary`
ORDER BY `date` DESC
LIMIT 30
```

## Validation pipeline

`apps/api/src/modules/validation/validator.js` runs four rules in order:

1. **Syntax** — parseable, single statement, `SELECT` only.
2. **Safety** — no DDL/DML anywhere in the tree, no cross-database refs.
3. **Schema** — all tables/columns must be in the allowed schema context.
4. **Cost** — join ceiling, basic `GROUP BY` correctness, optional LIMIT.

Every rule returns structured issues with stable codes (`V_*`). The
validator is **deterministic** and never calls an LLM.

## Execution Layer

`apps/api/src/modules/execution/executor.js` executes validated SQL with
`mysql2` against the tenant database returned by tenant-router.

Execution safeguards:

- Requires a passing validation result before the execute node runs.
- Uses a per-tenant connection pool.
- Sets `SET SESSION TRANSACTION READ ONLY`.
- Sets `SET SESSION MAX_EXECUTION_TIME`.
- Applies query timeout and max-row truncation.
- Releases the connection in `finally`.

## Environment

Create a local `.env`:

```bash
cp .env.example .env
```

Important variables:

| Variable | Purpose |
|----------|---------|
| `PORT` | API port, default `4000`. |
| `TENANT_ROUTER_URL` | Base URL for tenant-router, required. |
| `TENANT_ROUTER_TIMEOUT_MS` | Tenant-router timeout. |
| `X_PIPELINE_KEY` / `TENANT_ROUTER_API_KEY` | Optional tenant-router bypass key. |
| `GATEWAY_SHARED_SECRET` | Enables gateway HMAC verification when set. |
| `GATEWAY_TRUST_BYPASS` | Dev-only direct `x-brand-id` trust when no shared secret is set. |
| `EXEC_QUERY_TIMEOUT_MS` | MySQL query timeout. |
| `EXEC_MAX_ROWS` | Maximum returned rows before truncation. |
| `POOL_CONNECTION_LIMIT` | Per-tenant MySQL pool limit. |
| `OPENAI_API_KEY` | Required only for LLM planner/SQL modes. |
| `LLM_MODEL` | OpenAI model name used by the LLM facade. |
| `PLANNER_MODE` | `mock` or `llm`. |
| `SQL_MODE` | `mock` or `llm`. |

For direct local curl testing, leave `GATEWAY_SHARED_SECRET` empty and set:

```env
GATEWAY_TRUST_BYPASS=true
```

Never enable gateway trust bypass in production.

## Running Locally

Install dependencies:

```bash
npm install
```

Start the API:

```bash
npm run dev
```

The API listens on `PORT` (default `4000`).

Health check:

```bash
curl http://localhost:4000/health
```

Example query:

```bash
curl -X POST http://localhost:4000/insights/query \
  -H 'content-type: application/json' \
  -H 'x-brand-id: YOUR_BRAND_ID' \
  -d '{"question":"Show gross sales for the last 30 days"}'
```

Response envelope:

```json
{
  "ok": true,
  "correlationId": "...",
  "result": {
    "ok": true,
    "columns": ["date", "overall_sale", "gross_sales"],
    "rows": [...],
    "stats": { "rowCount": 30, "elapsedMs": 42, "truncated": false }
  }
}
```

E2E prerequisites:

- Tenant-router must be reachable at `TENANT_ROUTER_URL`.
- Tenant-router must return an active tenant payload with MySQL host,
  database, user, password, and port.
- The tenant database must contain the schema referenced by
  `schema/schema.sql`; in mock SQL mode, `gross_summary` must exist.

Common failure modes:

- `E_TENANT_UNAVAILABLE` — tenant-router is unreachable or timed out.
- `E_TENANT_NOT_FOUND` — tenant-router has no route for the brand.
- `E_GATEWAY_AUTH` — gateway HMAC headers are required or invalid.
- `E_VALIDATION` — SQL failed deterministic validation.
- `E_EXECUTION` / `E_QUERY_TIMEOUT` — validated SQL failed at MySQL.

## Docker

Build the image:

```bash
docker build -t sql-agent .
```

Run with an env file:

```bash
docker run --rm --env-file .env -p 4000:4000 sql-agent
```

When running in Docker, set `TENANT_ROUTER_URL` to an address reachable
from the container. Inside a shared Docker network this is typically:

```env
TENANT_ROUTER_URL=http://tenant-router:3004
```

## Tests

```bash
npm test                  # all tests
npm run test:validation   # validator rules
npm run test:execution    # execution-layer contracts
npm run test:orchestrator # graph nodes + state
npm run lint              # JSDoc type check via tsc --noEmit
```

Tests use Node's built-in test runner; no mocha/jest dependency.

## Current Limitations

- Correction loop is not implemented yet. Failed validation halts the
  request.
- Result explanation and insight summarization are not implemented yet.
- Schema comes from the checked-in dump, not live `information_schema`.
- Mock planner and mock SQL are deterministic and intentionally narrow.
