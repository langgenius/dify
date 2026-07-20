import { describe, expect, it, vi } from "vitest";

import {
  type AnswerTraceRecorder,
  type RecordAnswerTraceInput,
  createAnswerTraceRecorder,
} from "./answer-trace-recorder";
import { createInMemoryAnswerTraceRepository } from "./answer-trace-repository";
import {
  type QueryGenerationEvent,
  createQuerySseResponse,
  createResearchTaskProgressSseResponse,
} from "./gateway-sse-responses";
import { RetrievalExecutionLeaseLostError } from "./retrieval-execution-lease";

const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const BUNDLE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";

describe("createQuerySseResponse", () => {
  it("never emits answer.done when durable AnswerTrace persistence fails", async () => {
    const record = vi.fn(async () => {
      throw new Error("trace database unavailable");
    });
    const onTerminal = vi.fn(async () => undefined);
    const response = createQuerySseResponse({
      answerTraceRecorder: { record },
      generator: {
        stream: async function* () {
          yield { delta: "partial answer", type: "delta" as const };
          yield { finishReason: "stop", metadata: {}, type: "done" as const };
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          revision: 1,
        },
        permissionScope: ["knowledge-spaces:read"],
        query: "persist this answer",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "user-1",
          tenantId: "tenant-1",
        },
        traceId: TRACE_ID,
      },
      onTerminal,
      traceId: TRACE_ID,
    });

    const body = await response.text();
    expect(body).toContain("partial answer");
    expect(body).toContain("answer.error");
    expect(body).not.toContain("answer.done");
    expect(record).toHaveBeenCalledTimes(2);
    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith("failed");
  });

  it("keeps success when a committed AnswerTrace acknowledgement is lost", async () => {
    const durable = createInMemoryAnswerTraceRepository({ maxSteps: 20, maxTraces: 20 });
    let loseAcknowledgement = true;
    const create = vi.fn(async (trace: Parameters<typeof durable.create>[0]) => {
      const stored = await durable.create(trace);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error("commit acknowledgement lost");
      }
      return stored;
    });
    const recorder = createAnswerTraceRecorder({
      now: () => "2026-07-14T13:40:00.000Z",
      repository: { create, get: durable.get },
    });
    const onTerminal = vi.fn(async () => undefined);
    const response = createQuerySseResponse({
      answerTraceRecorder: recorder,
      generator: {
        stream: async function* () {
          yield { delta: "durably committed", type: "delta" as const };
          yield { finishReason: "stop", metadata: {}, type: "done" as const };
        },
      },
      initialTraceSteps: [
        {
          endedAt: "2026-07-14T13:39:59.250Z",
          metadata: {
            degraded: false,
            requestedMode: "auto",
            resolvedMode: "fast",
            resolver: "llm",
          },
          name: "query.route",
          startedAt: "2026-07-14T13:39:59.000Z",
          status: "ok",
        },
      ],
      input: queryInput(),
      onTerminal,
      traceId: TRACE_ID,
    });

    const body = await response.text();
    expect(body).toContain("answer.done");
    expect(body).not.toContain("answer.error");
    expect(create).toHaveBeenCalledOnce();
    await expect(durable.get({ id: TRACE_ID, knowledgeSpaceId: SPACE_ID })).resolves.toMatchObject({
      id: TRACE_ID,
      steps: [
        expect.objectContaining({
          metadata: expect.objectContaining({ requestedMode: "auto", resolvedMode: "fast" }),
          name: "query.route",
          status: "ok",
        }),
        expect.objectContaining({ name: "query.generate", status: "ok" }),
      ],
    });
    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith("succeeded");
  });

  it.each(["missing", "multiple"] as const)(
    "rejects a generator with %s terminal done events",
    async (terminalShape) => {
      const records: RecordAnswerTraceInput[] = [];
      const record = vi.fn(async (input: RecordAnswerTraceInput) => {
        records.push(input);
        return recordedAnswerTrace(input);
      });
      const onTerminal = vi.fn(async () => undefined);
      const response = createQuerySseResponse({
        answerTraceRecorder: { record },
        generator: {
          stream: async function* () {
            yield { delta: "partial answer", type: "delta" as const };
            if (terminalShape === "multiple") {
              yield { finishReason: "stop", metadata: {}, type: "done" as const };
              yield { finishReason: "duplicate", metadata: {}, type: "done" as const };
            }
          },
        },
        input: queryInput(),
        onTerminal,
        traceId: TRACE_ID,
      });

      const body = await response.text();
      expect(body).toContain("partial answer");
      expect(body).toContain("answer.error");
      expect(body).not.toContain("answer.done");
      expect(record).toHaveBeenCalledOnce();
      expect(records[0]?.steps.at(-1)).toMatchObject({
        name: "query.generate",
        status: "error",
      });
      expect(onTerminal).toHaveBeenCalledOnce();
      expect(onTerminal).toHaveBeenCalledWith("failed");
    },
  );

  it("keeps durable success authoritative when the lease is revoked after trace commit", async () => {
    const abort = new AbortController();
    const record = vi.fn(async (input: RecordAnswerTraceInput) => {
      abort.abort(new RetrievalExecutionLeaseLostError());
      return recordedAnswerTrace(input);
    });
    const onTerminal = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const response = createQuerySseResponse({
      answerTraceRecorder: { record },
      executionLease: {
        assertActive: vi.fn(async () => {
          if (abort.signal.aborted) throw new RetrievalExecutionLeaseLostError();
        }),
        release,
        signal: abort.signal,
      },
      generator: {
        stream: async function* () {
          yield { delta: "committed answer", type: "delta" as const };
          yield { finishReason: "stop", metadata: {}, type: "done" as const };
        },
      },
      input: queryInput(),
      onTerminal,
      traceId: TRACE_ID,
    });

    const body = await response.text();
    expect(body).toContain("answer.done");
    expect(body).not.toContain("answer.error");
    expect(record).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith("succeeded");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not let client cancellation overtake a success commit already in progress", async () => {
    let markRecordStarted!: () => void;
    let releaseRecord!: () => void;
    let markSucceeded!: () => void;
    const recordStarted = new Promise<void>((resolve) => {
      markRecordStarted = resolve;
    });
    const recordGate = new Promise<void>((resolve) => {
      releaseRecord = resolve;
    });
    const succeeded = new Promise<void>((resolve) => {
      markSucceeded = resolve;
    });
    const record = vi.fn(async (input: RecordAnswerTraceInput) => {
      markRecordStarted();
      await recordGate;
      return recordedAnswerTrace(input);
    });
    const onTerminal = vi.fn(async (status: "canceled" | "failed" | "succeeded") => {
      if (status === "succeeded") markSucceeded();
    });
    const response = createQuerySseResponse({
      answerTraceRecorder: { record },
      generator: {
        stream: async function* () {
          yield { delta: "answer before commit", type: "delta" as const };
          yield { finishReason: "stop", metadata: {}, type: "done" as const };
        },
      },
      input: queryInput(),
      onTerminal,
      traceId: TRACE_ID,
    });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await recordStarted;

    await reader?.cancel();
    releaseRecord();
    await succeeded;

    expect(record).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith("succeeded");
  });

  it("finalizes failure when a success commit fails after the client disconnects", async () => {
    let markRecordStarted!: () => void;
    let releaseRecord!: () => void;
    let markFailed!: () => void;
    const recordStarted = new Promise<void>((resolve) => {
      markRecordStarted = resolve;
    });
    const recordGate = new Promise<void>((resolve) => {
      releaseRecord = resolve;
    });
    const failed = new Promise<void>((resolve) => {
      markFailed = resolve;
    });
    const records: RecordAnswerTraceInput[] = [];
    const record = vi.fn(async (input: RecordAnswerTraceInput) => {
      records.push(input);
      if (records.length === 1) {
        markRecordStarted();
        await recordGate;
        throw new Error("success trace commit failed");
      }
      return recordedAnswerTrace(input);
    });
    const onTerminal = vi.fn(async (status: "canceled" | "failed" | "succeeded") => {
      if (status === "failed") markFailed();
    });
    const response = createQuerySseResponse({
      answerTraceRecorder: { record },
      generator: {
        stream: async function* () {
          yield { delta: "answer before failed commit", type: "delta" as const };
          yield { finishReason: "stop", metadata: {}, type: "done" as const };
        },
      },
      input: queryInput(),
      onTerminal,
      traceId: TRACE_ID,
    });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await recordStarted;

    await reader?.cancel();
    releaseRecord();
    await failed;

    expect(record).toHaveBeenCalledTimes(2);
    expect(records.map((item) => item.steps.at(-1)?.status)).toEqual(["ok", "error"]);
    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith("failed");
  });

  it("checks the durable execution lease before every event and never streams a stale chunk", async () => {
    let checks = 0;
    const release = vi.fn(async () => undefined);
    const record = vi.fn();
    const response = createQuerySseResponse({
      answerTraceRecorder: { record },
      executionLease: {
        assertActive: async () => {
          checks += 1;
          if (checks === 2) throw new RetrievalExecutionLeaseLostError();
        },
        release,
        signal: new AbortController().signal,
      },
      generator: {
        stream: async function* () {
          yield { delta: "deleted-secret-evidence", type: "delta" };
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionScope: ["knowledge-spaces:read"],
        query: "stale query",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "user-1",
          tenantId: "tenant-1",
        },
        traceId: TRACE_ID,
      },
      traceId: TRACE_ID,
    });

    const body = await response.text();
    expect(body).not.toContain("deleted-secret-evidence");
    expect(body).toContain("knowledge deletion started");
    expect(record).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("interrupts a hung generator when deletion invalidates the lease", async () => {
    const abort = new AbortController();
    const release = vi.fn(async () => undefined);
    const returnIterator = vi.fn(async () => ({ done: true as const, value: undefined }));
    const response = createQuerySseResponse({
      executionLease: {
        assertActive: vi.fn(async () => undefined),
        release,
        signal: abort.signal,
      },
      generator: {
        stream: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<QueryGenerationEvent>>(() => undefined),
            return: returnIterator,
          }),
        }),
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        mode: "deep",
        permissionScope: ["knowledge-spaces:read"],
        query: "hung query",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "user-1",
          tenantId: "tenant-1",
        },
        traceId: TRACE_ID,
      },
      traceId: TRACE_ID,
    });

    await Promise.resolve();
    abort.abort(new RetrievalExecutionLeaseLostError());
    const body = await response.text();

    expect(body).toContain("knowledge deletion started");
    expect(returnIterator).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("records streamed query traces under the same HTTP trace id", async () => {
    const records: RecordAnswerTraceInput[] = [];
    const answerTraceRecorder: AnswerTraceRecorder = {
      record: async (input) => {
        records.push(input);

        return {
          createdAt: "2026-05-11T13:40:00.000Z",
          ...(input.evidenceBundleId ? { evidenceBundleId: input.evidenceBundleId } : {}),
          id: input.traceId ?? TRACE_ID,
          knowledgeSpaceId: input.knowledgeSpaceId,
          mode: input.mode,
          query: input.query,
          steps: input.steps.map((step) => ({
            ...step,
            endedAt: "2026-05-11T13:40:00.000Z",
            startedAt: "2026-05-11T13:40:00.000Z",
          })),
        };
      },
    };
    const events: QueryGenerationEvent[] = [
      { delta: "answer", type: "delta" },
      {
        finishReason: "stop",
        metadata: { evidenceBundle: { id: BUNDLE_ID }, model: "fast-model" },
        type: "done",
      },
    ];

    const response = createQuerySseResponse({
      answerTraceRecorder,
      generator: {
        stream: async function* () {
          yield* events;
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          revision: 1,
        },
        permissionScope: ["knowledge-spaces:read"],
        query: "What does the evidence say?",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "user-1",
          tenantId: "tenant-1",
        },
        traceId: TRACE_ID,
      },
      traceId: TRACE_ID,
    });

    await expect(response.text()).resolves.toContain(`"traceId":"${TRACE_ID}"`);
    expect(records).toEqual([
      expect.objectContaining({
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        query: "What does the evidence say?",
        traceId: TRACE_ID,
        steps: [
          expect.objectContaining({
            metadata: expect.objectContaining({
              evidenceBundle: expect.objectContaining({ id: BUNDLE_ID }),
              eventCount: 2,
              finishReason: "stop",
              model: "fast-model",
            }),
            name: "query.generate",
            status: "ok",
          }),
        ],
      }),
    ]);
  });

  it("lifts generator trace-steps into the recorded trace without streaming them to clients", async () => {
    const records: RecordAnswerTraceInput[] = [];
    const answerTraceRecorder: AnswerTraceRecorder = {
      record: async (input) => {
        records.push(input);

        return {
          createdAt: "2026-05-11T13:40:00.000Z",
          id: input.traceId ?? TRACE_ID,
          knowledgeSpaceId: input.knowledgeSpaceId,
          mode: input.mode,
          query: input.query,
          steps: input.steps.map((step) => ({
            ...step,
            endedAt: step.endedAt ?? "2026-05-11T13:40:00.000Z",
            startedAt: step.startedAt ?? "2026-05-11T13:40:00.000Z",
          })),
        };
      },
    };
    const events: QueryGenerationEvent[] = [
      {
        step: {
          endedAt: "2026-05-11T13:39:59.500Z",
          metadata: { durationMs: 500, itemCount: 3 },
          name: "query.retrieve",
          startedAt: "2026-05-11T13:39:59.000Z",
          status: "ok",
        },
        type: "trace-step",
      },
      { delta: "answer", type: "delta" },
      { finishReason: "stop", metadata: {}, type: "done" },
    ];

    const response = createQuerySseResponse({
      answerTraceRecorder,
      generator: {
        stream: async function* () {
          yield* events;
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          revision: 1,
        },
        permissionScope: ["knowledge-spaces:read"],
        query: "What does the evidence say?",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "user-1",
          tenantId: "tenant-1",
        },
        traceId: TRACE_ID,
      },
      traceId: TRACE_ID,
    });

    const body = await response.text();
    expect(body).not.toContain("trace-step");
    expect(body).not.toContain("query.retrieve");
    expect(records[0]?.steps.map((step) => step.name)).toEqual([
      "query.retrieve",
      "query.generate",
    ]);
    expect(records[0]?.steps[0]).toMatchObject({
      endedAt: "2026-05-11T13:39:59.500Z",
      startedAt: "2026-05-11T13:39:59.000Z",
      status: "ok",
    });
    // The summary step still counts every generator event, trace-steps included.
    expect(records[0]?.steps[1]).toMatchObject({
      metadata: expect.objectContaining({ eventCount: 3 }),
      name: "query.generate",
    });
  });
});

function queryInput() {
  return {
    knowledgeSpaceId: SPACE_ID,
    mode: "fast" as const,
    permissionSnapshot: {
      accessChannel: "interactive" as const,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      revision: 1,
    },
    permissionScope: ["knowledge-spaces:read"],
    query: "What does the evidence say?",
    subject: {
      scopes: ["knowledge-spaces:read"],
      subjectId: "user-1",
      tenantId: "tenant-1",
    },
    traceId: TRACE_ID,
  };
}

function recordedAnswerTrace(input: RecordAnswerTraceInput) {
  const createdAt = "2026-07-14T13:40:00.000Z";
  return {
    createdAt,
    id: input.traceId ?? TRACE_ID,
    knowledgeSpaceId: input.knowledgeSpaceId,
    mode: input.mode,
    permissionSnapshot: { ...input.permissionSnapshot },
    query: input.query,
    steps: input.steps.map((step) => ({
      ...step,
      endedAt: step.endedAt ?? createdAt,
      startedAt: step.startedAt ?? createdAt,
    })),
    subjectId: input.subjectId,
  };
}

describe("createResearchTaskProgressSseResponse", () => {
  it("continues from the delivered backlog cursor and releases the live iterator", async () => {
    const released = vi.fn();
    const subscribe = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        try {
          yield progressEvent(2, "retrieving");
        } finally {
          released();
        }
      },
    }));
    const response = createResearchTaskProgressSseResponse({
      limit: 2,
      repository: {
        append: vi.fn(),
        list: vi.fn(async () => ({ items: [progressEvent(1, "planning")] })),
        subscribe,
      },
      researchTaskJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
      tenantId: "tenant-1",
    });

    const body = await response.text();
    expect(body).toContain('"sequence":1');
    expect(body).toContain('"sequence":2');
    expect(subscribe).toHaveBeenCalledWith({
      cursor: "1",
      researchTaskJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
      tenantId: "tenant-1",
    });
    expect(released).toHaveBeenCalledOnce();
  });

  it("stops a live stream and releases its iterator when authorization is revoked", async () => {
    const release = vi.fn(async () => ({ done: true as const, value: undefined }));
    const next = vi
      .fn()
      .mockResolvedValueOnce({ done: false as const, value: progressEvent(1, "planning") })
      .mockReturnValue(new Promise(() => undefined));
    let authorizationChecks = 0;
    const response = createResearchTaskProgressSseResponse({
      authorizationRecheckIntervalMs: 10,
      authorize: async () => {
        authorizationChecks += 1;
        if (authorizationChecks >= 3) {
          throw new Error("revoked");
        }
      },
      limit: 2,
      repository: {
        append: vi.fn(),
        list: vi.fn(async () => ({ items: [] })),
        subscribe: vi.fn(() => ({
          [Symbol.asyncIterator]: () => ({ next, return: release }),
        })),
      },
      researchTaskJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
      tenantId: "tenant-1",
    });

    await expect(response.text()).rejects.toThrow("revoked");
    expect(release).toHaveBeenCalledOnce();
  });
});

function progressEvent(sequence: number, stage: "planning" | "retrieving") {
  return {
    createdAt: "2026-07-14T00:00:00.000Z",
    id: `progress-${sequence}`,
    knowledgeSpaceId: SPACE_ID,
    payload: {},
    researchTaskJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
    sequence,
    stage,
    tenantId: "tenant-1",
    type: "research_task.stage_changed" as const,
  };
}
