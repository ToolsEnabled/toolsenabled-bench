import test from 'node:test';
import assert from 'node:assert/strict';
import { win32, posix } from 'node:path';
import { isAbsoluteStatePath } from '../server/plugin-state.mjs';

test('Windows state paths require an explicit drive root or UNC share', () => {
  for (const value of ['\\folder', '/folder', 'C:folder', '~', '', undefined, '\\\\server', '\\\\?\\C:\\folder', '\\\\.\\pipe\\bench'])
    assert.equal(isAbsoluteStatePath(value, win32), false, String(value));
  for (const value of ['C:\\folder', 'd:/private state', '\\\\server\\share\\folder', '//server.example/share/folder'])
    assert.equal(isAbsoluteStatePath(value, win32), true, value);
  assert.equal(isAbsoluteStatePath('/private state', posix), true);
  assert.equal(isAbsoluteStatePath('relative', posix), false);
});

test('state configuration errors name both the environment variable and the Claude option', async () => {
  const { pluginStateDirectory } = await import('../server/plugin-state.mjs');
  await assert.rejects(pluginStateDirectory('/unused-root', undefined), error => {
    assert.match(error.message, /Set BENCHMARK_DATA_DIR/);
    assert.match(error.message, /Claude plugin's data_directory option/);
    assert.ok(!error.message.includes('/unused-root'));
    return true;
  });
});
