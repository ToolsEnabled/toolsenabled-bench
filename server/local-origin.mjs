// Local execution provenance is private metadata in the existing data store.
// Copying a study directory to another store does not copy execution authority.
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
export async function localOriginKey(root) {
  const path = join(root, '.local-origin-key');
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(randomBytes(32)); await file.sync(); }
    finally { await file.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 32)
    throw new Error('Invalid local provenance key.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { return await file.readFile(); } finally { await file.close(); }
}
export function signOrigin(key, record) {
  return createHmac('sha256', key).update(JSON.stringify([1, record.id, record.projectSha256])).digest('hex');
}
export function hasLocalOrigin(key, record) {
  return typeof record.localOrigin === 'string' && /^[a-f0-9]{64}$/.test(record.localOrigin)
    && timingSafeEqual(Buffer.from(record.localOrigin, 'hex'), Buffer.from(signOrigin(key, record), 'hex'));
}
