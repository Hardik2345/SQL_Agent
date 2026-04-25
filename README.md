# SQL Agent (Phase 1)

A multi-tenant SQL agent for a SaaS analytics platform. It converts
natural-language analytics questions into **validated** MySQL `SELECT`
statements and executes them against a tenant-scoped database.

This is a **controlled** analytics system — not a free-form autonomous
agent. Validation is never skipped. The LLM never sees credentials.

> **Phase 1 scope:** Validation layer, tenant-aware execution, contracts,
> LangGraph skeleton, and one API route. Semantic layer, correction loop,
> insight generation, caching, and result explanation are deferred.

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
           │  START → plan → generate_sql → validate │
           │                 → execute → END         │
           └─────────────────┬───────────────────────┘
                             │ validated SQL
                             ▼
                    ┌──────────────────┐
                    │ mysql2 tenant pool│
                    └──────────────────┘
```

- **tenant-router** is the authoritative control-plane for brand ⇒ tenant
  routing. This service **never** bypasses it.
- Tenant-router cache TTL is 10 minutes. This service trusts the freshness
  of the response as long as `metadata_version` is unchanged.
- Connection pooling is owned entirely by this service, keyed by
  `tenantId:host:port:database`.

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

## Contracts

All inter-module boundaries are validated at runtime via
[`apps/api/src/lib/runtimeValidators.js`](apps/api/src/lib/runtimeValidators.js).

Contracts:

| Contract              | File                                                                   |
|-----------------------|------------------------------------------------------------------------|
| `QueryRequest`        | `apps/api/src/modules/contracts/queryRequest.js`                       |
| `QueryPlan`           | `apps/api/src/modules/contracts/queryPlan.js`                          |
| `SqlDraft`            | `apps/api/src/modules/contracts/sqlDraft.js`                           |
| `ValidationResult`    | `apps/api/src/modules/contracts/validationResult.js`                   |
| `ExecutionResult`     | `apps/api/src/modules/contracts/executionResult.js`                    |
| `AgentState`          | `apps/api/src/modules/contracts/agentState.js`                         |
| `TenantExecutionContext` | `apps/api/src/modules/tenant/tenant.types.js`                       |

## Validation pipeline

[`apps/api/src/modules/validation/validator.js`](apps/api/src/modules/validation/validator.js)
runs four rules in order:

1. **Syntax** — parseable, single statement, `SELECT` only.
2. **Safety** — no DDL/DML anywhere in the tree, no cross-database refs.
3. **Schema** — all tables/columns must be in the allowed schema context.
4. **Cost** — join ceiling, basic `GROUP BY` correctness, optional LIMIT.

Every rule returns structured issues with stable codes (`V_*`). The
validator is **deterministic** and never calls an LLM.

## Running

```bash
cp .env.example .env
npm install
npm run dev
```

The API listens on `PORT` (default `4000`).

### Example request

```bash
curl -X POST http://localhost:4000/insights/query \
  -H 'content-type: application/json' \
  -H 'x-brand-id: brand_1' \
  -d '{"question":"How many orders per day in the last 30 days?"}'
```

Response envelope:

```json
{
  "ok": true,
  "correlationId": "...",
  "result": {
    "ok": true,
    "columns": ["day", "order_count"],
    "rows": [...],
    "stats": { "rowCount": 30, "elapsedMs": 42, "truncated": false }
  }
}
```

## Tests

```bash
npm test                  # all tests
npm run test:validation   # validator rules
npm run test:execution    # execution-layer contracts
npm run test:orchestrator # graph nodes + state
```

Tests use Node's built-in test runner; no mocha/jest dependency.

## Notes on Phase 1

- Planner and SQL generator nodes are **mocked** and deterministic. They
  return shapes identical to the LLM-backed versions that will replace
  them in Phase 2, so no downstream code changes are needed when the LLM
  is wired in.
- The correction loop does not exist yet. On a failing validation, the
  graph terminates with a `ValidationError` and the API returns `422`
  with the structured issues in `error.details.issues`.
- The semantic layer is not present; the allowed schema for a tenant is
  currently hard-coded inside the validate node. This will move behind a
  semantic-layer lookup keyed by tenant in a later phase.
