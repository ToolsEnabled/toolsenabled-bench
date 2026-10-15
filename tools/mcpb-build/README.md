# Optional Desktop bundle build tools

This separate package is only for maintainers preparing an unsigned MCPB for
later native Desktop qualification. The normal root `npm ci`, dashboard, stdio
MCP server and runtime ZIP do not install or carry these dependencies. Bench
0.3.3 publishes no MCPB and claims no native Desktop acceptance.

The vendor CLI stays pinned to `@anthropic-ai/mcpb` 2.1.2. Its legacy editor chain
pins an older `tmp` range, so this package uses npm's exact `tmp: 0.2.7` override.
That patched release refuses unsafe prefix/postfix paths. The affected editor's
constructor/read/cleanup API and Bench's actual unsigned `pack` invocation were
checked with the override. `npm ci --ignore-scripts` in this folder reproduces
the locked development toolchain; this is separate from the product build.

## Remaining upstream advisory

`node-forge` has an unpatched RSA PKCS#1 v1.5 signature-verification issue:
[GHSA-86w9-cpqp-85rv / CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
The advisory lists no patched release as of this release's check. This folder's
`npm audit` consequently reports the issue for `node-forge` and its parent MCPB
tool. It is not a zero-alert dependency tree.

Bench's `tools/package-mcpb.mjs` invokes only `--version` and unsigned `pack` on
its own checked staging files. It does not verify received signatures. Do not
use this optional CLI to verify untrusted bundles while that advisory remains
unfixed. No third-party crypto patch or signature-verification workaround is
included here. Native Desktop and signing/distribution qualification remain
separate work. The application's own root dependency audit is separate and
must not be used as evidence about this nested development package.
