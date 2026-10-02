import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, rename, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/main.mjs';
import { atomicJSON, ProjectStore } from '../server/store.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bench-store-errors-'));
  const store = new ProjectStore(root); await store.init();
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store };
}
test('project listing retains healthy rows and reports unreadable, corrupt and invalid records without paths', async t => {
  const { store } = await fixture(t);
  const healthy = await store.create('Healthy');
  const unreadable = await store.create('Unreadable');
  const corrupt = await store.create('Corrupt');
  const malformed = await store.create('Malformed');
  await rm(join(store.root, unreadable.id + '.json')); await mkdir(join(store.root, unreadable.id + '.json'));
  await writeFile(join(store.root, corrupt.id + '.json'), 'not json');
  await writeFile(join(store.root, malformed.id + '.json'), '{"updatedAt":null}');
  const warnings = [];
  const rows = await store.list({ onWarning: warning => warnings.push(warning) });
  assert.deepEqual(rows.map(row => row.id), [healthy.id]);
  assert.deepEqual(warnings, ['3 project files could not be opened and were skipped. Check their contents and access permissions.']);
  assert.equal(await readFile(join(store.root, corrupt.id + '.json'), 'utf8'), 'not json');
});
test('project directory listing failures show a plain access message', async t => {
  const { store, root } = await fixture(t);
  await rename(store.root, join(root, 'preserved-projects'));
  await writeFile(store.root, 'blocked directory');
  await assert.rejects(store.list(), { message: 'Could not list projects. Check access to your local data folder.' });
});
test('failed atomic writes hide paths, preserve the destination and remove temporary files', async t => {
  const { root } = await fixture(t);
  const target = join(root, 'blocked.json'); await mkdir(target);
  await writeFile(join(target, 'keep.txt'), 'keep');
  const message = 'Could not save local data. Check that your data folder is writable and has free space.';
  await assert.rejects(atomicJSON(target, { keep: true }), { message });
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'keep');
  assert.equal((await readdir(root)).some(name => name.endsWith('.tmp')), false);
  await assert.rejects(atomicJSON(join(root, 'missing-parent', 'record.json'), {}), { message });
});


test('a real project save permission failure returns a plain message and preserves the saved revision', async t => {
  if (!process.getuid || process.getuid() === 0 || process.platform === 'win32') return t.skip('Requires ordinary POSIX permission enforcement');
  const { root, store } = await fixture(t); const record = await store.create('Original');
  const app = await startServer({ port: 0, dataDir: root });
  try {
    await chmod(store.root, 0o500);
    const response = await fetch(app.origin + '/api/projects/' + record.id, { method: 'PUT', headers: { 'x-benchmark-token': app.token, 'content-type': 'application/json' }, body: JSON.stringify({ revision: record.revision, draft: { spec: { name: 'Unsaved', catalog: [], tasks: [] } } }) });
    assert.ok(!response.ok);
    assert.deepEqual(await response.json(), { error: 'Could not save local data. Check that your data folder is writable and has free space.' });
    assert.deepEqual(await store.read(record.id), record);
  } finally { await chmod(store.root, 0o700); await app.close(); }
});
