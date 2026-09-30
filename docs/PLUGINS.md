# Portable benchmark plugins

Plugins are trusted, build-time JavaScript modules. They register domain descriptors through `src/benchmark/registry.mjs`. The configured example, `plugins/structured-records.mjs`, supplies a domain and starter while reusing core JSON grading. Lean is an optional runtime plugin with domain-specific compilation and native apparatus.

## Configure and build

`plugins.json` contains two arrays:

- `extensions`: `./`-relative entry paths bundled into the generated composition root. Entries and their local dependencies must resolve within this project directory.
- `runtime`: descriptors for modules already in `src/benchmark/`. Each declares `module`, its named `export`, and `files`, the complete runtime module/dependency inventory. File names are flat `.mjs` or `.py` names; the entry itself must be included. Entries may not collide with core inventory files.

The shipped configuration includes the structured-records extension and the Lean runtime descriptor. To build with structured records and the generic core only, use:

```json
{
  "extensions": ["./plugins/structured-records.mjs"],
  "runtime": []
}
```

An empty `extensions` array also removes structured records. To restore Lean, restore its complete runtime entry and file inventory from the shipped `plugins.json`. Legacy array-only configuration is accepted as an extension list with no runtime plugins; it no longer implies a Lean registration.

For a new extension:

1. Add a local `.mjs` entry, conventionally beneath `plugins/`.
2. Import shared contracts from `../src/benchmark/*.mjs`.
3. Call `registerBenchmark` with an ID, label, domain list, matcher and the capabilities the domain needs.
4. Add its path to `plugins.json` under `extensions`.
5. Run `npm run build`, restart the application, and freeze a new study.
6. Export it and test `verify`, `qualify`, `run`, and `analyze` in a fresh process using only the extracted study.

Build generates `src/benchmark/plugins.mjs`, `runtime-inventory.mjs`, the browser runtime-source map, and application assets. Changing the configuration requires rebuilding and restarting the host. Existing frozen studies retain their original runtime and plugin package.

## Descriptor capabilities

Most domains need only a subset of the descriptor. Core APIs select capabilities by the declared study domain; native domain algorithms do not live in generic wrappers.

| Capability | Purpose |
| --- | --- |
| `domains`, `matches`, `profiles` | Domain selection and supported study profiles. |
| `gradingKinds`, `extraction`, `environmentKeys` | Grading validation, response extraction and declared environment fields. |
| `taskSemantics.prepare`, `finalize`, `deriveExpected` | Domain compilation and expected-answer derivation. |
| `authoring`, `page`, `starters` | Editor fields, task views and explicit starter construction. |
| `audit.referencePaths`, `verifyReferenceObservation` | Domain-specific retained reference artifacts and observation checks. |
| `nativeEvidence` | Native evidence paths, control materialization, control/attempt/journal verification. |
| `requirements` | Domain requirement interpretation, task matching, input validation, native preparation and control contracts. |
| `nodeHandlers.grade`, `recover`, `qualify` | Node-only handlers declared as `{ module, export }` within the pinned runtime. |
| `readinessProfile`, `validateInformationGrade`, `report` | Domain readiness decisions and report details. |
| `provenance`, `legacyProvenance`, `exportNotes` | Current and historical attribution and exported guidance. |
| `projectFiles`, `assertExportable` | Additional portable files and export admission checks. |

Use `lean-plugin.mjs` as the complete optional-domain example and `plugins/structured-records.mjs` as a smaller extension. Methods that reach other modules should be callback thunks, for example `prepare: (...args) => domainTasks.prepare(...args)`. Do not eagerly call imported helpers or spread cyclic module namespaces during registration. A starter's `create` callback constructs it only when selected.

Module initialization must be browser-compatible and deterministic. Do not fetch data, spawn processes, or collect model outputs while registering. Node-only work belongs in the declared handlers, whose modules and dependencies must be carried in the runtime inventory. Registration does not establish scientific validation for a custom endpoint or isolation for arbitrary plugin code.

## What an exported study carries

Extension code and local dependencies are bundled into `plugins.mjs`. Imports remain external only when they resolve to actual files in the configured pinned runtime, so the plugin and core share one registry. A similarly named helper outside that inventory is bundled. Schema 4 includes the core runtime plus configured runtime plugin files, making Lean optional without weakening the export contract.

The generated composition root records extension entry paths, SHA-256 hashes of their source dependencies, runtime entry modules, and the SHA-256 of the bundled payload. It binds registrations created by that package. Every new export includes `plugins/manifest.json`, identifying required benchmark plugins, the package hash, and complete frozen runtime hashes. `verify` reconstructs that inventory from the pinned package and requires an exact match. Changing the inventory and rehashing the outer file manifest does not make the altered plugin inventory valid.

Importing a plugin only in the authoring or test process is insufficient. Export refuses a required registration absent from the packaged runtime, including one from a different build. Add the entry, rebuild, restart, and freeze again. Older exports created before this inventory keep their original format and runtime; they are not rewritten to schema 4.

## Regression coverage and limits

The SQL fixture in `tools/test/fixtures/research-benchmark-third-party-plugin.mjs` covers the extraction gap where a domain ran in-process but disappeared from the exported CLI. Its registration alone is refused for export. The fresh-process test bundles it through `tools/plugin-bundle.mjs`, then runs `verify`, `qualify`, `run`, and `analyze` from the exported files. It also checks dependencies, changed payloads, and missing or edited plugin inventories.

Core independence has two checks: `npm run check:core` rejects active domain dependencies with zero allowed exceptions, and integration tests exercise generic and SQL export workflows while Lean/trading files are physically absent. Historical inventories and citation metadata retain legacy names as data.

Dynamic user-installed extensions and a plugin sandbox are outside this release. Rebuilding a trusted plugin package is an explicit development operation.
