# ToolsEnabled Bench

**Version 0.3.3 beta · MIT License**

ToolsEnabled Bench is a standalone research workbench for composing benchmark tasks, freezing protocols, exporting runnable studies and regenerating reports from retained evidence. It stores projects locally and requires no ToolsEnabled account. It is a separate product from **Engine Bench**, **Head Gasket Bench** and ToolsEnabled Fleet. Engine Bench and Head Gasket Bench have their own domain apparatus and releases; this repository is the generic benchmark builder. The worked UI examples use authored recorded controls; they contain no live model measurements.

- Compose prompts from reusable typed snippets and nested structures.
- Generate controlled task sets from declared choices, seeds and exclusions.
- Freeze specifications and source identities, then check declared execution requirements.
- Export the pinned runtime, required plugins and hash inventories with a standalone CLI.
- Regenerate HTML and Markdown reports from retained attempts, responses and scoring evidence.

## Trust before execution

**Launching a received study's `cli.mjs` executes its JavaScript and plugin imports before verification begins.** Self-contained hashes establish consistency; they do not authenticate the code performing the check. Use an already trusted Bench installation to inspect received studies. The commands below distinguish retained-evidence inspection from execution.

## First install: prebuilt runtime

Requires **Node.js 22.19 or later** on PATH. Download the runtime ZIP named
`toolsenabled-benchmark-builder-0.3.3.zip` and its matching `SHA256SUMS` from the
[ToolsEnabled Bench releases](https://github.com/ToolsEnabled/toolsenabled-bench/releases).
Choose the 0.3.3 beta entry; do not substitute Engine Bench assets.
Compare the archive's SHA-256 with the reviewed release checksum before extraction.
A checksum from the same untrusted source does not authenticate the publisher.

The steps below assume the ZIP is in your Downloads folder and use a fresh
installation directory. Do not unpack over an older installation. The data
folder is separate so upgrades can reuse it. The ZIP has a top-level
`toolsenabled-benchmark-builder-0.3.3` folder; enter that folder after extraction.

### Linux: Bash / macOS: zsh or Bash

Install Node.js first; extraction also needs `unzip`. These are POSIX shell
commands, suitable for Linux Bash and macOS zsh/Bash:

```sh
node --version
archive="$HOME/Downloads/toolsenabled-benchmark-builder-0.3.3.zip"
install_dir="$HOME/ToolsEnabled/bench-0.3.3"
# Linux: compare this digest with the matching SHA256SUMS entry.
sha256sum "$archive"
# macOS: use shasum -a 256 "$archive" instead of sha256sum.
```

Check that Node is at least 22.19 and the digest matches `SHA256SUMS` before
continuing in the same terminal. On macOS, use the indicated `shasum` command
in place of the Linux hash command. Then extract and start:

```sh
mkdir -p "$install_dir"
unzip "$archive" -d "$install_dir"
cd "$install_dir/toolsenabled-benchmark-builder-0.3.3"
node tools/release.mjs --verify
export BENCHMARK_DATA_DIR="$HOME/ToolsEnabled/bench-data"
node server/main.mjs
```

Stop if extraction or `--verify` fails; run each step only after the preceding
step succeeds.

### Windows: PowerShell

Use PowerShell, not Command Prompt or a POSIX shell. Install Node.js first and
open a new PowerShell window so PATH includes it:

```powershell
$ErrorActionPreference = 'Stop'
node --version
$archive = Join-Path $HOME 'Downloads/toolsenabled-benchmark-builder-0.3.3.zip'
$installDir = Join-Path $HOME 'ToolsEnabled/bench-0.3.3'
Get-FileHash -LiteralPath $archive -Algorithm SHA256
```

Check that Node is at least 22.19 and the digest matches `SHA256SUMS`. Then
continue in the same window, using a fresh extraction destination:

```powershell
Expand-Archive -LiteralPath $archive -DestinationPath $installDir
Set-Location -LiteralPath (Join-Path $installDir 'toolsenabled-benchmark-builder-0.3.3')
node tools/release.mjs --verify
if ($LASTEXITCODE -ne 0) { throw 'Bench archive verification failed.' }
$env:BENCHMARK_DATA_DIR = Join-Path $env:LOCALAPPDATA 'ToolsEnabled/Bench/data'
node server/main.mjs
```

Check Node's version and the digest before extraction. PowerShell environment
assignment uses `$env:NAME = ...`; the POSIX `NAME=value node ...` form does not
work there. Keep data on a private local disk; filesystem mode bits do not
establish Windows ACL protection.

### Open and check the dashboard

Open **http://127.0.0.1:4318**, or the address printed by the server if you set
`BENCHMARK_PORT`. The server binds only to `127.0.0.1`. Leave its terminal open;
Ctrl+C stops it. Serving the prebuilt app and replaying its recorded examples
needs no npm installation, ToolsEnabled account or external model connection.

Linux is the environment for this release lane's automated checks. The macOS
and Windows commands describe the intended Node runtime setup; **native macOS,
native Windows and Claude Desktop acceptance are not established by Linux
checks**. Optional native domain tools have additional requirements. See the
matching `VERIFICATION.json` for exactly what was tested.

The ZIP includes `RELEASE-MANIFEST.json` and a verifier. The release sidecars
`SOURCE-MANIFEST.json`, `SOURCE-PINS.json`, `VERIFICATION.json` and `SHA256SUMS`
record source/artifact identity and checks; read them with the matching archive.
Running the bundled verifier already executes code from that archive, so first
obtain it through a source you trust. Hash consistency is not publisher trust.

## MCP hosts

Bench 0.3.3 also runs as a local stdio MCP server: `node server/mcp.mjs`.
The runtime ZIP includes its pinned SDK; no runtime install or network is needed.
Set `BENCHMARK_DATA_DIR` to an absolute private folder outside the installation,
then run `node tools/mcp-config.mjs --client codex` to print registration; `claude`,
`deepseek`, `cursor` and `claude-desktop` are supported too. See [MCP setup and tool
reference](docs/MCP.md). Set both interfaces to the same absolute external data folder and stop one before starting the other. Execution
requires explicit study-ID confirmation; foreign studies additionally require trust.

## Local projects and evidence

Set `BENCHMARK_DATA_DIR` to an absolute private folder outside the installation before starting the dashboard. Choose a local filesystem and one host/PID namespace for each data root; do not share an active root through network storage. Plugin launches refuse paths overlapping their installation. `BENCHMARK_PORT` chooses another local port. Back up the entire data directory.

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

Development requires Node.js 22.19 or later, npm and Python 3 for interpreter regression tests. From the full source checkout (not the runtime ZIP), set `BENCHMARK_DATA_DIR` using your shell as above, then:

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

The source extraction is recorded in [EXTRACTION.json](EXTRACTION.json). Frozen generator records retain the identity **ToolsEnabled BenchMark Builder**, with research template 2.2.0; the public product name is **ToolsEnabled Bench**. Archive filenames retain the `toolsenabled-benchmark-builder` prefix. Cite the software using [CITATION.cff](CITATION.cff) and cite each study separately. Historical exports retain their original identities.

## Claude plugin

The `toolsenabled-bench` plugin provides the Bench workflow skill and direct Node
MCP launch with an absolute private data directory outside the plugin cache.
See [Claude and Codex setup](docs/CLAUDE-INSTALL.md) for direct stdio registration,
persistent state, human dashboard access and the optional plugin packaging limits.
The source includes an MCPB manifest and packaging tools for qualification; native
macOS/Windows Desktop acceptance is not yet established. ToolsEnabled is not affiliated with or endorsed by Anthropic.

[Support](mailto:support@toolsenabled.ai) · [Privacy and retention](PRIVACY.md) · [Security and reporting](SECURITY.md).
