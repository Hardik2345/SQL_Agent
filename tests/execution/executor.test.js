import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertExecutionInput } from '../../apps/api/src/modules/execution/execution.types.js';
import { ContractError } from '../../apps/api/src/utils/errors.js';

/**
 * These tests cover the contract-validation surface of the execution layer.
 * Live mysql2 connectivity is out of scope for unit tests — integration
 * coverage will be added once a tenant fixture database is provisioned.
 */

const validTenant = {
  brandId: 'brand_1',
  database: 'brand_1_db',
  host: '127.0.0.1',
  port: 3306,
  shardId: 'shard-1',
  poolKey: 'brand_1:127.0.0.1:3306:brand_1_db',
  credentials: { user: 'u', password: 'p' },
};

describe('executor input contract', () => {
  it('accepts a well-formed input', () => {
    const input = assertExecutionInput({
      tenant: validTenant,
      sql: 'SELECT 1',
    });
    assert.equal(input.tenant.poolKey, validTenant.poolKey);
    assert.equal(input.sql, 'SELECT 1');
  });

  it('rejects missing sql', () => {
    assert.throws(
      () => assertExecutionInput({ tenant: validTenant }),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects missing credentials', () => {
    const tenant = { ...validTenant, credentials: {} };
    assert.throws(
      () => assertExecutionInput({ tenant, sql: 'SELECT 1' }),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects invalid port', () => {
    const tenant = { ...validTenant, port: 0 };
    assert.throws(
      () => assertExecutionInput({ tenant, sql: 'SELECT 1' }),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects negative timeoutMs', () => {
    assert.throws(
      () =>
        assertExecutionInput({
          tenant: validTenant,
          sql: 'SELECT 1',
          timeoutMs: -1,
        }),
      (err) => err instanceof ContractError,
    );
  });
});
