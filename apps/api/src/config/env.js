import 'dotenv/config';

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
  }),

  llm: Object.freeze({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
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
});

export const isProduction = env.nodeEnv === 'production';
