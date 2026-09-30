// Lean Bench's requirement interpreter projection and native control roster.
import { canonical, invariant, object, sha256 } from './prompts.mjs'
import { modernSchema } from './study-schema.mjs'
import { validateLean } from './lean.mjs'
import { validateTradingMarket } from './trading-market.mjs'
import { tradingObservationContract } from './trading-observations.mjs'
import { NATIVE_PREPARATION_LIMITS, nativeControlSource } from './requirements.mjs'
const fields = (value, keys, label) => invariant(object(value) && Object.keys(value).every(key => keys.includes(key)), label + ' contains unsupported fields.')
const rationale = value => invariant(typeof value === 'string' && value.trim() && value.length <= 16000, 'Explain the registered requirement or wrong reading.')

// Legacy compiled tasks carry no domain ID. Match this plugin's serialized
// apparatus markers without adding fields that would re-identify old studies.
export function matchesRequirementTask(task) {
  return task?.compiled?.operational?.format === 'lean-operational-ir'
    || (task?.compiled?.semantic?.kind === 'constitution' && task.compiled.bundles?.some(bundle => bundle.id === 'constitution-v1'))
}
export function validRequirementInput(task, input) {
  try { task.compiled.operational ? validateTradingMarket(task.compiled.operational, input) : validateLean(task.compiled.semantic, input); return true }
  catch { return false }
}

export function validateNativePreparationPlan(spec) {
  const plan = spec.nativePreparationPlan
  if (plan === undefined) return
  invariant(modernSchema(spec) && spec.domain === 'lean-bench' && spec.protocol?.grading?.kind === 'lean-python', 'Native preparation controls require a schema-2-or-later Lean study with the lean-python grader.')
  invariant(spec.requirementPlan?.selectedInput?.policy === 'require-composition', 'Native preparation controls require complete selected-input composition registration.')
  fields(plan, ['version', 'coverage', 'rationale', 'referenceReplicates', 'mutantReplicates', 'budgets'], 'Native preparation plan')
  invariant(plan.version === 1 && plan.coverage === 'all-selected-readings-occurrences-and-probes', 'Native preparation retains every selected reading, occurrence and registered probe.')
  rationale(plan.rationale)
  invariant(Number.isSafeInteger(plan.referenceReplicates) && plan.referenceReplicates >= 3 && plan.referenceReplicates <= 20, 'Declare 3–20 fresh reference replicates per native control.')
  invariant(Number.isSafeInteger(plan.mutantReplicates) && plan.mutantReplicates >= 1 && plan.mutantReplicates <= 20, 'Declare 1–20 fresh mutant replicates per native control.')
  const budget = plan.budgets
  fields(budget, ['maxNativeExecutions', 'executionTimeoutMs', 'attemptTimeoutMs', 'maxDurationMs'], 'Native preparation budgets')
  const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max
  invariant(bounded(budget.maxNativeExecutions, 1, 100000), 'Declare a native execution budget of 1–100000 starts.')
  invariant(bounded(budget.executionTimeoutMs, 100, 3570000), 'Declare a native execution timeout of 100–3570000 ms.')
  invariant(bounded(budget.attemptTimeoutMs, budget.executionTimeoutMs + NATIVE_PREPARATION_LIMITS.cleanupAllowanceMs, 3600000), 'The native control attempt timeout must include at least 30000 ms beyond execution for owned container cleanup.')
  invariant(bounded(budget.maxDurationMs, 1, 86400000), 'Declare a native preparation duration budget of 1 ms to one day.')
}

export function nativeControlContract(task) {
  // The synchronous observer has no independent contract object. Conservatively
  // bind the full semantic/input context instead of promising a smaller stable
  // projection. Operational controls use the actual public harness contract.
  return task.compiled.operational
    ? { profile: 'operational-v1', publicContract: tradingObservationContract(task.compiled.operational, task.input) }
    : { profile: 'synchronous-v1', semantic: task.compiled.semantic, input: task.input }
}

export async function compileNativePreparationPlan(spec, requirements) {
  if (spec.nativePreparationPlan === undefined) return null
  // Public callers may edit a draft while hashing is pending. All subsequent
  // hashes and returned rows must refer to one privately captured source state.
  spec = structuredClone(spec); requirements = structuredClone(requirements)
  validateNativePreparationPlan(spec)
  invariant(requirements?.selectedInput?.policy === 'require-composition', 'Compile the selected-input requirement registry before native controls.')
  const { sha256: registryHash, ...registryBody } = requirements
  invariant(requirements.format === 'benchmark-requirement-registry' && requirements.version === 1
    && registryHash === await sha256(canonical(registryBody))
    && requirements.planSha256 === await sha256(canonical(spec.requirementPlan))
    && canonical(requirements.runtimeSources) === canonical(spec.runtimeSources || {}), 'Native preparation requires the exact source-bound requirement registry.')
  const recipe = spec.nativePreparationPlan, profile = spec.leanProfile || 'synchronous-v1', jobs = [], coverage = [], gaps = []
  const identities = new Map(), digest = value => sha256(canonical(value))
  const add = async (source, kind) => {
    const { reference, program } = nativeControlSource(requirements, source)
    const descriptor = { kind, profile, generator: profile === 'operational-v1' ? 'operationalReferenceProgram-v1' : 'inlineLeanProgram-v1',
      referenceTaskSha256: await digest(reference), programTaskSha256: await digest(program), inputSha256: await digest(program.input),
      referenceExpectedSha256: await digest(reference.expected), programExpectedSha256: await digest(program.expected),
      referenceContractSha256: await digest(nativeControlContract(reference)), programContractSha256: await digest(nativeControlContract(program)),
      replicates: kind === 'reference' ? recipe.referenceReplicates : recipe.mutantReplicates }
    const identity = await digest(descriptor)
    if (identities.has(identity)) return identities.get(identity)
    invariant(jobs.length < NATIVE_PREPARATION_LIMITS.jobs, 'The complete native control roster exceeds 8192 jobs; no coverage is silently truncated.')
    const id = 'native-' + identity
    jobs.push({ id, ...descriptor, source }); identities.set(identity, id); return id
  }
  for (const target of requirements.targets) {
    for (const [scope, probe] of [['selected-input', target.selectedInput], ...target.probes.map(probe => ['probe', probe])]) {
      invariant(probe, 'Native preparation cannot substitute probe input for a missing selected input.')
      const source = { targetId: target.id, scope, probeId: probe.id, wrongReadingId: null }
      const row = { targetId: target.id, taskId: target.taskId, readingId: target.readingId || null,
        requirementId: target.requirement.requirementId, scope, probeId: probe.id, referenceJobId: await add(source, 'reference'), mutants: [] }
      for (const wrong of probe.wrongReadings) {
        const gap = wrong.constructionError ? { kind: 'mutant-construction', reason: wrong.constructionError }
          : canonical(probe.reference.expected) === canonical(wrong.task.expected) ? { kind: 'indistinguishable-mutant', reason: 'The compiled observations coincide on this exact input; native execution cannot establish the required distinction by expectation alone.' } : null
        const jobId = wrong.constructionError ? null : await add({ ...source, wrongReadingId: wrong.id }, 'mutant')
        row.mutants.push({ wrongReadingId: wrong.id, jobId, gap })
        if (gap) gaps.push({ ...gap, targetId: target.id, scope, probeId: probe.id, wrongReadingId: wrong.id })
      }
      if (!row.mutants.length) gaps.push({ kind: 'no-mutants', targetId: target.id, scope, probeId: probe.id })
      coverage.push(row)
    }
  }
  for (const occurrence of requirements.selectedInput.unregistered) gaps.push({ kind: 'unregistered-composition', ...occurrence })
  const counts = { jobs: jobs.length, referenceJobs: jobs.filter(job => job.kind === 'reference').length,
    mutantJobs: jobs.filter(job => job.kind === 'mutant').length, nativeExecutions: jobs.reduce((sum, job) => sum + job.replicates, 0), coverageRows: coverage.length }
  if (counts.nativeExecutions > recipe.budgets.maxNativeExecutions) gaps.push({ kind: 'execution-budget', required: counts.nativeExecutions, available: recipe.budgets.maxNativeExecutions })
  if (recipe.budgets.maxDurationMs < recipe.budgets.attemptTimeoutMs) gaps.push({ kind: 'duration-budget', required: recipe.budgets.attemptTimeoutMs, available: recipe.budgets.maxDurationMs })
  const body = { format: 'benchmark-native-preparation-plan', version: 1, profile, recipeSha256: await digest(recipe), requirementsSha256: requirements.sha256,
    runtimeSources: spec.runtimeSources || {}, environment: spec.environment, inputBindings: spec.inputs,
    coverage, jobs, counts, budgets: recipe.budgets, gaps, apparatusRequirements: requirements.selectedInput.apparatusRequirements,
    coverageStatus: gaps.length ? 'incomplete' : 'complete', executionStatus: 'not-run',
    scope: 'Generated registered controls only. Each program runs under its own bound task and public execution contract. Future native evidence must agree with that task and separately distinguish the bound baseline observation; cross-contract baseline refusal is not detection. No controls have run. Aggregate preparation budgets, mounted-data and host provenance, independent interpreter activation/shrinking, separate apparatus controls, fresh invocation qualification and experimental admission remain unestablished. Individual auxiliary projects cannot qualify their parent.' }
  invariant(new TextEncoder().encode(canonical(body)).byteLength <= NATIVE_PREPARATION_LIMITS.planBytes, 'The complete native preparation plan exceeds 4 MiB; no coverage is silently truncated.')
  return { ...body, sha256: await digest(body) }
}
export function requirementInterpretation(task, target, result) {
  const counters = {}, transitions = {}, path = target.requirement.path
  if (task.compiled.operational) {
    const id = task.compiled.checklist.find(row => row.path === path).requirementId
    for (const row of result.snapshot.coverage) {
      const prefix = row.requirementId === id ? '' : row.requirementId === id + ':gate' ? 'gate-' : row.requirementId === id + ':reset' ? 'reset-' : null
      if (prefix !== null) for (const name of ['evaluated', 'ready', 'true', 'actions']) counters[prefix + name] = row[name]
    }
    for (const row of result.snapshot.transitions) if (row.path === path) transitions[row.kind] = (transitions[row.kind] || 0) + 1
  } else {
    for (const key of result.coverage || []) if (key.startsWith(path + ':')) transitions[key.slice(path.length + 1)] = 1
  }
  return { observation: task.compiled.operational ? result.observation : result.trace, activation: { counters, transitions }, interpretation: result }
}
