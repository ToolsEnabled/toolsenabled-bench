import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPluginHandler } from '../src/benchmark/cli.mjs';
import { registerBenchmark, registeredBenchmarks, resetRegistry } from '../src/benchmark/registry.mjs';
import { attributionsMarkdown } from '../src/benchmark/provenance.mjs';
import { sha256 } from '../src/benchmark/prompts.mjs';

test('Node plugin handlers require a source pin and use the running runtime module', async t => {
  const original = registeredBenchmarks();
  t.after(() => { resetRegistry(); for (const entry of original) registerBenchmark(entry); });
  registerBenchmark({
    id: 'node-capability-fixture', domains: ['node-capability-fixture'],
    matches: spec => spec.domain === 'node-capability-fixture',
    nodeHandlers: { grade: { module: 'provenance.mjs', export: 'attributionsMarkdown' } },
  });
  const project = { spec: { schemaVersion: 4, domain: 'node-capability-fixture', runtimeSources: {} } };
  await assert.rejects(loadPluginHandler(project, 'grade'), /differs from the frozen runtime/);
  project.spec.runtimeSources['provenance.mjs'] = '0'.repeat(64);
  await assert.rejects(loadPluginHandler(project, 'grade'), /differs from the frozen runtime/);
  project.spec.runtimeSources['provenance.mjs'] = await sha256(await readFile(new URL('../src/benchmark/provenance.mjs', import.meta.url)));
  assert.equal(await loadPluginHandler(project, 'grade'), attributionsMarkdown);
  assert.equal(await loadPluginHandler(project, 'undeclared'), null);
});
