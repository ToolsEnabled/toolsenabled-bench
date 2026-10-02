import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, access, cp, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { acquireDataRootLease } from '../server/data-root-lease.mjs';

const root = resolve(import.meta.dirname, '..');
const entry = join(root, 'server/mcp-plugin.mjs');
function workflowContract(instructions, skill, tools) {
  assert.match(instructions, /Run and qualify execute declared code/);
  assert.match(instructions, /confirm must name the studyId/);
  assert.match(instructions, /foreign studies also need explicit trust/);
  assert.doesNotMatch(instructions, /web_preview|human-only export|read.*launch.link/i);
  assert.match(skill, /study\.qualify.*study\.run.*execute declared runtime/);
  assert.match(skill, /Set `confirm` to the exact studyId/);
  assert.match(skill, /Foreign studies also require reviewed `trust:true`/);
  assert.match(skill, /`study\.export` writes a runnable ZIP/);
  for (const tool of tools) assert.ok(skill.includes('`' + tool.name + '`'), tool.name);
  assert.equal(tools.some(tool => /reissue|human.pause|human.undo/.test(tool.name)), false);
}
function start(args, env, cwd) {
  const child = spawn(process.execPath, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })); });
  return { child, closed };
}

test('plugin entry refuses missing, relative, overlapping and linked install state without writing', { timeout: 20000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'bench-plugin-refuse-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const link = join(temp, 'linked installation'); await symlink(root, link, 'dir');
  const forbidden = join(root, '.plugin-state-must-not-exist');
  for (const value of [undefined, '', 'relative-state', '~/folder', '~', 'C:folder', root, forbidden, dirname(root), join(link, 'state')]) {
    const env = { ...process.env }; delete env.BENCHMARK_DATA_DIR;
    if (value !== undefined) env.BENCHMARK_DATA_DIR = value;
    const { child, closed } = start([entry], env, temp); child.stdin.end();
    const result = await closed;
    assert.equal(result.code, 1); assert.equal(result.signal, null); assert.equal(result.stdout, '');
    assert.match(result.stderr, /absolute BENCHMARK_DATA_DIR outside its installation/);
  }
  await assert.rejects(access(forbidden), { code: 'ENOENT' });
});

test('dashboard in a plugin installation refuses unsafe state before creating any files', { timeout: 20000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'bench-dashboard-state-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const install = join(temp, 'plugin');
  await mkdir(install); await cp(join(root, 'server'), join(install, 'server'), { recursive: true });
  await cp(join(root, 'src'), join(install, 'src'), { recursive: true });
  await copyFile(join(root, 'package.json'), join(install, 'package.json'));
  await cp(join(root, '.claude-plugin'), join(install, '.claude-plugin'), { recursive: true });
  for (const value of [undefined, 'relative', join(install, 'state'), temp]) {
    const env = { BENCHMARK_PORT: '0' }; if (value !== undefined) env.BENCHMARK_DATA_DIR = value;
    const { child, closed } = start([join(install, 'server/main.mjs')], env, temp);
    const timeout = setTimeout(() => child.kill('SIGTERM'), 1800);
    child.stdout.once('data', () => child.kill('SIGTERM')); child.stdin.end();
    const result = await closed; clearTimeout(timeout);
    assert.equal(result.code, 1, JSON.stringify(result));
    assert.match(result.stderr, /absolute BENCHMARK_DATA_DIR outside its installation/);
  }
  for (const path of [join(install, '.benchmark-data'), join(install, 'state'), join(temp, 'relative'), join(temp, '.bench-data-lease')])
    await assert.rejects(access(path), { code: 'ENOENT' });
});

test('Claude manifest substitution launches directly with spaced paths and preserves external state across restarts', { timeout: 30000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'bench plugin paths '));
  const install = join(temp, 'installed plugin'); await symlink(root, install, 'dir');
  const state = join(temp, 'private state', 'new folder');
  t.after(() => rm(temp, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.userConfig.data_directory.required, true);
  const config = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8')).mcpServers.bench;
  assert.equal(config.command, 'node');
  const replace = value => value.replaceAll('${CLAUDE_PLUGIN_ROOT}', install).replaceAll('${user_config.data_directory}', state);
  let id;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { child, closed } = start(config.args.map(replace), { ...process.env, ...Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, replace(value)])) }, temp);
    t.after(() => child.kill('SIGTERM'));
    const lines = createInterface({ input: child.stdout }), pending = new Map(); let seq = 0;
    lines.on('line', line => { const result = JSON.parse(line); const done = pending.get(result.id); if (done) { pending.delete(result.id); result.error ? done.reject(new Error(JSON.stringify(result.error))) : done.resolve(result.result); } });
    closed.then(exit => { for (const item of pending.values()) item.reject(new Error('Early server close: ' + exit.stderr)); });
    const request = (method, params) => new Promise((resolve, reject) => { const key = ++seq; pending.set(key, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n'); });
    const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench-plugin-path-test', version: '1' } });
    assert.equal(init.serverInfo.version, pkg.version);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { tools } = await request('tools/list', {}); assert.equal(tools.length, 12);
    const skill = await readFile(join(root, 'skills/toolsenabled-bench/SKILL.md'), 'utf8');
    workflowContract(init.instructions, skill, tools);
    assert.throws(() => workflowContract(init.instructions + ' The human uses web_preview for pause, undo and human-only export.', skill, tools));
    const call = async (name, args) => { const result = await request('tools/call', { name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
    if (!attempt) { const project = await call('composition.update', {}); id = project.id; }
    const project = await call('project.get', { projectId: id }); assert.equal(project.id, id);
    child.stdin.end(); const exit = await closed; lines.close();
    assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.stderr, '');
    const lease = await acquireDataRootLease(state, 'server/mcp.mjs'); await lease.release();
  }
});

test('direct MCP entry refuses missing or unsafe state in an installed package before writing', { timeout: 20000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'bench-direct-state-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const install = join(temp, 'installed'); await mkdir(install);
  for (const name of ['server', 'src', '.claude-plugin']) await cp(join(root, name), join(install, name), { recursive: true });
  await copyFile(join(root, 'package.json'), join(install, 'package.json'));
  const alias = join(temp, 'alias'); await symlink(install, alias, 'dir');
  for (const value of [undefined, '', 'relative', '~/private', install, join(install, 'state'), temp, join(alias, 'state')]) {
    const env = {}; if (value !== undefined) env.BENCHMARK_DATA_DIR = value;
    const { child, closed } = start([join(install, 'server/mcp.mjs')], env, temp); child.stdin.end();
    const result = await closed;
    assert.equal(result.code, 1, String(value)); assert.equal(result.signal, null); assert.equal(result.stdout, '');
    assert.match(result.stderr, /absolute BENCHMARK_DATA_DIR outside its installation/);
    assert.ok(!result.stderr.includes(temp), 'the safe refusal must not print filesystem paths');
  }
  for (const path of [join(install, '.benchmark-data'), join(install, 'state'), join(temp, 'relative'), join(temp, '.bench-data-lease')])
    await assert.rejects(access(path), { code: 'ENOENT' });
});
