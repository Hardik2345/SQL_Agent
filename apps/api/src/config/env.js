import 'dotenv/config';
import { MAX_CORRECTION_ATTEMPTS_DEFAULT } from '../utils/constants.js';

const required = (name, value) => {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 4000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  tenantRouter: Object.freeze({
    url: required('TENANT_ROUTER_URL', process.env.TENANT_ROUTER_URL),
    timeoutMs: toInt(process.env.TENANT_ROUTER_TIMEOUT_MS, 3000),
    // tenant-router accepts x-pipeline-key as its internal-bypass header
    // for /tenant/resolve, mirroring the gateway's bypass rule.
    apiKey: process.env.X_PIPELINE_KEY ?? process.env.TENANT_ROUTER_API_KEY ?? '',
    // AES-256-CBC key used to decrypt tenant-router password payloads shaped
    // as `base64(iv):base64(ciphertext)`. Matches the dashboard decrypt logic.
    passwordAesKey: process.env.PASSWORD_AES_KEY ?? '',
  }),

  gateway: Object.freeze({
    // HMAC secret shared with the api-gateway (see
    // dashboard/api-gateway/gateway/lua/auth.lua). When set, every
    // request must carry a valid x-gw-ts / x-gw-sig pair.
    sharedSecret: process.env.GATEWAY_SHARED_SECRET ?? '',
    // Dev escape hatch: when GATEWAY_SHARED_SECRET is unset, allow the
    // middleware to trust x-brand-id verbatim. Must be explicitly
    // enabled; never defaults to true.
    trustBypass: toBool(process.env.GATEWAY_TRUST_BYPASS, false),
  }),

  execution: Object.freeze({
    queryTimeoutMs: toInt(process.env.EXEC_QUERY_TIMEOUT_MS, 15000),
    maxRows: toInt(process.env.EXEC_MAX_ROWS, 10000),
    poolConnectionLimit: toInt(process.env.POOL_CONNECTION_LIMIT, 10),
    poolIdleTimeoutMs: toInt(process.env.POOL_IDLE_TIMEOUT_MS, 600000),
    ssl: toBool(process.env.MYSQL_SSL, false),
    // When ssl=true, controls whether the TLS certificate chain is
    // verified. Set to false for self-signed / private CA certs (e.g.
    // local dev MySQL, non-RDS cloud DBs). Defaults to false so self-
    // signed certs work out of the box; set to true for AWS RDS Proxy
    // or any endpoint with a publicly-signed cert.
    sslRejectUnauthorized: toBool(process.env.MYSQL_SSL_REJECT_UNAUTHORIZED, false),
  }),

  llm: Object.freeze({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    plannerModel: process.env.LLM_MODEL_PLANNER ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
    sqlModel: process.env.LLM_MODEL_SQL ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
    correctionModel:
      process.env.LLM_MODEL_CORRECTION ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
    explanationModel:
      process.env.LLM_MODEL_EXPLANATION ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
  }),

  planner: Object.freeze({
    // 'mock' (default) returns the deterministic Phase 2A plan.
    // 'llm' invokes the configured LLM. Anything else falls back to
    // 'mock' so an unset / typoed value never silently calls the LLM.
    mode: process.env.PLANNER_MODE === 'llm' ? 'llm' : 'mock',
  }),

  sql: Object.freeze({
    // Same fail-safe pattern as PLANNER_MODE: only the literal string
    // "llm" enables the LLM-backed SQL generator. Anything else
    // (unset, typo, "true", …) falls back to the deterministic mock.
    mode: process.env.SQL_MODE === 'llm' ? 'llm' : 'mock',
  }),

  observability: Object.freeze({
    // Dev-only escape hatch for inspecting generated SQL. The call sites
    // also require NODE_ENV !== "production" before logging SQL text.
    logGeneratedSql: toBool(process.env.DEV_LOG_GENERATED_SQL, false),
  }),

  correction: Object.freeze({
    // Same fail-safe pattern as PLANNER_MODE / SQL_MODE.
    mode: process.env.CORRECTION_MODE === 'llm' ? 'llm' : 'mock',
    // Cap on automated correction retries. Higher values cost LLM
    // tokens and rarely converge — the default (2) is intentionally
    // tight. Floor at 0 (correction disabled when set to 0).
    maxAttempts: (() => {
      const parsed = Number.parseInt(
        process.env.MAX_CORRECTION_ATTEMPTS ?? '',
        10,
      );
      if (!Number.isFinite(parsed) || parsed < 0) {
        return MAX_CORRECTION_ATTEMPTS_DEFAULT;
      }
      return parsed;
    })(),
  }),

  explanation: Object.freeze({
    // Same fail-safe pattern as planner/sql/correction. Mock mode is
    // deterministic and does not call an LLM.
    mode: process.env.EXPLANATION_MODE === 'llm' ? 'llm' : 'mock',
  }),

  // Phase 2D: external services for the context loader. ALL OPTIONAL
  // — when an URL is unset, the corresponding provider falls back to
  // an in-memory stub so the system still runs (with reduced
  // intelligence). Tests rely on the in-memory paths.
  redis: Object.freeze({
    url: process.env.REDIS_URL ?? '',
    chatTtlSeconds: toInt(process.env.CHAT_MEMORY_TTL_SECONDS, 24 * 60 * 60),
  }),
  mongo: Object.freeze({
    uri: process.env.MONGO_URI ?? '',
    db: process.env.MONGO_DB ?? 'sql_agent',
    metricsCollection: process.env.MONGO_METRICS_COLLECTION ?? 'metrics',
    chatMemoryCollection: process.env.MONGO_CHAT_MEMORY_COLLECTION ?? 'chat_memory',
    chatMemoryTtlSeconds: toInt(process.env.CHAT_MEMORY_MONGO_TTL_SECONDS, 90 * 24 * 60 * 60),
  }),
  chatMemorySync: Object.freeze({
    intervalMs: toInt(process.env.CHAT_MEMORY_SYNC_INTERVAL_MS, 5 * 60 * 1000),
    batchSize: toInt(process.env.CHAT_MEMORY_SYNC_BATCH_SIZE, 100),
  }),
  kafka: Object.freeze({
    brokers: (process.env.KAFKA_BROKERS ?? '')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'sql-agent',
    ssl: toBool(process.env.KAFKA_SSL, false),
    saslMechanism: process.env.KAFKA_SASL_MECHANISM ?? '',
    saslUsername: process.env.KAFKA_SASL_USERNAME ?? '',
    saslPassword: process.env.KAFKA_SASL_PASSWORD ?? '',
  }),
  chatMemoryKafka: Object.freeze({
    enabled: toBool(process.env.CHAT_MEMORY_KAFKA_ENABLED, false),
    topic: process.env.CHAT_MEMORY_KAFKA_TOPIC ?? 'sql-agent.chat-memory.changed',
    consumerGroup: process.env.CHAT_MEMORY_KAFKA_CONSUMER_GROUP ?? 'sql-agent-chat-memory-archive',
    batchSize: toInt(process.env.CHAT_MEMORY_KAFKA_BATCH_SIZE, 500),
    flushMs: toInt(process.env.CHAT_MEMORY_KAFKA_FLUSH_MS, 5000),
  }),
  qdrant: Object.freeze({
    url: process.env.QDRANT_URL ?? '',
    apiKey: process.env.QDRANT_API_KEY ?? '',
    collection: process.env.QDRANT_COLLECTION ?? 'semantic_metrics',
  }),
  embedding: Object.freeze({
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dimensions: toInt(process.env.EMBEDDING_DIMENSIONS, 1536),
  }),
  retrieval: Object.freeze({
    topK: toInt(process.env.VECTOR_TOP_K, 5),
  }),
});

export const isProduction = env.nodeEnv === 'production';
