import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseAdapter, DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { FrozenQualityRuntimeSnapshot, QualityPermissionBinding } from "./quality-control";
import {
  QualityControlIdempotencyConflictError,
  QualityControlRevisionConflictError,
  createDatabaseQualityControlRepository,
} from "./quality-control-database-repository";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const RUN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const OUTBOX_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const PERMISSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const CAPABILITY_GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4a";
const NOW = "2026-07-14T15:00:00.000Z";

function fixedQualityId(seed: number): () => string {
  let next = seed;
  return () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`;
}

describe("database quality-control repository", () => {
  it.each(["postgres", "tidb"] as const)(
    "applies exact subject and candidate ACL before trace LIMIT on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "answer_traces") {
          return {
            rows: [
              {
                completed: dialect === "tidb" ? "0" : false,
                created_at: NOW,
                evidence_bundle_id: null,
                evidence_items: [],
                evidence_state: null,
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
                mode: "fast",
                query: "camera evidence",
              },
            ],
            rowsAffected: 1,
          };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        maxListLimit: 100,
      });

      const page = await repository.listTraces({
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      });

      expect(page.items[0]?.completed).toBe(false);
      const call = calls.find((candidate) => candidate.tableName === "answer_traces");
      expect(call?.params.slice(0, 4)).toEqual([
        "tenant-1",
        SPACE_ID,
        "editor-1",
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
      ]);
      expect(call?.sql).toContain("subject_id");
      expect(call?.sql).not.toContain(
        `trace.${dialect === "postgres" ? '"tenant_id"' : "`tenant_id`"}`,
      );
      expect(call?.sql).toMatch(/permission\.(?:"tenant_id"|`tenant_id`)\s*=\s*(?:\$1|\?)/u);
      expect(call?.sql).toContain(dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS");
      expect(
        call?.sql.indexOf(dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS"),
      ).toBeLessThan(call?.sql.indexOf("LIMIT") ?? 0);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "lists capability traces through their original grant principal before LIMIT on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName !== "answer_traces") {
          return { rows: [], rowsAffected: 0 };
        }
        const isAuthorizedPrincipal =
          input.sql.includes("capability_grants") &&
          input.params[0] === "tenant-1" &&
          input.params[1] === SPACE_ID &&
          input.params[2] === "editor-1" &&
          input.params[3] === "workflow";
        return isAuthorizedPrincipal
          ? {
              rows: [
                {
                  capability_grant_id: CAPABILITY_GRANT_ID,
                  completed: dialect === "tidb" ? "1" : true,
                  created_at: NOW,
                  evidence_bundle_id: null,
                  evidence_items: [],
                  evidence_state: null,
                  id: TRACE_ID,
                  mode: "fast",
                  query: "camera evidence",
                },
              ],
              rowsAffected: 1,
            }
          : { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        maxListLimit: 100,
      });
      const candidateGrants = ["tenant:tenant-1", "source:camera"];

      const visible = await repository.listTraces({
        candidateGrants,
        capabilityRequester: { callerKind: "workflow", subjectId: "editor-1" },
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      });

      expect(visible.items).toHaveLength(1);
      const visibleCall = calls.find((candidate) => candidate.tableName === "answer_traces");
      expect(visibleCall?.params.slice(0, 5)).toEqual([
        "tenant-1",
        SPACE_ID,
        "editor-1",
        "workflow",
        JSON.stringify(candidateGrants),
      ]);
      expect(visibleCall?.params).not.toContain("current-list-grant-id");
      expect(visibleCall?.sql).toContain("capability_grants");
      expect(visibleCall?.sql).toContain("capability_grant_id");
      expect(visibleCall?.sql).toContain("grant_id");
      expect(visibleCall?.sql).toContain("caller_kind");
      expect(visibleCall?.sql).toContain(
        `trace.${dialect === "postgres" ? '"tenant_id"' : "`tenant_id`"}`,
      );
      expect(visibleCall?.sql).not.toContain("knowledge_space_permission_snapshots");
      expect(visibleCall?.sql.indexOf("capability_grants")).toBeLessThan(
        visibleCall?.sql.indexOf("LIMIT") ?? 0,
      );
      const scopeOperator = dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      expect(visibleCall?.sql).toContain(scopeOperator);
      expect(visibleCall?.sql.indexOf(scopeOperator)).toBeLessThan(
        visibleCall?.sql.indexOf("LIMIT") ?? 0,
      );

      for (const authorization of [
        {
          capabilityRequester: { callerKind: "workflow" as const, subjectId: "intruder-1" },
          knowledgeSpaceId: SPACE_ID,
          subjectId: "intruder-1",
          tenantId: "tenant-1",
        },
        {
          capabilityRequester: { callerKind: "workflow" as const, subjectId: "editor-1" },
          knowledgeSpaceId: SPACE_ID,
          subjectId: "editor-1",
          tenantId: "tenant-2",
        },
        {
          capabilityRequester: { callerKind: "workflow" as const, subjectId: "editor-1" },
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          subjectId: "editor-1",
          tenantId: "tenant-1",
        },
        {
          capabilityRequester: { callerKind: "agent" as const, subjectId: "editor-1" },
          knowledgeSpaceId: SPACE_ID,
          subjectId: "editor-1",
          tenantId: "tenant-1",
        },
      ]) {
        await expect(
          repository.listTraces({
            candidateGrants,
            ...authorization,
            limit: 10,
          }),
        ).resolves.toEqual({ items: [] });
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "applies replay candidate ACL before LIMIT on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await repository.listReplays({
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      });

      const call = calls[0];
      const aclOperator = dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      expect(call?.sql).toContain(aclOperator);
      expect(call?.sql.indexOf(aclOperator)).toBeLessThan(call?.sql.indexOf("LIMIT") ?? 0);
      expect(call?.params.slice(0, 4)).toEqual([
        "tenant-1",
        SPACE_ID,
        "editor-1",
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
      ]);
      expect(call?.sql).toContain("requested_by_subject_id");
      expect(call?.sql.indexOf("requested_by_subject_id")).toBeLessThan(
        call?.sql.indexOf("LIMIT") ?? 0,
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "conceals every public quality resource by exact requester before LIMIT or history ordering on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });
      const scope = {
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        knowledgeSpaceId: SPACE_ID,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      } as const;

      await repository.getBadCase({ ...scope, id: "bad-case-1" });
      await repository.listBadCases({ ...scope, limit: 5 });
      await repository.getReplay({ ...scope, id: RUN_ID });
      await repository.listReplays({ ...scope, limit: 5 });
      await repository.getMissingReview({ ...scope, itemKey: "missing-1", traceId: "trace-1" });
      await repository.listHistory({
        ...scope,
        aggregateId: "bad-case-1",
        aggregateType: "bad-case",
        limit: 5,
      });

      const publicReads = calls.filter((call) =>
        [
          "quality_bad_cases",
          "quality_missing_evidence_reviews",
          "quality_replay_runs",
          "quality_resource_history",
        ].includes(call.tableName),
      );
      expect(publicReads).toHaveLength(6);
      for (const call of publicReads) {
        expect(call.params).toContain("editor-1");
        expect(call.sql).toMatch(/(?:actor_subject_id|requested_by_subject_id|subject_id)/u);
        const boundary = call.sql.includes("LIMIT")
          ? call.sql.indexOf("LIMIT")
          : call.sql.indexOf("ORDER BY");
        const subjectIndex = Math.max(
          call.sql.indexOf("actor_subject_id"),
          call.sql.indexOf("requested_by_subject_id"),
          call.sql.indexOf("subject_id"),
        );
        expect(subjectIndex).toBeGreaterThanOrEqual(0);
        expect(subjectIndex).toBeLessThan(boundary);
      }
      const missingReview = publicReads.find(
        (call) => call.tableName === "quality_missing_evidence_reviews",
      );
      const aclOperator = dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      expect(missingReview?.sql.match(new RegExp(aclOperator, "gu")) ?? []).toHaveLength(2);
      expect(missingReview?.sql).toMatch(
        /permission\.(?:"tenant_id"|`tenant_id`)\s*=\s*(?:\$1|\?)/u,
      );
    },
  );

  it("rejects idempotency-key reuse by a different subject before writing anything", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return { rows: [{ id: SPACE_ID }], rowsAffected: 1 };
      }
      if (input.tableName === "quality_replay_runs" && input.operation === "select") {
        return {
          rows: [
            {
              access_channel: "interactive",
              id: RUN_ID,
              request_fingerprint: `sha256:${"c".repeat(64)}`,
              requested_by_subject_id: "other-editor",
            },
          ],
          rowsAffected: 1,
        };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.createReplay({
        frozenSnapshot: frozenSnapshot(),
        idempotencyKey: "same-key",
        knowledgeSpaceId: SPACE_ID,
        mode: "deep",
        permission: {
          accessChannel: "interactive",
          candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
          permissionSnapshotId: PERMISSION_ID,
          permissionSnapshotRevision: 3,
          requestedBySubjectId: "editor-1",
        },
        questions: [],
        requestFingerprint: `sha256:${"c".repeat(64)}`,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(QualityControlIdempotencyConflictError);
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("rejects replay creation before idempotency lookup/inserts when fresh permission is revoked", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      { permissionFence: false },
    );
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.createReplay({
        frozenSnapshot: frozenSnapshot(),
        idempotencyKey: "revoked-create",
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permission: permissionBinding(),
        questions: [],
        requestFingerprint: `sha256:${"d".repeat(64)}`,
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
    expect(
      calls.some((call) => call.tableName === "quality_replay_runs" && call.operation === "select"),
    ).toBe(false);
  });

  it.each(["postgres", "tidb"] as const)(
    "creates the first replay delivery with revision one on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return input.sql.includes("idempotency_key")
            ? { rows: [], rowsAffected: 0 }
            : { rows: [replayRow({ state: "queued" })], rowsAffected: 1 };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        generateId: fixedQualityId(800),
        maxListLimit: 100,
        now: () => NOW,
      });

      await repository.createReplay({
        frozenSnapshot: frozenSnapshot(),
        idempotencyKey: "first-delivery",
        knowledgeSpaceId: SPACE_ID,
        mode: "deep",
        permission: permissionBinding(),
        questions: [],
        requestFingerprint: `sha256:${"a".repeat(64)}`,
        tenantId: "tenant-1",
      });

      const outbox = calls.find(
        (call) => call.tableName === "quality_replay_outbox" && call.operation === "insert",
      );
      expect(outbox?.sql).toContain("delivery_revision");
      expect(outbox?.params[2]).toBe(1);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "persists only a capability grant locator for new replay admissions on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "capability_grants") {
          return {
            rows: [
              {
                content_scope_ids: ["tenant:tenant-1", "source:camera"],
                subject_id: "editor-1",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return input.sql.includes("idempotency_key")
            ? { rows: [], rowsAffected: 0 }
            : {
                rows: [replayRow({ capabilityGrantId: CAPABILITY_GRANT_ID })],
                rowsAffected: 1,
              };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        generateId: fixedQualityId(900),
        maxListLimit: 100,
        now: () => NOW,
      });

      const run = await repository.createReplay({
        capabilityGrantId: CAPABILITY_GRANT_ID,
        frozenSnapshot: frozenSnapshot(),
        idempotencyKey: "capability-admission",
        knowledgeSpaceId: SPACE_ID,
        mode: "deep",
        questions: [],
        requestFingerprint: `sha256:${"e".repeat(64)}`,
        tenantId: "tenant-1",
      });

      expect(run).toMatchObject({ capabilityGrantId: CAPABILITY_GRANT_ID });
      expect(run.permission).toBeUndefined();
      const insert = calls.find(
        (call) => call.tableName === "quality_replay_runs" && call.operation === "insert",
      );
      expect(insert?.params.slice(7, 13)).toEqual([
        CAPABILITY_GRANT_ID,
        null,
        null,
        null,
        null,
        null,
      ]);
      expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
        false,
      );
      const capabilityFenceIndex = calls.findIndex(
        (call) => call.tableName === "capability_grants",
      );
      const insertIndex = calls.findIndex(
        (call) => call.tableName === "quality_replay_runs" && call.operation === "insert",
      );
      expect(capabilityFenceIndex).toBeGreaterThanOrEqual(0);
      expect(insertIndex).toBeGreaterThanOrEqual(0);
      expect(capabilityFenceIndex).toBeLessThan(insertIndex);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "reconstructs capability replay scope at claim and fails closed after revoke on %s",
    async (dialect) => {
      const makeRepository = (active: boolean) => {
        const calls: DatabaseExecuteInput[] = [];
        const database = testDatabase(dialect, async (input) => {
          calls.push(input);
          if (input.tableName === "quality_replay_outbox" && input.operation === "select") {
            return {
              rows: [
                {
                  ...replayRow({ capabilityGrantId: CAPABILITY_GRANT_ID }),
                  outbox_id: OUTBOX_ID,
                },
              ],
              rowsAffected: 1,
            };
          }
          if (input.tableName === "capability_grants") {
            return active
              ? {
                  rows: [
                    {
                      content_scope_ids: ["tenant:tenant-1", "source:camera"],
                      subject_id: "editor-1",
                    },
                  ],
                  rowsAffected: 1,
                }
              : { rows: [], rowsAffected: 0 };
          }
          if (input.tableName === "quality_replay_runs" && input.operation === "select") {
            return {
              rows: [replayRow({ capabilityGrantId: CAPABILITY_GRANT_ID })],
              rowsAffected: 1,
            };
          }
          return { rows: [], rowsAffected: input.operation === "update" ? 1 : 0 };
        });
        return {
          calls,
          repository: createDatabaseQualityControlRepository({
            database,
            generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
            maxListLimit: 100,
          }),
        };
      };

      const active = makeRepository(true);
      await expect(
        active.repository.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" }),
      ).resolves.toMatchObject({
        capabilityGrantId: CAPABILITY_GRANT_ID,
        executionCandidateGrants: ["tenant:tenant-1", "source:camera"],
        executionSubjectId: "editor-1",
      });
      expect(
        active.calls.some((call) => call.tableName === "knowledge_space_permission_snapshots"),
      ).toBe(false);

      const revoked = makeRepository(false);
      await expect(
        revoked.repository.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" }),
      ).rejects.toMatchObject({ name: "CapabilityPublicationFencedError" });
      expect(revoked.calls.some((call) => call.operation === "update")).toBe(false);
    },
  );

  it("rejects cancellation before replay selection when current permission scopes narrowed", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding({
          candidateGrants: ["tenant:tenant-1", "subject:editor-1", "team:camera"],
        }),
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    expect(
      calls.some((call) => call.tableName === "quality_replay_runs" && call.operation === "select"),
    ).toBe(false);
    expect(calls.some((call) => call.operation === "update")).toBe(false);
  });

  it("rejects retry before replay selection/outbox creation when fresh permission is revoked", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      { permissionFence: false },
    );
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.retryReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        frozenSnapshot: frozenSnapshot(),
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    expect(
      calls.some((call) => call.tableName === "quality_replay_runs" && call.operation === "select"),
    ).toBe(false);
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
    expect(calls.some((call) => call.operation === "update")).toBe(false);
  });

  it.each(["postgres", "tidb"] as const)(
    "rechecks exact active trace provenance inside the bad-case write transaction on %s",
    async (dialect) => {
      const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        maxListLimit: 100,
        now: () => NOW,
      });

      await expect(
        repository.createBadCase({
          actorSubjectId: "editor-1",
          candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
          knowledgeSpaceId: SPACE_ID,
          permission: permissionBinding(),
          reason: "bad evidence",
          tags: ["regression"],
          tenantId: "tenant-1",
          traceId,
        }),
      ).rejects.toThrow("Answer trace is not visible");
      expect(calls.some((call) => call.operation === "insert")).toBe(false);
      const traceFence = calls.find((call) => call.tableName === "answer_traces");
      expect(traceFence?.params).toEqual([
        "tenant-1",
        SPACE_ID,
        traceId,
        "editor-1",
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
        NOW,
      ]);
      expect(traceFence?.sql).toContain("access_channel");
      expect(traceFence?.sql).toContain("permission_snapshot_revision");
      expect(traceFence?.sql).toContain("status");
      expect(traceFence?.sql).toContain("revoked_at");
      expect(traceFence?.sql).toContain("expires_at");
      expect(traceFence?.sql).toContain("FOR UPDATE");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "creates a bad case only after the final trace provenance fence on %s",
    async (dialect) => {
      const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "answer_traces") {
          return { rows: [{ id: traceId }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        generateId: fixedQualityId(700),
        maxListLimit: 100,
        now: () => NOW,
      });

      await expect(
        repository.createBadCase({
          actorSubjectId: "editor-1",
          candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
          knowledgeSpaceId: SPACE_ID,
          permission: permissionBinding(),
          reason: "bad evidence",
          tags: ["regression"],
          tenantId: "tenant-1",
          traceId,
        }),
      ).resolves.toMatchObject({ status: "open", traceId });
      const traceFence = calls.find((call) => call.tableName === "answer_traces");
      const badCaseInsert = calls.find(
        (call) => call.tableName === "quality_bad_cases" && call.operation === "insert",
      );
      expect(calls.indexOf(traceFence as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(badCaseInsert as DatabaseExecuteInput),
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "creates and CAS-updates a missing-evidence review behind the final trace fence on %s",
    async (dialect) => {
      const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
      const itemKey = `sha256:${"c".repeat(64)}`;
      const createCalls: DatabaseExecuteInput[] = [];
      const createDatabase = testDatabase(dialect, async (input) => {
        createCalls.push(input);
        if (input.tableName === "answer_traces") {
          return { rows: [{ id: traceId }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const createRepository = createDatabaseQualityControlRepository({
        database: createDatabase,
        generateId: fixedQualityId(800),
        maxListLimit: 100,
        now: () => NOW,
      });

      const created = await createRepository.upsertMissingReview({
        actorSubjectId: "editor-1",
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        expectedRevision: 0,
        itemKey,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        reason: "Verified omission",
        status: "active",
        tenantId: "tenant-1",
        traceId,
      });

      expect(created).toMatchObject({
        actorSubjectId: "editor-1",
        itemKey,
        reason: "Verified omission",
        revision: 1,
        status: "active",
        traceId,
      });
      const traceFence = createCalls.find((call) => call.tableName === "answer_traces");
      const reviewInsert = createCalls.find(
        (call) =>
          call.tableName === "quality_missing_evidence_reviews" && call.operation === "insert",
      );
      const historyInsert = createCalls.find(
        (call) => call.tableName === "quality_resource_history" && call.operation === "insert",
      );
      expect(createCalls.indexOf(traceFence as DatabaseExecuteInput)).toBeLessThan(
        createCalls.indexOf(reviewInsert as DatabaseExecuteInput),
      );
      expect(reviewInsert?.params).toContain(JSON.stringify(permissionBinding().candidateGrants));
      expect(historyInsert?.params).toEqual(
        expect.arrayContaining(["missing-evidence", "restored", "active"]),
      );

      const updateCalls: DatabaseExecuteInput[] = [];
      const updateDatabase = testDatabase(dialect, async (input) => {
        updateCalls.push(input);
        if (input.tableName === "answer_traces") {
          return { rows: [{ id: traceId }], rowsAffected: 1 };
        }
        if (
          input.tableName === "quality_missing_evidence_reviews" &&
          input.operation === "select"
        ) {
          return {
            rows: [missingReviewRow({ item_key: itemKey, trace_id: traceId })],
            rowsAffected: 1,
          };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const updateRepository = createDatabaseQualityControlRepository({
        database: updateDatabase,
        generateId: fixedQualityId(900),
        maxListLimit: 100,
        now: () => NOW,
      });

      await expect(
        updateRepository.upsertMissingReview({
          actorSubjectId: "editor-1",
          candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
          expectedRevision: 1,
          itemKey,
          knowledgeSpaceId: SPACE_ID,
          permission: permissionBinding(),
          status: "dismissed",
          tenantId: "tenant-1",
          traceId,
        }),
      ).resolves.toMatchObject({ reason: undefined, revision: 2, status: "dismissed" });
      const update = updateCalls.find(
        (call) =>
          call.tableName === "quality_missing_evidence_reviews" && call.operation === "update",
      );
      expect(update?.params).toEqual([
        "dismissed",
        null,
        "editor-1",
        2,
        NOW,
        missingReviewRow().id,
        1,
      ]);
      const updateHistory = updateCalls.find(
        (call) => call.tableName === "quality_resource_history" && call.operation === "insert",
      );
      expect(updateHistory?.params).toEqual(
        expect.arrayContaining(["missing-evidence", "dismissed", "active", "dismissed"]),
      );
    },
  );

  it("binds a replaying bad case only to a visible run in the exact tenant-space", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return { rows: [{ id: SPACE_ID }], rowsAffected: 1 };
      }
      if (input.tableName === "quality_bad_cases" && input.operation === "select") {
        return { rows: [badCaseRow()], rowsAffected: 1 };
      }
      if (input.tableName === "quality_replay_runs") {
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await expect(
      repository.updateBadCase({
        actorSubjectId: "editor-1",
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        expectedRevision: 1,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        replayRunId: RUN_ID,
        status: "replaying",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Linked replay run is not visible");
    const replayFence = calls.find((call) => call.tableName === "quality_replay_runs");
    expect(replayFence?.params).toEqual([
      "tenant-1",
      SPACE_ID,
      RUN_ID,
      "editor-1",
      JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
    ]);
    expect(replayFence?.sql).toContain("required_permission_scope");
    expect(replayFence?.sql).toContain("FOR UPDATE");
  });

  it("retries with a fresh permission and frozen publication snapshot", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return {
            rows: [replayRow({ completedAt: NOW, state: "failed" })],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      },
      {
        permission: {
          accessChannel: "service_api",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
          revision: 8,
          subjectId: "new-editor",
        },
      },
    );
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });
    const fresh = {
      ...frozenSnapshot(),
      projectionSnapshot: { ...frozenSnapshot().projectionSnapshot, projectionVersion: 99 },
    };

    await repository.retryReplay({
      actorSubjectId: "new-editor",
      expectedRevision: 1,
      frozenSnapshot: fresh,
      id: RUN_ID,
      knowledgeSpaceId: SPACE_ID,
      permission: {
        accessChannel: "service_api",
        candidateGrants: ["tenant:tenant-1", "subject:new-editor"],
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        permissionSnapshotRevision: 8,
        requestedBySubjectId: "new-editor",
      },
      tenantId: "tenant-1",
    });

    const update = calls.find(
      (call) => call.tableName === "quality_replay_runs" && call.operation === "update",
    );
    expect(update?.params.slice(0, 9)).toEqual([
      null,
      "new-editor",
      "service_api",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      8,
      JSON.stringify(["tenant:tenant-1", "subject:new-editor"]),
      JSON.stringify(fresh),
      2,
      NOW,
    ]);
    const outbox = calls.find(
      (call) => call.tableName === "quality_replay_outbox" && call.operation === "insert",
    );
    expect(outbox?.sql).toContain("delivery_revision");
    expect(outbox?.params[2]).toBe(2);
  });

  it("fails cancellation closed when the active-space deletion fence disappears", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      { activeSpace: false },
    );
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await expect(
      repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Quality write rejected by durable deletion");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("lifecycle_state");
    expect(calls[0]?.sql).toContain("deletion_job_id");
    expect(calls[0]?.sql).toContain("FOR UPDATE");
  });

  it("fails cancellation closed when an active deletion job owns the space", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      return input.tableName === "deletion_jobs"
        ? { rows: [{ id: "active-delete" }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await expect(
      repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Quality write rejected by durable deletion");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ operation: "select", tableName: "deletion_jobs" });
    expect(calls[1]?.sql).toContain("active_slot");
    expect(calls[1]?.sql).toContain("FOR UPDATE");
    expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
      false,
    );
  });

  it("never marks a run passed while any persisted item is non-passed", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return { rows: [{ id: SPACE_ID }], rowsAffected: 1 };
      }
      if (input.tableName === "quality_replay_runs" && input.operation === "select") {
        return {
          rows: [
            replayRow({
              leaseExpiresAt: "2026-07-14T16:00:00.000Z",
              leaseOwner: "worker-1",
              leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
              state: "running",
            }),
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "quality_replay_items" && input.operation === "select") {
        if (input.sql.includes("not_passed_count")) {
          return { rows: [{ not_passed_count: 1 }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await repository.completeReplay({
      expectedLeaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      id: RUN_ID,
      now: NOW,
      permissionRevoked: true,
      state: "passed",
    });

    const completion = calls.find(
      (call) => call.tableName === "quality_replay_runs" && call.operation === "update",
    );
    expect(completion?.params[0]).toBe("failed");
    expect(
      calls.find(
        (call) =>
          call.tableName === "quality_replay_items" && call.sql.includes("not_passed_count"),
      )?.sql,
    ).toContain("<> 'passed'");
  });

  it.each(["postgres", "tidb"] as const)(
    "claims a replay/outbox lease transactionally and reconstructs the frozen run on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_outbox" && input.operation === "select") {
          return {
            rows: [{ ...replayRow(), outbox_id: OUTBOX_ID }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return { rows: [replayRow()], rowsAffected: 1 };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
        maxListLimit: 100,
      });

      const run = await repository.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" });

      expect(run).toMatchObject({ id: RUN_ID, mode: "deep", tenantId: "tenant-1" });
      expect((run as unknown as { leaseToken: string }).leaseToken).toBe(
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
      );
      const claim = calls.find(
        (call) =>
          call.tableName === "quality_replay_outbox" &&
          call.operation === "select" &&
          call.sql.includes("FOR UPDATE"),
      );
      expect(claim?.sql).toContain("FOR UPDATE");
      expect(claim?.sql).toContain("lease_expires_at");
      const locate = calls.find(
        (call) =>
          call.tableName === "quality_replay_outbox" &&
          call.operation === "select" &&
          !call.sql.includes("FOR UPDATE"),
      );
      expect(locate?.sql).toContain("deletion_job_id");
      expect(locate?.sql).toContain("deletion_jobs");
      const spaceLock = calls.find((call) => call.tableName === "knowledge_spaces");
      const permissionLock = calls.find(
        (call) => call.tableName === "knowledge_space_permission_snapshots",
      );
      expect(calls.indexOf(spaceLock as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(permissionLock as DatabaseExecuteInput),
      );
      expect(calls.indexOf(permissionLock as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(claim as DatabaseExecuteInput),
      );
      const runUpdate = calls.find(
        (call) => call.tableName === "quality_replay_runs" && call.operation === "update",
      );
      expect(runUpdate?.sql).toContain("lease_token");
      expect(runUpdate?.sql).toContain("attempt");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects replay claim before lease mutation when the stored durable permission is revoked on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(
        dialect,
        async (input) => {
          calls.push(input);
          if (input.tableName === "quality_replay_outbox" && input.operation === "select") {
            return { rows: [{ ...replayRow(), outbox_id: OUTBOX_ID }], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        },
        { permissionFence: false },
      );
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" }),
      ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
      expect(calls.some((call) => call.operation === "update")).toBe(false);
      expect(calls.find((call) => call.tableName === "knowledge_spaces")?.sql).toContain(
        "FOR UPDATE",
      );
      expect(calls.find((call) => call.tableName === "deletion_jobs")?.sql).toContain(
        "active_slot",
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects replay item checkpoint when deletion wins before the child mutation on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(
        dialect,
        async (input) => {
          calls.push(input);
          if (input.tableName === "quality_replay_runs" && input.operation === "select") {
            return {
              rows: [
                replayRow({
                  leaseExpiresAt: "2026-07-14T16:00:00.000Z",
                  leaseOwner: "worker-1",
                  leaseToken: "lease-1",
                  state: "running",
                }),
              ],
              rowsAffected: 1,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        { activeSpace: false },
      );
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.recordReplayItem({
          expectedLeaseToken: "lease-1",
          itemId: "item-1",
          now: NOW,
          result: {},
          runId: RUN_ID,
          state: "passed",
          traceId: "trace-1",
        }),
      ).rejects.toThrow("Quality write rejected by durable deletion");
      expect(calls.some((call) => call.operation === "update")).toBe(false);
      expect(calls.find((call) => call.tableName === "knowledge_spaces")?.sql).toContain(
        "FOR UPDATE",
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "binds a replay checkpoint to the exact subject, snapshot, trace and candidate grants on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return {
            rows: [
              replayRow({
                leaseExpiresAt: "2026-07-14T16:00:00.000Z",
                leaseOwner: "worker-1",
                leaseToken: "lease-1",
                state: "running",
              }),
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "answer_traces") {
          return { rows: [{ id: "trace-1" }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: input.operation === "update" ? 1 : 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.recordReplayItem({
          expectedLeaseToken: "lease-1",
          itemId: "item-1",
          now: NOW,
          result: {},
          runId: RUN_ID,
          state: "passed",
          traceId: "trace-1",
        }),
      ).resolves.toBe(true);
      const traceFence = calls.find((call) => call.tableName === "answer_traces");
      expect(traceFence?.params).toEqual([
        "tenant-1",
        SPACE_ID,
        "trace-1",
        "editor-1",
        "interactive",
        PERMISSION_ID,
        3,
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
      ]);
      expect(traceFence?.sql).toContain("permission_snapshot_revision");
      expect(traceFence?.sql).toContain("FOR UPDATE");
      const itemUpdate = calls.find(
        (call) => call.tableName === "quality_replay_items" && call.operation === "update",
      );
      expect(calls.indexOf(traceFence as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(itemUpdate as DatabaseExecuteInput),
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "does not let permissionRevoked bypass the terminal replay permission fence on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(
        dialect,
        async (input) => {
          calls.push(input);
          if (input.tableName === "quality_replay_runs" && input.operation === "select") {
            return {
              rows: [
                replayRow({
                  leaseExpiresAt: "2026-07-14T16:00:00.000Z",
                  leaseOwner: "worker-1",
                  leaseToken: "lease-1",
                  state: "running",
                }),
              ],
              rowsAffected: 1,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        { permissionFence: false },
      );
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.completeReplay({
          expectedLeaseToken: "lease-1",
          id: RUN_ID,
          now: NOW,
          permissionRevoked: true,
          state: "failed",
        }),
      ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
      expect(calls.some((call) => call.operation === "update")).toBe(false);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rechecks the capability grant before the terminal replay mutation on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const running = replayRow({
        capabilityGrantId: CAPABILITY_GRANT_ID,
        leaseExpiresAt: "2026-07-14T16:00:00.000Z",
        leaseOwner: "worker-1",
        leaseToken: "lease-1",
        state: "running",
      });
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "capability_grants") {
          return {
            rows: [
              {
                content_scope_ids: ["tenant:tenant-1", "source:camera"],
                subject_id: "editor-1",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return { rows: [running], rowsAffected: 1 };
        }
        if (
          input.tableName === "quality_replay_items" &&
          input.operation === "select" &&
          input.sql.includes("not_passed_count")
        ) {
          return { rows: [{ not_passed_count: 0 }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: input.operation === "update" ? 1 : 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.completeReplay({
          expectedLeaseToken: "lease-1",
          id: RUN_ID,
          now: NOW,
          state: "passed",
        }),
      ).resolves.toMatchObject({ capabilityGrantId: CAPABILITY_GRANT_ID });

      const grantFence = calls.find((call) => call.tableName === "capability_grants");
      const terminalMutation = calls.find(
        (call) =>
          call.tableName === "quality_replay_runs" &&
          call.operation === "update" &&
          call.sql.includes("completed_at"),
      );
      expect(grantFence?.sql).toContain("FOR UPDATE");
      const grantFenceIndex = calls.findIndex((call) => call === grantFence);
      const terminalMutationIndex = calls.findIndex((call) => call === terminalMutation);
      expect(grantFenceIndex).toBeGreaterThanOrEqual(0);
      expect(terminalMutationIndex).toBeGreaterThanOrEqual(0);
      expect(grantFenceIndex).toBeLessThan(terminalMutationIndex);
      expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
        false,
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "clears outbox lease fields when cancellation makes the event terminal on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return { rows: [replayRow()], rowsAffected: 1 };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        maxListLimit: 100,
        now: () => NOW,
      });

      await repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      });

      const terminalOutbox = calls.find(
        (call) => call.tableName === "quality_replay_outbox" && call.operation === "update",
      );
      expect(terminalOutbox?.sql).toMatch(/lease_owner[`"]?\s*=\s*NULL/u);
      expect(terminalOutbox?.sql).toMatch(/lease_token[`"]?\s*=\s*NULL/u);
      expect(terminalOutbox?.sql).toMatch(/lease_expires_at[`"]?\s*=\s*NULL/u);
    },
  );

  it("bounds trend slices by tenant, subject, candidate grants, and the requested window", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await repository.trends({
      candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
      from: "2026-07-07T00:00:00.000Z",
      knowledgeSpaceId: SPACE_ID,
      subjectId: "editor-1",
      tenantId: "tenant-1",
      to: "2026-07-14T00:00:00.000Z",
      topLimit: 20,
    });

    const failedCalls = calls.filter((call) => call.tableName === "failed_queries");
    expect(failedCalls).toHaveLength(3);
    for (const call of failedCalls) {
      expect(call.sql).toContain("answer_traces");
      expect(call.sql).toContain("subject_id");
      expect(call.sql).toContain("permission_scopes");
      expect(call.sql).toContain("requested_by_subject_id");
      expect(call.sql).toContain("required_permission_scope");
      expect(call.sql).toContain("permission_snapshot_revision");
      expect(call.params).toContain("tenant-1");
      expect(call.params).toContain(SPACE_ID);
      expect(call.params).toContain("editor-1");
      const boundary = call.sql.includes("GROUP BY")
        ? call.sql.indexOf("GROUP BY")
        : call.sql.indexOf(";");
      expect(call.sql.indexOf("requested_by_subject_id")).toBeLessThan(boundary);
      expect(call.sql.indexOf("required_permission_scope")).toBeLessThan(boundary);
    }
  });

  it.each(["postgres", "tidb"] as const)(
    "maps scored trace provenance and paginates only after ACL filtering on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "answer_traces") {
          return {
            rows: [
              {
                completed: dialect === "postgres" ? true : "1",
                created_at: NOW,
                evidence_bundle_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
                evidence_items: [
                  null,
                  { scores: null },
                  { scores: { final: 0.9, rerank: 0.8, retrieval: 0.7 } },
                ],
                evidence_state: "complete",
                id: TRACE_ID,
                mode: "deep",
                query: "Camera_100%\\ evidence",
              },
              {
                completed: dialect === "postgres" ? false : "0",
                created_at: "2026-07-14T14:00:00.000Z",
                evidence_bundle_id: null,
                evidence_items: [],
                evidence_state: null,
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
                mode: "fast",
                query: "next page",
              },
            ],
            rowsAffected: 2,
          };
        }
        if (input.tableName === "answer_trace_steps") {
          return {
            rows: [
              {
                id: "step-1",
                metadata: {
                  candidateCount: 12,
                  projectionSnapshot: {
                    projectionVersion: 4,
                    publicationId: "publication-4",
                  },
                  retrievalProfile: {
                    reasoningModel: { model: "reasoning-4" },
                    rerank: { model: { model: "rerank-4" } },
                    revision: 4,
                  },
                },
                name: "retrieval",
                started_at: NOW,
                status: "ok",
                trace_id: TRACE_ID,
              },
              {
                id: "step-2",
                metadata: {
                  dimension: 1536,
                  model: "embedding-4",
                  vectorSpaceId: "embedding-space-4",
                },
                name: "embedding",
                started_at: NOW,
                status: "ok",
                trace_id: TRACE_ID,
              },
            ],
            rowsAffected: 2,
          };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 10 });

      const page = await repository.listTraces({
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        cursor: { createdAt: "2026-07-15T00:00:00.000Z", id: RUN_ID },
        from: "2026-07-01T00:00:00.000Z",
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        mode: "deep",
        query: "Camera_100%\\",
        status: "completed",
        subjectId: "editor-1",
        tenantId: "tenant-1",
        to: "2026-08-01T00:00:00.000Z",
      });

      expect(page).toMatchObject({
        items: [
          {
            completed: true,
            evidenceState: "complete",
            finalScore: 0.9,
            id: TRACE_ID,
            profile: {
              embeddingModel: "embedding-4",
              embeddingVectorSpaceId: "embedding-space-4",
              projectionPublicationId: "publication-4",
              projectionVersion: 4,
              reasoningModel: "reasoning-4",
              rerankModel: "rerank-4",
              retrievalProfileRevision: 4,
            },
            scores: { final: 0.9, rerank: 0.8, retrieval: 0.7 },
            stages: [
              { candidateCount: 12, name: "retrieval", status: "ok" },
              { name: "embedding", status: "ok" },
            ],
          },
        ],
        nextCursor: { createdAt: NOW, id: TRACE_ID },
      });
      const traceCall = calls.find((call) => call.tableName === "answer_traces");
      expect(traceCall?.params).toContain("%camera\\_100\\%\\\\%");
      expect(traceCall?.sql).toContain(dialect === "postgres" ? "TRUE" : "1");

      await repository.listTraces({
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        status: "failed",
        subjectId: "editor-1",
        tenantId: "tenant-1",
      });
      expect(calls.filter((call) => call.tableName === "answer_traces").at(-1)?.sql).toContain(
        "terminal_step",
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "maps populated trend aggregates and merges replay/failed slices on %s",
    async (dialect) => {
      const database = testDatabase(dialect, async (input) => {
        if (input.tableName === "quality_replay_runs") {
          if (input.sql.includes("GROUP BY")) {
            return {
              rows: [
                {
                  mode: "deep",
                  model: "reasoning-4",
                  passed_runs: 3,
                  profile_revision: "4",
                  replay_runs: 4,
                },
                {
                  mode: "fast",
                  model: null,
                  passed_runs: 0,
                  profile_revision: 0,
                  replay_runs: 0,
                },
              ],
              rowsAffected: 2,
            };
          }
          return {
            rows: [
              {
                baseline_passed: 0,
                baseline_total: 0,
                current_passed: "3",
                current_total: 4,
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "quality_bad_cases") {
          return {
            rows: [
              { count: "2", status: "open" },
              { count: 99, status: "unknown" },
            ],
            rowsAffected: 2,
          };
        }
        if (input.tableName === "failed_queries") {
          if (input.sql.includes("current_failed")) {
            return {
              rows: [{ baseline_failed: 1, current_failed: "2" }],
              rowsAffected: 1,
            };
          }
          if (
            input.sql.includes('AS "failed_queries"') ||
            input.sql.includes("AS `failed_queries`")
          ) {
            return {
              rows: [
                {
                  failed_queries: 2,
                  mode: "deep",
                  model: "reasoning-4",
                  profile_revision: 4,
                },
                {
                  failed_queries: "1",
                  mode: "balanced",
                  model: null,
                  profile_revision: "2",
                },
              ],
              rowsAffected: 2,
            };
          }
          return {
            rows: [
              { count: "2", query: "camera evidence" },
              { count: 1, query: "missing policy" },
            ],
            rowsAffected: 2,
          };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      const report = await repository.trends({
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        from: "2026-07-07T00:00:00.000Z",
        knowledgeSpaceId: SPACE_ID,
        subjectId: "editor-1",
        tenantId: "tenant-1",
        to: "2026-07-14T00:00:00.000Z",
        topLimit: 20,
      });

      expect(report).toMatchObject({
        baseline: { failedQueries: 1, passRate: 0, totalReplays: 0 },
        current: {
          badCases: { dismissed: 0, fixed: 0, open: 2, replaying: 0 },
          failedQueries: 2,
          passRate: 0.75,
          totalReplays: 4,
        },
        topUnanswered: [
          { count: 2, query: "camera evidence" },
          { count: 1, query: "missing policy" },
        ],
      });
      expect(report.slices).toEqual(
        expect.arrayContaining([
          {
            failedQueries: 2,
            mode: "deep",
            model: "reasoning-4",
            passRate: 0.75,
            profileRevision: 4,
            replayRuns: 4,
          },
          {
            failedQueries: 1,
            mode: "balanced",
            model: "unknown",
            passRate: 0,
            profileRevision: 2,
            replayRuns: 0,
          },
        ]),
      );
    },
  );

  it("maps public review, history, bad-case, and replay pages with keyset cursors", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "quality_missing_evidence_reviews") {
        return { rows: [missingReviewRow()], rowsAffected: 1 };
      }
      if (input.tableName === "quality_resource_history") {
        return {
          rows: [
            {
              action: "updated",
              actor_subject_id: "editor-1",
              created_at: NOW,
              from_status: "open",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
              reason: "Verified by replay",
              revision: 2,
              to_status: "fixed",
            },
            {
              action: "captured",
              actor_subject_id: "editor-1",
              created_at: NOW,
              from_status: null,
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c83",
              reason: null,
              revision: 1,
              to_status: "open",
            },
          ],
          rowsAffected: 2,
        };
      }
      if (input.tableName === "quality_bad_cases") {
        return {
          rows: [
            { ...badCaseRow(), replay_run_id: RUN_ID },
            {
              ...badCaseRow(),
              created_at: "2026-07-14T14:00:00.000Z",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c84",
            },
          ],
          rowsAffected: 2,
        };
      }
      if (input.tableName === "quality_replay_runs") {
        return {
          rows: [
            { ...replayRow({ state: "failed" }), error_message: "provider failure" },
            {
              ...replayRow({ state: "passed" }),
              created_at: "2026-07-14T14:00:00.000Z",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c85",
            },
          ],
          rowsAffected: 2,
        };
      }
      if (input.tableName === "quality_replay_items") {
        return {
          rows: [
            {
              expected_evidence_ids: ["node-1"],
              golden_question_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c86",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c87",
              ordinal: 1,
              question: "Which evidence is missing?",
              result: { passed: false },
              state: "failed",
              trace_id: TRACE_ID,
            },
            {
              expected_evidence_ids: [],
              golden_question_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c88",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c89",
              ordinal: 2,
              question: "No evidence expected?",
              result: null,
              state: "queued",
              trace_id: null,
            },
          ],
          rowsAffected: 2,
        };
      }
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 10 });
    const scope = {
      candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
      knowledgeSpaceId: SPACE_ID,
      subjectId: "editor-1",
      tenantId: "tenant-1",
    } as const;

    await expect(
      repository.getMissingReview({
        ...scope,
        itemKey: `sha256:${"c".repeat(64)}`,
        traceId: TRACE_ID,
      }),
    ).resolves.toMatchObject({ reason: "Verified omission", revision: 1 });
    await expect(
      repository.listHistory({
        ...scope,
        aggregateId: badCaseRow().id,
        aggregateType: "bad-case",
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ fromStatus: "open", reason: "Verified by replay" }),
      expect.not.objectContaining({ fromStatus: expect.anything(), reason: expect.anything() }),
    ]);
    await expect(repository.getBadCase({ ...scope, id: badCaseRow().id })).resolves.toMatchObject({
      replayRunId: RUN_ID,
    });
    const badCases = await repository.listBadCases({
      ...scope,
      cursor: { createdAt: "2026-07-15T00:00:00.000Z", id: badCaseRow().id },
      limit: 1,
      status: "open",
    });
    expect(badCases.nextCursor).toEqual({ createdAt: NOW, id: badCaseRow().id });

    await expect(repository.getReplay({ ...scope, id: RUN_ID })).resolves.toMatchObject({
      error: "provider failure",
      items: [
        expect.objectContaining({ result: { passed: false }, traceId: TRACE_ID }),
        expect.not.objectContaining({ result: expect.anything(), traceId: expect.anything() }),
      ],
    });
    const replays = await repository.listReplays({
      ...scope,
      cursor: { createdAt: "2026-07-15T00:00:00.000Z", id: RUN_ID },
      from: "2026-07-01T00:00:00.000Z",
      limit: 1,
      mode: "deep",
      state: "failed",
      to: "2026-08-01T00:00:00.000Z",
    });
    expect(replays.nextCursor).toEqual({ createdAt: NOW, id: RUN_ID });
    expect(
      calls.find(
        (call) => call.tableName === "quality_replay_runs" && call.params.includes("failed"),
      )?.sql,
    ).toContain("created_at");
  });

  it("validates repository bounds and trend windows before issuing SQL", async () => {
    const database = testDatabase("postgres", async () => ({ rows: [], rowsAffected: 0 }));
    expect(() => createDatabaseQualityControlRepository({ database, maxListLimit: 0 })).toThrow(
      "maxListLimit must be at least 1",
    );
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 2 });

    await expect(
      repository.listBadCases({
        candidateGrants: [],
        knowledgeSpaceId: SPACE_ID,
        limit: 3,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("list limit must be between 1 and 2");
    await expect(
      repository.trends({
        candidateGrants: [],
        from: NOW,
        knowledgeSpaceId: SPACE_ID,
        subjectId: "editor-1",
        tenantId: "tenant-1",
        to: NOW,
        topLimit: 10,
      }),
    ).rejects.toThrow("trend window is invalid");
  });

  it("enforces bad-case transition, replay-link, revision, and CAS fences", async () => {
    const repositoryFor = ({
      badCase = badCaseRow(),
      replayVisible = false,
      updateRows = 1,
    }: {
      readonly badCase?: ReturnType<typeof badCaseRow> | null;
      readonly replayVisible?: boolean;
      readonly updateRows?: number;
    } = {}) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase("postgres", async (input) => {
        calls.push(input);
        if (input.tableName === "quality_bad_cases" && input.operation === "select") {
          return { rows: badCase ? [badCase] : [], rowsAffected: badCase ? 1 : 0 };
        }
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return {
            rows: replayVisible ? [{ id: RUN_ID }] : [],
            rowsAffected: replayVisible ? 1 : 0,
          };
        }
        if (input.tableName === "quality_bad_cases" && input.operation === "update") {
          return { rows: [], rowsAffected: updateRows };
        }
        return { rows: [], rowsAffected: 1 };
      });
      return {
        calls,
        repository: createDatabaseQualityControlRepository({
          database,
          generateId: fixedQualityId(950),
          maxListLimit: 10,
          now: () => NOW,
        }),
      };
    };
    const base = {
      actorSubjectId: "editor-1",
      candidateGrants: permissionBinding().candidateGrants,
      expectedRevision: 1,
      id: badCaseRow().id,
      knowledgeSpaceId: SPACE_ID,
      permission: permissionBinding(),
      status: "dismissed" as const,
      tenantId: "tenant-1",
    };

    await expect(
      repositoryFor({ badCase: null }).repository.updateBadCase(base),
    ).resolves.toBeNull();
    await expect(
      repositoryFor().repository.updateBadCase({ ...base, expectedRevision: 2 }),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);
    await expect(
      repositoryFor().repository.updateBadCase({ ...base, status: "fixed" }),
    ).rejects.toThrow("Invalid bad-case transition open -> fixed");
    await expect(
      repositoryFor().repository.updateBadCase({ ...base, status: "replaying" }),
    ).rejects.toThrow("requires a replay run");
    await expect(
      repositoryFor().repository.updateBadCase({
        ...base,
        replayRunId: RUN_ID,
        status: "replaying",
      }),
    ).rejects.toThrow("Linked replay run is not visible");
    await expect(
      repositoryFor({ updateRows: 0 }).repository.updateBadCase(base),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);

    const linked = repositoryFor({ replayVisible: true });
    await expect(
      linked.repository.updateBadCase({
        ...base,
        reason: "Replay scheduled",
        replayRunId: RUN_ID,
        status: "replaying",
        tags: ["camera", "replay"],
      }),
    ).resolves.toMatchObject({
      reason: "Replay scheduled",
      replayRunId: RUN_ID,
      revision: 2,
      status: "replaying",
      tags: ["camera", "replay"],
    });
    const unchanged = repositoryFor();
    await expect(
      unchanged.repository.updateBadCase({ ...base, status: "open" }),
    ).resolves.toMatchObject({ reason: "bad evidence", revision: 2, status: "open", tags: [] });
  });

  it("returns null or false when replay leases disappear at either revalidation point", async () => {
    const repositoryFor = (
      execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
    ) =>
      createDatabaseQualityControlRepository({
        database: testDatabase("postgres", execute),
        generateId: fixedQualityId(980),
        maxListLimit: 10,
        now: () => NOW,
      });
    const leased = replayRow({
      leaseExpiresAt: "2026-07-14T16:00:00.000Z",
      leaseOwner: "worker-1",
      leaseToken: "lease-1",
      state: "running",
    });

    const noClaimCandidate = repositoryFor(async () => ({ rows: [], rowsAffected: 0 }));
    await expect(
      noClaimCandidate.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" }),
    ).resolves.toBeNull();

    let outboxSelects = 0;
    const lostClaim = repositoryFor(async (input) => {
      if (input.tableName === "quality_replay_outbox" && input.operation === "select") {
        outboxSelects += 1;
        return outboxSelects === 1
          ? { rows: [{ ...replayRow(), outbox_id: OUTBOX_ID }], rowsAffected: 1 }
          : { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    await expect(
      lostClaim.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" }),
    ).resolves.toBeNull();

    const noItemCandidate = repositoryFor(async () => ({ rows: [], rowsAffected: 0 }));
    await expect(
      noItemCandidate.recordReplayItem({
        expectedLeaseToken: "lease-1",
        itemId: "item-1",
        now: NOW,
        result: {},
        runId: RUN_ID,
        state: "passed",
        traceId: TRACE_ID,
      }),
    ).resolves.toBe(false);

    let itemRunSelects = 0;
    const lostItemLease = repositoryFor(async (input) => {
      if (input.tableName === "quality_replay_runs" && input.operation === "select") {
        itemRunSelects += 1;
        return itemRunSelects === 1
          ? { rows: [leased], rowsAffected: 1 }
          : { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    await expect(
      lostItemLease.recordReplayItem({
        expectedLeaseToken: "lease-1",
        itemId: "item-1",
        now: NOW,
        result: {},
        runId: RUN_ID,
        state: "passed",
        traceId: TRACE_ID,
      }),
    ).resolves.toBe(false);

    const noCompletionCandidate = repositoryFor(async () => ({ rows: [], rowsAffected: 0 }));
    await expect(
      noCompletionCandidate.completeReplay({
        expectedLeaseToken: "lease-1",
        id: RUN_ID,
        now: NOW,
        state: "passed",
      }),
    ).resolves.toBeNull();

    let completionRunSelects = 0;
    const lostCompletionLease = repositoryFor(async (input) => {
      if (input.tableName === "quality_replay_runs" && input.operation === "select") {
        completionRunSelects += 1;
        return completionRunSelects === 1
          ? { rows: [leased], rowsAffected: 1 }
          : { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    await expect(
      lostCompletionLease.completeReplay({
        expectedLeaseToken: "lease-1",
        id: RUN_ID,
        now: NOW,
        state: "passed",
      }),
    ).resolves.toBeNull();

    const terminalCancellation = repositoryFor(async (input) =>
      input.tableName === "quality_replay_runs" && input.operation === "select"
        ? { rows: [replayRow({ state: "passed" })], rowsAffected: 1 }
        : { rows: [], rowsAffected: 1 },
    );
    await expect(
      terminalCancellation.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();

    const invalidRetry = repositoryFor(async (input) =>
      input.tableName === "quality_replay_runs" && input.operation === "select"
        ? { rows: [replayRow({ state: "queued" })], rowsAffected: 1 }
        : { rows: [], rowsAffected: 1 },
    );
    await expect(
      invalidRetry.retryReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        frozenSnapshot: frozenSnapshot(),
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
  });

  it("covers missing-review create, restore, revision, and CAS branches", async () => {
    const repositoryFor = ({
      current = null,
      updateRows = 1,
    }: {
      readonly current?: ReturnType<typeof missingReviewRow> | null;
      readonly updateRows?: number;
    } = {}) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase("postgres", async (input) => {
        calls.push(input);
        if (input.tableName === "answer_traces" && input.operation === "select") {
          return { rows: [{ id: TRACE_ID }], rowsAffected: 1 };
        }
        if (
          input.tableName === "quality_missing_evidence_reviews" &&
          input.operation === "select"
        ) {
          return { rows: current ? [current] : [], rowsAffected: current ? 1 : 0 };
        }
        if (
          input.tableName === "quality_missing_evidence_reviews" &&
          input.operation === "update"
        ) {
          return { rows: [], rowsAffected: updateRows };
        }
        return { rows: [], rowsAffected: 1 };
      });
      return {
        calls,
        repository: createDatabaseQualityControlRepository({
          database,
          generateId: fixedQualityId(990),
          maxListLimit: 10,
          now: () => NOW,
        }),
      };
    };

    await expect(
      repositoryFor().repository.upsertMissingReview({
        ...missingReviewInput(),
        expectedRevision: 2,
      }),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);

    const created = repositoryFor();
    await expect(created.repository.upsertMissingReview(missingReviewInput())).resolves.toEqual(
      expect.not.objectContaining({ reason: expect.anything() }),
    );
    expect(
      created.calls.find((call) => call.tableName === "quality_resource_history")?.params,
    ).toContain("restored");

    await expect(
      repositoryFor({ current: missingReviewRow() }).repository.upsertMissingReview({
        ...missingReviewInput(),
        expectedRevision: 2,
      }),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);
    await expect(
      repositoryFor({ current: missingReviewRow(), updateRows: 0 }).repository.upsertMissingReview({
        ...missingReviewInput(),
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);

    const restored = repositoryFor({ current: missingReviewRow() });
    await expect(
      restored.repository.upsertMissingReview({ ...missingReviewInput(), expectedRevision: 1 }),
    ).resolves.toMatchObject({ reason: undefined, revision: 2, status: "active" });
    expect(
      restored.calls.find((call) => call.tableName === "quality_resource_history")?.params,
    ).toContain("restored");
  });

  it("uses capability replay read locators and rejects a mismatched trace requester", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseQualityControlRepository({
      database: testDatabase("postgres", async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      }),
      maxListLimit: 10,
    });
    const capabilityScope = {
      candidateGrants: ["source:camera"],
      capabilityGrantId: CAPABILITY_GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      subjectId: "editor-1",
      tenantId: "tenant-1",
    } as const;
    await expect(repository.getReplay({ ...capabilityScope, id: RUN_ID })).resolves.toBeNull();
    await expect(repository.listReplays({ ...capabilityScope, limit: 5 })).resolves.toEqual({
      items: [],
    });
    for (const call of calls.filter((candidate) => candidate.tableName === "quality_replay_runs")) {
      expect(call.params).toContain(CAPABILITY_GRANT_ID);
      expect(call.sql).toContain("capability_grant_id");
    }
    await expect(
      repository.listTraces({
        candidateGrants: [],
        capabilityRequester: { callerKind: "workflow", subjectId: "other-editor" },
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("requester subject must match");
  });

  it("rejects missing or ambiguous replay authorization provenance", async () => {
    const repository = createDatabaseQualityControlRepository({
      database: testDatabase("postgres", async () => ({ rows: [], rowsAffected: 0 })),
      maxListLimit: 10,
      now: () => NOW,
    });
    const base = {
      frozenSnapshot: frozenSnapshot(),
      idempotencyKey: "invalid-provenance",
      knowledgeSpaceId: SPACE_ID,
      mode: "deep" as const,
      questions: [],
      requestFingerprint: `sha256:${"d".repeat(64)}`,
      tenantId: "tenant-1",
    };
    await expect(repository.createReplay(base)).rejects.toMatchObject({
      name: "KnowledgeSpaceAccessError",
    });
    await expect(
      repository.createReplay({
        ...base,
        capabilityGrantId: CAPABILITY_GRANT_ID,
        permission: permissionBinding(),
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
  });

  it("covers replay control not-found, revision, and update-CAS branches", async () => {
    const repositoryFor = ({
      row = null,
      updateRows = 1,
    }: {
      readonly row?: ReturnType<typeof replayRow> | null;
      readonly updateRows?: number;
    } = {}) =>
      createDatabaseQualityControlRepository({
        database: testDatabase("postgres", async (input) => {
          if (input.tableName === "quality_replay_runs" && input.operation === "select") {
            return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
          }
          if (input.tableName === "quality_replay_runs" && input.operation === "update") {
            return { rows: [], rowsAffected: updateRows };
          }
          return { rows: [], rowsAffected: 1 };
        }),
        maxListLimit: 10,
        now: () => NOW,
      });
    const cancelInput = {
      actorSubjectId: "editor-1",
      expectedRevision: 1,
      id: RUN_ID,
      knowledgeSpaceId: SPACE_ID,
      permission: permissionBinding(),
      tenantId: "tenant-1",
    } as const;
    const retryInput = { ...cancelInput, frozenSnapshot: frozenSnapshot() };

    await expect(repositoryFor().cancelReplay(cancelInput)).resolves.toBeNull();
    await expect(repositoryFor().retryReplay(retryInput)).resolves.toBeNull();
    await expect(
      repositoryFor({ row: replayRow() }).cancelReplay({ ...cancelInput, expectedRevision: 2 }),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);
    await expect(
      repositoryFor({ row: replayRow({ state: "failed" }) }).retryReplay({
        ...retryInput,
        expectedRevision: 2,
      }),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);
    await expect(
      repositoryFor({ row: replayRow(), updateRows: 0 }).cancelReplay(cancelInput),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);
    await expect(
      repositoryFor({ row: replayRow({ state: "failed" }), updateRows: 0 }).retryReplay(retryInput),
    ).rejects.toBeInstanceOf(QualityControlRevisionConflictError);
  });

  it("retries a failed replay through exact capability provenance", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "capability_grants") {
        return {
          rows: [{ content_scope_ids: ["source:camera"], subject_id: "editor-1" }],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "quality_replay_runs" && input.operation === "select") {
        return {
          rows: [replayRow({ capabilityGrantId: CAPABILITY_GRANT_ID, state: "failed" })],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "quality_replay_items" && input.operation === "select") {
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseQualityControlRepository({
      database,
      generateId: fixedQualityId(995),
      maxListLimit: 10,
      now: () => NOW,
    });

    await expect(
      repository.retryReplay({
        actorSubjectId: "editor-1",
        capabilityGrantId: CAPABILITY_GRANT_ID,
        expectedRevision: 1,
        frozenSnapshot: frozenSnapshot(),
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ capabilityGrantId: CAPABILITY_GRANT_ID, state: "failed" });
    const update = calls.find(
      (call) => call.tableName === "quality_replay_runs" && call.operation === "update",
    );
    expect(update?.params.slice(0, 6)).toEqual([CAPABILITY_GRANT_ID, null, null, null, null, null]);
  });

  it("maps reasonless reviews and rejects invalid database booleans", async () => {
    const reviewRepository = createDatabaseQualityControlRepository({
      database: testDatabase("postgres", async (input) =>
        input.tableName === "quality_missing_evidence_reviews"
          ? { rows: [missingReviewRow({ reason: null })], rowsAffected: 1 }
          : { rows: [], rowsAffected: 0 },
      ),
      maxListLimit: 10,
    });
    await expect(
      reviewRepository.getMissingReview({
        candidateGrants: [],
        itemKey: "missing",
        knowledgeSpaceId: SPACE_ID,
        subjectId: "editor-1",
        tenantId: "tenant-1",
        traceId: TRACE_ID,
      }),
    ).resolves.toEqual(expect.not.objectContaining({ reason: expect.anything() }));

    const invalidBooleanRepository = createDatabaseQualityControlRepository({
      database: testDatabase("postgres", async (input) =>
        input.tableName === "answer_traces"
          ? {
              rows: [
                {
                  completed: "invalid",
                  created_at: NOW,
                  evidence_bundle_id: null,
                  evidence_items: [],
                  evidence_state: null,
                  id: TRACE_ID,
                  mode: "fast",
                  query: "invalid boolean",
                },
              ],
              rowsAffected: 1,
            }
          : { rows: [], rowsAffected: 0 },
      ),
      maxListLimit: 10,
    });
    await expect(
      invalidBooleanRepository.listTraces({
        candidateGrants: [],
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Database boolean column has an invalid value");
  });
});

function replayRow(
  overrides: {
    readonly capabilityGrantId?: string | undefined;
    readonly completedAt?: string | null;
    readonly leaseExpiresAt?: string | null;
    readonly leaseOwner?: string | null;
    readonly leaseToken?: string | null;
    readonly state?: string;
  } = {},
) {
  const capabilityGrantId = overrides.capabilityGrantId;
  return {
    access_channel: capabilityGrantId ? null : "interactive",
    attempt: 0,
    completed_at: overrides.completedAt ?? null,
    created_at: NOW,
    error_message: null,
    frozen_snapshot: frozenSnapshot(),
    id: RUN_ID,
    idempotency_key: "idem-1",
    knowledge_space_id: SPACE_ID,
    capability_grant_id: capabilityGrantId ?? null,
    lease_expires_at: overrides.leaseExpiresAt ?? null,
    lease_owner: overrides.leaseOwner ?? null,
    lease_token: overrides.leaseToken ?? null,
    mode: "deep",
    permission_snapshot_id: capabilityGrantId ? null : PERMISSION_ID,
    permission_snapshot_revision: capabilityGrantId ? null : 3,
    request_fingerprint: `sha256:${"b".repeat(64)}`,
    requested_by_subject_id: capabilityGrantId ? null : "editor-1",
    required_permission_scope: capabilityGrantId ? null : ["tenant:tenant-1", "subject:editor-1"],
    revision: 1,
    started_at: null,
    state: overrides.state ?? "queued",
    tenant_id: "tenant-1",
    updated_at: NOW,
  };
}

function frozenSnapshot(): FrozenQualityRuntimeSnapshot {
  return {
    projectionSnapshot: {
      fingerprint: `sha256:${"a".repeat(64)}`,
      headRevision: 1,
      knowledgeSpaceId: SPACE_ID,
      projectionVersion: 1,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: { verification: "verified" },
    retrievalProfile: {
      defaultMode: "deep",
      reasoningModel: { model: "reason", pluginId: "reason", provider: "plugin-daemon" },
      rerank: { enabled: false },
      revision: 1,
      scoreThreshold: { enabled: false, stage: "mode-final", value: 0 },
      topK: 3,
    },
  };
}

function badCaseRow() {
  return {
    actor_subject_id: "editor-1",
    created_at: NOW,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    knowledge_space_id: SPACE_ID,
    reason: "bad evidence",
    replay_run_id: null,
    revision: 1,
    status: "open",
    tags: [],
    trace_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
    updated_at: NOW,
  };
}

function missingReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    actor_subject_id: "editor-1",
    created_at: NOW,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
    item_key: `sha256:${"c".repeat(64)}`,
    knowledge_space_id: SPACE_ID,
    reason: "Verified omission",
    revision: 1,
    status: "active",
    trace_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
    updated_at: NOW,
    ...overrides,
  };
}

function permissionBinding(
  overrides: Partial<QualityPermissionBinding> = {},
): QualityPermissionBinding {
  return {
    accessChannel: "interactive",
    candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
    permissionSnapshotId: PERMISSION_ID,
    permissionSnapshotRevision: 3,
    requestedBySubjectId: "editor-1",
    ...overrides,
  };
}

function missingReviewInput() {
  return {
    actorSubjectId: "editor-1",
    candidateGrants: permissionBinding().candidateGrants,
    expectedRevision: 0,
    itemKey: `sha256:${"e".repeat(64)}`,
    knowledgeSpaceId: SPACE_ID,
    permission: permissionBinding(),
    status: "active" as const,
    tenantId: "tenant-1",
    traceId: TRACE_ID,
  };
}

function testDatabase(
  dialect: DatabaseAdapter["dialect"],
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  options: {
    readonly activeSpace?: boolean;
    readonly permission?: {
      readonly accessChannel?: QualityPermissionBinding["accessChannel"];
      readonly id?: string;
      readonly revision?: number;
      readonly subjectId?: string;
    };
    readonly permissionFence?: boolean;
  } = {},
): DatabaseAdapter {
  const wrappedExecute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    const result = await execute(input);
    if (input.operation !== "select") return result;
    if (input.tableName === "knowledge_spaces" && options.activeSpace !== false) {
      return {
        rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
        rowsAffected: 1,
      };
    }
    if (options.permissionFence !== false) {
      if (input.tableName === "knowledge_space_permission_snapshots") {
        return {
          rows: [permissionFenceRow(options.permission)],
          rowsAffected: 1,
        };
      }
      if (
        input.tableName === "knowledge_space_members" ||
        input.tableName === "knowledge_space_access_policies" ||
        input.tableName === "knowledge_space_api_access"
      ) {
        return { rows: [{ id: `acl-${input.tableName}` }], rowsAffected: 1 };
      }
    }
    return result;
  };
  const adapter = createSchemaDatabaseAdapter({
    executor: wrappedExecute,
    kind: dialect,
    transaction: async (callback) => callback({ execute: wrappedExecute }),
  });
  return {
    ...adapter,
    execute: wrappedExecute,
    transaction: async (callback) => callback({ execute: wrappedExecute }),
  };
}

function permissionFenceRow(
  overrides: {
    readonly accessChannel?: QualityPermissionBinding["accessChannel"];
    readonly id?: string;
    readonly revision?: number;
    readonly subjectId?: string;
  } = {},
) {
  return {
    access_channel: overrides.accessChannel ?? "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: NOW,
    expires_at: "2099-01-01T00:00:00.000Z",
    id: overrides.id ?? PERMISSION_ID,
    knowledge_space_id: SPACE_ID,
    member_revision: 1,
    permission_scopes: ["tenant:tenant-1", `subject:${overrides.subjectId ?? "editor-1"}`],
    revision: overrides.revision ?? 3,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: overrides.subjectId ?? "editor-1",
    tenant_id: "tenant-1",
    updated_at: NOW,
    visibility: "all_members",
  };
}
