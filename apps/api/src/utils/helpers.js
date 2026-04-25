import { randomUUID } from 'node:crypto';

/** Generate a UUID v4 correlation id. */
export const newCorrelationId = () => randomUUID();

/** Shallow-freeze a plain object. */
export const freeze = (obj) => Object.freeze(obj);

/** Race a promise against a timeout; rejects with a TimeoutError. */
export const withTimeout = (promise, ms, onTimeout) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new Error(`Operation timed out after ${ms}ms`));
      }
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

/** Measure elapsed ms for an async function. */
export const timed = async (fn) => {
  const start = process.hrtime.bigint();
  const result = await fn();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return { result, elapsedMs };
};

/** Coerce an unknown value into a plain object or null. */
export const asPlainObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;

/** Type guard for non-empty strings. */
export const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

/** Extract only the allowed keys from an object. */
export const pick = (obj, keys) => {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key];
  }
  return out;
};
