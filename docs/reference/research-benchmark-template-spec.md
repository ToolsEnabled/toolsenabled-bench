# Research Benchmark Template 2.2.0 — identity and portable-study contract

This document describes the template shipped by ToolsEnabled Bench 0.2.0 beta. The recorded generator remains **ToolsEnabled BenchMark Builder 0.2.0**. The pinned source validators are the authority for complete field definitions and limits; historical studies keep their original runtime and citation identities. Release sidecars identify the exact source snapshot and its qualification results.

## Identity and versioning

| Item | Current value | Source |
|---|---|---|
| Template identifier | `research-benchmark-template` | `TEMPLATE.id` in `src/benchmark/study.mjs` |
| Template title | ToolsEnabled BenchMark Builder Research Template | `TEMPLATE.title` |
| Template version | `2.2.0` | `TEMPLATE.version` |
| New study schema | `4` | `STUDY_VERSION` in `src/benchmark/study-schema.mjs` |
| Recorded generator | ToolsEnabled BenchMark Builder `0.2.0` | `GENERATOR` and `TEMPLATE.generator` |
| License | MIT | `TEMPLATE.license` and root `LICENSE` |
| Template author | Joshua Pinckard | `TEMPLATE.author` |

Application release, template version, study schema and investigator study version identify different things. Template major version and schema number are not required to match. Original 0.1.0 studies retain generator 0.1.0 and template 2.1.0; inherited studies retain their original citation mapping and pinned runtime.

`templateIdentity(project)` hashes canonical JSON containing the template identifier/version, study schema, ordered runtime inventory and corresponding source hashes. The hash names that retained runtime; it is not an attestation of who ran it or when a protocol was registered.

## Runtime and plugin inventory

Schema 4 freezes the generic core together with configured runtime plugins. `runtimeFilesFor(project)` derives the inventory from the archived source pins while retaining mandatory core files. It does not substitute the current installation's optional plugin inventory when inspecting an older archive. Schemas 1–3 retain their fixed historical inventories.

`plugins.json` declares bundled extensions and runtime plugin descriptors. Extensions and their local dependencies become a pinned `plugins.mjs` package. An exported study's `plugins/manifest.json` records required plugin identities, package/source hashes and runtime pins. Verification reconstructs this information and refuses absent or changed required packages. A plugin registered only in the authoring process is insufficient for export.

Generic core modules select domain capabilities through descriptors. Optional Lean behavior belongs to its plugin. Registration, plugin source integrity and native apparatus qualification are separate concerns; plugin code is trusted build-time code, not a sandbox for arbitrary extensions. See [Plugins](../PLUGINS.md).

## Study specification and composition

A study declares its identifier, domain, prompt catalog, tasks, collection conditions, protocol, execution purpose and external inputs. Optional plans describe analysis, design, workflows, task generation, information treatments, audits, observations, requirements and apparatus preparation. Validation and module-specific contracts are implemented by `study.mjs` and its imported plan validators.

Catalog atoms and templates carry stable identifiers, versions, roles, wording and parameters. Templates declare typed slots; a slot can contain a compatible atom or another template recursively. Task compilation retains rendered text, composition structure, source maps and source identities. Declared dependencies must satisfy the compiler's contracts. Review records identify the exact content acknowledged and do not authenticate a person's identity or supply investigator approval.

Controlled generation records its choices, seeds, selected tasks and exclusions. These records make construction inspectable; they do not establish population representativeness, natural-language equivalence or a valid research design.

## Freeze and execution purpose

`freezeStudy` validates the specification, compiles tasks, resolves the analysis population, constructs the schedule and readiness contract, and hashes the resulting canonical project. Required source pins bind the runtime used for those transformations.

Execution purposes remain distinct:

- **Recorded diagnostic:** checks retained responses and declared scoring rules.
- **Apparatus development:** exercises an instrument within its stated development limits.
- **Experiment:** requires its supported execution contract and purpose-specific controls before admitted collection.

`node cli.mjs qualify` records the checks required by the study's supported profile. Passing listed controls does not establish correctness outside those controls, independent semantic validation or scientific approval. Native and command/module collection retain their declared admission limits. See [Methods](../METHODS.md).

## Protocol binding, not prospective registration

The frozen project includes its protocol and analysis plan. Changing that content changes the project identity. Retained attempts bind to that identity, allowing analysis to be checked against the recorded plan.

A content hash alone does **not** prove that the plan existed before outcomes were observed, was lodged with an independent custodian or was prospectively registered. Any external registration claim requires its own evidence. This distinction applies even when a historical document used the phrase “pre-registration by freeze.”

## Collection, retained attempts and analysis

The frozen schedule records trial identities, conditions and replicates. The runner retains starts, terminal outcomes, failures and evidence under its journal and retry contracts. Missing responses, unavailable usage and interrupted attempts must remain distinguishable from measured outcomes. Resume preserves retained responses and ordinary lock rules.

Analysis uses the frozen population, denominator, contrasts, uncertainty procedure and other declared plans. Task families, variants and repeated trials can be dependent; an interval calculation does not correct an unsuitable sampling design. Reports distinguish requested collection settings from retained adapter metadata. Metadata does not authenticate a provider, session isolation or training-data provenance.

## Export, verification and reports

`projectFiles` carries the frozen project, runtime, required plugins, manifest, prompts, protocol, schedule, source maps, attachments and applicable generated plan artifacts. Preserve the complete original export. Launching a received `cli.mjs` executes its JavaScript and plugin imports before verification, and self-contained hashes do not authenticate that code. Inspect with an already trusted installation: `node /path/to/bench/src/benchmark/cli.mjs verify --project /path/to/study`. Matching installed runtime pins permit project/plugin reconstruction; foreign runtimes receive digest and retained-evidence inspection.

The same trusted CLI's `status`, `analyze` and `reference` commands do not execute study collectors, custom graders or archived runtime modules. `analyze` regenerates analysis and HTML/Markdown reports from retained evidence. Custom scores are labelled as not re-executed, with their frozen grader provenance. Explicit `regrade` requires a matching installed runtime, uses the verified installed module host and writes a separate successful-comparison receipt without rewriting the journal. Execution uses the current user's filesystem/network authority; it is not an OS sandbox. Deterministic reproduction concerns those fixed inputs and transformations; a fresh stochastic model response need not match an earlier one. Hash integrity does not establish that submitted evidence is truthful or independently produced.

## Citation and attribution

Exports and report packages carry `CITATION.cff` and `CITATION.bib`, generated from the frozen study and its template identity. Study authorship comes from the investigator's declared citation fields; template authorship does not make the template author the author of every generated study.

`provenance.json` and `ATTRIBUTIONS.md` preserve reused/adapted code attribution separately from API use, newly generated material and methodological references. Preserve original copyright and third-party notices. The implementation's references and source identities are recorded in the runtime rather than independently re-verified by this documentation update.

Joshua Pinckard conceived the project, defined its objectives and requirements, directed the autonomous agent workflows, selected and evaluated outputs, and assumes responsibility for the research methodology and conclusions. AI agents generated substantial portions of the implementation and written drafts. See the repository's `ATTRIBUTION.md` and `LICENSE`.

## Compatibility and evidence limits

Inspecting an old archive preserves its generator, runtime and citation identity. Revising it requires a new draft and freeze; retain the original record. See [Compatibility](../BASELINE-MIGRATION.md).

Public runnable examples and retained-response regression fixtures use authored recorded controls, including the original 0.1.0 arithmetic compatibility export. Authoring libraries supply prompt snippets and reference code. Historical live CLI/model run outputs and derived performance figures are excluded from the public packages. Replaying authored controls supplies software regression evidence, not model-performance results. This template does not establish a completed LEAN benchmark, validated tool-use or multi-agent measurements, independent scientific validity or peer review.
