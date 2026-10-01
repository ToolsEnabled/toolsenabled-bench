import { mkdir, readFile, readdir, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ProjectStore } from './store.mjs';
import { RunStore } from './runs.mjs';
import { hasLocalOrigin } from './local-origin.mjs';
import { acquireDataRootLease } from './data-root-lease.mjs';
import { RUNTIME_FILES, bindRuntimeSources, freezeStudy, materializeCorpus, safePath } from '../src/benchmark/study.mjs';
import { newExperimentDraft, genericStarter } from '../src/benchmark/starters.mjs';
import { projectFiles } from '../src/benchmark/export.mjs';
import { openProject } from '../src/benchmark/cli.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
const projectId = { type: 'string', pattern: '^rp-[a-f0-9]{32}$' };
const studyId = { type: 'string', pattern: '^run-[a-f0-9]{32}$' };
const revision = { type: 'integer', minimum: 0 };
const object = { type: 'object' };
const paging = { offset: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const confirmed = { studyId, confirm: {}, trust: { type: 'boolean' } };
function tool(name, description, properties, required = [], readOnlyHint = false) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint, destructiveHint: !readOnlyHint, openWorldHint: name === 'study.run' || name === 'study.qualify' } };
}
const TOOLS = [
  tool('projects.list', 'List saved local project metadata. Page with offset and limit.', paging, [], true),
  tool('project.get', 'Read an editable project. Large projects return a size refusal; use atoms.list for catalog pages.', { projectId }, ['projectId'], true),
  tool('atoms.list', 'List catalog atoms in a local project.', { projectId, ...paging }, ['projectId'], true),
  tool('atom.add', 'Add a declared atom to a project at the specified revision.', { projectId, revision, atom: object }, ['projectId', 'revision', 'atom']),
  tool('composition.update', 'Create a project (default: recorded arithmetic example) or save its declared spec/draft. For a task-root edit, supply taskId and root. Existing projects require revision.', { projectId, revision, spec: object, draft: object, taskId: { type: 'string', minLength: 1, maxLength: 64 }, root: object }),
  tool('tasks.generate', 'Generate from an explicit corpus plan: declared choices, selection, rationale and 32-bit seed. No model call.', { projectId, revision, plan: object }, ['projectId', 'revision', 'plan']),
  tool('study.freeze', 'Freeze a saved revision with the installed runtime, without executing collectors; returns studyId.', { projectId, revision }, ['projectId', 'revision']),
  tool('study.qualify', 'EXECUTES declared study runtime and plugins with user authority. Set confirm to this studyId. Foreign studies also require trust:true after review. Requires matching installed runtime.', confirmed, ['studyId']),
  tool('study.export', 'Write a runnable ZIP inside the data root. Returns a relative local artifact reference, not ZIP content.', { studyId }, ['studyId']),
  tool('study.run', 'EXECUTES declared collectors/graders/plugins with user authority; may call models or paid services if declared. Set confirm to this studyId. Foreign studies also require trust:true after review. Returns after execution settles.', confirmed, ['studyId']),
  tool('study.analyze', 'Analyze retained evidence with installed nonexecuting inspection code. Does not regrade or call a model.', { studyId }, ['studyId']),
  tool('report.get', 'Read a bounded report or execution status. Text formats page by UTF-8 byte offset; redaction precedes pagination.', { studyId, format: { type: 'string', enum: ['summary', 'markdown', 'html', 'status'] }, offset: { type: 'integer', minimum: 0, maximum: 128 * 1024 * 1024 }, limit: { type: 'integer', minimum: 1, maximum: 16000 } }, ['studyId'], true),
];
class Refusal extends Error { constructor(code, message) { super(message); this.code = code; } }
const refuse = (code, message) => { throw new Refusal(code, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validate(args, schema) {
  if (!isObject(args) || Object.keys(args).some(key => !Object.hasOwn(schema.properties, key)) || schema.required.some(key => !Object.hasOwn(args, key)))
    refuse('INVALID_INPUT', 'Supply only the declared tool arguments and all required fields.');
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key];
    if (rule.type && !(rule.type === 'object' ? isObject(value) : rule.type === 'integer' ? Number.isSafeInteger(value) : typeof value === rule.type)
      || rule.pattern && !new RegExp(rule.pattern).test(value) || rule.enum && !rule.enum.includes(value)
      || rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum
      || rule.minLength !== undefined && value.length < rule.minLength || rule.maxLength !== undefined && value.length > rule.maxLength)
      refuse('INVALID_INPUT', 'An argument does not match the declared tool schema.');
  }
}
const secretKey = /(?:authorization|password|passwd|secret|credential|api[-_]?key|access[-_]?token|refresh[-_]?token|private[-_]?key|cookie|^token$)/i;
export function redactor(env = process.env) {
  const secrets = Object.entries(env).filter(([key, value]) => secretKey.test(key) && typeof value === 'string' && value.length >= 4).map(([, value]) => value).sort((a, b) => b.length - a.length);
  const text = value => {
    let result = value;
    for (const secret of secrets) result = result.replaceAll(secret, '[REDACTED]');
    return result.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
      .replace(/\b((?:api[-_]?key|password|secret|access[-_]?token|refresh[-_]?token)\s*[=:]\s*)[^\s"'<>;,]+/gi, '$1[REDACTED]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED]');
  };
  const value = input => typeof input === 'string' ? text(input) : Array.isArray(input) ? input.map(value) : isObject(input)
    ? Object.fromEntries(Object.entries(input).map(([key, item]) => [text(key), secretKey.test(key) ? '[REDACTED]' : value(item)])) : input;
  return { text, value };
}
async function checkedPath(root, relative = '', { missing = false } = {}) {
  if (relative && !safePath(relative)) refuse('UNSAFE_PATH', 'Storage path is not confined to the data root.');
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) refuse('UNSAFE_PATH', 'Storage path is not confined to the data root.');
  const ancestors = []; for (let p = target;; p = dirname(p)) { ancestors.unshift(p); if (dirname(p) === p) break; }
  for (const p of ancestors) {
    let stat;
    try { stat = await lstat(p); } catch (error) { if (missing && error.code === 'ENOENT') return target; throw error; }
    if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || p !== target || stat.nlink !== 1))
      refuse('UNSAFE_PATH', 'Storage paths must be real directories and unlinked regular files.');
  }
  return target;
}
async function checkTree(root, relative, budget = { files: 0, bytes: 0 }) {
  const path = await checkedPath(root, relative); const stat = await lstat(path);
  if (++budget.files > 20000 || (budget.bytes += stat.isFile() ? stat.size : 0) > 512 * 1024 * 1024)
    refuse('TOO_LARGE', 'Stored study exceeds the inspection bound.');
  if (stat.isDirectory()) for (const name of await readdir(path)) await checkTree(root, relative + '/' + name, budget);
}
async function boundedRead(root, relative, limit = 128 * 1024 * 1024) {
  const path = await checkedPath(root, relative);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const stat = await file.stat(); if (!stat.isFile() || stat.size > limit) refuse('TOO_LARGE', 'Stored artifact exceeds the read bound.'); return await file.readFile(); }
  finally { await file.close(); }
}
function page(items, { offset = 0, limit = 20 }) {
  const rows = items.slice(offset, offset + limit);
  return { items: rows, total: items.length, nextOffset: offset + rows.length < items.length ? offset + rows.length : null };
}
export async function createBenchService({ dataDir = process.env.BENCHMARK_DATA_DIR || resolve(appRoot, '.benchmark-data') } = {}) {
  const root = resolve(dataDir), scrub = redactor();
  await checkedPath(root, '', { missing: true }); await mkdir(root, { recursive: true, mode: 0o700 });
  const lease = await acquireDataRootLease(root, 'server/mcp.mjs');
  let runs;
  try {
  for (const name of ['projects', 'runs', '.local-origin-key']) await checkedPath(root, name, { missing: true });
  const projects = new ProjectStore(root);
  runs = new RunStore(root, resolve(appRoot, 'src/benchmark'), { logFilter: () => '[Execution output retained in study artifacts; omitted from MCP process log.]' });
  await projects.init(); await runs.init();
  const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async name => [name, await readFile(resolve(appRoot, 'src/benchmark', name), 'utf8')])));
  let queue = Promise.resolve(), closing = false, closePromise;
  async function project(id, expected) {
    await checkedPath(root, `projects/${id}.json`);
    const record = JSON.parse(await boundedRead(root, `projects/${id}.json`, MAX_INPUT_BYTES * 2));
    if (expected !== undefined && record.revision !== expected) refuse('CONFLICT', 'Project revision changed. Read the project before retrying.');
    return record;
  }
  async function save(record, draft) {
    const result = await projects.save(record.id, draft, record.revision);
    return { id: record.id, ...result };
  }
  async function study(id) {
    await checkTree(root, `runs/${id}`);
    const record = JSON.parse(await boundedRead(root, `runs/${id}/run.json`, MAX_INPUT_BYTES));
    if (record.id !== id) refuse('INVALID_STUDY', 'Study record identity differs.');
    // Stored absolute paths are informational; they never select an I/O target.
    record.directory = join(root, 'runs', id, 'project');
    return record;
  }
  const status = r => ({ studyId: r.id, status: r.status, phase: r.phase, sha256: r.projectSha256, history: (r.history || []).map(({ command, code, signal, finishedAt }) => ({ command, code, signal, finishedAt })) });
  async function operation(name, args) {
    if (name === 'projects.list') {
      await checkedPath(root, 'projects');
      const rows = []; const files = (await readdir(join(root, 'projects'))).filter(x => /^rp-[a-f0-9]{32}\.json$/.test(x));
      if (files.length > 10000) refuse('TOO_LARGE', 'Project catalog exceeds the listing bound.');
      for (const file of files) { const row = await project(file.slice(0, -5)); rows.push({ id: row.id, title: row.title, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt }); }
      return page(rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)), args);
    }
    if (name === 'project.get') return project(args.projectId);
    if (name === 'atoms.list') return page((await project(args.projectId)).draft?.spec?.catalog?.filter(x => x.kind === 'atom') || [], args);
    if (['atom.add', 'composition.update', 'tasks.generate'].includes(name)) {
      let record = args.projectId ? await project(args.projectId, args.revision) : null;
      if (record && args.revision === undefined) refuse('INVALID_INPUT', 'Existing project changes require a revision.');
      if (!record && (args.revision !== undefined || args.taskId || args.root)) refuse('INVALID_INPUT', 'Task edits require an existing project and revision.');
      let draft = structuredClone(record?.draft || { spec: newExperimentDraft(genericStarter(), { purpose: 'recorded-diagnostic', initializePopulation: true }), attachments: {} });
      if (name === 'composition.update') {
        if ([args.spec !== undefined, args.draft !== undefined, args.taskId !== undefined || args.root !== undefined].filter(Boolean).length > 1) refuse('INVALID_INPUT', 'Choose a spec, a draft, or one task-root update.');
        if (args.spec) draft.spec = args.spec;
        if (args.draft) draft = args.draft;
        if (args.taskId || args.root) {
          const task = draft.spec.tasks.find(x => x.id === args.taskId);
          if (!task || !args.root) refuse('INVALID_INPUT', 'Choose an existing task and supply its root.');
          task.root = args.root;
        }
      } else if (name === 'atom.add') {
        if (args.atom.kind !== 'atom' || !/^[a-z][a-z0-9_-]{0,63}$/.test(args.atom.id) || typeof args.atom.text !== 'string' || draft.spec.catalog.some(x => x.id === args.atom.id)) refuse('INVALID_INPUT', 'Supply a distinct declared atom with an identifier and text.');
        draft.spec.catalog.push(args.atom);
      } else {
        draft.spec.corpusPlan = args.plan;
        const generated = await materializeCorpus(draft.spec); draft.spec.tasks = generated.tasks;
      }
      if (!draft?.spec || !Array.isArray(draft.spec.catalog) || !Array.isArray(draft.spec.tasks)) refuse('INVALID_INPUT', 'A draft needs a specification with catalog and tasks.');
      for (const key of Object.keys(draft.attachments || {})) if (!safePath(key)) refuse('UNSAFE_PATH', 'Attachment paths must stay inside the exported study.');
      if (!record) { await checkedPath(root, 'projects'); record = await projects.create(draft.spec.name); }
      const result = await save(record, draft);
      return name === 'tasks.generate' ? { ...result, tasks: draft.spec.tasks } : result;
    }
    if (name === 'study.freeze') {
      const record = await project(args.projectId, args.revision);
      const frozen = await freezeStudy(await bindRuntimeSources(record.draft.spec, sources));
      const files = await projectFiles(frozen, sources, record.draft.attachments || {});
      await checkedPath(root, 'runs');
      const r = await runs.create({ projectId: record.id, files }, { execute: false });
      return { studyId: r.id, sha256: r.projectSha256, status: r.status };
    }
    const r = await study(args.studyId);
    if (name === 'report.get') {
      const format = args.format || 'summary'; if (format === 'status') return status(r);
      const filename = { summary: 'summary.json', markdown: 'report.md', html: 'report.html' }[format];
      const bytes = await boundedRead(root, `runs/${r.id}/project/results/${filename}`);
      if (format === 'summary') return { studyId: r.id, data: JSON.parse(bytes) };
      const clean = Buffer.from(scrub.text(bytes.toString('utf8'))), offset = args.offset || 0, limit = args.limit || 16000;
      let start = Math.min(offset, clean.length), end = Math.min(start + limit, clean.length);
      while (start < clean.length && (clean[start] & 0xc0) === 0x80) start++;
      while (end < clean.length && (clean[end] & 0xc0) === 0x80) end++;
      return { studyId: r.id, format, text: clean.subarray(start, end).toString('utf8'), bytes: clean.length, nextOffset: end < clean.length ? end : null };
    }
    if (name === 'study.export') {
      await openProject(r.directory);
      const bytes = await runs.package(r.id); const artifact = `runs/${r.id}/study.zip`;
      const path = await checkedPath(root, artifact, { missing: true });
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await file.writeFile(bytes); } finally { await file.close(); }
      return { studyId: r.id, artifact, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    if (name === 'study.run' || name === 'study.qualify') {
      if (args.confirm !== r.id) refuse('CONFIRM_REQUIRED', 'Execution requires confirm set to the exact studyId after reviewing its runtime and plugins.');
      if (!hasLocalOrigin(runs.originKey, r) && args.trust !== true) refuse('FOREIGN_STUDY', 'This study lacks local provenance. Review its code and pass trust:true as well as confirm to execute it.');
      const frozen = await runs.admittedProject(r.directory);
      if (frozen.sha256 !== r.projectSha256) refuse('INVALID_STUDY', 'Frozen study identity differs from its local record.');
    } else await openProject(r.directory);
    if (r.pid || runs.pending.has(r.id)) refuse('BUSY', 'Study may still be active. Inspect its retained process before retrying.');
    // A process that already owns this study's journal is refused by the CLI's
    // existing durable execution lock; we never offer recover through MCP.
    r.status = 'queued'; delete r.message;
    if (closing) refuse('CLOSED', 'The server is shutting down.');
    await runs.launch(r, [name.slice('study.'.length)]);
    const completed = await runs.read(r.id);
    if (completed.status !== 'completed') refuse('EXECUTION_FAILED', 'Study operation failed or was cancelled. Use report.get with format:status for the retained exit status.');
    return status(completed);
  }
  return {
    listTools: () => structuredClone(TOOLS),
    callTool(name, args = {}) {
      const task = queue.then(async () => {
        try {
          if (closing) refuse('CLOSED', 'The server is shutting down.');
          const tool = TOOLS.find(x => x.name === name); if (!tool) refuse('UNKNOWN_TOOL', 'Unknown Bench tool.');
          if (Buffer.byteLength(JSON.stringify(args)) > MAX_INPUT_BYTES) refuse('TOO_LARGE', 'Tool input exceeds 2 MiB.');
          validate(args, tool.inputSchema);
          const value = scrub.value(await operation(name, args));
          const text = JSON.stringify(value);
          const envelope = { content: [{ type: 'text', text }] };
          if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_OUTPUT_BYTES - 1024) refuse('TOO_LARGE', 'Result exceeds 64 KiB. Use a smaller page, a text report page, or the retained local artifact. The operation may already have completed.');
          return envelope;
        } catch (error) {
          const code = error instanceof Refusal ? error.code : error.status === 409 ? 'CONFLICT' : error.code === 'ENOENT' ? 'NOT_FOUND' : 'INVALID_INPUT';
          const message = error instanceof Refusal ? error.message : code === 'NOT_FOUND' ? 'Local project, study or artifact was not found.' : 'Operation refused by the existing Bench validation or runtime admission. Inspect the local draft and declared study inputs.';
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }] };
        }
      });
      queue = task.catch(() => {}); return task;
    },
    close() {
      closing = true;
      return closePromise ??= (async () => { await runs.shutdown(); await queue; await lease.release(); })();
    },
  };
  } catch (error) { await runs?.shutdown(); await lease.release(); throw error; }
}
