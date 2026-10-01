import { constants } from 'node:fs';
import { open, lstat, mkdir, readFile, readlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

const entries = new Set(['server/main.mjs', 'server/mcp.mjs']);
export class DataRootLeaseError extends Error {
  constructor(holder, detail = '') {
    const who = holder ? `pid ${holder.pid} (${holder.entryPoint})` : 'an unknown holder (unreadable or incomplete lease)';
    super(`Bench data root is leased by ${who}. Stop the other Bench process, or set a different BENCHMARK_DATA_DIR.${detail ? ' ' + detail : ''}`);
    this.code = 'BENCH_DATA_ROOT_LEASED';
  }
}
async function linuxIdentity(pid) {
  const [stat, bootId, pidNamespace] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
    readlink(`/proc/${pid}/ns/pid`),
  ]);
  // comm (field 2) can contain spaces and parentheses. starttime is field 22.
  const startTime = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  if (!/^\d+$/.test(startTime)) throw new Error('Unrecognized process identity.');
  return { startTime, bootId: bootId.trim(), pidNamespace };
}

// Unknown, inaccessible, foreign-host and foreign-PID-namespace holders are
// never stolen. Without Linux identity, only ESRCH proves a PID is absent.
export async function holderIsGone(holder, local, { kill = process.kill, identify = linuxIdentity } = {}) {
  if (holder.hostname !== local.hostname || holder.platform !== local.platform) return false;
  if (holder.identity && !local.identity) return false;
  if (holder.identity && local.identity) {
    if (holder.identity.bootId !== local.identity.bootId) return true;
    if (holder.identity.pidNamespace !== local.identity.pidNamespace) return false;
  }
  try { kill(holder.pid, 0); }
  catch (error) { return error.code === 'ESRCH'; }
  if (local.platform === 'linux' && holder.identity && local.identity) {
    try {
      const current = await identify(holder.pid);
      return current.bootId !== holder.identity.bootId || current.startTime !== holder.identity.startTime;
    } catch { return false; }
  }
  return false;
}
function valid(record) {
  return record?.version === 1 && Number.isSafeInteger(record.pid) && record.pid > 0 &&
    entries.has(record.entryPoint) && typeof record.nonce === 'string' && /^[a-f0-9-]{36}$/.test(record.nonce) &&
    typeof record.hostname === 'string' && typeof record.platform === 'string' &&
    (record.identity === null || (record.platform === 'linux' &&
      /^\d+$/.test(record.identity?.startTime) && typeof record.identity?.bootId === 'string' &&
      typeof record.identity?.pidNamespace === 'string'));
}
async function inspect(path) {
  let file;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) throw new DataRootLeaseError();
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await file.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new DataRootLeaseError();
    const record = JSON.parse(await file.readFile('utf8'));
    if (!valid(record)) throw new DataRootLeaseError();
    return { record, stat };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new DataRootLeaseError();
  } finally { await file?.close(); }
}
async function createExclusive(path, record) {
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  const stat = await file.stat();
  try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); }
  catch (error) { await unlink(path); throw error; }
  finally { await file.close(); }
  let releasing;
  return { release() {
    return releasing ??= (async () => {
      const current = await inspect(path);
      if (current?.stat.dev === stat.dev && current.stat.ino === stat.ino && current.record.nonce === record.nonce)
        await unlink(path);
    })();
  } };
}

export async function acquireDataRootLease(root, entryPoint) {
  if (!entries.has(entryPoint)) throw new Error('Unrecognized Bench entry point.');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const local = { version: 1, pid: process.pid, entryPoint, nonce: randomUUID(),
    hostname: hostname(), platform: process.platform,
    identity: process.platform === 'linux' ? await linuxIdentity(process.pid).catch(() => null) : null };
  const path = join(root, '.bench-data-lease'), recoveryPath = path + '.recovery';
  const fresh = await createExclusive(path, local);
  if (fresh) return fresh;
  const observed = await inspect(path);
  if (observed && !await holderIsGone(observed.record, local)) throw new DataRootLeaseError(observed.record);

  // Serializing only stale removal is essential: two contenders must not both
  // unlink an old path, allowing the second to unlink the first's NEW lease.
  // An abandoned recovery guard fails closed; it is never automatically stolen.
  const recovery = await createExclusive(recoveryPath, local);
  if (!recovery) throw new DataRootLeaseError((await inspect(recoveryPath))?.record,
    'Lease recovery is already in progress; see docs/MCP.md for interrupted recovery.');
  try {
    // Re-read under the guard. Never reuse the pre-guard observation.
    const current = await inspect(path);
    if (current) {
      if (!await holderIsGone(current.record, local)) throw new DataRootLeaseError(current.record);
      await unlink(path);
    }
    // A normal exclusive creator may win this gap. Do not unlink or retry it.
    const acquired = await createExclusive(path, local);
    if (acquired) return acquired;
    throw new DataRootLeaseError((await inspect(path))?.record);
  } finally { await recovery.release(); }
}
