// Plugin entry: persistent state must not live in the installation cache.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginStateDirectory } from './plugin-state.mjs';
try {
  await pluginStateDirectory(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.env.BENCHMARK_DATA_DIR);
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
if (!process.exitCode) await import('./mcp.mjs');
