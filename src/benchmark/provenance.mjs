// Domain-independent artifact attribution and rendering. Domain entries are
// supplied by the owning plugin only when the frozen project needs them.
import { invariant, object } from './prompts.mjs'
import { benchmarkFor } from './registry.mjs'

export const PROVENANCE_VERSION = 1

const HASH = /^[a-f0-9]{64}$/
const KINDS = ['reused', 'adapted', 'generated']
const BASES = ['api', 'specification', 'method', 'original']

export const CORE_PROVENANCE = Object.freeze([
  {
    id: 'zip-writer',
    title: 'Deterministic uncompressed ZIP writer and CRC-32',
    appliesTo: ['export.mjs zipFiles', 'export.mjs crc32'],
    codeProvenance: {
      kind: 'generated',
      basis: 'specification',
      statement: 'Original implementation of a published container format. Stored (uncompressed) entries only, fixed timestamps and sorted names so an export is byte-reproducible.',
      upstreamSha256: null,
    },
    upstream: null,
    references: [
      { kind: 'specification', citation: 'PKWARE Inc. (2022). .ZIP File Format Specification (APPNOTE.TXT), version 6.3.10, revised 2022-11-01.', url: 'https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT',
        note: 'Defines the local file header (0x04034b50), central directory (0x02014b50) and end-of-central-directory (0x06054b50) records this writer emits (section 4.3) and the CRC-32 it requires (section 4.4.7). No PKWARE code is included. Verified at this URL on 2026-09-11 (citation audit; content sha256 0b993022a7d320a0bf704e6980bea36fafd17a6066ab994db0a0c16278a50cd6); the former support.pkware.com URL now redirects to a product page.' },
      { kind: 'specification', citation: 'Deutsch, P. (1996). GZIP file format specification version 4.3. RFC 1952, section 2.3.1.', url: 'https://www.rfc-editor.org/rfc/rfc1952',
        note: 'Names the CRC-32 of ISO 3309 and ITU-T V.42 and gives the reflected polynomial 0xEDB88320 this bitwise loop uses; ZIP itself specifies its CRC-32 in APPNOTE section 4.4.7. No third-party code is included. Verified at this URL on 2026-09-11 (citation audit).' },
    ],
  },
  {
    id: 'canonical-json',
    title: 'Canonical JSON serialization used for every digest and comparison',
    appliesTo: ['prompts.mjs canonical'],
    codeProvenance: {
      kind: 'generated',
      basis: 'original',
      // Deliberately NOT cited as RFC 8785. It sorts keys and defers number and
      // string formatting to JSON.stringify; conformance to JCS has not been
      // proven here, so no RFC 8785 conformance claim is made.
      statement: 'Own definition: object keys sorted, arrays in order, scalars via JSON.stringify, non-finite numbers and undefined refused. This is NOT claimed to conform to RFC 8785 (JSON Canonicalization Scheme); no conformance test exists in this tree, so no such citation is made.',
      upstreamSha256: null,
    },
    upstream: null,
    references: [],
  },
  {
    id: 'sha256-digest',
    title: 'SHA-256 digests over frozen bytes',
    appliesTo: ['prompts.mjs sha256'],
    codeProvenance: {
      kind: 'generated',
      basis: 'api',
      statement: 'No hash implementation is included. The runtime Web Crypto implementation is called: globalThis.crypto.subtle.digest("SHA-256", bytes).',
      upstreamSha256: null,
    },
    upstream: null,
    references: [
      { kind: 'specification', citation: 'NIST FIPS 180-4, Secure Hash Standard', url: 'https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf',
        note: 'Defines SHA-256. The algorithm is provided by the host runtime, not by this project.' },
      { kind: 'specification', citation: 'Watson, M. (ed.) (2017). Web Cryptography API. W3C Recommendation, 26 January 2017; SubtleCrypto.digest.', url: 'https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/',
        note: 'The interface actually called. The undated URL https://www.w3.org/TR/WebCryptoAPI/ now serves the Web Cryptography Level 2 draft, so the dated Recommendation is cited (citation audit, 2026-09-11).' },
    ],
  },
  {
    id: 'cluster-percentile-bootstrap',
    title: 'Percentile bootstrap interval over whole clusters',
    appliesTo: ['analysis.mjs clusterInterval'],
    codeProvenance: {
      kind: 'generated',
      basis: 'method',
      statement: 'Original implementation of a published method: each draw resamples whole clusters (task families, or a declared factor) with replacement, recomputes the statistic, and takes percentile endpoints from the sorted draws. Seeded and frozen so an interval is reproducible.',
      upstreamSha256: null,
    },
    upstream: null,
    references: [
      { kind: 'paper', citation: 'Efron, B. (1979). Bootstrap methods: another look at the jackknife. Annals of Statistics 7(1), 1-26.', url: 'https://doi.org/10.1214/aos/1176344552',
        note: 'Origin of the method. No code from this paper exists; none is published with it.' },
      { kind: 'paper', citation: 'Efron, B. and Tibshirani, R. J. (1993). An Introduction to the Bootstrap. Monographs on Statistics and Applied Probability 57. New York: Chapman and Hall. ISBN 0412042312.', url: null,
        note: 'Percentile interval construction; the interpolated quantile rule is Hyndman and Fan definition 7 (its own registry entry).' },
    ],
  },
  {
    id: 'seeded-generator-mulberry32',
    title: 'Seeded 32-bit generator (mulberry32) behind the schedule shuffle and the bootstrap draws',
    appliesTo: ['analysis.mjs rng', 'study.mjs shuffle'],
    codeProvenance: {
      kind: 'generated',
      basis: 'method',
      statement: 'The generator is the mulberry32 algorithm (Tommy Ettinger, 2017): state += 0x6D2B79F5, then the imul/xor/shift output hash with the constants (t | 1) and (t | 61) and shifts 15, 7 and 14, divided by 2^32. It is written here in the same one-line JavaScript form that circulates publicly, with variables renamed; whether those lines were typed from that public snippet cannot be established from this tree, so this entry records the algorithm and its published form and does not claim the bytes are original.',
      upstreamSha256: null,
    },
    upstream: null,
    references: [
      { kind: 'specification', citation: 'Ettinger, T. (2017). mulberry32 (mulberry32.c), a 32-bit seeded pseudorandom generator. GitHub Gist, CC0 1.0.', url: 'https://gist.github.com/tommyettinger/46a874533244883189143505d203312c',
        note: 'Published by the author: the state update and output hash this generator implements (constant 0x6D2B79F5). Fetched on 2026-09-11 through the research fetch layer (content sha256 185bf23d7fca09847a5b1ff054155843ea9b514964944131f8f32ca78cb957a1); not peer reviewed, and the notes published with it record statistical limitations. The JavaScript form also circulates in bryc, jshash/PRNGs.md (fetched the same day, content sha256 8f0460239ede7a26aab428dbd4d8ad0f3f967d938d1ad1562b3fa7164471fd34). No upstream byte hash is claimed for the lines here.' },
    ],
  },
  {
    id: 'fisher-yates-shuffle',
    title: 'In-place seeded shuffle of the frozen schedule',
    appliesTo: ['study.mjs shuffle'],
    codeProvenance: {
      kind: 'generated',
      basis: 'method',
      statement: 'Original implementation of the Fisher-Yates shuffle in Durstenfeld\u2019s in-place form: for i from n-1 down to 1, swap element i with a uniformly drawn element at or below it. The draws come from the seeded generator above.',
      upstreamSha256: null,
    },
    upstream: null,
    references: [
      { kind: 'paper', citation: 'Durstenfeld, R. (1964). Algorithm 235: Random permutation. Communications of the ACM 7(7), 420.', url: 'https://doi.org/10.1145/364520.364540',
        note: 'The in-place algorithm. No code from this paper is included.' },
    ],
  },
  {
    id: 'bonferroni-simultaneous-intervals',
    title: 'Bonferroni-corrected simultaneous interval levels',
    appliesTo: ['analysis.mjs clusterInterval', 'analysis.mjs contrastsFor'],
    codeProvenance: {
      kind: 'generated',
      basis: 'method',
      statement: 'Original implementation of a published method: when the frozen plan declares multiplicity bonferroni, the interval level alpha is divided by the number of planned intervals in its family before the percentile endpoints are read.',
      upstreamSha256: null,
    },
    upstream: null,
    references: [
      { kind: 'paper', citation: 'Dunn, O. J. (1961). Multiple comparisons among means. Journal of the American Statistical Association 56(293), 52-64.', url: 'https://doi.org/10.1080/01621459.1961.10482090',
        note: 'Simultaneous intervals by the Bonferroni correction, as applied here. No code from this paper is included. Bonferroni (1936) itself could not be verified on a primary or library record and is not cited.' },
    ],
  },
  {
    id: 'sample-quantile-type-7',
    title: 'Sample quantile by linear interpolation for percentile endpoints',
    appliesTo: ['analysis.mjs quantile'],
    codeProvenance: {
      kind: 'generated',
      basis: 'method',
      statement: 'Original implementation of a published definition: the quantile at probability p of n sorted values is read at position (n-1)p with linear interpolation between the neighbouring order statistics (Hyndman and Fan definition 7).',
      upstreamSha256: null,
    },
    upstream: null,
    references: [
      { kind: 'paper', citation: 'Hyndman, R. J. and Fan, Y. (1996). Sample quantiles in statistical packages. The American Statistician 50(4), 361-365.', url: 'https://doi.org/10.1080/00031305.1996.10473566',
        note: 'Definition 7 is the one implemented. No code from this paper is included.' },
    ],
  },
])
export const PROVENANCE = CORE_PROVENANCE

export function projectProvenanceEntries(project) {
  if (!project) return CORE_PROVENANCE
  const owner = benchmarkFor(project.spec)
  if (project.spec.schemaVersion < 4 && owner?.legacyProvenance) return owner.legacyProvenance(project)
  return [...CORE_PROVENANCE, ...(owner?.provenance?.(project) || [])]
}
function entriesFor(value) { return Array.isArray(value) ? value : projectProvenanceEntries(value) }

// 'original' is not something one "follows"; say what each basis actually means.
const BASIS_PHRASE = {
  api: 'written against a published API',
  specification: 'implements a published specification',
  method: 'implements a published method',
  original: 'original to this repository',
}
function basisPhrase(basis) { return BASIS_PHRASE[basis] || basis }

function validateReference(reference, where) {
  invariant(object(reference), where + ': a reference must be an object.')
  invariant(['specification', 'paper', 'reviewed-source'].includes(reference.kind), where + ': a reference is a specification, a paper or a reviewed source.')
  invariant(typeof reference.citation === 'string' && reference.citation.trim(), where + ': a reference needs its citation text.')
  invariant(reference.url === null || (typeof reference.url === 'string' && reference.url.startsWith('https://')), where + ': a reference URL is https or null.')
  invariant(typeof reference.note === 'string' && reference.note.trim(), where + ': say what the reference contributes, so it cannot be mistaken for reuse.')
  // A reviewed source is code someone read, not code anyone copied. It names the
  // revision read and when, so "reviewed" cannot quietly become "reused".
  if (reference.kind === 'reviewed-source') {
    invariant(typeof reference.revision === 'string' && reference.revision.trim(), where + ': a reviewed source names the revision that was read.')
    invariant(typeof reference.retrievedAt === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(reference.retrievedAt), where + ': a reviewed source records the date it was retrieved.')
  }
  invariant(reference.follows === undefined || (typeof reference.follows === 'string' && reference.follows.trim()), where + ': say which structure the generated code follows, or omit it.')
}

// The schema is the guard. It refuses an entry that claims reuse without an
// upstream revision and hash, and equally refuses one that attaches a hash to
// code we wrote ourselves. An invented provenance is the failure this registry
// exists to prevent, and it can fail in both directions.
export function validateProvenance(entries = PROVENANCE) {
  invariant(Array.isArray(entries) && entries.length, 'The provenance registry needs at least one entry.')
  const seen = new Set()
  for (const entry of entries) {
    invariant(object(entry), 'Every provenance entry is an object.')
    const where = 'provenance ' + (entry.id || '(unnamed)')
    invariant(typeof entry.id === 'string' && /^[a-z][a-z0-9-]*$/.test(entry.id) && !seen.has(entry.id), where + ': needs a distinct lowercase identifier.')
    seen.add(entry.id)
    invariant(typeof entry.title === 'string' && entry.title.trim(), where + ': needs a title.')
    invariant(Array.isArray(entry.appliesTo) && entry.appliesTo.length && entry.appliesTo.every(file => typeof file === 'string' && file.trim()), where + ': name the artifacts it applies to.')
    const code = entry.codeProvenance
    invariant(object(code) && KINDS.includes(code.kind), where + ': codeProvenance.kind must be reused, adapted or generated.')
    invariant(typeof code.statement === 'string' && code.statement.trim(), where + ': state plainly what was reused, adapted or generated.')
    if (code.kind === 'generated') {
      invariant(BASES.includes(code.basis), where + ': generated code declares whether it follows an api, a specification, a method, or is original.')
      invariant(code.upstreamSha256 === null, where + ': generated code carries no upstream hash; a hash here would assert reuse that did not happen.')
      invariant(entry.upstream === null || !entry.upstream.filePath, where + ': generated code cannot name an upstream file it copied.')
    } else {
      const upstream = entry.upstream
      invariant(object(upstream), where + ': reused or adapted code needs its upstream project.')
      invariant(typeof upstream.project === 'string' && upstream.project.trim(), where + ': name the upstream project.')
      invariant(typeof upstream.authors === 'string' && upstream.authors.trim(), where + ': name the original authors.')
      invariant(typeof upstream.repositoryUrl === 'string' && upstream.repositoryUrl.startsWith('https://'), where + ': link the actual source repository.')
      invariant(typeof upstream.filePath === 'string' && upstream.filePath.trim(), where + ': name the exact upstream file.')
      invariant(typeof upstream.license === 'string' && upstream.license.trim(), where + ': record the upstream licence.')
      invariant(typeof upstream.licenseNote === 'string' && upstream.licenseNote.trim(), where + ': retain the notice text the licence requires.')
      invariant(object(upstream.revision) && typeof upstream.revision.value === 'string' && upstream.revision.value.trim(), where + ': record the exact revision the bytes came from.')
      invariant(HASH.test(code.upstreamSha256 || ''), where + ': record the sha256 of the upstream bytes at that revision. No citation without a hash.')
      invariant(typeof code.fetchedAt === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(code.fetchedAt), where + ': record the date the upstream bytes were fetched.')
      if (code.kind === 'adapted') invariant(Array.isArray(code.adaptations) && code.adaptations.length
        && code.adaptations.every(line => typeof line === 'string' && line.trim()), where + ': adapted code lists every adaptation in one line each.')
    }
    invariant(Array.isArray(entry.references), where + ': references must be a list, even when empty.')
    for (const reference of entry.references) validateReference(reference, where)
  }
  return entries
}

export function provenanceEntry(id, entries = PROVENANCE) {
  const entry = entries.find(row => row.id === id)
  invariant(entry, 'No provenance entry: ' + id + '. Every attribution printed into a generated artifact must come from the registry.')
  return entry
}

// The header a generated program carries. It is a comment block, so it can
// never change what the program does or what the engine observes.
export function attributionHeader(ids, { comment = '# ', entries: registry = PROVENANCE } = {}) {
  const entries = ids.map(id => provenanceEntry(id, registry))
  const lines = ['Provenance of this generated file. See ATTRIBUTIONS.md and provenance.json in this project.']
  for (const entry of entries) {
    const code = entry.codeProvenance
    lines.push('', '[' + code.kind + '] ' + entry.title, '  ' + code.statement)
    if (entry.upstream) {
      lines.push('  upstream: ' + entry.upstream.project + ' - ' + entry.upstream.authors)
      lines.push('  source:   ' + entry.upstream.repositoryUrl + (entry.upstream.filePath ? ' - ' + entry.upstream.filePath : ''))
      lines.push('  licence:  ' + entry.upstream.license)
      if (code.kind !== 'generated') lines.push('  notice:   ' + entry.upstream.licenseNote)
      lines.push('  revision: ' + entry.upstream.revision.kind + ' ' + entry.upstream.revision.value)
      if (code.upstreamSha256) lines.push('  sha256:   ' + code.upstreamSha256 + ' (fetched ' + code.fetchedAt + ')')
      if (entry.upstream.revision.measuredPython) lines.push('  measured: interpreter ' + entry.upstream.revision.measuredPython)
    }
    for (const adaptation of code.adaptations || []) lines.push('  adapted:  ' + adaptation)
    for (const reference of entry.references) {
      lines.push('  reference (' + (reference.kind === 'reviewed-source' ? 'reviewed source, ' : '') + 'contributes no code): ' + reference.citation)
      if (reference.kind === 'reviewed-source') lines.push('    revision: ' + reference.revision)
      if (reference.follows) lines.push('    this program follows ' + reference.follows)
    }
  }
  // The no-copy sentence is derived, never asserted: it is printed only when no
  // entry listed for this file is reused or adapted.
  const copied = entries.filter(entry => entry.codeProvenance.kind !== 'generated')
  lines.push('', 'Everything not listed above as reused or adapted is generated from the frozen semantic',
    'tree by the compiler in this repository.' + (copied.length ? '' : ' No third-party source is copied into this file.'))
  if (copied.length) lines.push('This file contains third-party source from: ' + copied.map(entry => entry.title).join('; ') + '.',
    'Its authors, source, revision, licence notices and adaptations are listed above.')
  return lines.map(line => (line ? comment + line : comment.trimEnd())).join('\n') + '\n'
}

export function provenanceDocument(entries = PROVENANCE) {
  entries = entriesFor(entries)
  validateProvenance(entries)
  return {
    format: 'research-benchmark-provenance', version: PROVENANCE_VERSION,
    scope: 'Provenance of the code and templates this project generates for its users. codeProvenance records where bytes came from; references record the specifications and papers our own implementations follow and contribute no code.',
    entries: entries.map(entry => JSON.parse(JSON.stringify(entry))),
  }
}

export function attributionsMarkdown(entries = PROVENANCE) {
  entries = entriesFor(entries)
  validateProvenance(entries)
  const reused = entries.filter(entry => entry.codeProvenance.kind !== 'generated')
  const out = ['# Attribution and reused code', '',
    'This project generates research artifacts. This file records, for every generated artifact, which parts are',
    'reused from another project, which are adapted, and which are newly generated here.', '',
    reused.length
      ? reused.length + ' entr' + (reused.length === 1 ? 'y reuses or adapts' : 'ies reuse or adapt')
        + ' third-party source; each records its upstream revision and the SHA-256 of the exact bytes.'
      : '**No third-party source code is copied into this project or into anything it generates.** Every generated'
        + ' artifact is written from the frozen semantic tree by the compiler in this repository. The entries below record'
        + ' the APIs, specifications, published methods and reviewed sources those implementations follow, and each says explicitly that'
        + ' it contributes no code.',
    '']
  for (const entry of entries) {
    const code = entry.codeProvenance
    out.push('## ' + entry.title, '',
      '- **Classification:** ' + code.kind + (code.basis ? ' (' + basisPhrase(code.basis) + ')' : ''),
      '- **Applies to:** ' + entry.appliesTo.join(', '),
      '- **Statement:** ' + code.statement)
    if (entry.upstream) {
      out.push('- **Upstream project:** ' + entry.upstream.project,
        '- **Original authors:** ' + entry.upstream.authors,
        '- **Source:** ' + entry.upstream.repositoryUrl + (entry.upstream.filePath ? ' (' + entry.upstream.filePath + ')' : ''),
        '- **Licence:** ' + entry.upstream.license + ' - ' + entry.upstream.licenseNote,
        '- **Revision:** ' + entry.upstream.revision.kind + ' `' + entry.upstream.revision.value + '`')
      if (entry.upstream.revision.labels) out.push('- **Recorded labels:** '
        + Object.entries(entry.upstream.revision.labels).map(([key, value]) => key + '=' + value).join(', '))
      if (entry.upstream.revision.measuredPython) out.push('- **Measured interpreter:** ' + entry.upstream.revision.measuredPython)
      if (entry.upstream.revision.note) out.push('- **Revision note:** ' + entry.upstream.revision.note)
      if (code.upstreamSha256) out.push('- **SHA-256 of upstream bytes:** `' + code.upstreamSha256 + '` (fetched ' + code.fetchedAt + ')')
    }
    for (const adaptation of code.adaptations || []) out.push('- **Adaptation:** ' + adaptation)
    for (const reference of entry.references) {
      out.push('- **Reference (' + reference.kind + ', contributes no code):** '
        + reference.citation + (reference.url ? ' <' + reference.url + '>' : '') + ' ' + reference.note)
      if (reference.kind === 'reviewed-source') out.push('  - **Revision read:** ' + reference.revision + ' (retrieved ' + reference.retrievedAt + ')')
      if (reference.follows) out.push('  - **Generated code follows:** ' + reference.follows)
    }
    out.push('')
  }
  return out.join('\n')
}
