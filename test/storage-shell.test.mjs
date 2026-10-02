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
async function fixture(t, options = {}) {
  const dom = installDomStandIn(globalThis),
    records = new Map();
  const store = {
    read: async (id) => structuredClone(records.get(id) || null),
    save: async (id, value) => records.set(id, structuredClone(value)),
  };
  const view = createBenchmarkBuilder({
    projectStore: store,
    loadSources: async () => ({}),
    ...options,
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

test("failed stored draft validation or read clears and locks the editor until a project opens", async (t) => {
  const { view, records, store } = await fixture(t);
  await view.openDraft(draft("Keep this project"), "Original");
  field(view, "wording").value = "Keep pending {{";
  field(view, "wording").dispatch("input");
  const before = view.snapshot();
  records.set("broken", { spec: { catalog: [], tasks: [] } });
  const result = await view.setContext("broken", "local", { reload: true });
  assert.equal(result?.ok, false);
  assert.equal(view.study.catalog.length, 0);
  assert.equal(field(view, "name").disabled, true);
  assert.match(result.reason, /supported benchmark draft/);
  store.read = async () => {
    throw new Error("Local project could not be read");
  };
  const unavailable = await view.setContext("unavailable", "local", {
    reload: true,
  });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.reason, /could not be read/);
  assert.equal(view.study.catalog.length, 0);
  assert.equal(field(view, "name").disabled, true);
  assert.equal((await view.setContext("A", "local")).ok, true);
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

test("same-project reload saves pending edits before reopening and a failed load clears selection", async () => {
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
    identify: JSON.stringify,
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
  assert.equal(session.current, null);
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
    identify: JSON.stringify,
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

test("reverting while a save is in flight persists the revert after the queued edit", async t => {
  const { createProjectSession } = await import('../src/app/project-session.js');
  let editable, release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const writing = new Promise(resolve => { started = resolve; });
  t.after(release);
  const record = { revision: 1, draft: { text: 'Original' } };
  const writes = [];
  const session = createProjectSession({
    read: async () => structuredClone(record),
    write: async (id, value, revision) => {
      writes.push(structuredClone(value)); started(); await gate;
      assert.equal(record.revision, revision);
      record.draft = structuredClone(value);
      return { revision: ++record.revision };
    },
    snapshot: () => structuredClone(editable), identify: JSON.stringify,
    load: async id => { editable = await session.store.read(id); },
  });
  await session.select('A');
  editable.text = 'Typo'; session.markEdited();
  const first = session.saveCurrent(); await writing;
  editable.text = 'Original';
  const needsSave = session.markEdited();
  // This is the shell's autosave decision, made while I1 has not completed.
  const reverted = needsSave ? session.saveCurrent() : null;
  release(); await first; if (reverted) await reverted;
  assert.equal(needsSave, true, 'the queued identity, not the last confirmed one, determines whether this edit needs saving');
  assert.equal(record.draft.text, 'Original');
  assert.deepEqual(writes.map(row => row.text), ['Typo', 'Original']);
  assert.equal(session.hasUnsavedChanges, false);
  await session.select('A');
  assert.equal(editable.text, 'Original', 'the revert must survive reload');
});

test("a conflict followed by reverting and saving must not claim stale content is saved", async () => {
  const { createProjectSession } = await import('../src/app/project-session.js');
  let editable, writes = 0;
  const record = { revision: 1, draft: { text: 'A' } };
  const session = createProjectSession({
    read: async () => structuredClone(record),
    write: async (id, value, revision) => {
      writes++;
      if (record.revision !== revision) throw new Error('Saved in another window. Download your draft, then reopen the project.');
      record.draft = structuredClone(value);
      return { revision: ++record.revision };
    },
    snapshot: () => structuredClone(editable), identify: JSON.stringify,
    load: async id => { editable = await session.store.read(id); },
  });
  await session.select('A');
  record.revision = 2; record.draft = { text: 'Other window' };
  editable.text = 'C'; session.markEdited();
  await assert.rejects(session.saveCurrent(), /another window/);
  editable.text = 'A'; session.markEdited();
  await assert.rejects(session.saveCurrent(), /another window/);
  assert.equal(writes, 2, 'cached identity cannot skip the revision check after a conflict');
  assert.equal(session.state.label, 'Not saved');
  assert.equal(session.hasUnsavedChanges, true);
  assert.equal(record.draft.text, 'Other window');
});

for (const mode of ['throw', 'refusal']) test(`a ${mode} after partial loading clears autosave ownership`, async () => {
  const { createProjectSession } = await import('../src/app/project-session.js');
  let editable = { text: 'H' }; const writes = [];
  const session = createProjectSession({
    read: async id => ({ revision: 0, draft: { text: id } }),
    write: async (id, value) => { writes.push({ id, value }); return { revision: 1 }; },
    snapshot: () => structuredClone(editable), identify: JSON.stringify,
    load: async id => {
      editable = await session.store.read(id);
      if (id === 'D') { if (mode === 'throw') throw new Error('Render failed'); return { ok: false, reason: 'Render failed' }; }
      return { ok: true };
    },
  });
  await session.select('H'); await assert.rejects(session.select('D'), /Render failed/);
  editable.text = 'D edited'; session.markEdited(); await session.saveCurrent();
  assert.deepEqual(writes, [], 'a load failure must not write D into H');
  assert.equal(session.current, null); assert.equal(session.state.label, 'No project selected');
  await session.select('H'); assert.equal(session.current, 'H');
});


test("a render-completion exception clears partial content and the next project can still open", async t => {
  const { view, records } = await fixture(t, { onBenchmarkLoaded(spec) { if (spec.name === 'Throw after render') throw new Error('Completion failed'); } });
  records.set('D', draft('Throw after render'));
  assert.equal((await view.setContext('D', 'local', { reload: true })).ok, false);
  assert.equal(view.study.catalog.length, 0); assert.equal(view.study.tasks.length, 0);
  assert.equal(field(view, 'name').disabled, true); assert.equal(field(view, 'save').disabled, true);
  assert.equal(view.frozenSha256, null);
  records.set('H', draft('Healthy'));
  assert.equal((await view.setContext('H', 'local', { reload: true })).ok, true);
  assert.equal(view.study.name, 'Healthy'); assert.equal(field(view, 'name').disabled, false);
});
