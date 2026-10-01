import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../server/store.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';

export const names = ['projects.list', 'project.get', 'atoms.list', 'atom.add', 'composition.update', 'tasks.generate', 'study.freeze', 'study.qualify', 'study.export', 'study.run', 'study.analyze', 'report.get'];
const spec = () => newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bench-mcp-'));
  const { createBenchService } = await import('../server/mcp-service.mjs');
  const app = await createBenchService({ dataDir: root });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const call = async (name, args = {}) => {
    const result = await app.callTool(name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const create = () => call('composition.update', { spec: spec() });
  const freeze = async () => { const project = await create(); return call('study.freeze', { projectId: project.id, revision: project.revision }); };
  return { app, root, call, create, freeze };
}
const failure = async (app, name, args, code) => {
  const result = await app.callTool(name, args);
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.equal(JSON.parse(result.content[0].text).error.code, code);
};

test('MCP offers exactly the twelve tools and truthful read annotations', async t => {
  const { app } = await fixture(t);
  const tools = app.listTools();
  assert.deepEqual(tools.map(x => x.name), names);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, ['projects.list', 'project.get', 'atoms.list', 'report.get'].includes(tool.name));
  }
});
test('projects.list pages the same store as the UI', async t => {
  const { root, call, create } = await fixture(t);
  await create(); await create();
  const store = new ProjectStore(root); await store.init(); await store.create('UI project');
  const first = await call('projects.list', { limit: 2 });
  const second = await call('projects.list', { offset: first.nextOffset, limit: 2 });
  assert.equal(first.items.length, 2); assert.equal(second.items.length, 1);
  assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, 3);
});
test('project.get returns editable spec shared with ProjectStore', async t => {
  const { root, call, create } = await fixture(t); const p = await create();
  const value = await call('project.get', { projectId: p.id });
  assert.deepEqual(value.draft.spec, (await new ProjectStore(root).read(p.id)).draft.spec);
});
test('atoms.list returns atoms from the selected catalog', async t => {
  const { call, create } = await fixture(t); const p = await create();
  const value = await call('atoms.list', { projectId: p.id });
  assert.deepEqual(value.items.map(x => x.id), ['task']);
});
test('atom.add saves a declared atom and refuses duplicate or stale edits', async t => {
  const { app, call, create } = await fixture(t); const p = await create();
  const atom = { id: 'extra', version: '1', kind: 'atom', role: 'node', text: 'Additional context.' };
  const next = await call('atom.add', { projectId: p.id, revision: p.revision, atom });
  assert.equal(next.revision, p.revision + 1);
  await failure(app, 'atom.add', { projectId: p.id, revision: p.revision, atom }, 'CONFLICT');
  await failure(app, 'atom.add', { projectId: p.id, revision: next.revision, atom }, 'INVALID_INPUT');
});
test('composition.update changes an existing task root and persists revision', async t => {
  const { call, create } = await fixture(t); const p = await create();
  const root = { use: 'task', params: { a: 2, b: 3 } };
  await call('composition.update', { projectId: p.id, revision: p.revision, taskId: 'addition-a', root });
  const saved = await call('project.get', { projectId: p.id });
  assert.deepEqual(saved.draft.spec.tasks[0].root, root);
});
test('tasks.generate requires declared choices and seed and is deterministic', async t => {
  const { app, call, create } = await fixture(t); const p = await create();
  const plan = { version: 1, seed: 7, rationale: 'Declared recorded control variants.', families: [{ id: 'arithmetic', split: 'development', task: { root: { use: 'task' }, input: null, expected: '5' }, axes: [{ id: 'wording', choices: [{ id: 'base', edits: [] }] }], constraints: [] }], selection: { kind: 'all', limit: 10 }, coverage: [] };
  const a = await call('tasks.generate', { projectId: p.id, revision: p.revision, plan });
  const b = await call('tasks.generate', { projectId: p.id, revision: a.revision, plan });
  assert.deepEqual(a.tasks, b.tasks); assert.equal(a.tasks.length, 1);
  const { seed, ...missingSeed } = plan;
  await failure(app, 'tasks.generate', { projectId: p.id, revision: b.revision, plan: missingSeed }, 'INVALID_INPUT');
});
test('study.freeze retains a frozen package without running collectors', async t => {
  const { root, freeze } = await fixture(t); const s = await freeze();
  assert.match(s.studyId, /^run-[a-f0-9]{32}$/); assert.match(s.sha256, /^[a-f0-9]{64}$/);
  const record = JSON.parse(await readFile(join(root, 'runs', s.studyId, 'run.json')));
  assert.equal(record.status, 'frozen'); assert.deepEqual(record.history, []);
  await assert.rejects(readFile(join(root, 'runs', s.studyId, 'project/results/attempts.jsonl')), { code: 'ENOENT' });
});
for (const name of ['study.run', 'study.qualify']) {
  test(`${name} refuses missing/wrong confirmation even with trust`, async t => {
    const { app, freeze } = await fixture(t); const s = await freeze();
    for (const confirm of [undefined, true, 'run-' + '0'.repeat(32)]) await failure(app, name, { studyId: s.studyId, ...(confirm === undefined ? {} : { confirm }), trust: true }, 'CONFIRM_REQUIRED');
  });
  test(`${name} refuses a foreign study, permits explicitly trusted installed runtime`, async t => {
    const a = await fixture(t); const s = await a.freeze(); const b = await fixture(t);
    await cp(join(a.root, 'runs', s.studyId), join(b.root, 'runs', s.studyId), { recursive: true });
    await failure(b.app, name, { studyId: s.studyId, confirm: s.studyId }, 'FOREIGN_STUDY');
    const result = await b.call(name, { studyId: s.studyId, confirm: s.studyId, trust: true });
    assert.equal(result.status, 'completed');
  });
}
test('study.qualify uses existing qualification with confirmation', async t => {
  const { call, freeze, root } = await fixture(t); const s = await freeze();
  const result = await call('study.qualify', { studyId: s.studyId, confirm: s.studyId });
  assert.equal(result.status, 'completed');
  assert.ok(JSON.parse(await readFile(join(root, 'runs', s.studyId, 'project/results/qualification.json'))).projectSha256);
});
test('study.export writes a ZIP reference confined to the data root', async t => {
  const { call, freeze, root } = await fixture(t); const s = await freeze();
  const result = await call('study.export', { studyId: s.studyId });
  assert.equal(result.artifact, `runs/${s.studyId}/study.zip`);
  const bytes = await readFile(join(root, result.artifact)); assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.length, result.bytes);
});
test('study.run, study.analyze and report.get complete a recorded lifecycle', async t => {
  const { call, freeze } = await fixture(t); const s = await freeze();
  assert.equal((await call('study.run', { studyId: s.studyId, confirm: s.studyId })).status, 'completed');
  assert.equal((await call('study.analyze', { studyId: s.studyId })).status, 'completed');
  const report = await call('report.get', { studyId: s.studyId, format: 'summary' });
  assert.equal(report.data.completed, 2); assert.equal(report.data.scheduled, 2);
});
test('all ID/path inputs refuse traversal and unknown fields', async t => {
  const { app, freeze, create } = await fixture(t); const s = await freeze(); const p = await create();
  for (const projectId of ['../../outside', '/etc/passwd', 'rp-' + '0'.repeat(32) + '/x']) await failure(app, 'project.get', { projectId }, 'INVALID_INPUT');
  await failure(app, 'report.get', { studyId: s.studyId, format: '../../outside' }, 'INVALID_INPUT');
  await failure(app, 'study.export', { studyId: s.studyId, path: '/outside.zip' }, 'INVALID_INPUT');
  await failure(app, 'project.get', { projectId: p.id, path: '/outside' }, 'INVALID_INPUT');
});
test('project symlink escape refuses without reading outside data', async t => {
  const { app, root, create } = await fixture(t); const p = await create();
  const file = join(root, 'projects', p.id + '.json'); await rm(file);
  await symlink('/etc/passwd', file);
  await failure(app, 'project.get', { projectId: p.id }, 'UNSAFE_PATH');
  await failure(app, 'projects.list', {}, 'UNSAFE_PATH');
});
test('run/result symlinks and forged absolute record.directory refuse', async t => {
  const { app, root, freeze } = await fixture(t); const s = await freeze();
  const recordFile = join(root, 'runs', s.studyId, 'run.json');
  const record = JSON.parse(await readFile(recordFile)); record.directory = '/outside';
  await writeFile(recordFile, JSON.stringify(record));
  // The server must derive its path from the ID, never this stored hint.
  const result = await app.callTool('study.run', { studyId: s.studyId, confirm: s.studyId });
  assert.ok(!result.isError, JSON.stringify(result));
  await rm(join(root, 'runs', s.studyId, 'project/results'), { recursive: true });
  await symlink('/tmp', join(root, 'runs', s.studyId, 'project/results'));
  await failure(app, 'study.analyze', { studyId: s.studyId }, 'UNSAFE_PATH');
});
test('tampered local provenance cannot silently authorize execution', async t => {
  const { app, root, freeze } = await fixture(t); const s = await freeze();
  const file = join(root, 'runs', s.studyId, 'run.json'); const record = JSON.parse(await readFile(file));
  record.localOrigin = { trusted: true }; await writeFile(file, JSON.stringify(record));
  await failure(app, 'study.run', { studyId: s.studyId, confirm: s.studyId }, 'FOREIGN_STUDY');
});
test('responses are bounded and credential values are redacted', async t => {
  const { root, call, app, create } = await fixture(t); const p = await create();
  const store = new ProjectStore(root); const record = await store.read(p.id);
  record.draft.spec.environment.apiKey = 'synthetic-private-value';
  record.draft.spec.decisions = 'Authorization: Bearer synthetic-bearer-value';
  await store.save(p.id, record.draft, record.revision);
  const result = JSON.stringify(await call('project.get', { projectId: p.id }));
  assert.ok(!result.includes('synthetic-private-value')); assert.ok(!result.includes('synthetic-bearer-value'));
  record.draft.spec.decisions = 'x'.repeat(200000);
  await store.save(p.id, record.draft, record.revision + 1);
  const bounded = await app.callTool('project.get', { projectId: p.id });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 70000);
});
test('new MCP server instance retains local provenance', async t => {
  const { app, root, freeze } = await fixture(t); const s = await freeze(); await app.close();
  const { createBenchService } = await import('../server/mcp-service.mjs'); const restarted = await createBenchService({ dataDir: root });
  t.after(() => restarted.close());
  assert.ok(!(await restarted.callTool('study.qualify', { studyId: s.studyId, confirm: s.studyId })).isError);
});

test('the complete MCP envelope remains within 64 KiB for heavily escaped text', async t => {
  const { app, root, create } = await fixture(t); const p = await create();
  const store = new ProjectStore(root), record = await store.read(p.id);
  record.draft.spec.decisions = '\\"'.repeat(14000);
  await store.save(p.id, record.draft, record.revision);
  const result = await app.callTool('project.get', { projectId: p.id });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);
});
test('all ordinary token fields and paged report credentials are redacted', async t => {
  const { app, root, create, call, freeze } = await fixture(t); const p = await create();
  const store = new ProjectStore(root), record = await store.read(p.id);
  record.draft.credentials = { token: 'synthetic-token-field' };
  record.draft.token = 'synthetic-bare-token';
  await store.save(p.id, record.draft, record.revision);
  const reply = JSON.stringify(await app.callTool('project.get', { projectId: p.id }));
  assert.ok(!reply.includes('synthetic-token-field')); assert.ok(!reply.includes('synthetic-bare-token'));
  const s = await freeze();
  await mkdir(join(root, 'runs', s.studyId, 'project/results'));
  await writeFile(join(root, 'runs', s.studyId, 'project/results/report.md'), 'prefix Authorization: Bearer synthetic-report-token suffix');
  const page = await call('report.get', { studyId: s.studyId, format: 'markdown', offset: 25, limit: 16 });
  assert.ok(!JSON.stringify(page).includes('synthetic-report-token'));
});
test('a failed execution is an MCP tool error with retained status, never a success', async t => {
  const { app, call } = await fixture(t);
  const p = await call('composition.update', { spec: newExperimentDraft(genericStarter(), { initializePopulation: true }) });
  const s = await call('study.freeze', { projectId: p.id, revision: p.revision });
  await failure(app, 'study.run', { studyId: s.studyId, confirm: s.studyId }, 'EXECUTION_FAILED');
  const status = await call('report.get', { studyId: s.studyId, format: 'status' });
  assert.equal(status.status, 'failed'); assert.equal(status.history.at(-1).code, 1);
});

test('MCP shutdown settles a confirmed local collector and its owned process', { timeout: 15000 }, async t => {
  const { app, call, root } = await fixture(t);
  const { sha256 } = await import('../src/benchmark/prompts.mjs');
  const declared = newExperimentDraft(genericStarter(), { purpose: 'apparatus-development', initializePopulation: true });
  const collector = `import {writeFileSync} from 'node:fs'; process.stdin.resume(); writeFileSync('ready.json', JSON.stringify({pid:process.pid})); setTimeout(()=>process.stdout.write(JSON.stringify({output:'5'})),30000);`;
  declared.inputs = [{ path: 'slow.mjs', sha256: await sha256(collector) }];
  declared.conditions[0].adapter = { kind: 'command', command: process.execPath, args: ['slow.mjs'] };
  const p = await call('composition.update', { draft: { spec: declared, attachments: { 'slow.mjs': collector } } });
  const s = await call('study.freeze', { projectId: p.id, revision: p.revision });
  const pending = app.callTool('study.run', { studyId: s.studyId, confirm: s.studyId });
  let pid;
  for (let i = 0; i < 300 && !pid; i++) {
    try { pid = JSON.parse(await readFile(join(root, 'runs', s.studyId, 'project/ready.json'))).pid; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!pid) await new Promise(done => setTimeout(done, 20));
  }
  assert.ok(pid, 'collector actually started before shutdown');
  await app.close(); assert.equal((await pending).isError, true);
  const retained = JSON.parse(await readFile(join(root, 'runs', s.studyId, 'run.json')));
  assert.equal(retained.status, 'cancelled'); assert.equal(retained.pid, undefined);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('MCP analysis never invokes a retained custom grader', async t => {
  const { call, root } = await fixture(t);
  const { sha256, canonical } = await import('../src/benchmark/prompts.mjs');
  const { runStudy } = await import('../src/benchmark/runner.mjs');
  const { developmentStarter } = await import('../tools/test/fixtures/research-benchmark-development.mjs');
  const declared = developmentStarter();
  const grader = `import {writeFileSync} from 'node:fs'; export function grade(){writeFileSync('grader-ran','yes');throw new Error('must not execute');}`;
  declared.protocol.grading = { kind: 'module', file: 'grader.mjs' };
  declared.inputs.push({ path: 'grader.mjs', sha256: await sha256(grader) });
  const p = await call('composition.update', { draft: { spec: declared, attachments: { 'grader.mjs': grader } } });
  const s = await call('study.freeze', { projectId: p.id, revision: p.revision });
  const directory = join(root, 'runs', s.studyId, 'project');
  const project = JSON.parse(await readFile(join(directory, 'project.json')));
  const { events } = await runStudy(project, { grade: (project, task, output) => ({ passed: output === task.expected, score: output === task.expected ? 1 : 0, classification: 'authored-control' }) });
  await mkdir(join(directory, 'results')); await writeFile(join(directory, 'results/attempts.jsonl'), events.map(canonical).join('\n') + '\n');
  await call('study.analyze', { studyId: s.studyId });
  assert.equal((await call('report.get', { studyId: s.studyId })).data.customGrading.verification, 'retained-not-reexecuted');
  await assert.rejects(readFile(join(directory, 'grader-ran')), { code: 'ENOENT' });
});
