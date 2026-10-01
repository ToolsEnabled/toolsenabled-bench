# 0.3.1 — web release fixes

- Sidebar, overview and methods citations use the package version injected at build time.
- Opening, reloading and navigating a saved project leave its bytes and revision unchanged; real edits still save locally.
- Freeze & review lists retained studies from MCP, CLI and web runs, with their complete SHA-256 and original frozen package.
- New freezes and template citations identify generator 0.3.1. The research template remains 2.2.0 and historical fixtures and frozen identities are preserved.
- Data-root leases and execution admission are unchanged.

# 0.3.0 — local stdio MCP

Twelve MCP tools drive existing authoring, freeze, export, qualification, run and
report operations through the same local store. Execution requires study-ID
confirmation and local provenance or explicit foreign-study trust. Responses are
bounded, storage access confined, and credential-shaped content redacted.
Registration snippets cover Claude Code, Codex, DeepSeek Harness, Cursor and
Claude Desktop. The SDK is pinned and bundled into the offline runtime ZIP.
Hosted HTTPS/OAuth is deferred. Real-client/security gates precede release.
New freezes and template citations identify generator 0.3.0; historical frozen
identities and template version 2.2.0 are preserved.

# ToolsEnabled Bench 0.2.0 (package: toolsenabled-benchmark-builder)

**Beta · MIT License · 2026-09-30**

ToolsEnabled Bench provides a standalone local workflow for composing, freezing, exporting and inspecting benchmark studies. It is separate from ToolsEnabled Fleet and requires no ToolsEnabled account. The worked UI examples use authored recorded controls, with no live model performance claims.

## Changes

- Required plugins, bundled dependencies and source hashes now travel with exported studies. Verification refuses missing or substituted required plugins.
- Local project storage retains unfinished editor fields and one draft-replacement Undo snapshot, with revision checks to refuse conflicting saves.
- Local execution uses the installed CLI with the study directory supplied as data for verification, qualification, execution and analysis. Cancellation and shutdown preserve retained evidence while waiting for owned execution to settle.
- Generic runtime modules use plugin contracts for domain behavior. Lean remains optional; schema-4 studies pin the core plus configured runtime plugins.
- New studies identify generator 0.2.0 and research template 2.2.0, separately from the investigator's study version and authorship.
- Release packaging includes file hashes and a whole-archive checksum, uses fixed ZIP metadata and avoids embedding checkout directory names in generated module identities.

## Security changes

- `verify`, `status`, `analyze` and `reference` invoked through a trusted installation inspect retained data without executing study collectors, custom graders or archived runtime modules. Custom scores are labelled as not re-executed. Explicit `regrade` requires matching installed runtime pins, uses the installed verified host and writes a separate comparison receipt.
- Local submission and resume independently check the complete installed core/configured-plugin source inventory before spawning the installed CLI with the study directory as data. Missing, unexpected or differing runtime pins are refused for execution.
- Embedded private owner coordination/research documents and private origin metadata are removed from shipped examples. Retained reference material preserves source attribution; historical live CLI/model run outputs and derived performance figures are excluded. These changes confer no scientific approval.
- Imported composition role names are escaped in displayed text and attributes. Role selection compares data values without inserting imported names into selectors.

A received `cli.mjs` executes JavaScript and plugin imports before verification. Use an already trusted installation for inspection; hashes do not authenticate received code. Declared execution has the current user's filesystem/network authority, and time/output bounds do not provide an OS sandbox. See [Review and artifact identity](REVIEW.md).

## Compatibility with 0.1.0 exports

Original 0.1.0 exports retain their own runtime, hashes, citations and evidence. Compatibility checks preserve the original authored arithmetic recorded-control export, exercise its pinned CLI, regenerate its deterministic reports and resume without recollection. Keep the original archive intact. To revise a study, explicitly create a new draft and freeze a new identity.

## Run locally

With Node.js 22.19 or later, extract `toolsenabled-benchmark-builder-0.2.0.zip` and run:

```sh
node tools/release.mjs --verify
node server/main.mjs
```

Open `http://127.0.0.1:4318`. Serving the prebuilt app requires no package installation or network connection. Back up `.benchmark-data/` to preserve local drafts and run evidence.

## Beta scope

This release supplies benchmark apparatus and recorded controls. It makes no claim of validated tool-using or multi-agent benchmarks, completed LEAN research, comparative live-model results or independent scientific approval. Reproduction refers to retained artifacts and deterministic calculations under the pinned runtime; new stochastic collection may differ. External collectors and optional native apparatus require their separately declared environment.

The public runnable examples and retained-response regression fixtures use authored recorded controls, including the preserved original 0.1.0 arithmetic export. Authoring libraries provide prompt snippets and reference code, not empirical model results. Historical live CLI/model run outputs and their derived performance figures are excluded from the public source and runtime packages.

## Artifact and validation scope

Use the matching `SOURCE-MANIFEST.json`, `VERIFICATION.json` and `SHA256SUMS` distributed beside the release archives. They record the exact source commit and included files, final command results and test counts, toolchain, browser checks, reproducibility comparison and archive hashes. Verification results apply to the objects named in those sidecars.

Source or payload changes require fresh qualification and archive identities. Historical frozen studies retain their own runtime and citations. See [Review and artifact identity](REVIEW.md) for reproduction commands and evidence limits.

## License and recorded identity

Copyright (c) 2026 Joshua Pinckard. The software is distributed under the [MIT License](../LICENSE), with retained [notices](../NOTICE), [third-party attributions](../THIRD-PARTY-LICENSES.md) and [authorship and AI-assistance disclosure](../ATTRIBUTION.md).

**ToolsEnabled Bench** is the public product name. The package archive is `toolsenabled-benchmark-builder-0.2.0.zip`; existing software citation and frozen generator records retain **ToolsEnabled BenchMark Builder**. Those recorded identities are unchanged.
