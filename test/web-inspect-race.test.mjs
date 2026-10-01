import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBenchService } from '../server/mcp-service.mjs';
import { startServer } from '../server/main.mjs';

// Keep timeouts local to the awaited condition so load failures explain which
// stage stalled, with enough state to distinguish opening, verification and UI.
async function checked(page, label, action) {
  try { return await action(); }
  catch (cause) {
    const state = await page.evaluate(() => ({
      busy: document.querySelector('#builder > *')?.getAttribute('aria-busy'),
      notice: document.querySelector('#notice')?.textContent,
      frozen: document.querySelector('[data-bench-frozen]')?.textContent,
      context: document.querySelector('#result-context')?.textContent,
      contextHidden: document.querySelector('#result-context')?.hidden,
      archiveReadStarted: !!window.archiveReadStarted,
    })).catch(error => ({ diagnosticError: error.message }));
    throw new Error(`${label}: ${cause.message}\n${JSON.stringify(state)}`, { cause });
  }
}
const waitFor = (page, label, predicate, arg) => checked(page, label,
  () => page.waitForFunction(predicate, arg, { timeout: 15000 }));
const verified = (page, sha) => waitFor(page, `verified banner ${sha}`,
  value => !document.querySelector('#result-context').hidden && document.querySelector('#result-context').textContent.includes(value), sha);

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-inspect-race-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = await createBenchService({ dataDir });
  const call = async (name, args = {}) => {
    const result = await service.callTool(name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  let first, second;
  try {
    let p = await call('composition.update');
    first = await call('study.freeze', { projectId: p.id, revision: p.revision });
    const record = await call('project.get', { projectId: p.id });
    record.draft.spec.name = 'Explicit second snapshot';
    p = await call('composition.update', { projectId: p.id, revision: p.revision, draft: record.draft });
    second = await call('study.freeze', { projectId: p.id, revision: p.revision });
  } finally { await service.close(); }
  const app = await startServer({ port: 0, dataDir });
  t.after(() => app.close());
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--no-zygote', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [], posted = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/runs', async route => {
    if (route.request().method() === 'POST') {
      const project = JSON.parse(route.request().postDataJSON().files['project.json']);
      posted.push(project.sha256); await route.abort();
    } else await route.continue();
  });
  const open = () => page.goto(app.origin);
  const ready = async () => {
    await checked(page, 'overview ready', () => page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor({ timeout: 15000 }));
    await settled();
    await page.locator('[data-page="run"]').click();
    await checked(page, 'retained studies loaded', () => page.locator(`[data-study-id="${second.studyId}"]`).waitFor({ timeout: 15000 }));
  };
  const inspect = study => page.locator(`[data-study-id="${study.studyId}"] button`).click();
  const settled = () => waitFor(page, 'builder idle',
    () => document.querySelector('#builder > *').getAttribute('aria-busy') !== 'true');
  return { page, browser, first, second, open, ready, inspect, settled, posted, errors };
}

test('concurrent Inspect clicks cannot label snapshot A as snapshot B', { timeout: 60000 }, async t => {
  const { page, browser, first, second, open, ready, inspect, settled, posted, errors } = await fixture(t);
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'frozen-study.zip' && !window.archiveReadStarted) {
        window.archiveReadStarted = true;
        await new Promise(resolve => { window.releaseArchiveRead = resolve; });
      }
      return original.call(this);
    };
  });
  await open(); await ready();
  await inspect(first);
  await waitFor(page, 'first archive read started', () => window.archiveReadStarted);
  await inspect(second);
  await waitFor(page, 'second Inspect refused while first is opening', () => document.querySelector('#notice').textContent.includes('Wait for the current study inspection'));
  assert.equal(await page.locator('#result-context').isVisible(), false, 'no provenance banner before verification');
  await page.evaluate(() => window.releaseArchiveRead());
  await verified(page, first.sha256);
  await settled();
  assert.ok((await page.locator('[data-bench-frozen]').innerText()).includes(first.sha256));
  const banner = await page.locator('#result-context').innerText();
  assert.ok(banner.includes(first.sha256), 'banner must name the archive that actually opened');
  assert.ok(!banner.includes(second.sha256));
  const submitted = page.waitForEvent('requestfailed', {
    predicate: request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs', timeout: 15000,
  });
  await page.locator('[data-bench-submit]').click();
  await checked(page, 'captured run submission', () => submitted);
  assert.deepEqual(posted, [first.sha256], 'the named snapshot must be the submitted one');
  await inspect(second);
  await verified(page, second.sha256);
  await settled();
  assert.ok((await page.locator('#result-context').innerText()).includes(second.sha256), 'a later explicit Inspect remains available');
  assert.deepEqual(errors, []);
  const evidenceDir = process.env.BENCHMARK_BROWSER_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, 'inspect-race.png'), fullPage: true });
    await writeFile(join(evidenceDir, 'inspect-race.json'), JSON.stringify({ chromium: browser.version(), first, second, banner, posted, errors }, null, 2));
  }
});

test('a retained archive SHA mismatch clears both the banner and executable snapshot', { timeout: 60000 }, async t => {
  const { page, first, second, open, ready, inspect, settled, posted, errors } = await fixture(t);
  await open(); await ready(); await inspect(first);
  await verified(page, first.sha256);
  await settled();
  await page.route(`**/api/runs/${second.studyId}`, async route => {
    const response = await route.fetch();
    const record = await response.json();
    await route.fulfill({ response, json: { ...record, projectSha256: '0'.repeat(64) } });
  });
  await inspect(second);
  await waitFor(page, 'SHA mismatch notice', () => document.querySelector('#notice').textContent.includes('could not be verified'));
  await settled();
  assert.equal(await page.locator('#result-context').isVisible(), false);
  const frozen = await page.locator('[data-bench-frozen]').innerText();
  assert.ok(!frozen.includes(first.sha256) && !frozen.includes(second.sha256), 'mismatched inspection must leave no runnable archive');
  await page.locator('[data-bench-submit]').click(); await settled();
  assert.deepEqual(posted, []);
  assert.deepEqual(errors, []);
});

test('a failed Inspect fetch clears the previously inspected runnable snapshot', { timeout: 60000 }, async t => {
  const { page, first, second, open, ready, inspect, settled, posted, errors } = await fixture(t);
  await open(); await ready(); await inspect(first);
  await verified(page, first.sha256);
  await settled();
  await page.route(`**/api/runs/${second.studyId}/package`, route => route.fulfill({ status: 500, body: 'unavailable' }));
  await inspect(second);
  await waitFor(page, 'failed fetch notice', () => document.querySelector('#notice').textContent.includes('Could not load the frozen package'));
  await settled();
  assert.equal(await page.locator('#result-context').isVisible(), false);
  await page.locator('[data-bench-submit]').click();
  await settled();
  assert.deepEqual(posted, [], 'a failed Inspect must leave no previously inspected run target');
  assert.ok(!(await page.locator('[data-bench-frozen]').innerText()).includes(first.sha256));
  assert.deepEqual(errors, []);
});

test('the Inspect race setup waits for a busy builder before its first Inspect', { timeout: 40000 }, async t => {
  const { page, first, open, ready, inspect, settled } = await fixture(t);
  let release, finish;
  const gate = new Promise(resolve => { release = resolve; });
  const routed = new Promise(resolve => { finish = resolve; });
  await page.route('**/assets/research-examples-*.js', async route => {
    await gate;
    try { await route.continue(); } finally { finish(); }
  });
  await open();
  await page.getByRole('heading', { name: 'Build the benchmark. Keep the evidence.' }).waitFor({ timeout: 10000 });
  await settled();
  const requested = page.waitForRequest('**/assets/research-examples-*.js', { timeout: 10000 });
  // Exercise setup while an actual builder operation is still loading, as can
  // happen under suite load. Dispatch keeps the overview heading in place.
  await page.locator('[data-bench-load-examples]').dispatchEvent('click');
  await requested;
  assert.equal(await page.locator('#builder > *').getAttribute('aria-busy'), 'true');
  const timer = setTimeout(release, 10000);
  try {
    await ready();
    assert.equal(await page.locator('#builder > *').getAttribute('aria-busy'), 'false', 'race setup must await initial builder idle');
    await inspect(first);
    await verified(page, first.sha256);
  } finally {
    clearTimeout(timer); release(); await routed;
  }
});

async function ownFreeze(page, settled) {
  await page.locator('[data-bench-freeze]').click(); await settled();
  const frozen = await page.locator('[data-bench-frozen]').innerText();
  assert.match(frozen, /[a-f0-9]{64}/);
  assert.equal(await page.locator('[data-bench-run]').isEnabled(), true);
  return frozen;
}
async function ownEvidence(page, settled) {
  await page.locator('[data-bench-run]').click(); await settled();
  assert.equal(await page.locator('[data-bench-export-evidence]').isEnabled(), true);
  return evidenceBytes(page);
}
async function evidenceBytes(page) {
  const download = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('[data-bench-export-evidence]').click();
  return readFile(await (await download).path(), 'utf8');
}
for (const failure of ['fetch', 'SHA mismatch']) test(`failed Inspect (${failure}) preserves the user's own freeze and evidence`, { timeout: 60000 }, async t => {
  const { page, second, open, ready, inspect, settled, errors } = await fixture(t);
  await open(); await ready();
  // A fresh user freeze can have the same hash as a previously inspected
  // archive. Ownership must be tracked by origin, not inferred from the hash.
  if (failure === 'SHA mismatch') { await inspect(second); await verified(page, second.sha256); await settled(); }
  const frozen = await ownFreeze(page, settled), evidence = await ownEvidence(page, settled);
  const results = await page.locator('[data-bench-results]').innerText();
  if (failure === 'fetch') await page.route(`**/api/runs/${second.studyId}/package`, route => route.fulfill({ status: 500, body: 'unavailable' }));
  else await page.route(`**/api/runs/${second.studyId}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), projectSha256: '0'.repeat(64) } });
  });
  await inspect(second);
  await waitFor(page, 'failed inspection notice', () => document.querySelector('#notice').textContent.includes('Could not load') || document.querySelector('#notice').textContent.includes('could not be verified'));
  await settled();
  assert.equal(await page.locator('[data-bench-frozen]').innerText(), frozen);
  assert.equal(await page.locator('[data-bench-results]').innerText(), results);
  assert.equal(await evidenceBytes(page), evidence);
  assert.equal(await page.locator('#result-context').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('Inspect while a user run is busy preserves its freeze and lets its evidence complete', { timeout: 60000 }, async t => {
  const { page, second, open, ready, inspect, settled, errors } = await fixture(t);
  await page.addInitScript(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      if (window.holdRunDigest) {
        window.holdRunDigest = false; window.runDigestStarted = true;
        await new Promise(resolve => { window.releaseRunDigest = resolve; });
      }
      return digest(...args);
    };
  });
  await open(); await ready();
  const frozen = await ownFreeze(page, settled);
  let fetched = 0;
  await page.route(`**/api/runs/${second.studyId}/package`, async route => { fetched++; await route.continue(); });
  await page.evaluate(() => { window.holdRunDigest = true; });
  await page.locator('[data-bench-run]').click();
  await waitFor(page, 'own run held busy', () => window.runDigestStarted);
  try {
    await inspect(second);
    await waitFor(page, 'busy Inspect refused', () => document.querySelector('#notice').textContent.includes('Wait for the current study operation'));
    assert.equal(fetched, 0, 'busy Inspect must refuse before fetching');
    assert.equal(await page.locator('[data-bench-frozen]').innerText(), frozen);
  } finally { await page.evaluate(() => window.releaseRunDigest()); }
  await settled();
  assert.equal(await page.locator('[data-bench-frozen]').innerText(), frozen);
  const evidence = JSON.parse(await evidenceBytes(page));
  assert.ok(frozen.includes(evidence.projectSha256));
  assert.deepEqual(errors, []);
});

test('a run started during the Inspect fetch remains intact when the package arrives', { timeout: 60000 }, async t => {
  const { page, second, open, ready, inspect, settled, errors } = await fixture(t);
  await page.addInitScript(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      if (window.holdRunDigest) {
        window.holdRunDigest = false; window.runDigestStarted = true;
        await new Promise(resolve => { window.releaseRunDigest = resolve; });
      }
      return digest(...args);
    };
  });
  await open(); await ready();
  const frozen = await ownFreeze(page, settled);
  let releaseFetch, signalFetch;
  const gate = new Promise(resolve => { releaseFetch = resolve; });
  const fetched = new Promise(resolve => { signalFetch = resolve; });
  await page.route(`**/api/runs/${second.studyId}/package`, async route => { signalFetch(); await gate; await route.continue(); });
  try {
    await inspect(second); await checked(page, 'held package request', () => fetched);
    await page.evaluate(() => { window.holdRunDigest = true; });
    await page.locator('[data-bench-run]').click();
    await waitFor(page, 'own run held busy', () => window.runDigestStarted);
    releaseFetch();
    await waitFor(page, 'arriving package refused while busy', () => document.querySelector('#notice').textContent.includes('Wait for the current study operation'));
    assert.equal(await page.locator('[data-bench-frozen]').innerText(), frozen);
  } finally { releaseFetch(); await page.evaluate(() => window.releaseRunDigest?.()); }
  await settled();
  assert.ok(frozen.includes(JSON.parse(await evidenceBytes(page)).projectSha256));
  assert.equal(await page.locator('#result-context').isVisible(), false);
  assert.deepEqual(errors, []);
});
