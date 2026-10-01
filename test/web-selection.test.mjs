import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';
import { createRoutingDraft } from '../src/research-routing.mjs';
import { buildNesting } from '../src/research-nesting.mjs';
import { RUNTIME_FILES } from '../src/benchmark/study.mjs';
import { resourceTemplateFixture } from '../tools/test/fixtures/research-benchmark-resource-template.mjs';
import { operationalRequirementFixture } from '../tools/test/fixtures/research-benchmark-requirements.mjs';
import { auditFixture } from '../tools/test/fixtures/research-benchmark-audit.mjs';

async function fixture(t, audit = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-view-selection-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  let spec = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  if (audit === 'requirements') spec = await operationalRequirementFixture();
  if (audit === 'resource') spec = await resourceTemplateFixture();
  if (audit === true) {
    const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name => [name, await readFile(new URL('../src/benchmark/' + name, import.meta.url), 'utf8')])));
    spec = (await auditFixture(sources)).spec;
  }
  const other = await app.projects.create('Switch destination');
  const p = await app.projects.create('Selection fixture');
  let routing = createRoutingDraft(spec.tasks[0]);
  routing.compositions.push({ name: 'second composition', node: structuredClone(spec.tasks[1].root) });
  const nested = buildNesting(routing, spec.catalog, { name: 'Nested pair', mode: 'together', members: routing.compositions.map(item => ({ composition: item.name })) });
  routing = nested.draft; spec.catalog = nested.catalog;
  await app.projects.save(p.id, { spec, attachments: {}, editors: { 'data-bench-routing': JSON.stringify(routing) } }, p.revision);
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const writes = [], errors = [];
  const open = async label => {
    const page = await browser.newPage(); page.setDefaultTimeout(10000);
    page.on('request', request => { if (request.method() === 'PUT') writes.push({ tab: label, url: request.url() }); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.origin);
    await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
    await page.locator('#project-picker').selectOption(p.id);
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally', null, { timeout: 10000 });
    return page;
  };
  return { app, browser, p, other, path: join(dataDir, 'projects', p.id + '.json'), open, writes, errors };
}
async function selectTask(page, value) {
  await page.locator('[data-page="corpus"]').click();
  await page.locator('[data-bench-task-tools]').evaluate(el => { el.open = true; });
  await page.locator('[data-bench-task]').selectOption(value);
  await page.waitForTimeout(1600);
}

async function selectNesting(page) {
  await page.locator('[data-page="nesting"]').click();
  await page.locator('[data-nest-selected]').selectOption('Nested pair');
  await page.locator('[data-nest-inspect="second composition"]').click();
  await page.locator('[data-nest-back="0"]').click();
  await page.waitForTimeout(1600);
}

for (const kind of ['task', 'snippet', 'audit case', 'nesting']) test(`viewing a ${kind} preserves project bytes and sends zero PUTs`, { timeout: 40000 }, async t => {
  const { app, p, path, open, writes, errors } = await fixture(t, kind === 'audit case');
  const page = await open('viewer'), before = await readFile(path);
  if (kind === 'nesting') await selectNesting(page);
  else if (kind === 'task') await selectTask(page, '1');
  else if (kind === 'snippet') {
    await page.locator('[data-page="library"]').click();
    await page.locator('[data-bench-select-snippet="1"]').click();
    await page.waitForTimeout(1600);
  } else {
    await page.locator('[data-page="audit"]').click();
    assert.ok(await page.locator('[data-bench-audit-case] option').count() >= 2);
    await page.locator('[data-bench-audit-case]').selectOption('1');
    await page.waitForTimeout(1600);
  }
  await page.locator('[data-page="run"]').click();
  await page.locator('#save-project').click();
  await page.waitForTimeout(1600);
  assert.deepEqual(writes, [], 'view-only selection must not write a new revision');
  assert.ok((await readFile(path)).equals(before));
  assert.equal((await app.projects.read(p.id)).revision, 1);
  assert.equal(await page.locator('#save-state').innerText(), 'Saved locally');
  assert.deepEqual(errors, []);
});

for (const view of ['task', 'nesting']) test(`viewing ${view} in a second tab never conflicts with a real save or project switch`, { timeout: 40000 }, async t => {
  const { app, p, other, open, writes, errors, browser } = await fixture(t);
  const editor = await open('editor'), viewer = await open('viewer');
  if (view === 'nesting') await selectNesting(viewer);
  else await selectTask(viewer, '1');
  await editor.locator('[data-page="library"]').click();
  const response = editor.waitForResponse(r => r.request().method() === 'PUT', { timeout: 10000 });
  await editor.locator('[data-bench-name]').fill('Authored in the editing tab');
  assert.equal((await response).status(), 200, 'viewing in another tab must not advance the saved revision');
  await editor.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally', null, { timeout: 10000 });
  assert.equal((await app.projects.read(p.id)).revision, 2);
  assert.equal((await app.projects.read(p.id)).draft.spec.name, 'Authored in the editing tab');
  // The viewer now holds an older revision. Further viewing and switching must
  // still be read-only, rather than attempting to save its stale spec.
  if (view === 'nesting') await selectNesting(viewer);
  else await selectTask(viewer, '0');
  await viewer.locator('#project-picker').selectOption(other.id);
  await viewer.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally', null, { timeout: 10000 });
  assert.equal(await viewer.locator('#project-picker').inputValue(), other.id);
  assert.equal(await viewer.locator('#notice').isVisible(), false);
  assert.deepEqual(writes.map(row => row.tab), ['editor']);
  assert.deepEqual(errors, []);
  const dir = process.env.BENCHMARK_BROWSER_EVIDENCE_DIR;
  if (dir) { await mkdir(dir, { recursive: true }); await writeFile(join(dir, `two-tab-${view}-selection.json`), JSON.stringify({ chromium: browser.version(), writes, revision: 2, errors }, null, 2)); }
});

// This inventory is deliberately about viewing. Selects that change an authored
// method, source pool, model, treatment or task are editing controls, not views.
// Every option of every available view selector is exercised, on every page.
const viewSelects = [
  'data-bench-starter', 'data-bench-snippet-label-filter', 'data-bench-source-file',
  'data-bench-task', 'data-bench-tree-composition', 'data-bench-audit-case', 'data-bench-audit-file',
  'data-bench-native-control-job', 'data-node-replacement-mode', 'data-node-wrapper',
  'data-nest-inspect-set', 'data-nest-selected', 'data-var-marking', 'data-ps-prompt',
  'data-condition-fields-row', 'data-condition-fields-new-profile',
  'data-composition-fields-occurrence', 'data-composition-family-fields-family', 'data-composition-family-fields-source',
  'data-information-fields-reading', 'data-information-fields-source', 'data-information-fields-parameter',
  'data-requirement-fields-target', 'data-resource-template-case-select', 'data-endpoint-fields-row',
];
const idle = page => page.waitForFunction(() => document.querySelector('#builder > *').getAttribute('aria-busy') !== 'true', null, { timeout: 15000 });
const reveal = page => page.locator('#builder details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));

for (const audit of [false, true]) test(`every page and selectable view stays read-only (${audit ? 'audit' : 'composition'} workspace)`, { timeout: 180000 }, async t => {
  const { app, p, path, open, writes, errors, browser } = await fixture(t, audit);
  const page = await open('viewer');
  // Prepare optional authoring panels before establishing the read-only baseline.
  // Their authored drafts are saved once; inspecting their rows must not resave.
  for (const [tab, action] of [
    ['protocol', 'prepare-condition-fields'], ['corpus', 'prepare-composition-fields'],
    ['corpus', 'prepare-information-fields'], ['requirements', 'prepare-requirement-fields'],
  ]) {
    await page.locator(`[data-page="${tab}"]`).click(); await reveal(page);
    const control = page.locator(`[data-bench-${action}]`);
    if (await control.isVisible() && await control.isEnabled()) { await control.click(); await idle(page); }
  }
  await page.locator('#save-project').click(); await idle(page);
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally', null, { timeout: 10000 });
  await page.waitForTimeout(1400);
  writes.length = 0;
  const before = await readFile(path), revision = (await app.projects.read(p.id)).revision;
  const pages = await page.locator('[data-page]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.page))]);
  assert.equal(pages.length, 16, 'all application pages are inventoried');
  const exercised = [];
  const unchanged = async description => {
    await idle(page);
    // An explicit Save checks identity immediately, so a quick return to the
    // original selection cannot conceal a dirty transition within the debounce.
    await page.locator('#save-project').click();
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally', null, { timeout: 10000 });
    assert.deepEqual(writes, [], `${description} must not PUT`);
    assert.ok((await readFile(path)).equals(before), description);
    exercised.push(description);
  };
  for (const tab of pages) {
    await page.locator(`[data-page="${tab}"]`).click(); await reveal(page);
    await unchanged(`page:${tab}`);
    for (const attribute of ['data-view-choice', 'data-bench-select-snippet', 'data-bench-label-choice', 'data-ps-inspect']) {
      const values = await page.locator(`[${attribute}]`).evaluateAll((nodes, key) => nodes.filter(node => node.checkVisibility() && !node.disabled).map(node => node.getAttribute(key)), attribute);
      for (const value of [...new Set(values)]) {
        const control = page.locator(`[${attribute}=${JSON.stringify(value)}]`).filter({ visible: true }).first();
        if (!await control.count()) continue;
        await control.click(); await reveal(page); await unchanged(`${tab}:${attribute}=${value}`);
      }
    }
    for (const attribute of viewSelects) {
      const controls = page.locator(`select[${attribute}]`);
      for (let index = 0; index < await controls.count(); index++) {
        let control = controls.nth(index);
        if (!await control.isVisible() || !await control.isEnabled()) continue;
        const options = await control.locator('option:not(:disabled)').evaluateAll(nodes => nodes.map(node => node.value));
        for (const value of [...new Set(options)]) {
          control = page.locator(`select[${attribute}]`).nth(index);
          if (!await control.isVisible() || !await control.isEnabled()) continue;
          await control.selectOption(value); await reveal(page);
          await unchanged(`${tab}:${attribute}[${index}]=${value}`);
        }
      }
    }
  }
  await selectNesting(page); await unchanged('nesting:drill-in/back');
  assert.equal((await app.projects.read(p.id)).revision, revision);
  assert.deepEqual(errors, []);
  const directory = process.env.BENCHMARK_BROWSER_EVIDENCE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `all-views-${audit ? 'audit' : 'composition'}.json`), JSON.stringify({ chromium: browser.version(), pages, viewSelects, exercised, writes, revision, errors }, null, 2));
  }
});

for (const kind of ['information', 'families', 'resources', 'endpoints', 'requirements', 'prompt-set']) test(`prepared ${kind} view selectors preserve authored drafts`, { timeout: 60000 }, async t => {
  const { app, p, path, open, writes, errors } = await fixture(t, kind === 'resources' ? 'resource' : kind === 'requirements' ? 'requirements' : false);
  const page = await open('viewer');
  const tab = kind === 'resources' ? 'experiment' : kind === 'endpoints' ? 'analysis' : kind === 'requirements' ? 'requirements' : 'corpus';
  await page.locator(`[data-page="${tab}"]`).click(); await reveal(page);
  if (kind === 'requirements') {
    await page.locator('[data-bench-prepare-requirement-fields]').click(); await idle(page); await reveal(page);
  } else if (kind === 'prompt-set') {
    await page.locator('[data-ps-prepare]').click(); await idle(page);
    await page.locator('[data-ps-inspect]').first().waitFor();
  } else if (kind === 'information') {
    await page.locator('[data-bench-prepare-information-fields]').click(); await idle(page); await reveal(page);
    for (let i = 0; i < 2; i++) await page.locator('[data-information-fields-add-reading]').click();
  } else if (kind === 'families') {
    await page.locator('[data-bench-start-family-workspace]').click(); await idle(page); await reveal(page);
    const source = page.locator('[data-composition-family-fields-source]');
    const value = await source.locator('option').last().getAttribute('value');
    await source.selectOption(value);
    await page.locator('[data-composition-family-fields-add]').click(); await idle(page); await reveal(page);
  } else if (kind === 'endpoints') {
    for (let i = 0; i < 2; i++) await page.locator('[data-endpoint-fields-add]').click();
  }
  await page.locator('#save-project').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally', null, { timeout: 10000 });
  await page.waitForTimeout(1400); writes.length = 0;
  const before = await readFile(path), revision = (await app.projects.read(p.id)).revision;
  if (kind === 'prompt-set') {
    const groups = await page.locator('[data-ps-inspect]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-ps-inspect')));
    for (const group of groups) {
      await page.locator(`[data-ps-inspect=${JSON.stringify(group)}]`).click();
      const values = await page.locator('[data-ps-prompt] option').evaluateAll(nodes => nodes.map(node => node.value));
      for (const value of values) {
        await page.locator('[data-ps-prompt]').selectOption(value); await page.locator('[data-ps-read]').click();
        await page.locator('#save-project').click();
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally');
        assert.deepEqual(writes, []); assert.ok((await readFile(path)).equals(before));
      }
    }
  }
  const names = {
    information: ['data-information-fields-source', 'data-information-fields-reading', 'data-information-fields-parameter'],
    families: ['data-composition-family-fields-family', 'data-composition-family-fields-source', 'data-composition-fields-occurrence'],
    requirements: ['data-requirement-fields-target'], 'prompt-set': [],
    resources: ['data-resource-template-case-select'], endpoints: ['data-endpoint-fields-row'],
  }[kind];
  for (const name of names) {
    const selector = `select[${name}]`;
    const control = page.locator(selector).filter({ visible: true });
    assert.ok(await control.count(), `${name} must be populated by the fixture`);
    const values = await control.locator('option:not(:disabled)').evaluateAll(nodes => nodes.map(node => node.value));
    for (const value of values) {
      const current = page.locator(selector).filter({ visible: true });
      if (await current.isDisabled()) continue;
      await current.selectOption(value); await idle(page); await reveal(page);
      await page.locator('#save-project').click();
      await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved locally', null, { timeout: 10000 });
      assert.deepEqual(writes, [], `${name}=${value}`);
      assert.ok((await readFile(path)).equals(before), `${name}=${value}`);
    }
  }
  assert.equal((await app.projects.read(p.id)).revision, revision);
  assert.deepEqual(errors, []);
});
