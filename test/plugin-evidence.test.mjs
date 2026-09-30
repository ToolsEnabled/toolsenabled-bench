import assert from "node:assert/strict";
import test from "node:test";
import {
  registerBenchmark,
  registeredBenchmarks,
  resetRegistry,
} from "../src/benchmark/registry.mjs";
import {
  auditReferencePaths,
  nativeEvidencePaths,
  materializeNativeControl,
  verifyNativeAttemptEvidence,
} from "../src/benchmark/audit.mjs";
import {
  validateNativePreparationPlan,
  compileNativePreparationPlan,
  nativeControlContract,
  requirementInterpretation,
} from "../src/benchmark/requirements.mjs";

function isolated(t, descriptor) {
  const previous = registeredBenchmarks();
  resetRegistry();
  t.after(() => {
    resetRegistry();
    for (const entry of previous) registerBenchmark(entry);
  });
  registerBenchmark({
    id: "record-controls",
    domains: ["record-controls"],
    matches: (spec) => spec?.domain === "record-controls",
    ...descriptor,
  });
}
const project = () => ({
  spec: {
    domain: "record-controls",
    runtimeSources: {},
    inputs: [],
    protocol: { grading: { kind: "json" } },
  },
});

test("a benchmark supplies its own reference paths and native evidence capabilities", async (t) => {
  isolated(t, {
    audit: {
      referencePaths: () => [
        {
          key: "record/control.json",
          location: "results",
          path: "control.json",
        },
      ],
    },
    nativeEvidence: {
      paths: () => ({ profile: "record-evidence" }),
      materializeControl: (_project, id) => ({ id }),
      verifyAttempt: (input) => ({ verified: input.attempt.id }),
    },
  });
  assert.deepEqual(auditReferencePaths(project(), []), [
    { key: "record/control.json", location: "results", path: "control.json" },
  ]);
  assert.deepEqual(nativeEvidencePaths(project(), []), {
    profile: "record-evidence",
  });
  assert.deepEqual(await materializeNativeControl(project(), "control-one"), {
    id: "control-one",
  });
  assert.deepEqual(
    await verifyNativeAttemptEvidence({
      project: project(),
      attempt: { id: "one" },
    }),
    { verified: "one" },
  );
});

test("requirement helpers dispatch to declared control and interpretation contracts", async (t) => {
  const called = [],
    task = { compiled: { fixture: "record-control" } };
  isolated(t, {
    requirements: {
      matchesTask: (candidate) =>
        candidate.compiled?.fixture === "record-control",
      nativeControlContract: () => ({ profile: "record-controls-v1" }),
      interpretation: (_task, _target, result) => ({
        observation: result.value,
        activation: {},
      }),
      validateNativePreparationPlan: () => called.push("validate"),
      compileNativePreparationPlan: () => ({ format: "record-control-plan" }),
    },
  });
  const spec = { ...project().spec, nativePreparationPlan: { version: 1 } };
  validateNativePreparationPlan(spec);
  assert.deepEqual(called, ["validate"]);
  assert.deepEqual(await compileNativePreparationPlan(spec, {}), {
    format: "record-control-plan",
  });
  assert.deepEqual(nativeControlContract(task), {
    profile: "record-controls-v1",
  });
  assert.deepEqual(requirementInterpretation(task, {}, { value: 7 }), {
    observation: 7,
    activation: {},
  });
});

test("generic studies do not inherit a fallback benchmark evidence contract", (t) => {
  isolated(t, {
    fallback: true,
    audit: {
      referencePaths: () =>
        assert.fail("Generic study must not acquire fallback evidence"),
    },
    nativeEvidence: {
      paths: () =>
        assert.fail("Generic study must not acquire fallback evidence"),
    },
  });
  const generic = project();
  generic.spec.domain = "generic";
  assert.deepEqual(auditReferencePaths(generic, []), []);
  assert.throws(() => nativeEvidencePaths(generic, []), /plugin|capability/i);
  assert.equal(validateNativePreparationPlan(generic.spec), undefined);
});

test("plugin reference paths retain the core path validation", (t) => {
  isolated(t, {
    audit: {
      referencePaths: () => [
        { key: "../outside", location: "results", path: "../outside" },
      ],
    },
  });
  assert.throws(() => auditReferencePaths(project(), []), /inside/);
});
