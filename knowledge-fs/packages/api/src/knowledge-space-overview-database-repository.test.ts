import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { knowledgeSpaceAttentionIssueKey } from "./knowledge-space-overview";
import {
  appendKnowledgeSpaceActivityWithExecutor,
  createDatabaseKnowledgeSpaceOverviewRepository,
} from "./knowledge-space-overview-database-repository";

const TENANT_ID = "tenant-overview";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const EVENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const QUERY_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const PERMISSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const NOW = "2026-07-14T14:00:00.000Z";

describe.each(["postgres", "tidb"] as const)(
  "database knowledge-space Overview repository (%s)",
  (dialect) => {
    it("persists an idempotent activity and rejects cross-scope or changed-content reuse", async () => {
      let stored: DatabaseRow | undefined;
      const database = testDatabase(dialect, async (input) => {
        if (input.operation === "insert" && !stored) {
          const values = input.params;
          stored = {
            action: values[5],
            actor_subject_id: values[4],
            actor_type: values[3],
            details: values[10],
            id: values[0],
            knowledge_space_id: values[2],
            occurred_at: values[11],
            required_permission_scope: values[9],
            resource_id: values[7],
            resource_type: values[6],
            result: values[8],
            tenant_id: values[1],
          };
        }
        if (input.operation === "select") {
          const row = stored;
          if (
            row !== undefined &&
            row.tenant_id === input.params[0] &&
            row.knowledge_space_id === input.params[1] &&
            row.id === input.params[2]
          ) {
            return { rows: [row], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const input = {
        action: "query.requested" as const,
        actor: { id: "member-1", type: "member" as const },
        details: { mode: "research" },
        id: EVENT_ID,
        knowledgeSpaceId: SPACE_ID,
        occurredAt: NOW,
        requiredPermissionScope: ["team:camera"],
        resource: { id: QUERY_ID, type: "query" as const },
        result: "pending" as const,
        tenantId: TENANT_ID,
      };

      const first = await appendKnowledgeSpaceActivityWithExecutor({
        database,
        executor: database,
        input,
      });
      const replay = await appendKnowledgeSpaceActivityWithExecutor({
        database,
        executor: database,
        input: { ...input, occurredAt: "2026-07-14T14:01:00.000Z" },
      });
      expect(replay).toEqual(first);
      await expect(
        appendKnowledgeSpaceActivityWithExecutor({
          database,
          executor: database,
          input: { ...input, result: "failure" },
        }),
      ).rejects.toThrow("idempotency key");
      await expect(
        appendKnowledgeSpaceActivityWithExecutor({
          database,
          executor: database,
          input: { ...input, tenantId: "tenant-other" },
        }),
      ).rejects.toThrow("idempotency key");
    });

    it("applies tenant, space and candidate ACL predicates before activity pagination", async () => {
      let select: DatabaseExecuteInput | undefined;
      const database = testDatabase(dialect, async (input) => {
        select = input;
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 100,
        maxRuleItems: 20,
      });

      await repository.listActivity({
        candidateGrants: ["team:camera"],
        cursor: { id: EVENT_ID, occurredAt: NOW },
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        tenantId: TENANT_ID,
      });

      expect(select?.params.slice(0, 3)).toEqual([
        TENANT_ID,
        SPACE_ID,
        JSON.stringify(["team:camera"]),
      ]);
      const sql = select?.sql ?? "";
      expect(sql).toContain("UNION ALL");
      expect(sql).toContain("answer_traces");
      expect(sql).toContain("query.completed");
      expect(sql).toContain("query.failed");
      expect(sql).toMatch(
        /stored_request\.[`"]actor_subject_id[`"] = stored_trace\.[`"]subject_id[`"]/u,
      );
      expect(sql).toMatch(
        /stored_trace\.[`"]created_at[`"] >= stored_request\.[`"]occurred_at[`"]/u,
      );
      expect(sql.indexOf("tenant_id")).toBeLessThan(sql.indexOf("ORDER BY"));
      expect(sql.indexOf("knowledge_space_id")).toBeLessThan(sql.indexOf("ORDER BY"));
      expect(sql).toContain(dialect === "postgres" ? "::jsonb @>" : "JSON_CONTAINS");
      expect(sql.indexOf(dialect === "postgres" ? "::jsonb @>" : "JSON_CONTAINS")).toBeLessThan(
        sql.indexOf("LIMIT"),
      );
    });

    it("uses distinct request identities, request-before-completion linkage, and clamps corrupt aggregates", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_space_activity_events") {
          return {
            rows: [
              {
                answers_24h: 9,
                answers_30d: 9,
                answers_7d: 9,
                queries_24h: 2,
                queries_30d: 2,
                queries_7d: 2,
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "logical_documents") {
          return { rows: [{ knowledge_count: 3 }], rowsAffected: 1 };
        }
        if (input.tableName === "source_connections") {
          return { rows: [{ linked_app_count: 1 }], rowsAffected: 1 };
        }
        return {
          rows: [
            {
              fresh_source_count: 1,
              latest_source_sync_at: NOW,
              source_count: 1,
              stale_source_count: 0,
            },
          ],
          rowsAffected: 1,
        };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 100,
        maxRuleItems: 20,
      });

      const stats = await repository.getStats({
        candidateGrants: ["team:camera"],
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        tenantId: TENANT_ID,
      });
      expect(stats.windows["24h"]).toMatchObject({
        answerRate: 1,
        answeredQueryCount: 2,
        queryCount: 2,
      });
      const activitySql = calls.find(
        (call) => call.tableName === "knowledge_space_activity_events",
      )?.sql;
      expect(activitySql).toContain("COUNT(DISTINCT CASE");
      expect(activitySql).toContain("query.requested");
      expect(activitySql).toContain("query.completed");
      expect(activitySql).toContain("answer_traces");
      expect(activitySql).toMatch(/answer_trace\.[`"]completed[`"] = TRUE/u);
      expect(activitySql).toMatch(
        /answer_trace\.[`"]subject_id[`"] = event\.[`"]actor_subject_id[`"]/u,
      );
      expect(activitySql).toMatch(
        /answer_trace\.[`"]created_at[`"] >= event\.[`"]occurred_at[`"]/u,
      );
    });

    it("filters low-quality failed-query signals by tenant and current grants before LIMIT", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 100,
        maxRuleItems: 20,
      });
      const candidateGrants = ["subject:editor-1", "team:camera", "tenant:tenant-overview"];

      await repository.listAttention({
        candidateGrants,
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        now: NOW,
        staleBefore: "2026-07-07T14:00:00.000Z",
        subjectId: "editor-1",
        tenantId: TENANT_ID,
      });

      const failed = calls.find((call) => call.tableName === "failed_queries");
      expect(failed?.params.slice(0, 4)).toEqual([
        TENANT_ID,
        SPACE_ID,
        "editor-1",
        JSON.stringify(candidateGrants),
      ]);
      const sql = failed?.sql ?? "";
      const acl = dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      expect(sql).toContain("requested_by_subject_id");
      expect(sql).toContain("required_permission_scope");
      expect(sql).toContain("permission_snapshot_id");
      expect(sql).toContain("permission_snapshot_revision");
      expect(sql.indexOf(acl)).toBeLessThan(sql.indexOf("LIMIT"));
      expect(sql.indexOf("requested_by_subject_id")).toBeLessThan(sql.indexOf("LIMIT"));
    });

    it("rejects an attention transition when the fresh snapshot was revoked", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (
          input.tableName === "knowledge_space_permission_snapshots" &&
          input.sql.includes("LIMIT 1 FOR UPDATE")
        ) {
          return { rows: [permissionSnapshotRow({ status: "revoked" })], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: input.tableName }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 100,
        maxRuleItems: 20,
      });

      await expect(repository.transitionAttention(transitionInput())).rejects.toMatchObject({
        name: "KnowledgeSpaceAccessError",
      });
      expect(calls.some((call) => call.tableName === "knowledge_space_attention_states")).toBe(
        false,
      );
      expect(calls.some((call) => call.operation === "update")).toBe(false);
    });

    it("rejects a service/API attention transition when API access was disabled", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (
          input.tableName === "knowledge_space_permission_snapshots" &&
          input.sql.includes("LIMIT 1 FOR UPDATE")
        ) {
          return {
            rows: [permissionSnapshotRow({ accessChannel: "service_api" })],
            rowsAffected: 1,
          };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: input.tableName }], rowsAffected: 1 };
        }
        // The joined revalidation returns no row after API access is disabled.
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 100,
        maxRuleItems: 20,
      });

      await expect(
        repository.transitionAttention(
          transitionInput({
            accessChannel: "service_api",
          }),
        ),
      ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
      expect(calls.some((call) => call.operation === "update")).toBe(false);
      expect(
        calls.find(
          (call) =>
            call.tableName === "knowledge_space_permission_snapshots" &&
            !call.sql.includes("LIMIT 1 FOR UPDATE"),
        )?.sql,
      ).toContain("enabled");
    });

    it("fails an attention transition closed before permission/state access when deletion wins", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [{ id: "active-delete" }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 100,
        maxRuleItems: 20,
      });

      await expect(repository.transitionAttention(transitionInput())).resolves.toBeNull();
      expect(calls).toHaveLength(2);
      expect(calls[0]?.sql).toContain("FOR UPDATE");
      expect(calls[0]?.sql).toContain("deletion_job_id");
      expect(calls[1]?.sql).toContain("active_slot");
      expect(calls[1]?.sql).toContain("FOR UPDATE");
    });

    it("validates repository bounds and activity inputs before database access", async () => {
      const database = testDatabase(dialect, async () => {
        throw new Error("database must not be called");
      });
      for (const bounds of [
        { maxListLimit: 0, maxRuleItems: 1 },
        { maxListLimit: 10, maxRuleItems: 0 },
        { maxListLimit: 10, maxRuleItems: 11 },
      ]) {
        expect(() =>
          createDatabaseKnowledgeSpaceOverviewRepository({ database, ...bounds }),
        ).toThrow("bounds are invalid");
      }
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        generateActivityId: () => "",
        maxListLimit: 10,
        maxRuleItems: 5,
      });
      const valid = activityInput();
      await expect(repository.appendActivity(valid)).rejects.toThrow("scope is invalid");
      await expect(
        repository.appendActivity({ ...valid, id: EVENT_ID, action: "unknown" as never }),
      ).rejects.toThrow("Unknown activity action");
      await expect(
        repository.appendActivity({
          ...valid,
          id: EVENT_ID,
          resource: { type: "unknown" as never },
        }),
      ).rejects.toThrow("Unknown activity resource type");
      await expect(
        repository.appendActivity({ ...valid, id: EVENT_ID, result: "unknown" as never }),
      ).rejects.toThrow("Unknown activity result");
      await expect(
        repository.appendActivity({ ...valid, actor: { type: "member" }, id: EVENT_ID }),
      ).rejects.toThrow("Member actor id is required");
      await expect(
        repository.appendActivity({
          ...valid,
          id: EVENT_ID,
          requiredPermissionScope: [" team:camera"],
        }),
      ).rejects.toThrow("permission scope is invalid");
    });

    it("locks deletion admission and persists a generated system activity id", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let stored: DatabaseRow | undefined;
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_activity_events" && input.operation === "insert") {
          stored = activityRowFromInsert(input.params);
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_activity_events" && input.operation === "select") {
          return { rows: stored ? [stored] : [], rowsAffected: stored ? 1 : 0 };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        generateActivityId: () => EVENT_ID,
        maxListLimit: 10,
        maxRuleItems: 5,
      });

      const activity = await repository.appendActivity(activityInput());

      expect(activity).toMatchObject({
        actor: { type: "system" },
        id: EVENT_ID,
        resource: { type: "query" },
      });
      expect(calls.map((call) => call.tableName).slice(0, 3)).toEqual([
        "knowledge_spaces",
        "deletion_jobs",
        "knowledge_space_activity_events",
      ]);

      const unavailable = createDatabaseKnowledgeSpaceOverviewRepository({
        database: testDatabase(dialect, async () => ({ rows: [], rowsAffected: 0 })),
        maxListLimit: 10,
        maxRuleItems: 5,
      });
      await expect(
        unavailable.appendActivity({ ...activityInput(), id: EVENT_ID }),
      ).rejects.toThrow("unavailable for activity append");
    });

    it("maps filtered activity pages and rejects unsafe limits", async () => {
      let select: DatabaseExecuteInput | undefined;
      const database = testDatabase(dialect, async (input) => {
        select = input;
        return {
          rows: [
            activityRow({ id: EVENT_ID }),
            activityRow({
              actor_subject_id: null,
              actor_type: "system",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
              resource_id: null,
            }),
          ],
          rowsAffected: 2,
        };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 2,
        maxRuleItems: 1,
      });

      const page = await repository.listActivity({
        action: "query.requested",
        candidateGrants: ["team:camera"],
        cursor: { id: QUERY_ID, occurredAt: NOW },
        from: "2026-07-13T14:00:00.000Z",
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        resourceType: "query",
        result: "pending",
        tenantId: TENANT_ID,
        to: NOW,
      });

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toEqual({ id: EVENT_ID, occurredAt: NOW });
      expect(select?.params).toEqual([
        TENANT_ID,
        SPACE_ID,
        JSON.stringify(["team:camera"]),
        "query.requested",
        "query",
        "pending",
        "2026-07-13T14:00:00.000Z",
        NOW,
        NOW,
        QUERY_ID,
        2,
      ]);
      await expect(
        repository.listActivity({
          candidateGrants: [],
          knowledgeSpaceId: SPACE_ID,
          limit: 0,
          tenantId: TENANT_ID,
        }),
      ).rejects.toThrow("limit must be positive");
      await expect(
        repository.listActivity({
          candidateGrants: [],
          knowledgeSpaceId: SPACE_ID,
          limit: 3,
          tenantId: TENANT_ID,
        }),
      ).rejects.toThrow("limit exceeds 2");
    });

    it("returns empty stats and reports unavailable, degraded, and healthy product states", async () => {
      const emptyRepository = createDatabaseKnowledgeSpaceOverviewRepository({
        database: testDatabase(dialect, async () => ({ rows: [], rowsAffected: 0 })),
        maxListLimit: 10,
        maxRuleItems: 5,
      });
      await expect(
        emptyRepository.getStats({
          candidateGrants: ["team:camera"],
          knowledgeSpaceId: SPACE_ID,
          now: NOW,
          tenantId: TENANT_ID,
        }),
      ).resolves.toMatchObject({
        current: {
          freshSourceCount: 0,
          knowledgeCount: 0,
          linkedAppCount: 0,
          sourceCount: 0,
          staleSourceCount: 0,
        },
        windows: {
          "24h": { answerRate: 0, answeredQueryCount: 0, queryCount: 0 },
          "30d": { answerRate: 0, answeredQueryCount: 0, queryCount: 0 },
          "7d": { answerRate: 0, answeredQueryCount: 0, queryCount: 0 },
        },
      });

      const healthInput = {
        candidateGrants: ["team:camera"],
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        staleBefore: "2026-07-07T14:00:00.000Z",
        tenantId: TENANT_ID,
        workerStaleBefore: "2026-07-14T13:55:00.000Z",
      };
      const health = async (
        core: DatabaseRow | undefined,
        source: DatabaseRow | undefined,
        worker: DatabaseRow | undefined,
      ) =>
        createDatabaseKnowledgeSpaceOverviewRepository({
          database: testDatabase(dialect, async (input) => {
            const row =
              input.tableName === "knowledge_spaces"
                ? core
                : input.tableName === "sources"
                  ? source
                  : worker;
            return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
          }),
          maxListLimit: 10,
          maxRuleItems: 5,
        }).getHealth(healthInput);

      const unavailable = await health(undefined, undefined, undefined);
      expect(unavailable.state).toBe("unavailable");
      expect(unavailable.components.profilePublication.codes).toContain("PROFILE_HEADS_INCOMPLETE");

      const degraded = await health(
        healthCoreRow({ failed_documents: 1 }),
        sourceFreshnessRow({ stale_source_count: 1 }),
        { stale_workers: 1 },
      );
      expect(degraded.state).toBe("degraded");
      expect(degraded.components.ingestion.codes).toEqual(["INGESTION_FAILURE_PRESENT"]);
      expect(degraded.components.sourceFreshness.codes).toEqual(["SOURCE_FRESHNESS_STALE"]);
      expect(degraded.components.workerReadiness.codes).toEqual(["WORKER_LEASE_STALE"]);

      const missingIndex = await health(
        healthCoreRow({ profile_bindings: 0, publication_heads: 0 }),
        sourceFreshnessRow(),
        { stale_workers: 0 },
      );
      expect(missingIndex.state).toBe("unavailable");
      expect(missingIndex.components.index.codes).toEqual(["PUBLISHED_INDEX_MISSING"]);

      const healthy = await health(healthCoreRow(), sourceFreshnessRow(), { stale_workers: 0 });
      expect(healthy.state).toBe("healthy");
      expect(
        Object.values(healthy.components).every((component) => component.state === "healthy"),
      ).toBe(true);
    });

    it("materializes, merges, sorts, and filters every attention signal kind", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "sources") {
          return {
            rows: [
              {
                created_at: "2026-07-01T00:00:00.000Z",
                id: "source-1",
                last_sync_at: null,
                permission_scope: ["team:camera"],
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "logical_documents") {
          return {
            rows: [
              {
                id: "document-1",
                metadata: { permissionScope: ["team:camera"] },
                updated_at: "2026-07-13T00:00:00.000Z",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "failed_queries") {
          return {
            rows: [
              {
                created_at: "2026-07-13T12:00:00.000Z",
                id: "failed-1",
                required_permission_scope: ["team:camera"],
                trigger: "no-evidence",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_profile_heads"
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_attention_states") {
          if (input.operation === "insert") return { rows: [], rowsAffected: 1 };
          const issueKey = String(input.params[2]);
          if (issueKey.startsWith("model-readiness:")) {
            return { rows: [], rowsAffected: 0 };
          }
          const state = attentionStateForIssue(issueKey);
          return { rows: [state], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        generateAttentionStateId: () => "state-id",
        maxListLimit: 20,
        maxRuleItems: 20,
      });

      const issues = await repository.listAttention({
        candidateGrants: ["team:camera"],
        includeDismissed: true,
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        now: NOW,
        staleBefore: "2026-07-07T14:00:00.000Z",
        subjectId: "editor-1",
        tenantId: TENANT_ID,
      });

      expect(issues.map((issue) => issue.ruleId)).toEqual([
        "failed-document",
        "model-readiness",
        "permission-readiness",
        "stale-source",
      ]);
      expect(issues.find((issue) => issue.ruleId === "failed-document")).toMatchObject({
        dismissedUntil: "2026-07-15T00:00:00.000Z",
        status: "dismissed",
      });
      expect(issues.find((issue) => issue.ruleId === "stale-source")).toMatchObject({
        status: "active",
      });
      expect(
        calls.filter(
          (call) =>
            call.tableName === "knowledge_space_attention_states" && call.operation === "insert",
        ),
      ).toHaveLength(5);

      const noSignals = createDatabaseKnowledgeSpaceOverviewRepository({
        database: testDatabase(dialect, async (input) => {
          if (input.tableName === "knowledge_space_access_policies") {
            return { rows: [{ owner_count: 1, policy_id: "policy-1" }], rowsAffected: 1 };
          }
          if (input.tableName === "knowledge_space_profile_heads") {
            return {
              rows: [{ bindings: 0, embedding_heads: 1, publications: 0, retrieval_heads: 1 }],
              rowsAffected: 1,
            };
          }
          return { rows: [], rowsAffected: 0 };
        }),
        maxListLimit: 20,
        maxRuleItems: 20,
      });
      await expect(
        noSignals.listAttention({
          candidateGrants: ["team:camera"],
          knowledgeSpaceId: SPACE_ID,
          limit: 10,
          now: NOW,
          staleBefore: "2026-07-07T14:00:00.000Z",
          subjectId: "editor-1",
          tenantId: TENANT_ID,
        }),
      ).resolves.toEqual([]);
    });

    it("revalidates permission and transitions every persisted attention rule", async () => {
      const definitions = attentionDefinitions();
      const database = testDatabase(dialect, async (input) => {
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionSnapshotRow()], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_api_access" ||
          (input.tableName === "knowledge_space_access_policies" &&
            input.sql.includes("FOR UPDATE"))
        ) {
          return { rows: [{ id: input.tableName }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_attention_states") {
          const issueKey = String(input.operation === "update" ? input.params[6] : input.params[2]);
          const definition = definitions.find((candidate) => candidate.issueKey === issueKey);
          if (!definition) return { rows: [], rowsAffected: 0 };
          if (input.operation === "update") {
            const updated = attentionStateRow(definition, { revision: 2, status: "resolved" });
            return dialect === "postgres"
              ? { rows: [updated], rowsAffected: 1 }
              : { rows: [], rowsAffected: 1 };
          }
          return {
            rows: [
              attentionStateRow(definition, {
                revision: input.sql.includes("FOR UPDATE") ? 1 : 2,
                status: input.sql.includes("FOR UPDATE") ? "active" : "resolved",
              }),
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "sources") {
          return {
            rows: [
              {
                created_at: "2026-07-01T00:00:00.000Z",
                id: "source-1",
                last_sync_at: "2026-07-02T00:00:00.000Z",
                permission_scope: ["team:camera"],
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "logical_documents") {
          return {
            rows: [{ id: "document-1", metadata: {}, updated_at: NOW }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "failed_queries") {
          return {
            rows: [
              {
                created_at: NOW,
                id: "failed-1",
                required_permission_scope: ["team:camera"],
                trigger: "low-score",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_profile_heads"
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit: 20,
        maxRuleItems: 20,
      });

      for (const definition of definitions) {
        await expect(
          repository.transitionAttention({
            ...transitionInput(),
            issueKey: definition.issueKey,
          }),
        ).resolves.toMatchObject({
          issueKey: definition.issueKey,
          revision: 2,
          status: "resolved",
        });
      }
    });
  },
);

function transitionInput(
  overrides: { readonly accessChannel?: "interactive" | "service_api" } = {},
) {
  const candidateGrants = ["subject:editor-1", `tenant:${TENANT_ID}`];
  return {
    actorSubjectId: "editor-1",
    candidateGrants,
    expectedRevision: 1,
    issueKey: `failed-document:document:${QUERY_ID}`,
    knowledgeSpaceId: SPACE_ID,
    now: NOW,
    permission: {
      accessChannel: overrides.accessChannel ?? "interactive",
      candidateGrants,
      permissionSnapshotId: PERMISSION_ID,
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "editor-1",
    },
    status: "resolved" as const,
    tenantId: TENANT_ID,
  };
}

function activeSpaceRow() {
  return { deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" };
}

function permissionSnapshotRow(
  overrides: {
    readonly accessChannel?: "interactive" | "service_api";
    readonly status?: "active" | "revoked";
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
    id: PERMISSION_ID,
    knowledge_space_id: SPACE_ID,
    member_revision: 1,
    permission_scopes: ["subject:editor-1", `tenant:${TENANT_ID}`],
    revision: 1,
    revoked_at: overrides.status === "revoked" ? NOW : null,
    role: "editor",
    status: overrides.status ?? "active",
    subject_id: "editor-1",
    tenant_id: TENANT_ID,
    updated_at: NOW,
    visibility: "all_members",
  };
}

function activityInput() {
  return {
    action: "query.requested" as const,
    actor: { type: "system" as const },
    details: { mode: "research" },
    knowledgeSpaceId: SPACE_ID,
    occurredAt: NOW,
    requiredPermissionScope: ["team:camera"],
    resource: { type: "query" as const },
    result: "pending" as const,
    tenantId: TENANT_ID,
  };
}

function activityRow(overrides: DatabaseRow = {}): DatabaseRow {
  return {
    action: "query.requested",
    actor_subject_id: "member-1",
    actor_type: "member",
    details: { mode: "research" },
    id: EVENT_ID,
    knowledge_space_id: SPACE_ID,
    occurred_at: NOW,
    required_permission_scope: ["team:camera"],
    resource_id: QUERY_ID,
    resource_type: "query",
    result: "pending",
    tenant_id: TENANT_ID,
    ...overrides,
  };
}

function activityRowFromInsert(params: DatabaseExecuteInput["params"]): DatabaseRow {
  return {
    action: params[5],
    actor_subject_id: params[4],
    actor_type: params[3],
    details: params[10],
    id: params[0],
    knowledge_space_id: params[2],
    occurred_at: params[11],
    required_permission_scope: params[9],
    resource_id: params[7],
    resource_type: params[6],
    result: params[8],
    tenant_id: params[1],
  };
}

function healthCoreRow(overrides: DatabaseRow = {}): DatabaseRow {
  return {
    failed_documents: 0,
    profile_bindings: 1,
    profile_heads: 2,
    publication_heads: 1,
    ready_documents: 1,
    ...overrides,
  };
}

function sourceFreshnessRow(overrides: DatabaseRow = {}): DatabaseRow {
  return {
    fresh_source_count: 1,
    latest_source_sync_at: NOW,
    source_count: 1,
    stale_source_count: 0,
    ...overrides,
  };
}

function attentionDefinitions() {
  return [
    {
      issueKey: knowledgeSpaceAttentionIssueKey("stale-source", "source", "source-1"),
      resourceId: "source-1",
      resourceType: "source",
      ruleId: "stale-source",
    },
    {
      issueKey: knowledgeSpaceAttentionIssueKey("failed-document", "document", "document-1"),
      resourceId: "document-1",
      resourceType: "document",
      ruleId: "failed-document",
    },
    {
      issueKey: knowledgeSpaceAttentionIssueKey("low-quality-query", "failed-query", "failed-1"),
      resourceId: "failed-1",
      resourceType: "failed-query",
      ruleId: "low-quality-query",
    },
    {
      issueKey: knowledgeSpaceAttentionIssueKey(
        "permission-readiness",
        "knowledge-space",
        SPACE_ID,
      ),
      resourceId: SPACE_ID,
      resourceType: "knowledge-space",
      ruleId: "permission-readiness",
    },
    {
      issueKey: knowledgeSpaceAttentionIssueKey("model-readiness", "knowledge-space", SPACE_ID),
      resourceId: SPACE_ID,
      resourceType: "knowledge-space",
      ruleId: "model-readiness",
    },
  ] as const;
}

function attentionStateRow(
  definition: ReturnType<typeof attentionDefinitions>[number],
  overrides: DatabaseRow = {},
): DatabaseRow {
  return {
    dismissed_until: null,
    issue_key: definition.issueKey,
    knowledge_space_id: SPACE_ID,
    resource_id: definition.resourceId,
    resource_type: definition.resourceType,
    revision: 1,
    rule_id: definition.ruleId,
    status: "active",
    tenant_id: TENANT_ID,
    updated_at: NOW,
    ...overrides,
  };
}

function attentionStateForIssue(issueKey: string): DatabaseRow {
  const definition = attentionDefinitions().find((candidate) => candidate.issueKey === issueKey);
  if (!definition) throw new Error(`unknown attention issue ${issueKey}`);
  if (definition.ruleId === "failed-document") {
    return attentionStateRow(definition, {
      dismissed_until: "2026-07-15T00:00:00.000Z",
      status: "dismissed",
    });
  }
  if (definition.ruleId === "stale-source") {
    return attentionStateRow(definition, {
      dismissed_until: "2026-07-13T00:00:00.000Z",
      status: "dismissed",
    });
  }
  if (definition.ruleId === "low-quality-query") {
    return attentionStateRow(definition, { status: "resolved" });
  }
  return attentionStateRow(definition);
}

function testDatabase(
  dialect: DatabaseAdapter["dialect"],
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
): DatabaseAdapter {
  const schemaAdapter = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  // Overview's repository tests intentionally exercise SQL before the migration/schema artifact
  // test. The direct executor keeps these unit tests independent of another migration's tables.
  return { ...schemaAdapter, execute, transaction: async (callback) => callback({ execute }) };
}
