import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startServer } from '../server/main.mjs';

test('Local runs shows healthy evidence and visible warnings without actions on broken rows', { timeout: 40000 }, async t => {
  const base = resolve(process.env.BENCH_OUTPUT_TEST_ROOT || '.release-work/tmp'); await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(join(base, 'web-run-list-')), app = await startServer({ port: 0, dataDir });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(async () => { await browser.close(); await app.close(); if (!process.env.BENCH_OUTPUT_TEST_ROOT) await rm(dataDir, { recursive: true, force: true }); });
  const ids = ['1', '2', '3'].map(n => 'run-' + n.repeat(32));
  for (const id of ids) await mkdir(join(dataDir, 'runs', id, 'project'), { recursive: true });
  await writeFile(join(dataDir, 'runs', ids[0], 'run.json'), JSON.stringify({ id: ids[0], status: 'completed', name: 'Healthy retained evidence', createdAt: '2026-10-01T00:00:00.000Z', history: [], files: [] }));
  await writeFile(join(dataDir, 'runs', ids[1], 'project/trace.txt'), 'RETAIN ME\n');
  await writeFile(join(dataDir, 'runs', ids[2], 'run.json'), 'broken json');
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  // A focused source bundle can be supplied without rewriting shared dist or
  // running build-time generators owned by another release worker.
  if (process.env.BENCH_TEST_APP_BUILD) await page.route('**/assets/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({ path: join(resolve(process.env.BENCH_TEST_APP_BUILD), name), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' });
  });
  await page.goto(app.origin); await page.locator('[data-page="runs"]').click();
  await page.getByRole('heading', { name: 'Healthy retained evidence' }).waitFor();
  assert.equal(await page.locator('.run-card').count(), 3);
  assert.equal(await page.getByRole('button', { name: 'Inspect results →' }).count(), 1);
  for (const id of ids.slice(1)) {
    const card = page.locator('.run-card').filter({ has: page.getByRole('heading', { name: 'Retained run ' + id, exact: true }) });
    assert.equal(await card.getByRole('alert').isVisible(), true);
    assert.match(await card.getByRole('alert').innerText(), /missing, malformed or unreadable.*preserved/i);
    assert.equal(await card.locator('[data-run-action]').count(), 0);
  }
  assert.equal(await readFile(join(dataDir, 'runs', ids[1], 'project/trace.txt'), 'utf8'), 'RETAIN ME\n');
  assert.equal(await readFile(join(dataDir, 'runs', ids[2], 'run.json'), 'utf8'), 'broken json');
  assert.deepEqual(errors, []);
});
