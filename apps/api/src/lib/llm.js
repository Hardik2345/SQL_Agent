import { env } from '../config/env.js';
import { getModelConfig } from '../config/models.js';
import { logger } from '../utils/logger.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * @param {ChatMessage[]} messages
 */
const toResponsesPayload = (messages) => {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim();

  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: [{ type: 'input_text', text: message.content }],
    }));

  return {
    instructions: instructions || undefined,
    input,
  };
};

/**
 * @param {any} payload
 * @returns {string}
 */
const extractOutputText = (payload) => {
  const chunks = [];
  for (const item of payload?.output ?? []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('').trim();
};

/**
 * LLM facade.
 *
 * `getLlm(role)` returns a thin client with a single method,
 * `invokeJson(messages)`. The client:
 *   - calls the OpenAI Responses API directly so the request path matches
 *     the models and response format we validate via manual curl checks,
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
 * @param {'planner'|'sql'|'correction'|'explanation'} role
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

      const requestBody = {
        model: config.model,
        temperature: config.temperature ?? 0,
        max_output_tokens: config.maxTokens,
        text: { format: { type: 'json_object' } },
        ...toResponsesPayload(messages),
      };

      const started = Date.now();
      const res = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.llm.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      const elapsedMs = Date.now() - started;

      const payload = /** @type {any} */ (
        await res.json().catch(async () => ({
          error: {
            message: await res.text().catch(() => 'Non-JSON HTTP response body'),
          },
        }))
      );

      if (!res.ok || payload?.error) {
        const message = payload?.error?.message ?? `OpenAI request failed with status ${res.status}`;
        logger.error(
          {
            event: 'llm.invoke.provider_error',
            role,
            model: config.model,
            status: res.status,
            providerError: payload?.error ?? payload,
          },
          'llm provider request failed',
        );
        throw new Error(`LLM provider error (role=${role}, model=${config.model}): ${message}`);
      }

      const content = extractOutputText(payload);

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
            model: config.model,
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
