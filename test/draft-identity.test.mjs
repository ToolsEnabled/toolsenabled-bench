import test from 'node:test';
import assert from 'node:assert/strict';
import { persistedDraftIdentity } from '../src/research-draft-identity.mjs';
import { emptyNestingForm } from '../src/research-nesting.mjs';
const groups = { task: ['task-json'], specification: ['spec-json'] };
const identify = value => persistedDraftIdentity(value, groups);
const draft = () => ({ spec: { name: 'Authored study' }, editors: {}, pending: [] });

test('draft identity admits only declared persisted fields, including inside Undo', () => {
  const a = draft(), b = draft();
  b.taskIndex = 10;
  b.editors = { 'data-bench-unknown-view': 'selected item', 'data-bench-task-json': 'view mirror', 'data-bench-name': 'mirror' };
  b.pending = ['unknown-display-state'];
  assert.equal(identify(a), identify(b));
  assert.equal(identify({ ...a, undo: a }), identify({ ...a, undo: b }));
  b.spec.name = 'A real change';
  assert.notEqual(identify(a), identify(b));
});
test('nested editor view publications and default materialization are not edits', () => {
  const a = draft(), b = draft();
  b.editors['data-bench-nesting-draft'] = JSON.stringify({ selected: 'different', trail: ['before'], authoring: false, connections: true, form: emptyNestingForm(), review: null });
  assert.equal(identify(a), identify(b));
  const state = JSON.parse(b.editors['data-bench-nesting-draft']); state.form.name = 'New authored composition';
  b.editors['data-bench-nesting-draft'] = JSON.stringify(state);
  assert.notEqual(identify(a), identify(b));
});
test('pending grouped fields, review choices, attachments and unfinished JSON stay save dependencies', () => {
  const a = draft();
  for (const b of [
    { ...draft(), pending: ['task'], editors: { 'data-bench-task-json': 'unfinished {' } },
    { ...draft(), pending: ['specification'], editors: { 'data-bench-spec-json': 'unfinished {' } },
    { ...draft(), editors: { 'data-bench-nesting-draft': JSON.stringify({ review: { fingerprint: 'binding', rows: [{ index: 0, name: 'Chosen', keep: false }] } }) } },
    { ...draft(), editors: { 'data-bench-routing': 'unfinished {' } },
    { ...draft(), attachments: { 'input.txt': 'authored bytes' } },
  ]) assert.notEqual(identify(a), identify(b));
});
