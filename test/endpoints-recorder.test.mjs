import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const run = promisify(execFile);
test('endpoint recorder measures the stored frozen project without writing or restamping it', async () => {
  const baseline = new URL('../tools/test/fixtures/research-benchmark-endpoints-baseline.json', import.meta.url);
  const project = new URL('../tools/test/fixtures/research-benchmark-endpoints-project.json.gz', import.meta.url);
  const before = await Promise.all([readFile(baseline), readFile(project)]);
  const { stdout, stderr } = await run(process.execPath, ['tools/record-research-benchmark-endpoints-baseline.mjs'], { cwd: new URL('..', import.meta.url), timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(stderr, '');
  assert.match(stdout, /Nothing to record: every digest/);
  assert.doesNotMatch(stdout, /THE FROZEN IDENTITY MOVED|UNEXPLAINED/);
  assert.deepEqual(await Promise.all([readFile(baseline), readFile(project)]), before);
});
