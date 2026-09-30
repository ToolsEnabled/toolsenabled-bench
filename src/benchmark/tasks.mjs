// The one task compiler used by previews, freezing, interpretation packets and
// exported verification. The private oracle never enters adapter requests.
import { canonical, compilePrompt, invariant, sha256 } from './prompts.mjs'
import { modernSchema } from './study-schema.mjs'
import { benchmarkForDomain, gradingKind } from './registry.mjs'
import { bindInformationPacket, taskReviewStatus, validateInformation } from './information.mjs'
import { renderComposition, compositionRequirements } from './composition.mjs'

export async function deriveTaskExpected(spec, task) {
  const derive = benchmarkForDomain(spec.domain)?.taskSemantics?.deriveExpected
  invariant(typeof derive === 'function', 'The selected benchmark does not derive expected answers. Supply an explicit expected result.')
  return derive(spec, task)
}

export function taskGradingContract(spec) {
  const grading = { ...spec.protocol.grading }
  return gradingKind(grading.kind)?.normalize?.(spec, grading) || grading
}

export async function semanticTaskId(domain, task) {
  const variance = task.compiled.composition?.omissions || task.compiled.composition?.nodes.some(node => node.omissions?.length)
  return sha256(canonical(task.information
    ? { promptSha256: task.compiled.promptSha256, input: task.input ?? null,
        readings: task.interpretations.map(reading => canonical({ semantic: reading.compiled.semantic, expected: reading.expected })).sort() }
    : { semantic: task.compiled.semantic, input: task.input ?? null, ...(domain === 'generic' || variance ? { promptSha256: task.compiled.promptSha256 } : {}), ...(task.resource ? { resourcePacketSha256: task.resource.sha256 } : {}) }))
}

function appendContract(compiled, text, spec, id, source = 'tasks.mjs') {
  compiled.composition.appendices.push(JSON.parse(canonical({ id, text, source, sha256: spec.runtimeSources?.[source] || null })))
  Object.assign(compiled, renderComposition(compiled.composition), { checklist: compositionRequirements(compiled.composition) })
}
async function compileOne(spec, task, { requireReview, withheldPaths = [], generatedExpected = false, validateExpected = true } = {}) {
  const compiled = await compilePrompt(spec.catalog, task.root, { requireReview, variables: task.variables || {}, reviews: spec.reviews || [], withheldPaths, omissions: task.promptOmissions })
  if (task.variance) invariant(task.variance.sourceSha256 === (task.promptOmissions?.sourceSha256 || compiled.promptSha256), `${task.id}: the variance provenance differs from the original prompt fingerprint.`)
  let expected = task.expected
  const semantics = benchmarkForDomain(spec.domain)?.taskSemantics
  const options = () => ({ expected, generatedExpected, validateExpected,
    appendContract: (text, id, source) => appendContract(compiled, text, spec, id, source) })
  if (semantics?.prepare) expected = await semantics.prepare(spec, task, compiled, options())
  if (task.information?.responseMode === 'tagged-json') appendContract(compiled, '\n\nResponse format (part of this exact prompt):\nReturn one JSON object. For an answer use {"kind":"answer","answer":...}. For a request for missing information use {"kind":"clarification","message":"..."}. For a refusal use {"kind":"refusal","message":"..."}. Do not include any other fields. The answer field contains the requested result or program.', spec, 'response-envelope')
  if (spec.protocol.grading.kind === 'judge-audit') appendContract(compiled, '\n\nJudge response format (part of this exact prompt):\nReturn one JSON object with verdict equal to "accept", "reject", "undetermined", or "abstain". An optional reason field may contain text. Include no other fields.', spec, 'judge-contract')
  if (semantics?.finalize) expected = await semantics.finalize(spec, task, compiled, options())
  invariant(expected !== undefined, `${task.id}: supply the expected result (null is permitted for a custom grader).`)
  if (spec.protocol.grading.kind === 'exact') invariant(typeof expected === 'string', `${task.id}: exact text grading needs a string answer. Use JSON grading for other values.`)
  compiled.promptSha256 = await sha256(compiled.text)
  return { ...task, expected, compiled }
}

export async function compileTask(spec, task, { requireReview = spec.requireReview === true, requireTaskReview = requireReview, validateExpected = true } = {}) {
  spec = { ...spec, protocol: { ...spec.protocol, grading: taskGradingContract(spec) } }
  const information = task.information
  if (information) {
    validateInformation(information)
    invariant(typeof task.familyId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(task.familyId), `${task.id}: information variants need an explicit familyId.`)
    // Each grading contract declares whether it can carry information treatments.
    const contract = gradingKind(spec.protocol.grading.kind)
    invariant(['exact', 'json'].includes(spec.protocol.grading.kind) || contract?.supportsInformation === true,
      'Information treatments require exact or JSON grading, or a registered grading contract that declares supportsInformation; an unrelated custom grader cannot silently replace the declared interpretation set.')
  }
  const compiled = await compileOne(spec, task, { requireReview, withheldPaths: information?.withheldPaths || [], validateExpected })
  if (!information) return compiled
  const interpretations = [], identities = new Set(), candidates = []
  for (const reading of information.readings || information.readingPool) {
    const input = { ...task, root: reading.root, variables: { ...(task.variables || {}), ...(reading.variables || {}) } }
    if (Object.hasOwn(reading, 'expected')) input.expected = reading.expected
    else delete input.expected
    const result = await compileOne(spec, input, { requireReview, withheldPaths: information.withheldPaths, generatedExpected: true })
    const consistent = result.compiled.text === compiled.compiled.text
    invariant(consistent || information.readingPool, `${task.id}/${reading.id}: the reading changes disclosed prompt content. Every admissible reading must agree on the exact visible prompt.`)
    candidates.push({ id: reading.id, disposition: consistent ? 'retained' : 'disclosed-conflict', promptSha256: result.compiled.promptSha256,
      semanticSha256: await sha256(canonical(result.compiled.semantic)), roots: result.compiled.bundles.map(({ id, hash, rootSha256 }) => ({ id, hash, rootSha256 })) })
    if (!consistent) continue
    const identity = canonical(result.compiled.semantic)
    invariant(!identities.has(identity), `${task.id}: two declared readings have the same semantic representation.`)
    identities.add(identity)
    interpretations.push({ ...reading, expected: result.expected, compiled: result.compiled })
  }
  compiled.interpretations = interpretations
  invariant(interpretations.length > 0, `${task.id}: no declared reading agrees with the visible prompt.`)
  compiled.informationSelection = { rule: information.readingPool ? 'visible-consistency' : 'explicit-readings', candidates }
  compiled.informationPacket = await bindInformationPacket(compiled, spec, interpretations)
  invariant(!requireTaskReview || taskReviewStatus(compiled, spec.taskReviews || []).approved, `${task.id}: review the current visible prompt and complete admissible-reading packet before freezing.${modernSchema(spec) ? ' Include the declared condition settings, workflow assignments and stage context.' : ''}`)
  return compiled
}
