import { PLUGIN_RUNTIME_FILES } from './runtime-inventory.mjs'
// The schema version and the exported runtime inventory that belongs to each
// one. This is a leaf module on purpose: study.mjs imports analysis.mjs,
// readiness.mjs and tasks.mjs, and all three need to ask "is this a modern
// spec?", so the answer cannot live in study.mjs without a cycle. study.mjs
// re-exports everything here, so existing import sites are unchanged.
//
// ADDING FILES TO THE EXPORTED RUNTIME IS A SCHEMA EVENT. runner.mjs refuses to
// run a study that did not pin the complete runtime for its version, which is
// the property that makes an exported project reproducible: it may not run
// against modules it never pinned. So a new compiler module does not go on the
// end of the current list -- it starts a new version, and every previously
// frozen study keeps running against the inventory it was frozen with.
//
//   schema 1  LEGACY_RUNTIME_FILES  43 files
//   schema 2  V2_RUNTIME_FILES      45  + readiness.mjs, requirement-fields.mjs
//   schema 3  V3_RUNTIME_FILES      50  + the benchmark registration seam
//   schema 4  RUNTIME_FILES         configured core and optional plugins
export const STUDY_VERSION = 4
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2, 3, STUDY_VERSION])

// Schema 2 and later carry an executionPlan, a readiness contract, a recorded
// generator and a pinned runtime inventory. Everything that used to be written
// as `schemaVersion === 2` means this, not "exactly 2", and saying so keeps the
// next schema from silently losing those behaviours.
export function modernSchema(value) {
  const spec = value?.spec || value
  return typeof spec?.schemaVersion === 'number' && spec.schemaVersion >= 2
}

export const LEGACY_RUNTIME_FILES = ['cli.mjs', 'prompts.mjs', 'study.mjs', 'runner.mjs', 'module-host.mjs', 'lean.mjs', 'lean-codegen.mjs', 'lean-reference.py', 'starters.mjs', 'qualify.mjs', 'lean-grade.mjs', 'lean-data.py', 'lean-cases.mjs', 'analysis.mjs', 'report.mjs', 'corpus.mjs', 'information.mjs', 'tasks.mjs', 'conventions.mjs', 'audit.mjs', 'lean-observations.mjs', 'observations.mjs', 'execution.mjs', 'execution_reference.py', 'execution-lean.mjs', 'execution_lean.py', 'composition.mjs', 'trading-ir.mjs', 'trading-runtime.mjs', 'trading_reference.py', 'trading-lean.mjs', 'trading_lean.py', 'trading-observations.mjs', 'trading-market.mjs', 'trading_market.py', 'trading_broker.py', 'trading-study.mjs', 'trading-catalog.mjs', 'requirements.mjs', 'shrinking.mjs', 'workflow.mjs', 'templates.mjs', 'resource-effects.mjs']
export const V2_RUNTIME_FILES = [...LEGACY_RUNTIME_FILES, 'readiness.mjs', 'requirement-fields.mjs']
export const V3_RUNTIME_FILES = [...V2_RUNTIME_FILES, 'study-schema.mjs', 'extraction.mjs', 'registry.mjs', 'plugins.mjs', 'lean-plugin.mjs']

// Schema 4 composes a domain-independent core with the configured plugin files.
// Schemas 1–3 above are immutable historical inventories.
export const CORE_RUNTIME_FILES = Object.freeze(["cli.mjs", "prompts.mjs", "study.mjs", "runner.mjs", "module-host.mjs", "starters.mjs", "qualify.mjs", "analysis.mjs", "report.mjs", "corpus.mjs", "information.mjs", "tasks.mjs", "conventions.mjs", "audit.mjs", "observations.mjs", "composition.mjs", "requirements.mjs", "shrinking.mjs", "workflow.mjs", "templates.mjs", "resource-effects.mjs", "readiness.mjs", "requirement-fields.mjs", "study-schema.mjs", "extraction.mjs", "registry.mjs", "plugins.mjs", "runtime-inventory.mjs", "provenance.mjs"])
export const RUNTIME_FILES = Object.freeze([...CORE_RUNTIME_FILES, ...PLUGIN_RUNTIME_FILES])

// The exported runtime a given schema version ships. A study runs against the
// inventory it was frozen with; it never inherits a later one.
export function runtimeFilesForVersion(version) {
  return version >= 4 ? RUNTIME_FILES : version === 3 ? V3_RUNTIME_FILES : version === 2 ? V2_RUNTIME_FILES : LEGACY_RUNTIME_FILES
}
