import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { bindRuntimeSources, freezeStudy, RUNTIME_FILES } from '../src/benchmark/study.mjs';
import { newExperimentDraft, genericStarter } from '../src/benchmark/starters.mjs';
import { sha256 } from '../src/benchmark/prompts.mjs';
import { createAdapter, openProject } from '../src/benchmark/cli.mjs';
import { runStudy } from '../src/benchmark/runner.mjs';
import { projectFiles } from '../src/benchmark/export.mjs';

async function fixture() {
  const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async file =>
    [file, await readFile(new URL('../src/benchmark/' + file, import.meta.url), 'utf8')])));
  const spec = newExperimentDraft(genericStarter(), { purpose: 'apparatus-development', initializePopulation: true });
  spec.protocol.maxAttemptsPerTrial = 2;
  return { sources, spec };
}

for (const malformed of ['not-json', 'missing-output']) test('HTTP ' + malformed + ' is retained once without an observation plan', async () => {
  const { sources, spec } = await fixture();
  assert.equal(spec.observationPlan, undefined);
  spec.conditions[0].adapter = { kind: 'http', url: 'https://collector.invalid/collect' };
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  let calls = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response(malformed === 'not-json' ? 'retained malformed response' : '{"diagnostic":"retained missing output"}', { status: 200 }); };
  try {
    const { events, summary } = await runStudy(project, { adapter: createAdapter(resolve('.')) });
    assert.equal(calls, 1, 'a received malformed answer must never be redrawn');
    assert.equal(summary.completed, 0);
    const finished = events.filter(e => e.type === 'finished');
    assert.equal(finished.length, 1);
    assert.equal(finished[0].phase, 'extraction');
    assert.equal(finished[0].response.status, 200);
    assert.match(finished[0].response.body, /retained/);
  } finally { globalThis.fetch = saved; }
});

test('actual HTTP transport failure still retries within the frozen attempt budget', async () => {
  const { sources, spec } = await fixture();
  spec.conditions[0].adapter = { kind: 'http', url: 'https://collector.invalid/collect' };
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  let calls = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    if (++calls === 1) return new Response('temporary unavailable', { status: 503 });
    const request = JSON.parse(options.body);
    return new Response(JSON.stringify({ output: project.tasks.find(t => t.id === request.trial.taskId).expected }));
  };
  try {
    const { events, summary } = await runStudy(project, { adapter: createAdapter(resolve('.')) });
    assert.equal(calls, 3);
    assert.equal(summary.completed, 2);
    assert.equal(events.find(e => e.type === 'finished').phase, 'transport');
  } finally { globalThis.fetch = saved; }
});

test('command response without output is an extraction failure without a redraw', async () => {
  const { sources, spec } = await fixture();
  spec.conditions[0].adapter = { kind: 'command', command: process.execPath, args: ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({diagnostic:"retained missing output"})))'] };
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  let calls = 0;
  const adapter = createAdapter(resolve('.'));
  const { events, summary } = await runStudy(project, { adapter: args => { calls++; return adapter(args); } });
  assert.equal(calls, 1);
  assert.equal(summary.completed, 0);
  const finished = events.find(e => e.type === 'finished');
  assert.equal(finished.phase, 'extraction');
  assert.match(finished.response.stdout, /retained missing output/);
});

test('runnable exports require all pinned input bytes and verify with the complete attachment', async t => {
  const { sources, spec } = await fixture();
  const contents = 'authored dataset\n';
  spec.inputs.push({ path: 'data/dataset.txt', sha256: await sha256(contents) });
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  await assert.rejects(projectFiles(project, sources), /Attach pinned input data\/dataset.txt/);
  await assert.rejects(projectFiles(project, sources, { 'data/dataset.txt': 'changed bytes' }), /Attached input hash differs/);
  const files = await projectFiles(project, sources, { 'data/dataset.txt': contents });
  assert.equal(files['data/dataset.txt'], contents);
  await mkdir(resolve('.release-work'), { recursive: true });
  const folder = await mkdtemp(resolve('.release-work/pinned-input-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const [file, bytes] of Object.entries(files)) { await mkdir(dirname(join(folder, file)), { recursive: true }); await writeFile(join(folder, file), bytes); }
  const inspected = await openProject(folder);
  assert.equal(inspected.project.sha256, project.sha256);
  assert.equal(inspected.runtime.isThisRuntime, true);
});

test('in-process adapter envelope without output is terminal extraction evidence', async () => {
  const { sources, spec } = await fixture();
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  let calls = 0;
  const { events } = await runStudy(project, { adapter: async () => { calls++; return { diagnostic: 'retained response' }; } });
  assert.equal(calls, 1);
  const finished = events.find(e => e.type === 'finished');
  assert.equal(finished.phase, 'extraction');
  assert.deepEqual(finished.response, { diagnostic: 'retained response' });
});
