import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBenchService } from '../server/mcp-service.mjs';
import { startServer } from '../server/main.mjs';

test('Freeze & review lists retained studies without selecting a run target', { timeout: 60000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-web-frozen-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = await createBenchService({ dataDir });
  const call = async (name, args = {}) => {
    const result = await service.callTool(name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  let p, first, second, foreign;
  try {
    const other = await call('composition.update');
    foreign = await call('study.freeze', { projectId: other.id, revision: other.revision });
    p = await call('composition.update');
    first = await call('study.freeze', { projectId: p.id, revision: p.revision });
    const record = await call('project.get', { projectId: p.id });
    record.draft.spec.name = 'Second frozen revision';
    p = await call('composition.update', { projectId: p.id, revision: p.revision, draft: record.draft });
    second = await call('study.freeze', { projectId: p.id, revision: p.revision });
  } finally { await service.close(); } // Preserve the existing exclusive data-root lease.
  const app = await startServer({ port: 0, dataDir });
  t.after(() => app.close());
  const path = join(dataDir, 'projects', p.id + '.json');
  const before = await readFile(path);
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const writes = [], errors = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.origin);
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor();
  await page.locator('[data-page="run"]').click();
  await page.getByRole('heading', { name: 'From protocol to evidence' }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('[data-study-id]').count(), 2, 'both frozen revisions must be listed before any execution');
  for (const study of [first, second]) {
    assert.ok((await page.locator(`[data-study-id="${study.studyId}"]`).innerText()).includes(study.sha256));
  }
  assert.equal(await page.locator(`[data-study-id="${foreign.studyId}"]`).count(), 0);
  const postedRuns = [];
  await page.route('**/api/runs', async route => {
    if (route.request().method() === 'POST') { postedRuns.push(route.request().postDataJSON()); await route.abort(); }
    else await route.continue();
  });
  await page.locator('[data-bench-submit]').click();
  await page.waitForTimeout(400);
  assert.deepEqual(postedRuns, [], 'navigation must not authorize a retained snapshot as the run target');
  assert.ok(!(await page.locator('[data-bench-frozen]').innerText()).includes(second.sha256));
  assert.equal(await page.locator('#result-context').isVisible(), false);
  const evidenceDir = process.env.BENCHMARK_BROWSER_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, '03-mcp-frozen-study.png'), fullPage: true });
  }
  await page.locator(`[data-study-id="${first.studyId}"] button`).click();
  await page.waitForFunction(sha => document.querySelector('[data-bench-frozen]').textContent.includes(sha), first.sha256);
  await page.locator('[data-page="library"]').click();
  assert.equal(await page.locator('[data-bench-name]').inputValue(), 'Second frozen revision');
  await page.locator('[data-page="run"]').click();
  assert.ok((await page.locator('[data-bench-frozen]').innerText()).includes(first.sha256));
  await page.waitForTimeout(1500);
  assert.ok((await readFile(path)).equals(before));
  assert.deepEqual(writes, []);
  for (const study of [first, second]) {
    const run = await app.runs.read(study.studyId);
    assert.equal(run.status, 'frozen');
    assert.deepEqual(run.history, []);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'full frozen hashes must fit a mobile viewport');
  await page.locator('[data-page="library"]').click();
  await page.locator('[data-bench-name]').fill('Reviewed draft after inspection');
  await page.waitForTimeout(1600);
  await page.locator('[data-page="run"]').click();
  await page.locator('[data-bench-submit]').click();
  await page.waitForTimeout(400);
  assert.deepEqual(postedRuns, [], 'editing and returning must not reselect an older archive');
  assert.equal(await page.locator('#result-context').isVisible(), false);
  assert.deepEqual(errors, []);
  if (evidenceDir) await writeFile(join(evidenceDir, 'frozen.json'), JSON.stringify({ chromium: browser.version(), first, second, writes, draftBytesIdentical: true, collectorsExecuted: false, pageErrors: errors }, null, 2));
});
