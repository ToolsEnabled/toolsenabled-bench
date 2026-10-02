---
name: toolsenabled-bench
description: Compose, freeze, export and inspect local benchmark studies with ToolsEnabled Bench. Use for Bench projects, recorded controls, declared study runs and retained reports.
---

Use the Bench MCP tools advertised by the host; their names may carry its plugin prefix. Read `tools/list` schemas rather than inventing arguments. The private state folder is configured at installation and persists across upgrades.

The installed plugin is qualified for recorded/offline studies. Under Codex, the installed plugin forwards only `BENCHMARK_DATA_DIR`. Parent-shell provider credentials do not automatically reach its Codex server. Before a requested live collector, use the separately configured direct-registration route in `docs/CLAUDE-INSTALL.md` and explicitly forward the study's declared credential names through the host's private environment configuration. Never copy secret values into arguments, drafts or reports, or report a missing forwarded variable as a provider failure.

## Read and author

- Find the intended project with `projects.list`, then read it with `project.get`. Page catalog atoms with `atoms.list` when needed. Keep the returned project ID and current revision.
- `composition.update` without an ID creates a new project; its default is a two-task authored arithmetic replay, not a live-model benchmark. Do not use creation to bypass a conflict on an existing project.
- Existing edits use `atom.add`, `composition.update` or `tasks.generate` with the current project ID and revision. Prefer a taskId/root edit for a local composition change. A complete draft/spec replacement must preserve unrelated authored fields, attachments and pending editor work. Read back the saved project and retain its new revision after each meaningful edit.
- Generation requires the investigator's declared corpus plan, seed, choices, rationale and coverage. `tasks.generate` performs deterministic authoring, not a model call.
- On `REVISION_CONFLICT`, re-read and reconcile the actual edits; never retry with a guessed revision. On input/size/path/lease refusals, stop the dependent operation and explain the refusal. Do not erase data or remove another process's lease to get past it.

## Freeze and inspect

`study.freeze` binds a saved revision to the installed runtime without executing collectors. Use it when the user requests a frozen study or a meaningful review checkpoint, and retain both the returned studyId and full SHA-256. Later draft edits do not change that snapshot. Re-freezing creates a new study identity; do not relabel historical evidence or citations.

When export is requested, `study.export` writes a runnable ZIP beneath the configured data directory and returns its relative artifact reference, bytes and SHA-256. Report those values; do not imply the file was published or transferred. Dashboard opening and distribution remain human choices. The MCP server and dashboard cannot simultaneously own the same data folder: end this client connection before opening the dashboard on that folder, or use separate folders.

## Execute only the requested study

`study.qualify` and `study.run` execute declared runtime, plugins and collectors with the user's OS authority. They may access files/network or incur costs. Inspect the design, collector and intended purpose first; use existing authorization when it covers that exact work. If execution or paid collection is outside the user's request, obtain that missing authorization before proceeding. Set `confirm` to the exact studyId. Foreign studies also require reviewed `trust:true`; a content hash alone does not establish trust. Never substitute a different study merely to make an execution gate pass.

For an authorized offline smoke test, use the default recorded arithmetic project, read it back, freeze it, qualify and run that exact ID, then analyze and read its summary. These authored responses establish apparatus behavior, not model performance or scientific validity. Declared limits and skill instructions are not an OS sandbox.

## Retain and report

`report.get` with `format:"status"` reads execution status. `study.analyze` recomputes retained reports with installed inspection code without rerunning custom graders or collectors. Use `report.get` for summary/markdown/html and follow `nextOffset` for paged text. Report study ID/hash, saved revision, purpose, observed completions/failures and retained artifact references. Distinguish frozen protocol, qualification, recorded control and empirical findings; do not infer research approval from a passing integrity check.
