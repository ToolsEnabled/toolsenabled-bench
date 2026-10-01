import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function bundleMcp(root) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const version = pkg.devDependencies?.['@modelcontextprotocol/sdk'];
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Pin the MCP SDK to an exact version.');
  await mkdir(resolve(root, 'server'), { recursive: true });
  const result = await build({ absWorkingDir: root, entryPoints: ['tools/mcp-sdk-entry.mjs'],
    outfile: 'server/mcp-sdk.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22',
    metafile: true, preserveSymlinks: true, logLevel: 'silent', legalComments: 'inline',
    banner: { js: "import { createRequire as __benchCreateRequire } from 'node:module'; const require = __benchCreateRequire(import.meta.url);" } });
  for (const output of Object.values(result.metafile.outputs)) for (const item of output.imports)
    if (item.external && !isBuiltin(item.path)) throw new Error('MCP runtime has an unbundled dependency.');
  const packages = [...new Set(Object.keys(result.metafile.inputs).map(path => path.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
  const inventory = [], licenses = ['# Bundled MCP runtime licences', '', 'Generated from the exact locked packages used in server/mcp-sdk.mjs.', ''];
  for (const name of packages) {
    const directory = resolve(root, 'node_modules', name), info = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const files = (await readdir(directory)).filter(name => /^(?:licen[sc]e|copying)(?:\.|$)/i.test(name)).sort();
    if (!files.length) throw new Error(`Missing bundled dependency licence: ${name}`);
    inventory.push({ name, version: info.version, license: info.license });
    licenses.push(`## ${name} ${info.version}`, '');
    for (const file of files) licenses.push(await readFile(resolve(directory, file), 'utf8'), '');
  }
  if (!inventory.some(row => row.name === '@modelcontextprotocol/sdk' && row.version === version)) throw new Error('Installed MCP SDK differs from its exact pin.');
  await mkdir(resolve(root, 'docs'), { recursive: true });
  const licenseBytes = licenses.join('\n');
  await writeFile(resolve(root, 'docs/MCP-LICENSES.md'), licenseBytes);
  await writeFile(resolve(root, 'server/mcp-sdk.json'), JSON.stringify({ format: 'bench-mcp-sdk-bundle', version: 1,
    sdkVersion: version, packages: inventory, entrySha256: hash(await readFile(resolve(root, 'tools/mcp-sdk-entry.mjs'))),
    sha256: hash(await readFile(resolve(root, 'server/mcp-sdk.mjs'))), licenseSha256: hash(licenseBytes) }, null, 2) + '\n');
}
