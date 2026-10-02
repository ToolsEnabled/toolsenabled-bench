# Claude ecosystem packaging

The `toolsenabled-bench` plugin supplies the existing 12-tool local Bench MCP
server and a workflow skill. Node.js 22.19 or newer must already be on PATH.
Its runtime includes the pinned, readable MCP SDK bundle; it does not install
packages or contact a model at startup. ToolsEnabled is not affiliated with or
endorsed by Anthropic.

## Claude Code

These instructions apply after the reviewed release and marketplace are published.
Obtain the expected marketplace commit, source commit/tree and ZIP SHA-256 from
an authenticated release announcement and its public `SOURCE-PINS.json`,
`SOURCE-MANIFEST.json` and `SHA256SUMS` sidecars. A checksum downloaded alongside
an untrusted file does not authenticate its publisher.

Verify **before** adding the marketplace. Set the two expected values from that
announcement, then use a fresh directory:

```sh
EXPECTED_MARKETPLACE_COMMIT=REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT
EXPECTED_ZIP_SHA256=REPLACE_WITH_REVIEWED_64_CHARACTER_DIGEST
git clone --no-checkout https://github.com/ToolsEnabled/toolsenabled-plugins.git /absolute/verified-marketplace
git -C /absolute/verified-marketplace checkout --detach "$EXPECTED_MARKETPLACE_COMMIT"
test "$(git -C /absolute/verified-marketplace rev-parse HEAD)" = "$EXPECTED_MARKETPLACE_COMMIT"
curl --fail --location --proto '=https' --proto-redir '=https' --output /absolute/bench-0.3.2.zip https://github.com/ToolsEnabled/toolsenabled-bench/releases/download/v0.3.2/toolsenabled-benchmark-builder-0.3.2.zip
printf '%s  %s\n' "$EXPECTED_ZIP_SHA256" /absolute/bench-0.3.2.zip | sha256sum --check
python3 - /absolute/verified-marketplace "$EXPECTED_ZIP_SHA256" <<'CHECK'
import json, pathlib, sys
catalog = json.loads((pathlib.Path(sys.argv[1]) / '.claude-plugin/marketplace.json').read_text())
entry = next(p for p in catalog['plugins'] if p['name'] == 'toolsenabled-bench')
assert entry['source'] == {
    'source': 'archive',
    'url': 'https://github.com/ToolsEnabled/toolsenabled-bench/releases/download/v0.3.2/toolsenabled-benchmark-builder-0.3.2.zip',
    'sha256': sys.argv[2],
}
CHECK
claude plugin validate --strict /absolute/verified-marketplace
```

Compare the published `SOURCE-PINS.json` sidecar with the actual tag/commit/tree; do
not replace a source commit with a different local commit that has the same tree.
A source-only checkout lacks the generated runtime: the public entry uses the
exact HTTPS release ZIP and its digest. Claude's
[archive source](https://code.claude.com/docs/en/plugins/marketplace-reference#archive-plugin-source)
requires a non-loopback HTTPS URL. Local directory proofs do not establish that
published archive installation has passed.

Only after verification, from the project directory where Bench is wanted:

```sh
claude plugin marketplace add /absolute/verified-marketplace
claude plugin install -s local toolsenabled-bench@toolsenabled --config data_directory=/absolute/private-bench-data
```

Keep automatic marketplace/plugin updates disabled until the new catalog commit
and artifact digests have been reviewed and these checks repeated. The runtime
package contains no npm dependencies, install scripts or dependency locks; its
SDK is bundled. Default installation and startup need no npm command. Build
dependencies stay in the separate source checkout.

`data_directory` is required. Choose an **absolute path** to a private state
folder outside the **whole plugin cache**, including other versions and sibling
plugins. The path guard checks overlap with this installation; it cannot identify
every host's cache layout. Relative paths, `~` paths and folders
that contain or lie inside the plugin installation are refused. The plugin
passes the value through `BENCHMARK_DATA_DIR` as an environment value and starts
Node directly. Spaces are literal path characters; no shell is involved.
Reuse this folder across plugin upgrades to retain projects and evidence.
Choose different folders for simultaneous clients: the data-root lease permits
only one owner, including the dashboard. Local install scope limits the plugin
to this project; starting a client or listing MCP servers may start it.

The workflow is `/toolsenabled-bench:toolsenabled-bench`. It reads current IDs and
revisions, verifies edits, freezes requested checkpoints and inspects retained
reports. Qualification and execution still require confirmation of the exact
study ID and reviewed foreign-study trust. Recorded controls are not model
performance measurements.

For a machine-local override, pass a JSON file through
`claude --settings /absolute/project-options.json`:

```json
{"pluginConfigs":{"toolsenabled-bench@toolsenabled":{"options":{"data_directory":"/absolute/private-bench-data"}}}}
```

Keep machine-specific settings outside shared source control. Existing Codex,
DeepSeek and direct MCP registrations continue to use
`node tools/mcp-config.mjs --client <client>` with an explicit absolute external
`BENCHMARK_DATA_DIR`; they do not depend on Claude's
user_config substitutions.

## Human dashboard and exported studies

Bench has no one-time human-link secret or agent-only dashboard gate. To inspect
this folder in the browser, end the MCP client connection, then start the
reviewed runtime with `BENCHMARK_DATA_DIR` set to that same absolute path and
run `node server/main.mjs`. Open `http://127.0.0.1:4318`. The server prints its
listening address to that terminal. Do not remove another process's active
lease; use a separate folder when both interfaces must run concurrently.

The dashboard and distribution of results are human choices. The MCP
`study.export` tool can also create an export when requested, returning its
relative path and hash; it does not publish or transfer it. Neither the skill
nor the local server provides an OS sandbox for declared study execution.

## Desktop bundle and release metadata

This release provides an MCPB manifest and deterministic packaging tooling.
Native Claude Desktop installation on macOS and Windows still requires
qualification; Linux headless checks do not establish Desktop support. Including
the skill in a bundle does not prove Desktop automatically loads it.

Build tooling uses the exact locked mcpb 2.1.2 CLI offline. Generated bundles,
certificates and all private keys stay outside the plugin/source distribution.
The ordinary ZIP and MCPB contain no Registry server.json. Release tooling
creates that draft separately from the final signed artifact, with its actual
hash and intended release URL. A draft is not a Registry submission or proof
that its URL exists. Production signing, native Desktop, DNS namespace proof,
publication and directory acceptance are separate release gates.

The existing runtime has large files and minified UI assets that can trigger
Anthropic directory review holds. The public `DIRECTORY-HOLDS.md` sidecar inventories the exact artifact's
large files and minified assets, along with the available packaging options.

Support: [support@toolsenabled.ai](mailto:support@toolsenabled.ai).
Privacy: [ToolsEnabled privacy policy](https://toolsenabled.ai/legal/privacy/).

## Reproduce the unsigned bundle

From the full source checkout, copy the exact `tools/mcpb-build/package.json` and lock into an external build
folder using the verified offline npm cache supplied with the build inputs. Run
`npm ci --offline --ignore-scripts --no-audit --no-fund --cache /absolute/cache`
in that folder. Build tooling is not a runtime prerequisite and must not be
installed inside the distributed plugin.

```sh
node /absolute/build-tools/node_modules/@anthropic-ai/mcpb/dist/cli/cli.js validate manifest.json
node tools/package-mcpb.mjs --mcpb-cli /absolute/build-tools/node_modules/@anthropic-ai/mcpb/dist/cli/cli.js --output /absolute/output/a.mcpb
node tools/package-mcpb.mjs --mcpb-cli /absolute/build-tools/node_modules/@anthropic-ai/mcpb/dist/cli/cli.js --output /absolute/output/b.mcpb
```

Compare complete bytes and hashes. The builder uses the same release inventory
as the ZIP, regular file mode 0644 and a build-only fixed Date preload for
2026-01-01 UTC. Plain mcpb 2.1.2 pack uses wall-clock ZIP timestamps. The preload
never runs in the server or signer. Signing follows unsigned comparison and is
not claimed byte-reproducible.

The reference stock mcpb 2.1.2 verifier fails because its PKCS#7 verification is
unimplemented. Retain its actual result; independent CMS verification is a
separate check, not a substitute for native Desktop acceptance or publisher
trust. Development certificates must be CA:FALSE with digitalSignature and
codeSigning usage, never installed into OS trust stores. Private keys stay
outside source, artifacts, logs and transferred evidence.

After production signing and verification, generate metadata separately:

```sh
node tools/registry-draft.mjs --artifact /absolute/output/final-signed.mcpb --url https://github.com/ToolsEnabled/toolsenabled-bench/releases/download/v0.3.2/toolsenabled-bench-0.3.2.mcpb --output /absolute/output/server.json
```

The generator reads the complete `registryDescription` in `release-config.json`;
`--description` explicitly overrides it. Missing, blank or over-100-character
text fails; the generator never shortens it.

The generator hashes supplied bytes but does not verify their signature or
URL existence; the draft says so. Development-only receipts use `--development`.
Validate against the exact 2025-12-11 Registry schema, recheck the production
artifact/hash and published URL, and obtain the owner's DNS namespace proof
before submission. Do not copy server.json into the plugin, ZIP or marketplace.

## Codex compatibility

The Codex compatibility manifest declares its MCP server inline with
`args:["./server/mcp-plugin.mjs"]`, `cwd:"./"` and
`env_vars:["BENCHMARK_DATA_DIR"]`. The installed plugin directory supplies cwd;
Claude-only substitutions are not used. Before starting a Codex session, the
human sets BENCHMARK_DATA_DIR in that process's environment to an absolute
external directory. A missing value fails clearly instead of creating state
in the plugin cache. Use separate state for simultaneous Claude/Codex sessions.
Direct-registration helpers also require that explicit external data path.

Under Codex, the installed plugin forwards only `BENCHMARK_DATA_DIR`. The plugin
is qualified for recorded/offline studies. Provider credentials in the parent shell do not reach
its Codex server. For an authorized HTTP or command collector, use a separate
direct registration from [MCP setup](MCP.md) and explicitly forward each
credential name in the host's private configuration. For Codex, the direct
server entry can use:

```toml
[mcp_servers.bench]
command = "/absolute/path/to/node"
args = ["/absolute/reviewed-bench/server/mcp.mjs"]
env_vars = ["BENCHMARK_DATA_DIR", "EXAMPLE_PROVIDER_KEY"]
```

Set those variables in the process that starts Codex, using your normal secret
manager. Replace the example name with exactly the variable declared by the
study. Do not put secret values in commands, manifests, drafts or evidence.
Disable the plugin's duplicate server while using that direct registration.
The credential forwarding itself does not authorize paid collection.

This configuration follows the qualified loader in packaging standard revision
2.1. General [OpenAI plugin documentation](https://developers.openai.com/plugins/build/plugins)
describes portable manifests too; those substitutions are not evidence for the
legacy inline MCP configuration. The release evidence records the actual loader
version, resolved cwd and tool inventory. No model turn is needed for that check.
