import { createDecipheriv } from 'node:crypto';

/**
 * @param {string} key
 */
const normalizeAesKey = (key) => {
  let buf = Buffer.from(key);
  if (buf.length < 32) {
    const padded = Buffer.alloc(32);
    buf.copy(padded);
    buf = padded;
  } else if (buf.length > 32) {
    buf = buf.subarray(0, 32);
  }
  return buf;
};

/**
 * Tenant-router can return either an already-plaintext password or an
 * encrypted payload shaped as `base64(iv):base64(ciphertext)`. This mirrors
 * the dashboard AES-256-CBC decrypt behavior while preserving plaintext
 * compatibility for older/local tenant-router payloads.
 *
 * @param {string} value
 * @param {string} aesKey
 * @returns {{ password: string, encrypted: boolean }}
 */
export const decryptTenantPassword = (value, aesKey) => {
  if (!value) return { password: '', encrypted: false };

  const parts = value.split(':');
  if (parts.length !== 2) return { password: value, encrypted: false };

  if (!aesKey) {
    throw new Error('PASSWORD_AES_KEY is required to decrypt tenant password');
  }

  const key = normalizeAesKey(aesKey);
  const iv = Buffer.from(parts[0], 'base64');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);

  let password = decipher.update(parts[1], 'base64', 'utf8');
  password += decipher.final('utf8');

  return { password, encrypted: true };
};

export const __test = { normalizeAesKey };
