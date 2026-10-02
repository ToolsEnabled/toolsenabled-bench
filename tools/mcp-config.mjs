import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAbsoluteStatePath, pluginStateDirectory } from '../server/plugin-state.mjs';
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node tools/mcp-config.mjs --client <claude|codex|deepseek|cursor|claude-desktop>';
const quote = value => process.platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
export function clientConfig(client, { root = appRoot, node = process.execPath, dataDir = process.env.BENCHMARK_DATA_DIR } = {}) {
  if (!['claude', 'claude-code', 'codex', 'deepseek', 'deepseek-harness', 'cursor', 'claude-desktop'].includes(client)) throw new Error(usage);
  const inside = (parent, child) => {
    const part = relative(parent, child);
    return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
  };
  if (!isAbsoluteStatePath(dataDir) || inside(resolve(root), dataDir) || inside(dataDir, resolve(root)))
    throw new Error('Set an absolute BENCHMARK_DATA_DIR outside the Bench installation before generating registration.');
  const entry = resolve(root, 'server/mcp.mjs');
  const row = { command: node, args: [entry], env: { BENCHMARK_DATA_DIR: resolve(dataDir) } };
  if (client === 'claude' || client === 'claude-code') return `claude mcp add --env ${quote('BENCHMARK_DATA_DIR=' + row.env.BENCHMARK_DATA_DIR)} --transport stdio bench -- ${quote(node)} ${quote(entry)}\n`;
  if (client === 'codex') return `codex mcp add bench --env ${quote('BENCHMARK_DATA_DIR=' + row.env.BENCHMARK_DATA_DIR)} -- ${quote(node)} ${quote(entry)}\n`;
  if (client === 'cursor' || client === 'claude-desktop') return JSON.stringify({ mcpServers: { bench: row } }, null, 2) + '\n';
  if (client === 'deepseek' || client === 'deepseek-harness') return `- id: mcp-bench\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: bench\n    transport: stdio\n    command: ${JSON.stringify(node)}\n    args: [${JSON.stringify(entry)}]\n    env:\n      BENCHMARK_DATA_DIR: ${JSON.stringify(row.env.BENCHMARK_DATA_DIR)}\n    toolCallTimeoutMs: 1800000\n`;
  throw new Error(usage);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--client') throw new Error(usage);
    const config = clientConfig(process.argv[3]);
    await pluginStateDirectory(appRoot, process.env.BENCHMARK_DATA_DIR);
    process.stdout.write(config);
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
