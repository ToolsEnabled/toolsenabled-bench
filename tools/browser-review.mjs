import { chromium } from "playwright";
import { startServer } from "../server/main.mjs";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const dataDir = await mkdtemp(join(tmpdir(), "benchmark-browser-")),
  app = await startServer({ port: 0, dataDir });
let browser, page;
const errors = [];
const packageInfo = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const playwrightInfo = JSON.parse(await readFile(new URL("../node_modules/playwright/package.json", import.meta.url), "utf8"));
const shots = resolve(process.env.BENCHMARK_BROWSER_EVIDENCE_DIR || "docs/review");
await mkdir(shots, { recursive: true });
try {
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    args: ["--no-zygote", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.origin);
  await page
    .getByRole("heading", { name: "Build the benchmark. Keep the evidence." })
    .waitFor();
  assert.equal(await page.locator(".workspace-label span").innerText(), "v" + packageInfo.version);
  await page.screenshot({
    path: join(shots, "01-overview.png"),
    fullPage: true,
  });
  await page.locator('[data-example="arithmetic"]').click();
  await page.locator("[data-bench-name]").filter({ visible: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-bench-name]").value ===
      "A small, complete study",
  );
  await page
    .getByRole("button", { name: "Freeze project", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-bench-frozen]")
      .textContent.includes("SHA-256"),
  );
  await page.screenshot({
    path: join(shots, "02-frozen-study.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Run frozen study locally", exact: true })
    .click();
  await page.locator(".status-pill.complete").waitFor({ timeout: 25000 });
  await page.screenshot({
    path: join(shots, "03-local-run.png"),
    fullPage: true,
  });
  // Inspecting a run reopens the current project before showing its frozen package.
  // Pending editor fields must survive even before the autosave delay expires.
  await page.locator('[data-page="library"]').click();
  await page
    .locator("[data-bench-wording]")
    .fill("Pending snippet {{ before inspecting this run");
  await page.locator('[data-page="runs"]').click();
  await page
    .getByRole("button", { name: "Inspect results →", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-bench-status]")
      .textContent.includes("Local run evidence loaded"),
  );
  await page.screenshot({
    path: join(shots, "04-evidence.png"),
    fullPage: true,
  });
  await page.locator('[data-page="library"]').click();
  assert.equal(
    await page.locator("[data-bench-wording]").inputValue(),
    "Pending snippet {{ before inspecting this run",
  );
  await page.locator("[data-bench-name]").fill("Edited after the recorded run");
  await page.waitForTimeout(1600);
  await page.reload();
  await page.locator('[data-page="library"]').click();
  assert.equal(
    await page.locator("[data-bench-name]").inputValue(),
    "Edited after the recorded run",
  );
  assert.equal(
    await page.locator("[data-bench-wording]").inputValue(),
    "Pending snippet {{ before inspecting this run",
  );
  const replacement = await page.evaluate(async () => {
    const id = document.querySelector("#project-picker").value;
    const token = document.querySelector('meta[name="bench-token"]').content;
    const record = await (
      await fetch("/api/projects/" + id, {
        headers: { "x-benchmark-token": token },
      })
    ).json();
    record.draft.spec.name = "Imported replacement";
    record.draft.editors["data-bench-name"] = "Imported replacement";
    return record.draft;
  });
  await page.locator("[data-bench-import]").setInputFiles({
    name: "replacement-draft.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("[data-bench-name]").value ===
      "Imported replacement",
  );
  await page.locator("#save-project").click();
  await page.waitForFunction(
    () => document.querySelector("#save-state").textContent === "Saved locally",
  );
  await page.reload();
  await page.locator('[data-page="library"]').click();
  await page.locator("[data-bench-undo]").click();
  assert.equal(
    await page.locator("[data-bench-name]").inputValue(),
    "Edited after the recorded run",
  );
  assert.equal(
    await page.locator("[data-bench-wording]").inputValue(),
    "Pending snippet {{ before inspecting this run",
  );
  await page.locator('[data-page="runs"]').click();
  assert.ok(
    (await page.locator(".run-card h2").innerText()).includes(
      "A small, complete study",
    ),
  );
  await page.locator('[data-page="overview"]').click();
  await page.locator('[data-example="records"]').click();
  await page
    .getByRole("button", { name: "Freeze project", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-bench-frozen]")
      .textContent.includes("SHA-256"),
  );
  await page
    .getByRole("button", { name: "Run frozen study locally", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".status-pill.complete").length === 2,
    { timeout: 25000 },
  );
  await page.locator('[data-page="methods"]').click();
  await page.screenshot({
    path: join(shots, "05-methods.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-page="overview"]').click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({ path: join(shots, "06-mobile.png"), fullPage: true });
  // Ordinary punctuation in imported roles must round-trip as text and data.
  // This is a rendering regression, with no executable or event-handler input.
  const literalRole = 'reading "quoted" & bounds < upper > lower';
  const literalDraft = structuredClone(replacement);
  literalDraft.spec.name = "Literal composition roles";
  literalDraft.editors = {};
  literalDraft.spec.catalog.push(
    { id: "literal-left", version: "1", kind: "atom", role: literalRole, text: "Left part", parameters: {}, semantics: { kind: "prompt" } },
    { id: "literal-right", version: "1", kind: "atom", role: "answer", text: "Right part", parameters: {}, semantics: { kind: "prompt" } },
    { id: "literal-parts", version: "1", kind: "template", role: "prompt", text: "{{left}} {{right}}", parameters: {}, semantics: { kind: "prompt" }, slots: { left: literalRole, right: "answer" }, slotOrder: ["left", "right"] },
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('[data-page="library"]').click();
  await page.locator("[data-bench-import]").setInputFiles({
    name: "literal-roles.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(literalDraft)),
  });
  await page.waitForFunction(() => document.querySelector("[data-bench-name]").value === "Literal composition roles");
  const literalChoices = await page.locator('[data-bench-role-choices]').evaluate(root => ({
    legends: [...root.querySelectorAll('legend')].map(node => node.textContent),
    roles: [...root.querySelectorAll('input')].map(node => node.dataset.combinationRole),
    attributes: [...root.querySelectorAll('input')].map(node => [...node.attributes].map(a => a.name).sort()),
    tags: [...root.querySelectorAll('*')].map(node => node.tagName),
  }));
  assert.deepEqual(literalChoices.legends, [literalRole.replace(/^r/, 'R'), 'Answer']);
  assert.deepEqual(literalChoices.roles, [literalRole, 'answer']);
  assert.deepEqual(literalChoices.attributes, Array.from({ length: 2 }, () => ['checked', 'data-combination-role', 'type', 'value']));
  assert.deepEqual(literalChoices.tags, Array.from({ length: 2 }, () => ['FIELDSET', 'LEGEND', 'LABEL', 'INPUT']).flat());
  assert.deepEqual(errors, []);
  await writeFile(join(shots, "browser-verification.json"), JSON.stringify({
    format: "benchmark-builder-browser-acceptance", version: 1,
    release: packageInfo.version, status: "passed", testedAt: new Date().toISOString(),
    playwright: playwrightInfo.version, chromium: browser.version(),
    launch: { chromiumSandbox: false, args: ["--no-zygote", "--disable-dev-shm-usage"] },
    binding: "127.0.0.1", viewports: [{ width: 1440, height: 1050 }, { width: 390, height: 844 }],
    uncaughtPageErrors: errors.length,
    checks: ["release identity", "arithmetic recorded example", "structured-records plugin example",
      "freezing", "exported CLI runs", "pending fields during evidence inspection", "save and reload",
      "replacement Undo after reload", "retained run identity", "methods", "mobile overflow",
      "imported composition roles remain literal text and attributes"],
    screenshots: ["01-overview.png", "02-frozen-study.png", "03-local-run.png", "04-evidence.png", "05-methods.png", "06-mobile.png"],
    scope: "Local browser and recorded-control apparatus acceptance; no live model measurements.",
  }, null, 2) + "\n");
  console.log(
    "Browser review passed: examples, freezing, local CLI runs, pending edits during evidence inspection, save/reload, imported replacement Undo after reload, run identity, methods, mobile layout; no page errors.",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(shots, "failure.png"), fullPage: true });
    console.error((await page.locator("body").innerText()).slice(-7000));
  }
  throw error;
} finally {
  await browser?.close();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
}
