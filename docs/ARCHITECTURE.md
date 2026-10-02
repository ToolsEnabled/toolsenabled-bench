# Architecture and integration boundary

ToolsEnabled Bench 0.3.2 is a standalone local product; its package and frozen generator retain the name ToolsEnabled BenchMark Builder. Its reusable benchmark subsystem has no ToolsEnabled Fleet, engine, account, or Electron dependency.

```text
Browser workspace (src/app/)
  ├─ authoring component (src/research-benchmark.js + helpers)
  ├─ generic compiler / analysis / report (src/benchmark/)
  │    └─ configured plugin descriptors
  └─ local HTTP adapter + project session controller
       ├─ project snapshots + revision checks
       └─ immutable run directories
            └─ installed CLI + study data → qualification → collection → analysis
```

Node built-ins implement the local service and exported CLI. The browser shares the compiler and reporting modules with the CLI. Lazy chunks defer example libraries and runtime source text until needed. Optional domain apparatus can require Python or Docker.

## Executable-study trust boundary

**Launching a received study's `cli.mjs` executes its JavaScript and static plugin imports before verification.** Self-contained hashes do not authenticate the checking runtime. Use an already trusted installation for inspection:

```sh
node /path/to/bench/src/benchmark/cli.mjs verify --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs status --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs analyze --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs reference --project /path/to/study
```

`openProject` checks the manifest, project identity and source pins without importing received runtime files. Complete matching installed runtime pins permit reconstruction by installed compiler/plugin code. A different or incomplete runtime remains available for digest and retained-evidence inspection. `status`, `analyze` and `reference` do not execute custom graders; summaries identify retained scores and their frozen grader provenance. Analysis and reference commands can write derived artifacts.

The explicit `regrade` command requires matching installed runtime admission before any grader process starts. It executes the declared custom grader through the verified installed module host and writes a separate successful-comparison receipt without altering the journal. The project directory is its working directory; only present `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP` and `TMP` environment values are inherited. The process has the current user's filesystem/network authority and is not an OS sandbox. `run` and `qualify` are also execution actions.

## Local host and storage

The editor accepts `projectStore.read(id)`, `projectStore.save(id, snapshot)`, `submitExported({ project, files, ... })`, source loading, download, and navigation callbacks. It has no account adapter or account-store fallback. Its public `study` getter returns a copy; `snapshot()` captures the editable draft, including pending fields and a bounded, single replacement Undo snapshot. Hosts must not capture a mutating snapshot while an import is replacing the current specification.

`src/app/project-session.js` serializes saves and tracks edit generations separately from persisted generations. Reopening or inspecting the same project saves pending edits before loading. Late save responses cannot clear newer edits. A failed read or invalid saved draft leaves the current editor and project selection intact. The server uses revisions to refuse conflicting writes, and the UI retains unsaved state after a refusal. Draft replacement Undo survives save, reopen, and portable draft export without recursively storing older Undo histories.

The service binds only to `127.0.0.1`, checks Host and Origin, and requires its per-process token for API access. It serves the built application and its local project/run APIs. On submission and resume, the service derives the complete mandatory core and configured-plugin inventory from its installed build. It requires the submitted runtime pin keys, hashes and source bytes to match that independent inventory and reconstructs the project before any process starts. The service launches the absolute installed `cli.mjs` with `--project` pointing to the retained study directory. Received runtime files remain data for inspection. Explicit execution actions can run study-declared commands, modules, graders and qualification interpreters with the current user's filesystem/network authority; time and output limits do not provide an OS sandbox.

## Optional domains and export closure

`plugins.json` declares bundled extension modules and runtime plugin modules. The generated composition root registers their descriptors. Schema 4 freezes the core inventory plus the configured runtime plugin inventory; each new export carries a required-plugin manifest and the package/source hashes used to reconstruct it. A registration available only in the current JavaScript process cannot authorize an export.

Lean and its trading implementations live in an optional runtime plugin. Domain algorithms for task semantics, authoring, native evidence, requirements, qualification, provenance, readiness, and reporting are reached through descriptor capabilities. Node-only handlers are resolved from declared pinned modules. Generic core modules contain no active Lean/trading imports, module references, or domain identifiers. `npm run check:core` is a strict zero-dependency gate; historical schema inventories and citation records retain their names as data. The generic and SQL regression fixtures also exercise exported CLI workflows with Lean files physically absent.

Keep plugin initialization deterministic. Callback thunks defer work until invoked and avoid module initialization cycles. See [PLUGINS.md](PLUGINS.md) for configuration and hook groups.

## Retained runs and compatibility

A run contains its immutable package, metadata, log, and `results/` evidence. Editing a draft does not replace a run package. Cancellation requests graceful termination; an unconfirmed termination remains unconfirmed. Resume preserves the existing journal and ordinary runner lock rules. A server restart cannot silently authorize another process while a recorded PID may still be alive.

Schemas 1–3 retain their historical runtime inventories. Original 0.1.0 exports retain their own generator, template citations, pinned CLI and deterministic reports. Inspecting an archive through the current app preserves its identity; a runtime that cannot be reconstructed exactly is opened with the applicable read-only limits. To change a study, explicitly make a new draft and freeze a new identity. Preserve the old archive.

## MCP host integration

`server/mcp.mjs` uses a pinned SDK bundled at build time for local stdio. It opens
no network listener and shares ProjectStore/RunStore with the browser service.
`server/mcp-service.mjs` maps twelve tools onto existing compiler and CLI operations;
`server/local-origin.mjs` binds locally prepared study IDs/digests to the data store.
Execution requires explicit study-ID confirmation plus local provenance or trust.
Fixed artifact names, confined storage access, redaction and response bounds apply.
See [MCP](MCP.md) for the complete tool and registration contract.

## Future host integration

A future host may provide storage, submission, navigation and download services through the editor callbacks. ToolsEnabled Fleet integration would be a separate host adapter. It must not introduce Fleet or account dependencies into this product's core, or copy Bench/Lean-Bench code and defaults into Fleet. This release adds no Fleet integration or general ToolsEnabled plugin loader.
