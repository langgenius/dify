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
  answerTraceReadVisibilitySql,
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
  it.each(["postgres", "tidb"] as const)(
    "scopes %s trace visibility only to whole-space deletion",
    (kind) => {
      const database = createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind,
      });
      const sql = answerTraceReadVisibilitySql(database, "trace");
      const quoted = (name: string) => (kind === "postgres" ? `"${name}"` : `\`${name}\``);

      expect(sql).toContain(`${quoted("trace")}.${quoted("knowledge_space_id")}`);
      expect(sql).toContain(
        `active_deletion.${quoted("active_slot")} = 1 AND active_deletion.${quoted("target_type")} = 'knowledge_space'`,
      );
      expect(sql).toContain(
        `active_deletion.${quoted("target_id")} = ${quoted("readable_space")}.${quoted("id")}`,
      );
      expect(sql).not.toContain("readable_document");
      expect(sql).not.toContain("document_assets");
    },
  );

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

  it.each(["postgres", "tidb"] as const)(
    "persists %s query images as a JSON column and reads them back",
    async (kind) => {
      const queryImages = [
        {
          byteSize: 2_048,
          mimeType: "image/png" as const,
          sha256: "a".repeat(64),
          uploadFileId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c90",
        },
      ];
      const trace = AnswerTraceSchema.parse({
        createdAt: "2026-05-11T13:40:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        mode: "fast",
        query: "What does this diagram show?",
        queryImages,
        steps: [],
      });
      const fake = createFakeAnswerTraceExecutor();
      await createDatabaseAnswerTraceRepository({
        database: createSchemaDatabaseAdapter({
          executor: fake.executor,
          kind,
          transaction: async (callback) => callback({ execute: fake.executor }),
        }),
      }).create(trace);

      const traceInsert = fake.calls.find(
        (call) => call.operation === "insert" && call.tableName === "answer_traces",
      );
      expect(traceInsert?.sql).toContain(kind === "postgres" ? '"query_images"' : "`query_images`");
      expect(traceInsert?.sql).toContain(kind === "postgres" ? "$14::jsonb" : "CAST(? AS JSON)");
      expect(traceInsert?.params).toContain(JSON.stringify(queryImages));
      if (traceInsert) assertSqlArity(traceInsert, kind);

      const readRepository = createDatabaseAnswerTraceRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => {
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
                    query_images: kind === "postgres" ? queryImages : JSON.stringify(queryImages),
                  },
                ],
                rowsAffected: 1,
              };
            }
            return { rows: [], rowsAffected: 0 };
          },
          kind,
        }),
      });
      await expect(readRepository.getById(trace.id)).resolves.toEqual(trace);
    },
  );

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
          null,
          trace.knowledgeSpaceId,
          null,
          null,
          trace.query,
          trace.mode,
          null,
          null,
          null,
          null,
          true,
          trace.createdAt,
          null,
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
    expect(traceReadCall.sql).not.toContain("document_assets");
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
      )?.params[11],
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
      )?.params[11],
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
            access_channel: input.params[10],
            capability_grant_id: input.params[3],
            completed: input.params[11],
            created_at: input.params[12],
            evidence_bundle_id: input.params[4],
            id: input.params[0],
            knowledge_space_id: input.params[2],
            mode: input.params[6],
            permission_snapshot_id: input.params[8],
            permission_snapshot_revision: input.params[9],
            query: input.params[5],
            subject_id: input.params[7],
            tenant_id: input.params[1],
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
    "persists and reloads capability-only %s query provenance and fences revoked publication",
    async (kind) => {
      const grantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca1";
      const trace = AnswerTraceSchema.parse({
        ...databaseTrace(),
        capabilityGrantId: grantId,
        tenantId: "tenant-1",
      });
      const calls: DatabaseExecuteInput[] = [];
      let grantActive = true;
      let rollbacks = 0;
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, params: [...input.params] });
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 1 };
        }
        if (input.tableName === "capability_grants") {
          return grantActive
            ? { rows: [{ grant_id: grantId, space_revoke_watermark: 0 }], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
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

      await expect(repository.create(trace)).resolves.toMatchObject({
        capabilityGrantId: grantId,
        tenantId: "tenant-1",
      });
      const insert = calls.find(
        (call) => call.tableName === "answer_traces" && call.operation === "insert",
      );
      expect(insert?.params).toContain("tenant-1");
      expect(insert?.params).toContain(grantId);
      expect(insert?.params).not.toContain(expect.stringContaining("snapshot"));
      expect(calls.some((call) => call.tableName === "capability_grants")).toBe(true);

      grantActive = false;
      await expect(
        repository.create({
          ...trace,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a09",
        }),
      ).rejects.toThrow("Capability publication is fenced");
      expect(rollbacks).toBe(1);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "allows %s trace persistence during child-resource deletion and rejects whole-space deletion",
    async (kind) => {
      const createRepository = (activeTargetType: "knowledge_space" | "source") => {
        const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          if (input.tableName === "knowledge_spaces") {
            return {
              rows: [{ id: input.params[0], tenant_id: "tenant-1" }],
              rowsAffected: 1,
            };
          }
          if (input.tableName === "answer_traces" && input.operation === "select") {
            return { rows: [], rowsAffected: 0 };
          }
          if (input.tableName === "answer_traces" && input.operation === "insert") {
            const wholeSpaceFence = hasWholeSpaceDeletionFence(input.sql, kind, {
              idColumn: "id",
              ownerAlias: "writable_space",
            });
            return {
              rows: [],
              rowsAffected: activeTargetType === "knowledge_space" || !wholeSpaceFence ? 0 : 1,
            };
          }
          if (input.tableName === "answer_trace_steps") {
            return { rows: [], rowsAffected: 1 };
          }
          throw new Error(`Unexpected answer-trace query: ${input.tableName}`);
        };
        const database = createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => callback({ execute: executor }),
        });
        return createDatabaseAnswerTraceRepository({ database });
      };

      await expect(createRepository("source").create(databaseTrace())).resolves.toEqual(
        databaseTrace(),
      );
      await expect(createRepository("knowledge_space").create(databaseTrace())).rejects.toThrow(
        "Answer trace creation rejected by durable deletion",
      );
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
          return {
            rows: [{ deletion_job_id: null, id: documentAssetId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
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
        ["select", "evidence_bundles"],
        ["select", "document_assets"],
        ["insert", "evidence_bundles"],
        ["select", "answer_traces"],
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
      if (kind === "postgres") {
        expect(traceInsert.sql).toContain("$5::uuid IS NULL");
        expect(traceInsert.sql).toContain('scoped_bundle."id" = $5::uuid');
      }
      assertSqlArity(bundleInsert, kind);
      assertSqlArity(traceInsert, kind);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "stores a deleting-document embedded bundle only as a content-free tombstone in %s",
    async (kind) => {
      const deletingDocumentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7e11";
      const evidenceBundle = EvidenceBundleSchema.parse({
        createdAt: "2026-05-11T13:40:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e12",
        items: [
          {
            citations: [
              {
                documentAssetId: deletingDocumentAssetId,
                documentVersion: 1,
                sectionPath: ["Sensitive section"],
              },
            ],
            conflicts: [],
            freshness: { status: "fresh" },
            metadata: { secret: "must-not-persist" },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e13",
            score: 0.9,
            scores: { final: 0.9, retrieval: 0.8 },
            text: "sensitive deleting evidence",
          },
        ],
        missingEvidence: [],
        query: "deleting evidence",
        state: "answerable",
      });
      const calls: DatabaseExecuteInput[] = [];
      let documentAssetExists = true;
      let storedBundleRow: DatabaseRow | undefined;
      let storedTraceRow: DatabaseRow | undefined;
      let storedStepRows: DatabaseRow[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, params: [...input.params] });
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 1 };
        }
        if (input.tableName === "document_assets") {
          if (!documentAssetExists) return { rows: [], rowsAffected: 0 };
          return {
            rows: [
              {
                deletion_job_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e14",
                id: deletingDocumentAssetId,
                lifecycle_state: "deleting",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "select") {
          return {
            rows: storedBundleRow ? [storedBundleRow] : [],
            rowsAffected: storedBundleRow ? 1 : 0,
          };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "insert") {
          storedBundleRow = {
            created_at: input.params[8],
            id: input.params[0],
            items: JSON.parse(String(input.params[6])) as unknown[],
            knowledge_space_id: input.params[2],
            missing_evidence: JSON.parse(String(input.params[7])) as unknown[],
            query: input.params[4],
            state: input.params[5],
            tenant_id: input.params[1],
            trace_id: input.params[3],
          };
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "answer_traces" && input.operation === "select") {
          return {
            rows: storedTraceRow ? [storedTraceRow] : [],
            rowsAffected: storedTraceRow ? 1 : 0,
          };
        }
        if (input.tableName === "answer_traces" && input.operation === "insert") {
          storedTraceRow = {
            access_channel: input.params[10],
            capability_grant_id: input.params[3],
            completed: input.params[11],
            created_at: input.params[12],
            evidence_bundle_id: input.params[4],
            id: input.params[0],
            knowledge_space_id: input.params[2],
            mode: input.params[6],
            permission_snapshot_id: input.params[8],
            permission_snapshot_revision: input.params[9],
            query: input.params[5],
            subject_id: input.params[7],
            tenant_id: input.params[1],
          };
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "answer_trace_steps" && input.operation === "select") {
          return { rows: storedStepRows, rowsAffected: storedStepRows.length };
        }
        if (input.tableName === "answer_trace_steps" && input.operation === "insert") {
          storedStepRows = Array.from({ length: input.params.length / 7 }, (_value, index) => {
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
          return { rows: [], rowsAffected: storedStepRows.length };
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

      const created = await repository.create(trace);
      const returnedBundle = EvidenceBundleSchema.parse(created.steps[0]?.metadata.evidenceBundle);
      const storedBundle = EvidenceBundleSchema.parse(
        storedStepRows[0]?.metadata &&
          (storedStepRows[0].metadata as Record<string, unknown>).evidenceBundle,
      );

      documentAssetExists = false;
      const replayed = await repository.create(trace);
      const replayedBundle = EvidenceBundleSchema.parse(replayed.steps[0]?.metadata.evidenceBundle);

      for (const persisted of [returnedBundle, storedBundle, replayedBundle]) {
        expect(persisted.items[0]).toMatchObject({
          citations: [{ documentAssetId: deletingDocumentAssetId, sectionPath: [] }],
          metadata: {
            traceEvidenceAvailability: {
              reason: "document-deleted-or-unavailable",
              status: "unavailable",
            },
          },
          text: "Evidence deleted or unavailable",
        });
        expect(JSON.stringify(persisted)).not.toContain("sensitive deleting evidence");
        expect(JSON.stringify(persisted)).not.toContain("must-not-persist");
      }
      expect(calls.filter((call) => call.operation === "insert")).toHaveLength(3);
      for (const insert of calls.filter((call) => call.operation === "insert")) {
        expect(JSON.stringify(insert.params)).not.toContain("sensitive deleting evidence");
        expect(JSON.stringify(insert.params)).not.toContain("must-not-persist");
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "replays an active-document trace as a tombstone after physical deletion in %s",
    async (kind) => {
      const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7e21";
      const evidenceBundle = EvidenceBundleSchema.parse({
        createdAt: "2026-05-11T13:40:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e22",
        items: [
          {
            citations: [{ documentAssetId, documentVersion: 1, sectionPath: ["Original section"] }],
            conflicts: [],
            freshness: { status: "fresh" },
            metadata: {},
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e23",
            score: 0.9,
            scores: { final: 0.9, retrieval: 0.8 },
            text: "original evidence before deletion",
          },
        ],
        missingEvidence: [],
        query: "deleted after trace persistence",
        state: "answerable",
      });
      let documentAssetExists = true;
      let storedBundleRow: DatabaseRow | undefined;
      let storedTraceRow: DatabaseRow | undefined;
      let storedStepRows: DatabaseRow[] = [];
      let insertCount = 0;
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: input.params[0], tenant_id: "tenant-1" }], rowsAffected: 1 };
        }
        if (input.tableName === "document_assets") {
          return documentAssetExists
            ? {
                rows: [{ deletion_job_id: null, id: documentAssetId, lifecycle_state: "active" }],
                rowsAffected: 1,
              }
            : { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "select") {
          return {
            rows: storedBundleRow ? [storedBundleRow] : [],
            rowsAffected: storedBundleRow ? 1 : 0,
          };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "insert") {
          insertCount += 1;
          storedBundleRow = {
            created_at: input.params[8],
            id: input.params[0],
            items: JSON.parse(String(input.params[6])) as unknown[],
            knowledge_space_id: input.params[2],
            missing_evidence: JSON.parse(String(input.params[7])) as unknown[],
            query: input.params[4],
            state: input.params[5],
            tenant_id: input.params[1],
            trace_id: input.params[3],
          };
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "answer_traces" && input.operation === "select") {
          return {
            rows: storedTraceRow ? [storedTraceRow] : [],
            rowsAffected: storedTraceRow ? 1 : 0,
          };
        }
        if (input.tableName === "answer_traces" && input.operation === "insert") {
          insertCount += 1;
          storedTraceRow = {
            access_channel: input.params[10],
            capability_grant_id: input.params[3],
            completed: input.params[11],
            created_at: input.params[12],
            evidence_bundle_id: input.params[4],
            id: input.params[0],
            knowledge_space_id: input.params[2],
            mode: input.params[6],
            permission_snapshot_id: input.params[8],
            permission_snapshot_revision: input.params[9],
            query: input.params[5],
            subject_id: input.params[7],
            tenant_id: input.params[1],
          };
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "answer_trace_steps" && input.operation === "select") {
          return { rows: storedStepRows, rowsAffected: storedStepRows.length };
        }
        if (input.tableName === "answer_trace_steps" && input.operation === "insert") {
          insertCount += 1;
          storedStepRows = [
            {
              ended_at: input.params[6],
              id: input.params[0],
              metadata: JSON.parse(String(input.params[4])) as Record<string, unknown>,
              name: input.params[2],
              started_at: input.params[5],
              status: input.params[3],
              trace_id: input.params[1],
            },
          ];
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected answer trace query: ${input.tableName}`);
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
        steps: [{ metadata: { evidenceBundle } }],
      });
      documentAssetExists = false;
      const replayed = await repository.create(trace);

      expect(insertCount).toBe(3);
      expect(replayed.steps[0]?.metadata.evidenceBundle).toMatchObject({
        items: [
          {
            citations: [{ documentAssetId, sectionPath: [] }],
            metadata: {
              traceEvidenceAvailability: {
                reason: "document-deleted-or-unavailable",
                status: "unavailable",
              },
            },
            text: "Evidence deleted or unavailable",
          },
        ],
      });
      expect(JSON.stringify(replayed)).not.toContain("original evidence before deletion");
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

function hasWholeSpaceDeletionFence(
  sql: string,
  dialect: "postgres" | "tidb",
  input: { readonly idColumn: string; readonly ownerAlias: string },
): boolean {
  const quoted = (identifier: string) =>
    dialect === "postgres" ? `"${identifier}"` : `\`${identifier}\``;
  return (
    sql.includes(`active_deletion.${quoted("target_type")} = 'knowledge_space'`) &&
    sql.includes(
      `active_deletion.${quoted("target_id")} = ${input.ownerAlias}.${quoted(input.idColumn)}`,
    )
  );
}
