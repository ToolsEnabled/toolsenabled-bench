import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePrompt, invariant } from '../src/benchmark/prompts.mjs';
import { registerBenchmark, registeredBenchmarks, resetRegistry } from '../src/benchmark/registry.mjs';
import { genericStarter, newExperimentDraft } from '../src/benchmark/starters.mjs';
import { materializeCorpus, validateStudy } from '../src/benchmark/study.mjs';
import { compileTask, deriveTaskExpected, taskGradingContract } from '../src/benchmark/tasks.mjs';
import { compositionFieldInventory, createCompositionFieldDraft, compileCompositionFamilyFields } from '../src/benchmark/corpus.mjs';
import { requirementFieldInventory } from '../src/benchmark/requirement-fields.mjs';

const shipped = registeredBenchmarks();
const answer = compiled => {
  const node = compiled.semantic.children.task;
  return String(Number(node.a) + Number(node.b));
};
function fixture(t) {
  t.after(() => { resetRegistry(); for (const entry of shipped) registerBenchmark(entry); });
  const calls = [];
  registerBenchmark({
    id: 'arithmetic-rules-fixture', domains: ['arithmetic-rules'], matches: spec => spec.domain === 'arithmetic-rules',
    taskSemantics: {
      deriveExpected: async (spec, task) => answer(await compilePrompt(spec.catalog, task.root, { variables: task.variables || {} })),
      prepare(spec, task, compiled, { expected, generatedExpected, validateExpected, appendContract }) {
        calls.push('prepare');
        const actual = answer(compiled);
        if (generatedExpected && !Object.hasOwn(task, 'expected')) expected = actual;
        invariant(!validateExpected || expected === actual, 'Arithmetic fixture expected answer disagrees.');
        appendContract('\nFixture answer contract: return the sum.', 'fixture-answer', 'arithmetic-fixture.mjs');
        return expected;
      },
      finalize(spec, task, compiled, { expected }) {
        calls.push('finalize');
        if (task.information) assert.equal(compiled.composition.appendices.at(-1).id, 'response-envelope');
        return expected;
      },
    },
    authoring: {
      specFields: ['arithmeticProfile'],
      validateSpec: spec => invariant(spec.arithmeticProfile === 'integer-sums', 'Choose the fixture integer profile.'),
      bindingFields: spec => ({ arithmeticProfile: spec.arithmeticProfile }),
      expectedPolicy: { kind: 'derive-arithmetic', validationMessage: 'Derive expectations through the arithmetic fixture.' },
      activationChoices: () => [{ kind: 'counter', name: 'evaluated', label: 'Expression evaluated' }],
      suppliedInterpreters: true,
    },
    oracle: () => ({ kind: 'fixture-arithmetic-oracle', source: 'arithmetic-fixture.mjs' }),
    gradingKinds: [{ value: 'arithmetic-check', label: 'Fixture arithmetic', title: 'Fixture arithmetic', fields: ['tolerance'],
      normalize: (spec, grading) => ({ ...grading, tolerance: grading.tolerance ?? 0 }) }],
  });
  const spec = newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true });
  spec.domain = 'arithmetic-rules';
  spec.arithmeticProfile = 'integer-sums';
  return { spec, calls };
}

test('a domain declares its own specification fields, validation, and grading defaults', t => {
  const { spec } = fixture(t);
  assert.doesNotThrow(() => validateStudy(spec));
  assert.throws(() => validateStudy({ ...spec, arithmeticProfile: 'unsupported' }), /Choose the fixture integer profile/);
  assert.throws(() => validateStudy({ ...spec, unregisteredProfile: 'ignored' }), /unsupported fields/);
  spec.protocol.grading = { kind: 'arithmetic-check' };
  assert.deepEqual(taskGradingContract(spec), { kind: 'arithmetic-check', tolerance: 0 });
  assert.deepEqual(spec.protocol.grading, { kind: 'arithmetic-check' }, 'normalization does not edit the draft');
});

test('domain task hooks derive answers and surround shared response envelopes in a defined order', async t => {
  const { spec, calls } = fixture(t);
  const task = spec.tasks[0];
  task.familyId = 'sums';
  task.information = { version: 1, scope: 'declared-set', responseMode: 'tagged-json', rationale: 'Recorded fixture of plugin task semantics.',
    withheldPaths: [], readings: [{ id: 'same-sum', root: structuredClone(task.root), rationale: 'One declared reading.' }] };
  const compiled = await compileTask(spec, task, { requireReview: false, requireTaskReview: false });
  assert.deepEqual(calls, ['prepare', 'finalize', 'prepare', 'finalize']);
  assert.equal(compiled.interpretations[0].expected, '5');
  assert.equal(compiled.compiled.composition.appendices[0].source, 'arithmetic-fixture.mjs');
  assert.equal(await deriveTaskExpected(spec, spec.tasks[1]), '11');
  await assert.rejects(() => compileTask(spec, { ...task, expected: 'wrong' }), /expected answer disagrees/);
  await assert.rejects(() => deriveTaskExpected(genericStarter(), genericStarter().tasks[0]), /does not derive expected answers/);
});

test('composition families use a plugin expected-answer policy and regenerate changed parameter answers', async t => {
  const { spec } = fixture(t);
  const inventory = await compositionFieldInventory(spec, spec.tasks[0].id);
  const fields = createCompositionFieldDraft(inventory);
  assert.equal(fields.expectedPolicy.kind, 'derive-arithmetic');
  fields.rationale = 'Two fixed arithmetic controls.';
  fields.expectedPolicy.rationale = 'The fixture semantic function derives both authored answers.';
  const occurrence = fields.occurrences.find(row => row.path.join('/') === 'task');
  occurrence.enabled = true;
  occurrence.choices.push(structuredClone(occurrence.choices[0]));
  occurrence.choices[1].id = 'four';
  occurrence.choices[1].parameters.a.text = '4';
  const workspace = { version: 1, rationale: 'One controlled arithmetic family.', seed: fields.seed, selection: fields.selection,
    coverage: fields.coverage, families: [{ sourceTask: structuredClone(spec.tasks[0]), fields }] };
  const { plan } = await compileCompositionFamilyFields(spec, workspace);
  assert.equal(plan.fieldAuthoring.families[0].expectedPolicy.kind, 'derive-arithmetic');
  const generated = await materializeCorpus({ ...spec, corpusPlan: plan });
  assert.deepEqual(generated.tasks.map(task => task.expected).sort(), ['5', '7']);
  assert.equal(generated.manifest.oracle.kind, 'fixture-arithmetic-oracle');
  const changed = structuredClone(plan);
  changed.fieldAuthoring.families[0].expectedPolicy.kind = 'reuse-base';
  await assert.rejects(() => materializeCorpus({ ...spec, corpusPlan: changed }), /provenance differs/);
});

test('requirement fields take activation options, interpreter ownership, and bindings from the domain', async t => {
  const { spec } = fixture(t);
  const inventory = await requirementFieldInventory(spec);
  assert.equal(inventory.needsInterpreters, false);
  assert.ok(inventory.rows.every(row => row.activationMode === 'instrumented' && row.activationOptions[0].name === 'evaluated'));
  const changed = await requirementFieldInventory({ ...spec, arithmeticProfile: 'different-binding' });
  assert.notEqual(changed.bindingSha256, inventory.bindingSha256);
  const generic = await requirementFieldInventory(newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true }));
  assert.equal(generic.needsInterpreters, true);
  assert.ok(generic.rows.every(row => row.activationMode === 'module-declared'));
});
