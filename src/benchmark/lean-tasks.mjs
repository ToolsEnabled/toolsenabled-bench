// Lean task semantics and prompt appendices. Registered through lean-plugin.mjs;
// the shared task compiler does not import this domain implementation.
import { canonical, compilePrompt, invariant } from './prompts.mjs'
import { modernSchema } from './study-schema.mjs'
import { interpretLean, validateLean } from './lean.mjs'
import { lowerTradingIR } from './trading-ir.mjs'
import { validateTradingMarket, simulateTradingMarket } from './trading-market.mjs'
import { operationalStudy, operationalPromptContract, operationalBrokerChronology, leanContractId } from './trading-study.mjs'
import { tradingObservationContract } from './trading-observations.mjs'

export async function deriveLeanTaskExpected(spec, task) {
  const compiled = await compilePrompt(spec.catalog, task.root, { variables: task.variables || {} })
  return operationalStudy(spec) ? simulateTradingMarket(await lowerTradingIR(compiled.composition, task.input?.execution), task.input).observation
    : interpretLean(compiled.semantic, task.input).trace
}

export function normalizeLeanGrading(spec, grading) {
  grading.executionTimeoutMs ??= Math.min(60000, spec.protocol.timeoutMs - 1000)
  return grading
}

function semanticAnswerContract(task, { operational = false } = {}) {
  const output = task.information?.responseMode === 'tagged-json' ? 'Place the complete JSON observation in the answer field of the response envelope specified below.' : 'Return only the complete JSON observation value, without a code fence or explanatory text.'
  return '\n\nSemantic answer contract (part of this exact prompt):\n' + output
    + ' Compute the deterministic observation under the frozen semantic rules and supplied inputs. This task evaluates a semantic answer; it does not execute a submitted program or establish a native engine result. Preserve array ordering and every required field. Use integer cents for money and the exact ownership paths from the prompt. Do not infer liquidation at the end of the input.\n'
    + (operational ? 'Return an object with format="lean-operational-observation", version=1, orders, events, lots, cashFromFillsCents, positionsFromFills, feesCents and equityCents. Orders are in creation order and contain order (1-based), owner, lot (1-based within owner), asset, time (UTC Unix seconds), quantity (signed), reason, status, filledQuantity (absolute), feesCents, unfilledQuantity and pending. Events are in observation order and contain order, time, status, quantity (signed), priceCents and feeCents; non-fill events have zero quantity, price and fee. Lots are in first-entry order and contain owner, lot, asset, boughtQuantity, soldQuantity, quantity (remaining), firstFillTime and lastFillTime (null before any fill). positionsFromFills follows the declared asset order and contains {asset,quantity}; equityCents contains {start,end}. Order and lot identifiers normalize creation/first-entry order from 1. Reasons are entry, exit, reset, gate-close or race-release. Status strings are new, accepted, partial, filled, cancelled, rejected, cancel-pending or none; use the actual state reached under the frozen rules. Reasons, status transitions, delayed capped fills, cancellation settlement and private lot ownership follow the operational constitution and frozen market rules. '
      : 'Return the ordered JSON fill array. Each entry contains exactly bar (zero-based completed-input index), path (exact strategy ownership path), symbol, signed quantity, priceCents and reason (buy, sell or reset), in the declared interpreter event order. An empty trace is []. ')
}
export async function prepareLeanTask(spec, task, compiled, { expected = task.expected, generatedExpected = false, validateExpected = true, appendContract: append } = {}) {
  const appendContract = (compiled, text, spec, id) => append(text, id, spec.schemaVersion >= 4 ? 'lean-tasks.mjs' : 'tasks.mjs')
  if (operationalStudy(spec)) {
    invariant(compiled.bundles.some(bundle => bundle.id === leanContractId(spec)), `${task.id}: bind the operational contract as a reviewed bundle dependency.`)
    const ir = await lowerTradingIR(compiled.composition, task.input?.execution)
    validateTradingMarket(ir, task.input)
    if (modernSchema(spec) && spec.protocol.grading.kind === 'json') {
      const constitution = spec.catalog.find(bundle => bundle.id === leanContractId(spec))
      invariant(constitution?.kind === 'atom' && constitution.role === 'contract' && typeof constitution.text === 'string' && !constitution.text.includes('{{'), 'Operational studies need the explicit literal operational-contract-v1 review bundle.')
      appendContract(compiled, semanticAnswerContract(task, { operational: true })
        + '\nOperational constitution: ' + constitution.text
        + '\nPublic broker chronology: ' + operationalBrokerChronology
        + '\nExecution and lifecycle policy: ' + canonical(task.input.execution)
        + '\nPublic observation and market inputs: ' + canonical(tradingObservationContract(ir, task.input)), spec, 'operational-semantic-answer-contract')
    } else {
      const outputInstruction = task.information?.responseMode === 'tagged-json' ? 'Place the Python source in the answer field of the response envelope specified below.' : 'Return only Python source or one fenced python block.'
      appendContract(compiled, operationalPromptContract(spec, ir, task.input, outputInstruction), spec, 'operational-execution-contract')
    }
  } else {
    invariant(compiled.semantic.kind === 'constitution', `${task.id}: wrap the strategy in the reviewed semantic constitution.`)
    validateLean(compiled.semantic, task.input)
    const interpreted = interpretLean(compiled.semantic, task.input)
    if (generatedExpected && !Object.hasOwn(task, 'expected')) expected = interpreted.trace
    invariant(!validateExpected || canonical(interpreted.trace) === canonical(expected), `${task.id}: the expected trace disagrees with the semantic interpretation. Inspect both before freezing.`)
    const leaves = [], pending = [compiled.semantic]
    while (pending.length) { const node = pending.pop(); if (node.kind === 'strategy') leaves.push({ path: node.path, symbol: node.symbol }); else pending.push(...node.childOrder.map(key => node.children[key]).reverse()) }
    if (modernSchema(spec) && spec.protocol.grading.kind === 'json') appendContract(compiled, semanticAnswerContract(task)
      + '\nStrategy paths: ' + canonical(leaves) + '\nFrozen completed-bar inputs (integer cents): ' + canonical(task.input), spec, 'semantic-answer-contract')
    else {
      const outputInstruction = task.information?.responseMode === 'tagged-json' ? 'Place the Python source in the answer field of the response envelope specified below.' : 'Return only Python source or one fenced python block.'
      appendContract(compiled, '\n\nExecution appendix (part of this exact prompt):\nImplement class FrozenBenchmark(QCAlgorithm). ' + outputInstruction + ' Configure UTC time, the declared dates, cash and RAW minute equity subscriptions; zero fees and slippage. Native order tags must be the exact strategy path followed by |buy, |sell or |reset. Actual filled order events, quantities, times, prices and tags are graded; printed trace claims are ignored. Do not liquidate at end of data.\nStrategy paths: ' + canonical(leaves) + '\nFrozen completed-bar inputs (integer cents): ' + canonical(task.input), spec, 'execution-contract')
    }
  }
  return expected
}

export async function finalizeLeanTask(spec, task, compiled, { expected = task.expected, generatedExpected = false, validateExpected = true } = {}) {
  if (operationalStudy(spec)) {
    compiled.operational = await lowerTradingIR(compiled.composition, task.input.execution)
    const interpreted = simulateTradingMarket(compiled.operational, task.input).observation
    if (generatedExpected && !Object.hasOwn(task, 'expected')) expected = interpreted
    invariant(!validateExpected || canonical(interpreted) === canonical(expected), `${task.id}: the expected operational observation disagrees with the semantic interpretation. Inspect both before freezing.`)
  }
  return expected
}

export const leanTaskSemantics = Object.freeze({
  deriveExpected: deriveLeanTaskExpected,
  prepare: prepareLeanTask,
  finalize: finalizeLeanTask,
})
