import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { RUNTIME_FILES, bindRuntimeSources, freezeStudy } from '../src/benchmark/study.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';
import { projectFiles } from '../src/benchmark/export.mjs';
import { sqlBenchDraft } from '../tools/test/fixtures/research-benchmark-third-party-plugin.mjs';
import { sha256 } from '../src/benchmark/prompts.mjs';
import { bundlePlugins } from '../tools/plugin-bundle.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async file =>
  [file, await readFile(new URL('../src/benchmark/' + file, import.meta.url), 'utf8')])));
const sqlEntries = ['./tools/test/fixtures/research-benchmark-third-party-plugin.mjs'];

async function writeFiles(root, files) {
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
}
function cli(root, command) {
  return spawnSync(process.execPath, ['cli.mjs', command], { cwd: root, encoding: 'utf8', timeout: 20000 });
}
async function isolatedRuntime(t, entries = sqlEntries) {
  const root = await mkdtemp(join(tmpdir(), 'benchmark-plugin-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = await bundlePlugins({ root: repository, entries });
  const runtimeSources = { ...sources, 'plugins.mjs': bundle.source };
  const compiler = join(root, 'compiler');
  await writeFiles(compiler, { ...runtimeSources, 'export.mjs': await readFile(resolve(repository, 'src/benchmark/export.mjs'), 'utf8') });
  const study = await import(pathToFileURL(join(compiler, 'study.mjs')));
  const registry = await import(pathToFileURL(join(compiler, 'registry.mjs')));
  const exporter = await import(pathToFileURL(join(compiler, 'export.mjs')));
  return { root, compiler, study, registry, exporter, sources: runtimeSources, metadata: bundle.metadata };
}
async function sqlProject(runtime) {
  const spec = await runtime.registry.starterById('sql-basic').create();
  spec.executionPlan.purpose = 'recorded-diagnostic';
  const project = await runtime.study.freezeStudy(await runtime.study.bindRuntimeSources(spec, runtime.sources));
  const files = await runtime.exporter.projectFiles(project, runtime.sources);
  return { project, files };
}

test('SQL fixture survives verify, qualify, run and analyze in a fresh export', async t => {
  const runtime = await isolatedRuntime(t);
  const { project, files } = await sqlProject(runtime);
  const root = join(runtime.root, 'export');
  await writeFiles(root, files);
  const inventory = JSON.parse(files['plugins/manifest.json']);
  assert.ok(inventory.required.includes('sql-bench-thirdparty'));
  assert.deepEqual(inventory.package.entries, sqlEntries);
  assert.equal(inventory.package.sha256, await sha256(files['plugins.mjs']));
  assert.equal(inventory.package.sourceHashes[sqlEntries[0].slice(2)], await sha256(await readFile(resolve(repository, sqlEntries[0]))));
  assert.deepEqual(inventory.runtimeSources, project.spec.runtimeSources);
  for (const command of ['verify', 'qualify', 'run', 'analyze']) {
    const result = cli(root, command);
    assert.equal(result.status, 0, command + '\n' + result.stdout + result.stderr);
  }
  const evidence = JSON.parse(await readFile(join(root, 'results/evidence.json'), 'utf8'));
  assert.equal(evidence.summary.completed, 2);
  assert.equal(evidence.projectSha256, project.sha256);
});

test('in-memory SQL registration refuses export until its source is packaged', async () => {
  const spec = sqlBenchDraft(newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true }));
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  await assert.rejects(() => projectFiles(project, sources), /Required benchmark plugin "sql-bench-thirdparty" was not packaged/);
});

test('a changed plugin payload or substituted package cannot produce an export', async t => {
  const runtime = await isolatedRuntime(t);
  const spec = await runtime.registry.starterById('sql-basic').create();
  spec.executionPlan.purpose = 'recorded-diagnostic';
  const altered = { ...runtime.sources, 'plugins.mjs': runtime.sources['plugins.mjs'].replace('// benchmark-plugin-payload-end', '// changed plugin payload\n// benchmark-plugin-payload-end') };
  const project = await runtime.study.freezeStudy(await runtime.study.bindRuntimeSources(spec, altered));
  await assert.rejects(() => runtime.exporter.projectFiles(project, altered), /plugin payload changed after bundling/);
  const other = await bundlePlugins({ root: repository, entries: [...sqlEntries, './plugins/structured-records.mjs'] });
  const substituted = { ...runtime.sources, 'plugins.mjs': other.source };
  const rebound = await runtime.study.freezeStudy(await runtime.study.bindRuntimeSources(spec, substituted));
  await assert.rejects(() => runtime.exporter.projectFiles(rebound, substituted), /was not packaged in this runtime/);
});

test('fresh CLI refuses missing or changed plugin inventory even if the outer manifest is updated', async t => {
  const runtime = await isolatedRuntime(t);
  const { files } = await sqlProject(runtime);
  for (const missing of [true, false]) {
    const root = join(runtime.root, missing ? 'missing' : 'changed');
    const changed = { ...files }, manifest = JSON.parse(files['manifest.json']);
    if (missing) {
      delete changed['plugins/manifest.json'];
      delete manifest.files['plugins/manifest.json'];
    } else {
      const inventory = JSON.parse(changed['plugins/manifest.json']);
      inventory.required = [];
      changed['plugins/manifest.json'] = JSON.stringify(inventory) + '\n';
      manifest.files['plugins/manifest.json'] = await sha256(changed['plugins/manifest.json']);
    }
    changed['manifest.json'] = JSON.stringify(manifest) + '\n';
    await writeFiles(root, changed);
    for (const command of ['verify', 'run']) {
      const result = cli(root, command);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /plugin inventory/);
    }
  }
});

test('local dependencies are bundled by actual path, including a benchmark/registry.mjs namesake', async t => {
  const fixture = await mkdtemp(join(repository, 'test/.plugin-dependency-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await writeFiles(fixture, {
    'benchmark/registry.mjs': 'export const label = "Carried local dependency";\n',
    'entry.mjs': 'import { registerBenchmark } from "../../src/benchmark/registry.mjs";\n'
      + 'import { label } from "./benchmark/registry.mjs";\n'
      + 'import { unzipFiles } from "../../src/benchmark/archive.mjs";\n'
      + 'registerBenchmark({ id: "dependency-fixture", label: label + ":" + typeof unzipFiles, domains: ["dependency-fixture"], matches: spec => spec?.domain === "dependency-fixture" });\n',
  });
  const entry = './' + relative(repository, join(fixture, 'entry.mjs'));
  const runtime = await isolatedRuntime(t, [entry]);
  assert.equal(runtime.registry.benchmarkForDomain('dependency-fixture').label, 'Carried local dependency:function');
  assert.ok(Object.keys(runtime.metadata.sourceHashes).some(name => name.endsWith('/benchmark/registry.mjs')));
  assert.ok(runtime.metadata.sourceHashes['src/benchmark/archive.mjs'], 'non-runtime core helper was bundled');
  assert.ok(!runtime.sources['plugins.mjs'].includes('from "./archive.mjs"'), 'non-runtime module cannot become an absent external import');
  const draft = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  draft.domain = 'dependency-fixture';
  const project = await runtime.study.freezeStudy(await runtime.study.bindRuntimeSources(draft, runtime.sources));
  const files = await runtime.exporter.projectFiles(project, runtime.sources);
  const root = join(runtime.root, 'export');
  await writeFiles(root, files);
  for (const command of ['verify', 'qualify', 'run', 'analyze']) {
    const result = cli(root, command);
    assert.equal(result.status, 0, command + '\n' + result.stdout + result.stderr);
  }
});

test('bundling is deterministic and rejects entries outside the project', async () => {
  const first = await bundlePlugins({ root: repository, entries: sqlEntries });
  const second = await bundlePlugins({ root: repository, entries: sqlEntries });
  assert.equal(first.source, second.source);
  await assert.rejects(() => bundlePlugins({ root: repository, entries: ['./../outside.mjs'] }), /leaves the project directory/);
  await assert.rejects(() => bundlePlugins({ root: repository, entries: [...sqlEntries, ...sqlEntries] }), /listed twice/);
});
