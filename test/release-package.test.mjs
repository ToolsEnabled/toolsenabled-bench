import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease, releaseZip, verifyRelease } from '../tools/release.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(repo, '.release-work');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const prefix = 'toolsenabled-benchmark-builder-0.2.0/';

async function fixture(t) {
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(join(work, 'release-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, value) => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), value);
  };
  for (const name of [
    'README.md', 'LICENSE', 'NOTICE', 'CITATION.cff', 'ATTRIBUTION.md',
    'THIRD-PARTY-LICENSES.md', 'EXTRACTION.json', 'CONTRIBUTING.md', 'index.html',
    'tools/build.mjs', 'tools/plugin-bundle.mjs', 'tools/check-benchmark-core-independent.mjs',
    'tools/release.mjs', 'server/main.mjs', 'server/runs.mjs', 'server/store.mjs',
    'src/benchmark/study.mjs', 'src/benchmark/cli.mjs', 'src/benchmark/plugins.mjs',
    'src/app/main.js', 'dist/index.html', 'dist/assets/app.js',
    'plugins/example.mjs', 'docs/ARCHITECTURE.md',
  ]) await put(name, `Fixture: ${name}\n`);
  await put('plugins.json', '["./plugins/example.mjs"]\n');
  const pluginMetadata = {
    format: 'benchmark-plugin-package', version: 1,
    entries: ['./plugins/example.mjs'], runtimeEntries: [],
    sourceHashes: { 'plugins/example.mjs': digest(await readFile(join(root, 'plugins/example.mjs'))) },
    payloadSha256: digest(''),
  };
  const writePluginMetadata = () => put('src/benchmark/plugins.mjs', '// benchmark-plugin-package: ' + JSON.stringify(pluginMetadata) + '\n');
  await writePluginMetadata();
  await put('package.json', JSON.stringify({ name: '@toolsenabled/benchmark-builder', version: '0.2.0', engines: { node: '>=22.19.0' } }));
  await put('package-lock.json', JSON.stringify({ version: '0.2.0', packages: { '': { version: '0.2.0' } } }));
  return { root, put, pluginMetadata, writePluginMetadata };
}

// Independent reader for the stored entries this distribution promises. The
// central directory is checked too, so timestamp/mode assertions concern what
// standard ZIP extractors actually use.
function entries(zip) {
  const files = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(zip.readUInt16LE(offset + 8), 0, 'entries are stored');
    const size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26);
    const extra = zip.readUInt16LE(offset + 28), name = zip.subarray(offset + 30, offset + 30 + length).toString();
    const start = offset + 30 + length + extra;
    files.set(name, zip.subarray(start, start + size));
    offset = start + size;
  }
  let centralCount = 0;
  while (zip.readUInt32LE(offset) === 0x02014b50) {
    assert.equal(zip.readUInt16LE(offset + 12), 0);
    assert.equal(zip.readUInt16LE(offset + 14), 33);
    assert.equal(zip.readUInt32LE(offset + 38) >>> 16, 0o100644);
    offset += 46 + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    centralCount++;
  }
  assert.equal(zip.readUInt32LE(offset), 0x06054b50);
  assert.equal(centralCount, files.size);
  assert.equal(zip.readUInt16LE(offset + 10), files.size);
  return files;
}

test('runtime archive preserves binary files, is deterministic across mtimes, and excludes local/development files', async t => {
  const { root, put } = await fixture(t);
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe, 0xc3, 0x28, 10]);
  await put('docs/review/example.png', binary);
  for (const name of [
    '.git/config', '.benchmark-data/projects/private.json', '.release-work/private.txt',
    'node_modules/example/index.js', 'tools/test/fixtures/fleet-native.mjs',
    'test/development.test.mjs', 'release/previous.zip', 'src/.private.json',
    'plugins/.env', 'plugins/node_modules/dependency/index.js',
  ]) await put(name, 'not part of the distribution');
  const first = await buildRelease({ root });
  const bytes = await readFile(first.archivePath), files = entries(bytes);
  assert.deepEqual(files.get(prefix + 'docs/review/example.png'), binary);
  assert.deepEqual([...files.keys()], [...files.keys()].sort());
  assert.ok(files.has(prefix + 'server/main.mjs'));
  assert.ok(files.has(prefix + 'src/benchmark/cli.mjs'));
  assert.ok(files.has(prefix + 'dist/assets/app.js'));
  assert.ok(files.has(prefix + 'tools/plugin-bundle.mjs'));
  assert.ok([...files.keys()].every(name => !/(?:^|\/)\.|node_modules|tools\/test|\/test\/|\/release\//.test(name)));
  const readme = files.get(prefix + 'RELEASE.md').toString();
  assert.match(readme, /node server\/main.mjs/);
  assert.match(readme, /runtime distribution omits development test suites/);
  const manifest = JSON.parse(files.get(prefix + 'RELEASE-MANIFEST.json').toString());
  assert.equal(manifest.files['docs/review/example.png'].sha256, digest(binary));
  assert.equal(Object.keys(manifest.files).length, files.size - 1);
  assert.equal(await readFile(first.checksumPath, 'utf8'), `${digest(bytes)}  toolsenabled-benchmark-builder-0.2.0.zip\n`);
  for (const name of Object.keys(manifest.files)) {
    assert.equal(manifest.files[name].sha256, digest(files.get(prefix + name)), name);
    if (name !== 'RELEASE.md') await utimes(join(root, name), new Date('2001-01-01'), new Date('2040-01-01'));
  }
  const second = await buildRelease({ root });
  assert.equal(second.sha256, first.sha256);
  assert.deepEqual(await readFile(second.archivePath), bytes);
  const extracted = join(root, 'extracted');
  for (const [name, contents] of files) {
    const path = join(extracted, name.slice(prefix.length));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  assert.deepEqual(await verifyRelease(extracted), { version: '0.2.0', files: files.size - 1 });
  await writeFile(join(extracted, 'docs/review/example.png'), 'changed');
  await assert.rejects(verifyRelease(extracted), /Release integrity check failed: docs\/review\/example.png/);
});

test('packaging rejects symlinks, incomplete builds, and inconsistent release versions', async t => {
  const { root, put } = await fixture(t);
  await symlink('example.mjs', join(root, 'plugins/linked.mjs'));
  await assert.rejects(buildRelease({ root }), /must not be symlinks/);
  await rm(join(root, 'plugins/linked.mjs'));
  await rm(join(root, 'dist/assets/app.js'));
  await assert.rejects(buildRelease({ root }), /Build the browser application/);
  await put('dist/assets/app.js', 'fixture');
  await put('package-lock.json', JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }));
  await assert.rejects(buildRelease({ root }), /Package and lockfile versions differ/);
});

test('ZIP paths cannot escape extraction or collide on case-insensitive filesystems', () => {
  for (const name of ['../outside', '/absolute', 'a/../../outside', 'a\\outside', 'C:/outside', 'a/NUL.txt', 'a/name.']) {
    assert.throws(() => releaseZip(new Map([[name, Buffer.from('fixture')]])), /Unsafe release path/);
  }
  assert.throws(() => releaseZip(new Map([['a.mjs', Buffer.alloc(0)], ['A.mjs', Buffer.alloc(0)]])), /Case-colliding release path/);
});

test('packaging refuses linked output directories and ancestors before writing', async t => {
  const { root } = await fixture(t);
  const target = join(root, 'output-target'), linked = join(root, 'output-link');
  await mkdir(target);
  await symlink('output-target', linked);
  for (const outputDirectory of [linked, join(linked, 'nested')]) {
    await assert.rejects(buildRelease({ root, outputDirectory }), /Release output paths must not be symlinks/);
    assert.deepEqual(await readdir(target), [], 'a rejected output link leaves its target unchanged');
  }
});

test('packaging refuses linked archive and checksum destinations without changing their targets', async t => {
  const { root, put } = await fixture(t);
  const sentinel = Buffer.from('existing bytes outside the output directory');
  await put('sentinel', sentinel);
  for (const suffix of ['', '.sha256']) {
    const outputDirectory = join(root, suffix ? 'checksum-output' : 'archive-output');
    await mkdir(outputDirectory);
    const name = 'toolsenabled-benchmark-builder-0.2.0.zip' + suffix;
    await symlink('../sentinel', join(outputDirectory, name));
    await assert.rejects(buildRelease({ root, outputDirectory }), /Release output paths must not be symlinks/);
    assert.deepEqual(await readFile(join(root, 'sentinel')), sentinel);
    assert.deepEqual(await readdir(outputDirectory), [name], 'all output destinations are checked before any archive write');
  }
});

test('packaging refuses omitted or changed plugin dependency bytes', async t => {
  const { root, put, pluginMetadata, writePluginMetadata } = await fixture(t);
  const dependency = 'plugins/helper.jsx', source = 'export default "plugin dependency";\n';
  await put(dependency, source);
  pluginMetadata.sourceHashes[dependency] = digest(source);
  await writePluginMetadata();
  await assert.rejects(buildRelease({ root }), /Required plugin source is not included: plugins\/helper.jsx/);
  delete pluginMetadata.sourceHashes[dependency];
  await writePluginMetadata();
  await put('plugins/example.mjs', 'changed after bundling');
  await assert.rejects(buildRelease({ root }), /Plugin source differs from the bundled version: plugins\/example.mjs/);
});

test('packaging requires plugin configuration and runtime dependency closure to match the build', async t => {
  const { root, put, pluginMetadata, writePluginMetadata } = await fixture(t);
  await put('plugins/other.mjs', 'export {};');
  await put('plugins.json', '["./plugins/other.mjs"]\n');
  await assert.rejects(buildRelease({ root }), /Configured plugin entries differ from the build/);
  const configured = { extensions: ['./plugins/example.mjs'], runtime: [{ module: 'domain.mjs', export: 'example', files: ['domain.mjs', 'domain.py'] }] };
  await put('plugins.json', JSON.stringify(configured));
  await assert.rejects(buildRelease({ root }), /Configured runtime plugin entries differ from the build/);
  pluginMetadata.runtimeEntries = ['domain.mjs'];
  await writePluginMetadata();
  await put('src/benchmark/domain.mjs', 'export const example = {};');
  await assert.rejects(buildRelease({ root }), /Required runtime plugin file is not included: src\/benchmark\/domain.py/);
  await put('src/benchmark/domain.py', '# recorded apparatus fixture\n');
  const release = await buildRelease({ root });
  assert.ok(entries(await readFile(release.archivePath)).has(prefix + 'src/benchmark/domain.py'));
  delete pluginMetadata.sourceHashes['plugins/example.mjs'];
  await writePluginMetadata();
  await assert.rejects(buildRelease({ root }), /Configured plugin entry is not source-bound/);
});
