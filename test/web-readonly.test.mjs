import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';

test('repeated real page loads and navigation never write; a real edit saves once', { timeout: 60000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-web-readonly-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const p = await app.projects.create('Read-only fixture');
  await app.projects.save(p.id, { spec: newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true }), attachments: {} }, p.revision);
  const path = join(dataDir, 'projects', p.id + '.json');
  const before = await readFile(path);
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const evidenceDir = process.env.BENCHMARK_BROWSER_EVIDENCE_DIR;
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const writes = [], errors = [];
  page.on('request', request => { if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method())) writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  for (let i = 0; i < 3; i++) {
    await page.goto(app.origin);
    await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
    assert.equal(await page.locator('.workspace-label span').innerText(), 'v' + version);
    assert.equal(await page.locator('.release-tag').innerText(), 'Research preview · ' + version);
    if (i === 0 && evidenceDir) await page.screenshot({ path: join(evidenceDir, '01-release-version.png'), fullPage: true });
    await page.waitForTimeout(1500);
    assert.equal((await app.projects.read(p.id)).revision, 1, `load ${i + 1} changed revision`);
    for (const next of ['library', 'compose', 'nesting', 'variance', 'corpus', 'protocol', 'workflow', 'experiment', 'audit', 'observations', 'requirements', 'analysis', 'run', 'runs', 'methods', 'overview']) {
      await page.locator(`[data-page="${next}"]`).click();
    }
    await page.locator('[data-page="library"]').click();
    await page.locator('[data-bench-name]').click();
    await page.locator('[data-bench-snippet-search]').fill('task');
    await page.locator('#save-project').click(); // An unchanged explicit save is also a no-op.
    await page.waitForTimeout(1500); // Exceeds the app's 1200 ms autosave debounce.
    assert.equal((await readFile(path)).equals(before), true, `load ${i + 1} changed fixture bytes/revision`);
    assert.deepEqual(writes, []);
  }
  if (evidenceDir) {
    await page.screenshot({ path: join(evidenceDir, '02-readonly-navigation.png'), fullPage: true });
    await writeFile(join(evidenceDir, 'readonly.json'), JSON.stringify({ version, chromium: browser.version(), loads: 3, revisionBefore: 1, revisionAfter: (await app.projects.read(p.id)).revision, bytesIdentical: (await readFile(path)).equals(before), writes }, null, 2));
  }
  await page.locator('[data-page="library"]').click();
  await page.locator('[data-bench-name]').fill('A real user edit');
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
  assert.equal((await app.projects.read(p.id)).revision, 2);
  assert.equal((await app.projects.read(p.id)).draft.spec.name, 'A real user edit');
  assert.equal(writes.length, 1);
  const saved = await readFile(path);
  await page.reload();
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
  await page.waitForTimeout(1500);
  assert.ok((await readFile(path)).equals(saved));
  assert.equal(writes.length, 1);
  assert.deepEqual(errors, []);
});


test('opening an empty workspace does not create a project', { timeout: 30000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-web-empty-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const writes = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto(app.origin);
  await page.getByRole('heading', { name: 'Create your first study' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Create your first study' }).waitFor();
  await page.locator('[data-page="library"]').click();
  await page.waitForTimeout(1500);
  assert.deepEqual(await app.projects.list(), []);
  assert.deepEqual(writes, []);
  await page.locator('[data-action="new"]').click();
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
  assert.equal((await app.projects.list()).length, 1);
  assert.equal(writes.length, 1);
});
