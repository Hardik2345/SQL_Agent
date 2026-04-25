# Gateway Integration

Patches to apply to the dashboard repo so `sql-agent` sits behind the same
OpenResty api-gateway as the other services.

Two files change in `dashboard/`:

1. `dashboard/api-gateway/gateway/nginx.conf` — add upstream + location
2. `dashboard/docker-compose.yml` — register `sql-agent` as a service

Apply them, rebuild the gateway container, and the new route becomes:

```
POST https://<gateway-host>/insights/query
Authorization: Bearer <jwt>
Content-Type: application/json

{ "question": "How many orders per day?" }
```

`brand_id` is read from the caller's JWT (or the `brand_key` query param)
and injected by the gateway as a signed `x-brand-id` header. The client
never passes `brand_id` in the body.

---

## 1. nginx.conf patch

Add the upstream next to the other `upstream` blocks (around line 56):

```nginx
upstream sql_agent {
    server sql-agent:4000;
}
```

Add this location block inside the `server { ... }` body. Put it near the
other protected routes (e.g., below `/sessions`, around line 221):

```nginx
# -------- SQL AGENT (natural-language analytics) --------
location /insights/ {
    access_by_lua_block {
        local t0 = ngx.now()
        local auth = require("auth")
        auth.authenticate()
        local t1 = ngx.now()

        local ratelimit = require("ratelimit")
        ratelimit.enforce()
        local t2 = ngx.now()

        ngx.log(ngx.NOTICE, string.format("[gw-timing] auth=%.3fms rate=%.3fms",
            (t1 - t0) * 1000, (t2 - t1) * 1000))
    }

    # sql-agent mounts routes under /insights/, so no prefix stripping.
    proxy_pass http://sql_agent;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # Analytics queries can legitimately run up to EXEC_QUERY_TIMEOUT_MS
    # (15s by default). Give the gateway a little headroom on top.
    proxy_read_timeout 20s;
    proxy_send_timeout 20s;
}
```

> The gateway's `ratelimit.enforce()` already applies to `/insights/` via
> the pattern matching in `gateway/lua/ratelimit.lua`. If it doesn't match
> by default there, add `/insights/` to the rate-limited-path list in that
> file. Current rate-limited prefixes are `/auth/`, `/analytics/`,
> `/alerts/`, `/sessions/`, `/track/` — `/insights/` should join them.

### Why `/insights/` (no path strip)

- The sql-agent Express app mounts routes under `/insights/` in
  [insight.routes.js](../apps/api/src/routes/insight.routes.js).
- This matches the `alerts-service` pattern (`/alerts/` → upstream keeps
  `/alerts/`), not the `analytics-service` pattern which strips.
- Keeping the prefix means the upstream URL path is the same whether you
  hit sql-agent directly (for internal probes) or through the gateway.

---

## 2. docker-compose.yml patch

Append this service block. `sql-agent` joins `saas-net` (so the gateway
can reach it) and `shared-net` (so it can reach the tenant databases,
same pattern as `analytics-service`):

```yaml
sql-agent:
  container_name: sql-agent-main
  build:
    context: ../SQL_agent
    dockerfile: Dockerfile
  env_file:
    - .env
    - ../SQL_agent/.env
  environment:
    PORT: 4000
    NODE_ENV: production
    TENANT_ROUTER_URL: http://tenant-router:3004
    GATEWAY_SHARED_SECRET: ${GATEWAY_SHARED_SECRET}
    X_PIPELINE_KEY: ${X_PIPELINE_KEY}
  depends_on:
    tenant-router:
      condition: service_healthy
  restart: unless-stopped
  networks:
    - saas-net
    - shared-net
  healthcheck:
    test: ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:4000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));\""]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 15s
```

And add `sql-agent` to the gateway's `depends_on` list so the gateway
boots after it:

```yaml
api-gateway:
  # ...
  depends_on:
    # ... existing ...
    sql-agent:
      condition: service_healthy
```

### Build context assumption

The block above assumes `SQL_agent/` is a sibling of `dashboard/` (i.e.
both under `~/Projects/`). If you want to vendor sql-agent into the
dashboard monorepo instead, move `SQL_agent/` to `dashboard/sql-agent/`
and change `context: ../SQL_agent` to `context: ./sql-agent`.

---

## 3. Env vars to set at the dashboard level

`GATEWAY_SHARED_SECRET` is already wired to the gateway via
`docker-compose.yml` line 15. Make sure it's also propagated to sql-agent
(the service block above does this). No new secret is needed.

`X_PIPELINE_KEY` is used by sql-agent to call tenant-router directly
(bypassing the gateway, since they share the docker network). It should
match the value tenant-router already has.

---

## 4. Verification

After `docker compose up -d --build sql-agent api-gateway`:

```bash
# 1. Direct health — bypasses gateway
docker exec sql-agent-main wget -qO- http://127.0.0.1:4000/health
# → {"ok":true}

# 2. Through gateway, no auth — must be rejected
curl -i http://localhost:8081/insights/query -X POST \
  -H 'content-type: application/json' \
  -d '{"question":"x"}'
# → 401 from gateway's auth.lua (no JWT)

# 3. Through gateway, valid JWT — should reach sql-agent
curl -i http://localhost:8081/insights/query -X POST \
  -H "Authorization: Bearer $JWT" \
  -H 'content-type: application/json' \
  -d '{"question":"How many orders per day?"}'
# → 200 with execution result (or 422 if validation fails)
```

If you hit sql-agent **without** going through the gateway and without
`GATEWAY_TRUST_BYPASS=true`, it will reject the request with
`401 E_GATEWAY_AUTH` because the signed headers are absent. That's
working as intended — the service is not meant to be reachable directly
from clients.

---

## 5. Things I did NOT change (yet)

- **Rate limit bucket names** — `ratelimit.lua` may bucket by prefix. If
  `/insights/` needs its own bucket/limit rather than sharing with
  `/analytics/`, that's a one-line addition to the Lua module; not done
  here since I didn't want to touch rate-limit semantics without
  confirming your target throughput.
- **Admin route protection** — `auth.lua` guards `/admin/*` specifically.
  sql-agent has no admin routes today, so no change needed.
- **CORS** — handled entirely at the gateway; sql-agent never needs to
  set CORS headers.
- **CI integration** — no CI config changes proposed; you'll want to add
  a `docker compose build sql-agent` step wherever the other services
  are built.
