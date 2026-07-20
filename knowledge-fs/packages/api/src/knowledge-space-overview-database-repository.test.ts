import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

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
