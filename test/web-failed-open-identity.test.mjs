import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';

for (const mode of ['initial load', 'picker switch', 'Inspect results']) test(`a failed ${mode} clears the overview and picker identity`, { timeout: 30000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-open-identity-'));
  const app = await startServer({ port: 0, dataDir });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(async () => { await browser.close(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const spec = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  let broken, healthy;
  for (const kind of mode === 'initial load' ? ['healthy', 'broken'] : ['broken', 'healthy']) {
    const p = await app.projects.create(kind);
    await app.projects.save(p.id, { spec: { ...spec, name: kind }, attachments: {}, editors: kind === 'broken' ? { 'data-bench-variance-draft': '{"studies":{}}' } : {} }, p.revision);
    if (kind === 'broken') broken = p; else healthy = p;
  }
  const page = await browser.newPage(), writes = [], errors = [];
  page.on('request', request => { if (request.method() === 'PUT') writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.origin);
  if (mode !== 'initial load') {
    await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
    assert.equal(await page.locator('#project-picker').inputValue(), healthy.id);
    if (mode === 'picker switch') await page.locator('#project-picker').selectOption(broken.id);
    else {
      const runId = 'run-' + 'f'.repeat(32);
      const run = { id: runId, projectId: broken.id, name: 'Retained results', status: 'completed', createdAt: new Date().toISOString(), history: [] };
      await page.route('**/api/runs', route => route.fulfill({ json: [run] }));
      await page.route('**/api/runs/' + runId, route => route.fulfill({ json: run }));
      await page.route('**/api/runs/' + runId + '/evidence', route => route.fulfill({ json: {} }));
      await page.locator('[data-page="runs"]').click();
      await page.getByRole('button', { name: 'Inspect results →' }).click();
    }
  }
  await page.locator('#notice').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#project-picker').inputValue(), '', 'no failed project appears selected');
  assert.match(await page.locator('#overview').innerText(), /Create your first study/, 'failed opens show the empty workspace instead of a stale study');
  assert.equal(await page.locator('#overview .study-card').count(), 0);
  assert.equal(await page.locator('#save-project').isDisabled(), true);
  assert.deepEqual(writes, []);
  await page.locator('#project-picker').selectOption(healthy.id);
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
  assert.equal(await page.locator('#notice').isVisible(), false);
  assert.deepEqual(errors, []);
});
