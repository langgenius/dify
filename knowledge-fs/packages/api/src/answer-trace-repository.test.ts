import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  AnswerTraceSchema,
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type DatabaseRow,
  EvidenceBundleSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { AnswerTraceSemanticConflictError } from "./answer-trace-idempotency";
import {
  AnswerTraceCapacityExceededError,
  createDatabaseAnswerTraceRepository,
  createInMemoryAnswerTraceRepository,
} from "./answer-trace-repository";

function createFakeAnswerTraceExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "select" && input.tableName === "knowledge_spaces") {
      return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 0 };
    }
    return {
      rows: [],
      rowsAffected: input.operation === "insert" ? Math.max(1, input.maxRows) : 0,
    };
  };

  return { calls, executor };
}

describe("AnswerTrace repositories", () => {
  it("stores bounded in-memory traces with tenant scope and clone isolation", async () => {
    const repository = createInMemoryAnswerTraceRepository({ maxSteps: 2, maxTraces: 1 });
    const trace = AnswerTraceSchema.parse({
      createdAt: "2026-05-11T13:40:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "research",
      query: "How was the answer produced?",
      steps: [
        {
          endedAt: "2026-05-11T13:40:01.000Z",
          metadata: { cacheHit: false },
          name: "normalize",
          startedAt: "2026-05-11T13:40:00.000Z",
          status: "ok",
        },
      ],
    });

    const created = await repository.create(trace);
    const createdStep = created.steps[0];
    expect(createdStep).toBeDefined();
    if (!createdStep) {
      throw new Error("Expected created trace step");
    }
    createdStep.metadata.cacheHit = true;

    await expect(
      repository.get({
        id: trace.id,
        knowledgeSpaceId: trace.knowledgeSpaceId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        steps: [expect.objectContaining({ metadata: { cacheHit: false } })],
      }),
    );
    await expect(
      repository.get({
        id: trace.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
      }),
    ).resolves.toBeNull();
    await expect(repository.create(trace)).resolves.toEqual(trace);
    await expect(
      repository.create({ ...trace, query: "different payload" }),
    ).rejects.toBeInstanceOf(AnswerTraceSemanticConflictError);
    await expect(
      repository.create({
        ...trace,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02",
      }),
    ).rejects.toBeInstanceOf(AnswerTraceCapacityExceededError);
    await expect(
      repository.create({
        ...trace,
        id: trace.id,
        steps: [...trace.steps, ...trace.steps, ...trace.steps],
      }),
    ).rejects.toThrow("AnswerTrace repository step count exceeds maxSteps=2");
  });

  it("deletes old in-memory traces with bounded cleanup semantics", async () => {
    const repository = createInMemoryAnswerTraceRepository({ maxSteps: 2, maxTraces: 4 });
    const baseTrace = AnswerTraceSchema.parse({
      createdAt: "2026-05-11T12:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a03",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "auto",
      query: "old trace",
      steps: [],
    });
    const secondOldTrace = AnswerTraceSchema.parse({
      ...baseTrace,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a04",
    });
    const recentTrace = AnswerTraceSchema.parse({
      ...baseTrace,
      createdAt: "2026-05-11T13:30:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a05",
    });
    const otherSpaceTrace = AnswerTraceSchema.parse({
      ...baseTrace,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a06",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
    });
    await repository.create(baseTrace);
    await repository.create(secondOldTrace);
    await repository.create(recentTrace);
    await repository.create(otherSpaceTrace);

    await expect(
      repository.deleteOlderThan({
        knowledgeSpaceId: baseTrace.knowledgeSpaceId,
        maxTraces: 1,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).rejects.toThrow("AnswerTrace cleanup maxTraces=1 exceeded");
    await expect(
      repository.deleteOlderThan({
        knowledgeSpaceId: baseTrace.knowledgeSpaceId,
        maxTraces: 2,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).resolves.toBe(2);
    await expect(repository.getById(baseTrace.id)).resolves.toBeNull();
    await expect(repository.getById(secondOldTrace.id)).resolves.toBeNull();
    await expect(repository.getById(recentTrace.id)).resolves.toEqual(recentTrace);
    await expect(repository.getById(otherSpaceTrace.id)).resolves.toEqual(otherSpaceTrace);
  });

  it("writes and reads database traces through parameterized bounded SQL", async () => {
    const fake = createFakeAnswerTraceExecutor();
    const databaseRepository = createDatabaseAnswerTraceRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
    });
    const trace = AnswerTraceSchema.parse({
      createdAt: "2026-05-11T13:40:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a07",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "research",
      query: "How was the answer produced?",
      steps: [
        {
          endedAt: "2026-05-11T13:40:01.000Z",
          metadata: { cacheHit: false },
          name: "normalize",
          startedAt: "2026-05-11T13:40:00.000Z",
          status: "ok",
        },
      ],
    });

    await databaseRepository.create(trace);

    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        operation: "select",
        params: [trace.knowledgeSpaceId],
        tableName: "knowledge_spaces",
      }),
    );
    const traceInsertCall = fake.calls.find(
      (call) => call.operation === "insert" && call.tableName === "answer_traces",
    );
    expect(traceInsertCall).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        params: [
          trace.id,
          trace.knowledgeSpaceId,
          null,
          trace.query,
          trace.mode,
          null,
          null,
          null,
          null,
          true,
          trace.createdAt,
        ],
        tableName: "answer_traces",
      }),
    );
    expect(traceInsertCall?.sql).toContain("deletion_jobs");
    expect(traceInsertCall?.sql).toContain("active_slot");
    const stepInsertCall = fake.calls.find(
      (call) => call.operation === "insert" && call.tableName === "answer_trace_steps",
    );
    expect(stepInsertCall).toEqual(
      expect.objectContaining({
        maxRows: trace.steps.length,
        operation: "insert",
        tableName: "answer_trace_steps",
      }),
    );
    expect(stepInsertCall).toBeDefined();
    if (!stepInsertCall) {
      throw new Error("Expected answer trace step insert call");
    }
    expect(stepInsertCall.sql).not.toContain(trace.query);
    expect(stepInsertCall.params).toContain(JSON.stringify({ cacheHit: false }));

    const readCalls: DatabaseExecuteInput[] = [];
    const readRepository = createDatabaseAnswerTraceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          readCalls.push({ ...input, params: [...input.params] });

          if (input.tableName === "answer_traces") {
            return {
              rows: [
                {
                  completed: true,
                  created_at: trace.createdAt,
                  evidence_bundle_id: null,
                  id: trace.id,
                  knowledge_space_id: trace.knowledgeSpaceId,
                  mode: trace.mode,
                  query: trace.query,
                },
              ],
              rowsAffected: 1,
            };
          }

          return {
            rows: [
              {
                ended_at: "2026-05-11T13:40:01.000Z",
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7d01",
                metadata: { cacheHit: false },
                name: "normalize",
                started_at: "2026-05-11T13:40:00.000Z",
                status: "ok",
                trace_id: trace.id,
              },
            ],
            rowsAffected: 1,
          };
        },
        kind: "postgres",
      }),
    });

    await expect(
      readRepository.get({
        id: trace.id,
        knowledgeSpaceId: trace.knowledgeSpaceId,
      }),
    ).resolves.toEqual(trace);
    expect(readCalls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [trace.knowledgeSpaceId, trace.id],
        tableName: "answer_traces",
      }),
    );
    const traceReadCall = readCalls[0];
    expect(traceReadCall).toBeDefined();
    if (!traceReadCall) {
      throw new Error("Expected answer trace read call");
    }
    expect(traceReadCall.sql).not.toContain(trace.id);
    expect(traceReadCall.sql).toContain("deletion_jobs");
    expect(traceReadCall.sql).toContain("document_assets");
    expect(traceReadCall.sql).toContain("evidence_bundles");
    expect(traceReadCall.sql).toContain("lifecycle_state");
    expect(readCalls[1]).toEqual(
      expect.objectContaining({
        maxRows: 1000,
        operation: "select",
        params: [trace.id],
        tableName: "answer_trace_steps",
      }),
    );
  });

  it("uses the terminal query.generate summary for completion after a recoverable stage error", async () => {
    const createRepository = () => {
      const fake = createFakeAnswerTraceExecutor();
      return {
        fake,
        repository: createDatabaseAnswerTraceRepository({
          database: createSchemaDatabaseAdapter({
            executor: fake.executor,
            kind: "postgres",
            transaction: async (callback) => callback({ execute: fake.executor }),
          }),
        }),
      };
    };
    const successfulFallback = AnswerTraceSchema.parse({
      createdAt: "2026-07-14T13:40:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a17",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "fast",
      query: "Use the text fallback",
      steps: [
        {
          endedAt: "2026-07-14T13:40:01.000Z",
          metadata: { fallback: "text" },
          name: "query.answer.multimodal",
          startedAt: "2026-07-14T13:40:00.000Z",
          status: "error",
        },
        {
          endedAt: "2026-07-14T13:40:02.000Z",
          metadata: { finishReason: "stop" },
          name: "query.generate",
          startedAt: "2026-07-14T13:40:01.000Z",
          status: "ok",
        },
      ],
    });
    const successful = createRepository();

    await successful.repository.create(successfulFallback);

    expect(
      successful.fake.calls.find(
        (call) => call.operation === "insert" && call.tableName === "answer_traces",
      )?.params[9],
    ).toBe(true);

    const failedTerminal = createRepository();
    await failedTerminal.repository.create(
      AnswerTraceSchema.parse({
        ...successfulFallback,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a18",
        steps: successfulFallback.steps.map((step) =>
          step.name === "query.generate" ? { ...step, status: "error" as const } : step,
        ),
      }),
    );
    expect(
      failedTerminal.fake.calls.find(
        (call) => call.operation === "insert" && call.tableName === "answer_traces",
      )?.params[9],
    ).toBe(false);
  });

  it.each(["postgres", "tidb"] as const)(
    "makes an exact %s create retry idempotent and rejects a semantic collision",
    async (kind) => {
      let storedTrace: DatabaseRow | undefined;
      let storedSteps: DatabaseRow[] = [];
      let insertCount = 0;
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 1 };
        }
        if (input.tableName === "answer_traces" && input.operation === "select") {
          return { rows: storedTrace ? [storedTrace] : [], rowsAffected: storedTrace ? 1 : 0 };
        }
        if (input.tableName === "answer_trace_steps" && input.operation === "select") {
          return { rows: storedSteps, rowsAffected: storedSteps.length };
        }
        if (input.tableName === "answer_traces" && input.operation === "insert") {
          insertCount += 1;
          storedTrace = {
            access_channel: input.params[8],
            completed: input.params[9],
            created_at: input.params[10],
            evidence_bundle_id: input.params[2],
            id: input.params[0],
            knowledge_space_id: input.params[1],
            mode: input.params[4],
            permission_snapshot_id: input.params[6],
            permission_snapshot_revision: input.params[7],
            query: input.params[3],
            subject_id: input.params[5],
          };
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "answer_trace_steps" && input.operation === "insert") {
          insertCount += 1;
          storedSteps = Array.from({ length: input.params.length / 7 }, (_value, index) => {
            const offset = index * 7;
            return {
              ended_at: input.params[offset + 6],
              id: input.params[offset],
              metadata: JSON.parse(String(input.params[offset + 4])) as Record<string, unknown>,
              name: input.params[offset + 2],
              started_at: input.params[offset + 5],
              status: input.params[offset + 3],
              trace_id: input.params[offset + 1],
            };
          });
          return { rows: [], rowsAffected: storedSteps.length };
        }
        return { rows: [], rowsAffected: 0 };
      };
      const repository = createDatabaseAnswerTraceRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => callback({ execute: executor }),
        }),
      });
      const trace = databaseTrace();

      await expect(repository.create(trace)).resolves.toEqual(trace);
      await expect(repository.create(trace)).resolves.toEqual(trace);
      await expect(
        repository.create({ ...trace, query: "same id, different payload" }),
      ).rejects.toBeInstanceOf(AnswerTraceSemanticConflictError);
      expect(insertCount).toBe(2);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "persists an embedded EvidenceBundle with mandatory scope before the %s trace",
    async (kind) => {
      const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7e01";
      const evidenceBundle = EvidenceBundleSchema.parse({
        createdAt: "2026-05-11T13:40:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e02",
        items: [
          {
            citations: [{ documentAssetId, documentVersion: 1, sectionPath: [] }],
            conflicts: [],
            freshness: { status: "fresh" },
            metadata: {},
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e03",
            score: 0.9,
            scores: { final: 0.9, retrieval: 0.8 },
            text: "Evidence",
          },
        ],
        missingEvidence: [],
        query: "embedded evidence",
        state: "answerable",
      });
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 1 };
        }
        if (input.tableName === "document_assets") {
          return { rows: [{ id: documentAssetId }], rowsAffected: 1 };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      };
      const repository = createDatabaseAnswerTraceRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => callback({ execute: executor }),
        }),
      });
      const trace = AnswerTraceSchema.parse({
        ...databaseTrace(),
        steps: [
          {
            endedAt: "2026-05-11T13:40:01.000Z",
            metadata: { evidenceBundle },
            name: "query.generate",
            startedAt: "2026-05-11T13:40:00.000Z",
            status: "ok",
          },
        ],
      });

      await expect(repository.create(trace)).resolves.toMatchObject({
        evidenceBundleId: evidenceBundle.id,
      });
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "knowledge_spaces"],
        ["select", "answer_traces"],
        ["select", "document_assets"],
        ["select", "evidence_bundles"],
        ["insert", "evidence_bundles"],
        ["insert", "answer_traces"],
        ["insert", "answer_trace_steps"],
      ]);
      const bundleInsert = calls.find(
        (call) => call.operation === "insert" && call.tableName === "evidence_bundles",
      ) as DatabaseExecuteInput;
      expect(bundleInsert.params).toContain("tenant-1");
      expect(bundleInsert.params).toContain(trace.knowledgeSpaceId);
      expect(bundleInsert.sql).toContain("active_slot");
      const traceInsert = calls.find(
        (call) => call.operation === "insert" && call.tableName === "answer_traces",
      ) as DatabaseExecuteInput;
      expect(traceInsert.params).toContain(evidenceBundle.id);
      expect(traceInsert.sql).toContain("scoped_bundle");
      assertSqlArity(bundleInsert, kind);
      assertSqlArity(traceInsert, kind);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rolls back and writes no steps when %s deletion admission rejects the trace",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      let commits = 0;
      let rollbacks = 0;
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      };
      const repository = createDatabaseAnswerTraceRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => {
            try {
              const result = await callback({ execute: executor });
              commits += 1;
              return result;
            } catch (error) {
              rollbacks += 1;
              throw error;
            }
          },
        }),
      });

      await expect(repository.create(databaseTrace())).rejects.toThrow(
        "Answer trace creation rejected by durable deletion",
      );
      expect(commits).toBe(0);
      expect(rollbacks).toBe(1);
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "knowledge_spaces"],
        ["select", "answer_traces"],
        ["insert", "answer_traces"],
      ]);
      const traceInsert = calls[2] as DatabaseExecuteInput;
      expect(traceInsert.sql).toContain("NOT EXISTS");
      expect(traceInsert.sql).toContain("deletion_jobs");
      assertSqlArity(traceInsert, kind);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rolls back the inserted %s trace when a step insert fails",
    async (kind) => {
      let rollbacks = 0;
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 0 };
        }
        if (input.tableName === "answer_trace_steps") {
          throw new Error("step insert failed");
        }
        return { rows: [], rowsAffected: 1 };
      };
      const repository = createDatabaseAnswerTraceRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => {
            try {
              return await callback({ execute: executor });
            } catch (error) {
              rollbacks += 1;
              throw error;
            }
          },
        }),
      });

      await expect(repository.create(databaseTrace())).rejects.toThrow("step insert failed");
      expect(rollbacks).toBe(1);
    },
  );

  it("validates repository bounds and cleanup input", async () => {
    expect(() => createInMemoryAnswerTraceRepository({ maxSteps: 0, maxTraces: 1 })).toThrow(
      "AnswerTrace repository maxSteps must be at least 1",
    );
    expect(() => createInMemoryAnswerTraceRepository({ maxSteps: 1, maxTraces: 0 })).toThrow(
      "AnswerTrace repository maxTraces must be at least 1",
    );

    const repository = createInMemoryAnswerTraceRepository({ maxSteps: 1, maxTraces: 1 });
    await expect(
      repository.create(
        AnswerTraceSchema.parse({
          createdAt: "2026-05-11T13:40:00.000Z",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7aff",
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
          mode: "fast",
          permissionSnapshot: {
            accessChannel: "interactive",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7afe",
            revision: 1,
          },
          query: "invalid provenance",
          steps: [],
        }),
      ),
    ).rejects.toThrow("AnswerTrace permission snapshot requires subjectId");
    await expect(
      repository.deleteOlderThan({
        knowledgeSpaceId: " ",
        maxTraces: 1,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).rejects.toThrow("AnswerTrace cleanup knowledgeSpaceId is required");
    await expect(
      repository.deleteOlderThan({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        maxTraces: 0,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).rejects.toThrow("AnswerTrace cleanup maxTraces must be at least 1");
    await expect(
      repository.deleteOlderThan({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        maxTraces: 1,
        olderThan: "not-a-date",
      }),
    ).rejects.toThrow("AnswerTrace cleanup olderThan must be a valid timestamp");
  });
});

function databaseTrace() {
  return AnswerTraceSchema.parse({
    createdAt: "2026-05-11T13:40:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a08",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
    mode: "deep",
    query: "Race durable deletion",
    steps: [
      {
        endedAt: "2026-05-11T13:40:01.000Z",
        metadata: {},
        name: "answer",
        startedAt: "2026-05-11T13:40:00.000Z",
        status: "ok",
      },
    ],
  });
}

function assertSqlArity(call: DatabaseExecuteInput, kind: "postgres" | "tidb"): void {
  if (kind === "tidb") {
    expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
  expect(Math.max(...positions)).toBe(call.params.length);
}
