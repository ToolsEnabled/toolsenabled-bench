import { mkdir, readFile, rename, readdir, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export const projectId = (value) => /^rp-[a-f0-9]{32}$/.test(value);
export async function atomicJSON(path, value) {
  const temp = path + "." + randomUUID() + ".tmp";
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
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
    return JSON.parse(await readFile(join(this.root, id + ".json"), "utf8"));
  }
  async list() {
    const rows = await Promise.all(
      (await readdir(this.root))
        .filter((n) => /^rp-[a-f0-9]{32}\.json$/.test(n))
        .map(async (name) => {
          const { draft, ...meta } = JSON.parse(
            await readFile(join(this.root, name), "utf8"),
          );
          return meta;
        }),
    );
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
