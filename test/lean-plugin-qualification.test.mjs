import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_FILES, bindRuntimeSources, freezeStudy } from '../src/benchmark/study.mjs';
import { newExperimentDraft } from '../src/benchmark/starters.mjs';
import { leanStarter } from '../src/benchmark/lean.mjs';
import { operationalStarter } from '../src/benchmark/trading-catalog.mjs';
import { bindLeanReview } from '../src/benchmark/lean-codegen.mjs';
import { projectFiles } from '../src/benchmark/export.mjs';
import { createReviewRecord } from '../src/benchmark/prompts.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(repository, '.release-work');
const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name => [name, await readFile(join(repository, 'src/benchmark', name), 'utf8')])));

for (const [name, starter] of [['synchronous', leanStarter], ['operational', operationalStarter]]) {
  test(`the ${name} Lean plugin qualifies and replays a recorded control from a fresh export`, async t => {
    await mkdir(work, { recursive: true });
    const root = await mkdtemp(join(work, `lean-${name}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    let spec = newExperimentDraft(await starter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
    spec = await bindLeanReview(spec, sources);
    spec.reviews = await Promise.all(spec.catalog.map(bundle => createReviewRecord(spec.catalog, bundle.id,
      'SYNTHETIC PLUGIN QUALIFICATION FIXTURE ONLY', { at: '2026-09-30T00:00:00.000Z' })));
    const project = await freezeStudy(await bindRuntimeSources(spec, sources));
    const files = await projectFiles(project, sources);
    for (const [name, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), contents);
    }
    for (const command of ['verify', 'qualify', 'run', 'analyze']) {
      const result = spawnSync(process.execPath, ['cli.mjs', command], { cwd: root, encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 0, command + '\n' + result.stdout + result.stderr);
    }
    const qualification = JSON.parse(await readFile(join(root, 'results/qualification.json'), 'utf8'));
    assert.equal(qualification.projectSha256, project.sha256);
    assert.ok(qualification.checks.some(check => check.kind === 'independent-interpretation' && check.passed));
    assert.equal(qualification.checks.filter(check => check.kind === 'apparatus-control').length, name === 'synchronous' ? 10 : 0);
    const evidence = JSON.parse(await readFile(join(root, 'results/evidence.json'), 'utf8'));
    assert.equal(evidence.summary.completed, 1);
    assert.equal(evidence.summary.rows[0].passed, true);
  });
}
