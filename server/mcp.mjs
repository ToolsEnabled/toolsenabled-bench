import { readFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema } from './mcp-sdk.mjs';
import { createBenchService, MAX_INPUT_BYTES } from './mcp-service.mjs';
import { DataRootLeaseError } from './data-root-lease.mjs';

// Limit each newline-delimited SDK message before it can fill the SDK buffer.
let messageBytes = 0;
const input = new Transform({ transform(chunk, encoding, done) {
  for (const byte of chunk) {
    messageBytes = byte === 10 ? 0 : messageBytes + 1;
    if (messageBytes > MAX_INPUT_BYTES + 4096) return done(new Error('MCP message exceeds the input bound.'));
  }
  done(null, chunk);
} });
let service, server, closing, startup, stopping = false;
const shutdown = () => {
  stopping = true;
  return closing ??= (async () => {
  await startup?.catch(() => {});
  process.stdin.unpipe(input); process.stdin.pause();
  await service?.close(); await server?.close(); input.destroy();
})();
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown());
process.stdin.once('end', () => void shutdown());
process.stdout.once('error', () => void shutdown());
input.once('error', () => { process.exitCode = 1; void shutdown(); });
startup = (async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  service = await createBenchService();
  if (stopping) return;
  server = new Server({ name: 'toolsenabled-bench', version }, { capabilities: { tools: {} },
    instructions: 'Bench stores local projects and frozen studies. Run and qualify execute declared code: confirm must name the studyId; foreign studies also need explicit trust. Start with composition.update for an authored recorded diagnostic. No hosted service.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: service.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async request => service.callTool(request.params.name, request.params.arguments));
  // Exceptions and SDK diagnostics may carry user input. Never log them.
  server.onerror = () => {};
  const transport = new StdioServerTransport(input, process.stdout);
  await server.connect(transport);
  if (!stopping) process.stdin.pipe(input);
})();
try { await startup; }
catch (error) {
  process.stderr.write(error instanceof DataRootLeaseError ? error.message + '\n' : 'Bench MCP could not start. Verify the runtime build and local data directory.\n');
  process.exitCode = 1; await shutdown();
}
