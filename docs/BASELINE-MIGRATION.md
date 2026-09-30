# Baseline changes and export compatibility

## Current recorded identities

ToolsEnabled Bench is the public product name. Newly frozen studies retain the software identity **ToolsEnabled BenchMark Builder 0.2.0**, research template **2.2.0** and study schema **4**. The investigator's study version and authorship are separate fields.

Schema 4 pins the core plus configured runtime plugins. Source extraction and these identity changes affect runtime hashes, newly frozen project hashes, source-bound reviews, citations and report metadata. They do not authorize changing the meaning of an earlier frozen study.

## Preserve original 0.1.0 exports

An original export contains its own runtime, generator identity, template citations, attachments and evidence. Keep that package intact. Do not replace its runtime files with the current CLI or regenerate an earlier identity from a newly frozen draft. Inspect received packages with an already trusted installation and `--project`; launching the received CLI executes its code before verification. Original-byte regeneration requires a separately trusted matching runtime.

The source regression suite preserves the original authored arithmetic recorded-control export from 0.1.0 in `test/fixtures/standalone-0.1.0.json.gz`, with an adjacent receipt identifying its project hash, archive hash, generator and source commit. Compatibility checks cover original hashes and citations, current read-only inspection and re-exported metadata. The checks extract and use the original pinned CLI to verify, regenerate reports and resume without recollection, comparing the retained journal, summary, reports and citations.

Schemas 1–3 retain their historical runtime inventories. The current application may inspect an archive without being able to rebuild its runtime exactly; applicable read-only limits preserve that distinction. Explicitly make a new draft to revise an old study. Its next freeze records the current generator and a new identity, while the original export remains the earlier record.

## Changes from the initial standalone tree

The initial standalone tree generated studies as Builder 0.1.0 with template 2.1.0. New 0.2.0 generic project shapes change schema 3 to 4 and generator 0.1.0 to 0.2.0. Optional Lean task appendices also identify their extracted `lean-tasks.mjs` source. Associated source-bound readiness hashes change with those identities.

Baseline review distinguished those intentional changes from the prompt, expected-answer, condition, readiness-policy and analysis behavior being tested. Historical report wording was corrected to describe **protocol binding by freeze**: a content hash identifies the frozen plan but does not prove prospective registration with an independent custodian.

Updating expected hashes alone does not establish correctness. Retain behavioral checks of the affected contracts and do not weaken qualification, admission, population definitions or failure classifications to obtain a passing snapshot.

## Public control-fixture provenance

The public runnable examples and retained-response regression fixtures use authored recorded controls, including the preserved original 0.1.0 arithmetic export. Authoring libraries provide prompt snippets and reference code, not empirical model results. Historical live CLI/model run outputs and their derived performance figures are excluded from the public source and runtime packages. The original 0.1.0 compatibility fixture retains its exact runtime comments and hashes as historical bytes; it is included only in the source test package and is excluded from the runtime ZIP. Those comments do not confer current execution authority.

## Public source and payload changes

Private owner coordination and research documents are excluded from public source and runtime packages, including optional Lean metadata. Public documentation and notice text describe the standalone product while preserving copyright, AI-assistance disclosure, retained license bodies and source attribution for included reference material and authored controls.

Source or payload changes move archive hashes and can change source-pinned study identities. Qualification must use the final source snapshot rather than reusing an earlier archive's receipt. The matching external `SOURCE-MANIFEST.json`, `VERIFICATION.json` and `SHA256SUMS` record final source and artifact identities. Original frozen studies retain their own bytes and citations. See [Review and artifact identity](REVIEW.md).
