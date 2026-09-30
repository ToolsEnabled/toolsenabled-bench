import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { installDomStandIn } from "../tools/test/lib/dom-stand-in.mjs";
import { genericStarter } from "../src/benchmark/starters.mjs";

register("../tools/test/css-loader.mjs", import.meta.url);
const { createBenchmarkBuilder } = await import("../src/research-benchmark.js");
const field = (view, name) => view.el.querySelector(`[data-bench-${name}]`);
const draft = (name) => ({
  spec: { ...genericStarter(), name },
  attachments: {},
});
async function fixture(t) {
  const dom = installDomStandIn(globalThis),
    records = new Map();
  const store = {
    read: async (id) => structuredClone(records.get(id) || null),
    save: async (id, value) => records.set(id, structuredClone(value)),
  };
  const view = createBenchmarkBuilder({
    projectStore: store,
    loadSources: async () => ({}),
  });
  document.body.append(view.el);
  t.after(() => {
    view.destroy();
    view.el.remove();
    dom.restore();
  });
  await view.setContext("A", "local", { reload: true });
  return { view, records, store };
}

test("local saved replacement retains one Undo through project reopen, including pending text and attachments", async (t) => {
  const { view, store } = await fixture(t);
  await view.openDraft(draft("Original"), "Original");
  field(view, "wording").value = "Unfinished {{";
  field(view, "wording").dispatch("input");
  field(view, "attachment-path").value = "unfinished.txt";
  field(view, "attachment-text").value = "Unapplied attachment";
  field(view, "attachment-text").dispatch("input");
  await view.openDraft(draft("Replacement"), "Replacement");
  await store.save("A", view.snapshot());
  await view.setContext("B", "local", { reload: true });
  await view.setContext("A", "local", { reload: true });
  assert.equal(field(view, "undo").hidden, false);
  field(view, "undo").click();
  assert.equal(view.study.name, "Original");
  assert.equal(field(view, "wording").value, "Unfinished {{");
  assert.equal(field(view, "attachment-text").value, "Unapplied attachment");
  assert.ok(view.snapshot().pending.includes("bundle"));
  assert.ok(view.snapshot().undo);
  assert.equal(Object.hasOwn(view.snapshot().undo, "undo"), false);
});

test("failed stored draft validation or read retains the current editable project and reports failure", async (t) => {
  const { view, records, store } = await fixture(t);
  await view.openDraft(draft("Keep this project"), "Original");
  field(view, "wording").value = "Keep pending {{";
  field(view, "wording").dispatch("input");
  const before = view.snapshot();
  records.set("broken", { spec: { catalog: [], tasks: [] } });
  const result = await view.setContext("broken", "local", { reload: true });
  assert.equal(result?.ok, false);
  assert.deepEqual(view.snapshot(), before);
  assert.match(result.reason, /supported benchmark draft/);
  store.read = async () => {
    throw new Error("Local project could not be read");
  };
  const unavailable = await view.setContext("unavailable", "local", {
    reload: true,
  });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.reason, /could not be read/);
  assert.deepEqual(view.snapshot(), before);
});

test("local reopen retains its provenance without account wording and still opens old drafts without Undo", async (t) => {
  const { view, records } = await fixture(t);
  records.set("old", {
    ...draft("Old local draft"),
    origin: "Imported research draft.",
  });
  await view.setContext("old", "local", { reload: true });
  assert.equal(view.snapshot().origin, "Imported research draft.");
  assert.equal(field(view, "undo").hidden, true);
  records.set("plain", draft("Plain local draft"));
  await view.setContext("plain", "local", { reload: true });
  assert.doesNotMatch(view.snapshot().origin, /account/i);
});

test("an editor without a project store never invokes an inherited account adapter", async (t) => {
  const dom = installDomStandIn(globalThis);
  let calls = 0;
  const account = {
    getSetting: async () => { calls++; return { ok: true, value: null }; },
    putSetting: async () => { calls++; return { ok: true }; },
  };
  const view = createBenchmarkBuilder({ account, loadSources: async () => ({}) });
  document.body.append(view.el);
  t.after(() => { view.destroy(); view.el.remove(); dom.restore(); });
  assert.equal((await view.setContext("rp-abcd", "local")).ok, true);
  await view.openDraft(draft("Local-only draft"), "Imported draft");
  assert.equal(calls, 0);
  assert.equal(field(view, "save").disabled, true);
  assert.doesNotMatch(field(view, "save").title, /account/i);
  assert.equal(view.study.name, "Local-only draft");
});

test("same-project reload saves pending edits before reopening and a failed switch retains selection", async () => {
  const { createProjectSession } = await import(
    "../src/app/project-session.js"
  );
  const records = new Map([["A", { revision: 0, draft: { text: "Saved" } }]]);
  let editable;
  const session = createProjectSession({
    read: async (id) => {
      if (!records.has(id)) throw new Error("Read failed");
      return structuredClone(records.get(id));
    },
    write: async (id, value, revision) => {
      assert.equal(records.get(id).revision, revision);
      records.set(id, {
        draft: structuredClone(value),
        revision: revision + 1,
      });
      return { revision: revision + 1 };
    },
    snapshot: () => structuredClone(editable),
    load: async (id) => {
      editable = await session.store.read(id);
      return { ok: true };
    },
  });
  await session.select("A");
  editable.text = "Unfinished {{";
  session.markEdited();
  await session.select("A");
  assert.equal(editable.text, "Unfinished {{");
  await assert.rejects(session.select("missing"), /Read failed/);
  assert.equal(session.current, "A");
  assert.equal(editable.text, "Unfinished {{");
});

test("an older save response cannot mark newer edits saved and a conflict retains unsaved state", async () => {
  const { createProjectSession } = await import(
    "../src/app/project-session.js"
  );
  let release,
    started,
    revision = 0,
    editable = { text: "Saved" },
    fail = false;
  const savingStarted = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const session = createProjectSession({
    read: async () => ({ draft: editable, revision }),
    write: async () => {
      started();
      await gate;
      if (fail) throw new Error("Saved in another window");
      return { revision: ++revision };
    },
    snapshot: () => structuredClone(editable),
    load: async (id) => {
      editable = await session.store.read(id);
      return { ok: true };
    },
  });
  await session.select("A");
  editable.text = "First edit";
  session.markEdited();
  const first = session.saveCurrent();
  await savingStarted;
  editable.text = "Second edit";
  session.markEdited();
  release();
  await first;
  assert.equal(session.hasUnsavedChanges, true);
  assert.notEqual(session.state.label, "Saved locally");
  await session.saveCurrent();
  assert.equal(session.hasUnsavedChanges, false);
  editable.text = "Conflicting edit";
  session.markEdited();
  fail = true;
  await assert.rejects(session.saveCurrent(), /another window/);
  assert.equal(session.hasUnsavedChanges, true);
  assert.equal(editable.text, "Conflicting edit");
  fail = false;
  await session.saveCurrent();
  assert.equal(session.hasUnsavedChanges, false);
});

test("a queued successful retry clears an earlier failed save", async () => {
  const { createProjectSession } = await import(
    "../src/app/project-session.js"
  );
  let release,
    writes = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const session = createProjectSession({
    read: async () => ({ draft: {}, revision: 0 }),
    snapshot: () => ({}),
    write: async () => {
      await gate;
      if (++writes === 1) throw new Error("Disk temporarily unavailable");
      return { revision: 1 };
    },
    load: (id) => session.store.read(id),
  });
  await session.select("A");
  session.markEdited();
  const first = session.saveCurrent();
  const rejected = assert.rejects(first, /temporarily unavailable/);
  const second = session.saveCurrent();
  release();
  await rejected;
  await second;
  assert.equal(session.hasUnsavedChanges, false);
  assert.equal(session.state.label, "Saved locally");
});
