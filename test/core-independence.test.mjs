import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundlePlugins } from '../tools/plugin-bundle.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const vertical = /^(?:lean(?:[.-]|$)|trading[-_.]|execution[-_]lean|execution\.mjs$|execution_reference\.py$)/;

for (const withSql of [false, true]) test(`core runs ${withSql ? 'SQL' : 'generic'} recorded controls with all Lean/trading files physically absent`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'benchmark-no-domain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime');
  await mkdir(runtime);
  for (const name of await readdir(resolve(repository, 'src/benchmark'))) {
    if (vertical.test(name) || name === 'plugins.mjs' || name === 'runtime-inventory.mjs') continue;
    if (!/\.(mjs|py|json)$/.test(name)) continue;
    await writeFile(join(runtime, name), await readFile(resolve(repository, 'src/benchmark', name)));
  }
  const bundle = await bundlePlugins({ root: repository, entries: withSql ? ['./tools/test/fixtures/research-benchmark-third-party-plugin.mjs'] : [], includeLean: false });
  await writeFile(join(runtime, 'plugins.mjs'), bundle.source);
  await writeFile(join(runtime, 'runtime-inventory.mjs'), 'export const PLUGIN_RUNTIME_FILES = [];\n');
  await writeFile(join(root, 'freeze.mjs'), `
    import { readFile, writeFile, mkdir } from 'node:fs/promises';
    import { dirname } from 'node:path';
    import { RUNTIME_FILES, bindRuntimeSources, freezeStudy } from './runtime/study.mjs';
    import { genericStarter, newExperimentDraft } from './runtime/starters.mjs';
    import { starterById } from './runtime/registry.mjs';
    import { projectFiles } from './runtime/export.mjs';
    let spec = ${withSql ? "await starterById('sql-basic').create()" : "newExperimentDraft(genericStarter(), {purpose:'recorded-diagnostic',initializePopulation:true})"};
    spec.executionPlan.purpose='recorded-diagnostic';
    const sources=Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name=>[name,await readFile(new URL('./runtime/'+name,import.meta.url),'utf8')])));
    const project=await freezeStudy(await bindRuntimeSources(spec,sources));
    const files=await projectFiles(project,sources);
    for(const [name,text] of Object.entries(files)){ const path=new URL('./export/'+name,import.meta.url); await mkdir(dirname(path.pathname),{recursive:true}); await writeFile(path,text); }
    console.log(JSON.stringify({runtime:project.runtimeFiles,domain:project.spec.domain}));
  `);
  const frozen = spawnSync(process.execPath, ['freeze.mjs'], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(frozen.status, 0, frozen.stdout + frozen.stderr);
  const metadata = JSON.parse(frozen.stdout.trim());
  assert.equal(metadata.domain, withSql ? 'sql-bench' : 'generic');
  assert.deepEqual(metadata.runtime.filter(name => vertical.test(name)), []);
  for (const command of ['verify', 'qualify', 'run', 'analyze']) {
    const result = spawnSync(process.execPath, ['cli.mjs', command], { cwd: join(root, 'export'), encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, command + '\n' + result.stdout + result.stderr);
  }
  const evidence = JSON.parse(await readFile(join(root, 'export/results/evidence.json'), 'utf8'));
  assert.equal(evidence.summary.completed, 2);
  assert.doesNotMatch(await readFile(join(root, 'export/README.md'), 'utf8'), /Lean Bench|LEAN engine|native LEAN/);
});
