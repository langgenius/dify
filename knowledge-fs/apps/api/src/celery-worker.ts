import { type BackgroundOperationName, BackgroundOperationNames } from "@knowledge/api";
import { validateCeleryDelivery } from "./celery-job-queue";

const protocol = "knowledge-fs-celery-v1";
const writeProtocol = process.stdout.write.bind(process.stdout);
// Metrics and third-party logs are not RPC frames. Never let them grow the parent's reply buffer.
process.stdout.write = process.stderr.write.bind(process.stderr);
if (process.env.KNOWLEDGE_BACKGROUND_EXECUTION !== "celery") {
  throw new Error("The Celery engine requires KNOWLEDGE_BACKGROUND_EXECUTION=celery");
}
process.env.RESEARCH_TASK_MAX_BATCH_SIZE = "1";
process.env.KNOWLEDGE_PROFILE_BACKFILL_CLAIM_BATCH = "1";
process.env.KNOWLEDGE_TIDB_FTS_BACKFILL_CLAIM_BATCH = "1";

function stopProcessGroup(): never {
  // The Python owner creates a private process group. Parent loss must also stop native parser
  // and Poppler children, not leave a detached executor renewing a publication lease indefinitely.
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    /* Direct development invocation. */
  }
  process.exit(1);
}

let buffer = "";
let busy = false;
const engine = import("./index");
process.stdin.setEncoding("utf8");
process.stdin.on("end", stopProcessGroup);
process.stdin.on("error", stopProcessGroup);
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer, "utf8") > 16_384) stopProcessGroup();
  const end = buffer.indexOf("\n");
  if (end < 0) return;
  if (busy || buffer.slice(end + 1).trim()) stopProcessGroup();
  const line = buffer.slice(0, end);
  buffer = buffer.slice(end + 1);
  busy = true;
  void execute(line).finally(() => {
    busy = false;
  });
});

async function execute(line: string): Promise<void> {
  let id: unknown;
  try {
    const input = JSON.parse(line) as Record<string, unknown>;
    id = input.id;
    if (
      !input ||
      input.protocol !== protocol ||
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/u.test(id) ||
      Object.keys(input).some((key) => !["protocol", "id", "operation", "delivery"].includes(key))
    ) {
      throw new Error("Invalid worker request");
    }
    const { backgroundRuntime, celeryJobQueue } = await engine;
    if (!celeryJobQueue) throw new Error("Celery transport is unavailable");
    let result: unknown;
    if (input.operation === "delivery") {
      const delivery = validateCeleryDelivery(input.delivery);
      const operation =
        delivery.type === "document.compile" ? "document.execute" : "page-index.findability";
      if (!backgroundRuntime.names().includes(operation))
        throw new Error("Required delivery executor is unavailable");
      result = await celeryJobQueue.executeDelivery(delivery, () =>
        backgroundRuntime.execute(operation),
      );
    } else {
      if (
        typeof input.operation !== "string" ||
        !BackgroundOperationNames.includes(input.operation as BackgroundOperationName) ||
        ["document.execute", "page-index.findability"].includes(input.operation) ||
        input.delivery !== undefined
      ) {
        throw new Error("Unknown worker operation");
      }
      if (!backgroundRuntime.names().includes(input.operation as BackgroundOperationName)) {
        result = { outcome: "unavailable" };
      } else {
        await backgroundRuntime.execute(input.operation as BackgroundOperationName);
        result = { outcome: "completed" };
      }
    }
    writeProtocol(`${JSON.stringify({ protocol, id, ok: true, result })}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ event: "knowledge_fs.celery.execution_failed", errorClass: error instanceof Error ? error.name : "UnknownError" })}\n`,
    );
    writeProtocol(
      `${JSON.stringify({ protocol, id, ok: false, code: "BACKGROUND_EXECUTION_FAILED" })}\n`,
    );
  }
}

// Do not leave a rejected bootstrap promise unobserved while the parent is starting Celery.
void engine.catch(() => stopProcessGroup());
