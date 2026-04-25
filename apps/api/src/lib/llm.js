import { env } from '../config/env.js';
import { getModelConfig } from '../config/models.js';
import { logger } from '../utils/logger.js';

/**
 * LLM facade.
 *
 * `getLlm(role)` returns a thin client with a single method,
 * `invokeJson(messages)`. The client:
 *   - lazily imports `@langchain/openai` so the dep is only loaded when
 *     an LLM call actually happens (tests that inject their own
 *     factory never pay this cost),
 *   - forces JSON-mode response so the planner / SQL generator get
 *     parseable output,
 *   - parses the response into a JS value, throwing a clear error if
 *     the model violates JSON mode.
 *
 * Intentional non-goals:
 *   - This module does NOT validate the parsed JSON against any
 *     contract. Each caller (planner, SQL generator) is responsible
 *     for asserting its own contract on top.
 *   - This module does NOT retry on transient failures. Add that at a
 *     higher layer when needed.
 *
 * @typedef {{ role: 'system'|'user'|'assistant', content: string }} ChatMessage
 *
 * @typedef {Object} LlmClient
 * @property {(messages: ChatMessage[]) => Promise<unknown>} invokeJson
 */

/**
 * @param {'planner'|'sql'|'correction'} role
 * @returns {LlmClient}
 */
export const getLlm = (role) => {
  const config = getModelConfig(role);

  return {
    /**
     * @param {ChatMessage[]} messages
     * @returns {Promise<unknown>}
     */
    invokeJson: async (messages) => {
      if (!env.llm.apiKey) {
        logger.error(
          { event: 'llm.invoke.no_key', role },
          'LLM invocation requested but OPENAI_API_KEY is not set',
        );
        throw new Error(
          `LLM unavailable: OPENAI_API_KEY is not configured (role=${role})`,
        );
      }

      // Lazy import — keeps test boot time low and avoids loading the
      // langchain stack when only mock mode is in use.
      const { ChatOpenAI } = await import('@langchain/openai');
      const chat = new ChatOpenAI({
        apiKey: env.llm.apiKey,
        model: config.model,
        temperature: config.temperature ?? 0,
        maxTokens: config.maxTokens,
        // Force OpenAI JSON mode so the model returns parseable JSON
        // instead of prose. The system/user prompt still has to ask
        // for JSON; this is belt-and-braces.
        modelKwargs: { response_format: { type: 'json_object' } },
      });

      const started = Date.now();
      const res = await chat.invoke(messages);
      const elapsedMs = Date.now() - started;

      const content =
        typeof res.content === 'string'
          ? res.content
          : JSON.stringify(res.content);

      logger.info(
        {
          event: 'llm.invoke.ok',
          role,
          model: config.model,
          elapsedMs,
          contentLength: content.length,
        },
        'llm invoked',
      );

      try {
        return JSON.parse(content);
      } catch (err) {
        logger.warn(
          {
            event: 'llm.invoke.bad_json',
            role,
            preview: content.slice(0, 200),
          },
          'llm returned non-JSON output despite JSON mode',
        );
        const wrapped = new Error(
          `LLM returned non-JSON content (role=${role}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        /** @type {any} */ (wrapped).cause = err;
        /** @type {any} */ (wrapped).rawContent = content;
        throw wrapped;
      }
    },
  };
};
