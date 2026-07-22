import { describe, expect, it } from "vitest";

import type { AnswerTrace } from "@knowledge/core";

import { AnswerTraceSemanticConflictError } from "./answer-trace-idempotency";
import { createAnswerTraceRecorder } from "./answer-trace-recorder";
import { createInMemoryAnswerTraceRepository } from "./answer-trace-repository";

describe("createAnswerTraceRecorder", () => {
  it("records bounded trace steps with generated timestamps and clone isolation", async () => {
    const created: AnswerTrace[] = [];
    const recorder = createAnswerTraceRecorder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      maxSteps: 2,
      now: () => "2026-05-11T13:40:00.000Z",
      repository: {
        create: async (trace) => {
          created.push(trace);
          return JSON.parse(JSON.stringify(trace));
        },
      },
    });

    const trace = await recorder.record({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "research",
      permissionSnapshot: answerTracePermissionSnapshot(),
      query: "How was the answer produced?",
      subjectId: "subject-1",
      steps: [{ metadata: { cacheHit: false }, name: "normalize", status: "ok" }],
    });

    expect(trace).toMatchObject({
      createdAt: "2026-05-11T13:40:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      steps: [
        {
          endedAt: "2026-05-11T13:40:00.000Z",
          metadata: { cacheHit: false },
          name: "normalize",
          startedAt: "2026-05-11T13:40:00.000Z",
          status: "ok",
        },
      ],
    });

    const firstStep = trace.steps[0];
    expect(firstStep).toBeDefined();
    if (!firstStep) {
      throw new Error("Expected first trace step");
    }
    firstStep.metadata.cacheHit = true;
    expect(created[0]?.steps[0]?.metadata).toEqual({ cacheHit: false });
  });

  it("rejects invalid recorder bounds and overlarge step batches before persistence", async () => {
    const repository = {
      create: async () => {
        throw new Error("should not persist");
      },
    };

    expect(() => createAnswerTraceRecorder({ maxSteps: 0, repository })).toThrow(
      "AnswerTrace recorder maxSteps must be at least 1",
    );

    const recorder = createAnswerTraceRecorder({ maxSteps: 1, repository });

    await expect(
      recorder.record({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        mode: "fast",
        permissionSnapshot: answerTracePermissionSnapshot(),
        query: "too many",
        subjectId: "subject-1",
        steps: [
          { metadata: {}, name: "first", status: "ok" },
          { metadata: {}, name: "second", status: "ok" },
        ],
      }),
    ).rejects.toThrow("AnswerTrace recorder step count exceeds maxSteps=1");
  });

  it("records capability provenance without a member permission snapshot", async () => {
    const created: AnswerTrace[] = [];
    const recorder = createAnswerTraceRecorder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7a03",
      now: () => "2026-05-11T13:40:00.000Z",
      repository: {
        create: async (trace) => {
          created.push(trace);
          return trace;
        },
      },
    });

    await expect(
      recorder.record({
        capabilityGrantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca1",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        mode: "deep",
        query: "Capability-only provenance",
        steps: [{ metadata: {}, name: "query.generate", status: "ok" }],
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      capabilityGrantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca1",
      tenantId: "tenant-1",
    });
    expect(created[0]).not.toHaveProperty("permissionSnapshot");
    expect(created[0]).not.toHaveProperty("subjectId");
  });

  it("reconciles a lost create acknowledgement and fails closed on a different payload", async () => {
    const durable = createInMemoryAnswerTraceRepository({ maxSteps: 5, maxTraces: 5 });
    const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02";
    let loseAcknowledgement = true;
    let createCalls = 0;
    const recorder = createAnswerTraceRecorder({
      now: () => "2026-05-11T13:40:00.000Z",
      repository: {
        create: async (trace) => {
          createCalls += 1;
          const stored = await durable.create(trace);
          if (loseAcknowledgement) {
            loseAcknowledgement = false;
            throw new Error("commit acknowledgement lost");
          }
          return stored;
        },
        get: durable.get,
      },
    });
    const input = {
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "fast" as const,
      permissionSnapshot: answerTracePermissionSnapshot(),
      query: "Did the success commit land?",
      steps: [{ metadata: {}, name: "query.generate", status: "ok" as const }],
      subjectId: "subject-1",
      traceId,
    };

    await expect(recorder.record(input)).resolves.toMatchObject({ id: traceId });
    expect(createCalls).toBe(1);
    await expect(
      durable.get({ id: traceId, knowledgeSpaceId: input.knowledgeSpaceId }),
    ).resolves.toMatchObject({ id: traceId });
    await expect(
      recorder.record({ ...input, query: "different semantic payload" }),
    ).rejects.toBeInstanceOf(AnswerTraceSemanticConflictError);
  });
});

function answerTracePermissionSnapshot() {
  return {
    accessChannel: "interactive" as const,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
    revision: 1,
  };
}
