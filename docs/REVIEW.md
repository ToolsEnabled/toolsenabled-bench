# ToolsEnabled Bench 0.2.0 beta — review and artifact identity

ToolsEnabled Bench is a standalone local application, distributed under the MIT License and separate from ToolsEnabled Fleet. Its package and frozen generator retain the name ToolsEnabled BenchMark Builder. The service binds only to `127.0.0.1`.

## Executable-study trust boundary

**A received study's `cli.mjs` executes its JavaScript and plugin imports before it can verify anything.** A self-contained checksum cannot authenticate the checking code. Use an already trusted Bench installation for inspection:

```sh
node /path/to/bench/src/benchmark/cli.mjs verify --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs status --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs analyze --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs reference --project /path/to/study
```

These commands read retained data without executing custom collectors, graders or archived runtime modules. Matching runtime pins permit reconstruction with the installed compiler; foreign runtimes receive digest and retained-evidence inspection. Derived reports and reference bundles may be written. Retained custom scores are labelled as not re-executed and carry their frozen grader identity and available original process evidence.

`regrade --project /path/to/study` is a distinct execution action. It first requires a complete matching installed runtime, then uses the verified installed module host to compare fresh custom-grader output with the retained scores. A successful comparison writes a separate `results/custom-grade-verification.json`; the original journal remains unchanged. `run` and `qualify` also authorize declared code execution. These processes use the current user's filesystem/network authority; duration and output bounds are not an OS sandbox. Regrading inherits only the present `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP` and `TMP` values and runs in the study directory.

The local service starts its installed CLI with `--project` pointing to the retained study directory. On both submission and resume it independently derives the complete core/configured-plugin runtime inventory from the installed build, checks exact source pins and supplied bytes, and reconstructs the project before spawning. A submitted optional-file list cannot define this admission boundary.

The regression scope includes benign grader call counters and refusal to spawn during inspection, foreign-runtime execution refusal, installed-host regrading, incomplete runtime admission, literal imported role rendering, and removal of embedded private documents. The matching release receipts identify which checks actually ran and their results.

## Release evidence

Release sidecars distributed beside the source and runtime archives bind checks to exact artifacts:

| Sidecar | Purpose |
|---|---|
| `SOURCE-MANIFEST.json` | Identifies the reviewed source snapshot, included files, hashes and recorded provenance. |
| `VERIFICATION.json` | Records the exact source commit, toolchain, commands, exit results, test counts, browser acceptance, archive extraction checks and reproducibility comparison. |
| `SHA256SUMS` | Identifies the distributed files by SHA-256. |

Use these matching records for final source identifiers, test counts and hashes. They are external release receipts so the source does not need to embed its own final commit or archive hash. A result applies only to the inputs and artifacts named in its receipt. A changed source, dependency, notice or payload requires refreshed evidence.

The runtime archive is named `toolsenabled-benchmark-builder-0.2.0.zip`. After checking its checksum against the matching release sidecar, extract it and run `node tools/release.mjs --verify`. The extracted `RELEASE-MANIFEST.json` checks its inventoried files. Hashes establish artifact identity, not publisher authentication.

## Public source and reproducibility

The public source and runtime package exclude private owner coordination and research documents, including documents formerly embedded in optional Lean metadata. Authorship, retained license texts and the source provenance of included reference material and authored controls remain separately recorded. Historical live CLI/model run outputs and derived performance figures are excluded. The frozen generator name is unchanged.

Reproduce source checks with Node.js 22.19 or later, npm and Python 3 for interpreter tests:

```sh
npm ci
npm run build
npm test
npm run check:core
```

For release reproducibility, build and package the same committed source in two clean directories using the same locked dependencies and recorded toolchain. Compare complete ZIP bytes and hashes, independently check archive CRCs/extraction, verify the extracted manifest, and exercise the local recorded-control lifecycle. `VERIFICATION.json` reports the actual results and environment. These checks do not establish reproducibility on every platform or toolchain.

## Browser acceptance scope

Browser acceptance exercises both worked UI examples, freezing and exported CLI runs, pending fields during evidence inspection, save/reload, replacement Undo after reload, retained run identity, Methods and mobile layout. The release's `VERIFICATION.json` records the exact browser/tool versions, viewports, results and error counts.

To repeat browser checks in a suitable local development environment, install the pinned dependencies and a supported Playwright Chromium build, then run:

```sh
npm ci
npm run build
npx playwright install chromium
npm run test:browser
```

Use an isolated local data directory for review. Environment-specific browser launch settings belong in the test environment's own record; they are not a universal setup requirement.

## Local review journey

1. Open **A small, complete study** and inspect its two arithmetic tasks and authored recorded responses.
2. Review the composition, protocol, analysis plan and explicit execution purpose.
3. Freeze and run locally. Inspect the immutable package, process log and retained report in **Local runs**.
4. Confirm unfinished editor fields survive evidence inspection and save/reload.
5. Replace a draft, save and reload it, then use the retained replacement Undo.
6. Repeat the lifecycle with **Structured record extraction** to exercise a packaged domain plugin.

## Evidence provenance and limits

The public runnable examples and retained-response regression fixtures use authored recorded controls, including the preserved original 0.1.0 arithmetic export. Authoring libraries provide prompt snippets and reference code, not empirical model results. Historical live CLI/model run outputs and their derived performance figures are excluded from the public source and runtime packages. The immutable original 0.1.0 fixture is retained only in the source test package for compatibility; it is excluded from the runtime ZIP. Its historical runtime comments and hashes are preserved without treating those comments as current execution authority.

No new live model campaign or native LEAN campaign was performed for this release qualification. Passing software checks does not establish an independent methodology audit, a scientifically qualified benchmark, general tool-use or multi-agent performance, prospective registration or peer review. Native and command-collector admission limits remain in force. See [Methods](METHODS.md) and [Compatibility](BASELINE-MIGRATION.md).
