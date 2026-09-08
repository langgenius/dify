import { createHash, randomUUID } from "node:crypto";
import { type JobPayload, type JobQueueAdapter, type JobRecord, UuidSchema } from "@knowledge/core";

export const CeleryQueuedJobTypes = ["document.compile", "quality.page-index-findability"] as const;
export interface CeleryDelivery {
  readonly id: string;
  readonly type: (typeof CeleryQueuedJobTypes)[number];
  readonly payload: JobPayload;
  readonly attempts: number;
}
export type CeleryDeliveryResult =
  | { readonly outcome: "completed" }
  | { readonly outcome: "retry"; readonly runAfter: number }
  | { readonly outcome: "failed" };

/** UUID v5 in a private namespace. A replayed outbox event must not invalidate the message
 * already waiting in the broker by replacing its queueJobId with a fresh random UUID. Celery
 * itself does not deduplicate these IDs: the durable attempt lease remains authoritative. */
function deliveryId(type: string, idempotencyKey: string): string {
  const namespace = Buffer.from("e3ad236be2bd430ba094cf442419627f", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(`${type}:${idempotencyKey}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateCeleryDelivery(value: unknown): CeleryDelivery {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Celery delivery");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["id", "type", "payload", "attempts"].includes(key))) {
    throw new Error("Unknown Celery delivery field");
  }
  const id = UuidSchema.parse(record.id);
  if (!CeleryQueuedJobTypes.includes(record.type as CeleryDelivery["type"]))
    throw new Error("Unknown Celery job type");
  if (
    !Number.isSafeInteger(record.attempts) ||
    (record.attempts as number) < 1 ||
    (record.attempts as number) > 100_000
  )
    throw new Error("Invalid delivery attempt");
  const payload = record.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid Celery locator");
  const locator = payload as Record<string, unknown>;
  const allowed =
    record.type === "document.compile"
      ? ["attemptId"]
      : ["compilationAttemptId", "publicationFingerprint"];
  if (
    Object.keys(locator).length !== allowed.length ||
    Object.keys(locator).some((key) => !allowed.includes(key))
  ) {
    throw new Error("Invalid Celery locator fields");
  }
  UuidSchema.parse(locator[allowed[0] as string]);
  if (
    record.type === "quality.page-index-findability" &&
    (typeof locator.publicationFingerprint !== "string" ||
      locator.publicationFingerprint.length < 1 ||
      locator.publicationFingerprint.length > 128)
  ) {
    throw new Error("Invalid publication fingerprint");
  }
  return {
    id,
    type: record.type as CeleryDelivery["type"],
    payload: structuredClone(payload) as JobPayload,
    attempts: record.attempts as number,
  };
}

/**
 * The broker owns delivery. This small per-delivery facade adapts the existing fenced executor's
 * acknowledgement/heartbeat contract; it is NOT a second queue or a cross-process task store.
 * All authorization, terminal state and resumable progress still come from the durable repository.
 */
export function createCeleryJobQueue({
  env = process.env,
  fetch = globalThis.fetch,
  now = Date.now,
  generateId = randomUUID,
}: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly generateId?: () => string;
} = {}): {
  readonly jobs: JobQueueAdapter;
  executeDelivery(
    delivery: CeleryDelivery,
    execute: () => Promise<unknown>,
  ): Promise<CeleryDeliveryResult>;
} {
  const origin = new URL(env.DIFY_INNER_API_URL?.trim() || "http://api:5001");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error("Celery publisher must use the configured Dify inner API origin");
  }
  const apiKey = env.DIFY_INNER_API_KEY?.trim();
  if (!apiKey) throw new Error("Celery execution requires DIFY_INNER_API_KEY");
  let current: JobRecord | undefined;
  const requireCurrent = (id: string): JobRecord => {
    if (!current || current.id !== id)
      throw new Error("Celery operation is outside the active delivery");
    return current;
  };
  const jobs: JobQueueAdapter = {
    kind: "celery",
    async enqueue(input) {
      const id = input.idempotencyKey ? deliveryId(input.type, input.idempotencyKey) : generateId();
      const delivery = validateCeleryDelivery({
        id,
        type: input.type,
        payload: input.payload,
        attempts: 1,
      });
      const response = await fetch(new URL("/inner/api/knowledge-fs/background/jobs", origin), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Inner-Api-Key": apiKey },
        body: JSON.stringify({
          ...delivery,
          ...(input.runAfter === undefined ? {} : { runAfter: input.runAfter }),
        }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      await response.body?.cancel();
      if (response.status !== 202)
        throw new Error(`Celery publication failed (${response.status})`);
      return {
        ...delivery,
        createdAt: now(),
        externalJobId: delivery.id,
        status: "queued",
        priority: input.priority ?? "normal",
      };
    },
    async lease(input) {
      if (
        !current ||
        current.status !== "queued" ||
        (current.runAfter ?? 0) > (input.now ?? now()) ||
        (input.types && !input.types.includes(current.type))
      )
        return [];
      current = {
        ...current,
        status: "running",
        workerId: input.workerId,
        startedAt: input.now ?? now(),
        leaseExpiresAt: (input.now ?? now()) + input.leaseMs,
      };
      return [structuredClone(current)];
    },
    dequeue: (input) => jobs.lease({ ...input, leaseMs: 60_000 }),
    async heartbeat(input) {
      const job = requireCurrent(input.jobId);
      if (job.status !== "running" || job.workerId !== input.workerId)
        throw new Error("Celery execution heartbeat lost its owner");
      current = {
        ...job,
        heartbeatAt: input.now ?? now(),
        leaseExpiresAt: (input.now ?? now()) + input.leaseMs,
      };
      return structuredClone(current);
    },
    async complete(id) {
      current = { ...requireCurrent(id), status: "completed", completedAt: now() };
    },
    async fail(id, error, options) {
      current = {
        ...requireCurrent(id),
        error,
        status: options?.retryAt === undefined ? "failed" : "queued",
        ...(options?.retryAt === undefined ? {} : { runAfter: options.retryAt }),
      };
    },
    async retry(id, options) {
      current = {
        ...requireCurrent(id),
        status: "queued",
        runAfter: options?.runAfter ?? now() + 1_000,
      };
    },
    async cancel(id) {
      // Durable cancellation is authoritative. Never revoke a broker task using an unverified ID.
      if (current?.id === id) current = { ...current, status: "canceled" };
    },
    status: async (id) => (current?.id === id ? structuredClone(current) : null),
    stats: async () => ({
      canceled: 0,
      completed: 0,
      failed: 0,
      queued: Number(current?.status === "queued"),
      running: Number(current?.status === "running"),
    }),
    async health() {
      try {
        const response = await fetch(new URL("/inner/api/knowledge-fs/background/health", origin), {
          headers: { "X-Inner-Api-Key": apiKey },
          signal: AbortSignal.timeout(5_000),
          redirect: "error",
        });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    },
  };
  return {
    jobs,
    async executeDelivery(raw, execute) {
      if (current) throw new Error("A Celery engine may execute only one delivery at a time");
      const delivery = validateCeleryDelivery(raw);
      current = { ...delivery, createdAt: now(), status: "queued" };
      try {
        await execute();
        const result = requireCurrent(delivery.id);
        if (result.status === "completed" || result.status === "canceled")
          return { outcome: "completed" };
        if (result.status === "failed") return { outcome: "failed" };
        return { outcome: "retry", runAfter: result.runAfter ?? now() + 1_000 };
      } finally {
        current = undefined;
      }
    },
  };
}
