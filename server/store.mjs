import { mkdir, readFile, rename, readdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export const projectId = (value) => /^rp-[a-f0-9]{32}$/.test(value);
function storageError(message, cause) {
  const error = new Error(message);
  error.code = cause.code;
  return error;
}
export async function atomicJSON(path, value) {
  const temp = path + "." + randomUUID() + ".tmp";
  let file, created = false;
  try {
    file = await open(temp, "wx", 0o600); created = true;
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
    await file.close(); file = null;
    await rename(temp, path); created = false;
  } catch (cause) {
    throw storageError("Could not save local data. Check that your data folder is writable and has free space.", cause);
  } finally {
    if (file) await file.close().catch(() => {});
    if (created) await unlink(temp).catch(() => {});
  }
}
export class ProjectStore {
  constructor(root) {
    this.root = join(root, "projects");
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }
  async read(id) {
    if (!projectId(id)) throw new Error("Unknown project.");
    let contents;
    try { contents = await readFile(join(this.root, id + ".json"), "utf8"); }
    catch (cause) {
      const error = new Error("Project file missing or unreadable.");
      error.code = cause.code;
      throw error;
    }
    return JSON.parse(contents);
  }
  async list({ onWarning = () => {} } = {}) {
    let files;
    try { files = await readdir(this.root); }
    catch (cause) { throw storageError("Could not list projects. Check access to your local data folder.", cause); }
    const candidates = files.filter(name => /^rp-[a-f0-9]{32}\.json$/.test(name));
    const records = await Promise.all(candidates.map(async name => {
      try {
        const record = await this.read(name.slice(0, -5));
        if (!record || record.id !== name.slice(0, -5) || typeof record.title !== "string" ||
            !Number.isSafeInteger(record.revision) || record.revision < 0 ||
            typeof record.createdAt !== "string" || typeof record.updatedAt !== "string") return null;
        const { draft, ...meta } = record;
        return meta;
      } catch { return null; }
    }));
    const rows = records.filter(Boolean), skipped = candidates.length - rows.length;
    if (skipped) onWarning(`${skipped} project ${skipped === 1 ? "file could" : "files could"} not be opened and ${skipped === 1 ? "was" : "were"} skipped. Check their contents and access permissions.`);
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  change(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  create(title = "Untitled study") {
    return this.change(async () => {
      const now = new Date().toISOString();
      const record = {
        id: "rp-" + randomUUID().replaceAll("-", ""),
        title: String(title).slice(0, 160),
        createdAt: now,
        updatedAt: now,
        revision: 0,
        draft: null,
      };
      await atomicJSON(join(this.root, record.id + ".json"), record);
      return record;
    });
  }
  save(id, draft, revision) {
    return this.change(async () => {
      const previous = await this.read(id);
      if (revision !== previous.revision) {
        const error = new Error(
          "This project was saved in another window. Download your draft, then reopen the project before saving.",
        );
        error.status = 409;
        throw error;
      }
      if (
        !draft?.spec ||
        !Array.isArray(draft.spec.catalog) ||
        !Array.isArray(draft.spec.tasks)
      )
        throw new Error(
          "A project must contain an editable benchmark specification.",
        );
      const record = {
        ...previous,
        title: String(draft.spec.name || previous.title).slice(0, 160),
        updatedAt: new Date().toISOString(),
        revision: revision + 1,
        draft,
      };
      await atomicJSON(join(this.root, id + ".json"), record);
      return { revision: record.revision, updatedAt: record.updatedAt };
    });
  }
}
