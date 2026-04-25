import { createCipheriv } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decryptTenantPassword } from '../../apps/api/src/modules/tenant/passwordCrypto.js';

const encryptLikeDashboard = (password, key) => {
  let buf = Buffer.from(key);
  if (buf.length < 32) {
    const padded = Buffer.alloc(32);
    buf.copy(padded);
    buf = padded;
  } else if (buf.length > 32) {
    buf = buf.subarray(0, 32);
  }

  const iv = Buffer.from('1234567890abcdef');
  const cipher = createCipheriv('aes-256-cbc', buf, iv);
  let enc = cipher.update(password, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `${iv.toString('base64')}:${enc}`;
};

describe('decryptTenantPassword', () => {
  it('passes through plaintext passwords', () => {
    assert.deepEqual(decryptTenantPassword('plain-secret', ''), {
      password: 'plain-secret',
      encrypted: false,
    });
  });

  it('decrypts dashboard AES-256-CBC iv:ciphertext payloads', () => {
    const encrypted = encryptLikeDashboard('mysql-secret', 'short-key');
    assert.deepEqual(decryptTenantPassword(encrypted, 'short-key'), {
      password: 'mysql-secret',
      encrypted: true,
    });
  });

  it('requires PASSWORD_AES_KEY for encrypted payloads', () => {
    const encrypted = encryptLikeDashboard('mysql-secret', 'short-key');
    assert.throws(
      () => decryptTenantPassword(encrypted, ''),
      /PASSWORD_AES_KEY is required/,
    );
  });
});
