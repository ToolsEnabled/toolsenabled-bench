// Release metadata is generated outside the immutable plugin and ZIP inventories.
import { constants } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOutputFile, outputDirectoryFor } from './release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function registryDraft({ artifact, url, output, description, development = false }) {
  if (typeof description !== 'string' || !description.trim() || description.length > 100)
    throw new Error('Registry description must be supplied explicitly as 1–100 characters.');
  const release = new URL(url);
  if (release.protocol !== 'https:' || release.username || release.password || release.search || release.hash || !release.pathname.endsWith('.mcpb')) throw new Error('Supply an exact HTTPS .mcpb release URL without credentials or query/fragment.');
  output = resolve(output); artifact = resolve(artifact);
  const part = relative(root, output);
  if (part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)) || output === artifact) throw new Error('Registry output must stay outside the plugin and must not replace the artifact.');
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const bytes = await readFile(artifact);
  const record = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: 'ai.toolsenabled/bench', title: 'ToolsEnabled Bench',
    description,
    version, websiteUrl: 'https://toolsenabled.ai',
    repository: { url: 'https://github.com/ToolsEnabled/toolsenabled-bench', source: 'github' },
    packages: [{ registryType: 'mcpb', identifier: release.href, fileSha256: createHash('sha256').update(bytes).digest('hex'), transport: { type: 'stdio' } }],
    _meta: { 'io.modelcontextprotocol.registry/publisher-provided': {
      status: development ? 'unpublished-development-draft' : 'unpublished-release-draft',
      artifactSignatureVerifiedByGenerator: false, releaseUrlVerifiedByGenerator: false,
      requiresBeforeSubmission: ['Production signing and verification of the exact artifact', 'Native Desktop qualification', 'Published release URL and reviewed marketplace pins', 'Owner DNS namespace verification'],
    } },
  };
  await outputDirectoryFor(dirname(output)); await checkOutputFile(output);
  await writeFile(output, JSON.stringify(record, null, 2) + '\n', { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0) });
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), development = args.at(-1) === '--development'; if (development) args.pop();
    if (![6, 8].includes(args.length) || args[0] !== '--artifact' || args[2] !== '--url' || args[4] !== '--output' || (args.length === 8 && args[6] !== '--description')) throw new Error('Usage: node tools/registry-draft.mjs --artifact /outside/final-signed.mcpb --url https://release/file.mcpb --output /outside/server.json [--description "1–100 characters"] [--development]');
    const description = args.length === 8 ? args[7] : JSON.parse(await readFile(new URL('../release-config.json', import.meta.url), 'utf8')).registryDescription;
    const result = await registryDraft({ artifact: args[1], url: args[3], output: args[5], description, development });
    console.log(JSON.stringify({ output: resolve(args[5]), sha256: result.packages[0].fileSha256, status: result._meta['io.modelcontextprotocol.registry/publisher-provided'].status }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
