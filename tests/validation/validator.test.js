import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validate } from '../../apps/api/src/modules/validation/validator.js';
import { VALIDATION_CODES } from '../../apps/api/src/utils/constants.js';

/**
 * Build a minimal SchemaContext for a fixture set of tables/columns.
 * Defined here to avoid pulling in the schema-dump parser in unit
 * tests that only care about the validator's behaviour.
 *
 * @param {Record<string, Array<{name: string, type: string, nullable?: boolean}>>} tables
 * @returns {import('../../apps/api/src/modules/schema/schema.types.js').SchemaContext}
 */
const makeSchema = (tables) => {
  /** @type {Record<string, any>} */
  const t = {};
  /** @type {string[]} */
  const allowedTables = [];
  /** @type {Record<string, string[]>} */
  const allowedColumns = {};
  for (const [name, cols] of Object.entries(tables)) {
    allowedTables.push(name);
    allowedColumns[name] = cols.map((c) => c.name);
    /** @type {Record<string, any>} */
    const colMap = {};
    for (const c of cols) {
      colMap[c.name] = {
        name: c.name,
        type: c.type,
        nullable: c.nullable ?? null,
        defaultValue: null,
        isPrimaryKey: false,
        isForeignKey: false,
        references: null,
      };
    }
    t[name] = { name, columns: colMap, primaryKey: [], foreignKeys: [] };
  }
  return /** @type {import('../../apps/api/src/modules/schema/schema.types.js').SchemaContext} */ ({
    dialect: 'mysql',
    source: 'test_fixture',
    database: 'brand_1',
    tables: t,
    allowedTables,
    allowedColumns,
    allowedJoins: [],
  });
};

const schema = makeSchema({
  orders: [
    { name: 'id', type: 'bigint' },
    { name: 'created_at', type: 'datetime' },
    { name: 'status', type: 'varchar' },
  ],
  customers: [
    { name: 'id', type: 'bigint' },
    { name: 'email', type: 'varchar' },
  ],
});

const codes = (result) => result.issues.filter((i) => i.severity === 'error').map((i) => i.code);

describe('validator', () => {
  it('accepts a simple single SELECT', () => {
    const result = validate({
      sql: 'SELECT id, created_at FROM orders WHERE status = "paid" LIMIT 10',
      schema,
    });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
    assert.ok(result.normalizedSql, 'should produce normalized SQL');
  });

  it('rejects empty SQL', () => {
    const result = validate({ sql: ' ', schema });
    assert.equal(result.valid, false);
    assert.deepEqual(codes(result), [VALIDATION_CODES.EMPTY_SQL]);
  });

  it('rejects parse failures', () => {
    const result = validate({ sql: 'SELECT FROM WHERE', schema });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.PARSE_FAILED));
  });

  it('rejects multiple statements', () => {
    const result = validate({
      sql: 'SELECT id FROM orders; SELECT id FROM customers',
      schema,
    });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.MULTIPLE_STATEMENTS));
  });

  it('rejects non-SELECT statements', () => {
    const result = validate({
      sql: 'UPDATE orders SET status = "x" WHERE id = 1',
      schema,
    });
    assert.equal(result.valid, false);
    const errorCodes = codes(result);
    assert.ok(
      errorCodes.includes(VALIDATION_CODES.NOT_SELECT) ||
        errorCodes.includes(VALIDATION_CODES.DML_FORBIDDEN),
    );
  });

  it('rejects DDL statements', () => {
    const result = validate({ sql: 'DROP TABLE orders', schema });
    assert.equal(result.valid, false);
    const errorCodes = codes(result);
    assert.ok(
      errorCodes.includes(VALIDATION_CODES.DDL_FORBIDDEN) ||
        errorCodes.includes(VALIDATION_CODES.NOT_SELECT),
    );
  });

  it('rejects cross-database references', () => {
    const result = validate({
      sql: 'SELECT id FROM other_db.orders LIMIT 10',
      schema,
    });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.CROSS_DATABASE));
  });

  it('rejects tables not in schema context', () => {
    const result = validate({
      sql: 'SELECT id FROM invoices LIMIT 10',
      schema,
    });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.TABLE_NOT_ALLOWED));
  });

  it('rejects columns not in schema context', () => {
    const result = validate({
      sql: 'SELECT orders.total_profit FROM orders LIMIT 10',
      schema,
    });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.COLUMN_NOT_ALLOWED));
  });

  it('rejects unqualified spaced identifiers not present in any allowed table', () => {
    // Regression: LLM hallucinated `product id` (with a space) instead of
    // `product_id`. Previously this bypassed validation and only failed at
    // DB execution with E_EXECUTION / ER_BAD_FIELD_ERROR.
    const result = validate({
      sql: 'SELECT `date` FROM orders WHERE `product id` = "8547284648132" LIMIT 1',
      schema,
    });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.COLUMN_NOT_ALLOWED));
  });

  it('rejects unqualified columns not present in referenced tables', () => {
    // Regression: `session_id` may exist in other warehouse tables, but if the
    // SQL references only `orders` and `orders` has no `session_id`, validation
    // must fail before execution.
    const result = validate({
      sql: 'SELECT id, session_id FROM orders LIMIT 10',
      schema,
    });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.COLUMN_NOT_ALLOWED));
  });

  it('flags GROUP BY violations', () => {
    const result = validate({
      sql: 'SELECT status, id FROM orders GROUP BY status LIMIT 10',
      schema,
    });
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(VALIDATION_CODES.GROUP_BY_INVALID));
  });

  it('accepts valid aggregate + GROUP BY', () => {
    const result = validate({
      sql: 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status LIMIT 10',
      schema,
    });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
  });

  it('accepts ORDER BY using a select alias', () => {
    const result = validate({
      sql: 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY n DESC LIMIT 10',
      schema,
    });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
  });

  it('accepts ORDER BY using a select alias inside a derived table', () => {
    const result = validate({
      sql: [
        'SELECT ranked.status, ranked.n',
        'FROM (',
        '  SELECT status, COUNT(*) AS n',
        '  FROM orders',
        '  GROUP BY status',
        '  ORDER BY n DESC',
        '  LIMIT 5',
        ') ranked',
        'ORDER BY ranked.n DESC',
      ].join(' '),
      schema,
    });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
  });
});
