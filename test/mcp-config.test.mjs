import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { startServer } from '../server/main.mjs';
for (const client of ['claude', 'codex', 'deepseek', 'cursor', 'claude-desktop']) test(`mcp-config prints ${client} registration without installing it`, async () => {
  const { clientConfig } = await import('../tools/mcp-config.mjs');
  const options = { root: '/tmp/bench space', node: '/tmp/node space', dataDir: '/tmp/data space' };
  const value = clientConfig(client, options);
  assert.ok(value.includes('/tmp/bench space/server/mcp.mjs'));
  assert.ok(value.includes('/tmp/data space'));
  if (client === 'cursor' || client === 'claude-desktop') {
    const row = JSON.parse(value).mcpServers.bench;
    assert.equal(row.command, options.node); assert.deepEqual(row.args, ['/tmp/bench space/server/mcp.mjs']);
    assert.equal(row.env.BENCHMARK_DATA_DIR, options.dataDir);
  } else if (client === 'deepseek') {
    assert.match(value, /name: '@deepseek-ai\/dsh-mcp-client'/); assert.match(value, /transport: stdio/); assert.match(value, /serverName: bench/);
  } else { assert.match(value, new RegExp(`^${client} mcp add`)); assert.ok(value.includes('--env')); assert.ok(value.includes(' -- ')); }
  const result = spawnSync(process.execPath, [resolve('tools/mcp-config.mjs'), '--client', client], { encoding: 'utf8', env: { ...process.env, BENCHMARK_DATA_DIR: options.dataDir } });
  assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('server/mcp.mjs'));
});
test('mcp-config refuses invalid options', () => {
  const r = spawnSync(process.execPath, [resolve('tools/mcp-config.mjs'), '--client', 'wrong'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /Usage/); assert.equal(r.stdout, '');
});
test('Claude variadic --env is separated from the server name by --transport', async () => {
  const { clientConfig } = await import('../tools/mcp-config.mjs');
  assert.match(clientConfig('claude', { dataDir: join(tmpdir(), 'bench-explicit-state') }), /--env .+ --transport stdio bench -- /);
});

test('registration refuses missing or unsafe state instead of emitting an unusable dashboard default', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'bench-config-path-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const alias = join(temp, 'linked-install'); await symlink(resolve('.'), alias, 'dir');
  for (const dataDir of [undefined, '', 'relative', '~/private', resolve('.'), resolve('.benchmark-data'), resolve('..'), join(alias, 'state')]) {
    const env = { PATH: process.env.PATH }; if (dataDir !== undefined) env.BENCHMARK_DATA_DIR = dataDir;
    const result = spawnSync(process.execPath, [resolve('tools/mcp-config.mjs'), '--client', 'cursor'], { encoding: 'utf8', env });
    assert.equal(result.status, 1, String(dataDir)); assert.equal(result.stdout, '');
    assert.match(result.stderr, /absolute BENCHMARK_DATA_DIR outside/);
  }
});

test('the helper uses the declared default environment path and the dashboard opens that same store', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench config state '));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [resolve('tools/mcp-config.mjs'), '--client', 'cursor'], { encoding: 'utf8', env: { PATH: process.env.PATH, BENCHMARK_DATA_DIR: dataDir } });
  assert.equal(result.status, 0, result.stderr);
  const configured = JSON.parse(result.stdout).mcpServers.bench.env.BENCHMARK_DATA_DIR;
  assert.equal(configured, dataDir);
  const app = await startServer({ port: 0, dataDir: configured });
  try { assert.equal((await fetch(app.origin)).status, 200); }
  finally { await app.close(); }
});
