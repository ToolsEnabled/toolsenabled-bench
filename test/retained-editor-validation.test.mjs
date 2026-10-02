import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBenchService } from '../server/mcp-service.mjs';
import { emptyCompositionGeneration } from '../src/research-composition-generator.mjs';
import { emptyNestingForm } from '../src/research-nesting.mjs';
import { emptyVarianceState, emptyVarianceRun } from '../src/research-variance.mjs';
import { emptyPromptSetState } from '../src/research-prompt-set.mjs';
import { emptyPipelineDraft } from '../src/research-pipeline.mjs';
import { emptyChecksDraft } from '../src/research-checks.mjs';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bench-retained-shapes-'));
  const app = await createBenchService({ dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const call = async (name, args = {}) => {
    const result = await app.callTool(name, args); assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const p = await call('composition.update');
  return { app, call, p, path: join(dataDir, 'projects', p.id + '.json') };
}
const malformed = [
  ['variance-draft', { studies: {} }], ['variance-draft', { studies: [null] }],
  ['variance-draft', { studies: [{ marks: {} }] }], ['variance-draft', { run: { members: {} } }],
  ['nesting-draft', { form: { members: {} } }], ['nesting-draft', { review: { rows: {} } }],
  ['composition-generation-draft', { form: { parts: {} } }], ['composition-generation-draft', { handcrafted: {} }],
  ['prompt-set-draft', { studies: {} }], ['prompt-set-draft', { weights: [] }],
  ['pipeline-draft', { rows: {} }], ['checks-draft', { checks: {} }],
  ['variance-draft', []], ['variance-draft', null],
];
for (const [name, value] of malformed) test(`MCP refuses malformed ${name} ${JSON.stringify(value)} before saving`, async t => {
  const { app, call, p, path } = await fixture(t), before = await readFile(path);
  const record = await call('project.get', { projectId: p.id });
  record.draft.editors = { ['data-bench-' + name]: JSON.stringify(value) };
  const result = await app.callTool('composition.update', { projectId: p.id, revision: p.revision, draft: record.draft });
  assert.equal(result.isError, true, 'invalid editor state must be refused before writing a new revision');
  const error = JSON.parse(result.content[0].text).error;
  assert.equal(error.code, 'INVALID_INPUT'); assert.ok(error.message.includes(name), error.message);
  assert.ok((await readFile(path)).equals(before));
});

test('MCP validates retained editor shapes inside Undo and before creating projects', async t => {
  const { app, call, p, path } = await fixture(t), before = await readFile(path);
  const { draft } = await call('project.get', { projectId: p.id });
  draft.undo = { ...structuredClone(draft), editors: { 'data-bench-variance-draft': '{"studies":{}}' } };
  for (const args of [{ projectId: p.id, revision: p.revision, draft }, { draft }]) {
    const result = await app.callTool('composition.update', args);
    assert.equal(result.isError, true); assert.match(result.content[0].text, /undo.*variance-draft/);
  }
  assert.ok((await readFile(path)).equals(before));
  assert.equal((await call('projects.list')).items.length, 1);
});

test('MCP preserves valid retained editors and unfinished authored JSON exactly', async t => {
  const { call, p } = await fixture(t), { draft } = await call('project.get', { projectId: p.id });
  const states = {
    'composition-generation-draft': emptyCompositionGeneration(), 'nesting-draft': { form: emptyNestingForm(), review: null },
    'variance-draft': { ...emptyVarianceState(), run: emptyVarianceRun() }, 'prompt-set-draft': emptyPromptSetState(),
    'pipeline-draft': emptyPipelineDraft(), 'checks-draft': emptyChecksDraft(),
  };
  draft.editors = Object.fromEntries(Object.entries(states).map(([key,value]) => ['data-bench-' + key, JSON.stringify(value)]));
  draft.editors['data-bench-routing'] = 'unfinished {';
  draft.editors['data-bench-task-json'] = 'unfinished {'; draft.pending = ['task'];
  await call('composition.update', { projectId: p.id, revision: p.revision, draft });
  assert.deepEqual((await call('project.get', { projectId: p.id })).draft, draft);
});

test('MCP unrelated atom edits retain misshapen authored routing JSON verbatim', async t => {
  const { call, p } = await fixture(t);
  let project = await call('project.get', { projectId: p.id });
  for (const value of [null, [], true, 'unfinished', { fields: {} }, { compositions: {} }, { rules: {} }, { decisions: [{ rules: {} }] }]) {
    const raw = JSON.stringify(value); project.draft.editors = { 'data-bench-routing': raw };
    project = await call('composition.update', { projectId: p.id, revision: project.revision, draft: project.draft });
    await call('atom.add', { projectId: p.id, revision: project.revision, atom: { id: 'routing-' + project.revision, version: '1', kind: 'atom', role: 'node', text: 'Unrelated edit' } });
    project = await call('project.get', { projectId: p.id });
    assert.equal(project.draft.editors['data-bench-routing'], raw);
  }
});
