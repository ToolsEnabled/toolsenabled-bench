// Audits of a judge against a frozen reference criterion. Source observations
// and the judge's later verdict remain separate, version-bound evidence.
import { canonical, invariant, object, sha256 } from './prompts.mjs'
import { safePath, verifyProject, freezeStudy } from './study.mjs'
import { validateJournal, verifyResourceJournal } from './runner.mjs'
import { benchmarkForDomain } from './registry.mjs'
import { genericStarter } from './starters.mjs'

export const AUDIT_VERSION = 1
export const AUDIT_VERDICTS = ['accept', 'reject', 'undetermined', 'abstain']
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const text = value => typeof value === 'string' && !!value.trim()
const referenceLimit = encoded => invariant(new TextEncoder().encode(encoded).byteLength <= 64 * 1024 * 1024, 'Reference bundles are limited to 64 MiB of JSON text; split the source study explicitly when a larger archive is needed.')
const fields = (value, allowed, label) => invariant(Object.keys(value).every(key => allowed.includes(key)), `${label} contains an unsupported field.`)

export function auditFileBytes(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  invariant(object(value) && value.encoding === 'base64' && typeof value.data === 'string' && Object.keys(value).every(key => ['encoding', 'data'].includes(key)), 'Reference bytes need UTF-8 text or an explicit base64 payload.')
  let decoded; try { decoded = atob(value.data) } catch { throw new Error('Reference bytes contain invalid base64.') }
  return Uint8Array.from(decoded, char => char.charCodeAt(0))
}
export function auditFileText(bundle, path) {
  invariant(Object.hasOwn(bundle.files, path), `The reference bundle omits ${path}.`)
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(auditFileBytes(bundle.files[path]))
}

export function auditReferencePaths(project, events) {
  const paths = Object.keys(project.spec.runtimeSources || {}).map(file => ({ key: `runtime/${file}`, location: 'project', path: file }))
  for (const input of project.spec.inputs) paths.push({ key: `inputs/${input.path}`, location: 'project', path: input.path })
  paths.push(...(benchmarkForDomain(project.spec.domain)?.audit?.referencePaths?.(project, events) || []))
  invariant(paths.every(row => safePath(row.key) && safePath(row.path)), 'Reference evidence paths must stay inside the source project or result directory.')
  return paths
}

export async function sealAuditReference(project, events, files) {
  const payload = { format: 'benchmark-audit-reference', version: AUDIT_VERSION, project: structuredClone(project), events: structuredClone(events), files: structuredClone(files) }
  const encoded = canonical(payload)
  referenceLimit(encoded)
  const bundle = { ...payload, sha256: await sha256(encoded) }
  await verifyAuditReference(bundle)
  return bundle
}
export async function verifyAuditReference(bundle) {
  invariant(object(bundle) && bundle.format === 'benchmark-audit-reference' && bundle.version === AUDIT_VERSION && hash(bundle.sha256), 'Import a version 1 benchmark audit reference bundle.')
  fields(bundle, ['format', 'version', 'project', 'events', 'files', 'sha256'], 'Reference bundle')
  invariant(!bundle.project?.spec?.auditPlan, 'A judge audit cannot recursively serve as its own reference study.')
  invariant(object(bundle.files) && Object.keys(bundle.files).every(safePath), 'Reference files must have safe paths.')
  const { sha256: digest, ...payload } = bundle, encoded = canonical(payload)
  referenceLimit(encoded)
  for (const value of Object.values(bundle.files)) auditFileBytes(value)
  invariant(await sha256(encoded) === digest, 'The reference bundle changed after sealing.')
  await verifyProject(bundle.project)
  await verifyResourceJournal(bundle.project, bundle.events)
  invariant(object(bundle.project.spec.runtimeSources) && ['study.mjs', 'prompts.mjs', 'runner.mjs', 'tasks.mjs'].every(file => hash(bundle.project.spec.runtimeSources[file])), 'Pin the source compiler and runner before making a reference bundle.')
  invariant(validateJournal(bundle.project, bundle.events).length === 0, 'Finish or explicitly recover an open source attempt before sealing its reference evidence.')
  const required = auditReferencePaths(bundle.project, bundle.events)
  invariant(required.length === Object.keys(bundle.files).length && required.every(row => Object.hasOwn(bundle.files, row.key)), 'The reference bundle must include exactly its pinned runtime, input and native evidence files.')
  for (const [file, expected] of Object.entries(bundle.project.spec.runtimeSources || {})) invariant(await sha256(auditFileBytes(bundle.files[`runtime/${file}`])) === expected, `The source runtime changed: ${file}.`)
  for (const input of bundle.project.spec.inputs) invariant(await sha256(auditFileBytes(bundle.files[`inputs/${input.path}`])) === input.sha256, `The source input changed: ${input.path}.`)
  for (const event of bundle.events.filter(row => row.type === 'finished' && row.status === 'completed')) await benchmarkForDomain(bundle.project.spec.domain)?.audit?.verifyReferenceObservation?.(bundle, event)
  return bundle
}

export const NATIVE_EVIDENCE_LIMITS = Object.freeze({ fileBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 })

function nativeCapability(project, capability) {
  const method = benchmarkForDomain(project?.spec?.domain)?.nativeEvidence?.[capability]
  invariant(typeof method === 'function', `The benchmark plugin does not provide native evidence capability ${capability}.`)
  return method
}
export function nativeEvidencePaths(project, attempts) { return nativeCapability(project, 'paths')(project, attempts) }
export async function materializeNativeControl(project, jobId, options = {}) { return nativeCapability(project, 'materializeControl')(project, jobId, options) }
export async function verifyNativeControl(input, options = {}) { return nativeCapability(input?.parentProject, 'verifyControl')(input, options) }
export async function verifyNativeAttemptEvidence(input) { return nativeCapability(input?.project, 'verifyAttempt')(input) }
export async function verifyNativeJournalEvidence(input) { return nativeCapability(input?.project, 'verifyJournal')(input) }

export function validateAuditPlan(plan) {
  invariant(object(plan) && plan.version === AUDIT_VERSION, 'Judge audits need a version 1 plan.')
  fields(plan, ['version', 'reference', 'rationale', 'criterion', 'selection', 'provenance', 'projection'], 'Judge audit plan')
  invariant(text(plan.rationale), 'Explain the audit case selection and intended claim.')
  invariant(object(plan.criterion) && ['frozen-grader', 'admissible-witness', 'declared-determinacy'].includes(plan.criterion.kind) && text(plan.criterion.statement), 'Declare the judge criterion and comparison scope.')
  fields(plan.criterion, ['kind', 'statement'], 'Audit criterion')
  invariant(object(plan.selection) && ['all', 'seeded'].includes(plan.selection.kind) && Number.isSafeInteger(plan.selection.seed) && plan.selection.seed >= 0 && plan.selection.seed <= 0xffffffff && Number.isSafeInteger(plan.selection.limit) && plan.selection.limit >= 1 && plan.selection.limit <= 512, 'Declare all or seeded audit selection, a 32-bit seed and a 1–512 case limit.')
  fields(plan.selection, ['kind', 'seed', 'limit'], 'Audit selection')
  invariant(object(plan.provenance) && ['canonical-study', 'generated-controls', 'external-benchmark'].includes(plan.provenance.kind) && text(plan.provenance.title) && text(plan.provenance.version) && Array.isArray(plan.provenance.sourcePaths), 'Declare the benchmark title, version, origin and pinned source paths.')
  fields(plan.provenance, ['kind', 'title', 'version', 'sourcePaths', 'citation', 'acquisition'], 'Audit provenance')
  invariant(plan.provenance.citation === undefined || text(plan.provenance.citation), 'A supplied citation must be text.')
  invariant(plan.provenance.sourcePaths.every(safePath) && new Set(plan.provenance.sourcePaths).size === plan.provenance.sourcePaths.length, 'Audit provenance paths must be distinct source input paths.')
  if (plan.provenance.kind === 'external-benchmark') invariant(plan.provenance.sourcePaths.length > 0, 'External benchmark provenance needs pinned source bytes; a name or URL alone is insufficient.')
  if (plan.provenance.kind === 'external-benchmark' || plan.provenance.acquisition !== undefined) {
    const acquisition = plan.provenance.acquisition
    invariant(object(acquisition) && text(acquisition.method) && text(acquisition.location) && text(acquisition.at) && Number.isFinite(Date.parse(acquisition.at)), 'Declare how, where and when the external benchmark source was acquired.')
    fields(acquisition, ['method', 'location', 'at'], 'Source acquisition')
  }
  invariant(object(plan.projection) && ['compiled-prompt', 'original-prompt-file'].includes(plan.projection.prompt) && typeof plan.projection.includeInput === 'boolean', 'Declare the original prompt projection and whether frozen input is visible to the judge.')
  fields(plan.projection, ['prompt', 'includeInput'], 'Audit request projection')
  if (plan.provenance.kind === 'external-benchmark') invariant(plan.projection.prompt === 'original-prompt-file', 'An external benchmark audit must project the pinned original prompt, while retaining any semantic reconstruction separately.')
  return plan
}

export function auditCatalog() {
  return [{ id: 'judge-instruction', version: '1', kind: 'atom', role: 'node', parameters: { criterion: '', task: '', candidate: '' },
    text: 'Evaluate the candidate under this criterion:\n{{criterion}}\n\nOriginal task:\n{{task}}\n\nCandidate response:\n{{candidate}}', semantics: { kind: 'judge-audit', task: '{{task}}', candidate: '{{candidate}}', criterion: '{{criterion}}' } }]
}
export function auditPlanFromReference(reference) {
  return { version: AUDIT_VERSION, reference, rationale: 'Draft audit of recorded candidates. Review source provenance, comparison scope and selection before judging.',
    criterion: { kind: 'frozen-grader', statement: 'Accept a candidate that meets the original task’s frozen observation criterion; reject one that fails that criterion. Report undetermined when the criterion cannot determine a verdict, or abstain when you cannot assess it.' },
    selection: { kind: 'all', seed: 42, limit: 512 }, provenance: { kind: 'canonical-study', title: reference.project.spec.name, version: reference.project.sha256, sourcePaths: [] },
    projection: { prompt: 'compiled-prompt', includeInput: true } }
}
export async function auditStudyFromReference(reference, { generate = true } = {}) {
  await verifyAuditReference(reference)
  const spec = genericStarter()
  spec.id = (reference.project.spec.id.slice(0, 57) + '-audit')
  spec.name = `Judge audit: ${reference.project.spec.name}`
  spec.requireReview = true; spec.catalog = auditCatalog(); spec.auditPlan = auditPlanFromReference(reference)
  spec.protocol.grading = { kind: 'judge-audit' }
  spec.analysisPlan.primaryPopulation = 'reference-eligible'
  spec.analysisPlan.rationale = 'Draft audit protocol. Primary agreement rates use cases with reference labels fixed before judge collection. Keep unresolved references, abstentions and collection failures visible.'
  spec.conditions[0] = { id: 'judge', label: 'Judge to be configured', model: { provider: 'undeclared', id: 'undeclared', settings: {} }, adapter: { kind: 'replay', responses: {} } }
  spec.tasks = generate ? (await materializeAudit(spec.auditPlan)).tasks : [{ id: 'audit-draft', familyId: 'audit-draft', split: 'development', root: { use: 'judge-instruction' }, expected: null, input: null }]
  return spec
}

export function auditAnalysis(project, rows) {
  if (!project.audit) return null
  const ratio = (n, d) => d ? n / d : null
  const groups = project.spec.conditions.map(condition => {
    const subset = rows.filter(row => row.conditionId === condition.id), eligible = subset.filter(row => row.referenceEligible), completed = eligible.filter(row => row.status === 'completed')
    const count = (expected, verdict) => completed.filter(row => row.audit.referenceVerdict === expected && row.audit.judgeVerdict === verdict).length
    const rejected = eligible.filter(row => row.audit.referenceVerdict === 'reject'), rejectedCompleted = rejected.filter(row => row.status === 'completed')
    const accepted = eligible.filter(row => row.audit.referenceVerdict === 'accept'), acceptedCompleted = accepted.filter(row => row.status === 'completed')
    const confusion = ['accept', 'reject', 'undetermined', null].flatMap(expected => [...AUDIT_VERDICTS, null].map(verdict => ({ referenceVerdict: expected, judgeVerdict: verdict,
      count: subset.filter(row => row.status === 'completed' && row.audit.referenceVerdict === expected && row.audit.judgeVerdict === verdict).length })))
    return { condition: condition.id, scheduled: subset.length, completed: subset.filter(row => row.status === 'completed').length, eligibleScheduled: eligible.length, eligibleCompleted: completed.length,
      unresolvedReferences: subset.filter(row => !row.referenceEligible).length, agreements: completed.filter(row => row.passed).length,
      correctRejections: count('reject', 'reject'), falseAcceptances: count('reject', 'accept'), falseRejections: count('accept', 'reject'),
      rejectionDetectionScheduled: ratio(count('reject', 'reject'), rejected.length), rejectionDetectionCompleted: ratio(count('reject', 'reject'), rejectedCompleted.length),
      falseAcceptanceCompleted: ratio(count('reject', 'accept'), rejectedCompleted.length), falseRejectionCompleted: ratio(count('accept', 'reject'), acceptedCompleted.length), confusion }
  })
  return { version: AUDIT_VERSION, ...project.audit, groups,
    scope: project.spec.auditPlan.criterion.kind,
    limitations: [
      'Judge agreement is relative to the frozen comparison criterion and supplied reference evidence. It is not a universal claim about natural-language correctness or the judge’s performance on unselected tasks.',
      'Reference eligibility is fixed before judge collection. Unresolved reference cases retain null scores and remain in the disposition ledger; they cannot become judge mistakes or evidence of semantic uniqueness.',
      'Imported artifacts and review records establish reproducible bindings, not cryptographic proof of who executed a program or approved its interpretation. Custom reference scores retain their recorded-grader basis.',
      'Candidate deduplication and sampling precede judge collection. The complete source trial ledger, including unmeasured, duplicated and unselected source cases, is retained.',
    ] }
}

function referenceVerdict(plan, task, completion) {
  const kind = plan.criterion.kind, grade = completion.grade
  if (kind === 'declared-determinacy') return task.informationPacket?.observableClasses.length >= 2
    ? { expected: 'undetermined', basis: 'multiple-declared-observable-classes' }
    : { expected: null, basis: 'finite-agreement-does-not-prove-determinacy' }
  const basis = task.information ? 'declared-interpretation-set' : plan.reference.project.spec.protocol.grading.kind === 'module' ? 'recorded-custom-grader' : 'frozen-observation-criterion'
  if (kind === 'admissible-witness') return grade.passed ? { expected: 'accept', basis } : { expected: null, basis: 'no-admissible-witness-established' }
  return { expected: grade.passed ? 'accept' : 'reject', basis }
}
function shuffled(rows, seed) {
  let state = seed >>> 0
  for (let i = rows.length - 1; i > 0; i--) {
    state += 0x6D2B79F5; let value = state
    value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    const j = Math.floor(((value ^ value >>> 14) >>> 0) / 4294967296 * (i + 1))
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
  }
  return rows
}
export async function materializeAudit(plan) {
  validateAuditPlan(plan); await verifyAuditReference(plan.reference)
  const source = plan.reference.project, ledger = [], candidates = new Map()
  for (const path of plan.provenance.sourcePaths) invariant(Object.hasOwn(plan.reference.files, `inputs/${path}`), `Pin original benchmark source ${path} in the reference project's input manifest.`)
  const ends = new Map(), lastEnds = new Map()
  for (const event of plan.reference.events.filter(row => row.type === 'finished')) lastEnds.set(event.trialId, event)
  for (const event of plan.reference.events.filter(row => row.type === 'finished' && row.status === 'completed')) ends.set(event.trialId, event)
  for (const trial of source.schedule) {
    const task = source.tasks.find(row => row.id === trial.taskId), completion = ends.get(trial.id)
    const last = lastEnds.get(trial.id), responseRetained = Object.hasOwn(last?.response || {}, 'output')
    const row = { sourceTrialId: trial.id, sourceTaskId: task.id, sourceAttempt: completion?.attempt ?? null, sourceStatus: last?.status || 'not-attempted', sourcePhase: last?.phase || null,
      responseRetained, disposition: responseRetained ? 'source-ungraded-response' : 'source-unmeasured' }
    ledger.push(row)
    if (!completion) continue
    let prompt = task.compiled.text
    if (plan.projection.prompt === 'original-prompt-file') {
      const path = task.provenance?.originalPromptPath
      invariant(safePath(path) && Object.hasOwn(plan.reference.files, `inputs/${path}`), `${task.id}: pin its originalPromptPath as source input bytes before auditing external wording.`)
      invariant(plan.provenance.sourcePaths.includes(path), `${task.id}: include its original prompt in the declared provenance source paths.`)
      prompt = auditFileText(plan.reference, `inputs/${path}`)
    }
    const input = plan.projection.includeInput ? task.input ?? null : null, candidate = completion.response.output
    const identity = await sha256(canonical({ prompt, input, candidate, criterion: plan.criterion })), id = 'audit-' + identity.slice(0, 32)
    const reference = referenceVerdict(plan, task, completion)
    row.auditTaskId = id; row.expectedVerdict = reference.expected; row.referenceBasis = reference.basis
    if (candidates.has(identity)) {
      const prior = candidates.get(identity)
      invariant(prior.task.expected === reference.expected, 'Identical judge inputs have conflicting reference verdicts. Resolve the source ambiguity before auditing them.')
      invariant(prior.task.familyId === (task.familyId || task.id) && prior.task.split === task.split, 'Identical judge inputs span different source families or splits. Group source aliases in one family and split before auditing them.')
      row.disposition = 'duplicate-excluded'; prior.task.audit.origins.push({ trialId: trial.id, attempt: completion.attempt }); continue
    }
    row.disposition = 'eligible'
    const derived = { id, root: { use: 'judge-instruction' }, variables: { criterion: plan.criterion.statement, task: prompt, candidate: typeof candidate === 'string' ? candidate : canonical(candidate) }, input,
      expected: reference.expected, familyId: task.familyId || task.id, split: task.split,
      factors: { source_task: task.id, reference_basis: reference.basis, reference_verdict: reference.expected || 'unresolved' },
      audit: { version: AUDIT_VERSION, referenceSha256: plan.reference.sha256, sourceTaskId: task.id, origins: [{ trialId: trial.id, attempt: completion.attempt }],
        candidateSha256: await sha256(canonical(candidate)), originalPromptSha256: await sha256(prompt), reconstructedPromptSha256: task.compiled.promptSha256,
        referenceVerdict: reference.expected, referenceBasis: reference.basis, sourceGrade: completion.grade } }
    candidates.set(identity, { row, task: derived })
  }
  const pool = [...candidates.values()]
  if (plan.selection.kind === 'all') invariant(pool.length <= plan.selection.limit, 'The source contains more unique candidates than the frozen audit limit. Declare a sampling policy or raise the limit.')
  else shuffled(pool, plan.selection.seed)
  const selected = pool.slice(0, plan.selection.limit)
  for (let i = 0; i < pool.length; i++) pool[i].row.disposition = i < plan.selection.limit ? 'selected' : 'sample-excluded'
  invariant(selected.length > 0, 'The source has no completed candidates for an audit; no reference answer was inferred.')
  const recipe = { ...plan, reference: { sha256: plan.reference.sha256 } }
  const manifest = { format: 'benchmark-judge-audit', version: AUDIT_VERSION, planSha256: await sha256(canonical(recipe)), referenceSha256: plan.reference.sha256,
    sourceTrials: source.schedule.length, uniqueCandidates: candidates.size, selectedCases: selected.length, referenceEligibleCases: selected.filter(row => row.task.expected !== null).length,
    criterion: plan.criterion, provenance: plan.provenance, projection: plan.projection, selection: plan.selection, sourceSelection: 'first-completed', ledger }
  return { tasks: selected.map(row => row.task), manifest, sha256: await sha256(canonical(manifest)) }
}

export async function auditReviewPacket(project, task) {
  const source = project.spec.auditPlan.reference.project, subject = source.tasks.find(row => row.id === task.audit.sourceTaskId)
  const packet = { format: 'benchmark-audit-review', version: AUDIT_VERSION, taskId: task.id, familyId: task.familyId, split: task.split,
    prompt: task.compiled.text, promptSha256: task.compiled.promptSha256, input: task.input, criterion: project.spec.auditPlan.criterion,
    provenance: project.spec.auditPlan.provenance, projection: project.spec.auditPlan.projection, audit: task.audit,
    referenceBundleSha256: project.spec.auditPlan.reference.sha256, manifestSha256: project.audit.sha256,
    referenceTask: { prompt: subject.compiled.text, semantic: subject.compiled.semantic, expected: subject.expected, input: subject.input ?? null, information: subject.informationPacket || null },
    ...(project.spec.observationPlan ? { observationPlan: project.spec.observationPlan, observationConditions: project.spec.conditions.map(condition => ({ id: condition.id, model: condition.model || null, collection: condition.collection || null, adapterKind: condition.adapter.kind })) } : {}),
    referenceGrader: source.spec.protocol.grading, referenceEnvironment: source.spec.environment || {},
    runtimeSources: project.spec.runtimeSources || {}, grader: project.spec.protocol.grading, protocol: project.spec.protocol, analysisPlan: project.spec.analysisPlan || null,
    bundles: task.compiled.bundles.map(({ id, hash, rootSha256 }) => ({ id, hash, rootSha256 })) }
  return { ...packet, sha256: await sha256(canonical(packet)) }
}
export async function createAuditReviewRecord(task, reviewer, at = new Date().toISOString()) {
  invariant(task.auditPacket?.sha256 && text(reviewer) && Number.isFinite(Date.parse(at)), 'Prepare the audit packet and supply a reviewer name and timestamp.')
  return { taskId: task.id, reviewer: reviewer.trim(), at, decision: 'approved', packetSha256: task.auditPacket.sha256 }
}
export function auditReviewStatus(task, records = []) {
  invariant(Array.isArray(records) && records.every(object), 'Audit review records must be an array.')
  const review = records.filter(row => row.taskId === task.id).at(-1)
  return { approved: review?.decision === 'approved' && text(review.reviewer) && Number.isFinite(Date.parse(review.at)) && review.packetSha256 === task.auditPacket?.sha256, review }
}
export function gradeJudge(task, output) {
  let value
  try { value = typeof output === 'string' ? JSON.parse(output) : output } catch {}
  const valid = object(value) && AUDIT_VERDICTS.includes(value.verdict) && (value.reason === undefined || typeof value.reason === 'string') && Object.keys(value).every(key => ['verdict', 'reason'].includes(key))
  const expected = task.audit.referenceVerdict, eligible = expected !== null
  const verdict = valid ? value.verdict : null
  return { passed: eligible ? verdict === expected : null, score: eligible ? (verdict === expected ? 1 : 0) : null, referenceEligible: eligible,
    classification: !valid ? 'malformed-judge-verdict' : verdict === 'abstain' ? 'judge-abstention' : !eligible ? 'reference-unresolved' : verdict === expected ? 'judge-agreement' : 'judge-disagreement',
    judgeVerdict: verdict, referenceVerdict: expected, referenceBasis: task.audit.referenceBasis }
}
export function auditProjectFiles(project) {
  if (!project.audit) return {}
  const files = { 'audit/reference-bundle.json': JSON.stringify(project.spec.auditPlan.reference, null, 2) + '\n',
    'audit/manifest.json': JSON.stringify(project.audit, null, 2) + '\n', 'audit/reviews.json': JSON.stringify(project.spec.auditReviews || [], null, 2) + '\n' }
  for (const task of project.tasks) files[`audit/packets/${task.id}.json`] = JSON.stringify(task.auditPacket, null, 2) + '\n'
  return files
}
