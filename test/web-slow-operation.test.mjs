import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';

test('a builder operation with a ten-second chunk delay still autosaves and survives reload', { timeout: 40000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-slow-operation-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const p = await app.projects.create('Slow operation fixture');
  const draft = { spec: newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true }), attachments: {} };
  await app.projects.save(p.id, draft, p.revision);
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const writes = [], errors = [];
  page.on('request', request => { if (request.method() === 'PUT') writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  let delayedMs = 0;
  await page.route('**/assets/research-examples-*.js', async route => {
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, 10000));
    delayedMs = Date.now() - start;
    await route.continue();
  });
  await page.goto(app.origin);
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#builder > *').getAttribute('aria-busy') !== 'true', null, { timeout: 10000 });
  await page.locator('[data-page="library"]').click();
  await page.locator('[data-bench-load-examples]').click();
  await page.waitForFunction(() => document.querySelector('#builder > *').getAttribute('aria-busy') === 'true', null, { timeout: 2000 });
  await page.waitForFunction(() => document.querySelector('#builder > *').getAttribute('aria-busy') !== 'true', null, { timeout: 15000 });
  assert.ok(delayedMs >= 10000, 'exercise a real async operation past the former nine-second cap');
  await page.waitForTimeout(1800); // Exceed the 1200 ms autosave debounce after completion.
  const saved = await app.projects.read(p.id);
  const label = await page.locator('#save-state').innerText();
  assert.equal(saved.revision, 2, `completed edit must be saved; label=${label}, PUTs=${writes.length}`);
  assert.ok(saved.draft.spec.catalog.length > draft.spec.catalog.length);
  assert.equal(writes.length, 1);
  assert.equal(label, 'Saved locally');
  const notice = await page.locator('#notice').innerText();
  assert.ok(!notice.includes('still opening'), 'a slow successful edit must not produce a timeout notice');
  await page.reload();
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor({ timeout: 10000 });
  await page.locator('[data-page="library"]').click();
  assert.equal(await page.locator('[data-bench-select-snippet]').count(), saved.draft.spec.catalog.length);
  assert.deepEqual(errors, []);
  if (process.env.BENCHMARK_BROWSER_EVIDENCE_DIR) {
    const directory = process.env.BENCHMARK_BROWSER_EVIDENCE_DIR;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'slow-operation.json'), JSON.stringify({ chromium: browser.version(), delayedMs, revision: saved.revision, catalogSize: saved.draft.spec.catalog.length, label, writes, errors }, null, 2));
  }
});
