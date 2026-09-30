import { attributionHeader } from './lean-provenance.mjs'
export { PROVENANCE_VERSION, LEAN_IMAGE_DIGEST, LEAN_IMAGE_FACTS, PROVENANCE, validateProvenance, provenanceEntry, attributionHeader, provenanceDocument, attributionsMarkdown } from './lean-provenance.mjs'
import { canonical, invariant, sha256 } from './prompts.mjs'
import { interpretLean } from './lean.mjs'
import { RUNTIME_FILES } from './study.mjs'
import { leanContractId, operationalStudy, operationalProjectFiles } from './trading-study.mjs'

export async function bindLeanReview(spec, sources) {
  const copy = structuredClone(spec)
  const constitution = copy.catalog.find(bundle => bundle.id === leanContractId(spec))
  invariant(constitution, 'Lean Bench needs its semantic constitution bundle.')
  constitution.hooks = { ...constitution.hooks, sourceHashes: Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async file => {
    invariant(typeof sources[file] === 'string', `The review packet is missing ${file}.`)
    return [file, await sha256(sources[file])]
  }))) }
  return copy
}

export function leanProjectFiles(project, referenceSource, executionSource, sources) {
  if (project.spec.domain !== 'lean-bench') return {}
  if (operationalStudy(project.spec)) return operationalProjectFiles(project, sources)
  const files = { 'LEAN-REVIEW.md': '# Lean Bench review packet\n\nReview the constitution and every used catalog bundle in specification.json. The constitution binds the included compiler, runner, JavaScript interpreter and Python runtime by SHA-256. Review wording, parameters, operational rules, state, dependencies, hooks, tests and the exact source files. Editing any bound source requires another review and freeze.\n\nFor every task, compare expected-trace.json with the independently executed Python interpreter and the actual LEAN OrderEvent trace. The interpretation files included here are generated expectations, not an engine qualification receipt.\n\nA real LEAN run requires your pinned engine image and data. Generated main.py uses bar-close market orders, validates full fills at the declared close, and refuses unsupported partial fills. It records actual fills using OrderEvent; private ownership is carried in the order tag. This target is a controlled equity backtest, not a live trading system.\n' }
  function emit(task, prefix) {
    const interpreted = interpretLean(task.compiled.semantic, task.input)
    files[`${prefix}/semantic.json`] = JSON.stringify(task.compiled.semantic, null, 2) + '\n'
    files[`${prefix}/bars.json`] = JSON.stringify(task.input, null, 2) + '\n'
    files[`${prefix}/expected-trace.json`] = JSON.stringify(interpreted, null, 2) + '\n'
    files[`${prefix}/main.py`] = generateLeanProgram(task)
    if (referenceSource !== undefined) {
      invariant(typeof referenceSource === 'string', 'Generated LEAN programs need the pinned Python reference source.')
      files[`${prefix}/lean_reference.py`] = referenceSource
      invariant(typeof executionSource === 'string', 'Generated LEAN programs need their pinned execution ledger.')
      files[`${prefix}/execution_reference.py`] = executionSource
    }
  }
  for (const task of project.tasks) {
    const prefix = `lean/${task.id}`
    emit(task, prefix)
    for (const reading of task.interpretations || []) {
      emit({ ...task, compiled: reading.compiled, expected: reading.expected }, `${prefix}/readings/${reading.id}`)
    }
  }
  return files
}

export function generateLeanProgram(task) {
  // JSON string literals are decoded as data. Symbols, wording and values are
  // never interpolated as executable Python expressions.
  const jsonLiteral = JSON.stringify(canonical({ semantic: task.compiled.semantic, input: task.input }))
  // A comment block only: it states where this file came from without being
  // able to change what the program does or what the engine observes.
  return `${attributionHeader(['quantconnect-lean-python-api', 'semantic-reference-runtime'])}# Generated from the frozen semantic tree. Include lean_reference.py and execution_reference.py beside this file.
from AlgorithmImports import *
import json
from datetime import datetime, timezone
from decimal import Decimal
from lean_reference import Reference

TASK = json.loads(${jsonLiteral})

def as_cents(value):
    cents = Decimal(str(value)) * 100
    if cents != cents.to_integral_value():
        raise RuntimeError("LEAN price or cash is not an exact integer number of cents")
    return int(cents)

class FrozenBenchmark(QCAlgorithm):
    def initialize(self):
        bars = TASK["input"]["bars"]
        first = datetime.fromisoformat(bars[0]["time"].replace("Z", "+00:00")).astimezone(timezone.utc)
        last = datetime.fromisoformat(bars[-1]["time"].replace("Z", "+00:00")).astimezone(timezone.utc)
        self.set_start_date(first.year, first.month, first.day)
        self.set_end_date(last.year, last.month, last.day)
        self.set_time_zone(TimeZones.UTC)
        self.set_cash(TASK["input"]["cashCents"] / 100)
        if as_cents(self.portfolio.cash) != TASK["input"]["cashCents"]:
            raise RuntimeError("LEAN starting cash disagrees with the pinned input")
        self.reference = Reference(TASK["semantic"], TASK["input"]["cashCents"], dispatch=self.dispatch_intent)
        self.symbols = {}
        for ticker in sorted({ticker for bar in bars for ticker in bar["prices"]}):
            security = self.add_equity(ticker, Resolution.MINUTE, data_normalization_mode=DataNormalizationMode.RAW)
            security.set_fee_model(ConstantFeeModel(0))
            security.set_slippage_model(ConstantSlippageModel(0))
            self.symbols[ticker] = security.symbol
        self.bar_index = 0
        self.current = None
        self.actual = []

    def on_data(self, data):
        bars = TASK["input"]["bars"]
        if self.bar_index >= len(bars):
            return
        declared = bars[self.bar_index]
        when = datetime.fromisoformat(declared["time"].replace("Z", "+00:00")).astimezone(timezone.utc)
        now = self.utc_time.replace(tzinfo=timezone.utc)
        if now < when:
            return
        if now != when:
            raise RuntimeError("Pinned input bar was not delivered at its declared time")
        observed = {}
        for ticker, price in declared["prices"].items():
            if price is None:
                continue
            symbol = self.symbols[ticker]
            if symbol not in data.bars:
                raise RuntimeError("Pinned input price is missing: " + ticker)
            cents = as_cents(data.bars[symbol].close)
            if cents != price:
                raise RuntimeError("LEAN data disagrees with the pinned input: " + ticker)
            observed[ticker] = cents
        self.reference.step(observed, time=int(now.timestamp()))
        self.bar_index += 1

    def dispatch_intent(self, intent):
        self.current = intent
        quantity = intent["quantity"] * (1 if intent["side"] == "buy" else -1)
        ticket = self.market_order(self.symbols[intent["asset"]], quantity, tag=intent["owner"] + "|" + intent["reason"])
        if ticket.status != OrderStatus.FILLED or int(ticket.quantity_filled) != quantity:
            raise RuntimeError("This constitution requires synchronous full fills")
        self.current = None

    def on_order_event(self, event):
        if event.status == OrderStatus.PARTIALLY_FILLED:
            raise RuntimeError("Partial fills are outside this constitution")
        kind = {OrderStatus.SUBMITTED: "accepted", OrderStatus.FILLED: "fill", OrderStatus.CANCELED: "cancelled", OrderStatus.INVALID: "rejected"}.get(event.status)
        if kind is None:
            return
        intent = self.current
        if intent is None or event.symbol != self.symbols[intent["asset"]]:
            raise RuntimeError("Native receipt has no currently dispatched private intent")
        receipt = dict(id=str(event.order_id) + ":" + str(event.id), intentId=intent["id"],
                       brokerOrderId=str(event.order_id), kind=kind, time=int(event.utc_time.replace(tzinfo=timezone.utc).timestamp()))
        if kind == "fill":
            quantity = intent["quantity"] * (1 if intent["side"] == "buy" else -1)
            if event.fill_quantity != quantity or as_cents(event.fill_price) != self.reference.prices[intent["asset"]] or event.order_fee.value.amount != 0:
                raise RuntimeError("Actual LEAN fill differs from the declared quantity, close or zero fee")
            receipt.update(quantity=abs(quantity), priceCents=as_cents(event.fill_price), feeCents=0)
        self.reference.reconcile(receipt)
        if kind == "fill":
            fill = self.reference.tape[-1]
            self.actual.append(fill)
            self.log("BENCHMARK_FILL " + json.dumps(fill, sort_keys=True))

    def on_end_of_algorithm(self):
        if self.bar_index != len(TASK["input"]["bars"]):
            raise RuntimeError("LEAN did not consume every pinned input bar")
        if as_cents(self.portfolio.cash) != self.reference.cash:
            raise RuntimeError("Actual LEAN cash disagrees with the frozen decisions")
        for position in self.reference.ledger.snapshot()["positions"]:
            if self.portfolio[self.symbols[position["asset"]]].quantity != position["quantity"]:
                raise RuntimeError("Actual LEAN holdings disagree with reconciled private lots")
        self.log("BENCHMARK_TRACE " + json.dumps(self.actual, sort_keys=True))
`
}

export function inlineLeanProgram(program, sources) {
  invariant(typeof program === 'string' && typeof sources['lean-reference.py'] === 'string' && typeof sources['execution_reference.py'] === 'string', 'Inlining a LEAN program requires both pinned Python sources.')
  const reference = sources['lean-reference.py'].replace('from execution_reference import ExecutionLedger, require', () => sources['execution_reference.py'])
  return program.replace('from lean_reference import Reference', () => reference)
}
