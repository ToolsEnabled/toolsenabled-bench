// Node-only qualification apparatus owned by the reference plugin. Browser
// registration names this module as metadata and never imports it.
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { canonical, compilePrompt, invariant } from './prompts.mjs'
import { interpretLean, leanCatalog, validateLean } from './lean.mjs'
import { qualificationFixtures } from './lean-cases.mjs'
import { operationalStudy } from './trading-study.mjs'
import { simulateTradingMarket, validateTradingMarket } from './trading-market.mjs'
import { requirementInterpretation } from './lean-requirements.mjs'

function pythonReference(root, task, python, signal) {
  return new Promise((done, reject) => {
    signal.throwIfAborted()
    // Qualification reads the frozen apparatus; imported Python modules must
    // not leave bytecode writes beside those measured source files.
    const child = spawn(python, ['-B', resolve(root, task.compiled.operational ? 'trading_market.py' : 'lean-reference.py')], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = [], stderr = []; let size = 0, failure
    const stop = () => { failure ||= signal.reason || new Error('Qualification cancelled.'); child.kill('SIGKILL') }
    signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
    const timer = setTimeout(() => { failure = new Error('Independent interpreter exceeded its 60-second budget.'); stop() }, 60000)
    const capture = target => bytes => { size += bytes.length; if (size > 32 * 1024 * 1024) { failure = new Error('Independent interpreter output exceeds 32 MiB.'); stop() } else target.push(bytes) }
    child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr))
    child.on('error', error => { failure = error }); child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error })
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', stop)
      const raw = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code }
      if (failure || code !== 0) { const error = failure || new Error('Independent interpreter failed.'); error.evidence = raw; reject(error); return }
      try { done({ result: JSON.parse(raw.stdout), process: raw }) } catch (error) { error.evidence = raw; reject(error) }
    })
    child.stdin.end(canonical(task.compiled.operational ? { ir: task.compiled.operational, input: task.input } : { semantic: task.compiled.semantic, input: task.input }) + '\n')
  })
}


export function qualificationHooks(root, project, { python, signal }) {
  const scope = 'Local compiler/interpreter and declared-answer checks. This record does not execute a model or the LEAN engine, approve bundles, or certify a counted study.'
  // Older generic projects used this plugin's fallback extraction/attribution
  // contract; their qualification still uses the core's generic checks.
  if (project.spec.domain !== 'lean-bench') return { scope }
  return {
    scope,
    controls: async append => {
      if (!operationalStudy(project.spec)) for (const fixture of qualificationFixtures()) {
    const catalog = leanCatalog()
    if (fixture.reverseOrder) catalog.find(bundle => bundle.id === 'race').slotOrder = ['second', 'first']
    const compiled = await compilePrompt(catalog, fixture.root), task = { ...fixture, compiled }
    const javascript = interpretLean(compiled.semantic, fixture.input), independent = await pythonReference(root, task, python, signal)
    invariant(canonical(javascript) === canonical(independent.result), `${fixture.id}: qualification interpreters disagree.`)
    if (fixture.handTrace) invariant(canonical(javascript.trace) === canonical(fixture.handTrace), `${fixture.id}: the hand-authored trace does not match.`)
    for (const [field, key] of [['bars', 'bar'], ['quantities', 'quantity'], ['reasons', 'reason']]) if (fixture[field]) invariant(canonical(javascript.trace.map(fill => fill[key])) === canonical(fixture[field]), `${fixture.id}: the hand-authored ${field} do not match.`)
    if (fixture.id === 'depth-seven') invariant(javascript.trace.some(fill => fill.path.split('/').length >= 9), 'The deep mixed-tree control did not activate its deepest branch.')
    if (fixture.id === 'race-nested-owner') invariant(javascript.trace.every(fill => fill.path.includes('/strategy/first/')), 'Nested race ownership control failed.')
    if (fixture.id === 'reverse-race-order') invariant(javascript.trace.every(fill => fill.path.includes('/strategy/second/')), 'Declared sibling-order control failed.')
    append({ fixtureId: fixture.id, passed: true, kind: 'apparatus-control', javascript, python: independent })
  }
    },
    qualifyVariant: async (task, variant) => {
      const identity = { taskId: task.id, ...(variant.id ? { readingId: variant.id } : {}) }
        const evaluated = { ...task, compiled: variant.compiled, expected: variant.expected }
        const javascript = evaluated.compiled.operational ? simulateTradingMarket(evaluated.compiled.operational, task.input) : interpretLean(evaluated.compiled.semantic, task.input)
        const independent = await pythonReference(root, evaluated, python, signal)
        invariant(canonical(javascript) === canonical(independent.result), `${task.id}/${variant.id || 'baseline'}: the independent interpreters disagree.`)
        invariant(canonical(variant.expected) === canonical(evaluated.compiled.operational ? independent.result.observation : independent.result.trace), `${task.id}/${variant.id || 'baseline'}: the declared expected observation disagrees with independent execution.`)
        return { ...identity, passed: true, kind: 'independent-interpretation', expected: variant.expected, javascript, python: independent }
    },
    requirements: {
      signal,
    validInput: (task, input) => { try { task.compiled.operational ? validateTradingMarket(task.compiled.operational, input) : validateLean(task.compiled.semantic, input); return true } catch { return false } },
    interpret: async (task, target) => requirementInterpretation(task, target, task.compiled.operational ? simulateTradingMarket(task.compiled.operational, task.input) : interpretLean(task.compiled.semantic, task.input)),
    independent: async (task, target) => requirementInterpretation(task, target, (await pythonReference(root, task, python, signal)).result),
    },
  }
}
