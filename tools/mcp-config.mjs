import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node tools/mcp-config.mjs --client <claude|codex|deepseek|cursor|claude-desktop>';
const quote = value => process.platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
export function clientConfig(client, { root = appRoot, node = process.execPath, dataDir = process.env.BENCHMARK_DATA_DIR || resolve(root, '.benchmark-data') } = {}) {
  const entry = resolve(root, 'server/mcp.mjs');
  const row = { command: node, args: [entry], env: { BENCHMARK_DATA_DIR: resolve(dataDir) } };
  if (client === 'claude' || client === 'claude-code') return `claude mcp add --env ${quote('BENCHMARK_DATA_DIR=' + row.env.BENCHMARK_DATA_DIR)} --transport stdio bench -- ${quote(node)} ${quote(entry)}\n`;
  if (client === 'codex') return `codex mcp add bench --env ${quote('BENCHMARK_DATA_DIR=' + row.env.BENCHMARK_DATA_DIR)} -- ${quote(node)} ${quote(entry)}\n`;
  if (client === 'cursor' || client === 'claude-desktop') return JSON.stringify({ mcpServers: { bench: row } }, null, 2) + '\n';
  if (client === 'deepseek' || client === 'deepseek-harness') return `- id: mcp-bench\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: bench\n    transport: stdio\n    command: ${JSON.stringify(node)}\n    args: [${JSON.stringify(entry)}]\n    env:\n      BENCHMARK_DATA_DIR: ${JSON.stringify(row.env.BENCHMARK_DATA_DIR)}\n    toolCallTimeoutMs: 1800000\n`;
  throw new Error(usage);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 4 || process.argv[2] !== '--client') throw new Error(usage); process.stdout.write(clientConfig(process.argv[3])); }
  catch { process.stderr.write(usage + '\n'); process.exitCode = 1; }
}
