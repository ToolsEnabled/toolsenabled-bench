import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, link, lstat, open, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { RUNTIME_FILES, bindRuntimeSources, freezeStudy } from '../src/benchmark/study.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';
import { projectFiles } from '../src/benchmark/export.mjs';
import { runStudy } from '../src/benchmark/runner.mjs';
import { canonical, sha256 } from '../src/benchmark/prompts.mjs';
import { researchReportFiles } from '../src/benchmark/report.mjs';

const cli = fileURLToPath(new URL('../src/benchmark/cli.mjs', import.meta.url));
const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name => [name, await readFile(new URL('../src/benchmark/' + name, import.meta.url), 'utf8')])));
async function fixture(t) {
  const base = resolve(process.env.BENCH_OUTPUT_TEST_ROOT || '.release-work/tmp');
  await mkdir(base, { recursive: true });
  const lane = await mkdtemp(join(base, 'output-safety-')), root = join(lane, 'study');
  if (!process.env.BENCH_OUTPUT_TEST_ROOT) t.after(() => rm(lane, { recursive: true, force: true }));
  const project = await freezeStudy(await bindRuntimeSources(newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true }), sources));
  const files = await projectFiles(project, sources);
  for (const [name, text] of Object.entries(files)) { const path = join(root, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
  const { events } = await runStudy(project);
  const output = join(root, 'results'); await mkdir(output);
  await writeFile(join(output, 'attempts.jsonl'), events.map(canonical).join('\n') + '\n');
  const sentinel = join(lane, 'sentinel'); await writeFile(sentinel, 'PRESERVE SENTINEL\n');
  return { lane, root, output, sentinel, project, events };
}
function command(root, action, output) {
  const args = [cli, action, '--project', root, ...(output ? ['--output', output] : [])];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH } });
  assert.equal(result.error, undefined);
  return result;
}
async function refused(f, action, output) {
  const result = command(f.root, action, output);
  assert.notEqual(result.status, 0, `${action} must refuse unsafe output`);
  assert.match(result.stderr, /Output .*symlink|Output .*multiply linked|Output needs regular/);
  assert.equal(await readFile(f.sentinel, 'utf8'), 'PRESERVE SENTINEL\n');
}
for (const action of ['analyze', 'reference', 'qualify', 'regrade', 'run', 'verify-native']) {
  test(`${action} refuses symlink output root before any writes`, async t => {
    const f = await fixture(t), target = join(f.lane, 'outside'); await mkdir(target);
    const output = join(f.lane, 'linked-results'); await symlink(target, output, 'dir');
    await refused(f, action, output);
    assert.deepEqual(await readdir(target), []);
  });
}
test('analyze refuses symlink ancestor of a missing --output directory before mkdir', async t => {
  const f = await fixture(t), target = join(f.lane, 'outside'); await mkdir(target);
  const ancestor = join(f.lane, 'linked-parent'); await symlink(target, ancestor, 'dir');
  await refused(f, 'analyze', join(ancestor, 'new-results'));
  assert.deepEqual(await readdir(target), []);
});
for (const [action, name] of [['analyze', 'report.md'], ['analyze', 'evidence.json'], ['reference', 'reference-bundle.json'], ['qualify', 'qualification.json'], ['regrade', 'custom-grade-verification.json'], ['run', 'attempts.jsonl']]) {
  test(`${action} refuses symlink destination ${name} and preserves earlier outputs`, async t => {
    const f = await fixture(t);
    if (name === 'attempts.jsonl') await rm(join(f.output, name));
    await writeFile(join(f.output, 'report.html'), 'EARLIER REPORT\n');
    await symlink(f.sentinel, join(f.output, name));
    const before = await readdir(f.output);
    await refused(f, action);
    assert.deepEqual(await readdir(f.output), before, 'no partial artifacts or run locks');
    assert.equal(await readFile(join(f.output, 'report.html'), 'utf8'), 'EARLIER REPORT\n');
  });
}
test('analyze refuses symlink nested report directory before changing any output', async t => {
  const f = await fixture(t), target = join(f.lane, 'outside'); await mkdir(target);
  await symlink(target, join(f.output, 'figures'), 'dir');
  const before = await readdir(f.output);
  await refused(f, 'analyze');
  assert.deepEqual(await readdir(f.output), before); assert.deepEqual(await readdir(target), []);
});
for (const [action, name] of [['analyze', 'report.md'], ['reference', 'reference-bundle.json'], ['run', 'attempts.jsonl']]) {
  test(`${action} refuses hardlinked destination ${name} before any writes`, async t => {
    const f = await fixture(t);
    if (name === 'attempts.jsonl') await rm(join(f.output, name));
    await link(f.sentinel, join(f.output, name));
    const before = await readdir(f.output);
    await refused(f, action);
    assert.deepEqual(await readdir(f.output), before);
    assert.equal((await lstat(f.sentinel)).nlink, 2);
  });
}
test('known directory at a file destination refuses the whole report batch', async t => {
  const f = await fixture(t);
  await mkdir(join(f.output, 'evidence.json')); await writeFile(join(f.output, 'report.html'), 'EARLIER REPORT\n');
  const before = await readdir(f.output), result = command(f.root, 'analyze');
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Output needs regular/);
  assert.deepEqual(await readdir(f.output), before);
  assert.equal(await readFile(join(f.output, 'report.html'), 'utf8'), 'EARLIER REPORT\n');
});
test('normal analyze atomically replaces files with deterministic report bytes and supports --output/reference', async t => {
  const f = await fixture(t), target = join(f.output, 'report.md');
  await writeFile(target, 'OLD OPEN FILE\n'); const old = await open(target, 'r'), inode = (await old.stat()).ino;
  t.after(() => old.close());
  const result = command(f.root, 'analyze'); assert.equal(result.status, 0, result.stderr);
  assert.equal(await old.readFile('utf8'), 'OLD OPEN FILE\n', 'old open file is never truncated');
  assert.notEqual((await lstat(target)).ino, inode);
  const expected = await researchReportFiles(f.project, f.events, {
    provenance: JSON.parse(await readFile(join(f.root, 'provenance.json'), 'utf8')),
    attributions: await readFile(join(f.root, 'ATTRIBUTIONS.md'), 'utf8'),
    manifest: await readFile(join(f.root, 'manifest.json'), 'utf8'),
    qualification: null, nativeVerification: null,
    runtimeIntegrity: Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, text]) => [name, await sha256(text)]))),
  });
  for (const [name, text] of Object.entries(expected)) assert.equal(await readFile(join(f.output, name), 'utf8'), text, name);
  assert.equal(command(f.root, 'analyze').status, 0);
  for (const [name, text] of Object.entries(expected)) assert.equal(await readFile(join(f.output, name), 'utf8'), text, name + ' repeat');
  const custom = join(f.lane, 'custom-results'); await mkdir(custom);
  await writeFile(join(custom, 'attempts.jsonl'), await readFile(join(f.output, 'attempts.jsonl')));
  const analyzed = command(f.root, 'analyze', custom); assert.equal(analyzed.status, 0, analyzed.stderr);
  assert.equal(await readFile(join(custom, 'report.md'), 'utf8'), expected['report.md']);
  const reference = command(f.root, 'reference', custom); assert.equal(reference.status, 0, reference.stderr);
  const bundleBytes = await readFile(join(custom, 'reference-bundle.json'), 'utf8');
  assert.equal(JSON.parse(reference.stdout).sha256, JSON.parse(bundleBytes).sha256);
  assert.equal(command(f.root, 'reference', custom).status, 0);
  assert.equal(await readFile(join(custom, 'reference-bundle.json'), 'utf8'), bundleBytes);
  assert.equal((await readdir(custom)).some(name => name.endsWith('.tmp')), false);
});

for (const replacement of ['symlink', 'regular']) test(`journal opening refuses a ${replacement} replacement at the open boundary`, async t => {
  const f = await fixture(t), launcher = join(f.lane, 'replace-journal.mjs');
  const journal = join(f.output, 'attempts.jsonl'), saved = join(f.lane, 'retained-journal.jsonl');
  const before = await readFile(journal, 'utf8');
  await writeFile(launcher, `
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.open;
fs.open = async (path, flags, ...rest) => {
  if (path !== ${JSON.stringify(journal)} || typeof flags !== 'number' || !(flags & constants.O_APPEND)) return original(path, flags, ...rest);
  ${replacement === 'regular' ? 'const handle = await original(path, flags, ...rest);' : ''}
  await fs.rename(path, ${JSON.stringify(saved)});
  ${replacement === 'symlink'
    ? `await fs.symlink(${JSON.stringify(f.sentinel)}, path); return original(path, flags, ...rest);`
    : `await fs.writeFile(path, 'REPLACEMENT JOURNAL\\n'); return handle;`}
};
syncBuiltinESMExports();
const { main } = await import(${JSON.stringify(new URL('../src/benchmark/cli.mjs', import.meta.url).href)});
await main(['run', '--project', ${JSON.stringify(f.root)}]).catch(error => {
  process.stderr.write((error.code || 'NO_CODE') + ': ' + error.message + '\\n'); process.exitCode = 1;
});
`);
  const result = spawnSync(process.execPath, [launcher], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH } });
  assert.notEqual(result.status, 0, 'a journal replaced at open must refuse collection');
  assert.match(result.stderr, replacement === 'symlink' ? /ELOOP/ : /Output journal changed while opening/);
  assert.equal(await readFile(saved, 'utf8'), before, 'the original journal stays unchanged');
  assert.equal(await readFile(f.sentinel, 'utf8'), 'PRESERVE SENTINEL\n');
  assert.equal((await readdir(f.output)).includes('responses'), false, 'no collector response is retained before refusal');
});
