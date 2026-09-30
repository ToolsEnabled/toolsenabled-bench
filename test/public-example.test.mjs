import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { exampleExperimentDrafts } from '../src/research-examples-lazy.mjs';
import { catalogMap } from '../src/benchmark/prompts.mjs';
import { compileTask } from '../src/benchmark/tasks.mjs';
import * as protocol from '../src/research-protocol.mjs';
import { EXAMPLE_SOURCES, exampleSnippetLibrary } from '../src/research-examples.mjs';

const example = exampleExperimentDrafts.find(row => row.id === 'lean-bench-snippets-and-compositions');
const digest = text => createHash('sha256').update(text).digest('hex');

test('the public Lean authoring example contains source material without owner coordination documents', async () => {
  const draft = await example.load();
  assert.deepEqual(Object.keys(draft.attachments).sort(), [
    'library-manifest.json',
    'references/o1-reference-corrected-v3.py',
    'references/o1-reference-parameters.py',
    'references/o1-reference.py',
    'references/t1-reference-parameters.py',
    'references/t1-reference.py',
  ]);
  assert.doesNotMatch(JSON.stringify(draft), /o1-acceptance-audit|o1-horizon-amendment|O1-BANK-ACCEPTANCE-BLOCKER|recorded horizon-tail amendment|historical acceptance limits remain separate attachments|approval successor|workspace-owner response/i);
  assert.equal(/\b(?:sol|opus)-\d+\s+R\d+(?:\s+#\d+)?/i.test(JSON.stringify(draft)), false, 'embedded reference sources contain no private agent review identifiers');
  assert.equal(/\b(?:vetting[- ]council|council\s+simulations)\b|\bpreflight\s+(?:all|\d+)\b|\b(?:\d[\d,]*|one)\s+(?:of|entry\s+in)\s+\d[\d,]*\s+(?:oracle\s+runs|sessions)\b|\b\d+\s+sessions\s+of\s+(?:total\s+)?silence\b|\b\d{4}-\d{2}-\d{2}\s+OAT\s+gate\b/i.test(JSON.stringify(draft)), false, 'embedded reference sources contain no private review or debugging chronology');
  for (const { code } of draft.spec.catalog.filter(row => row.code)) {
    assert.equal(Object.hasOwn(code, 'auditSource'), false);
    assert.equal(Object.hasOwn(code, 'auditSourceSha256'), false);
  }
});

test('the public example loads independently and preserves all authoring prompts and reference bindings', async () => {
  const draft = await example.load();
  assert.equal(catalogMap(draft.spec.catalog).size, 74);
  assert.equal(draft.spec.tasks.length, 41);
  assert.equal(draft.spec.requireReview, true);
  assert.equal(draft.spec.executionPlan.purpose, 'apparatus-development');
  for (const key of ['conditions', 'inputs', 'reviews', 'taskReviews']) assert.deepEqual(draft.spec[key], []);
  assert.ok(draft.spec.tasks.every(task => task.expected === null));

  const manifest = JSON.parse(draft.attachments['library-manifest.json']);
  assert.equal(manifest.compiledPrompts.length, draft.spec.tasks.length);
  for (const task of draft.spec.tasks) {
    const compiled = await compileTask(draft.spec, task, { requireReview: false, requireTaskReview: false });
    assert.equal(compiled.compiled.promptSha256, manifest.compiledPrompts.find(row => row.id === task.id).promptSha256, task.id);
  }
  for (const { id, code } of draft.spec.catalog.filter(row => row.code)) {
    const source = draft.attachments[`references/${code.completeSourceAttachment}.py`];
    assert.equal(typeof source, 'string', id);
    assert.equal(digest(source), code.sourceSha256, id + ' complete source');
    assert.equal(digest(code.text), code.sha256, id + ' source slice');
    assert.ok(code.slices.every(slice => slice.sourceSha256 === code.sourceSha256), id + ' slice provenance');
    if (code.slices.length === 1) {
      const start = code.slices[0].charOffset;
      assert.equal(source.slice(start, start + code.text.length), code.text, id + ' source offset');
    }
    if (code.origin === 'authored-unreviewed-derivative') {
      assert.match(code.status, /review and native LEAN qualification remain pending/);
      assert.equal(Object.hasOwn(code, 'validation'), false, id + ' has no inherited private qualification');
    }
  }
  draft.spec.catalog[0].text = 'Edited after loading';
  delete draft.attachments['references/t1-reference.py'];
  const reloaded = await example.load();
  assert.notEqual(reloaded.spec.catalog[0].text, draft.spec.catalog[0].text);
  assert.equal(typeof reloaded.attachments['references/t1-reference.py'], 'string');
});

test('public protocol provenance preserves the registered field contract without inheriting private authority', () => {
  // Captured before removing private origin narratives: field definitions,
  // choices/defaults, editor visibility, managed fields and effective defaults.
  const baseline = {
    fields: protocol.PROTOCOL_FIELDS.map(({ origin, source, ...field }) => field),
    visibleSections: protocol.PROTOCOL_SECTIONS.map(({ id, fields }) => ({ id, fields: fields.map(({ id }) => id) })),
    decisionIds: protocol.DECISION_FIELDS.map(({ id }) => id),
    settingIds: protocol.SETTING_FIELDS.map(({ id }) => id),
    managed: protocol.PROTOCOL_MANAGED_FIELDS,
    exampleValues: protocol.leanBenchValues(),
    effectiveDefaults: protocol.PROTOCOL_FIELDS.map(field => [field.id, protocol.effectiveValue(protocol.emptyProtocolDecisions(), field) ?? null]),
  };
  assert.equal(digest(JSON.stringify(baseline)), '727ae119f7c0faafc72b97abfef1a964e9032ee314f28806bc7052a1f2bc6a0c');
  assert.deepEqual([...new Set(protocol.PROTOCOL_FIELDS.map(field => field.origin))], ['registry']);
  for (const field of protocol.PROTOCOL_FIELDS) {
    assert.match(field.source, /historical example/i);
    assert.match(field.source, /no per-field provenance/i);
    assert.match(field.source, /do not authorize execution or spending/i);
    assert.doesNotMatch(field.source, /your ruling|owner approved|measured failure|Desktop|[A-Z]:\\|QUESTIONS-FOR-/i);
  }
  const saved = protocol.normalizeProtocolDecisions({ values: { 'study-kind': 'exploratory', 'max-turns': 3 }, notes: 'Current study decisions.' });
  assert.deepEqual(protocol.withRulings(saved), saved, 'historical examples cannot supply owner authorization');
  assert.deepEqual(protocol.withRulings(protocol.emptyProtocolDecisions()), protocol.emptyProtocolDecisions());
  assert.ok(protocol.matchesDecisionsText(saved, protocol.decisionsText(saved)));
});

test('example snippet provenance uses the existing portable source paths', () => {
  const { catalog } = exampleSnippetLibrary();
  assert.equal(catalog.length, 44);
  for (const bundle of catalog) {
    assert.equal(EXAMPLE_SOURCES[bundle.id], bundle.source);
    assert.match(EXAMPLE_SOURCES[bundle.id], /^historical\/LEAN-Bench\//);
  }
});
