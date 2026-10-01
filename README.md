# ToolsEnabled Bench

**Version 0.3.0 beta · MIT License**

ToolsEnabled Bench is a standalone research workbench for composing benchmark tasks, freezing protocols, exporting runnable studies and regenerating reports from retained evidence. It stores projects locally and requires no ToolsEnabled account. It is a separate product from ToolsEnabled Fleet. The worked UI examples use authored recorded controls; they contain no live model measurements.

- Compose prompts from reusable typed snippets and nested structures.
- Generate controlled task sets from declared choices, seeds and exclusions.
- Freeze specifications and source identities, then check declared execution requirements.
- Export the pinned runtime, required plugins and hash inventories with a standalone CLI.
- Regenerate HTML and Markdown reports from retained attempts, responses and scoring evidence.

## Trust before execution

**Launching a received study's `cli.mjs` executes its JavaScript and plugin imports before verification begins.** Self-contained hashes establish consistency; they do not authenticate the code performing the check. Use an already trusted Bench installation to inspect received studies. The commands below distinguish retained-evidence inspection from execution.

## Run the prebuilt release

Requires **Node.js 22.19 or later**. Extract `toolsenabled-benchmark-builder-0.3.0.zip`, open its directory and run:

```sh
node tools/release.mjs --verify
node server/main.mjs
```

Open **http://127.0.0.1:4318**. The server binds only to `127.0.0.1`. Serving the prebuilt application and using its recorded examples requires no package installation or network connection. External collection requires the environment declared by that study.

The archive includes `RELEASE.md` and a file hash inventory. Release sidecars `SOURCE-MANIFEST.json`, `VERIFICATION.json` and `SHA256SUMS` identify the exact source, recorded checks and archive bytes. These checks establish content integrity, not publisher authentication.

## MCP hosts

Bench 0.3.0 also runs as a local stdio MCP server: `node server/mcp.mjs`.
The runtime ZIP includes its pinned SDK; no runtime install or network is needed.
Run `node tools/mcp-config.mjs --client codex` to print registration; `claude`,
`deepseek`, `cursor` and `claude-desktop` are supported too. See [MCP setup and tool
reference](docs/MCP.md). MCP and the browser use the same local store. Execution
requires explicit study-ID confirmation; foreign studies additionally require trust.

## Local projects and evidence

Projects and runs are stored in `.benchmark-data/` beside the application. Set `BENCHMARK_DATA_DIR` to choose another local data directory or `BENCHMARK_PORT` to choose another local port. Back up the entire data directory.

Drafts retain unfinished editor fields and one replacement Undo snapshot. Revision checks refuse conflicting saves. Each run retains its frozen package, process log and evidence separately from the editable draft.

For a first run, open **A small, complete study**, inspect its two arithmetic tasks and recorded responses, then choose **Freeze project** and **Run frozen study locally**. Inspect the retained run and reports in **Local runs**. The **Structured record extraction** example also exercises a portable domain plugin.

## Inspect or run an exported study

Extract **Export runnable ZIP** into its own directory. Invoke the CLI from an already trusted installation, passing the study directory as data:

```sh
node /path/to/bench/src/benchmark/cli.mjs verify --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs status --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs analyze --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs reference --project /path/to/study
```

These inspection commands do not execute study collectors, custom graders or archived runtime modules. `verify` checks digests and uses the installed compiler only when the pinned runtime matches. A foreign runtime remains available for digest and retained-evidence inspection. `analyze` writes reports; `reference` writes a reference bundle. Custom scores remain recorded values, labelled **retained-not-reexecuted**, with their frozen grader path/hash and any original process receipt.

Qualification, collection and custom regrading are explicit execution actions:

```sh
node /path/to/bench/src/benchmark/cli.mjs qualify --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs run --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs regrade --project /path/to/study
```

Execution requires a matching installed runtime. `regrade` executes the declared custom grader against retained responses through the verified installed module host. A successful comparison writes `results/custom-grade-verification.json` and leaves the original journal unchanged. Declared code runs with the current user's filesystem and network authority. Time and output bounds do not provide an OS sandbox. Regrading uses the project directory and inherits only `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP` and `TMP` when present; collector environment declarations are separate.

The local service also launches its installed CLI with the study directory as data. On submission and resume, it checks the complete core and configured-plugin runtime inventory derived from the installed build, including exact source pins and supplied bytes, before spawning a process.

The export carries its pinned runtime, required plugins, manifest, prompts, protocol, schedule and attachments. Preserve original 0.1.0 exports with their own runtime and citations. Use a separately trusted matching runtime when original-byte regeneration is required. Revising an old study creates a new draft and frozen identity; it does not replace the earlier record.

## Build and test from source

Development requires Node.js 22.19 or later, npm and Python 3 for interpreter regression tests:

```sh
npm ci
npm run build
npm test
npm run check:core
npm run serve
```

Browser acceptance additionally requires a supported Playwright Chromium installation:

```sh
npx playwright install chromium
npm run test:browser
```

The runtime ZIP omits development tests and fixtures. `npm run release` builds the application and creates a ZIP and checksum under `release/`. Packaging uses sorted paths and fixed metadata; reproducibility requires identical packaged inputs and the recorded toolchain.

Read the matching release sidecars for the exact source commit, archive hashes, test counts, toolchain and reproducibility checks. Source and runtime packages exclude private owner coordination and research documents, including documents formerly embedded in optional domain metadata. See [Review and artifact identity](docs/REVIEW.md).

The public runnable examples and retained-response regression fixtures use authored recorded controls, including the preserved original 0.1.0 arithmetic export. Authoring libraries provide prompt snippets and reference code, not empirical model results. Historical live CLI/model run outputs and their derived performance figures are excluded from the public source and runtime packages.

## Scope and documentation

This beta supports apparatus authoring and inspection. Qualification receipts establish only their listed checks. Content hashes do not establish prospective registration, independent scientific validity or authenticated provider identity. Fresh stochastic model responses need not reproduce earlier responses. Optional native domain apparatus has separately declared dependencies and admission limits.

Read [Methods](docs/METHODS.md), [Architecture](docs/ARCHITECTURE.md), [Plugins](docs/PLUGINS.md), [Compatibility](docs/BASELINE-MIGRATION.md) and [Release notes](docs/RELEASE-NOTES.md).

## License, attribution and identity

Copyright (c) 2026 Joshua Pinckard. Distributed under the [MIT License](LICENSE). Preserve [NOTICE](NOTICE) and [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) with redistributed material.

Joshua Pinckard conceived the project, defined its objectives and requirements, directed the autonomous agent workflows, selected and evaluated outputs, and assumes responsibility for the research methodology and conclusions. AI agents generated substantial portions of the implementation and written drafts. See [ATTRIBUTION.md](ATTRIBUTION.md).

The source extraction is recorded in [EXTRACTION.json](EXTRACTION.json). The 0.3.0 package and frozen generator retain the identity **ToolsEnabled BenchMark Builder**, with research template 2.2.0; the public product name is **ToolsEnabled Bench**. Cite the software using [CITATION.cff](CITATION.cff) and cite each study separately. Historical exports retain their original identities.
