// The authoring contract owned by Lean Bench. All functions are called lazily
// through the registry after module initialization has completed.
import { invariant } from './prompts.mjs'

const counter = (name, label) => ({ kind: 'counter', name, label })
const transition = (name, label) => ({ kind: 'transition', name, label })
const profiles = Object.freeze(['synchronous-v1', 'operational-v1'])

export function leanActivationChoices(spec, compiled, node) {
  if (!compiled.operational) {
    const names = { strategy: ['buy', 'sell'], sequence: ['advance'], race: ['winner'], state_gate: ['open'], event_gate: ['open'], reset: ['reset'] }[node.semantic.kind] || []
    return names.map(name => transition(name, name.replaceAll('-', ' ')))
  }
  if (['buy_reason', 'sell_reason'].includes(node.role)) return [counter('true', 'Predicate became true'), counter('ready', 'Predicate had its required observations'), counter('evaluated', 'Predicate was evaluated')]
  if (['buy_process', 'sell_process'].includes(node.role)) return [counter('actions', 'Process proposed an action')]
  const choices = [transition('roundtrip-completed', 'Scope completed an actual round trip')]
  if (node.semantic.kind === 'strategy') choices.push(transition('intent-admitted', 'Order intention was admitted'), transition('intent-skipped', 'Order intention was skipped'))
  else if (node.semantic.kind === 'template') {
    if (node.semantic.operator === 'sequence') choices.push(transition('sequence-advanced', 'Sequence advanced to its next child'))
    if (node.semantic.operator === 'race') choices.push(transition('race-acquired', 'Race acquired an owner'), transition('race-released', 'Race released its owner'))
    if (node.semantic.gate?.kind && node.semantic.gate.kind !== 'none') {
      for (const name of ['evaluated', 'ready', 'true']) choices.push(counter('gate-' + name, 'Gate predicate ' + name))
      choices.push(transition('gate-opened', 'Gate opened'))
      if (node.semantic.gate.kind === 'state') choices.push(transition('gate-closed', 'State gate closed'))
      if (node.semantic.gate.kind === 'event' && node.semantic.gate.ttlBars !== null) choices.push(transition('gate-expired', 'Event gate lifetime expired'))
    }
    if (node.semantic.reset) for (const name of ['evaluated', 'ready', 'true']) choices.push(counter('reset-' + name, 'Reset predicate ' + name))
  } else return []
  choices.push(transition('subtree-draining', 'Scope began draining'), transition('subtree-cleared', 'Scope was cleared after draining'))
  return choices
}

export const leanAuthoring = Object.freeze({
  specFields: Object.freeze(['leanProfile']),
  profiles,
  validateSpec(spec) {
    invariant(spec.leanProfile === undefined || profiles.includes(spec.leanProfile), 'Choose an explicit supported Lean profile; existing studies keep their synchronous constitution.')
    invariant(spec.requireReview === true, 'Lean Bench requires current personal bundle reviews before freezing. Draft previews remain available without approval.')
  },
  bindingFields: spec => ({ leanProfile: spec.leanProfile || null }),
  expectedPolicy: Object.freeze({ kind: 'derive-lean', validationMessage: 'Derive LEAN apparatus expectations through the existing domain compiler.' }),
  activationChoices: leanActivationChoices,
  suppliedInterpreters: true,
})
