import { randomUUID } from "node:crypto";
import {
  createDocumentCompilationOutboxDispatcher,
  createDocumentCompilationRuntime,
  createInMemoryDocumentCompilationAttemptRepository,
} from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";
import { type CeleryDelivery, createCeleryJobQueue } from "./celery-job-queue";

async function fixture(retryOnce = false) {
  let now = Date.now();
  const attempts = createInMemoryDocumentCompilationAttemptRepository();
  const id = randomUUID();
  await attempts.start({
    baseHeadRevision: 0,
    createdAt: new Date(now).toISOString(),
    documentAssetId: randomUUID(),
    documentVersion: 1,
    id,
    knowledgeSpaceId: randomUUID(),
    maxExecutionAttempts: 3,
    outboxId: randomUUID(),
    publicationGenerationId: randomUUID(),
    tenantId: "tenant-1",
  });
  const deliveries: CeleryDelivery[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    deliveries.push(JSON.parse(init?.body as string) as CeleryDelivery);
    return new Response(null, { status: 202 });
  });
  const transport = createCeleryJobQueue({
    env: { DIFY_INNER_API_URL: "http://api:5001", DIFY_INNER_API_KEY: "test-key" },
    fetch,
    now: () => now,
  });
  const processor = vi.fn<Parameters<typeof createDocumentCompilationRuntime>[0]["processor"]>(
    async (context) => {
      if (retryOnce && processor.mock.calls.length === 1)
        throw Object.assign(new Error("temporary"), { retryable: true });
      for (const checkpoint of [
        "parsed",
        "outline_built",
        "nodes_generated",
        "projection_built",
        "smoke_eval_passed",
      ] as const) {
        await context.advance(
          checkpoint === "projection_built"
            ? {
                checkpoint,
                candidateFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
                candidatePublicationId: randomUUID(),
              }
            : { checkpoint },
        );
      }
    },
  );
  const runtime = createDocumentCompilationRuntime({
    attempts,
    intervalMs: 1000,
    jobs: transport.jobs,
    leaseMs: 10000,
    heartbeatIntervalMs: 3000,
    maxBatchSize: 1,
    now: () => now,
    processor,
    workerId: "celery-child",
    initialRetryDelayMs: 1000,
  });
  const dispatcher = createDocumentCompilationOutboxDispatcher({
    attempts,
    jobs: transport.jobs,
    intervalMs: 1000,
    lockMs: 10000,
    maxBatchSize: 10,
    maxDispatchAttempts: 10,
    now: () => now,
    visibilityMs: 30000,
    workerId: "dispatch-child",
  });
  return {
    id,
    attempts,
    deliveries,
    dispatcher,
    processor,
    runtime,
    transport,
    fetch,
    advanceTime: (ms: number) => {
      now += ms;
    },
    delivery: (index: number) => {
      const delivery = deliveries[index];
      if (!delivery) throw new Error(`Missing delivery ${index}`);
      return delivery;
    },
    execute: (delivery: CeleryDelivery) =>
      transport.executeDelivery(delivery, () => runtime.tick()),
  };
}

describe("Celery transport with the durable compilation state machine", () => {
  it("lets only one of two worker engines enter a concurrently delivered attempt", async () => {
    const f = await fixture();
    await f.dispatcher.tick();
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const process = f.processor.getMockImplementation();
    if (!process) throw new Error("Missing fixture processor");
    f.processor.mockImplementationOnce(async (context) => {
      entered();
      await gate;
      return process(context);
    });
    const first = f.execute(f.delivery(0));
    await running;
    try {
      const other = createCeleryJobQueue({ env: { DIFY_INNER_API_KEY: "test-key" } });
      const runtime = createDocumentCompilationRuntime({
        attempts: f.attempts,
        jobs: other.jobs,
        intervalMs: 1000,
        leaseMs: 10000,
        heartbeatIntervalMs: 3000,
        maxBatchSize: 1,
        processor: f.processor,
        workerId: "other-child",
      });
      expect(await other.executeDelivery(f.delivery(0), () => runtime.tick())).toMatchObject({
        outcome: "retry",
      });
      expect(f.processor).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    expect(await first).toEqual({ outcome: "completed" });
  });

  it("survives delivery before the outbox marker and duplicate completion", async () => {
    const f = await fixture();
    f.fetch.mockImplementationOnce(async (_url, init) => {
      const early = JSON.parse(init?.body as string) as CeleryDelivery;
      f.deliveries.push(early);
      expect(await f.execute(early)).toMatchObject({ outcome: "retry" });
      expect(f.processor).not.toHaveBeenCalled();
      return new Response(null, { status: 202 });
    });
    expect(await f.dispatcher.tick()).toMatchObject({ dispatched: 1 });
    const delivery = f.delivery(0);
    expect(await f.execute(delivery)).toEqual({ outcome: "completed" });
    expect(await f.attempts.get(f.id)).toMatchObject({
      runState: "succeeded",
      executionAttempts: 1,
    });
    expect(await f.execute(delivery)).toEqual({ outcome: "completed" });
    expect(f.processor).toHaveBeenCalledOnce();
  });

  it("does not invalidate an older queued message when the outbox visibility expires", async () => {
    const f = await fixture();
    await f.dispatcher.tick();
    f.advanceTime(31000);
    await f.dispatcher.tick();
    expect(f.deliveries).toHaveLength(2);
    expect(f.delivery(0).id).toBe(f.delivery(1).id);
    expect(await f.execute(f.delivery(0))).toEqual({ outcome: "completed" });
    expect(await f.execute(f.delivery(1))).toEqual({ outcome: "completed" });
    expect(f.processor).toHaveBeenCalledOnce();
  });

  it("leaves domain retry/backoff in the database and resumes via the outbox", async () => {
    const f = await fixture(true);
    await f.dispatcher.tick();
    expect(await f.execute(f.delivery(0))).toEqual({ outcome: "completed" });
    expect(await f.attempts.get(f.id)).toMatchObject({
      runState: "retry_wait",
      executionAttempts: 1,
    });
    await f.dispatcher.tick();
    expect(f.deliveries).toHaveLength(1);
    f.advanceTime(2000);
    await f.dispatcher.tick();
    expect(await f.execute(f.delivery(1))).toEqual({ outcome: "completed" });
    expect(await f.attempts.get(f.id)).toMatchObject({
      runState: "succeeded",
      executionAttempts: 2,
    });
  });
});
