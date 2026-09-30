import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandAdapter } from '../src/benchmark/cli.mjs';
import { RunStore } from '../server/runs.mjs';
import { RUNTIME_FILES, bindRuntimeSources, freezeStudy } from '../src/benchmark/study.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';
import { projectFiles } from '../src/benchmark/export.mjs';
import { sha256 } from '../src/benchmark/prompts.mjs';

const work = resolve(dirname(fileURLToPath(import.meta.url)), '../.release-work');
const pause = ms => new Promise(done => setTimeout(done, ms));

test('cancelling a running command joins the owned process before returning', async t => {
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(join(work, 'command-cancellation-'));
  const children = new Set(), controller = new AbortController();
  let pending;
  t.after(async () => {
    for (const child of children) child.kill('SIGKILL');
    await pending;
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, 'slow.mjs'), `
import { writeFileSync } from 'node:fs';
process.stdin.resume();
writeFileSync('ready.json', JSON.stringify({ pid: process.pid }));
setTimeout(() => process.stdout.write(JSON.stringify({ output: '5' })), 30000);
`);
  let outcome;
  pending = commandAdapter(root, { command: process.execPath, args: ['slow.mjs'] }, {}, controller.signal, children)
    .then(value => { outcome = { value }; }, error => { outcome = { error }; });
  let ready;
  for (let count = 0; count < 150 && !ready; count++) {
    try { ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!ready) await pause(20);
  }
  assert.ok(ready?.pid, 'The collector started before cancellation.');
  assert.equal(children.size, 1);
  controller.abort(new Error('Recorded cancellation request'));
  for (let count = 0; count < 150 && !outcome; count++) await pause(20);
  assert.ok(outcome, 'Cancellation must settle without waiting for the 30-second collector.');
  assert.equal(children.size, 0, 'The adapter retains ownership until actual process closure.');
  assert.match(outcome.error?.message || '', /Recorded cancellation request/);
  assert.equal(outcome.error.evidence.exitCode, null);
  assert.equal(outcome.error.evidence.signal, 'SIGKILL');
});

test('host shutdown waits for cancellation, journal settlement, and the persisted run record', async t => {
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(join(work, 'run-shutdown-'));
  const runtime = resolve(work, '../src/benchmark'), store = new RunStore(root, runtime);
  let collectorPid, record;
  t.after(async () => {
    if (collectorPid && store.pending.has(record.id)) {
      try { process.kill(collectorPid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await store.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  await store.init();
  const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name => [name, await readFile(join(runtime, name), 'utf8')])));
  const spec = newExperimentDraft(genericStarter(), { purpose: 'apparatus-development', initializePopulation: true });
  const collector = `import { writeFileSync } from 'node:fs';
process.stdin.resume();
writeFileSync('ready.json', JSON.stringify({ pid: process.pid }));
setTimeout(() => process.stdout.write(JSON.stringify({ output: '5' })), 30000);\n`;
  spec.inputs = [{ path: 'slow.mjs', sha256: await sha256(collector) }];
  spec.conditions[0].adapter = { kind: 'command', command: process.execPath, args: ['slow.mjs'] };
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  const files = await projectFiles(project, sources, { 'slow.mjs': collector });
  record = await store.create({ projectId: 'shutdown-fixture', files });
  for (let count = 0; count < 300 && !collectorPid; count++) {
    try { collectorPid = JSON.parse(await readFile(join(record.directory, 'ready.json'), 'utf8')).pid; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!collectorPid) await pause(20);
  }
  assert.ok(collectorPid, 'The collector started before host shutdown.');
  await store.shutdown();
  assert.equal(store.children.size, 0);
  assert.equal(store.pending.size, 0);
  const retained = JSON.parse(await readFile(join(root, 'runs', record.id, 'run.json'), 'utf8'));
  assert.equal(retained.status, 'cancelled');
  assert.equal(retained.pid, undefined);
  assert.equal(retained.history.at(-1).command, 'run');
  const events = (await store.artifact(record.id, 'attempts.jsonl')).toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].type, 'started');
  assert.equal(events.at(-1).status, 'cancelled');
  assert.equal(events.at(-1).grade, undefined);
});
