import {
  createBenchmarkBuilder,
  downloadBenchmark,
} from "../research-benchmark.js";
import { genericStarter, newExperimentDraft } from "../benchmark/starters.mjs";
import { starterById } from "../benchmark/registry.mjs";
import { createProjectSession } from "./project-session.js";
import "./style.css";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const token = $('meta[name="bench-token"]').content;
async function api(path, options = {}) {
  const response = await fetch("/api/" + path, {
    ...options,
    headers: {
      "x-benchmark-token": token,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Request failed.");
  }
  return response.json();
}
async function download(path, name) {
  const response = await fetch("/api/" + path, {
    headers: { "x-benchmark-token": token },
  });
  if (!response.ok) throw new Error((await response.json()).error);
  downloadBenchmark(name, await response.blob(), "application/octet-stream");
}
const steps = [
  [
    "library",
    "Snippets",
    "Reusable language",
    "Write the smallest pieces of your task. Give each snippet a clear role and a version.",
  ],
  [
    "compose",
    "Composition",
    "Assemble a task",
    "Combine snippets with explicit inputs, references, and routing.",
  ],
  [
    "nesting",
    "Nesting",
    "Build structure",
    "Reuse compositions inside other compositions. Inspect the exact assembled prompt.",
  ],
  [
    "variance",
    "Omissions & variants",
    "Control what changes",
    "Compare selected omissions and retain the provenance of every variant.",
  ],
  [
    "corpus",
    "Task set",
    "Define the population",
    "Generate and sample tasks with a recorded seed, coverage, and exclusion ledger.",
  ],
  [
    "protocol",
    "Protocol & pipeline",
    "Make decisions explicit",
    "Declare conditions, model settings, collection boundaries, and budgets before freezing.",
  ],
  [
    "workflow",
    "Prompt workflow",
    "Specify the interaction",
    "Define stages and response routing. Collection remains subject to the supported execution contract.",
  ],
  [
    "experiment",
    "Resource experiment",
    "Generate an apparatus",
    "Construct bounded resource tasks with independent observations and control plans.",
  ],
  [
    "audit",
    "Judge audit",
    "Inspect the criterion",
    "Bind judge decisions to declared reference cases and an explicit criterion.",
  ],
  [
    "observations",
    "Accounting",
    "Account for the attempt",
    "Keep reported usage, cost, identity, and measured time distinct.",
  ],
  [
    "requirements",
    "Qualification",
    "Check the instrument",
    "Declare and inspect the controls that support your experimental endpoint.",
  ],
  [
    "analysis",
    "Analysis plan",
    "Choose the denominator",
    "Specify populations, contrasts, and dependence assumptions before collecting results.",
  ],
  [
    "run",
    "Freeze & review",
    "From protocol to evidence",
    "Freeze an exact study, execute its pinned runtime, and inspect the retained evidence.",
  ],
];
let current = null,
  projects = [],
  page = "overview",
  runTimer = null,
  saveTimer = null,
  switching = false;
let inspectedRun = null;
$("#app").innerHTML = `
  <aside class="sidebar"><a class="brand" href="#overview" aria-label="ToolsEnabled BenchMark Builder home"><span class="brand-mark">B<span>·</span></span><span>ToolsEnabled<small>BenchMark Builder</small></span></a>
    <div class="workspace-label">RESEARCH WORKSPACE <span>v0.2.0</span></div>
    <label class="project-label" for="project-picker">Current project</label><div class="project-control"><select id="project-picker" aria-label="Current project"></select><button id="new-project" class="icon-button" title="New project" aria-label="New project">+</button></div>
    <nav aria-label="Workspace"><button class="nav-link" data-page="overview"><span class="nav-symbol">◫</span> Overview</button><div class="nav-group">DESIGN</div>${steps
      .slice(0, 5)
      .map(
        (s, i) =>
          `<button class="nav-link" data-page="${s[0]}"><span class="step-number">${String(i + 1).padStart(2, "0")}</span>${s[1]}</button>`,
      )
      .join("")}<div class="nav-group">METHOD</div>${steps
      .slice(5, 12)
      .map(
        (s) =>
          `<button class="nav-link" data-page="${s[0]}"><span class="nav-dot"></span>${s[1]}</button>`,
      )
      .join(
        "",
      )}<div class="nav-group">EVIDENCE</div><button class="nav-link" data-page="run"><span class="nav-symbol">◇</span> Freeze & review</button><button class="nav-link" data-page="runs"><span class="nav-symbol">▤</span> Local runs <span id="run-count"></span></button></nav>
    <div class="sidebar-foot"><button data-page="methods">Methods & limitations <span>↗</span></button><p><span class="local-dot"></span> Local workspace</p></div>
  </aside>
  <div class="main-shell"><header class="topbar"><div class="breadcrumb">WORKBENCH <span>/</span> <span id="crumb">Overview</span></div><div class="top-actions"><span id="save-state" role="status">Saved locally</span><button id="save-project" class="button subtle">Save project</button><button id="export-draft" class="button">Export draft <span>↗</span></button></div></header>
    <main id="main"><div id="notice" role="alert" hidden></div><section id="overview"></section><section id="editor" hidden><div class="page-heading"><p class="eyebrow" id="step-kicker"></p><h1 id="step-title"></h1><p id="step-description"></p></div><div id="result-context" class="retained-context" hidden></div><div id="builder"></div></section><section id="runs" hidden></section><section id="methods" hidden></section></main>
    <footer class="page-footer"><span>ToolsEnabled BenchMark Builder</span><span>Specification → frozen study → retained evidence</span></footer>
  </div>`;
const session = createProjectSession({
  read: (id) => api("projects/" + id),
  write: (id, draft, revision) =>
    api("projects/" + id, {
      method: "PUT",
      body: JSON.stringify({ draft, revision }),
    }),
  snapshot: () => builder.snapshot(),
  load: (id) => builder.setContext(id, "local", { reload: true }),
  isBusy: () => builder.el.getAttribute("aria-busy") === "true",
  onSaved: () => refreshProjects(),
  onState: (state) => {
    current = state.current;
    switching = state.switching;
    $("#save-state").textContent = state.label;
    syncHostControls();
  },
});
const projectStore = session.store;
function notify(error) {
  $("#notice").hidden = false;
  $("#notice").textContent = error.message || error;
}
function clearNotice() {
  $("#notice").hidden = true;
}
async function guarded(action) {
  clearNotice();
  try {
    return await action();
  } catch (error) {
    notify(error);
  }
}
const builder = createBenchmarkBuilder({
  projectStore,
  localRunner: true,
  onWatchRuns: () => navigate("runs"),
  onOpen: (area) => navigate(area === "design" ? "compose" : area),
  onDraftIdentity: () => {
    if (current) renderOverview();
  },
  onBenchmarkLoaded: () => renderOverview(),
  submitExported: async ({ files }) => {
    await projectStore.save(current, builder.snapshot());
    await api("runs", {
      method: "POST",
      body: JSON.stringify({ projectId: current, files }),
    });
    await navigate("runs");
  },
});
$("#builder").append(builder.el);
async function refreshProjects() {
  projects = await api("projects");
  $("#project-picker").innerHTML = projects
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === current ? "selected" : ""}>${esc(p.title)}</option>`,
    )
    .join("");
}
async function saveCurrent() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (switching) return;
  await session.saveCurrent();
  renderOverview();
}
async function selectProject(id) {
  clearTimeout(saveTimer);
  saveTimer = null;
  await session.select(id);
  inspectedRun = null;
  $("#project-picker").value = id;
  renderOverview();
}
async function newProject() {
  await saveCurrent();
  const p = await api("projects", {
    method: "POST",
    body: JSON.stringify({ title: "Untitled study" }),
  });
  await refreshProjects();
  await selectProject(p.id);
  await navigate("overview");
}
function snapshotStats() {
  const spec = builder.study;
  return {
    spec,
    snippets: spec.catalog.length,
    tasks: spec.tasks.length,
    conditions: spec.conditions.length,
  };
}
function renderOverview() {
  if (!current) return;
  const { spec, snippets, tasks, conditions } = snapshotStats();
  $("#overview").innerHTML = `
  <div class="overview-header"><p class="eyebrow">A REPRODUCIBLE RESEARCH WORKFLOW</p><span class="release-tag">Research preview · 0.2.0</span></div>
  <div class="hero"><div><h1>Build the benchmark.<br><em>Keep the evidence.</em></h1><p>Compose a study from reusable pieces, make the protocol explicit, and take its exact runtime and results with you.</p><div class="hero-actions"><button class="button primary" data-go="library">${snippets ? "Continue authoring" : "Create your first snippet"} <span>→</span></button><button class="button" data-action="open">Open a draft</button></div></div><div class="study-diagram" aria-label="Study stages"><div><span>01</span><strong>Specification</strong><small>Prompts · tasks · protocol</small></div><i>↓</i><div><span>02</span><strong>Frozen study</strong><small>Sources · schedule · identities</small></div><i>↓</i><div><span>03</span><strong>Evidence</strong><small>Journal · analysis · report</small></div></div></div>
  <section class="study-card"><div><p class="eyebrow">CURRENT STUDY</p><h2>${esc(spec.name || "Untitled study")}</h2><p class="study-purpose">${esc(spec.executionPlan?.purpose || "Draft")} <span>·</span> ${esc(spec.domain)}</p></div><div class="study-metrics"><div><strong>${snippets}</strong><span>Snippets & templates</span></div><div><strong>${tasks}</strong><span>Tasks</span></div><div><strong>${conditions}</strong><span>Conditions</span></div></div><button class="text-button" data-go="protocol">Review protocol →</button></section>
  <div class="section-heading"><h2>Explore the workflow</h2><p>Worked examples use recorded controls. They contain no live model measurements.</p></div>
  <div class="example-grid"><button class="example-card" data-example="arithmetic"><span class="example-index">01 / GET STARTED</span><h3>A small, complete study</h3><p>Follow two arithmetic tasks from nested instructions to a frozen schedule and a reproducible report.</p><span class="card-link">Open recorded diagnostic <b>↗</b></span></button><button class="example-card" data-example="records"><span class="example-index">02 / EXTEND THE TOOL</span><h3>Structured record extraction</h3><p>Compare reference and wrong-field responses. This example ships through the portable plugin interface.</p><span class="card-link">Open plugin example <b>↗</b></span></button><button class="example-card" data-action="examples"><span class="example-index">03 / GO FURTHER</span><h3>Bring your research question</h3><p>Explore resource experiments and Lean Bench, or import your own snippets and benchmark specification.</p><span class="card-link">Browse authoring examples <b>↗</b></span></button></div>
  <div class="integrity-note"><span>◇</span><p><strong>Inspect the claim behind the number.</strong> A frozen hash identifies content. Qualification checks an apparatus. A research conclusion still depends on the study design and the evidence.</p><button class="text-button" data-go="methods">Read the methods guide ↗</button></div>`;
}
async function navigate(next) {
  clearNotice();
  if (next === "design") next = "compose";
  if (
    !["overview", "runs", "methods", ...steps.map((s) => s[0])].includes(next)
  )
    next = "run";
  page = next;
  $("#result-context").hidden = next !== "run" || !inspectedRun;
  if (inspectedRun)
    $("#result-context").textContent =
      `Retained run: ${inspectedRun.name} · ${inspectedRun.projectSha256.slice(0, 16)}. These results belong to this original frozen study.`;
  builder.el.dataset.workspacePage = next;
  clearTimeout(runTimer);
  const step = steps.find((s) => s[0] === next);
  for (const name of ["overview", "editor", "runs", "methods"])
    $("#" + name).hidden = name === "editor" ? !step : name !== next;
  for (const b of document.querySelectorAll("[data-page]"))
    b.setAttribute("aria-current", b.dataset.page === next ? "page" : "false");
  $("#crumb").textContent =
    step?.[1] ||
    {
      overview: "Overview",
      runs: "Local runs",
      methods: "Methods & limitations",
    }[next];
  if (step) {
    $("#step-kicker").textContent = step[1].toUpperCase();
    $("#step-title").textContent = step[2];
    $("#step-description").textContent = step[3];
    builder.selectTab(next);
  }
  if (next === "overview") renderOverview();
  if (next === "runs") await renderRuns();
  if (next === "methods") renderMethods();
  window.scrollTo({ top: 0, behavior: "instant" });
}
async function loadExample(kind) {
  const p = await api("projects", {
    method: "POST",
    body: JSON.stringify({
      title:
        kind === "records" ? "Structured records" : "Worked arithmetic study",
    }),
  });
  await selectProject(p.id);
  let spec =
    kind === "records"
      ? await starterById("structured-records").create()
      : newExperimentDraft(genericStarter(), {
          purpose: "recorded-diagnostic",
          initializePopulation: true,
        });
  if (kind === "arithmetic") {
    spec.name = "A small, complete study";
    spec.decisions =
      "Recorded answer-key diagnostic for learning the workflow. These two authored responses are controls, not measurements of a live model.";
  }
  const opened = await builder.openDraft({ spec, attachments: {} }, spec.name);
  if (!opened.ok) throw new Error(opened.reason);
  await saveCurrent();
  await refreshProjects();
  await navigate("run");
}
async function renderRuns() {
  const rows = await api("runs");
  $("#run-count").textContent = rows.length || "";
  $("#runs").innerHTML =
    `<div class="page-heading"><p class="eyebrow">RETAINED EXECUTION</p><h1>Local runs</h1><p>Each run keeps its frozen package, process log, attempt journal, and generated report.</p></div>${rows.length ? "" : `<div class="empty-state"><span>▤</span><h2>Your evidence starts here.</h2><p>Freeze a study, then choose “Run frozen study locally.” Its progress and results will appear here.</p><button class="button primary" data-go="run">Open Freeze & review →</button></div>`}${rows.map((r) => `<article class="run-card"><div class="run-heading"><div><p class="eyebrow">${esc(r.purpose || "RUN PACKAGE")} · ${esc(new Date(r.createdAt).toLocaleString())}</p><h2>${esc(r.name)}</h2></div><span class="status-pill ${r.status === "completed" ? "complete" : r.status === "failed" ? "failed" : ""}">${esc(r.status)}</span></div><p class="run-identity">${esc(r.projectSha256?.slice(0, 20) || "Unverified package")} <span>SHA-256 prefix</span></p>${r.message ? `<p class="run-message">${esc(r.message)}</p>` : ""}${r.summary ? `<div class="run-metrics"><strong>${r.summary.completed ?? 0}<span>completed</span></strong><strong>${r.summary.failed ?? 0}<span>failed</span></strong><strong>${r.summary.scheduled ?? 0}<span>scheduled</span></strong></div>` : ""}<div class="run-actions">${r.status === "completed" ? `<button class="button primary" data-run-action="load" data-id="${r.id}">Inspect results →</button><button class="button" data-run-action="report" data-id="${r.id}">Download report</button><button class="button" data-run-action="evidence" data-id="${r.id}">Evidence JSON</button>` : ""}${["running", "qualifying", "verifying", "analyzing"].includes(r.status) ? `<button class="button" data-run-action="cancel" data-id="${r.id}">Cancel run</button>` : ""}${["failed", "cancelled", "interrupted"].includes(r.status) ? `<button class="button" data-run-action="resume" data-id="${r.id}">Resume retained run</button>` : ""}${r.projectSha256 ? `<button class="button" data-run-action="package" data-id="${r.id}">Frozen package</button>` : ""}</div><details><summary>Process log & reproducibility details</summary><p class="folder">${esc(r.directory || "")}</p><p>Commands: ${esc(r.history?.map((h) => h.command + " (" + h.code + ")").join(" → ") || r.phase || "pending")}</p><pre>${esc(r.log || "Waiting for process output…")}</pre></details></article>`).join("")}`;
  if (
    page === "runs" &&
    rows.some((r) =>
      [
        "queued",
        "running",
        "qualifying",
        "verifying",
        "analyzing",
        "cancelling",
      ].includes(r.status),
    )
  )
    runTimer = setTimeout(() => guarded(renderRuns), 1500);
}
async function runAction(action, id) {
  if (action === "cancel" || action === "resume") {
    await api(`runs/${id}/${action}`, { method: "POST", body: "{}" });
    return renderRuns();
  }
  if (action === "report")
    return download(
      `runs/${id}/artifact?path=report.html`,
      `${id}-report.html`,
    );
  if (action === "evidence")
    return download(
      `runs/${id}/artifact?path=evidence.json`,
      `${id}-evidence.json`,
    );
  if (action === "package") return download(`runs/${id}/package`, `${id}.zip`);
  if (action === "load") {
    const [run, evidence] = await Promise.all([
      api("runs/" + id),
      api("runs/" + id + "/evidence"),
    ]);
    await selectProject(run.projectId);
    // Open the original frozen package, so later edits never masquerade as this run.
    const response = await fetch(`/api/runs/${id}/package`, {
      headers: { "x-benchmark-token": token },
    });
    if (!response.ok) throw new Error("Could not load the frozen package.");
    const input = $("[data-bench-open-exported]", builder.el);
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([await response.blob()], "frozen-study.zip", {
        type: "application/zip",
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForBuilder();
    await builder.importRunEvidence(evidence);
    inspectedRun = run;
    await navigate("run");
  }
}
async function waitForBuilder() {
  for (let i = 0; i < 300; i++) {
    if (builder.el.getAttribute("aria-busy") !== "true") return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("The study is still opening. Try again when it finishes.");
}
function renderMethods() {
  $("#methods").innerHTML =
    `<div class="page-heading"><p class="eyebrow">METHODS & LIMITATIONS</p><h1>Make the study inspectable.</h1><p>The tool records a chain of evidence. Each link supports a specific claim.</p></div><div class="method-grid"><article><span>01</span><h2>Specify before collecting</h2><p>Record the task population, conditions, primary denominator, dependence structure, retry policy, and stopping budgets. Freeze the plan before collecting the outcomes it will summarize.</p></article><article><span>02</span><h2>Qualify the apparatus</h2><p>Check reference and wrong-answer controls. Where required, use independently implemented interpreters. An answer key agreeing with itself is an apparatus check, not independent validation.</p></article><article><span>03</span><h2>Preserve the whole attempt</h2><p>Keep failures, refusals, incomplete outputs, retries, and unavailable measurements visible. Replicates repeat a task; they do not automatically create independent sampling units.</p></article><article><span>04</span><h2>Reproduce from artifacts</h2><p>Export the frozen runtime and manifest, retain the journal and raw evidence, then regenerate the analysis and report with that runtime. New stochastic model responses need not reproduce old responses.</p></article></div><section class="method-sheet"><h2>Three execution purposes</h2><table><thead><tr><th>Purpose</th><th>What it supports</th></tr></thead><tbody><tr><td>Recorded diagnostic</td><td>Checks saved responses against the declared scoring rule. It measures no live model.</td></tr><tr><td>Apparatus development</td><td>Exercises unfinished instruments and supported adapters. Outputs retain development status.</td></tr><tr><td>Experiment</td><td>Requires the execution profile and controls declared by the frozen study. A passing gate has its stated scope; it does not certify a research conclusion.</td></tr></tbody></table><h2>Current boundaries</h2><p>Admitted answer-collection profiles support recorded replay and bounded HTTPS requests. Provider CLI and module collection require an appropriate execution contract for counted experiments. Resource experiments use bounded synthetic maps. Native Lean work requires its pinned Python/Docker environment and retains the existing admission limitations.</p><p>The source-bound plugin example demonstrates extensibility and portability. Its authored reference responses establish no external benchmark validity. This preview includes no published empirical findings.</p><h2>Citation and provenance</h2><p>Cite <strong>ToolsEnabled BenchMark Builder, version 0.2.0</strong>, Joshua Pinckard (2026). The repository includes CITATION.cff, its MIT license, extraction provenance, and an AI assistance statement. Each frozen study exports its own citation files and exact source identities. No DOI or peer-review status is claimed.</p><h2>Local by default</h2><p>Projects and run evidence are saved on this computer. External requests occur only when you execute a study configured with an external collector. Executable plugins are installed at build time; opening an archive does not install its code.</p></section>`;
}
for (const b of document.querySelectorAll("[data-page]"))
  b.addEventListener("click", () => guarded(() => navigate(b.dataset.page)));
$("#main").addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  guarded(async () => {
    if (button.dataset.go) return navigate(button.dataset.go);
    if (button.dataset.example) return loadExample(button.dataset.example);
    if (button.dataset.runAction)
      return runAction(button.dataset.runAction, button.dataset.id);
    if (button.dataset.action === "open") {
      await navigate("library");
      $("[data-bench-import]", builder.el).click();
    }
    if (button.dataset.action === "examples") {
      await navigate("library");
      $(".bench-start-sections", builder.el).scrollIntoView({
        behavior: "smooth",
      });
    }
  });
});
$("#project-picker").addEventListener("change", () =>
  guarded(async () => {
    try {
      await selectProject($("#project-picker").value);
      await navigate("overview");
    } catch (error) {
      $("#project-picker").value = current;
      throw error;
    }
  }),
);
$("#new-project").addEventListener("click", () => guarded(newProject));
$("#save-project").addEventListener("click", () => guarded(saveCurrent));
$("#export-draft").addEventListener("click", () =>
  guarded(() =>
    downloadBenchmark(
      (builder.snapshot().spec.id || "study") + "-draft.json",
      JSON.stringify(builder.snapshot(), null, 2),
    ),
  ),
);
$(".brand").addEventListener("click", (e) => {
  e.preventDefault();
  guarded(() => navigate("overview"));
});
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      guarded(async () => {
        if (switching) return;
        if (builder.el.getAttribute("aria-busy") === "true") {
          scheduleAutosave();
          return;
        }
        await saveCurrent();
      }),
    1200,
  );
}
for (const event of ["input", "change", "click"])
  builder.el.addEventListener(event, (e) => {
    if (
      switching ||
      e.target.closest("[data-bench-save]") ||
      e.target.closest("[data-bench-tab]")
    )
      return;
    if (event === "input" || e.target.closest("[data-bench-freeze]")) {
      inspectedRun = null;
      $("#result-context").hidden = true;
    }
    session.markEdited();
    scheduleAutosave();
  });
function syncHostControls() {
  const busy = switching || builder.el.getAttribute("aria-busy") === "true";
  builder.el.inert = switching;
  $("#save-project").disabled = busy || !current;
  $("#export-draft").disabled = busy || !current;
  $("#new-project").disabled = busy;
  $("#project-picker").disabled = busy;
}
new MutationObserver(syncHostControls).observe(builder.el, {
  attributes: true,
  attributeFilter: ["aria-busy"],
});
window.addEventListener("beforeunload", (event) => {
  if (session.hasUnsavedChanges) {
    event.preventDefault();
    event.returnValue = "";
  }
});
await guarded(async () => {
  await refreshProjects();
  if (!projects.length)
    projects = [
      await api("projects", {
        method: "POST",
        body: JSON.stringify({ title: "Untitled study" }),
      }),
    ];
  await selectProject(projects[0].id);
  await refreshProjects();
  await navigate("overview");
});
