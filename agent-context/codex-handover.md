# Codex Handover — SQL Agent

## Status
- Phase 1 + 2A + 2B + 2B-A + 2B-B done.
- 96/96 tests pass, lint clean.
- JS-only, ESM, JSDoc + runtime validators. **Never introduce TS.**

## Read these first
1. `agent-context/system-context.md` — non-negotiable rules
2. `agent-context/implementation-brief.md` — full state, contracts, do-not-redo list
3. `prompts/correction.prompt.md` — draft, needs updating

## What's live
- Graph: `START → load_schema → planner → (END if needs_clarification | generate_sql) → validate → execute → END`
- Planner: mock|llm modes (`PLANNER_MODE`)
- SQL gen: mock|llm modes (`SQL_MODE`)
- Both reuse `lib/llm.js` (`getLlm(role).invokeJson(messages)`), JSON mode, lazy `@langchain/openai` import.
- Validation/execution unchanged from Phase 1. Don't touch.
- Gateway HMAC, tenant-router client, schema provider — all production-shaped. Don't touch.

## Key contracts (in `apps/api/src/modules/contracts/`)
- `QueryPlan`: widened with `status`, `clarificationQuestion`, `assumptions`, `metricDefinitions`. `assertQueryPlan` normalizes legacy/missing fields and cross-validates ready vs needs_clarification.
- `SqlDraft`: `{sql, dialect:'mysql', tables[], rationale?}`.
- `SchemaContext`: `tables` keyed object, `allowedTables[]`, `allowedColumns{}`, `allowedJoins[]`.
- `AgentState`: `request, tenant, schemaContext?, globalContext?, chatContext?, plan?, sqlDraft?, validation?, execution?, status, error?`.

## Pattern to mirror for new nodes
```js
export const createFooNode = ({ mode, llm } = {}) => {
  const m = mode ?? env.foo.mode;
  const explicitLlm = llm ?? null;
  return async (state) => { /* … */ };
};
export const fooNode = createFooNode();
```
- Tests inject `{mode:'llm', llm: fakeLlm}` directly. No global mutation.
- Mock fallback is CI-safe path; default to mock unless env says `=llm`.
- Wrap LLM transport / non-JSON / shape errors as `ContractError`.
- Defensive guards on missing required state, throw `ContractError`.

## Next: Phase 2C — Correction loop
File: `apps/api/src/orchestrator/nodes/correction.node.js` (new)
Prompt: `prompts/correction.prompt.md`
Env: `CORRECTION_MODE=mock|llm` (default mock)

Graph edits in `graph.js`:
- After `validate`, add conditional `validateRouter(state)`:
  - if `validation.valid` → `execute`
  - else if `state.correctionAttempts < MAX_CORRECTION_ATTEMPTS` → `correction`
  - else → END (validation error already on state)
- Edge `correction → validate` (loop).
- Bump `MAX_CORRECTION_ATTEMPTS = 2` in `utils/constants.js`.
- New state channel `correctionAttempts` (counter, incremented in correction node).

Correction node consumes:
- `state.sqlDraft` (failing one)
- `state.validation.issues[]`
- same `request, plan, schemaContext` as SQL gen
- prompts must explicitly say: never re-emit DDL/DML, fix only the V_* codes given, return new `SqlDraft`.

Output → `state.sqlDraft` (replaces failing draft); validate node re-runs.

Mock mode for correction: just return the same `sqlDraft` unchanged (so the loop will fail the same way and exit on attempt cap). That keeps tests deterministic.

## Existing factories to copy
- `apps/api/src/orchestrator/nodes/plan.node.js` — best reference for clarification + factory pattern
- `apps/api/src/orchestrator/nodes/sql.node.js` — best reference for prompt-context builder + sanitization pattern
- `apps/api/src/modules/planner/plannerContext.js` and `apps/api/src/modules/sql/sqlContext.js` — pure builder pattern

## Non-negotiables
- No TS, no `.ts` files, no `tsconfig`.
- Validation rules + V_* codes frozen. Never bypass.
- Execution layer (`SET SESSION TRANSACTION READ ONLY`, `MAX_EXECUTION_TIME`, per-tenant pool) frozen.
- Gateway HMAC verify, tenant-router client (with real `tenant_not_found`/`tenant_suspended`/`routing_unavailable` mapping) frozen.
- `lib/llm.js` JSON-mode behavior frozen — only `models.js` per-role config can change.
- Contracts in `modules/contracts/` widen-only.
- Mock modes must run without `OPENAI_API_KEY`.

## Useful commands
```bash
npm test                  # 96 tests
npm run lint              # tsc --noEmit (JSDoc check)
TENANT_ROUTER_URL=http://tenant-router:3004 GATEWAY_SHARED_SECRET=test-secret-32-bytes-minimum-ok npm test
```

Test runner uses `find tests -name '*.test.js' -print0 | xargs -0 node --test` (subdirs work).

## Test injection cheatsheet
```js
const fakeLlm = { invokeJson: async (messages) => ({ /* fixture */ }) };
const node = createFooNode({ mode: 'llm', llm: fakeLlm });
const patch = await node(state);
```
For ContractError assertions: `assert.rejects(() => node(...), (err) => err instanceof ContractError)`.
For `err.details`: cast first — `const d = /** @type {any} */ (err).details`.

## Stuff that bit me
- LangGraph 0.2.74 disallows node names that collide with channel keys → planner registered as `'planner'`, not `'plan'`. Don't reuse channel keys.
- Test file in subdirs needs `find … xargs node --test`; shell glob is non-recursive.
- `graph.nodes` is a plain object, not a Map.
- `dialect: 'mysql'` literal type narrows in test fixtures — annotate with JSDoc `@type {SchemaContext}` cast or test will fail TS check.
- ContractError's `.message` is just the summary; line-by-line errors are in `.details.errors`.

That's the whole picture. Pick up at `prompts/correction.prompt.md` + `correction.node.js`.
