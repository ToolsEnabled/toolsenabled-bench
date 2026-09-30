// Lean admission, journal and reporting rules. The core calls these lazily.
import { canonical, invariant, object } from './prompts.mjs'
import { decodeInformationResponse, gradeInterpretations, informationDisposition } from './information.mjs'
import { extractSource, sourceFailureClassification } from './extraction.mjs'
import { extractionPolicyFor } from './registry.mjs'
import { matchesNativeObservationProfile } from './lean-observations.mjs'

export function leanReadinessProfile(project, { add, scientific, proof }) {
  const { spec } = project, grading = spec.protocol?.grading?.kind
  let profile
  if (grading === 'lean-python') {
    profile = { id: 'lean-native-unadmitted', version: 1, scope: 'Candidate code needs native source/image/data/observer/control admission; semantic answer qualification is insufficient.' }
    scientific('native-admission-unavailable', 'protocol.grading.kind', 'Native candidate collection remains blocked until its source, image, data, observer and control admission mechanism is implemented and the original gates are satisfied.')
    // A recorded response is routed exactly as gradeLean routes a live answer. A structured
    // JSON value where a program is graded -- the JSON starter's trace canary kept after
    // switching to lean-python -- can only record no-program, while every earlier gate
    // passed; refuse it before an engine run is paid for. Tagged clarification/refusal
    // envelopes are designed non-answers, and null or string responses still receive the
    // grader's own visible no-program classification, which negative controls rely on.
    for (const condition of spec.conditions) {
      const responses = condition.adapter?.kind === 'replay' ? condition.adapter.responses : null
      if (!object(responses)) continue
      for (const task of project.tasks) {
        if (!Object.hasOwn(responses, task.id)) continue
        let answer = responses[task.id]
        if (task.information) {
          const decoded = decodeInformationResponse(task, answer)
          if (decoded.behavior !== 'answer') continue
          answer = decoded.answer
        }
        if (answer === null || typeof answer !== 'object') continue
        // Which bytes count as the program is the study's declared extraction
        // policy, not a Python rule the core happens to know.
        const policy = extractionPolicyFor(spec)
        try { extractSource(answer, policy) } catch (error) {
          add('replay-response-not-a-program', 'conditions.' + condition.id + '.adapter.responses.' + task.id,
            `The recorded response for task "${task.id}" in condition "${condition.id}" is a JSON value, not a program (${error.message}), so every trial would record ${sourceFailureClassification(error)}. Record one ${policy.label} program, or grade this study as JSON.`)
        }
      }
    }
    return { profile }
  }
  if (grading === 'json') {
    profile = { id: 'lean-semantic-answer', version: 1, scope: 'Requires independent JavaScript/Python interpretation of semantic or operational JSON answers; no native execution of candidate code is inferred.' }
    return { profile, interpretedAnswers: true }
  }
  return null
}

export function validateLeanInformationGrade(project, task, event) {
  if (project.spec.protocol.grading.kind !== 'lean-python') return
            const decoded = decodeInformationResponse(task, event.response.output)
            if (decoded.behavior !== 'answer') invariant(canonical(informationDisposition(decoded)) === canonical(event.grade), 'The recorded information disposition disagrees with its retained response.')
            else if (Object.hasOwn(event.grade, 'trace')) {
              invariant(matchesNativeObservationProfile(event.grade.trace, !!task.compiled.operational), 'The retained native trace has the wrong observation profile for this task.')
              const expected = gradeInterpretations(task, event.grade.trace, 'json')
              invariant(Object.entries(expected).every(([key, value]) => canonical(value) === canonical(event.grade[key])), 'The recorded interpretation grade disagrees with its retained engine trace.')
            } else invariant(!event.grade.passed && ['no-program', 'format-violation', 'execution-timeout', 'execution-error', 'invalid-engine-result'].includes(event.grade.classification), 'An information answer needs a retained native trace or an explicit execution failure.')
}

export const NATIVE_ADMISSION_LIMITATION = 'Native LEAN admission is not part of this version. Until it ships, a native LEAN run is apparatus-development evidence, not an admitted experimental result.'
export function nativeAdmissionLimitation(spec) {
  return spec?.protocol?.grading?.kind === 'lean-python' ? [NATIVE_ADMISSION_LIMITATION] : []
}
export function nativeApparatusReport(head, { project, events, protocol, NOT_DECLARED }) {
  if (protocol.grading.kind !== 'lean-python') return
    head.paragraph('Native grading runs each returned program in an owned, disposable container and grades the engine order artifacts. Printed trace claims in model output are ignored.')
    // Container arguments come only from the grade records this run wrote. An attempt
    // reached the engine when its grade carries an execution record.
    const engineGrades = events.filter(event => event.type === 'finished' && event.grade && Object.hasOwn(event.grade, 'execution'))
    const recordedContainers = engineGrades.filter(event => event.grade.container), variants = new Set(recordedContainers.map(event => canonical(event.grade.container)))
    const container = variants.size === 1 ? recordedContainers[0].grade.container : null
    const mounts = container ? container.arguments.filter((arg, index, args) => args[index - 1] === '--mount').map(value => {
      const target = value.split(',').find(part => part.startsWith('target='))?.slice(7) || value
      return target + (value.split(',').includes('readonly') ? ' (read-only)' : ' (writable)')
    }) : []
    const notRecorded = engineGrades.length === 0 ? 'Not recorded: no attempt in this journal reached the engine'
      : 'Not recorded: none of the ' + engineGrades.length + ' native grade records in this journal carries its container arguments'
    head.table('native-apparatus', ['Field', 'Value'], [
      ['Pinned engine image', project.spec.environment?.leanImage || NOT_DECLARED],
      ['Execution timeout ms', protocol.grading.executionTimeoutMs ?? NOT_DECLARED],
      ['Container arguments', recordedContainers.length === 0 ? notRecorded : container ? container.engine + ' ' + container.arguments.join(' ') + ' (recorded in ' + recordedContainers.length + ' of ' + engineGrades.length + ' native grade records)'
        : variants.size + ' different argument lists are recorded; each attempt\u2019s grade.json carries its own'],
      ['Mounts', recordedContainers.length === 0 ? notRecorded : container ? mounts.join('; ') || 'None recorded' : 'See each attempt\u2019s grade.json'],
      ['Data generation (runtime behaviour, not a per-run record)', 'deterministic equity minute files generated from the frozen task input; market-hours and symbol-properties copied from the pinned image'],
    ])
}
export function leanEnvironment(spec) {
  return { node: spec.environment.node ?? null, python: spec.environment.python ?? null, leanImage: spec.environment.leanImage || null }
}
export function leanExternalAssets(spec) { return Boolean(spec.environment?.leanImage) }
