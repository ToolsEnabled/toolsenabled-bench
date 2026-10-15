# Codex marketplace candidate (unreleased)

This branch supplies a self-distributed local marketplace for the existing
ToolsEnabled Bench Codex plugin. It is separate from Head Gasket Bench and
Engine Bench; no OpenAI directory listing or approval is claimed.

Requires Node.js >=22.19 on PATH. The branch includes the generated, pinned MCP
SDK bundle and its dependency-license inventory so a Git marketplace install
starts without npm or network bootstrapping. Its source/build remains in the
repository; no generated dependency is fetched at plugin startup.

```sh
codex plugin marketplace add ToolsEnabled/toolsenabled-bench --ref openai-plugin
codex plugin add toolsenabled-bench@toolsenabled-bench-openai
export BENCHMARK_DATA_DIR=/absolute/private/bench-data
```

Start Codex with that environment variable, outside the whole plugin cache. The
manifest forwards only BENCHMARK_DATA_DIR; provider credentials are not forwarded.
The MCP entry requires external persistent state and enforces the one-owner
lease. It advertises twelve named tools. For an authorized inert check, create
the default recorded arithmetic composition, freeze it and use the returned
studyId as `confirm` for qualification and execution. Those recorded controls
are not empirical model measurements. Execution/trust checks are unchanged.

Stop the MCP connection before using the dashboard with the same data root. The
Git plugin includes the MCP/runtime sources; the dashboard's generated browser
assets are supplied by the normal release/build workflow, not this Git plugin.
Use the matching prebuilt runtime or build from source for dashboard access.

The private external root retains projects, frozen studies, runs, logs, reports
and exports. Uninstalling the plugin retains that data; stop clients before
backup/deletion. The stdio server has no telemetry or ToolsEnabled account.
Declared collectors/plugins can use the user's filesystem/network authority and
Codex can send tool results to its model provider. Review exact execution before
allowing it. This package adds explicit empty hooks and preserves Claude wiring.
See [Privacy](../PRIVACY.md), [Security](../SECURITY.md), MIT license and
[Terms](https://toolsenabled.ai/terms/). The terms currently describe Fleet;
all-product coverage and the separate public-directory gates remain pending.
