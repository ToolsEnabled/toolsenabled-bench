import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { createBenchService } from '../server/mcp-service.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';
import { createRoutingDraft } from '../src/research-routing.mjs';

for (const kind of ['empty variance studies', 'routing rules object']) test(`opening MCP-written ${kind} never autosaves over the previous project`, { timeout: 40000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-failed-open-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spec = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  const routing = createRoutingDraft(spec.tasks[0]); routing.decisions = [{ name: 'unfinished', rules: {} }];
  const editors = kind === 'empty variance studies' ? { 'data-bench-variance-draft': '{"studies":[]}' } : { 'data-bench-routing': JSON.stringify(routing) };
  const mcp = await createBenchService({ dataDir: dir });
  let damaged;
  try {
    const result = await mcp.callTool('composition.update', { draft: { spec: { ...spec, name: 'Incoming project' }, attachments: {}, editors } });
    assert.ok(!result.isError, JSON.stringify(result)); damaged = JSON.parse(result.content[0].text);
  } finally { await mcp.close(); }
  const app = await startServer({ port: 0, dataDir: dir });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(async () => { await browser.close(); await app.close(); });
  const healthy = await app.projects.create('Keep this project');
  await app.projects.save(healthy.id, { spec: { ...spec, name: 'Keep this project' }, attachments: {} }, healthy.revision);
  const healthyPath = join(dir, 'projects', healthy.id + '.json'), before = await readFile(healthyPath);
  const page = await browser.newPage(), writes = [], errors = [];
  page.on('request', request => { if (request.method() === 'PUT') writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.origin); await page.locator('[data-page="library"]').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
  assert.equal(await page.locator('#project-picker').inputValue(), healthy.id);
  await page.locator('#project-picker').selectOption(damaged.id);
  await page.waitForFunction(() => document.querySelector('#save-state').textContent !== 'Opening project…' && !document.querySelector('#project-picker').disabled);
  // Dispatch even when locked: an already queued input must not own H's id.
  await page.locator('[data-bench-name]').evaluate(input => { input.value = 'Incoming edited'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(1700);
  assert.ok((await readFile(healthyPath)).equals(before), 'H must remain byte-identical after attempting D and editing');
  assert.equal(writes.filter(url => url.endsWith('/' + healthy.id)).length, 0, 'no PUT may target H');
  const selected = await page.locator('#project-picker').inputValue();
  if (selected === damaged.id) {
    assert.equal(await page.locator('#notice').isVisible(), false);
    assert.equal((await app.projects.read(damaged.id)).draft.spec.name, 'Incoming edited');
  } else {
    assert.equal(selected, '', 'a refused load must clear autosave ownership');
    assert.equal(await page.locator('[data-bench-name]').isDisabled(), true);
    assert.equal(await page.locator('#save-project').isDisabled(), true);
    assert.deepEqual(writes, []);
  }
  assert.deepEqual(errors, []);
});

test('dashboard-authored unfinished routing reopens with a repair message and preserves its exact text', { timeout: 40000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-routing-reopen-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(async () => { await browser.close(); await app.close(); await rm(dir, { recursive: true, force: true }); });
  const spec = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  const project = await app.projects.create('Routing recovery');
  await app.projects.save(project.id, { spec, attachments: {} }, project.revision);
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.origin); await page.locator('[data-page="corpus"]').click();
  await page.locator('[data-bench-routing-fold] > summary').click();
  await page.getByText('Advanced: this routing as JSON', { exact: true }).click();
  const raw = ' { "rules" : {} } ';
  await page.locator('[data-bench-routing]').fill(raw);
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Editing…' || document.querySelector('#save-state').textContent === 'Saving…');
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
  assert.equal((await app.projects.read(project.id)).draft.editors['data-bench-routing'], raw);
  await page.reload(); await page.locator('[data-page="corpus"]').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
  assert.equal(await page.locator('#project-picker').inputValue(), project.id);
  assert.equal(await page.locator('#notice').isVisible(), false);
  assert.equal(await page.locator('[data-bench-routing]').inputValue(), raw);
  assert.match(await page.locator('[data-bench-routing-status]').textContent(), /Advanced routing JSON: rules must be a list/);
  assert.deepEqual(errors, []);
});
