# SQL Agent

A multi-tenant SQL agent for a SaaS analytics platform. It converts
natural-language analytics questions into **validated** MySQL `SELECT`
statements and executes them against a tenant-scoped database.

This is a **controlled** analytics system — not a free-form autonomous
agent. Validation is never skipped. The LLM never sees credentials.

Current implementation includes tenant resolution, schema loading,
real context retrieval, planning, SQL generation, deterministic validation,
bounded correction, tenant-scoped execution, and chat-scoped metric memory.
Planner, SQL generation, and correction can run in deterministic mock mode
or LLM mode. Result explanation and natural-language insight summarization
are not wired yet.

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
           │ START → load_schema → load_context      │
           │       → planner                         │
           │       → END for clarification/memory    │
           │       → generate_sql → validate         │
           │       → correct ↺ or execute → END      │
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
- `load_context` retrieves Redis chat memory, Mongo semantic metrics, and
  Qdrant vector candidates before planning.
- `planner` can stop early with `needs_clarification` or `memory_update`;
  in both cases SQL generation, validation, and execution are skipped.
- `generate_sql` produces a `SqlDraft`; validation is deterministic and
  must pass before execution.
- `correct` can repair failed SQL drafts when `CORRECTION_MODE=llm` and
  validation has remaining retry budget.
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
│   │   ├── context/       # Redis + Mongo + Qdrant retrieval orchestration
│   │   ├── chatMemory/    # Redis/in-memory chat memory provider
│   │   ├── semantic/      # Mongo/in-memory semantic metric catalog
│   │   ├── vector/        # Qdrant/in-memory vector retrieval + embeddings
│   │   ├── correction/    # Correction prompt context builders
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
├── prompts/               # Planner, SQL, and correction prompt templates
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
  → load_context
  → planner
  → END          when plan.status === "needs_clarification"
  → END          when plan.status === "memory_update"
  → generate_sql when plan.status === "ready"
  → validate
  → correct      when validation fails and attempts remain
  → validate
  → execute
  → END
```

Node responsibilities:

- `load_schema` attaches a schema context from `schema/schema.sql`.
- `load_context` attaches `globalContext`, `chatContext`, and retrieval
  trace data using Redis, MongoDB, and Qdrant when configured.
- `planner` returns a validated `QueryPlan` in `mock` or `llm` mode.
  The planner receives a compact digest of all allowed tables plus
  semantic/chat context. It also chooses `resultShape` and `dimensions`
  so SQL generation knows whether to produce one aggregate row, a time
  series, a grouped breakdown, or detail rows.
- `generate_sql` returns a validated MySQL `SqlDraft` in `mock` or `llm`
  mode. It receives only the planner-selected target table schemas.
- `validate` runs deterministic SQL validation. Failures route to
  correction until `MAX_CORRECTION_ATTEMPTS` is exhausted, then return
  HTTP `422`.
- `correct` returns a replacement `SqlDraft` in `mock` or `llm` mode and
  loops back to validation.
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

Correction mode is controlled by `CORRECTION_MODE`:

- `mock` — returns the failing SQL unchanged. Useful for deterministic
  tests and exercising validation failure paths.
- `llm` — uses `getLlm("correction").invokeJson(...)` to repair SQL using
  validation issues.

Correction attempts are capped by `MAX_CORRECTION_ATTEMPTS` (default `2`).

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

## Result Shapes

The planner contract includes `resultShape` and `dimensions` to prevent
the SQL generator from guessing the output shape:

| `resultShape` | Meaning | SQL shape |
|---------------|---------|-----------|
| `single_aggregate` | One summarized value, e.g. “total sales for product X”. | Aggregate without `GROUP BY`. |
| `time_series` | Trend over time, e.g. “sales by day”. | Aggregate with `GROUP BY` on a time bucket. |
| `grouped_breakdown` | Aggregate by non-time dimensions, e.g. “sales by product”. | Aggregate with `GROUP BY` on requested dimensions. |
| `detail_rows` | Raw/listed records, e.g. “list orders”. | Row-level `SELECT` with `LIMIT`. |

For example, “total sales of product X in last 3 days” should be
`single_aggregate` and return one row. “total sales by day for product X”
should be `time_series` and return one row per day.

## Context Retrieval and Memory

Phase 2D adds real context retrieval before planning:

- **Redis chat memory** stores the hot conversation snapshot: recent
  questions, confirmed metric definitions, last metric refs, last filter
  refs, and a small structural result summary.
- **MongoDB semantic catalog** stores authoritative metric definitions by
  tenant.
- **MongoDB chat memory archive** stores durable snapshots of Redis chat
  memory for cross-Redis-restart recovery and read fallback.
- **Qdrant vector retrieval** finds candidate metric ids for the current
  question, then MongoDB resolves those ids into formulas/descriptions.
- **Embeddings** use `text-embedding-3-small` when `OPENAI_API_KEY` is set;
  otherwise tests/dev can fall back to deterministic mock embeddings.

Qdrant point payload shape:

```json
{
  "tenantId": "TMC",
  "metricId": "gross_sales",
  "type": "metric"
}
```

Required Qdrant payload indexes:

```text
tenantId: keyword
metricId: keyword
```

The seed script creates the Mongo metric documents, Qdrant collection,
payload indexes, embeddings, and vector points:

```bash
npm run seed:phase2d
```

Chat memory keys use:

```text
sql-agent:chat:<brandId>:<userId>:<conversationId>
```

Redis remains the request-time write path. In production, enable Kafka event
publishing and run the Kafka archive worker:

```bash
npm run sync:chat-memory:kafka
```

The API publishes one lightweight event per changed conversation after Redis
is updated. The worker dedupes by `brandId:userId:conversationId`, reads the
latest Redis snapshot, and bulk upserts MongoDB every
`CHAT_MEMORY_KAFKA_FLUSH_MS` or `CHAT_MEMORY_KAFKA_BATCH_SIZE` unique chats.

The Redis scan worker remains available for backfill/repair:

```bash
npm run sync:chat-memory
```

For a one-shot backfill/test pass:

```bash
npm run sync:chat-memory -- --once
```

On API reads, Redis is checked first. If Redis misses and `MONGO_URI` is
configured, the provider checks MongoDB `MONGO_CHAT_MEMORY_COLLECTION`; a hit
is returned and rehydrated back into Redis with `CHAT_MEMORY_TTL_SECONDS`.

The request body should include context for stable conversation memory:

```json
{
  "question": "Show gross sales for the last 30 days",
  "context": {
    "conversationId": "phase2d-cloud-test-1",
    "userId": "dev-user"
  }
}
```

## Chat Metric Definitions

The planner can classify explicit chat-scoped metric definitions as
`status: "memory_update"`.

Example:

```text
In this chat, contribution margin means net sales - discounts.
```

Expected response shape:

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "type": "memory_ack",
    "confirmedMetricDefinitions": {
      "contribution_margin": "net sales - discounts"
    }
  }
}
```

This flow writes Redis `confirmedMetricDefinitions` and skips SQL
generation, validation, and execution. Later queries in the same
`brandId + userId + conversationId` can use the confirmed definition.

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
| `NODE_ENV` | Runtime environment. Use `production` for deployed containers; use `development` for dev-only SQL debug logs. |
| `PORT` | API port, default `4000`. |
| `LOG_LEVEL` | Pino log level, default `info`. |
| `TENANT_ROUTER_URL` | Base URL for tenant-router, required. |
| `TENANT_ROUTER_TIMEOUT_MS` | Tenant-router timeout. |
| `PASSWORD_AES_KEY` | AES key used to decrypt tenant-router DB password payloads shaped as `base64(iv):base64(ciphertext)`. |
| `X_PIPELINE_KEY` / `TENANT_ROUTER_API_KEY` | Optional tenant-router bypass key. |
| `GATEWAY_SHARED_SECRET` | Enables gateway HMAC verification when set. |
| `GATEWAY_TRUST_BYPASS` | Dev-only direct `x-brand-id` trust when no shared secret is set. |
| `EXEC_QUERY_TIMEOUT_MS` | MySQL query timeout. |
| `EXEC_MAX_ROWS` | Maximum returned rows before truncation. |
| `POOL_CONNECTION_LIMIT` | Per-tenant MySQL pool limit. |
| `OPENAI_API_KEY` | Required for LLM planner/SQL/correction modes and OpenAI-backed embeddings. |
| `LLM_MODEL` | OpenAI model name used by the LLM facade. |
| `PLANNER_MODE` | `mock` or `llm`. |
| `SQL_MODE` | `mock` or `llm`. |
| `CORRECTION_MODE` | `mock` or `llm`. |
| `MAX_CORRECTION_ATTEMPTS` | Maximum correction retries before returning `E_VALIDATION`. |
| `DEV_LOG_GENERATED_SQL` | Dev-only flag that logs generated/corrected SQL text when `NODE_ENV` is not `production`. |
| `REDIS_URL` | Redis connection URL for chat memory. Falls back to in-memory when unset. |
| `CHAT_MEMORY_TTL_SECONDS` | Redis chat memory TTL; default `86400`. |
| `MONGO_URI` | MongoDB URI for semantic metric catalog and chat-memory archive. Falls back to in-memory/no archive when unset. |
| `MONGO_DB` | Mongo database name, default `sql_agent`. |
| `MONGO_METRICS_COLLECTION` | Mongo metrics collection, default `metrics`. |
| `MONGO_CHAT_MEMORY_COLLECTION` | Mongo chat-memory archive collection, default `chat_memory`. |
| `CHAT_MEMORY_MONGO_TTL_SECONDS` | Mongo chat-memory archive retention, default `7776000` (90 days). |
| `CHAT_MEMORY_SYNC_INTERVAL_MS` | Redis→Mongo chat-memory sync interval, default `300000` (5 minutes). |
| `CHAT_MEMORY_SYNC_BATCH_SIZE` | Redis SCAN count hint for chat-memory sync, default `100`. |
| `KAFKA_BROKERS` | Comma-separated Kafka bootstrap brokers for chat-memory events. |
| `KAFKA_CLIENT_ID` | Kafka client id, default `sql-agent`. |
| `KAFKA_SSL` | Enables Kafka SSL when `true`. |
| `KAFKA_SASL_MECHANISM` | Optional Kafka SASL mechanism, defaults to `plain` when username is set. |
| `KAFKA_SASL_USERNAME` / `KAFKA_SASL_PASSWORD` | Optional Kafka SASL credentials. |
| `CHAT_MEMORY_KAFKA_ENABLED` | Enables API-side chat-memory event publishing. |
| `CHAT_MEMORY_KAFKA_TOPIC` | Chat-memory event topic, default `sql-agent.chat-memory.changed`. |
| `CHAT_MEMORY_KAFKA_CONSUMER_GROUP` | Kafka archive worker group id. |
| `CHAT_MEMORY_KAFKA_BATCH_SIZE` | Unique conversations per Kafka archive flush, default `500`. |
| `CHAT_MEMORY_KAFKA_FLUSH_MS` | Max Kafka archive flush interval, default `5000`. |
| `QDRANT_URL` | Qdrant HTTP URL for vector retrieval. Falls back to in-memory when unset. |
| `QDRANT_API_KEY` | Qdrant API key for cloud/private clusters. |
| `QDRANT_COLLECTION` | Qdrant collection name, default `semantic_metrics`. |
| `EMBEDDING_MODEL` | Embedding model, default `text-embedding-3-small`. |
| `EMBEDDING_DIMENSIONS` | Expected embedding dimensions, default `1536`. |
| `VECTOR_TOP_K` | Number of vector candidates to fetch before Mongo resolution. |

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
  -d '{
    "question":"Show gross sales for the last 30 days",
    "context":{
      "conversationId":"dev-conversation",
      "userId":"dev-user"
    }
  }'
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
- For full Phase 2D retrieval, Redis, MongoDB, and Qdrant must be reachable
  from the sql-agent container or process.
- For Qdrant Cloud, set `QDRANT_URL` and `QDRANT_API_KEY`, then run
  `npm run seed:phase2d` once per environment/collection.

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

For full Phase 2D context retrieval with real Redis, MongoDB, and Qdrant,
see `docs/PHASE2D_REAL_CONTEXT.md`.

When running behind the dashboard stack, this service is normally started
from the dashboard `docker-compose.yml` so it can reach `api-gateway`,
`tenant-router`, and the shared tenant DB network. The sql-agent container
does not need a public port when it is only called through the gateway.

For dev-only generated SQL logs in Docker, use:

```yaml
environment:
  NODE_ENV: development
  DEV_LOG_GENERATED_SQL: "true"
  LOG_LEVEL: info
```

`pino-pretty` is optional; development containers fall back to JSON logs if
the pretty transport is not installed.

Optional chat-memory sync worker in dashboard compose:

```yaml
sql-agent-chat-memory-kafka-sync:
  build:
    context: ../SQL_agent
    dockerfile: Dockerfile
  env_file:
    - path: .env
      required: false
    - path: ../SQL_agent/.env
      required: false
  environment:
    NODE_ENV: production
  command: npm run sync:chat-memory:kafka
  restart: unless-stopped
  networks:
    - saas-net
```

It needs the same Redis, Mongo, and Kafka env values as the API container. It
exposes no ports and should run as a separate process/container. Keep
`npm run sync:chat-memory` as a manual or low-frequency repair/backfill job.

## Tests

```bash
npm test                  # all tests
npm run test:validation   # validator rules
npm run test:execution    # execution-layer contracts
npm run test:orchestrator # graph nodes + state
npm run lint              # JSDoc type check via tsc --noEmit
npm run seed:phase2d      # seed MongoDB + Qdrant semantic metrics
npm run sync:chat-memory  # fallback/backfill Redis scan archive worker
npm run sync:chat-memory:kafka # primary Kafka archive worker
```

Tests use Node's built-in test runner; no mocha/jest dependency.

## Current Limitations

- Result explanation and insight summarization are not implemented yet.
- Schema comes from the checked-in dump, not live `information_schema`.
- Mock planner and mock SQL are deterministic and intentionally narrow.
- The planner currently receives a compact digest of all allowed tables;
  table-level retrieval before planning is not implemented yet.
- Memory update classification is planner-driven, so it still costs one
  planner LLM call in LLM mode.
