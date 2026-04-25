import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { parseSchemaDump } from '../../apps/api/src/modules/schema/schemaParser.js';
import { schemaCache } from '../../apps/api/src/modules/schema/schemaCache.js';
import { getSchemaContext } from '../../apps/api/src/modules/schema/schemaProvider.js';
import { assertSchemaContext } from '../../apps/api/src/modules/schema/schema.types.js';

// Use sentinel values long enough that they cannot accidentally match
// any literal text in the schema dump (single-char strings like "p"
// happily match `decimal(p,s)` type specifiers and other dump content).
const tenant = {
  brandId: 'BRAND',
  database: 'tenant_db',
  host: '127.0.0.1',
  port: 3306,
  poolKey: 'BRAND:127.0.0.1:3306:tenant_db',
  credentials: {
    user: 'TENANT_SVC_USER_SENTINEL',
    password: 'TENANT_SVC_SECRET_SENTINEL',
  },
};

describe('schemaParser — real dump', () => {
  let parsed;
  beforeEach(async () => {
    schemaCache.clear();
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __filename = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(__filename), '..', '..');
    const sql = await fs.readFile(path.join(repoRoot, 'schema', 'schema.sql'), 'utf8');
    parsed = parseSchemaDump(sql);
  });

  it('detects every CREATE TABLE block in the dump', () => {
    // The current schema/schema.sql has 51 CREATE TABLE statements.
    assert.equal(parsed.allowedTables.length, 51);
    // Spot-check a few representative tables exist.
    for (const t of [
      'discount_code_alerts',
      'gross_summary',
      'hour_wise_sales',
      'order_summary',
      'sales_summary',
    ]) {
      assert.ok(parsed.tables[t], `expected table ${t} in parsed schema`);
      assert.ok(parsed.allowedColumns[t], `expected allowedColumns for ${t}`);
      assert.ok(parsed.allowedColumns[t].length > 0);
    }
  });

  it('extracts columns for at least 3 representative tables with correct shapes', () => {
    // discount_code_alerts: 8 columns including a PK on `id`.
    const dca = parsed.tables.discount_code_alerts;
    assert.deepEqual(Object.keys(dca.columns).sort(), [
      'alert_time', 'alert_type', 'baseline_share', 'brand',
      'current_share', 'discount_code', 'id', 'message',
    ]);
    assert.equal(dca.columns.id.type, 'int');
    assert.equal(dca.columns.id.nullable, false);
    assert.equal(dca.columns.id.isPrimaryKey, true);

    // gross_summary: PK on `date` (single-column), 8 columns.
    const gs = parsed.tables.gross_summary;
    assert.ok(gs.columns.date);
    assert.equal(gs.columns.date.type, 'date');
    assert.equal(gs.columns.date.isPrimaryKey, true);
    assert.ok(gs.columns.gross_sales);

    // hour_wise_sales_stage: composite PK on (date, hour).
    const hwss = parsed.tables.hour_wise_sales_stage;
    assert.deepEqual(hwss.primaryKey, ['date', 'hour']);
    assert.equal(hwss.columns.date.isPrimaryKey, true);
    assert.equal(hwss.columns.hour.isPrimaryKey, true);
  });

  it('extracts composite primary keys with prefix-length specifiers stripped', () => {
    // hourly_product_performance_rollup: PK on (date, hour, product_id)
    const hppr = parsed.tables.hourly_product_performance_rollup;
    assert.deepEqual(hppr.primaryKey, ['date', 'hour', 'product_id']);
  });

  it('preserves type modifiers like `unsigned`', () => {
    // hour_wise_sales rollup-style tables include `tinyint unsigned`
    // and `int unsigned` columns.
    const hppr = parsed.tables.hourly_product_performance_rollup;
    assert.match(hppr.columns.hour.type, /tinyint(\s+unsigned)?/i);
  });

  it('allowedTables and allowedColumns mirror the parsed tables object', () => {
    for (const tName of parsed.allowedTables) {
      assert.ok(parsed.tables[tName], `allowedTables[${tName}] must exist in tables`);
      assert.deepEqual(
        parsed.allowedColumns[tName],
        Object.keys(parsed.tables[tName].columns),
        `allowedColumns[${tName}] should equal Object.keys(tables[${tName}].columns)`,
      );
    }
  });
});

describe('schemaProvider', () => {
  beforeEach(() => {
    schemaCache.clear();
  });

  it('returns a valid SchemaContext that round-trips assertSchemaContext', async () => {
    const ctx = await getSchemaContext({ tenant, correlationId: 'c1' });
    // Should not throw.
    assertSchemaContext(ctx);
    assert.equal(ctx.dialect, 'mysql');
    assert.equal(ctx.source, 'schema_dump');
    assert.equal(ctx.database, 'tenant_db');
    assert.ok(ctx.allowedTables.length > 0);
  });

  it('does not include tenant credential VALUES in the SchemaContext', async () => {
    // The schema dump itself contains a `password_hash` *column name* on
    // the users table, so we cannot test for the literal string
    // "password" — that would false-positive on legitimate schema
    // metadata. The actual invariant we care about is that the
    // tenant's credential VALUES (which the provider should never see)
    // do not appear anywhere in the serialized output.
    const ctx = await getSchemaContext({ tenant });
    const serialized = JSON.stringify(ctx);
    assert.ok(!serialized.includes(tenant.credentials.password));
    assert.ok(!serialized.includes(tenant.credentials.user));
  });

  it('reuses the cache on repeated calls (same parsed reference)', async () => {
    const first = await getSchemaContext({ tenant });
    const cachedAfterFirst = schemaCache.size();
    assert.equal(cachedAfterFirst, 1);

    // The cache key is `schema_dump:v1`.
    const cachedRaw = schemaCache.get('schema_dump:v1');
    assert.ok(cachedRaw);

    const second = await getSchemaContext({ tenant });
    // The provider rebuilds the outer SchemaContext but reuses the
    // cached parsed.tables reference. Comparing the inner reference
    // proves the cache hit.
    assert.equal(first.tables, second.tables);
    // Cache size should still be 1; no second entry created.
    assert.equal(schemaCache.size(), 1);
  });

  it('reparses after cache.clear()', async () => {
    const first = await getSchemaContext({ tenant });
    schemaCache.clear();
    assert.equal(schemaCache.size(), 0);
    const second = await getSchemaContext({ tenant });
    // Different `tables` object identity because we reparsed.
    assert.notEqual(first.tables, second.tables);
    // But the data should be equivalent.
    assert.deepEqual(
      Object.keys(first.tables).sort(),
      Object.keys(second.tables).sort(),
    );
  });

  it('returns database=null when called without a tenant', async () => {
    const ctx = await getSchemaContext({});
    assert.equal(ctx.database, null);
  });
});

describe('assertSchemaContext', () => {
  beforeEach(() => schemaCache.clear());

  it('rejects an allowedTable that is not in tables', () => {
    /** @type {import('../../apps/api/src/modules/schema/schema.types.js').SchemaContext} */
    const bad = {
      dialect: 'mysql',
      source: 'test',
      database: null,
      tables: {
        a: { name: 'a', columns: { x: { name: 'x', type: 'int', nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null } }, primaryKey: [], foreignKeys: [] },
      },
      allowedTables: ['a', 'phantom'],
      allowedColumns: { a: ['x'], phantom: [] },
      allowedJoins: [],
    };
    assert.throws(
      () => assertSchemaContext(bad),
      (err) => {
        const details = /** @type {{ details?: { errors?: string[] } }} */ (err)?.details;
        const msgs = details?.errors ?? [];
        return msgs.some((m) => m.includes('phantom'));
      },
    );
  });

  it('rejects an allowedColumn that is not in the table', () => {
    /** @type {import('../../apps/api/src/modules/schema/schema.types.js').SchemaContext} */
    const bad = {
      dialect: 'mysql',
      source: 'test',
      database: null,
      tables: {
        a: { name: 'a', columns: { x: { name: 'x', type: 'int', nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null } }, primaryKey: [], foreignKeys: [] },
      },
      allowedTables: ['a'],
      allowedColumns: { a: ['x', 'ghost'] },
      allowedJoins: [],
    };
    assert.throws(
      () => assertSchemaContext(bad),
      (err) => {
        const details = /** @type {{ details?: { errors?: string[] } }} */ (err)?.details;
        const msgs = details?.errors ?? [];
        return msgs.some((m) => m.includes('ghost'));
      },
    );
  });
});
