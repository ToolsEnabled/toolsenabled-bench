# Bench as a local MCP server

Bench 0.3.1 exposes twelve tools through the official MCP SDK 1.26.0 over stdio.
The runtime ZIP includes the bundled SDK and all bundled dependency licences.
Node.js 22.19 or later is the only requirement for the recorded examples. There
is no package installation at runtime, network listener, account or hosted server.

```sh
node server/mcp.mjs
```

An MCP host starts this process and exchanges newline-delimited JSON on stdin and
stdout. Do not launch it as an HTTP server. Its default data directory is
`.benchmark-data/` beside the installed application, regardless of the host's
working directory. `BENCHMARK_DATA_DIR` selects another absolute local directory.
There is **one Bench process per data root at a time; the web app and MCP can share a root, but not simultaneously.**
Stop the current server before opening that root in another client. Back up the
whole data directory, including the private `.local-origin-key` file. Never share
that key with a study export. Old runs remain readable; execution of runs without
a valid local receipt requires explicit trust.

## Registration

The helper prints a snippet with your current Node executable, installed Bench
path and data directory. It never edits client configuration or starts a client.
Shell commands are for POSIX shells on Linux/macOS and PowerShell on Windows.

```sh
node tools/mcp-config.mjs --client claude
node tools/mcp-config.mjs --client codex
node tools/mcp-config.mjs --client deepseek
node tools/mcp-config.mjs --client cursor
node tools/mcp-config.mjs --client claude-desktop
```

For the examples below, replace `/absolute/bench` and `/absolute/bench-data` with
your installation and desired data directory, and use your Node executable if
`node` is not on the client's PATH.

Claude Code:

```sh
claude mcp add --env BENCHMARK_DATA_DIR=/absolute/bench-data --transport stdio bench -- node /absolute/bench/server/mcp.mjs
```

Keep `--transport stdio` between the variadic `--env` option and the server name.
See [Claude Code MCP registration](https://code.claude.com/docs/en/mcp).

Codex:

```sh
codex mcp add bench --env BENCHMARK_DATA_DIR=/absolute/bench-data -- node /absolute/bench/server/mcp.mjs
```

For long local studies, set a suitable `tool_timeout_sec` for `[mcp_servers.bench]`
in your Codex configuration. See [Codex MCP configuration](https://developers.openai.com/codex/mcp).

DeepSeek Harness: add this row to your Cordis overlay's plugin list (for example,
the corresponding list in `cordis.patch.yml`):

```yaml
- id: mcp-bench
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: bench
    transport: stdio
    command: node
    args: ['/absolute/bench/server/mcp.mjs']
    env:
      BENCHMARK_DATA_DIR: /absolute/bench-data
    toolCallTimeoutMs: 1800000
```

This is the [official Harness MCP client row](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)
with Bench as the local process. Add it to the intended profile/overlay, retaining
that overlay's surrounding structure. A transport probe can start a temporary
server before the serving process; starting Bench executes no study.

Cursor: merge the `bench` entry into `.cursor/mcp.json` in your project, or your
user MCP configuration:

```json
{
  "mcpServers": {
    "bench": {
      "command": "node",
      "args": ["/absolute/bench/server/mcp.mjs"],
      "env": { "BENCHMARK_DATA_DIR": "/absolute/bench-data" }
    }
  }
}
```

See [Cursor MCP configuration](https://cursor.com/docs/mcp). Claude Desktop uses
the same `mcpServers` entry in its desktop configuration file. ChatGPT/Dots hosted
HTTPS and OAuth support is a separate later phase; this release supplies stdio.
Real-client acceptance and the security review are release gates, separate from
the automated protocol proof.

## Tools and a recorded example

`tools/list` supplies exact JSON schemas. Only `projects.list`, `project.get`,
`atoms.list` and `report.get` have `readOnlyHint: true`. Read-only annotations are
hints for hosts; the server still enforces its validation and execution checks.

| Tool | Arguments and result |
| --- | --- |
| `projects.list` | Optional `offset` and `limit` (1–100); metadata `items`, `total`, `nextOffset`. |
| `project.get` | `projectId`; editable record with draft and revision. |
| `atoms.list` | `projectId`, optional paging; catalog entries whose kind is atom. |
| `atom.add` | `projectId`, `revision`, declared `atom`; saves a distinct atom. |
| `composition.update` | No ID creates a recorded arithmetic diagnostic by default. Supply `spec` or complete `draft` to create another design. Existing `projectId` requires `revision`; supply a replacement `spec`, `draft`, or `taskId` plus `root`. |
| `tasks.generate` | `projectId`, `revision`, `plan`; plan is the existing version-1 corpus recipe with explicit seed, rationale, declared families/axes/choices, selection and coverage. Returns saved revision and generated tasks. |
| `study.freeze` | `projectId`, `revision`; binds installed runtime and retains a frozen study without execution. Returns `studyId`, `sha256`, `status`. |
| `study.qualify` | `studyId`, `confirm` equal to that ID; foreign studies additionally need `trust: true`. Executes qualification and returns retained phase/status/history. |
| `study.export` | `studyId`; writes `runs/<studyId>/study.zip`, returning this relative artifact reference, byte count and SHA-256. |
| `study.run` | Same confirmation/trust contract as qualify. Runs the frozen study, retaining journals and reports. |
| `study.analyze` | `studyId`; recomputes reports from retained evidence through the installed CLI, without executing custom graders. |
| `report.get` | `studyId`, optional `format` (`summary`, `status`, `markdown`, `html`). Text formats accept `offset` and `limit` in UTF-8 bytes and return `nextOffset`. |

A host can drive the whole offline example with these calls:

1. `composition.update({})` → retain `id` and `revision`.
2. Inspect with `project.get({projectId: id})` and `atoms.list({projectId: id})`.
3. `study.freeze({projectId: id, revision})` → retain `studyId`.
4. `study.export({studyId})` → ZIP reference inside the data root.
5. After review, `study.qualify({studyId, confirm: studyId})`.
6. `study.run({studyId, confirm: studyId})`.
7. `study.analyze({studyId})` and `report.get({studyId, format: "summary"})`.

The default study replays two authored arithmetic responses. It makes no model
call and supplies no model-performance evidence. Scientific experiments retain
Bench's existing qualification requirements; MCP does not relax them. New freezes and template citations identify generator 0.3.1. Historical frozen
identities and the template version 2.2.0 are preserved.

## Execution, foreign studies and bounds

`study.run` and `study.qualify` execute declared runtime and plugin code with the
current user's filesystem/network authority. Declared command or HTTP collectors
can invoke external services and incur costs. Confirmation must name the exact
study on every execution call. A received/copied study requires `trust: true` as
well. Never infer trust from a claimed source or from self-contained hashes.
Trust does not bypass the existing complete installed-runtime admission checks.
Studies requiring another runtime need a separately trusted matching installation.

Locally created/frozen studies carry a receipt bound to their ID and frozen digest
using the store's private key. A copied receipt from another store is insufficient.
Freeze always binds the installed compiler/runtime; it never loads a caller-selected
runtime from disk. Importing existing data is an operator filesystem action, not
an arbitrary-path MCP tool. Inspection through `study.analyze` does not require
execution trust and does not regrade custom scores.

Calls accept identifiers and fixed report formats, never arbitrary filesystem
paths or CLI options. Symlinks and multiply linked files in addressed storage are
refused. Absolute paths stored by earlier releases are ignored for execution;
paths are derived from the study ID. These checks do not isolate hostile code
running as the same operating-system user. Do not run untrusted code under your
account merely because it is in the data directory.

Inputs are capped at 2 MiB and complete tool responses below 64 KiB. Lists and
text reports support paging. Oversized unpaged project/summary responses return
`TOO_LARGE`; the full data remains in the local store. Redaction happens before
report pagination. Known sensitive environment values, credential fields and
common credential text formats are redacted. Raw exception and child output are
not forwarded to protocol logs. Declare credentials by environment variable name;
never put credential values in drafts, attachments or reports. Exports preserve
study bytes locally, so review them before sharing.

Execution calls settle before returning. Failures set `isError`; inspect
`report.get` with `format: "status"` for retained phase and exit codes. Disconnect
or SIGTERM stops owned work through the existing cancellation path. A host timeout
alone is not evidence that the study stopped: inspect status before retrying.
The journal's existing lock prevents duplicate concurrent collection. MCP offers
no `recover` override and never clears a journal lock automatically. Editing uses
revision preconditions; reopen after conflicts.

## Data-root ownership and recovery

Both entry points acquire `.bench-data-lease` with atomic exclusive file creation
before opening projects or runs. A second process refuses startup, naming the
holder's PID and entry point (`server/main.mjs` or `server/mcp.mjs`). Stop that
process, or set a different `BENCHMARK_DATA_DIR`. The lease covers readers too:
another process cannot misclassify an active run as interrupted or resume it.
Use a local filesystem and one host/PID namespace for each data root. Older Bench
versions and direct low-level store scripts do not honor this lease; stop them
before using 0.3.1. It is not a boundary against hostile same-user code.

Clean shutdown, SIGINT and SIGTERM retain ownership until admitted operations and
owned runs settle, then remove the lease. MCP also does this when stdin closes.
Startup failures release an acquired lease. SIGKILL, power loss or an OS crash
cannot run cleanup. On Linux, stale detection checks the PID and `/proc` start-time
identity, boot ID and PID namespace; a reused PID does not keep a dead holder's
lease alive. A live holder is never evicted by age or a timeout. On other systems,
or when Linux identity cannot be recorded, the conservative fallback reclaims
only a PID for which the OS reports `ESRCH` (no such process). A live/reused PID,
permission error or uncertain identity refuses; stop the holder or use another
root. Foreign hosts or PID namespaces refuse automatic recovery.

Stale removal is serialized by a second exclusive file,
`.bench-data-lease.recovery`. Each contender rechecks ownership under that guard;
it never removes a newly acquired lease. A crash during recovery can leave the
guard behind and block later stale recovery. Malformed, partial, linked or
unreadable lease files also refuse rather than guessing. For manual repair, stop
all Bench clients that could start servers for this root, verify no Bench process
or study collector is still using it, back up the root, and only then remove the
lease/recovery files. Never remove them while a holder or recovery process is
alive. If uncertain, use another data root. Stale-root recovery does not remove
study journal locks, authorize a resume or kill orphaned collectors: inspect
retained run/process state before explicitly resuming any interrupted work.

## Build and validate

From a source checkout, install the locked development dependencies and build:

```sh
npm ci
npm run build
env -u DISPLAY npm test
node tools/release.mjs
```

An offline npm cache can replace registry access with `npm ci --offline --cache
/path/to/cache`. The generated SDK module includes only its Node stdio closure;
`server/mcp-sdk.json` records versions and hashes, and `docs/MCP-LICENSES.md`
contains its dependency licence texts. The release builder requires the matching
exact SDK pin and bundle hashes. SDK source and browser source rebuilds need the
lockfile dependencies; serving an extracted ZIP needs none.
