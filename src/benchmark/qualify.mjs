// Portable deterministic apparatus checks; this is not a personal review or a
// receipt for model collection or native execution.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonical, invariant, sha256 } from './prompts.mjs'
import { gradeResponse } from './study.mjs'
import { qualifyRequirements, requirementInterpreterRequest } from './requirements.mjs'
import { commandAdapter, confinedFile, loadPluginHandler } from './cli.mjs'
export { requirementInterpretation } from './requirements.mjs'

export async function qualifyProject(root, project, { python = process.platform === 'win32' ? 'python' : 'python3', signal = new AbortController().signal } = {}) {
  const checks = [], moduleExecutions = [], modules = project.requirements?.interpreters
  const moduleReference = async (kind, task, target = null) => {
    signal.throwIfAborted()
    const binding = modules[kind], file = await confinedFile(root, binding.file), request = requirementInterpreterRequest(task, target)
    invariant(await sha256(await readFile(file)) === binding.sha256, 'Qualification interpreter source changed: ' + binding.file + '.')
    const controller = new AbortController(), cancel = () => controller.abort(signal.reason || new Error('Qualification cancelled.'))
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    const timer = setTimeout(() => controller.abort(new Error('Interpreter module exceeded its 60-second budget.')), 60000)
    try {
      const response = await commandAdapter(root, { command: process.execPath, args: [resolve(root, 'module-host.mjs'), file, 'interpret'] }, request, controller.signal)
      moduleExecutions.push({ kind, binding, request, process: response.process })
      return response.output
    } catch (error) {
      moduleExecutions.push({ kind, binding, request, error: error.message || String(error), ...(error.evidence ? { process: error.evidence } : {}) })
      throw error
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
  }
  try {
  const createHooks = await loadPluginHandler(project, 'qualify')
  const hooks = createHooks ? await createHooks(root, project, { python, signal }) : {}
  if (hooks.controls) await hooks.controls(check => checks.push(check))
  for (const task of project.tasks) {
    signal.throwIfAborted()
    const variants = [{ id: null, compiled: task.compiled, expected: task.expected }, ...(task.interpretations || [])]
    for (const variant of variants) {
      const identity = { taskId: task.id, ...(variant.id ? { readingId: variant.id } : {}) }
      if (hooks.qualifyVariant) {
        checks.push(await hooks.qualifyVariant(task, variant))
      } else if (modules) {
        if (task.information && !variant.id) continue
        const evaluated = { ...task, compiled: variant.compiled, root: variant.root || task.root, variables: { ...(task.variables || {}), ...(variant.variables || {}) }, expected: variant.expected }
        const reference = await moduleReference('reference', evaluated), independent = await moduleReference('independent', evaluated)
        invariant(reference && Object.hasOwn(reference, 'observation') && canonical(reference) === canonical(independent)
          && canonical(reference.observation) === canonical(variant.expected), 'The generic interpreter counterparts disagree or differ from the frozen expected observation.')
        checks.push({ ...identity, passed: true, kind: 'independent-module-interpretation', reference, independent })
      } else if (project.spec.protocol.grading.kind === 'judge-audit') {
        const known = task.audit.referenceVerdict !== null, grade = gradeResponse(project, task, { verdict: task.audit.referenceVerdict || 'abstain' })
        invariant(known ? grade.passed === true && grade.score === 1 : grade.passed === null && grade.score === null, 'The audit grader disagrees with its frozen reference eligibility.')
        checks.push({ ...identity, passed: true, kind: 'judge-reference-binding', referenceEligible: known, referenceBasis: task.audit.referenceBasis, grade,
          scope: 'Reference bundle, source journal and native artifacts (when present) were rechecked; no new judge or native execution is inferred.' })
      } else if (['exact', 'json'].includes(project.spec.protocol.grading.kind)) {
        if (task.information && !variant.id) continue // The latent baseline is not an arbitrary grading oracle.
        let output = project.spec.protocol.grading.kind === 'json' ? canonical(variant.expected) : variant.expected
        if (task.information?.responseMode === 'tagged-json') output = { kind: 'answer', answer: variant.expected }
        const correct = gradeResponse(project, task, output)
        invariant(correct.passed && correct.score === 1, `${task.id}: the declared answer fails its own grading rule.`)
        checks.push({ ...identity, passed: true, kind: task.information ? 'declared-interpretation' : 'declared-answer', grade: correct })
      } else checks.push({ ...identity, passed: null, kind: 'custom-grader', reason: 'Supply independent fixtures for this custom grading rule.' })
    }
  }
  const requirements = project.requirements ? await qualifyRequirements(project.requirements, hooks.requirements || (modules ? { signal, interpret: (task, target) => moduleReference('reference', task, target), independent: (task, target) => moduleReference('independent', task, target) } : { signal })) : null
  return { format: 'research-benchmark-qualification', version: 1, projectSha256: project.sha256, runtimeSources: project.spec.runtimeSources,
    ...(requirements ? { requirements } : {}), ...(modules ? { moduleExecutions } : {}),
    environment: { node: process.version, platform: process.platform, architecture: process.arch, python }, checks,
    scope: hooks.scope || 'Local compiler/interpreter and declared-answer checks. This record does not execute a model or native engine, approve bundles, or certify a counted study.' }
  } catch (error) {
    error.partialQualification = { projectSha256: project.sha256, runtimeSources: project.spec.runtimeSources, checks, moduleExecutions,
      status: 'interrupted-or-failed', scope: 'Partial diagnostic execution only; no successful qualification proof.' }
    throw error
  }
}
