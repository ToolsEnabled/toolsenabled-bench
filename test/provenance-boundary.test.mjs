import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CORE_PROVENANCE, attributionsMarkdown, provenanceDocument } from '../src/benchmark/provenance.mjs';
import { LEAN_PROVENANCE } from '../src/benchmark/lean-provenance.mjs';
import { attributionsMarkdown as historicalMarkdown, provenanceDocument as historicalDocument } from '../src/benchmark/lean-codegen.mjs';
import '../src/benchmark/plugins.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');

test('historical provenance keeps the ten original entries in byte-identical order', () => {
  assert.equal(CORE_PROVENANCE.length, 8);
  assert.equal(LEAN_PROVENANCE.length, 2);
  assert.equal(sha256(historicalMarkdown()), 'c721cc558eedcfae6ded91a99431f6d0bec18c93c27206f5ac6cf2ff1cfc11a7');
  assert.equal(sha256(JSON.stringify(historicalDocument(), null, 2) + '\n'), '9d1f11e86a7a235cea0eabb3395c57740ff7cb4d5857eea20c01b77c13a12950');
  for (const schemaVersion of [1, 2, 3]) {
    const project = { spec: { schemaVersion, domain: 'generic' } };
    assert.equal(sha256(attributionsMarkdown(project)), 'c721cc558eedcfae6ded91a99431f6d0bec18c93c27206f5ac6cf2ff1cfc11a7');
    assert.equal(sha256(JSON.stringify(provenanceDocument(project), null, 2) + '\n'), '9d1f11e86a7a235cea0eabb3395c57740ff7cb4d5857eea20c01b77c13a12950');
  }
});

test('new generic studies cite core machinery while plugin studies add their own provenance', () => {
  const generic = { spec: { schemaVersion: 4, domain: 'generic' } };
  assert.deepEqual(provenanceDocument(generic).entries, CORE_PROVENANCE);
  assert.doesNotMatch(attributionsMarkdown(generic), /QuantConnect|LEAN|lean-reference/);
  const plugin = { spec: { schemaVersion: 4, domain: 'lean-bench' } };
  assert.deepEqual(provenanceDocument(plugin).entries.map(entry => entry.id), [...CORE_PROVENANCE, ...LEAN_PROVENANCE].map(entry => entry.id));
});
