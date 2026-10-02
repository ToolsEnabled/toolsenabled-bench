// Structural checks shared by saved-project loading and MCP draft writes.
// These drafts may be incomplete authoring work. Do not apply their semantic
// validation or normalize away text; only check containers the editors consume.
export class RetainedEditorError extends Error {}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const requireShape = (condition, path, kind) => { if (!condition) throw new RetainedEditorError(`${path} must be ${kind}.`) }
const object = (value, path) => requireShape(record(value), path, 'an object')
const array = (value, path, item) => {
  requireShape(Array.isArray(value), path, 'an array')
  if (item) value.forEach((entry, index) => item(entry, `${path}[${index}]`))
}
const text = (value, path) => requireShape(typeof value === 'string', path, 'text')
const optional = (value, path, fields) => {
  object(value, path)
  for (const [key, check] of Object.entries(fields)) if (Object.hasOwn(value, key)) check(value[key], `${path}.${key}`)
}
const strings = (value, path) => array(value, path, text)
const objects = (value, path) => array(value, path, object)
const review = (value, path) => { if (value !== null) optional(value, path, { rows: objects }) }
const member = (value, path) => optional(value, path, { selected: strings })
const members = (value, path) => array(value, path, member)
const parts = (value, path) => array(value, path, (part, where) => optional(part, where, { snippets: strings }))
const study = (value, path) => optional(value, path, { source: object, marks: objects })
const checks = {
  'composition-generation-draft': (value, path) => optional(value, path, {
    form: (value, path) => optional(value, path, { parts, compatibility: (value, path) => optional(value, path, { groups: parts }) }),
    handcrafted: (value, path) => array(value, path, (row, where) => optional(row, where, { picks: object })), review,
  }),
  'nesting-draft': (value, path) => optional(value, path, { form: (value, path) => optional(value, path, { members }), review }),
  'variance-draft': (value, path) => optional(value, path, {
    studies: (value, path) => array(value, path, study),
    run: (value, path) => optional(value, path, { members, snippets: members, parts: strings, marks: objects }), review,
  }),
  'prompt-set-draft': (value, path) => optional(value, path, { sets: strings, studies: strings, dimensions: strings, weights: object }),
  'pipeline-draft': (value, path) => optional(value, path, {
    rows: objects, judges: objects, verdicts: object, models: objects, record: object,
    tools: (value, path) => optional(value, path, { servers: objects, profiles: objects }),
  }),
  'checks-draft': (value, path) => optional(value, path, { checks: objects, fixtures: objects }),
}
export function validateRetainedEditors(editors, path = 'draft.editors') {
  if (editors === undefined) return
  object(editors, path)
  // Advanced routing is user-authored text, including temporarily invalid JSON.
  // Preserve it through saves/MCP edits; the routing view explains how to repair it.
  if (editors['data-bench-routing'] !== undefined) text(editors['data-bench-routing'], `${path}.data-bench-routing`)
  for (const [name, check] of Object.entries(checks)) {
    const key = 'data-bench-' + name, raw = editors[key], where = `${path}.${key}`
    if (raw === undefined || raw === '') continue
    text(raw, where)
    let value
    try { value = JSON.parse(raw) }
    catch {
      // These fields are hidden structured state published by editors.
      throw new RetainedEditorError(`${where} must contain valid JSON.`)
    }
    check(value, where)
  }
}
export function validateRetainedDraft(draft, path = 'draft') {
  object(draft, path)
  validateRetainedEditors(draft.editors, `${path}.editors`)
  if (draft.undo !== undefined) {
    object(draft.undo, `${path}.undo`)
    validateRetainedEditors(draft.undo.editors, `${path}.undo.editors`)
  }
}
