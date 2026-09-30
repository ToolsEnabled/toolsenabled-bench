# Contributing

Use Node.js 22.19 or later, npm, and Python 3 for development tests. In the full source checkout:

```sh
npm ci
npm run build
npm test
npm run check:core
```

The inherited UI regression suites use a DOM stand-in and may take several minutes. Browser acceptance uses `npm run test:browser` after installing Playwright Chromium. Check [docs/REVIEW.md](docs/REVIEW.md) for the current browser result and launch configuration. The prebuilt runtime ZIP omits development tests and fixtures.

Keep compiler, runtime and reporting code shared between browser and CLI. Treat draft editing, freezing, collection and read-only archive inspection as distinct operations. Imported evidence must bind to its original project. Preserve pending fields and the single replacement Undo across saves and reloads. Refuse conflicting revisions, keep edits after failed reads or writes, and prevent delayed save responses from clearing newer edits.

The generic core must have zero active Lean/trading imports, module references or domain identifiers. `npm run check:core` enforces that boundary; only historical inventories and citation records preserve legacy names as data. Domain algorithms belong in optional plugin modules reached through descriptor capabilities. Test generic and third-party workflows with the optional domain files absent.

Install trusted extensions through `plugins.json`, rebuild, and test the exported CLI in a fresh process. Carry every required source dependency and verify the plugin inventory. Do not rely on a registration side effect in the authoring process. Keep registration deterministic and defer cyclic module work through callback thunks. Declare Node-only handlers through pinned runtime modules. See [docs/PLUGINS.md](docs/PLUGINS.md).

Runtime changes move source identities. Review export-baseline diffs, document intentional identity or behavior changes, and regenerate baselines with the supplied tools. A green updated snapshot alone is insufficient: retain behavioral tests of the affected contract. Preserve the original 0.1.0 archive fixture and its citation/runtime identity. Schema transitions must keep an explicit inspection and compatibility path; see [docs/BASELINE-MIGRATION.md](docs/BASELINE-MIGRATION.md).

Methodological changes need a clear statement of the estimand, population, dependence assumptions and limitations. Keep recorded controls, apparatus development and admitted collection distinguishable. Never silently supply investigator approval, turn missing observations into zeros, or classify a content hash as independent prospective registration. Example responses are authored recorded controls, not live model-result claims.

Host services belong behind the editor's storage, submission, download and navigation callbacks. This product has no account dependency. Future ToolsEnabled Fleet integration requires a separate host adapter; do not import Bench/Lean-Bench code or defaults into Fleet or add Fleet services to the benchmark core.

`npm run release` rebuilds the app and creates the reproducible ZIP and checksum. Packaging uses fixed metadata and sorted paths, excludes user data and dependency installations, and verifies configured plugin source closure. Verify the extracted archive with `node tools/release.mjs --verify`; serve it offline with `node server/main.mjs`, bound only to `127.0.0.1`.
