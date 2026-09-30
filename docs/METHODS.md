# Methods and evidence boundaries

The instrument supports a chain from an investigator's specification to an inspectable report. Each stage needs an explicit scope.

## Inspecting received studies

**Launching a received `cli.mjs` executes the study's JavaScript and plugin imports before verification.** Hash agreement does not authenticate that code or its author. Inspect with an already trusted installation:

```sh
node /path/to/bench/src/benchmark/cli.mjs verify --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs status --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs analyze --project /path/to/study
node /path/to/bench/src/benchmark/cli.mjs reference --project /path/to/study
```

These commands do not execute study collectors, custom graders or archived runtime modules. An installed compiler reconstructs a project only when its runtime pins match; otherwise inspection checks digests and retained evidence. Reports and reference bundles are derived artifacts. Custom scores remain retained journal values with their declared grader path/hash and available original process receipts. A consistency check against recorded process output does not authenticate the original producer or establish an independent replication.

Fresh custom-grader comparison requires the explicit `regrade` action through a trusted CLI. It requires a matching installed runtime and uses the verified installed module host; successful comparisons write a separate `results/custom-grade-verification.json` without rewriting the journal. Code runs with the current user's filesystem/network authority, in the study directory, with present `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP` and `TMP` values. Time and output bounds are not an OS sandbox. `run` and `qualify` also execute declared apparatus and may invoke external services or programs.

The local service launches its installed CLI and independently checks the complete installed core/configured-plugin source inventory before submission or resume can spawn work. This execution admission does not establish scientific validity or permission to run an arbitrary study.

## What each artifact establishes

| Artifact | Establishes | Does not establish by itself |
| --- | --- | --- |
| Prompt composition and source map | The authored structure and exact rendered text ranges | Natural-language equivalence or construct validity |
| Selection recipe and ledger | The recorded pool, seed, quotas, selected IDs and exclusions | Representativeness of a broader task population |
| Frozen manifest and source hashes | Content identity and the declared runtime | Honesty, independent execution, or authenticated provider identity |
| Qualification receipt | Its listed controls and their recorded outcomes | Validity outside those controls or automatic scientific approval |
| Attempt journal | Retained starts, completions, failures and related evidence | Outcomes absent from the journal or independent sampling units |
| Analysis and report | The specified calculations on retained evidence | Causal conclusions without a suitable design |

## Before collection

Declare the research question, target population, task families, development/held-out distinction, sampling rationale, conditions, primary outcome and denominator, attempts/retries, stopping budgets, and analysis plan. Decide how task variants and replicates are dependent. A family bootstrap assumes appropriate independent families; a collection of variants from one task does not create that independence.

Apply pending editor fields, inspect assembled prompts and any admissible readings, and freeze the protocol. Bundle reviews and investigator approvals remain explicit actions. The application never fills them in on the investigator's behalf.

## Execution purposes

Recorded diagnostics check saved responses and authored references. Apparatus development exercises unfinished instruments with its declared limitations. Counted experiments must satisfy their registered execution profile and required controls. The local application preserves the existing distinctions and refusals.

Current admitted answer-collection profiles support recorded replay and bounded HTTPS requests, with explicit prompt workflows without opaque external tools. Command/module collectors require an appropriate execution contract for counted experiments. The generated provider-CLI pipeline retains apparatus-development scope where applicable. Resource-action experiments use bounded synthetic maps. Native Lean programs require pinned execution dependencies and retain their native-admission limitations.

## Interpretation and reproduction

Report all scheduled trials and distinguish transport failures, interrupted attempts, incomplete responses, refusal, clarification, malformed answers, and graded outcomes. Missing usage or timing is unavailable, not zero. Requested model settings are distinct from adapter-reported metadata. Reported identity is not provider authentication.

Retain the exported package, original evidence, qualification and verification receipts, and analysis files. Use a separately trusted copy of the frozen runtime when regenerating original report bytes; a later trusted installation can inspect retained evidence while identifying runtime differences. Byte identity is meaningful for deterministic transformations of the same retained evidence. Fresh model collection is stochastic and cannot generally promise the same responses.

## Scope of this release

The release includes apparatus regression tests, authored recorded controls and authoring reference material. The original 0.1.0 arithmetic export is an immutable compatibility control in the source test package. Historical live CLI/model run outputs and derived performance figures are excluded from public packages. No empirical model evaluation or peer-reviewed result is supplied. Generality beyond the supplied examples, independent oracle validation, user-study improvements in authoring accuracy, and cross-machine reproducibility remain research questions requiring their own evidence.

The paper should distinguish software correctness, artifact reproducibility, benchmark validity, and findings about model behavior. A software test passing is evidence for the tested contract, not a substitute for those other evaluations.
