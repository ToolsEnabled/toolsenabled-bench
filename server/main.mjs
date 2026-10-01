import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { ProjectStore } from "./store.mjs";
import { RunStore } from "./runs.mjs";
import {
  acquireDataRootLease,
  DataRootLeaseError,
} from "./data-root-lease.mjs";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageInfo = JSON.parse(
  await readFile(resolve(appRoot, "package.json"), "utf8"),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
};
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 140 * 1024 * 1024) {
      const e = new Error("Request exceeds the project size limit.");
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
export async function startServer({
  port = 4318,
  dataDir = process.env.BENCHMARK_DATA_DIR ||
    resolve(appRoot, ".benchmark-data"),
} = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lease = await acquireDataRootLease(dataDir, "server/main.mjs");
  let runs, server;
  try {
    const projects = new ProjectStore(dataDir),
      active = new Set();
    runs = new RunStore(dataDir, resolve(appRoot, "src/benchmark"));
    await projects.init();
    await runs.init();
    const token = randomBytes(32).toString("hex");
    let origin,
      closing = false,
      closePromise;
    server = createServer((req, res) => {
      const work = handle(req, res);
      active.add(work);
      void work.finally(() => active.delete(work)).catch(() => res.destroy());
    });
    async function handle(req, res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      const send = (value, status = 200) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(value));
      };
      try {
        if (closing) return send({ error: "Bench is shutting down." }, 503);
        if (req.headers.host !== new URL(origin).host)
          return send(
            {
              error: "Use the local application address printed by the server.",
            },
            403,
          );
        const url = new URL(req.url, origin),
          path = url.pathname;
        if (path.startsWith("/api/")) {
          if (
            req.headers["x-benchmark-token"] !== token ||
            (req.headers.origin && req.headers.origin !== origin)
          )
            return send(
              { error: "Open this application in its local browser window." },
              403,
            );
          if (req.method === "GET" && path === "/api/info")
            return send({
              name: "ToolsEnabled BenchMark Builder",
              version: packageInfo.version,
              dataDir,
              node: process.version,
            });
          if (path === "/api/projects") {
            if (req.method === "GET") return send(await projects.list());
            if (req.method === "POST")
              return send(await projects.create((await body(req)).title), 201);
          }
          const project = path.match(/^\/api\/projects\/(rp-[a-f0-9]{32})$/);
          if (project) {
            if (req.method === "GET")
              return send(await projects.read(project[1]));
            if (req.method === "PUT") {
              const input = await body(req);
              return send(
                await projects.save(project[1], input.draft, input.revision),
              );
            }
          }
          if (path === "/api/runs") {
            if (req.method === "GET") return send(await runs.list());
            if (req.method === "POST") {
              const input = await body(req);
              await projects.read(input.projectId);
              return send(await runs.create(input), 201);
            }
          }
          const run = path.match(
            /^\/api\/runs\/(run-[a-f0-9]{32})(?:\/(cancel|resume|evidence|package|artifact))?$/,
          );
          if (run) {
            const [, id, action] = run;
            if (req.method === "POST" && action === "cancel")
              return send(await runs.cancel(id));
            if (req.method === "POST" && action === "resume")
              return send(await runs.resume(id));
            if (req.method === "GET" && action === "evidence")
              return send(
                JSON.parse(
                  (await runs.artifact(id, "evidence.json")).toString(),
                ),
              );
            if (req.method === "GET" && action === "package") {
              const data = await runs.package(id);
              res.writeHead(200, {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${id}.zip"`,
              });
              return res.end(data);
            }
            if (req.method === "GET" && action === "artifact") {
              const name = url.searchParams.get("path") || "report.html";
              const data = await runs.artifact(id, name);
              res.writeHead(200, {
                "Content-Type":
                  types[extname(name)] || "application/octet-stream",
                "Content-Disposition": `attachment; filename="${name
                  .split("/")
                  .at(-1)
                  .replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
              });
              return res.end(data);
            }
            if (req.method === "GET" && !action)
              return send(await runs.read(id));
          }
          return send({ error: "Unknown operation." }, 404);
        }
        if (req.method !== "GET")
          return send({ error: "Method not allowed." }, 405);
        if (
          path !== "/" &&
          path !== "/favicon.svg" &&
          !/^\/assets\/[a-zA-Z0-9._-]+$/.test(path)
        )
          return send({ error: "Not found." }, 404);
        const file = resolve(
          appRoot,
          "dist",
          path === "/" ? "index.html" : path.slice(1),
        );
        let contents = await readFile(file);
        if (path === "/")
          contents = Buffer.from(
            contents.toString().replace("__BENCH_TOKEN__", token),
          );
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
        res.writeHead(200, {
          "Content-Type": types[extname(file)] || "application/octet-stream",
        });
        res.end(contents);
      } catch (error) {
        if (!res.headersSent)
          send(
            { error: error.message },
            error.status || (error.code === "ENOENT" ? 404 : 400),
          );
        else res.end();
      }
    }
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", done);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    return {
      server,
      origin,
      token,
      projects,
      runs,
      close() {
        closing = true;
        return (closePromise ??= (async () => {
          const stopped = new Promise((done) => server.close(done));
          // Requests admitted before shutdown can still create runs. Drain those
          // operations before cancelling runs and releasing their storage lease.
          await Promise.allSettled([...active]);
          await runs.shutdown();
          await stopped;
          await lease.release();
        })());
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise((done) => server.close(done));
    await runs?.shutdown();
    await lease.release();
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let closing,
    stopping = false,
    startup;
  const shutdown = () => {
    stopping = true;
    return (closing ??= (async () => {
      const app = await startup.catch(() => null);
      await app?.close();
    })());
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => void shutdown());
  startup = startServer({
    port: Number(process.env.BENCHMARK_PORT || 4318),
  });
  try {
    const app = await startup;
    if (!stopping)
      console.log(
        `ToolsEnabled BenchMark Builder\n${app.origin}\nProjects and runs: ${process.env.BENCHMARK_DATA_DIR || resolve(appRoot, ".benchmark-data")}`,
      );
  } catch (error) {
    console.error(
      error instanceof DataRootLeaseError
        ? error.message
        : "Bench web server could not start. Verify the port and local data directory.",
    );
    process.exitCode = 1;
    await shutdown();
  }
}
