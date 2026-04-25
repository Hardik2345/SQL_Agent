/**
 * Process-level in-memory cache for parsed schema dumps.
 *
 * Phase 2A only ever stores one entry (`schema_dump:v1`), so this is a
 * thin wrapper around a Map. The wrapper exists so future sources
 * (information_schema lookups, semantic-layer projections) can drop in
 * without changing call sites — and so tests can reset state cleanly.
 */

/** @type {Map<string, unknown>} */
const store = new Map();

export const schemaCache = {
  /** @param {string} key */
  get(key) {
    return store.get(key);
  },
  /**
   * @param {string} key
   * @param {unknown} value
   */
  set(key, value) {
    store.set(key, value);
  },
  /** @param {string} key */
  has(key) {
    return store.has(key);
  },
  /** @param {string} key */
  delete(key) {
    return store.delete(key);
  },
  /** Reset the entire cache. Test-only helper. */
  clear() {
    store.clear();
  },
  /** Number of entries currently held — useful for tests. */
  size() {
    return store.size;
  },
};
