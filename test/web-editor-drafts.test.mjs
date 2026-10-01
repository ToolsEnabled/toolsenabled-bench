import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';

const cases = [
  { name: 'routing', tab: 'corpus', selector: '[data-routing-field="0"]', prepare: page => page.locator('[data-bench-routing-fold] > summary').click() },
  { name: 'composition-generation-draft', tab: 'compose', selector: '[data-cg-set]' },
  { name: 'nesting-draft', tab: 'nesting', selector: '[data-nest-name]' },
  { name: 'variance-draft', tab: 'variance', selector: '[data-var-name]' },
  { name: 'prompt-set-draft', tab: 'corpus', selector: '[data-ps-rationale]' },
  { name: 'pipeline-draft', tab: 'protocol', selector: '[data-pipe-root]' },
  { name: 'checks-draft', tab: 'protocol', selector: '[data-checks-code]', prepare: page => page.locator('[data-checks-mode][value="code"]').check() },
];
for (const entry of cases) test(`retained ${entry.name}: a real editor change survives autosave and reload`, { timeout: 30000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-editor-draft-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const p = await app.projects.create('Editor persistence');
  const spec = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  await app.projects.save(p.id, { spec, attachments: {} }, p.revision);
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'PUT') writes.push(request.url()); });
  await page.goto(app.origin);
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
  await page.locator(`[data-page="${entry.tab}"]`).click();
  if (entry.prepare) await entry.prepare(page);
  const value = `retained ${entry.name}`;
  if (entry.name === 'routing' && !await page.locator(entry.selector).count()) await page.locator('[data-routing-add-field]').click();
  await page.locator(entry.selector).fill(value);
  if (entry.name === 'routing') await page.locator(entry.selector).press('Tab');
  const retained = await page.locator(`[data-bench-${entry.name}]`).inputValue();
  assert.ok(retained.includes(value), 'the editor must publish its own draft');
  await page.waitForTimeout(1600); // Beyond the 1200 ms debounce, even when the broken code reports Saved.
  await page.reload();
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
  await page.locator(`[data-page="${entry.tab}"]`).click();
  if (entry.name === 'routing') await entry.prepare(page);
  assert.equal(await page.locator(`[data-bench-${entry.name}]`).inputValue(), retained, 'the complete retained draft must survive reload');
  assert.equal(await page.locator(entry.selector).inputValue(), value);
  const record = await app.projects.read(p.id);
  assert.equal(record.draft.editors[`data-bench-${entry.name}`], retained);
  assert.deepEqual(record.draft.spec, spec, 'an unapplied editor change must not alter the declared study');
  assert.equal(record.revision, 2);
  assert.equal(writes.length, 1);
  assert.deepEqual(errors, []);
  const evidenceDir = process.env.BENCHMARK_BROWSER_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, `${entry.name}.png`), fullPage: true });
    await writeFile(join(evidenceDir, `${entry.name}.json`), JSON.stringify({ chromium: browser.version(), retained, revision: record.revision, writes, errors }, null, 2));
  }
});
