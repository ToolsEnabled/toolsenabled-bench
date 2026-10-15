# ToolsEnabled Bench: Claude and Codex setup

ToolsEnabled Bench 0.3.3 beta is the generic benchmark builder, separate from
Engine Bench and Head Gasket Bench. The prebuilt runtime provides twelve tools
through local stdio. Node.js 22.19 or later must be on the MCP host's PATH. The
pinned SDK is included; no npm install or model call is needed to start Bench.
ToolsEnabled is not affiliated with or endorsed by Anthropic, OpenAI or another
AI provider.

## Install the runtime first

Follow [First install](../README.md#first-install-prebuilt-runtime) for your shell.
Use the matching release ZIP and checksums, extract into a fresh folder, and run
`node tools/release.mjs --verify` from its versioned top-level directory. A source
checkout needs `npm ci` and `npm run build` first. Check the matching
`SOURCE-PINS.json`, `SOURCE-MANIFEST.json`, `VERIFICATION.json` and `SHA256SUMS`
for the actual release identity and checks. A checksum is not publisher
authentication.

Choose an absolute private data folder outside the installation and the entire
plugin cache. Reuse that folder across upgrades; simultaneous clients need
separate folders. Stop the dashboard before a client opens the same folder.
Never remove a live lease file to bypass the one-owner check.

Linux Bash / macOS zsh or Bash, from the extracted runtime:

```sh
export BENCHMARK_DATA_DIR="$HOME/ToolsEnabled/bench-data"
node tools/mcp-config.mjs --client claude
```

Windows PowerShell, from the extracted runtime:

```powershell
$env:BENCHMARK_DATA_DIR = Join-Path $env:LOCALAPPDATA 'ToolsEnabled/Bench/data'
node tools/mcp-config.mjs --client claude
```

The helper prints a `claude mcp add` command with the actual Node program, server
path and external data folder. Review and run that command to register Bench.
The helper itself changes no client configuration. Open a new Claude Code
session and check its MCP server list. The server name is `bench`.

For Codex, use `--client codex` instead. For Claude Desktop, use
`--client claude-desktop` to print JSON for the client's configuration; `cursor`
and `deepseek` also have print-only formats. See [MCP setup](MCP.md) for
configuration, host environments, tool schemas, limits and recovery.

Linux runtime and stdio behavior are release-tested. Native macOS, Windows and
Claude Desktop acceptance remain unverified; shell examples and a manifest are
not evidence that every host has been exercised. Client configuration formats
and approval behavior belong to the client.

## Check a recorded study

Ask your agent to list saved projects, create the default recorded composition,
read its revision and freeze it. `study.freeze` returns a study ID. Review the
frozen identity and declared execution, then request qualification and execution
with `confirm` equal to that exact ID. `study.analyze` and `report.get` inspect
the retained result. The arithmetic example has two authored recorded tasks;
it makes no model-performance claim and requires no provider credentials.

Foreign studies additionally require explicit `trust: true` after review.
Confirmation and local provenance are execution guards, not an OS sandbox.
Declared collectors and plugins run with your user account's filesystem and
network permissions. Your client can retain tool results or send them to its
model provider. Read [Security](../SECURITY.md) and [Privacy](../PRIVACY.md).

To inspect the same projects in the human dashboard, stop the MCP client/server
and start `node server/main.mjs` with the same `BENCHMARK_DATA_DIR`. Open
`http://127.0.0.1:4318`. Back up the entire data folder privately; uninstalling the
runtime does not remove it.

## Optional plugin packaging

The runtime includes `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
`.mcp.json` and `skills/toolsenabled-bench/SKILL.md`. They retain the plugin name
`toolsenabled-bench`, its workflow skill, direct Node launch and external state
contract. They do not establish a published marketplace or directory listing.
The previously documented `ToolsEnabled/toolsenabled-plugins` marketplace is not
publicly available at this release's check; use the direct stdio route above.

Plugin launch requires an absolute external `data_directory` (Claude) or an
explicitly forwarded `BENCHMARK_DATA_DIR` (Codex). The Codex manifest forwards
that variable only; it does not automatically forward provider credentials.
State paths overlapping the installation are refused. Check each host's cache
layout yourself when choosing the external folder.

`manifest.json` and `tools/package-mcpb.mjs` support a separate Claude Desktop
bundle qualification. A generated or validated bundle is not native Desktop
acceptance; no `.mcpb` or Registry listing is published with this release. Use
`tools/registry-draft.mjs` only to prepare a separately reviewed listing after
artifact and native-host qualification. These packaging files do not change the
supported direct stdio server's twelve tools or execution requirements.
