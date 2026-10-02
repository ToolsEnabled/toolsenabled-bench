import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registryDraft } from '../tools/registry-draft.mjs';

test('Registry description is supplied verbatim and invalid or missing text writes nothing', async t => {
  const work = await mkdtemp(join(tmpdir(), 'bench-registry-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const artifact = join(work, 'dev.mcpb'), url = 'https://example.org/bench.mcpb';
  await writeFile(artifact, 'development fixture');
  for (const [i, description] of ['A', 'Z'.repeat(100), 'A deliberate, supplied Registry description.'].entries()) {
    const output = join(work, `valid-${i}.json`);
    const record = await registryDraft({ artifact, url, output, description, development: true });
    assert.equal(record.description, description);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).description, description);
  }
  for (const [i, description] of [undefined, null, '', ' ', 'x'.repeat(101), 42].entries()) {
    const output = join(work, `invalid-${i}.json`);
    await assert.rejects(registryDraft({ artifact, url, output, description }), /description.*1.*100/i);
    await assert.rejects(access(output), { code: 'ENOENT' });
  }
  const description = 'CLI text remains exactly as supplied.', output = join(work, 'cli.json');
  await promisify(execFile)(process.execPath, [resolve('tools/registry-draft.mjs'), '--artifact', artifact, '--url', url, '--output', output, '--description', description, '--development']);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).description, description);
  const configured = JSON.parse(await readFile(resolve('release-config.json'), 'utf8')).registryDescription;
  await promisify(execFile)(process.execPath, [resolve('tools/registry-draft.mjs'), '--artifact', artifact, '--url', url, '--output', output, '--development']);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).description, configured);
});

test('Registry draft hashes exact artifact bytes, stays unpublished, and cannot overwrite plugin or artifact', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-registry-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const artifact = join(dir, 'signed.mcpb'), output = join(dir, 'server.json'), bytes = Buffer.from('fixture artifact bytes');
  await writeFile(artifact, bytes);
  const url = 'https://github.com/ToolsEnabled/toolsenabled-bench/releases/download/v0.3.2/toolsenabled-bench-0.3.2.mcpb';
  const value = await registryDraft({ description: 'Exact artifact metadata fixture.', artifact, output, url, development: true });
  assert.equal(value.packages[0].fileSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(value.packages[0].identifier, url);
  assert.equal(value._meta['io.modelcontextprotocol.registry/publisher-provided'].status, 'unpublished-development-draft');
  assert.equal(value._meta['io.modelcontextprotocol.registry/publisher-provided'].artifactSignatureVerifiedByGenerator, false);
  assert.deepEqual(JSON.parse(await readFile(output)), value);
  for (const target of [artifact, resolve(import.meta.dirname, '../server.json')]) await assert.rejects(registryDraft({ description: 'Exact artifact metadata fixture.', artifact, output: target, url }), /must stay outside/);
  assert.deepEqual(await readFile(artifact), bytes);
  for (const bad of ['http://example.org/x.mcpb', 'https://a:b@example.org/x.mcpb', 'https://example.org/x.mcpb?token=x', 'https://example.org/x.zip']) await assert.rejects(registryDraft({ description: 'Exact artifact metadata fixture.', artifact, output, url: bad }), /exact HTTPS/);
  const link = join(dir, 'linked.json'); await symlink(artifact, link);
  await assert.rejects(registryDraft({ description: 'Exact artifact metadata fixture.', artifact, output: link, url }), /symlinks/);
  assert.deepEqual(await readFile(artifact), bytes);
});
