import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  realpath,
} from "node:fs/promises";
import { join, dirname, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { safePath, RUNTIME_FILES } from "../src/benchmark/study.mjs";
import { openProject } from "../src/benchmark/cli.mjs";
import { zipFiles } from "../src/benchmark/export.mjs";
import { atomicJSON } from "./store.mjs";
const validId = (id) => /^run-[a-f0-9]{32}$/.test(id);
const active = [
  "queued",
  "verifying",
  "qualifying",
  "running",
  "analyzing",
  "cancelling",
];
const runtimeRefusal = () => new Error(
  "This project pins a different runtime or an incomplete runtime inventory. Local execution requires the complete installed runtime; inspect other exports with a trusted CLI without executing them.",
);
export class RunStore {
  constructor(root, runtime) {
    this.root = resolve(root, "runs");
    this.runtime = resolve(runtime);
    this.children = new Map();
    this.pending = new Set();
    this.executions = new Map();
    this.writes = new Map();
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }
  directory(id) {
    if (!validId(id)) throw new Error("Unknown run.");
    return join(this.root, id);
  }
  async read(id) {
    const record = JSON.parse(
      await readFile(join(this.directory(id), "run.json"), "utf8"),
    );
    if (active.includes(record.status) && !this.pending.has(id)) {
      record.status = "interrupted";
      record.message =
        "The server lost contact with this run. Inspect the retained process and journal before resuming.";
    }
    return record;
  }
  async list() {
    return (
      await Promise.all(
        (await readdir(this.root)).filter(validId).map((id) => this.read(id)),
      )
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  persist(record) {
    const snapshot = structuredClone(record);
    const task = (this.writes.get(record.id) || Promise.resolve()).then(() =>
      atomicJSON(join(this.directory(record.id), "run.json"), snapshot),
    );
    this.writes.set(
      record.id,
      task.catch(() => {}),
    );
    return task;
  }
  async admitRuntime(project, readSource) {
    // This inventory belongs to the installed build: core plus every configured
    // plugin dependency. The received project's optional keys cannot shrink or
    // extend the loader closure admitted by the service.
    const pins = project?.spec?.runtimeSources;
    if (!pins || typeof pins !== "object" || Array.isArray(pins) ||
      Object.keys(pins).length !== RUNTIME_FILES.length ||
      RUNTIME_FILES.some(name => !Object.hasOwn(pins, name)))
      throw runtimeRefusal();
    for (const name of RUNTIME_FILES) {
      const installed = await readFile(join(this.runtime, name), "utf8");
      const digest = createHash("sha256").update(installed).digest("hex");
      let supplied;
      try { supplied = await readSource(name); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (pins[name] !== digest || supplied !== installed) throw runtimeRefusal();
    }
  }
  async admittedProject(directory) {
    const declared = JSON.parse(await readFile(join(directory, "project.json"), "utf8"));
    await this.admitRuntime(declared, name => readFile(join(directory, name), "utf8"));
    const verified = await openProject(directory);
    if (!verified.runtime.isThisRuntime) throw runtimeRefusal();
    return verified.project;
  }
  async create({ projectId, files }) {
    if (
      !files ||
      typeof files !== "object" ||
      Array.isArray(files) ||
      Object.keys(files).length > 2048
    )
      throw new Error("A run needs a bounded exported project.");
    let bytes = 0;
    for (const [path, value] of Object.entries(files)) {
      if (
        !safePath(path) ||
        path === "run.json" ||
        path.startsWith("results/") ||
        typeof value !== "string"
      )
        throw new Error("Invalid project file: " + path);
      bytes += Buffer.byteLength(value);
    }
    if (bytes > 128 * 1024 * 1024) throw new Error("Project exceeds 128 MiB.");
    const project = JSON.parse(files["project.json"]);
    await this.admitRuntime(project, name => files[name]);
    const id = "run-" + randomUUID().replaceAll("-", ""),
      dir = this.directory(id);
    await mkdir(join(dir, "project"), { recursive: true, mode: 0o700 });
    try {
      for (const [file, text] of Object.entries(files)) {
        const path = join(dir, "project", file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text, { flag: "wx", mode: 0o600 });
      }
      const verified = await this.admittedProject(join(dir, "project"));
      const record = {
        id,
        projectId,
        name: verified.spec.name,
        projectSha256: verified.sha256,
        purpose: verified.spec.executionPlan?.purpose || "legacy",
        createdAt: new Date().toISOString(),
        status: "queued",
        phase: "verify",
        history: [],
        log: "",
        directory: join(dir, "project"),
        files: Object.keys(files),
      };
      await this.persist(record);
      this.launch(record, ["verify", "qualify", "run", "analyze"]);
      return record;
    } catch (error) {
      await atomicJSON(join(dir, "run.json"), {
        id,
        projectId,
        name: project?.spec?.name || "Rejected package",
        status: "rejected",
        createdAt: new Date().toISOString(),
        log: error.message,
        history: [],
        files: [],
      });
      throw error;
    }
  }
  launch(record, commands) {
    this.pending.add(record.id);
    const execution = { record };
    this.executions.set(record.id, execution);
    const work = this.execute(record, commands)
      .catch(async (error) => {
        record.status = "failed";
        record.message = error.message;
        await this.persist(record);
      })
      .finally(() => {
        this.pending.delete(record.id);
        this.children.delete(record.id);
        this.executions.delete(record.id);
      });
    execution.work = work;
    return work;
  }
  async execute(record, commands) {
    for (const command of commands) {
      if (record.status === "cancelling") break;
      record.status = {
        verify: "verifying",
        qualify: "qualifying",
        run: "running",
        analyze: "analyzing",
      }[command];
      record.phase = command;
      record.updatedAt = new Date().toISOString();
      await this.persist(record);
      if (record.status === "cancelling") break;
      const child = spawn(process.execPath, [join(this.runtime, "cli.mjs"), command, "--project", record.directory], {
        cwd: record.directory,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
      });
      const append = (chunk) => {
        record.log = (record.log + chunk.toString()).slice(-256 * 1024);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      // Observe closure before exposing the child to cancellation or awaiting
      // disk I/O. A quick exit during PID persistence must still settle the run.
      const completion = new Promise((done) => {
        child.once("error", (error) =>
          done({ code: null, error: error.message }),
        );
        child.once("close", (code, signal) => done({ code, signal }));
      });
      this.children.set(record.id, { child, record });
      record.pid = child.pid;
      const timer = setInterval(
        () => this.persist(record).catch(() => {}),
        1000,
      );
      await this.persist(record);
      const result = await completion;
      clearInterval(timer);
      this.children.delete(record.id);
      delete record.pid;
      record.history.push({
        command,
        ...result,
        finishedAt: new Date().toISOString(),
      });
      if (record.status === "cancelling") {
        record.status = "cancelled";
        record.message =
          "Process stopped. Completed and interrupted attempts remain in the journal.";
        break;
      }
      if (result.code !== 0) {
        record.status = "failed";
        record.message =
          result.error ||
          `${command} exited with ${result.code ?? result.signal}. See the retained log.`;
        break;
      }
    }
    if (!["failed", "cancelled"].includes(record.status))
      record.status =
        record.status === "cancelling" ? "cancelled" : "completed";
    record.updatedAt = new Date().toISOString();
    try {
      record.summary = JSON.parse(
        await readFile(join(record.directory, "results/summary.json"), "utf8"),
      );
    } catch {}
    await this.persist(record);
  }
  async cancel(id) {
    const entry = this.children.get(id);
    if (!entry) throw new Error("There is no active process to cancel.");
    entry.record.status = "cancelling";
    await this.persist(entry.record);
    entry.child.kill("SIGTERM");
    return { status: "cancelling" };
  }
  async resume(id) {
    if (this.pending.has(id)) throw new Error("This run is already active.");
    const record = await this.read(id);
    if (!["failed", "cancelled", "interrupted"].includes(record.status))
      throw new Error("Only stopped runs can be resumed.");
    if (record.pid) {
      let exists = false;
      try {
        process.kill(record.pid, 0);
        exists = true;
      } catch (error) {
        if (error.code !== "ESRCH") exists = true;
      }
      if (exists)
        throw new Error(
          "The recorded process may still be running. Inspect it before resuming.",
        );
      delete record.pid;
    }
    await this.admittedProject(record.directory);
    record.status = "queued";
    record.message = "";
    await this.persist(record);
    this.launch(record, ["verify", "qualify", "run", "analyze"]);
    return record;
  }
  async artifact(id, file) {
    if (!safePath(file)) throw new Error("Invalid artifact path.");
    const base = await realpath(join(this.directory(id), "project", "results")),
      path = await realpath(join(base, file));
    if (!path.startsWith(base + sep) || !(await lstat(path)).isFile())
      throw new Error("Invalid artifact.");
    return readFile(path);
  }
  async package(id) {
    const record = await this.read(id);
    const files = {};
    for (const name of record.files) {
      if (!safePath(name)) throw new Error("Invalid run package.");
      files[name] = await readFile(
        join(this.directory(id), "project", name),
        "utf8",
      );
    }
    return zipFiles(files);
  }
  async shutdown() {
    const executions = [...this.executions.values()];
    for (const { record } of executions)
      if (active.includes(record.status)) record.status = "cancelling";
    for (const { child, record } of this.children.values()) {
      record.status = "cancelling";
      child.kill("SIGTERM");
    }
    // The caller may close the server or remove its disposable data directory
    // only after child closure and the final durable run record have settled.
    await Promise.allSettled(executions.map(({ work }) => work));
  }
}
