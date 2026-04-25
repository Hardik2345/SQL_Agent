import { env } from './env.js';

/**
 * Registry of LLM model configurations. Kept separate from env so that
 * different nodes (planner vs sql generator) can point at different models.
 */
export const models = Object.freeze({
  planner: Object.freeze({
    provider: 'openai',
    model: env.llm.model,
    temperature: 0,
    maxTokens: 1024,
  }),
  sql: Object.freeze({
    provider: 'openai',
    model: env.llm.model,
    // SQL generation must be deterministic — temperature 0 is non-
    // negotiable here. With higher temps the same plan can produce
    // different SELECTs across requests, which makes correction-loop
    // debugging miserable later.
    temperature: 0,
    // SELECT statements can be longer than plans (subselects, many
    // dimensions, GROUP BY clauses), so give SQL a slightly wider
    // budget than the planner.
    maxTokens: 2048,
  }),
  correction: Object.freeze({
    provider: 'openai',
    model: env.llm.model,
    temperature: 0,
    maxTokens: 1024,
  }),
});

/**
 * @param {keyof typeof models} role
 */
export const getModelConfig = (role) => {
  const config = models[role];
  if (!config) {
    throw new Error(`Unknown model role: ${role}`);
  }
  return config;
};
