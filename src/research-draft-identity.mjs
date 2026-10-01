import { canonical } from './benchmark/prompts.mjs'
import { emptyCompositionGeneration } from './research-composition-generator.mjs'
import { emptyNestingForm } from './research-nesting.mjs'
import { emptyVarianceState, emptyVarianceRun } from './research-variance.mjs'
import { emptyPromptSetState } from './research-prompt-set.mjs'
import { emptyPipelineDraft } from './research-pipeline.mjs'
import { emptyChecksDraft } from './research-checks.mjs'

const pick = (value, names) => Object.fromEntries(names.filter(name => Object.hasOwn(value, name)).map(name => [name, value[name]]))
const fields = (value, defaults, names = Object.keys(defaults)) => pick({ ...defaults, ...value }, names)
const review = value => value ? { fingerprint: value.fingerprint, rows: (value.rows || []).map(row => pick(row, ['index', 'name', 'keep'])) } : null
// An explicit persistence schema: these fields describe unfinished authored
// content. Selected items, navigation trails, display modes, search, paging and
// other UI state do not become save dependencies when an editor publishes them.
const RETAINED = {
  routing: value => pick(value, ['version', 'fields', 'compositions', 'decisions', 'rules', 'otherwise', 'rows']),
  'composition-generation-draft': value => ({
    form: fields(value.form, { ...emptyCompositionGeneration().form, set: '' }),
    handcrafted: (value.handcrafted || []).map(row => pick(row, ['name', 'picks', 'include', 'keep'])), review: review(value.review),
  }),
  'nesting-draft': value => ({ form: fields(value.form, emptyNestingForm()), review: review(value.review) }),
  'variance-draft': value => ({
    studies: (value.studies || emptyVarianceState().studies).map(row => pick(row, ['id', 'name', 'source', 'mode', 'includeControl', 'marks', 'target'])),
    run: fields(value.run, emptyVarianceRun()), review: review(value.review),
  }),
  'prompt-set-draft': value => fields(value, emptyPromptSetState()),
  'pipeline-draft': value => fields(value, emptyPipelineDraft()),
  'checks-draft': value => fields(value, emptyChecksDraft()),
}
function retainedIdentity(raw, project) {
  if (raw === undefined || raw === '') return project({})
  try {
    const value = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value)) return project(value)
  } catch { /* Retain unfinished JSON text exactly; it is authored content. */ }
  return { raw }
}
export function persistedDraftIdentity(value, editorGroups) {
  const pending = Object.keys(editorGroups).filter(group => value.pending?.includes(group)).sort()
  const editors = {}
  // Grouped controls are mirrors until their Apply group has pending edits.
  for (const group of pending) for (const name of editorGroups[group]) {
    const key = `data-bench-${name}`
    if (Object.hasOwn(value.editors || {}, key)) editors[key] = value.editors[key]
  }
  for (const [name, project] of Object.entries(RETAINED)) {
    const key = `data-bench-${name}`
    editors[key] = retainedIdentity(value.editors?.[key], project)
  }
  return canonical({ spec: value.spec, attachments: value.attachments || {}, pending, editors,
    ...(value.undo ? { undo: persistedDraftIdentity(value.undo, editorGroups) } : {}) })
}
