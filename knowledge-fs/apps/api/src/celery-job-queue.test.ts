import { describe, expect, it, vi } from "vitest";
import { createCeleryJobQueue, validateCeleryDelivery } from "./celery-job-queue";

const id = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02";
const delivery = { id, type: "document.compile" as const, payload: { attemptId }, attempts: 1 };
function fixture() {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(null, { status: 202 }));
  const transport = createCeleryJobQueue({
    env: { DIFY_INNER_API_URL: "http://api:5001", DIFY_INNER_API_KEY: "test-inner-key" },
    fetch,
    generateId: () => id,
    now: () => 1000,
  });
  return { ...transport, fetch };
}
describe("Celery compilation transport", () => {
  it("keeps replayed outbox identities stable across independent publishers", async () => {
    const first = fixture();
    const second = fixture();
    const input = {
      type: delivery.type,
      payload: delivery.payload,
      idempotencyKey: "compilation:outbox-1",
    };
    const a = await first.jobs.enqueue(input);
    const b = await second.jobs.enqueue(input);
    const c = await second.jobs.enqueue({ ...input, idempotencyKey: "compilation:outbox-2" });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id).toMatch(/^[a-f0-9-]{36}$/u);
  });
  it("publishes only a locator and preserves the outbox delivery identity", async () => {
    const { jobs, fetch } = fixture();
    const job = await jobs.enqueue({ type: delivery.type, payload: delivery.payload });
    expect(job.id).toBe(id);
    expect(job.externalJobId).toBe(id);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://api:5001/inner/api/knowledge-fs/background/jobs");
    expect(JSON.parse(init?.body as string)).toEqual(delivery);
    expect(init?.redirect).toBe("error");
    expect(await jobs.lease({ limit: 10, leaseMs: 1000, workerId: "api" })).toEqual([]);
  });
  it("does not acknowledge failed or uncertain publication", async () => {
    const { jobs, fetch } = fixture();
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(jobs.enqueue({ type: delivery.type, payload: delivery.payload })).rejects.toThrow(
      "503",
    );
    fetch.mockRejectedValueOnce(new Error("connection reset"));
    await expect(jobs.enqueue({ type: delivery.type, payload: delivery.payload })).rejects.toThrow(
      "connection reset",
    );
  });
  it("allows one matching delivery, a fenced heartbeat and acknowledgement", async () => {
    const { jobs, executeDelivery } = fixture();
    const outcome = await executeDelivery(delivery, async () => {
      expect(
        await jobs.lease({ limit: 1, leaseMs: 1000, workerId: "worker", types: ["other"] }),
      ).toEqual([]);
      const [job] = await jobs.lease({
        limit: 1,
        leaseMs: 1000,
        workerId: "worker",
        types: [delivery.type],
      });
      expect(job?.id).toBe(id);
      await expect(jobs.heartbeat({ jobId: id, leaseMs: 1000, workerId: "other" })).rejects.toThrow(
        "owner",
      );
      expect(
        (await jobs.heartbeat({ jobId: id, leaseMs: 2000, workerId: "worker" })).leaseExpiresAt,
      ).toBe(3000);
      await jobs.complete(id);
    });
    expect(outcome).toEqual({ outcome: "completed" });
    expect(await jobs.status(id)).toBeNull();
  });
  it("returns an early-delivery delay without publishing a second task itself", async () => {
    const { jobs, executeDelivery, fetch } = fixture();
    expect(
      await executeDelivery(delivery, async () => {
        await jobs.retry(id, { runAfter: 5000 });
      }),
    ).toEqual({ outcome: "retry", runAfter: 5000 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("clears delivery ownership after failure and handles redelivery", async () => {
    const { jobs, executeDelivery } = fixture();
    await expect(
      executeDelivery(delivery, async () => {
        throw new Error("worker crash");
      }),
    ).rejects.toThrow();
    expect(await executeDelivery(delivery, () => jobs.complete(id))).toEqual({
      outcome: "completed",
    });
  });
  it("isolates delivery execution from newly enqueued follow-up work", async () => {
    const { jobs, executeDelivery, fetch } = fixture();
    await executeDelivery(delivery, async () => {
      await jobs.enqueue({
        type: "quality.page-index-findability",
        payload: { compilationAttemptId: attemptId, publicationFingerprint: "sha256:test" },
      });
      await jobs.complete(id);
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await jobs.status(id)).toBeNull();
  });
  it("rejects arbitrary operations, scope overrides and command payloads", () => {
    expect(() => validateCeleryDelivery({ ...delivery, type: "shell" })).toThrow();
    expect(() =>
      validateCeleryDelivery({
        ...delivery,
        payload: { ...delivery.payload, tenantId: "another-tenant" },
      }),
    ).toThrow();
    expect(() => validateCeleryDelivery({ ...delivery, command: "anything" })).toThrow();
    expect(() => validateCeleryDelivery({ ...delivery, attempts: 0 })).toThrow();
  });
});
