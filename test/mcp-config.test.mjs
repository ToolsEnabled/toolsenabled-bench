import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
  const result = spawnSync(process.execPath, [resolve('tools/mcp-config.mjs'), '--client', client], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('server/mcp.mjs'));
});
test('mcp-config refuses invalid options', () => {
  const r = spawnSync(process.execPath, [resolve('tools/mcp-config.mjs'), '--client', 'wrong'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /Usage/); assert.equal(r.stdout, '');
});
test('Claude variadic --env is separated from the server name by --transport', async () => {
  const { clientConfig } = await import('../tools/mcp-config.mjs');
  assert.match(clientConfig('claude'), /--env .+ --transport stdio bench -- /);
});
