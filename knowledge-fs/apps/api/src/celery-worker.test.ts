import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

let directory: string;
let bundle: string;
const children: ChildProcessWithoutNullStreams[] = [];
const protocol = "knowledge-fs-celery-v1";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "knowledge-celery-ipc-"));
  bundle = join(directory, "worker.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./celery-worker.ts", import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
    },
    plugins: [
      {
        name: "isolated-worker-runtime",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/index$/ }, (args) =>
            args.importer.endsWith("/celery-worker.ts")
              ? { path: "runtime", namespace: "ipc-fixture" }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "ipc-fixture" }, () => ({
            contents: `
        export const backgroundRuntime = {
          names: () => ['document.dispatch','document.execute'],
          execute: async name => {
            if(name==='document.execute') {
              process.stderr.write('EXECUTING\\n');
              return new Promise(()=>{});
            }
            console.log('diagnostic-'.repeat(2000));
          },
        };
        export const celeryJobQueue = {executeDelivery: async (delivery, execute) => {
          await execute(); return {outcome:'completed'};
        }};
      `,
          }));
        },
      },
    ],
  });
});

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  }
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function start() {
  const child = spawn(process.execPath, [bundle], {
    detached: true,
    env: { KNOWLEDGE_BACKGROUND_EXECUTION: "celery" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  const exited = new Promise<string | number | null>((resolve) =>
    child.once("exit", (code, signal) => resolve(signal ?? code)),
  );
  const lines = createInterface({ input: child.stdout });
  let diagnostics = "";
  child.stderr.on("data", (data) => {
    diagnostics += String(data);
  });
  async function request(operation: string, extra: Record<string, unknown> = {}) {
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      const failed = () => reject(new Error(`Worker exited before replying: ${diagnostics}`));
      child.once("exit", failed);
      lines.once("line", (line) => {
        child.off("exit", failed);
        resolve(JSON.parse(line));
      });
    });
    const id = randomUUID();
    child.stdin.write(`${JSON.stringify({ protocol, id, operation, ...extra })}\n`);
    const reply = await response;
    expect(reply.id).toBe(id);
    expect(reply.protocol).toBe(protocol);
    return reply;
  }
  return { child, exited, request, diagnostics: () => diagnostics };
}

describe("private Celery worker process protocol", () => {
  it("reuses a process and keeps diagnostics out of the bounded reply channel", async () => {
    const worker = start();
    expect(await worker.request("document.dispatch")).toMatchObject({
      ok: true,
      result: { outcome: "completed" },
    });
    expect(await worker.request("document.dispatch")).toMatchObject({ ok: true });
    expect(worker.diagnostics()).toContain("diagnostic-");
    worker.child.stdin.end();
    expect(await worker.exited).toBe("SIGKILL");
  });
  it("rejects commands and scope overrides without executing them", async () => {
    const worker = start();
    expect(await worker.request("shell")).toMatchObject({ ok: false });
    expect(await worker.request("document.dispatch", { tenantId: "injected" })).toMatchObject({
      ok: false,
    });
    expect(await worker.request("document.execute")).toMatchObject({ ok: false });
    expect(worker.diagnostics()).not.toContain("diagnostic-");
  });
  it("does not report an unavailable optional operation as executed", async () => {
    const worker = start();
    expect(await worker.request("fts.backfill")).toMatchObject({
      ok: true,
      result: { outcome: "unavailable" },
    });
  });
  it("kills an oversized input without starting work", async () => {
    const worker = start();
    worker.child.stdin.write("x".repeat(17000));
    expect(await worker.exited).toBe("SIGKILL");
  });
  it("terminates active execution when the owning Celery process closes stdin", async () => {
    const worker = start();
    const active = new Promise<void>((resolve) =>
      worker.child.stderr.on("data", () => {
        if (worker.diagnostics().includes("EXECUTING")) resolve();
      }),
    );
    worker.child.stdin.write(
      `${JSON.stringify({
        protocol,
        id: randomUUID(),
        operation: "delivery",
        delivery: {
          id: randomUUID(),
          type: "document.compile",
          payload: { attemptId: randomUUID() },
          attempts: 1,
        },
      })}\n`,
    );
    await active;
    worker.child.stdin.end();
    expect(await worker.exited).toBe("SIGKILL");
  });
});
