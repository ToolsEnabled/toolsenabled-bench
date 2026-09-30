// Recorded apparatus contracts only: these tests execute no model or native engine.
import assert from "node:assert/strict";
import test from "node:test";
import { compileTask } from "../src/benchmark/tasks.mjs";
import { leanStarter, interpretLean } from "../src/benchmark/lean.mjs";
import { operationalStarter } from "../src/benchmark/trading-catalog.mjs";
import { simulateTradingMarket } from "../src/benchmark/trading-market.mjs";
import {
  runtimeFilesForVersion,
  STUDY_VERSION,
} from "../src/benchmark/study-schema.mjs";
import {
  nativeControlContract,
  requirementInterpretation,
} from "../src/benchmark/requirements.mjs";
import {
  matchesRequirementTask,
  validRequirementInput,
  validateNativePreparationPlan,
} from "../src/benchmark/lean-requirements.mjs";
import { nativeEvidencePaths } from "../src/benchmark/lean-audit.mjs";

test("the Lean plugin retains synchronous observations, activation and task-only helper compatibility", async () => {
  const spec = leanStarter(),
    task = await compileTask(spec, spec.tasks[0], { requireReview: false });
  const result = interpretLean(task.compiled.semantic, task.input);
  const projected = requirementInterpretation(
    task,
    { requirement: { path: "root/strategy" } },
    result,
  );
  assert.equal(matchesRequirementTask(task), true);
  assert.equal(
    matchesRequirementTask({ compiled: { semantic: { kind: "sum" } } }),
    false,
  );
  assert.deepEqual(projected.observation, task.expected);
  assert.deepEqual(projected.activation.transitions, { buy: 1, sell: 1 });
  assert.equal(nativeControlContract(task).profile, "synchronous-v1");
  assert.equal(validRequirementInput(task, task.input), true);
  assert.equal(validRequirementInput(task, { ...task.input, bars: [] }), false);
});

test("the Lean plugin retains operational observation and per-occurrence counters", async () => {
  const spec = await operationalStarter(),
    task = await compileTask(spec, spec.tasks[0], { requireReview: false });
  const result = simulateTradingMarket(task.compiled.operational, task.input);
  const target = {
    requirement: task.compiled.checklist.find(
      (row) => row.role === "buy_process",
    ),
  };
  assert.ok(target.requirement);
  const projected = requirementInterpretation(task, target, result);
  assert.equal(matchesRequirementTask(task), true);
  assert.deepEqual(projected.observation, task.expected);
  // Process occurrences record the submitted action; predicate evaluations
  // belong to the separate buy-reason occurrence.
  assert.equal(projected.activation.counters.actions, 1);
  assert.equal(projected.activation.counters.evaluated, 0);
  assert.equal(nativeControlContract(task).profile, "operational-v1");
  assert.equal(validRequirementInput(task, task.input), true);
});

test("native evidence uses each schema inventory and native preparation retains cleanup budgets", () => {
  for (const schemaVersion of [3, STUDY_VERSION]) {
    const inventory = runtimeFilesForVersion(schemaVersion);
    const project = {
      version: schemaVersion,
      sha256: "a".repeat(64),
      tasks: [],
      schedule: [],
      spec: {
        schemaVersion,
        domain: "lean-bench",
        inputs: [],
        protocol: { grading: { kind: "lean-python" } },
        runtimeSources: Object.fromEntries(
          inventory.map((file) => [file, "b".repeat(64)]),
        ),
      },
    };
    const plan = nativeEvidencePaths(project, []);
    assert.deepEqual(
      plan.files.map((file) => file.path),
      inventory,
    );
    assert.equal(plan.limits.fileBytes, 16 * 1024 * 1024);
    delete project.spec.runtimeSources[inventory[0]];
    assert.throws(
      () => nativeEvidencePaths(project, []),
      /complete pinned runtime/,
    );
  }
  const spec = {
    schemaVersion: STUDY_VERSION,
    domain: "lean-bench",
    protocol: { grading: { kind: "lean-python" } },
    requirementPlan: { selectedInput: { policy: "require-composition" } },
    nativePreparationPlan: {
      version: 1,
      coverage: "all-selected-readings-occurrences-and-probes",
      rationale: "Recorded control roster for contract validation.",
      referenceReplicates: 3,
      mutantReplicates: 1,
      budgets: {
        maxNativeExecutions: 100,
        executionTimeoutMs: 120000,
        attemptTimeoutMs: 150000,
        maxDurationMs: 3600000,
      },
    },
  };
  validateNativePreparationPlan(spec);
  spec.nativePreparationPlan.budgets.attemptTimeoutMs = 149999;
  assert.throws(() => validateNativePreparationPlan(spec), /30000 ms/);
});
