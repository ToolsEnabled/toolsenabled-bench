import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

// Resolve the runtime from cwd so this same independent test exercises the ZIP.
const runtime = name => import(pathToFileURL(resolve(name)).href);
const leasePath = root => join(root, '.bench-data-lease');
const childrenByRoot = new Map();
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'bench-root-lease-'));
  childrenByRoot.set(root, []);
  t.after(async () => {
    await Promise.all(childrenByRoot.get(root).map(child => child.stop()));
    childrenByRoot.delete(root); await rm(root, { recursive: true, force: true });
  });
  return root;
}
function launch(t, root, entry, extraEnv = {}) {
  const env = { ...process.env, BENCHMARK_DATA_DIR: root, BENCHMARK_PORT: '0', ...extraEnv }; delete env.DISPLAY;
  const child = spawn(process.execPath, [resolve(`server/${entry}.mjs`)], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let stderr = '', stdout = '', next = 0, origin, readyResolve;
  const pending = new Map(), ready = new Promise(done => { readyResolve = done; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => { stdout += chunk; });
  const closed = new Promise(done => child.once('close', (code, signal) => {
    for (const p of pending.values()) p.reject(new Error(`closed: ${stderr}`));
    pending.clear(); readyResolve(false); done({ code, signal, stderr, stdout });
  }));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (entry === 'main') { if (/^http:\/\/127\.0\.0\.1:\d+$/.test(line)) { origin = line; readyResolve(true); } return; }
    const msg = JSON.parse(line), p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  if (entry === 'mcp') request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lease-test', version: '1' } }).then(() => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); readyResolve(true);
  }, () => readyResolve(false));
  async function stop(signal = 'SIGTERM') {
    if (child.exitCode === null && child.signalCode === null) signal === 'EOF' ? child.stdin.end() : child.kill(signal);
    return closed;
  }
  t.after(async () => { await stop(); lines.close(); });
  childrenByRoot.get(root).push({ stop });
  return { child, ready, closed, stop, request, get origin() { return origin; },
    async call(name, args = {}) { const r = await request('tools/call', { name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); },
    async runs() {
      const html = await (await fetch(origin)).text(), token = html.match(/name="bench-token" content="([a-f0-9]+)"/)[1];
      return (await fetch(origin + '/api/runs', { headers: { 'x-benchmark-token': token } })).json();
    },
  };
}
async function refusal(contender, owner, entry) {
  assert.equal(await contender.ready, false, 'second process must refuse before serving');
  const result = await contender.closed;
  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(`pid ${owner.child.pid}\\b`));
  assert.ok(result.stderr.includes(`server/${entry}.mjs`), result.stderr);
  assert.match(result.stderr, /stop the other/i);
  assert.match(result.stderr, /different BENCHMARK_DATA_DIR/);
  assert.equal(result.stdout, '', 'refusal must not emit protocol or startup output');
}
for (const [first, second] of [['main', 'mcp'], ['mcp', 'main'], ['mcp', 'mcp']]) {
  test(`${first} holder refuses ${second} on the same root, permits a different root`, { timeout: 15000 }, async t => {
    const root = await scratch(t), other = await scratch(t), owner = launch(t, root, first);
    assert.equal(await owner.ready, true);
    const contender = launch(t, root, second);
    await refusal(contender, owner, first);
    const bytes = await readFile(leasePath(root));
    const record = JSON.parse(bytes); assert.equal(record.pid, owner.child.pid); assert.equal(record.entryPoint, `server/${first}.mjs`);
    if (process.platform === 'linux') assert.match(record.identity.startTime, /^\d+$/);
    const independent = launch(t, other, second); assert.equal(await independent.ready, true);
    assert.deepEqual(await readFile(leasePath(root)), bytes, 'live lease was not changed');
    await owner.stop(); await assert.rejects(readFile(leasePath(root)), { code: 'ENOENT' });
    const replacement = launch(t, root, second); assert.equal(await replacement.ready, true);
  });
}
for (const pair of [['main', 'mcp'], ['mcp', 'mcp']]) {
  test(`${pair.join(' + ')} simultaneous startup admits exactly one process`, { timeout: 20000 }, async t => {
    for (let i = 0; i < 4; i++) {
      const root = await scratch(t), children = pair.map(entry => launch(t, root, entry));
      const states = await Promise.all(children.map(p => p.ready)); assert.equal(states.filter(Boolean).length, 1);
      const loser = children[states.indexOf(false)]; assert.equal((await loser.closed).code, 1);
      await children[states.indexOf(true)].stop();
    }
  });
}
test('a killed holder is recovered, and simultaneous stale recovery never steals the winner', { timeout: 20000 }, async t => {
  for (let i = 0; i < 4; i++) {
    const root = await scratch(t), owner = launch(t, root, 'mcp'); assert.equal(await owner.ready, true);
    const old = await readFile(leasePath(root)); await owner.stop('SIGKILL'); assert.deepEqual(await readFile(leasePath(root)), old);
    const children = ['main', 'mcp'].map(entry => launch(t, root, entry));
    const states = await Promise.all(children.map(p => p.ready)); assert.equal(states.filter(Boolean).length, 1);
    const winner = children[states.indexOf(true)], before = await readFile(leasePath(root));
    const late = launch(t, root, 'mcp'); await refusal(late, winner, states[0] ? 'main' : 'mcp');
    assert.deepEqual(await readFile(leasePath(root)), before);
    await winner.stop();
  }
});
for (const [entry, signal] of [['main', 'SIGINT'], ['main', 'SIGTERM'], ['mcp', 'SIGINT'], ['mcp', 'SIGTERM'], ['mcp', 'EOF']]) {
  test(`${entry} releases the lease on ${signal}`, { timeout: 10000 }, async t => {
    const root = await scratch(t), owner = launch(t, root, entry); assert.equal(await owner.ready, true);
    await readFile(leasePath(root)); assert.equal((await owner.stop(signal)).code, 0);
    await assert.rejects(readFile(leasePath(root)), { code: 'ENOENT' });
  });
}
test('a second process cannot inspect/resume an active run as interrupted; shutdown settles before handover', { timeout: 20000 }, async t => {
  const root = await scratch(t), owner = launch(t, root, 'mcp'); assert.equal(await owner.ready, true);
  const { genericStarter, newExperimentDraft } = await runtime('src/benchmark/starters.mjs');
  const { sha256 } = await runtime('src/benchmark/prompts.mjs');
  const spec = newExperimentDraft(genericStarter(), { purpose: 'apparatus-development', initializePopulation: true });
  const collector = `import {writeFileSync} from 'node:fs'; process.stdin.resume(); writeFileSync('ready.json', JSON.stringify({pid:process.pid})); setTimeout(()=>process.stdout.write(JSON.stringify({output:'5'})),30000);`;
  spec.inputs = [{ path: 'slow.mjs', sha256: await sha256(collector) }];
  spec.conditions[0].adapter = { kind: 'command', command: process.execPath, args: ['slow.mjs'] };
  const p = await owner.call('composition.update', { draft: { spec, attachments: { 'slow.mjs': collector } } });
  const s = await owner.call('study.freeze', { projectId: p.id, revision: p.revision });
  const running = owner.request('tools/call', { name: 'study.run', arguments: { studyId: s.studyId, confirm: s.studyId } }).catch(() => null);
  let pid;
  for (let i = 0; i < 500 && !pid; i++) {
    try { pid = JSON.parse(await readFile(join(root, 'runs', s.studyId, 'project/ready.json'))).pid; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!pid) await delay(10);
  }
  assert.ok(pid, 'actual collector started');
  const record = () => readFile(join(root, 'runs', s.studyId, 'run.json'), 'utf8').then(JSON.parse);
  assert.equal((await record()).status, 'running');
  const contender = launch(t, root, 'main'); await refusal(contender, owner, 'mcp');
  assert.equal((await record()).status, 'running'); process.kill(pid, 0);
  await owner.stop(); await running;
  assert.equal((await record()).status, 'cancelled'); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const next = launch(t, root, 'main'); assert.equal(await next.ready, true);
  assert.equal((await next.runs()).find(r => r.id === s.studyId).status, 'cancelled');
});
test('malformed leases fail closed without altering the file', { timeout: 10000 }, async t => {
  const root = await scratch(t); await writeFile(leasePath(root), '{');
  const contender = launch(t, root, 'mcp'); assert.equal(await contender.ready, false);
  assert.match((await contender.closed).stderr, /BENCHMARK_DATA_DIR/);
  assert.equal(await readFile(leasePath(root), 'utf8'), '{');
});
test('Linux identity distinguishes PID reuse; the fallback reclaims only ESRCH', async () => {
  const { holderIsGone } = await runtime('server/data-root-lease.mjs');
  const identity = { startTime: '123', bootId: 'boot', pidNamespace: 'pid:[1]' };
  const holder = { pid: 1234, hostname: 'host', platform: 'linux', identity };
  const local = { hostname: 'host', platform: 'linux', identity };
  const alive = () => {}, absent = () => { throw Object.assign(new Error(), { code: 'ESRCH' }); };
  const denied = () => { throw Object.assign(new Error(), { code: 'EPERM' }); };
  const check = (h, l, kill, identify = async () => identity) => holderIsGone(h, l, { kill, identify });
  assert.equal(await check(holder, local, alive), false);
  assert.equal(await check(holder, local, alive, async () => ({ ...identity, startTime: '124' })), true);
  assert.equal(await check(holder, local, absent), true);
  assert.equal(await check(holder, local, denied, async () => { throw new Error(); }), false);
  assert.equal(await check(holder, { ...local, identity: null }, absent), false);
  assert.equal(await check(holder, { ...local, identity: { ...identity, pidNamespace: 'pid:[2]' } }, absent), false);
  assert.equal(await check({ ...holder, hostname: 'elsewhere' }, local, absent), false);
  const portable = { ...holder, platform: 'darwin', identity: null };
  assert.equal(await check(portable, portable, alive), false);
  assert.equal(await check(portable, portable, denied), false);
  assert.equal(await check(portable, portable, absent), true);
});
test('PID reuse fixture recovers by Linux start time while that unrelated PID is live', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const root = await scratch(t), owner = launch(t, root, 'mcp'); assert.equal(await owner.ready, true);
  const record = JSON.parse(await readFile(leasePath(root))); await owner.stop('SIGKILL');
  // Simulate PID reuse without depending on the OS recycling a specific PID.
  record.pid = process.pid; record.identity.startTime = '0'; await writeFile(leasePath(root), JSON.stringify(record));
  const replacement = launch(t, root, 'main'); assert.equal(await replacement.ready, true); process.kill(process.pid, 0);
});
test('an abandoned recovery guard refuses stale removal instead of stealing it', { timeout: 10000 }, async t => {
  const root = await scratch(t), owner = launch(t, root, 'mcp'); assert.equal(await owner.ready, true);
  const bytes = await readFile(leasePath(root)); await owner.stop('SIGKILL');
  await writeFile(leasePath(root) + '.recovery', bytes);
  const contender = launch(t, root, 'main'); await refusal(contender, owner, 'mcp');
  assert.deepEqual(await readFile(leasePath(root)), bytes);
  assert.deepEqual(await readFile(leasePath(root) + '.recovery'), bytes);
});
for (const entry of ['main', 'mcp']) {
  test(`${entry} cleans up a signal received during lease initialization`, { timeout: 10000 }, async t => {
    const root = await scratch(t), guard = join(root, 'slow-init.mjs'), marker = join(root, 'initializing');
    await writeFile(guard, `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.open; fs.open=async(...args)=>{const file=await original(...args); if(String(args[0]).endsWith('.bench-data-lease') && args[1]==='wx'){const write=file.writeFile.bind(file); file.writeFile=async(...values)=>{await fs.writeFile(${JSON.stringify(marker)},'ready');await new Promise(done=>setTimeout(done,400));return write(...values);};}return file;};syncBuiltinESMExports();`);
    const child = launch(t, root, entry, { NODE_OPTIONS: '--import=' + guard });
    let initializing = false;
    for (let i = 0; i < 300 && !initializing; i++) {
      try { await readFile(marker); initializing = true; } catch (e) { if (e.code !== 'ENOENT') throw e; await delay(10); }
    }
    assert.ok(initializing); assert.equal((await child.stop('SIGTERM')).code, 0);
    await assert.rejects(readFile(leasePath(root)), { code: 'ENOENT' });
  });
  test(`${entry} startup failure releases its acquired lease`, { timeout: 10000 }, async t => {
    const root = await scratch(t); await writeFile(join(root, 'projects'), 'not a directory');
    const child = launch(t, root, entry); assert.equal(await child.ready, false); assert.equal((await child.closed).code, 1);
    await assert.rejects(readFile(leasePath(root)), { code: 'ENOENT' });
    await rm(join(root, 'projects')); const retry = launch(t, root, entry); assert.equal(await retry.ready, true);
  });
}
test('web shutdown retains ownership through an admitted HTTP write and releases only after draining', { timeout: 10000 }, async t => {
  const root = await scratch(t), { startServer } = await runtime('server/main.mjs');
  const app = await startServer({ dataDir: root, port: 0 });
  let unblock, entered;
  const gate = new Promise(done => { unblock = done; }), started = new Promise(done => { entered = done; });
  t.after(async () => { unblock(); await app.close(); });
  const create = app.projects.create.bind(app.projects);
  app.projects.create = async (...args) => { entered(); await gate; return create(...args); };
  const request = fetch(app.origin + '/api/projects', { method: 'POST', headers: { 'x-benchmark-token': app.token }, body: JSON.stringify({ title: 'Drained write' }) });
  await started; const closing = app.close();
  try {
    const contender = launch(t, root, 'mcp'); await refusal(contender, { child: { pid: process.pid } }, 'main');
  } finally { unblock(); }
  assert.equal((await request).status, 201); await closing;
  await assert.rejects(readFile(leasePath(root)), { code: 'ENOENT' });
  const next = launch(t, root, 'mcp'); assert.equal(await next.ready, true);
  assert.equal((await next.call('projects.list')).total, 1);
});
for (const kind of ['symlink', 'hardlink']) {
  test(`${kind} lease is refused without modifying its target`, { timeout: 10000 }, async t => {
    const root = await scratch(t), other = await scratch(t), file = join(other, 'sentinel'); await writeFile(file, 'unchanged');
    await (kind === 'symlink' ? symlink : link)(file, leasePath(root));
    const child = launch(t, root, 'mcp'); assert.equal(await child.ready, false); assert.equal((await child.closed).code, 1);
    assert.equal(await readFile(file, 'utf8'), 'unchanged');
  });
}
