import test from "node:test";
import { gunzipSync } from "node:zlib";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../server/main.mjs";
import {
  RUNTIME_FILES,
  bindRuntimeSources,
  freezeStudy,
} from "../src/benchmark/study.mjs";
import {
  genericStarter,
  newExperimentDraft,
} from "../src/benchmark/starters.mjs";
import { projectFiles } from "../src/benchmark/export.mjs";
import { starterById } from "../src/benchmark/registry.mjs";
import { sha256 } from "../src/benchmark/prompts.mjs";
const sources = Object.fromEntries(
  await Promise.all(
    RUNTIME_FILES.map(async (f) => [
      f,
      await readFile(new URL("../src/benchmark/" + f, import.meta.url), "utf8"),
    ]),
  ),
);
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "benchmark-standalone-"));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = async (path, body, method = body ? "POST" : "GET") => {
    const response = await fetch(app.origin + "/api/" + path, {
      method,
      headers: {
        "x-benchmark-token": app.token,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, value: await response.json() };
  };
  return { ...app, request, dataDir };
}
async function until(fn, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Timed out waiting for the retained run.");
}

test("local projects persist unfinished editor text and reject stale writes", async (t) => {
  const { request, projects, dataDir } = await fixture(t);
  const info = (await request("info")).value;
  assert.equal(info.version, JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version);
  const p = (await request("projects", { title: "Draft" })).value;
  const draft = {
    spec: newExperimentDraft(genericStarter()),
    editors: { wording: "Unfinished {{" },
    pending: ["bundle"],
    attachments: {},
  };
  assert.equal(
    (await request("projects/" + p.id, { draft, revision: 0 }, "PUT")).status,
    200,
  );
  const stale = await request(
    "projects/" + p.id,
    { draft: { ...draft, editors: {} }, revision: 0 },
    "PUT",
  );
  assert.equal(stale.status, 409);
  assert.deepEqual((await request("projects/" + p.id)).value.draft, draft);
  assert.equal(
    JSON.parse(
      await readFile(join(dataDir, "projects", p.id + ".json"), "utf8"),
    ).revision,
    1,
  );
  assert.equal((await projects.list()).length, 1);
});
test("local API requires its token and rejects cross-origin requests", async (t) => {
  const app = await fixture(t);
  assert.equal((await fetch(app.origin + "/api/projects")).status, 403);
  assert.equal(
    (
      await fetch(app.origin + "/api/projects", {
        headers: {
          "x-benchmark-token": app.token,
          origin: "https://unrelated.invalid",
        },
      })
    ).status,
    403,
  );
  const status = await new Promise((done, reject) => {
    const req = httpRequest(
      app.origin + "/api/projects",
      {
        headers: { "x-benchmark-token": app.token, host: "unrelated.invalid" },
      },
      (res) => {
        res.resume();
        done(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});
test("configured plugin survives a real exported CLI lifecycle and produces recoverable evidence", async (t) => {
  const { request, runs } = await fixture(t);
  const p = (await request("projects", { title: "Plugin export test" })).value;
  const spec = await starterById("structured-records").create();
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  const files = await projectFiles(project, sources);
  const created = await request("runs", { projectId: p.id, files });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  const id = created.value.id;
  const record = await until(async () => {
    const r = await runs.read(id);
    return ["completed", "failed"].includes(r.status) && r;
  });
  assert.equal(record.status, "completed", record.log);
  assert.deepEqual(
    record.history.map((h) => [h.command, h.code]),
    [
      ["verify", 0],
      ["qualify", 0],
      ["run", 0],
      ["analyze", 0],
    ],
  );
  const evidence = (await request("runs/" + id + "/evidence")).value;
  assert.equal(evidence.projectSha256, project.sha256);
  assert.equal(evidence.summary.completed, 4);
  assert.equal(
    evidence.summary.groups.find((g) => g.condition === "reference")
      ?.primaryRate,
    1,
  );
  assert.equal(
    evidence.summary.groups.find((g) => g.condition === "wrong-field")
      ?.primaryRate,
    0,
  );
  const report = await runs.artifact(id, "report.html");
  assert.match(report.toString(), /recorded/i);
  assert.ok((await runs.package(id)).length > 10000);
  assert.equal((await request("runs/" + id + "/resume", {})).status, 400);
});
test("local execution refuses runtime substitution before spawning a process", async (t) => {
  const { request, runs } = await fixture(t);
  const p = (await request("projects", {})).value;
  const project = await freezeStudy(
    await bindRuntimeSources(
      newExperimentDraft(genericStarter(), {
        purpose: "recorded-diagnostic",
        initializePopulation: true,
      }),
      sources,
    ),
  );
  const files = await projectFiles(project, sources);
  files["cli.mjs"] += '\nthrow new Error("substituted");\n';
  const response = await request("runs", { projectId: p.id, files });
  assert.equal(response.status, 400);
  assert.match(response.value.error, /different runtime/);
  assert.equal((await runs.list()).length, 0);
});
test("cancellation stops an exported command collector and retains its interrupted journal", async (t) => {
  const { request, runs } = await fixture(t);
  const p = (await request("projects", {})).value;
  const spec = newExperimentDraft(genericStarter(), {
    purpose: "apparatus-development",
    initializePopulation: true,
  });
  const text =
    'process.stdin.resume(); setTimeout(() => process.stdout.write(JSON.stringify({output:"5"})),30000);\n';
  spec.inputs = [{ path: "slow.mjs", sha256: await sha256(text) }];
  spec.conditions[0].adapter = {
    kind: "command",
    command: process.execPath,
    args: ["slow.mjs"],
  };
  const project = await freezeStudy(await bindRuntimeSources(spec, sources));
  const files = await projectFiles(project, sources, { "slow.mjs": text });
  const result = await request("runs", { projectId: p.id, files });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  await until(async () => {
    const r = await runs.read(result.value.id);
    try {
      return (
        r.status === "running" &&
        (await runs.artifact(r.id, "attempts.jsonl"))
          .toString()
          .includes("started")
      );
    } catch {
      return false;
    }
  });
  assert.equal(
    (await request("runs/" + result.value.id + "/cancel", {})).status,
    200,
  );
  const record = await until(async () => {
    const r = await runs.read(result.value.id);
    return r.status === "cancelled" && r;
  });
  assert.equal(record.status, "cancelled");
  assert.equal(runs.children.has(record.id), false);
  const journal = (await runs.artifact(record.id, "attempts.jsonl")).toString();
  assert.match(journal, /started/);
  assert.match(journal, /cancel|interrupt/i);
});

test("historical citations retain the inherited template; freezing does not claim prospective registration", async () => {
  const { templateCitation, GENERATOR, verifyProject } = await import(
    "../src/benchmark/study.mjs"
  );
  const { researchReportFiles } = await import("../src/benchmark/report.mjs");
  const { runStudy } = await import("../src/benchmark/runner.mjs");
  const spec = await bindRuntimeSources(
    newExperimentDraft(genericStarter(), {
      purpose: "recorded-diagnostic",
      initializePopulation: true,
    }),
    sources,
  );
  const project = await freezeStudy(spec),
    citation = await templateCitation(project);
  assert.equal(citation.template.generator.name, GENERATOR.name);
  const old = JSON.parse(gunzipSync(await readFile(new URL(
    "../tools/test/fixtures/research-benchmark-endpoints-project.json.gz", import.meta.url,
  ))));
  await verifyProject(old);
  const oldCitation = await templateCitation(old);
  assert.equal(
    oldCitation.template.title,
    "ToolsEnabled Research Benchmark Template",
  );
  assert.equal(oldCitation.template.version, "2.0.0");
  const report = await researchReportFiles(
    project,
    (await runStudy(project)).events,
  );
  assert.match(
    report["report.html"],
    /does not establish that the plan was specified before outcomes were observed/,
  );
  assert.doesNotMatch(
    report["report.html"],
    /fixes the analysis before the data exist/,
  );
});


test("missing project reads give a repairable message without a local path", async (t) => {
  const { request, dataDir } = await fixture(t);
  const project = (await request("projects", { title: "Removed locally" })).value;
  await rm(join(dataDir, "projects", project.id + ".json"));
  const missing = await request("projects/" + project.id);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.value, { error: "Project file missing or unreadable." });
});
