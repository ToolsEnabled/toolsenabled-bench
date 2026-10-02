// Build only: invoke the pinned, unmodified mcpb CLI with a fixed ZIP clock.
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkOutputFile, outputDirectoryFor, releaseFiles } from './release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(args, env) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || 'mcpb failed');
  return result.stdout.trim();
}
export async function packageMcpb({ cli, output }) {
  cli = resolve(cli); output = resolve(output);
  const part = relative(root, output);
  if (part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep))) throw new Error('MCPB output must stay outside the plugin installation.');
  if (run([cli, '--version']) !== '2.1.2') throw new Error('Use the locked mcpb CLI 2.1.2.');
  await outputDirectoryFor(dirname(output)); await checkOutputFile(output);
  const { files } = await releaseFiles(root);
  if (files.has('server.json')) throw new Error('Registry metadata must remain outside the plugin payload.');
  const stage = await mkdtemp(join(tmpdir(), 'bench-mcpb-'));
  try {
    for (const [name, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) {
      const target = join(stage, name); await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes); await chmod(target, 0o644);
    }
    // The stage contains only our checked allowlist. Override CLI defaults that
    // otherwise silently omit package-lock.json and break the release inventory.
    await writeFile(join(stage, '.mcpbignore'), '!**\n.mcpbignore\n');
    const env = { ...process.env, SOURCE_DATE_EPOCH: '1767225600', TZ: 'UTC' }; delete env.DISPLAY;
    run(['--require', join(root, 'tools/mcpb-clock.cjs'), cli, 'pack', stage, output], env);
    const bytes = await readFile(output);
    return { archive: output, sha256: hash(bytes), bytes: bytes.length, files: files.size, mcpb: '2.1.2', sourceDateEpoch: env.SOURCE_DATE_EPOCH, signed: false };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--mcpb-cli' || args[2] !== '--output') throw new Error('Usage: node tools/package-mcpb.mjs --mcpb-cli /absolute/cli.js --output /outside/bench.mcpb');
    console.log(JSON.stringify(await packageMcpb({ cli: args[1], output: args[3] }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
