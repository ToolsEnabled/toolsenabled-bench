import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunStore } from '../server/runs.mjs';
import { CORE_RUNTIME_FILES, RUNTIME_FILES, bindRuntimeSources, freezeStudy } from '../src/benchmark/study.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';
import { projectFiles } from '../src/benchmark/export.mjs';
import { sha256 } from '../src/benchmark/prompts.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(repository, 'src/benchmark');
const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name => [name, await readFile(join(runtime, name), 'utf8')])));
const optional = RUNTIME_FILES.find(name => !CORE_RUNTIME_FILES.includes(name));
const pause = ms => new Promise(done => setTimeout(done, ms));

async function exported({ omit, extra } = {}) {
  const draft = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  const spec = await bindRuntimeSources(draft, sources);
  const supplied = { ...sources };
  if (omit) delete spec.runtimeSources[omit];
  if (extra) {
    supplied[extra] = '// Unused declaration outside the installed runtime inventory.\n';
    spec.runtimeSources[extra] = await sha256(supplied[extra]);
  }
  const files = await projectFiles(await freezeStudy(spec), supplied);
  // A missing declaration is still a refusal when the omitted file's bytes
  // are the harmless, unmodified installed source. No test payload executes.
  if (omit) files[omit] = sources[omit];
  return files;
}

async function fixture(t) {
  const work = join(repository, '.release-work/tmp');
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(join(work, 'run-admission-'));
  const store = new RunStore(root, runtime);
  await store.init();
  t.after(async () => { await store.shutdown(); await rm(root, { recursive: true, force: true }); });
  return { store, root };
}

test('submission refuses a missing installed optional pin before retaining or launching the package', async t => {
  assert.ok(optional, 'The configured installation has optional runtime modules.');
  const { store, root } = await fixture(t);
  const launches = [];
  store.launch = (...args) => launches.push(args);
  const files = await exported({ omit: optional });
  await assert.rejects(() => store.create({ projectId: 'missing-pin', files }), /complete installed runtime|runtime inventory/i);
  assert.equal(launches.length, 0, 'The launch sentinel is never reached.');
  assert.deepEqual(await readdir(join(root, 'runs')), []);
});

test('submission refuses unexpected runtime pins using the installed inventory', async t => {
  const { store, root } = await fixture(t);
  const launches = [];
  store.launch = (...args) => launches.push(args);
  const files = await exported({ extra: 'unused-declaration.mjs' });
  await assert.rejects(() => store.create({ projectId: 'extra-pin', files }), /complete installed runtime|runtime inventory/i);
  assert.equal(launches.length, 0, 'The launch sentinel is never reached.');
  assert.deepEqual(await readdir(join(root, 'runs')), []);
});

test('resume reapplies installed closure admission before queuing a stopped package', async t => {
  const { store } = await fixture(t);
  const launches = [];
  store.launch = (...args) => launches.push(args);
  const record = await store.create({ projectId: 'resume-pin', files: await exported() });
  record.status = 'failed';
  await store.persist(record);
  for (const [name, text] of Object.entries(await exported({ omit: optional }))) {
    const path = join(record.directory, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  launches.length = 0;
  await assert.rejects(() => store.resume(record.id), /complete installed runtime|runtime inventory/i);
  assert.equal(launches.length, 0, 'Resume cannot reach the launch sentinel.');
  assert.equal((await store.read(record.id)).status, 'failed');
});

test('recorded-control execution starts the installed CLI with the project directory as data', async t => {
  const { store } = await fixture(t);
  const record = await store.create({ projectId: 'trusted-cli', files: await exported() });
  let child;
  for (let count = 0; count < 1000 && !child; count++) {
    child = store.children.get(record.id)?.child;
    if (!child) await pause(5);
  }
  assert.ok(child, 'The installed CLI starts for an admitted recorded control.');
  assert.deepEqual(child.spawnargs, [process.execPath, join(runtime, 'cli.mjs'), 'verify', '--project', record.directory]);
  await store.executions.get(record.id).work;
  const retained = await store.read(record.id);
  assert.equal(retained.status, 'completed', retained.log);
  assert.deepEqual(retained.history.map(row => [row.command, row.code]), [['verify', 0], ['qualify', 0], ['run', 0], ['analyze', 0]]);
});

test('immediate shutdown retains child closure while its PID record is still being persisted', async t => {
  const work = join(repository, '.release-work/tmp');
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(join(work, 'run-admission-shutdown-'));
  const store = new RunStore(root, runtime);
  await store.init();
  let releasePersistence, publishChild, child, shutdown, settled = false, held = false;
  const persistenceGate = new Promise(done => { releasePersistence = done; });
  const published = new Promise(done => { publishChild = done; });
  const persist = store.persist.bind(store);
  store.persist = async record => {
    await persist(record);
    if (record.pid && !held) {
      held = true;
      child = store.children.get(record.id).child;
      publishChild();
      await persistenceGate;
    }
  };
  t.after(async () => {
    releasePersistence();
    if (!settled && child) {
      child.kill('SIGTERM');
      await new Promise(done => setImmediate(done));
      // Only a regressed implementation needs this cleanup event after the
      // owned fixture process has already closed. It prevents a failing test
      // from leaking the service's periodic persistence timer.
      if (child.exitCode !== null || child.signalCode !== null)
        child.emit('close', child.exitCode, child.signalCode);
    }
    await shutdown;
    await store.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  const record = await store.create({ projectId: 'immediate-shutdown', files: await exported() });
  await published;
  const closed = new Promise(done => child.once('close', done));
  shutdown = store.shutdown().finally(() => { settled = true; });
  await closed;
  releasePersistence();
  let deadline;
  try {
    await Promise.race([shutdown, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Shutdown missed the owned child closure.')), 1500);
    })]);
  } finally { clearTimeout(deadline); }
  assert.equal(store.children.size, 0);
  assert.equal(store.pending.size, 0);
  const retained = await store.read(record.id);
  assert.equal(retained.status, 'cancelled');
  assert.equal(retained.pid, undefined);
  assert.equal(retained.history.length, 1);
  assert.equal(retained.history[0].command, 'verify');
  assert.notEqual(retained.history[0].code, 0, 'The stopped child outcome remains in the process history.');
});
