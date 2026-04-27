import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { createCorrectionNode } from '../../../apps/api/src/orchestrator/nodes/correction.node.js';
import { AGENT_STATUS } from '../../../apps/api/src/utils/constants.js';
import { ContractError } from '../../../apps/api/src/utils/errors.js';
import { schemaCache } from '../../../apps/api/src/modules/schema/schemaCache.js';
import { getSchemaContext } from '../../../apps/api/src/modules/schema/schemaProvider.js';

const tenant = {
  brandId: 'BRAND',
  database: 'tenant_db',
  host: '127.0.0.1',
  port: 3306,
  poolKey: 'BRAND:127.0.0.1:3306:tenant_db',
  credentials: { user: 'TENANT_SVC_USER_SENTINEL', password: 'TENANT_SVC_SECRET_SENTINEL' },
};

const makeFakeLlm = (responder) => ({
  invokeJson: async (messages) => {
    if (typeof responder === 'function') return responder(messages);
    return responder;
  },
});

/** @type {import('../../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
const readyPlan = {
  intent: 'metric_over_time',
  targetTables: ['gross_summary'],
  requiredMetrics: ['gross_sales'],
  resultShape: 'time_series',
  dimensions: ['date'],
  filters: [],
  timeGrain: 'day',
  notes: 'ok',
  status: 'ready',
  clarificationQuestion: null,
  assumptions: [],
  metricDefinitions: [],
};

const failingDraft = {
  sql: 'SELECT phantom_col FROM gross_summary LIMIT 10',
  dialect: 'mysql',
  tables: ['gross_summary'],
  rationale: 'attempt 1',
};

/** @type {import('../../../apps/api/src/modules/contracts/validationResult.js').ValidationResult} */
const failedValidation = {
  valid: false,
  issues: [
    {
      code: 'V_COLUMN_NOT_ALLOWED',
      message: 'Column not allowed on table gross_summary: phantom_col',
      severity: 'error',
      meta: { table: 'gross_summary', column: 'phantom_col' },
    },
  ],
};

const baseState = (schemaContext, overrides = {}) => ({
  correlationId: 'c1',
  request: { brandId: 'BRAND', question: 'gross sales by day' },
  tenant,
  schemaContext,
  plan: readyPlan,
  sqlDraft: failingDraft,
  validation: failedValidation,
  status: AGENT_STATUS.VALIDATED,
  correctionAttempts: 0,
  correctionHistory: [],
  ...overrides,
});

describe('correction.node — mock mode', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  it('does not call the LLM and returns the failing SQL unchanged', async () => {
    let llmCalled = false;
    const llm = makeFakeLlm(() => {
      llmCalled = true;
      return {};
    });
    const node = createCorrectionNode({ mode: 'mock', llm });
    const patch = await node(baseState(schemaContext));
    assert.equal(llmCalled, false);
    assert.equal(patch.status, AGENT_STATUS.CORRECTING);
    assert.equal(patch.sqlDraft.sql, failingDraft.sql);
    assert.equal(patch.sqlDraft.dialect, 'mysql');
    assert.match(patch.sqlDraft.rationale, /mock correction/i);
  });

  it('increments correctionAttempts and appends a correctionHistory entry', async () => {
    const node = createCorrectionNode({ mode: 'mock', llm: makeFakeLlm({}) });
    const patch = await node(baseState(schemaContext, { correctionAttempts: 1 }));
    assert.equal(patch.correctionAttempts, 2);
    assert.equal(patch.correctionHistory.length, 1);
    assert.equal(patch.correctionHistory[0].attempt, 2);
    assert.equal(patch.correctionHistory[0].mode, 'mock');
    assert.equal(patch.correctionHistory[0].previousSql, failingDraft.sql);
    assert.equal(patch.correctionHistory[0].correctedSql, failingDraft.sql);
    assert.equal(patch.correctionHistory[0].issues.length, 1);
    assert.equal(patch.correctionHistory[0].issues[0].code, 'V_COLUMN_NOT_ALLOWED');
  });

  it('preserves prior correctionHistory entries on subsequent attempts', async () => {
    const node = createCorrectionNode({ mode: 'mock', llm: makeFakeLlm({}) });
    const prior = {
      attempt: 1,
      issues: [],
      previousSql: 'SELECT 1',
      correctedSql: 'SELECT 1',
      mode: /** @type {const} */ ('mock'),
    };
    const patch = await node(
      baseState(schemaContext, { correctionAttempts: 1, correctionHistory: [prior] }),
    );
    assert.equal(patch.correctionHistory.length, 2);
    assert.deepEqual(patch.correctionHistory[0], prior);
  });

  it('correctionHistory does not contain credentials', async () => {
    const node = createCorrectionNode({ mode: 'mock', llm: makeFakeLlm({}) });
    const patch = await node(baseState(schemaContext));
    const serialized = JSON.stringify(patch.correctionHistory);
    assert.ok(!serialized.includes(tenant.credentials.password));
    assert.ok(!serialized.includes(tenant.credentials.user));
  });
});

describe('correction.node — llm mode', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  it('parses a well-formed corrected SqlDraft', async () => {
    const llm = makeFakeLlm({
      sql: 'SELECT `date` FROM `gross_summary` LIMIT 10',
      dialect: 'mysql',
      tables: ['gross_summary'],
      rationale: 'replaced phantom_col with date',
    });
    const node = createCorrectionNode({ mode: 'llm', llm });
    const patch = await node(baseState(schemaContext));
    assert.equal(patch.status, AGENT_STATUS.CORRECTING);
    assert.match(patch.sqlDraft.sql, /SELECT/);
    assert.equal(patch.sqlDraft.dialect, 'mysql');
    assert.match(patch.sqlDraft.rationale, /phantom_col/);
    assert.equal(patch.correctionAttempts, 1);
    assert.equal(patch.correctionHistory[0].mode, 'llm');
  });

  it('passes question, plan, failed SQL, V_* issues, and schema digest into the prompt', async () => {
    /** @type {Array<{role:string, content:string}> | null} */
    let captured = null;
    const llm = makeFakeLlm((messages) => {
      captured = messages;
      return {
        sql: 'SELECT `date` FROM `gross_summary` LIMIT 1',
        dialect: 'mysql',
        tables: ['gross_summary'],
      };
    });
    const node = createCorrectionNode({ mode: 'llm', llm });
    await node(baseState(schemaContext));

    assert.ok(captured && captured.length === 2, 'expected system + user messages');
    const [system, user] = captured;
    assert.equal(system.role, 'system');
    assert.equal(user.role, 'user');
    assert.match(user.content, /Question: gross sales by day/);
    assert.match(user.content, /FailedSQL/);
    assert.match(user.content, /phantom_col/);
    assert.match(user.content, /V_COLUMN_NOT_ALLOWED/);
    assert.match(user.content, /\bgross_summary\b/);
  });

  it('strips one trailing semicolon from the corrected SQL', async () => {
    const llm = makeFakeLlm({
      sql: 'SELECT `date` FROM `gross_summary` LIMIT 1;',
      dialect: 'mysql',
      tables: ['gross_summary'],
    });
    const node = createCorrectionNode({ mode: 'llm', llm });
    const patch = await node(baseState(schemaContext));
    assert.ok(!patch.sqlDraft.sql.endsWith(';'));
  });

  it('rejects empty SQL via assertSqlDraft (the prompt failure-mode path)', async () => {
    const llm = makeFakeLlm({
      sql: '',
      dialect: 'mysql',
      tables: [],
      rationale: 'cannot fix without missing schema',
    });
    const node = createCorrectionNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects a non-mysql dialect', async () => {
    const llm = makeFakeLlm({
      sql: 'SELECT 1',
      dialect: 'postgres',
      tables: ['gross_summary'],
    });
    const node = createCorrectionNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('wraps LLM transport errors in ContractError', async () => {
    const llm = {
      invokeJson: async () => {
        throw new Error('network blip');
      },
    };
    const node = createCorrectionNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });
});

describe('correction.node — pre-condition guards', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  const node = createCorrectionNode({ mode: 'mock', llm: makeFakeLlm({}) });

  it('rejects missing request', async () => {
    /** @type {any} */
    const state = { ...baseState(schemaContext), request: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects missing plan', async () => {
    /** @type {any} */
    const state = { ...baseState(schemaContext), plan: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects missing schemaContext', async () => {
    /** @type {any} */
    const state = { ...baseState(schemaContext), schemaContext: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects missing sqlDraft', async () => {
    /** @type {any} */
    const state = { ...baseState(schemaContext), sqlDraft: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects missing validation', async () => {
    /** @type {any} */
    const state = { ...baseState(schemaContext), validation: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects validation.valid === true (router should never have routed here)', async () => {
    const state = baseState(schemaContext, {
      validation: { valid: true, issues: [], normalizedSql: 'SELECT 1' },
    });
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects empty validation.issues', async () => {
    const state = baseState(schemaContext, {
      validation: { valid: false, issues: [] },
    });
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects plan.status === "needs_clarification"', async () => {
    const clarificationPlan = {
      ...readyPlan,
      status: /** @type {const} */ ('needs_clarification'),
      clarificationQuestion: 'how should X be defined?',
      targetTables: [],
    };
    const state = baseState(schemaContext, { plan: clarificationPlan });
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });
});

describe('graph routing — validationRouter', () => {
  it('routes valid validation → execute', async () => {
    const { validationRouter } = await import('../../../apps/api/src/orchestrator/graph.js');
    assert.equal(
      validationRouter({ validation: { valid: true }, correctionAttempts: 0 }),
      'execute',
    );
  });

  it('routes invalid validation with attempts remaining → correct', async () => {
    const { validationRouter } = await import('../../../apps/api/src/orchestrator/graph.js');
    assert.equal(
      validationRouter({ validation: { valid: false }, correctionAttempts: 0 }),
      'correct',
    );
    assert.equal(
      validationRouter({ validation: { valid: false }, correctionAttempts: 1 }),
      'correct',
    );
  });

  it('routes invalid validation with attempts exhausted → END', async () => {
    const { validationRouter } = await import('../../../apps/api/src/orchestrator/graph.js');
    const { END } = await import('@langchain/langgraph');
    // env.correction.maxAttempts default is 2 (mock test config).
    assert.equal(
      validationRouter({ validation: { valid: false }, correctionAttempts: 2 }),
      END,
    );
    assert.equal(
      validationRouter({ validation: { valid: false }, correctionAttempts: 99 }),
      END,
    );
  });

  it('treats missing correctionAttempts as 0 (allows correction on first failure)', async () => {
    const { validationRouter } = await import('../../../apps/api/src/orchestrator/graph.js');
    assert.equal(
      validationRouter({ validation: { valid: false } }),
      'correct',
    );
  });
});
