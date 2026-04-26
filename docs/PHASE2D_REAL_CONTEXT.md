# Phase 2D Real Context Retrieval

Use this when testing the full Phase 2D context path with real external
services instead of in-memory fallbacks.

The planner can also return `status: "memory_update"` for explicit
chat-scoped metric definitions, for example `In this chat, contribution
margin means net sales - discounts.` That flow writes Redis
`confirmedMetricDefinitions`, returns `type: "memory_ack"`, and skips
SQL generation/execution.

## Required Services

- `redis` — chat memory across conversation turns.
- `mongo` — authoritative semantic metric catalog.
- `qdrant` — vector candidate retrieval.
- `sql-agent` — configured to point at all three services.
- Dashboard services — `api-gateway`, `tenant-router`, and tenant DB access.

No local Redis/Mongo/Qdrant install is required. Run them in Docker from the
dashboard compose stack.

## Dashboard Compose Additions

Add these services to the dashboard `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  container_name: sql-agent-redis
  restart: unless-stopped
  networks:
    - saas-net
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 3s
    retries: 5

mongo:
  image: mongo:7
  container_name: sql-agent-mongo
  restart: unless-stopped
  volumes:
    - sql-agent-mongo-data:/data/db
  networks:
    - saas-net
  healthcheck:
    test: ["CMD-SHELL", "mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' | grep 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 15s

qdrant:
  image: qdrant/qdrant:v1.9.7
  container_name: sql-agent-qdrant
  restart: unless-stopped
  volumes:
    - sql-agent-qdrant-data:/qdrant/storage
  networks:
    - saas-net
  healthcheck:
    test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:6333/healthz || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 15s

volumes:
  sql-agent-mongo-data:
  sql-agent-qdrant-data:
```

Then update `sql-agent`:

```yaml
sql-agent:
  environment:
    PORT: 4000
    NODE_ENV: production
    TENANT_ROUTER_URL: http://tenant-router:3004
    GATEWAY_SHARED_SECRET: ${GATEWAY_SHARED_SECRET}
    X_PIPELINE_KEY: ${X_PIPELINE_KEY:-}
    PASSWORD_AES_KEY: ${PASSWORD_AES_KEY}

    PLANNER_MODE: llm
    SQL_MODE: llm
    CORRECTION_MODE: llm
    OPENAI_API_KEY: ${OPENAI_API_KEY}

    REDIS_URL: redis://redis:6379
    CHAT_MEMORY_TTL_SECONDS: 86400
    MONGO_URI: mongodb://mongo:27017
    MONGO_DB: sql_agent
    MONGO_METRICS_COLLECTION: metrics
    QDRANT_URL: http://qdrant:6333
    QDRANT_COLLECTION: semantic_metrics
    EMBEDDING_MODEL: text-embedding-3-small
    EMBEDDING_DIMENSIONS: 1536
    VECTOR_TOP_K: 5
  depends_on:
    tenant-router:
      condition: service_healthy
    redis:
      condition: service_healthy
    mongo:
      condition: service_healthy
    qdrant:
      condition: service_healthy
```

## Run Stack

From the dashboard repo:

```bash
docker compose up -d --build redis mongo qdrant tenant-router sql-agent api-gateway
```

## Seed Semantic Catalog And Qdrant

The SQL agent includes a seed utility:

```bash
npm run seed:phase2d -- --file seed/semantic-metrics.example.json
```

When running against Docker services from the host, point env vars at
published ports. If you do not publish Mongo/Qdrant ports, run the seed
script inside the `sql-agent` container instead.

Recommended container-based seed:

```bash
docker compose run --rm sql-agent node scripts/seed-phase2d-context.js \
  --file seed/semantic-metrics.example.json
```

The seed file must contain metrics shaped like:

```json
{
  "tenantId": "TMC",
  "metricId": "gross_sales",
  "formula": "SUM(gross_summary.gross_sales)",
  "description": "Gross sales over time.",
  "synonyms": ["gross revenue"],
  "tables": ["gross_summary"],
  "columns": ["date", "gross_sales"],
  "version": "v1"
}
```

The seed script:

1. Upserts metric definitions into MongoDB.
2. Ensures the Qdrant collection exists.
3. Ensures Qdrant payload indexes exist for `tenantId` and `metricId`.
4. Embeds each metric using `EMBEDDING_MODEL`.
5. Upserts metric vectors into Qdrant with tenant-scoped payloads.

If Qdrant logs this error:

```text
Index required but not found for "tenantId" of one of the following types: [keyword]
```

rerun the seed script. It creates the required payload indexes before
upserting vectors.

## Verify Real Providers Are Used

Watch `sql-agent` logs:

```bash
docker logs -f sql-agent-main
```

Expected real-provider signals:

```text
semantic.mongo.connected
node.load_context.ok
```

Expected absence of fallback signals:

```text
chatmemory.fallback
semantic.fallback
vector.fallback
chatmemory.redis.import_failed
semantic.mongo.import_failed
```

Then send a gateway request:

```bash
curl -X POST http://localhost:8081/insights/query \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $JWT" \
  -d '{"question":"Show gross sales for the last 30 days"}'
```

If retrieval is working, `node.load_context.ok` should show resolved metric
ids such as `gross_sales` before planner execution.

## Notes

- Redis is only useful across repeated conversation turns when the request
  carries stable `context.conversationId` and/or `context.userId`.
- MongoDB is the source of truth for metric definitions. Qdrant stores only
  candidate IDs and scores; SQL agent always round-trips vector hits through
  Mongo before giving metric definitions to the planner.
- If `OPENAI_API_KEY` is absent, embeddings fall back to deterministic mock
  vectors. That is useful for tests but not meaningful semantic retrieval.
