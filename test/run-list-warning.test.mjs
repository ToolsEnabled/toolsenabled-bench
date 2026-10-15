import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startServer } from '../server/main.mjs';

async function runListFixture(base) {
  await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(join(base, 'run-list-'));
  const app = await startServer({ port: 0, dataDir });
  const ids = ['1', '2', '3', '4'].map(n => 'run-' + n.repeat(32));
  const healthy = { id: ids[0], status: 'completed', name: 'Healthy retained evidence', createdAt: '2026-10-01T00:00:00.000Z', history: [], files: [] };
  for (const id of ids) await mkdir(join(dataDir, 'runs', id, 'project'), { recursive: true });
  await writeFile(join(dataDir, 'runs', ids[0], 'run.json'), JSON.stringify(healthy));
  await writeFile(join(dataDir, 'runs', ids[1], 'project', 'trace.txt'), 'INTERRUPTED CREATION\n');
  await writeFile(join(dataDir, 'runs', ids[2], 'run.json'), 'broken json');
  await writeFile(join(dataDir, 'runs', ids[3], 'run.json'), JSON.stringify({ id: ids[3], status: 'failed', createdAt: null }));
  return { app, dataDir, ids, healthy };
}
test('good run coexists with missing, invalid JSON and malformed records and explicit warnings', async t => {
  const f = await runListFixture(resolve(process.env.BENCH_OUTPUT_TEST_ROOT || '.release-work/tmp'));
  t.after(async () => { await f.app.close(); if (!process.env.BENCH_OUTPUT_TEST_ROOT) await rm(f.dataDir, { recursive: true, force: true }); });
  const warnings = [], rows = await f.app.runs.list({ onWarning: message => warnings.push(message) });
  assert.equal(Array.isArray(rows), true); assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], f.healthy);
  assert.deepEqual(rows.slice(1).map(r => r.status), ['incomplete', 'unreadable', 'unreadable']);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /3 retained runs need inspection/);
  for (const row of rows.slice(1)) {
    assert.equal(row.unavailable, true); assert.match(row.warning, /preserved.*inspect/i);
    assert.equal(row.projectSha256, undefined); assert.deepEqual(row.files, []);
    await assert.rejects(f.app.runs.resume(row.id));
  }
  const response = await fetch(f.app.origin + '/api/runs', { headers: { 'x-benchmark-token': f.app.token } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('X-Benchmark-Run-Warning'), warnings[0]);
  assert.deepEqual(await response.json(), rows);
  assert.equal(await readFile(join(f.dataDir, 'runs', f.ids[1], 'project/trace.txt'), 'utf8'), 'INTERRUPTED CREATION\n');
  assert.equal(await readFile(join(f.dataDir, 'runs', f.ids[2], 'run.json'), 'utf8'), 'broken json');
  assert.deepEqual(await f.app.runs.read(f.ids[0]), f.healthy);
});

test('malformed history and identity fields remain warning rows and cannot break valid runs', async t => {
  const f = await runListFixture(resolve(process.env.BENCH_OUTPUT_TEST_ROOT || '.release-work/tmp'));
  t.after(async () => { await f.app.close(); if (!process.env.BENCH_OUTPUT_TEST_ROOT) await rm(f.dataDir, { recursive: true, force: true }); });
  for (const changes of [{ history: "not an array" }, { history: [null] }, { projectSha256: 42 }, { files: null }, { id: f.ids[1] },
    { history: [{ command: { toString: null } }] }, { history: [{ command: 'run', code: {} }] },
    { purpose: { toString: null } }, { warning: {} }, { summary: { completed: { toString: null } } },
  ]) {
    await writeFile(join(f.dataDir, 'runs', f.ids[3], 'run.json'), JSON.stringify({ ...f.healthy, id: f.ids[3], ...changes }));
    const rows = await f.app.runs.list();
    assert.deepEqual(rows[0], f.healthy); assert.equal(rows.find(r => r.id === f.ids[3]).unavailable, true);
    await assert.rejects(f.app.runs.resume(f.ids[3]));
  }
});
