import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';

test('a damaged saved editor clears selection safely and a repaired project really opens', { timeout: 40000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-damaged-draft-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(async () => { await browser.close(); await app.close(); await rm(dir, { recursive: true, force: true }); });
  const spec = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  const damaged = await app.projects.create('Damaged retained draft');
  await app.projects.save(damaged.id, { spec: { ...spec, name: 'Damaged retained draft' }, editors: { 'data-bench-variance-draft': '{"studies":{}}' } }, damaged.revision);
  const healthy = await app.projects.create('Healthy draft');
  await app.projects.save(healthy.id, { spec: { ...spec, name: 'Healthy draft' }, attachments: {} }, healthy.revision);
  const before = await readFile(join(dir, 'projects', damaged.id + '.json'));
  const page = await browser.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'PUT') writes.push(r.url()); });
  await page.goto(app.origin); await page.locator('[data-page="library"]').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
  assert.equal(await page.locator('[data-bench-name]').inputValue(), 'Healthy draft');
  await page.locator('#project-picker').selectOption(damaged.id);
  await page.locator('#notice').waitFor({ state: 'visible' });
  assert.match(await page.locator('#notice').innerText(), /variance-draft\.studies.*array/);
  assert.equal(await page.locator('#project-picker').inputValue(), '');
  assert.equal(await page.locator('[data-bench-name]').inputValue(), 'Untitled benchmark');
  assert.equal(await page.locator('[data-bench-name]').isDisabled(), true);
  assert.ok((await readFile(join(dir, 'projects', damaged.id + '.json'))).equals(before));
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  await page.locator('#project-picker').selectOption(healthy.id);
  await page.locator('[data-page="library"]').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
  assert.equal(await page.locator('#notice').isVisible(), false);
  // File import must reject the same damaged state before replacing the draft.
  await page.locator('[data-bench-import]').setInputFiles({ name: 'damaged-draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ spec, editors: { 'data-bench-variance-draft': '{"studies":{}}' } })) });
  await page.waitForFunction(() => document.querySelector('[data-bench-status]').textContent.includes('variance-draft.studies'));
  assert.equal(await page.locator('[data-bench-name]').inputValue(), 'Healthy draft');
  // Guard the consumer too, even when malformed retained state is already in
  // memory rather than arriving through a validated saved-project boundary.
  const priorVariance = await page.locator('[data-bench-variance-draft]').inputValue();
  await page.locator('[data-bench-variance-draft]').evaluate(el => { el.value = '{"studies":{}}'; });
  await page.locator('[data-page="corpus"]').click();
  await page.waitForFunction(() => document.querySelector('#builder > *').getAttribute('aria-busy') !== 'true');
  assert.equal(await page.locator('[data-ps-source]').count(), 1);
  assert.deepEqual(errors, []);
  await page.locator('[data-bench-variance-draft]').evaluate((el, value) => { el.value = value; }, priorVariance);
  await app.projects.save(damaged.id, { spec: { ...spec, name: 'Repaired draft' }, editors: { 'data-bench-variance-draft': '{"studies":[]}' } }, 1);
  await page.locator('#project-picker').selectOption(damaged.id);
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
  assert.equal(await page.locator('[data-bench-name]').inputValue(), 'Repaired draft');
  assert.equal(await page.locator('#project-picker').inputValue(), damaged.id);
  assert.equal(await page.locator('#notice').isVisible(), false);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
});
