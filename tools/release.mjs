#!/usr/bin/env node
// Runtime distribution: built browser assets plus the sources used by the local
// host and frozen exports. No package manager, network, Git metadata or clock is
// consulted while packaging. ZIP entries are stored with fixed metadata.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT = 'ToolsEnabled BenchMark Builder';
const MANIFEST = 'RELEASE-MANIFEST.json';
const TOP_LEVEL = [
  'package.json', 'package-lock.json', 'plugins.json', 'index.html',
  'README.md', 'LICENSE', 'NOTICE', 'CITATION.cff', 'ATTRIBUTION.md',
  'THIRD-PARTY-LICENSES.md', 'EXTRACTION.json', 'CONTRIBUTING.md',
];
const TOOL_FILES = [
  'tools/build.mjs', 'tools/plugin-bundle.mjs',
  'tools/check-benchmark-core-independent.mjs', 'tools/release.mjs',
];
const TREES = new Map([
  ['src', new Set(['.js', '.mjs', '.css', '.json', '.svg', '.py'])],
  ['server', new Set(['.mjs'])],
  ['plugins', new Set(['.js', '.mjs', '.json', '.txt', '.csv', '.py', '.md'])],
  ['dist', new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.map'])],
  ['docs', new Set(['.md', '.txt', '.json', '.png', '.jpg', '.jpeg', '.svg'])],
]);
const REQUIRED = [
  ...TOP_LEVEL, ...TOOL_FILES, 'server/main.mjs', 'server/runs.mjs',
  'server/store.mjs', 'src/benchmark/study.mjs', 'src/benchmark/cli.mjs',
  'src/benchmark/plugins.mjs', 'src/app/main.js', 'dist/index.html',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (value, message) => { if (!value) throw new Error(message); };

function safePath(name) {
  return typeof name === 'string' && name.length > 0 &&
    !/[\\:\x00-\x1f\x7f]/.test(name) &&
    name.split('/').every(part => part && part !== '.' && part !== '..' &&
      !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

async function regularFile(root, name) {
  requireValue(safePath(name), `Unsafe release path: ${name}`);
  const parts = name.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const path = resolve(root, ...parts.slice(0, i));
    const stat = await lstat(path);
    requireValue(!stat.isSymbolicLink(), `Release paths must not be symlinks: ${name}`);
    requireValue(i === parts.length ? stat.isFile() : stat.isDirectory(), `Not a regular release file: ${name}`);
  }
  return readFile(resolve(root, name));
}

async function collectFiles(root) {
  const rootStat = await lstat(root);
  requireValue(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Release root must be a real directory.');
  const files = new Map();
  for (const name of [...TOP_LEVEL, ...TOOL_FILES]) files.set(name, await regularFile(root, name));
  for (const [tree, extensions] of TREES) {
    async function walk(name) {
      const stat = await lstat(resolve(root, name));
      requireValue(!stat.isSymbolicLink(), `Release paths must not be symlinks: ${name}`);
      if (stat.isDirectory()) {
        for (const child of (await readdir(resolve(root, name))).sort()) {
          if (child.startsWith('.') || child === 'node_modules' || child === 'release') continue;
          await walk(`${name}/${child}`);
        }
      } else if (extensions.has(extname(name))) {
        requireValue(stat.isFile(), `Not a regular release file: ${name}`);
        files.set(name, await regularFile(root, name));
      }
    }
    await walk(tree);
  }
  for (const name of REQUIRED) requireValue(files.has(name), `Required release file is missing: ${name}`);
  requireValue([...files.keys()].some(name => /^dist\/assets\/.+\.js$/.test(name)), 'Build the browser application before packaging.');
  return files;
}

function checkPluginClosure(files) {
  const configured = JSON.parse(files.get('plugins.json').toString('utf8'));
  const plugins = Array.isArray(configured) ? { extensions: configured, runtime: [] } : configured;
  requireValue(plugins && Array.isArray(plugins.extensions) && Array.isArray(plugins.runtime), 'plugins.json needs extensions and runtime arrays.');
  requireValue(plugins.extensions.every(name => typeof name === 'string' && name.startsWith('./') && name.endsWith('.mjs') && safePath(name.slice(2))), 'Configured plugin entries must use safe local paths.');
  const records = files.get('src/benchmark/plugins.mjs').toString('utf8').split('\n')
    .filter(line => line.startsWith('// benchmark-plugin-package: '));
  requireValue(records.length === 1, 'Build the configured plugin package before packaging.');
  const metadata = JSON.parse(records[0].slice('// benchmark-plugin-package: '.length));
  requireValue(metadata?.format === 'benchmark-plugin-package' && metadata.version === 1 &&
    Array.isArray(metadata.entries) && Array.isArray(metadata.runtimeEntries) && metadata.sourceHashes &&
    typeof metadata.sourceHashes === 'object' && !Array.isArray(metadata.sourceHashes), 'Invalid plugin package source inventory.');
  requireValue(JSON.stringify(metadata.entries) === JSON.stringify(plugins.extensions), 'Configured plugin entries differ from the build. Run npm run build.');
  requireValue(JSON.stringify(metadata.runtimeEntries) === JSON.stringify(plugins.runtime.map(entry => entry?.module)), 'Configured runtime plugin entries differ from the build. Run npm run build.');
  for (const name of plugins.extensions) {
    requireValue(Object.hasOwn(metadata.sourceHashes, name.slice(2)), `Configured plugin entry is not source-bound: ${name}`);
  }
  for (const [name, hash] of Object.entries(metadata.sourceHashes)) {
    requireValue(safePath(name) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'Invalid plugin package source path or hash.');
    requireValue(files.has(name), `Required plugin source is not included: ${name}`);
    requireValue(sha256(files.get(name)) === hash, `Plugin source differs from the bundled version: ${name}. Run npm run build.`);
  }
  for (const entry of plugins.runtime) {
    requireValue(typeof entry?.module === 'string' && /^[a-zA-Z0-9_-]+\.mjs$/.test(entry.module) &&
      Array.isArray(entry.files) && entry.files.includes(entry.module), 'Runtime plugins must inventory their entry module and dependencies.');
    for (const name of entry.files) {
      requireValue(typeof name === 'string' && /^[a-zA-Z0-9_-]+\.(mjs|py)$/.test(name), 'Runtime plugin dependencies must use local module filenames.');
      requireValue(files.has('src/benchmark/' + name), `Required runtime plugin file is not included: src/benchmark/${name}`);
    }
  }
}

async function outputDirectoryFor(requested) {
  const directory = resolve(requested), parents = [];
  for (let path = directory; ; path = dirname(path)) {
    parents.unshift(path);
    if (dirname(path) === path) break;
  }
  // Inspect each ancestor before visiting its children, so a linked directory
  // cannot redirect even the creation of a missing output subdirectory.
  for (const path of parents) {
    let stat;
    try { stat = await lstat(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await mkdir(path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      stat = await lstat(path);
    }
    requireValue(!stat.isSymbolicLink(), `Release output paths must not be symlinks: ${path}`);
    requireValue(stat.isDirectory(), `Release output path is not a directory: ${path}`);
  }
  return directory;
}

async function checkOutputFile(path) {
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  requireValue(!stat.isSymbolicLink(), `Release output paths must not be symlinks: ${path}`);
  requireValue(stat.isFile(), `Release output path is not a regular file: ${path}`);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

export function releaseZip(files) {
  const names = [...files.keys()].sort();
  requireValue(names.length <= 65535, 'Release exceeds the ZIP entry limit.');
  const folded = new Set(), local = [], central = [];
  let offset = 0, centralSize = 0;
  for (const name of names) {
    requireValue(safePath(name), `Unsafe release path: ${name}`);
    requireValue(!folded.has(name.toLowerCase()), `Case-colliding release path: ${name}`);
    folded.add(name.toLowerCase());
    const filename = Buffer.from(name), bytes = files.get(name);
    requireValue(Buffer.isBuffer(bytes), `Release file must contain bytes: ${name}`);
    requireValue(filename.length <= 65535 && bytes.length <= 0xffffffff, `Release entry is too large: ${name}`);
    const crc = crc32(bytes), header = Buffer.alloc(30 + filename.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // ZIP 2.0
    header.writeUInt16LE(0x0800, 6); // UTF-8; store, no extra fields
    header.writeUInt16LE(33, 12); // 1980-01-01 00:00:00
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    filename.copy(header, 30);
    const entry = Buffer.alloc(46 + filename.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // Unix, fixed regular-file mode
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(bytes.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    filename.copy(entry, 46);
    local.push(header, bytes);
    central.push(entry);
    offset += header.length + bytes.length;
    centralSize += entry.length;
    requireValue(offset + centralSize <= 0xffffffff, 'Release exceeds the ZIP size limit.');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function releaseReadme(pkg) {
  return `# ${PRODUCT} ${pkg.version}\n\n` +
    `This is the standalone runtime distribution. Requires Node.js ${pkg.engines.node}.\n` +
    'The prebuilt application and exported-study runtime are included. No account or package installation is required to serve this archive.\n\n' +
    '## Run offline\n\n' +
    'Extract the ZIP, open its directory, and run:\n\n```sh\nnode tools/release.mjs --verify\nnode server/main.mjs\n```\n\n' +
    'Open http://127.0.0.1:4318. The server binds only to 127.0.0.1. Projects and runs are stored in `.benchmark-data/` in the extracted directory. Back up that directory. `BENCHMARK_DATA_DIR` and `BENCHMARK_PORT` can select another local data directory and port.\n\n' +
    'The examples are authored recorded controls, with no live model-result claims. External collectors require their separately declared environment. Optional native Lean execution requires its Python/Docker apparatus; it is not needed for the recorded examples.\n\n' +
    '## Rebuild or repackage\n\n' +
    'Browser, plugin, and server sources are included. Rebuilding requires the locked development dependencies (`npm ci`), then `npm run build`. Serving the existing build needs no dependencies. Repackage unchanged included files with `node tools/release.mjs`; archives use sorted paths, stored bytes, fixed timestamps and fixed file modes. The sibling `.sha256` file hashes the complete ZIP. `RELEASE-MANIFEST.json` hashes each included file except itself; it is an integrity inventory, not a signature or proof of publisher identity.\n\n' +
    'This runtime distribution omits development test suites and historical test fixtures. The source-checkout validation commands in README.md (`npm test`, `npm run test:standalone`, `npm run test:browser`) apply to the full source repository. The included `npm run check:core` can be used after rebuilding.\n';
}

export async function buildRelease({ root = sourceRoot, outputDirectory = resolve(root, 'release') } = {}) {
  root = resolve(root);
  const files = await collectFiles(root);
  const pkg = JSON.parse(files.get('package.json').toString('utf8'));
  requireValue(pkg.name === '@toolsenabled/benchmark-builder', 'Unexpected release package identity.');
  requireValue(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version), 'Release version must be a safe semantic version.');
  requireValue(typeof pkg.engines?.node === 'string', 'Release package must declare a Node.js version.');
  const lock = JSON.parse(files.get('package-lock.json').toString('utf8'));
  requireValue(lock.version === pkg.version && lock.packages?.['']?.version === pkg.version, 'Package and lockfile versions differ.');
  checkPluginClosure(files);
  files.set('RELEASE.md', Buffer.from(releaseReadme(pkg)));
  const manifest = {
    format: 'toolsenabled-benchmark-builder-release', version: 1,
    product: { name: PRODUCT, version: pkg.version },
    files: Object.fromEntries([...files.keys()].sort().map(name => [name, {
      sha256: sha256(files.get(name)), bytes: files.get(name).length,
    }])),
  };
  files.set(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  const directoryName = `toolsenabled-benchmark-builder-${pkg.version}`;
  const archive = releaseZip(new Map([...files].map(([name, bytes]) => [`${directoryName}/${name}`, bytes])));
  const archiveName = `${directoryName}.zip`, digest = sha256(archive);
  outputDirectory = await outputDirectoryFor(outputDirectory);
  const archivePath = resolve(outputDirectory, archiveName), checksumPath = archivePath + '.sha256';
  await checkOutputFile(archivePath);
  await checkOutputFile(checksumPath);
  const flag = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
  await writeFile(archivePath, archive, { flag });
  await writeFile(checksumPath, `${digest}  ${archiveName}\n`, { flag });
  return { archivePath, checksumPath, sha256: digest, bytes: archive.length, files: files.size };
}

export async function verifyRelease(root = sourceRoot) {
  root = resolve(root);
  const manifest = JSON.parse((await regularFile(root, MANIFEST)).toString('utf8'));
  requireValue(manifest.format === 'toolsenabled-benchmark-builder-release' && manifest.version === 1 &&
    manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'Unrecognized release manifest.');
  for (const name of [...REQUIRED, 'RELEASE.md']) requireValue(Object.hasOwn(manifest.files, name), `Required release file is not inventoried: ${name}`);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = await regularFile(root, name);
    requireValue(bytes.length === expected.bytes && sha256(bytes) === expected.sha256, `Release integrity check failed: ${name}`);
  }
  const pkg = JSON.parse((await regularFile(root, 'package.json')).toString('utf8'));
  requireValue(manifest.product?.name === PRODUCT && manifest.product.version === pkg.version, 'Release manifest identity differs from package.json.');
  return { version: pkg.version, files: Object.keys(manifest.files).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === '--verify') {
      const result = await verifyRelease();
      console.log(`Verified ${PRODUCT} ${result.version}: ${result.files} files.`);
    } else {
      requireValue(args.length === 0 || (args.length === 2 && args[0] === '--output'), 'Usage: node tools/release.mjs [--output DIRECTORY | --verify]');
      const result = await buildRelease(args.length ? { outputDirectory: resolve(args[1]) } : {});
      console.log(`${result.archivePath}\nSHA-256 ${result.sha256}\n${result.files} files; ${result.bytes} bytes`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
