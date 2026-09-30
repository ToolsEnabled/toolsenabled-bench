// The reference plugin owns these two domain attribution records. The combined
// registry preserves the historical order for schema 1–3 and old UI callers.
import { CORE_PROVENANCE, PROVENANCE_VERSION,
  validateProvenance as validate, provenanceEntry as entry,
  attributionHeader as header, provenanceDocument as document,
  attributionsMarkdown as markdown } from './provenance.mjs'
export { PROVENANCE_VERSION }

// Measured 2026-09-10 on this machine with `docker image inspect` on the pinned
// digest, and from the engine's own retained stdout in both LEAN trials of the
// flat-canary run. The label and the running interpreter disagree; both are
// recorded rather than reconciled, and the digest is the only proven revision.
export const LEAN_IMAGE_DIGEST = 'sha256:cc27d5608d209fc9276c8419af3dd8e598ba49075c6f5c44ca38bf637eaef216'
export const LEAN_IMAGE_FACTS = Object.freeze({
  digest: LEAN_IMAGE_DIGEST,
  labels: Object.freeze({ lean_version: '18057', python_version: '3.11', strict_python_version: '3.11.11', target_framework: 'net10.0' }),
  imageCreated: '2026-09-04T20:20:04.529961705Z',
  measuredEngine: 'LEAN ALGORITHMIC TRADING ENGINE v2.5.0.0',
  measuredPython: '3.11.14',
  measurementNote: 'The engine reported Python 3.11.14 in both retained trial logs while the image label says strict_python_version 3.11.11. The label is not a reliable interpreter revision; cite the digest.',
  measuredOn: '2026-09-10',
})

export const LEAN_PROVENANCE = Object.freeze([
  {
    id: 'quantconnect-lean-python-api',
    title: 'Generated FrozenBenchmark algorithm, written against the QuantConnect LEAN Python API',
    appliesTo: ['lean/<task>/main.py', 'inlined candidate main.py'],
    codeProvenance: {
      kind: 'generated',
      basis: 'api',
      // The generated program's only LEAN touchpoint is the star import of the
      // engine's own namespace. Verified by reading the emitted file: its
      // imports are AlgorithmImports, json, datetime, decimal, lean_reference.
      statement: 'Written against the QuantConnect LEAN Python API, lean_version 18057; no LEAN source is copied.',
      upstreamSha256: null,
    },
    upstream: {
      project: 'QuantConnect LEAN',
      authors: 'QuantConnect Corporation and the LEAN contributors',
      repositoryUrl: 'https://github.com/QuantConnect/Lean',
      license: 'Apache-2.0',
      // Recorded because the API is Apache-2.0 even though no bytes are copied;
      // this states the relationship without asserting reuse.
      licenseNote: 'QuantConnect LEAN is distributed under the Apache License 2.0. This project copies no LEAN source, so no LEAN notice is redistributed; the reference is informational.',
      revision: { kind: 'image-digest', value: LEAN_IMAGE_DIGEST, labels: LEAN_IMAGE_FACTS.labels, measuredPython: LEAN_IMAGE_FACTS.measuredPython, note: LEAN_IMAGE_FACTS.measurementNote },
    },
    references: [
      // Reviewed at upstream master on 2026-09-10 (root's reference review).
      // refs/heads/master was measured with `git ls-remote` at 22:35:16Z that
      // day, after the review, so the commit dates the branch; it is not proof
      // of the exact bytes that were read.
      { kind: 'reviewed-source',
        citation: 'QuantConnect LEAN, Algorithm.Python/BasicTemplateAlgorithm.py, with the repository LICENSE (Apache License 2.0)',
        url: 'https://github.com/QuantConnect/Lean/blob/master/Algorithm.Python/BasicTemplateAlgorithm.py',
        revision: 'master, retrieved 2026-09-10; refs/heads/master was 8ee075a39918f2df6fe9e0a5944e366fb60d10dc when measured that day',
        retrievedAt: '2026-09-10',
        follows: 'its ordinary QCAlgorithm skeleton: an initialization method and a data callback (initialize and on_data here)',
        note: 'The canonical LEAN Python template, reviewed at upstream master and not claimed to match the pinned image revision. It supplies the ordinary skeleton only; the frozen-input reconciliation, integer-cent arithmetic and order-tagging contract are generated here, and no code is copied from it. Licence: https://github.com/QuantConnect/Lean/blob/master/LICENSE' },
    ],
  },
  {
    id: 'semantic-reference-runtime',
    title: 'Independent Python semantic reference and broker-event ledger',
    appliesTo: ['lean-reference.py', 'execution_reference.py'],
    codeProvenance: {
      kind: 'generated',
      basis: 'original',
      statement: 'Original implementation in this repository. It deliberately does not translate or invoke the JavaScript interpreter; the two are independent readings of the same frozen semantic tree, which is what makes their agreement evidence.',
      upstreamSha256: null,
    },
    upstream: null,
    references: [],
  },
])

export const PROVENANCE = Object.freeze([...LEAN_PROVENANCE, ...CORE_PROVENANCE])
export function validateProvenance(entries = PROVENANCE) { return validate(entries) }
export function provenanceEntry(id, entries = PROVENANCE) { return entry(id, entries) }
export function attributionHeader(ids, options = {}) { return header(ids, { ...options, entries: options.entries || PROVENANCE }) }
export function provenanceDocument(entries = PROVENANCE) { return document(entries) }
export function attributionsMarkdown(entries = PROVENANCE) { return markdown(entries) }
