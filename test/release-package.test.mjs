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
    'README.md', 'LICENSE', 'NOTICE', 'CITATION.cff', 'ATTRIBUTION.md', 'release-config.json',
    'THIRD-PARTY-LICENSES.md', 'EXTRACTION.json', 'CONTRIBUTING.md', 'index.html',
    'tools/build.mjs', 'tools/plugin-bundle.mjs', 'tools/check-benchmark-core-independent.mjs',
    'tools/release.mjs', 'tools/mcp-bundle.mjs', 'tools/mcp-sdk-entry.mjs', 'tools/mcp-config.mjs',
    'tools/package-mcpb.mjs', 'tools/mcpb-clock.cjs', 'tools/registry-draft.mjs',
    'tools/mcpb-build/package.json', 'tools/mcpb-build/package-lock.json',
    'skills/toolsenabled-bench/SKILL.md', 'server/mcp-plugin.mjs', 'server/plugin-state.mjs',
    'server/mcp.mjs', 'server/mcp-service.mjs', 'server/local-origin.mjs', 'server/data-root-lease.mjs', 'server/mcp-sdk.mjs', 'docs/MCP-LICENSES.md', 'server/main.mjs', 'server/runs.mjs', 'server/store.mjs',
    'src/benchmark/study.mjs', 'src/benchmark/cli.mjs', 'src/benchmark/plugins.mjs',
    'src/app/main.js', 'dist/index.html', 'dist/assets/app.js',
    'plugins/example.mjs', 'docs/ARCHITECTURE.md',
  ]) await put(name, `Fixture: ${name}\n`);
  for (const name of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'manifest.json', '.mcp.json']) {
    const value = JSON.parse(await readFile(join(repo, name), 'utf8'));
    if (value.version) value.version = '0.2.0';
    await put(name, JSON.stringify(value));
  }
  await put('plugins.json', '["./plugins/example.mjs"]\n');
  const pluginMetadata = {
    format: 'benchmark-plugin-package', version: 1,
    entries: ['./plugins/example.mjs'], runtimeEntries: [],
    sourceHashes: { 'plugins/example.mjs': digest(await readFile(join(root, 'plugins/example.mjs'))) },
    payloadSha256: digest(''),
  };
  const writePluginMetadata = () => put('src/benchmark/plugins.mjs', '// benchmark-plugin-package: ' + JSON.stringify(pluginMetadata) + '\n');
  await writePluginMetadata();
  await put('package.json', JSON.stringify({ name: '@toolsenabled/benchmark-builder', version: '0.2.0', engines: { node: '>=22.19.0' }, devDependencies: { '@modelcontextprotocol/sdk': '1.26.0' } }));
  await put('package-lock.json', JSON.stringify({ version: '0.2.0', packages: { '': { version: '0.2.0', devDependencies: { '@modelcontextprotocol/sdk': '1.26.0' } }, 'node_modules/@modelcontextprotocol/sdk': { version: '1.26.0' } } }));
  await put('server/mcp-sdk.json', JSON.stringify({ format: 'bench-mcp-sdk-bundle', version: 1, sdkVersion: '1.26.0', packages: [{ name: '@modelcontextprotocol/sdk', version: '1.26.0' }], sha256: digest(await readFile(join(root, 'server/mcp-sdk.mjs'))), entrySha256: digest(await readFile(join(root, 'tools/mcp-sdk-entry.mjs'))), licenseSha256: digest(await readFile(join(root, 'docs/MCP-LICENSES.md'))) }));
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
    'server.json',
  ]) await put(name, 'not part of the distribution');
  const first = await buildRelease({ root });
  const bytes = await readFile(first.archivePath), files = entries(bytes);
  assert.deepEqual(files.get(prefix + 'docs/review/example.png'), binary);
  assert.deepEqual([...files.keys()], [...files.keys()].sort());
  assert.ok(files.has(prefix + 'server/main.mjs'));
  assert.ok(files.has(prefix + 'src/benchmark/cli.mjs'));
  assert.ok(files.has(prefix + 'dist/assets/app.js'));
  assert.ok(files.has(prefix + 'tools/plugin-bundle.mjs'));
  const publicDotFiles = new Set([prefix + '.claude-plugin/plugin.json', prefix + '.codex-plugin/plugin.json', prefix + '.mcp.json']);
  assert.ok([...files.keys()].every(name => publicDotFiles.has(name) || !/(?:^|\/)\.|node_modules|tools\/test|\/test\/|\/release\//.test(name)));
  for (const name of ['.claude-plugin/plugin.json', '.mcp.json', 'manifest.json', 'skills/toolsenabled-bench/SKILL.md', 'server/mcp-plugin.mjs']) assert.ok(files.has(prefix + name), name);
  assert.ok(!files.has(prefix + 'server.json'), 'Registry metadata stays outside the plugin payload');
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

test('packaging refuses mismatched Claude identities and indirect launch commands', async t => {
  const { root, put } = await fixture(t);
  const plugin = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  await put('.claude-plugin/plugin.json', JSON.stringify({ ...plugin, version: '9.0.0' }));
  await assert.rejects(buildRelease({ root }), /Claude package identity/);
  await put('.claude-plugin/plugin.json', JSON.stringify(plugin));
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  mcp.mcpServers.bench.command = 'npm'; mcp.mcpServers.bench.args = ['run', 'mcp'];
  await put('.mcp.json', JSON.stringify(mcp));
  await assert.rejects(buildRelease({ root }), /launch Node directly/);
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


test('runtime archive includes the pinned MCP closure and registration helper', async t => {
  const { root } = await fixture(t);
  const built = await buildRelease({ root }); const files = entries(await readFile(built.archivePath));
  for (const name of ['server/mcp.mjs', 'server/mcp-sdk.mjs', 'server/mcp-sdk.json', 'server/mcp-service.mjs', 'server/local-origin.mjs', 'tools/mcp-config.mjs', 'tools/mcp-sdk-entry.mjs', 'tools/mcp-bundle.mjs', 'docs/MCP-LICENSES.md']) assert.ok(files.has(prefix + name), name);
  assert.match(files.get(prefix + 'RELEASE.md').toString(), /node server\/mcp.mjs/);
});
test('runtime has no install inputs and repacks identically without the development lock', async t => {
  const { root } = await fixture(t);
  const sourcePackage = await readFile(join(root, 'package.json'));
  const sourceLock = await readFile(join(root, 'package-lock.json'));
  const built = await buildRelease({ root });
  const bytes = await readFile(built.archivePath), files = entries(bytes);
  const pkg = JSON.parse(files.get(prefix + 'package.json'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'scripts'])
    assert.equal(pkg[field], undefined, field);
  assert.ok(![...files.keys()].some(name => /(?:package-lock|npm-shrinkwrap)\.json$/.test(name)));
  assert.ok(![...files.keys()].some(name => name.includes('/tools/mcpb-build/')));
  assert.equal(pkg.benchRuntime.sdkVersion, '1.26.0');
  assert.equal(pkg.benchRuntime.sourcePackageSha256, digest(sourcePackage));
  assert.equal(pkg.benchRuntime.sourceLockSha256, digest(sourceLock));
  const extracted = join(root, 'runtime');
  for (const [name, contents] of files) {
    const path = join(extracted, name.slice(prefix.length));
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents);
  }
  const repacked = await buildRelease({ root: extracted, outputDirectory: join(root, 'repacked') });
  assert.deepEqual(await readFile(repacked.archivePath), bytes);
  pkg.benchRuntime.sdkVersion = '1.27.0';
  await writeFile(join(extracted, 'package.json'), JSON.stringify(pkg));
  await assert.rejects(buildRelease({ root: extracted }), /MCP/);
});
test('packaging refuses missing or stale MCP SDK bundle bytes and floating pins', async t => {
  const { root, put } = await fixture(t);
  const source = await readFile(join(root, 'server/mcp-sdk.mjs'));
  await put('server/mcp-sdk.mjs', 'changed');
  await assert.rejects(buildRelease({ root }), /MCP/);
  await put('server/mcp-sdk.mjs', source);
  const pkg = JSON.parse(await readFile(join(root, 'package.json')));
  pkg.devDependencies['@modelcontextprotocol/sdk'] = '^1.26.0';
  await put('package.json', JSON.stringify(pkg));
  await assert.rejects(buildRelease({ root }), /MCP/);
  pkg.devDependencies['@modelcontextprotocol/sdk'] = '1.26.0';
  await put('package.json', JSON.stringify(pkg));
  await rm(join(root, 'server/mcp-sdk.mjs'));
  await assert.rejects(buildRelease({ root }));
});
