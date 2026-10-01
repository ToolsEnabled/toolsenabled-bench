import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// An independent newline-JSON client tests the real SDK wire transport.
test('stdio initialize/list and full recorded compose → freeze → export → run → analyze lifecycle', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'bench-mcp-wire-'));
  const guard = join(root, 'network-guard.mjs'), marker = join(root, 'network-attempt');
  await writeFile(guard, `import net from 'node:net'; import tls from 'node:tls'; import http from 'node:http'; import https from 'node:https'; import {writeFileSync} from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{writeFileSync(${JSON.stringify(marker)},'attempt');throw new Error('No network in the recorded MCP proof');}; net.Server.prototype.listen=deny; net.Socket.prototype.connect=deny; tls.connect=deny; http.request=deny; https.request=deny; globalThis.fetch=deny; syncBuiltinESMExports();`);
  const env = { ...process.env, BENCHMARK_DATA_DIR: root, NODE_OPTIONS: '--import=' + guard }; delete env.DISPLAY;
  const child = spawn(process.execPath, [resolve('server/mcp.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', seq = 0; const pending = new Map();
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(done => child.once('close', (code, signal) => {
    for (const { reject } of pending.values()) reject(new Error(`Server closed ${code}/${signal}: ${stderr}`));
    done({ code, signal });
  }));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try { const msg = JSON.parse(line); const request = pending.get(msg.id); if (request) { pending.delete(msg.id); msg.error ? request.reject(new Error(JSON.stringify(msg.error))) : request.resolve(msg.result); } }
    catch (e) { for (const req of pending.values()) req.reject(e); }
  });
  t.after(async () => { child.stdin.end(); child.kill('SIGTERM'); await closed; lines.close(); await rm(root, { recursive: true, force: true }); });
  const request = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const info = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench-independent-test', version: '1' } });
  assert.equal(info.serverInfo.version, JSON.parse(await readFile(resolve('package.json'), 'utf8')).version);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const { tools } = await request('tools/list', {}); assert.equal(tools.length, 12);
  const call = async (name, args = {}) => { const r = await request('tools/call', { name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
  let p = await call('composition.update');
  p = await call('atom.add', { projectId: p.id, revision: p.revision, atom: { id: 'extra', version: '1', kind: 'atom', role: 'node', text: 'Recorded context.' } });
  p = await call('composition.update', { projectId: p.id, revision: p.revision, taskId: 'addition-a', root: { use: 'task' } });
  const s = await call('study.freeze', { projectId: p.id, revision: p.revision });
  const exported = await call('study.export', { studyId: s.studyId }); assert.ok(exported.bytes > 0);
  const refused = await request('tools/call', { name: 'study.run', arguments: { studyId: s.studyId } }); assert.equal(refused.isError, true);
  await call('study.qualify', { studyId: s.studyId, confirm: s.studyId });
  await call('study.run', { studyId: s.studyId, confirm: s.studyId });
  await call('study.analyze', { studyId: s.studyId });
  const report = await call('report.get', { studyId: s.studyId, format: 'summary' }); assert.equal(report.data.completed, 2);
  assert.equal(stderr, '');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  child.stdin.end(); const exit = await closed; assert.equal(exit.code, 0);
});
