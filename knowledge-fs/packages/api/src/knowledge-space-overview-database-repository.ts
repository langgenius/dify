import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  stableJson,
} from "@knowledge/core";

import { candidatePermissionScopeSnapshot } from "./candidate-content-authorization";
import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import {
  KnowledgeSpaceAccessError,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import {
  type AppendKnowledgeSpaceActivityInput,
  type KnowledgeSpaceActivityAction,
  KnowledgeSpaceActivityActions,
  type KnowledgeSpaceActivityEvent,
  type KnowledgeSpaceActivityResourceType,
  KnowledgeSpaceActivityResourceTypes,
  type KnowledgeSpaceActivityResult,
  KnowledgeSpaceActivityResults,
  type KnowledgeSpaceAttentionIssue,
  KnowledgeSpaceAttentionRevisionConflictError,
  type KnowledgeSpaceAttentionRuleId,
  KnowledgeSpaceAttentionRuleIds,
  type KnowledgeSpaceHealthState,
  KnowledgeSpaceOverviewLimitError,
  type KnowledgeSpaceOverviewRepository,
  type KnowledgeSpaceOverviewStats,
  type KnowledgeSpaceProductHealth,
  knowledgeSpaceAttentionIssueKey,
  sanitizeKnowledgeSpaceActivityDetails,
} from "./knowledge-space-overview";

export interface DatabaseKnowledgeSpaceOverviewRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateActivityId?: (() => string) | undefined;
  readonly generateAttentionStateId?: (() => string) | undefined;
  readonly maxListLimit: number;
  readonly maxRuleItems: number;
}

export function createDatabaseKnowledgeSpaceOverviewRepository({
  database,
  generateActivityId = randomUUID,
  generateAttentionStateId = randomUUID,
  maxListLimit,
  maxRuleItems,
}: DatabaseKnowledgeSpaceOverviewRepositoryOptions): KnowledgeSpaceOverviewRepository {
  if (maxListLimit < 1 || maxRuleItems < 1 || maxRuleItems > maxListLimit) {
    throw new Error("Knowledge-space Overview database bounds are invalid");
  }
  return {
    appendActivity: async (rawInput) => {
      const input = normalizeActivityInput(rawInput, rawInput.id ?? generateActivityId());
      return database.transaction(async (transaction) => {
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, input))) {
          throw new Error("Knowledge space is unavailable for activity append");
        }
        return appendKnowledgeSpaceActivityWithExecutor({
          database,
          executor: transaction,
          input,
        });
      });
    },
    getStats: async (input) => getStats(database, input),
    listActivity: async (input) => {
      validateLimit(input.limit, maxListLimit);
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.knowledgeSpaceId,
        JSON.stringify(input.candidateGrants),
      ];
      const filters: string[] = [];
      if (input.action) {
        params.push(input.action);
        filters.push(`event.${q(database, "action")} = ${p(database, params.length)}`);
      }
      if (input.resourceType) {
        params.push(input.resourceType);
        filters.push(`event.${q(database, "resource_type")} = ${p(database, params.length)}`);
      }
      if (input.result) {
        params.push(input.result);
        filters.push(`event.${q(database, "result")} = ${p(database, params.length)}`);
      }
      if (input.from) {
        params.push(input.from);
        filters.push(`event.${q(database, "occurred_at")} >= ${p(database, params.length)}`);
      }
      if (input.to) {
        params.push(input.to);
        filters.push(`event.${q(database, "occurred_at")} <= ${p(database, params.length)}`);
      }
      if (input.cursor) {
        params.push(input.cursor.occurredAt, input.cursor.id);
        filters.push(
          `(event.${q(database, "occurred_at")} < ${p(database, params.length - 1)} OR (event.${q(database, "occurred_at")} = ${p(database, params.length - 1)} AND event.${q(database, "id")} < ${p(database, params.length)}))`,
        );
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT event.* FROM (${activityReadModelSql(database)}) event WHERE event.${q(database, "tenant_id")} = ${p(database, 1)} AND event.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${permissionScopeSql(database, `event.${q(database, "required_permission_scope")}`, p(database, 3))}${filters.length > 0 ? ` AND ${filters.join(" AND ")}` : ""} ORDER BY event.${q(database, "occurred_at")} DESC, event.${q(database, "id")} DESC LIMIT ${p(database, params.length)};`,
        tableName: "knowledge_space_activity_events",
      });
      const rows = result.rows.map(mapActivity);
      const items = rows.slice(0, input.limit);
      const tail = items.at(-1);
      return {
        items,
        ...(rows.length > input.limit && tail
          ? { nextCursor: { id: tail.id, occurredAt: tail.occurredAt } }
          : {}),
      };
    },
    listAttention: async (input) => {
      validateLimit(input.limit, maxListLimit);
      const signals = await collectAttentionSignals(database, {
        ...input,
        limit: Math.min(input.limit, maxRuleItems),
      });
      for (const signal of signals) {
        await ensureAttentionState(database, signal, input.tenantId, generateAttentionStateId());
      }
      if (signals.length === 0) return [];
      const states = await readAttentionStates(database, {
        issueKeys: signals.map((issue) => issue.issueKey),
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      });
      return signals
        .map((signal) => mergeAttentionState(signal, states.get(signal.issueKey), input.now))
        .filter(
          (issue) =>
            issue.status === "active" ||
            (input.includeDismissed === true && issue.status === "dismissed"),
        )
        .slice(0, input.limit);
    },
    transitionAttention: async (input) =>
      database.transaction(async (transaction) => {
        assertOverviewPermissionBinding(input);
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, input))) {
          return null;
        }
        const permission = await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: transaction,
          fence: {
            accessChannel: input.permission.accessChannel,
            knowledgeSpaceId: input.knowledgeSpaceId,
            permissionSnapshotId: input.permission.permissionSnapshotId,
            permissionSnapshotRevision: input.permission.permissionSnapshotRevision,
            requestedBySubjectId: input.permission.requestedBySubjectId,
            tenantId: input.tenantId,
          },
          now: input.now,
          requiredAccess: "write",
        });
        if (!sameStringSet(permission.permissionScopes, input.permission.candidateGrants)) {
          throw new KnowledgeSpaceAccessError(
            "space_access_permission_snapshot_invalid",
            "Knowledge-space Overview permission scopes no longer match the server-issued binding",
          );
        }
        const candidateGrants = [...permission.permissionScopes];
        const existing = await readAttentionState(database, transaction, input, true);
        if (!existing) return null;
        const signal = await signalFromStoredState(database, existing, {
          ...input,
          candidateGrants,
          subjectId: input.actorSubjectId,
        });
        if (!signal) return null;
        const params: DatabaseQueryValue[] = [
          input.status,
          input.status === "dismissed" ? (input.dismissedUntil ?? null) : null,
          input.actorSubjectId,
          input.now,
          input.tenantId,
          input.knowledgeSpaceId,
          input.issueKey,
          input.expectedRevision,
        ];
        const updated = await transaction.execute({
          maxRows: 1,
          operation: "update",
          params,
          sql: `UPDATE ${q(database, "knowledge_space_attention_states")} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "dismissed_until")} = ${p(database, 2)}, ${q(database, "updated_by_subject_id")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)}, ${q(database, "revision")} = ${q(database, "revision")} + 1 WHERE ${q(database, "tenant_id")} = ${p(database, 5)} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(database, "issue_key")} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(database, 8)}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName: "knowledge_space_attention_states",
        });
        if (updated.rowsAffected === 0 && updated.rows.length === 0) {
          throw new KnowledgeSpaceAttentionRevisionConflictError();
        }
        const state = updated.rows[0]
          ? mapAttentionState(updated.rows[0])
          : await readAttentionState(database, transaction, input);
        if (!state) throw new Error("Attention state disappeared after update");
        return mergeAttentionState(signal, state, input.now);
      }),
    getHealth: async (input) => getHealth(database, input),
  };
}

function assertOverviewPermissionBinding(input: {
  readonly actorSubjectId: string;
  readonly candidateGrants: readonly string[];
  readonly permission: {
    readonly candidateGrants: readonly string[];
    readonly requestedBySubjectId: string;
  };
}): void {
  if (
    input.permission.requestedBySubjectId !== input.actorSubjectId ||
    !sameStringSet(input.permission.candidateGrants, input.candidateGrants)
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Knowledge-space Overview permission binding does not match the current actor and candidate grants",
    );
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return (
    expected.size === left.length &&
    new Set(right).size === right.length &&
    right.every((value) => expected.has(value))
  );
}

/**
 * Transactional writer for repositories that already hold the knowledge-space deletion admission
 * lock. The deterministic id makes commit retries idempotent; the first occurredAt wins.
 */
export async function appendKnowledgeSpaceActivityWithExecutor(input: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly input: AppendKnowledgeSpaceActivityInput;
}): Promise<KnowledgeSpaceActivityEvent> {
  const activity = normalizeActivityInput(input.input, input.input.id ?? randomUUID());
  await input.executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      activity.id,
      activity.tenantId,
      activity.knowledgeSpaceId,
      activity.actor.type,
      activity.actor.id ?? null,
      activity.action,
      activity.resource.type,
      activity.resource.id ?? null,
      activity.result,
      JSON.stringify(activity.requiredPermissionScope),
      JSON.stringify(activity.details),
      activity.occurredAt,
    ],
    sql: `INSERT INTO ${q(input.database, "knowledge_space_activity_events")} (${[
      "id",
      "tenant_id",
      "knowledge_space_id",
      "actor_type",
      "actor_subject_id",
      "action",
      "resource_type",
      "resource_id",
      "result",
      "required_permission_scope",
      "details",
      "occurred_at",
    ]
      .map((column) => q(input.database, column))
      .join(
        ", ",
      )}) VALUES (${p(input.database, 1)}, ${p(input.database, 2)}, ${p(input.database, 3)}, ${p(input.database, 4)}, ${p(input.database, 5)}, ${p(input.database, 6)}, ${p(input.database, 7)}, ${p(input.database, 8)}, ${p(input.database, 9)}, ${jsonP(input.database, 10)}, ${jsonP(input.database, 11)}, ${p(input.database, 12)})${input.database.dialect === "postgres" ? ` ON CONFLICT (${q(input.database, "id")}) DO NOTHING` : ` ON DUPLICATE KEY UPDATE ${q(input.database, "id")} = ${q(input.database, "id")}`};`,
    tableName: "knowledge_space_activity_events",
  });
  const stored = await readActivity(input.database, input.executor, {
    id: activity.id,
    knowledgeSpaceId: activity.knowledgeSpaceId,
    tenantId: activity.tenantId,
  });
  if (!stored || !sameActivity(stored, activity)) {
    throw new Error("Activity idempotency key was reused with different content or scope");
  }
  return stored;
}

async function getStats(
  database: DatabaseAdapter,
  input: {
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly tenantId: string;
  },
): Promise<KnowledgeSpaceOverviewStats> {
  const nowMs = Date.parse(input.now);
  const since24h = new Date(nowMs - 24 * 60 * 60_000).toISOString();
  const since7d = new Date(nowMs - 7 * 24 * 60 * 60_000).toISOString();
  const since30d = new Date(nowMs - 30 * 24 * 60 * 60_000).toISOString();
  const grants = JSON.stringify(input.candidateGrants);
  const activity = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, grants, since24h, since7d, since30d],
    sql: `SELECT ${countDistinctCase(database, `event.${q(database, "action")} = 'query.requested' AND event.${q(database, "occurred_at")} >= ${p(database, 4)}`, `event.${q(database, "resource_id")}`)} AS ${q(database, "queries_24h")}, ${countDistinctCase(database, answerPredicate(database, 4), `event.${q(database, "resource_id")}`)} AS ${q(database, "answers_24h")}, ${countDistinctCase(database, `event.${q(database, "action")} = 'query.requested' AND event.${q(database, "occurred_at")} >= ${p(database, 5)}`, `event.${q(database, "resource_id")}`)} AS ${q(database, "queries_7d")}, ${countDistinctCase(database, answerPredicate(database, 5), `event.${q(database, "resource_id")}`)} AS ${q(database, "answers_7d")}, ${countDistinctCase(database, `event.${q(database, "action")} = 'query.requested' AND event.${q(database, "occurred_at")} >= ${p(database, 6)}`, `event.${q(database, "resource_id")}`)} AS ${q(database, "queries_30d")}, ${countDistinctCase(database, answerPredicate(database, 6), `event.${q(database, "resource_id")}`)} AS ${q(database, "answers_30d")} FROM ${q(database, "knowledge_space_activity_events")} event WHERE event.${q(database, "tenant_id")} = ${p(database, 1)} AND event.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${permissionScopeSql(database, `event.${q(database, "required_permission_scope")}`, p(database, 3))} AND event.${q(database, "occurred_at")} >= ${p(database, 6)};`,
    tableName: "knowledge_space_activity_events",
  });
  const knowledge = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, grants],
    sql: `SELECT ${countAll(database)} AS ${q(database, "knowledge_count")} FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND revision.${q(database, "revision")} = document.${q(database, "active_revision")} AND revision.${q(database, "state")} = 'active' JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE document.${q(database, "tenant_id")} = ${p(database, 1)} AND document.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${assetPermissionSql(database, "asset", p(database, 3))};`,
    tableName: "logical_documents",
  });
  const linked = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${countAll(database)} AS ${q(database, "linked_app_count")} FROM ${q(database, "source_connections")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "status")} = 'active';`,
    tableName: "source_connections",
  });
  const source = await sourceFreshness(database, {
    ...input,
    staleBefore: since7d,
  });
  const activityRow = activity.rows[0] ?? emptyActivityRow();
  const window = (key: "24h" | "7d" | "30d", since: string) => {
    const queryCount = numberColumn(activityRow, `queries_${key}`);
    // The AnswerTrace/legacy-terminal predicates already make answers a subset of requests. Keep
    // this final clamp as a corruption/adapter guard so the public contract never exposes > 1.
    const answeredQueryCount = Math.min(queryCount, numberColumn(activityRow, `answers_${key}`));
    return {
      answerRate: queryCount === 0 ? 0 : answeredQueryCount / queryCount,
      answeredQueryCount,
      queryCount,
      since,
    };
  };
  return {
    current: {
      freshSourceCount: source.freshSourceCount,
      knowledgeCount: numberColumn(knowledge.rows[0] ?? { knowledge_count: 0 }, "knowledge_count"),
      ...(source.latestSourceSyncAt ? { latestSourceSyncAt: source.latestSourceSyncAt } : {}),
      linkedAppCount: numberColumn(linked.rows[0] ?? { linked_app_count: 0 }, "linked_app_count"),
      sourceCount: source.sourceCount,
      staleSourceCount: source.staleSourceCount,
    },
    generatedAt: input.now,
    knowledgeSpaceId: input.knowledgeSpaceId,
    windows: {
      "24h": window("24h", since24h),
      "7d": window("7d", since7d),
      "30d": window("30d", since30d),
    },
  };
}

interface AttentionSignalInput {
  readonly candidateGrants: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly now: string;
  readonly staleBefore: string;
  readonly subjectId: string;
  readonly tenantId: string;
}

async function collectAttentionSignals(
  database: DatabaseAdapter,
  input: AttentionSignalInput,
): Promise<KnowledgeSpaceAttentionIssue[]> {
  const perRule = Math.max(1, Math.min(input.limit, 20));
  const [sources, documents, quality, permission, model] = await Promise.all([
    staleSourceSignals(database, input, perRule),
    failedDocumentSignals(database, input, perRule),
    lowQualitySignals(database, input, perRule),
    permissionSignals(database, input),
    modelSignals(database, input),
  ]);
  return [...permission, ...model, ...documents, ...sources, ...quality]
    .sort(
      (left, right) =>
        severityRank(left.severity) - severityRank(right.severity) ||
        left.issueKey.localeCompare(right.issueKey),
    )
    .slice(0, input.limit);
}

async function staleSourceSignals(
  database: DatabaseAdapter,
  input: AttentionSignalInput,
  limit: number,
  resourceId?: string,
): Promise<KnowledgeSpaceAttentionIssue[]> {
  const params: DatabaseQueryValue[] = [
    input.tenantId,
    input.knowledgeSpaceId,
    JSON.stringify(input.candidateGrants),
    input.staleBefore,
  ];
  const resourceFilter = resourceId
    ? ` AND source.${q(database, "id")} = ${p(database, params.push(resourceId))}`
    : "";
  params.push(limit);
  const result = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT source.${q(database, "id")}, source.${q(database, "permission_scope")}, source.${q(database, "created_at")}, MAX(run.${q(database, "completed_at")}) AS ${q(database, "last_sync_at")} FROM ${q(database, "sources")} source LEFT JOIN ${q(database, "source_workflow_runs")} run ON run.${q(database, "tenant_id")} = ${p(database, 1)} AND run.${q(database, "knowledge_space_id")} = source.${q(database, "knowledge_space_id")} AND run.${q(database, "source_id")} = source.${q(database, "id")} AND run.${q(database, "kind")} = 'sync' AND run.${q(database, "run_state")} IN ('completed', 'zero_results') WHERE source.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND source.${q(database, "status")} NOT IN ('deleting', 'error') AND ${permissionScopeSql(database, `source.${q(database, "permission_scope")}`, p(database, 3))}${resourceFilter} GROUP BY source.${q(database, "id")}, source.${q(database, "permission_scope")}, source.${q(database, "created_at")} HAVING MAX(run.${q(database, "completed_at")}) IS NULL OR MAX(run.${q(database, "completed_at")}) < ${p(database, 4)} ORDER BY MAX(run.${q(database, "completed_at")}) ASC, source.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
    tableName: "sources",
  });
  return result.rows.map((row) => {
    const id = stringColumn(row, "id");
    const observedAt = optionalStringColumn(row, "last_sync_at") ?? stringColumn(row, "created_at");
    return attentionSignal({
      action: { kind: "open-resource", resourceId: id, resourceType: "source" },
      code: "SOURCE_STALE",
      knowledgeSpaceId: input.knowledgeSpaceId,
      now: input.now,
      observedAt,
      requiredPermissionScope: jsonStringArrayColumn(row, "permission_scope"),
      resource: { id, type: "source" },
      ruleId: "stale-source",
      severity: "warning",
      title: "Source data is stale",
    });
  });
}

async function failedDocumentSignals(
  database: DatabaseAdapter,
  input: AttentionSignalInput,
  limit: number,
  resourceId?: string,
): Promise<KnowledgeSpaceAttentionIssue[]> {
  const params: DatabaseQueryValue[] = [
    input.tenantId,
    input.knowledgeSpaceId,
    JSON.stringify(input.candidateGrants),
  ];
  const resourceFilter = resourceId
    ? ` AND document.${q(database, "id")} = ${p(database, params.push(resourceId))}`
    : "";
  params.push(limit);
  const result = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT document.${q(database, "id")}, document.${q(database, "updated_at")}, asset.${q(database, "metadata")} FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND revision.${q(database, "revision")} = (SELECT MAX(candidate.${q(database, "revision")}) FROM ${q(database, "document_revisions")} candidate WHERE candidate.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND candidate.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND candidate.${q(database, "document_id")} = document.${q(database, "id")}) JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE document.${q(database, "tenant_id")} = ${p(database, 1)} AND document.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND document.${q(database, "status")} = 'failed' AND ${assetPermissionSql(database, "asset", p(database, 3))}${resourceFilter} ORDER BY document.${q(database, "updated_at")} DESC, document.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
    tableName: "logical_documents",
  });
  return result.rows.map((row) => {
    const id = stringColumn(row, "id");
    const metadata = jsonObjectColumn(row, "metadata");
    const requiredPermissionScope = candidatePermissionScopeSnapshot(metadata.permissionScope) ?? [
      "__deny__",
    ];
    return attentionSignal({
      action: { kind: "open-resource", resourceId: id, resourceType: "document" },
      code: "DOCUMENT_PROCESSING_FAILED",
      knowledgeSpaceId: input.knowledgeSpaceId,
      now: input.now,
      observedAt: stringColumn(row, "updated_at"),
      requiredPermissionScope,
      resource: { id, type: "document" },
      ruleId: "failed-document",
      severity: "critical",
      title: "Document processing failed",
    });
  });
}

async function lowQualitySignals(
  database: DatabaseAdapter,
  input: AttentionSignalInput,
  limit: number,
  resourceId?: string,
): Promise<KnowledgeSpaceAttentionIssue[]> {
  const params: DatabaseQueryValue[] = [
    input.tenantId,
    input.knowledgeSpaceId,
    input.subjectId,
    JSON.stringify(input.candidateGrants),
  ];
  const resourceFilter = resourceId
    ? ` AND failed.${q(database, "id")} = ${p(database, params.push(resourceId))}`
    : "";
  params.push(limit);
  const result = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT failed.${q(database, "id")}, failed.${q(database, "created_at")}, failed.${q(database, "trigger")}, failed.${q(database, "required_permission_scope")} FROM ${q(database, "failed_queries")} failed WHERE failed.${q(database, "tenant_id")} = ${p(database, 1)} AND failed.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND failed.${q(database, "requested_by_subject_id")} = ${p(database, 3)} AND failed.${q(database, "status")} = 'pending-triage' AND failed.${q(database, "access_channel")} IN ('interactive', 'service_api', 'mcp', 'agent') AND failed.${q(database, "permission_snapshot_id")} IS NOT NULL AND failed.${q(database, "permission_snapshot_revision")} >= 1 AND failed.${q(database, "revision")} >= 1 AND ${permissionScopeSql(database, `failed.${q(database, "required_permission_scope")}`, p(database, 4))}${resourceFilter} ORDER BY failed.${q(database, "created_at")} DESC, failed.${q(database, "id")} DESC LIMIT ${p(database, params.length)};`,
    tableName: "failed_queries",
  });
  return result.rows.map((row) => {
    const id = stringColumn(row, "id");
    return attentionSignal({
      action: { kind: "open-resource", resourceId: id, resourceType: "failed-query" },
      code: `QUERY_${stringColumn(row, "trigger").toUpperCase().replaceAll("-", "_")}`,
      knowledgeSpaceId: input.knowledgeSpaceId,
      now: input.now,
      observedAt: stringColumn(row, "created_at"),
      requiredPermissionScope: jsonStringArrayColumn(row, "required_permission_scope"),
      resource: { id, type: "failed-query" },
      ruleId: "low-quality-query",
      severity: "warning",
      title: "Query quality needs review",
    });
  });
}

async function permissionSignals(
  database: DatabaseAdapter,
  input: AttentionSignalInput,
): Promise<KnowledgeSpaceAttentionIssue[]> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT policy.${q(database, "id")} AS ${q(database, "policy_id")}, ${countCase(database, `member.${q(database, "role")} = 'owner'`)} AS ${q(database, "owner_count")} FROM ${q(database, "knowledge_spaces")} space LEFT JOIN ${q(database, "knowledge_space_access_policies")} policy ON policy.${q(database, "tenant_id")} = space.${q(database, "tenant_id")} AND policy.${q(database, "knowledge_space_id")} = space.${q(database, "id")} LEFT JOIN ${q(database, "knowledge_space_members")} member ON member.${q(database, "tenant_id")} = space.${q(database, "tenant_id")} AND member.${q(database, "knowledge_space_id")} = space.${q(database, "id")} WHERE space.${q(database, "tenant_id")} = ${p(database, 1)} AND space.${q(database, "id")} = ${p(database, 2)} GROUP BY policy.${q(database, "id")};`,
    tableName: "knowledge_space_access_policies",
  });
  const row = result.rows[0];
  if (row && optionalStringColumn(row, "policy_id") && numberColumn(row, "owner_count") > 0)
    return [];
  return [
    attentionSignal({
      action: { kind: "review-permissions", resourceType: "knowledge-space" },
      code: "PERMISSION_AGGREGATE_NOT_READY",
      knowledgeSpaceId: input.knowledgeSpaceId,
      now: input.now,
      observedAt: input.now,
      requiredPermissionScope: [],
      resource: { id: input.knowledgeSpaceId, type: "knowledge-space" },
      ruleId: "permission-readiness",
      severity: "critical",
      title: "Knowledge-space permissions are not ready",
    }),
  ];
}

async function modelSignals(
  database: DatabaseAdapter,
  input: AttentionSignalInput,
): Promise<KnowledgeSpaceAttentionIssue[]> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${countCase(database, `head.${q(database, "kind")} = 'embedding'`)} AS ${q(database, "embedding_heads")}, ${countCase(database, `head.${q(database, "kind")} = 'retrieval'`)} AS ${q(database, "retrieval_heads")}, (SELECT ${countAll(database)} FROM ${q(database, "knowledge_space_profile_publication_bindings")} binding WHERE binding.${q(database, "tenant_id")} = ${p(database, 1)} AND binding.${q(database, "knowledge_space_id")} = ${p(database, 2)}) AS ${q(database, "bindings")}, (SELECT ${countAll(database)} FROM ${q(database, "projection_set_publication_heads")} publication WHERE publication.${q(database, "tenant_id")} = ${p(database, 1)} AND publication.${q(database, "knowledge_space_id")} = ${p(database, 2)}) AS ${q(database, "publications")} FROM ${q(database, "knowledge_space_profile_heads")} head WHERE head.${q(database, "tenant_id")} = ${p(database, 1)} AND head.${q(database, "knowledge_space_id")} = ${p(database, 2)};`,
    tableName: "knowledge_space_profile_heads",
  });
  const row = result.rows[0] ?? {
    bindings: 0,
    embedding_heads: 0,
    publications: 0,
    retrieval_heads: 0,
  };
  if (
    numberColumn(row, "embedding_heads") > 0 &&
    numberColumn(row, "retrieval_heads") > 0 &&
    (numberColumn(row, "publications") === 0 || numberColumn(row, "bindings") > 0)
  ) {
    return [];
  }
  return [
    attentionSignal({
      action: { kind: "review-models", resourceType: "knowledge-space" },
      code: "MODEL_PROFILE_NOT_READY",
      knowledgeSpaceId: input.knowledgeSpaceId,
      now: input.now,
      observedAt: input.now,
      requiredPermissionScope: [],
      resource: { id: input.knowledgeSpaceId, type: "knowledge-space" },
      ruleId: "model-readiness",
      severity: "critical",
      title: "Retrieval model profile is not published",
    }),
  ];
}

async function sourceFreshness(
  database: DatabaseAdapter,
  input: {
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly staleBefore: string;
    readonly tenantId: string;
  },
) {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      JSON.stringify(input.candidateGrants),
      input.staleBefore,
    ],
    sql: `SELECT ${countAll(database)} AS ${q(database, "source_count")}, ${countCase(database, `latest.${q(database, "last_sync_at")} IS NULL OR latest.${q(database, "last_sync_at")} < ${p(database, 4)}`)} AS ${q(database, "stale_source_count")}, ${countCase(database, `latest.${q(database, "last_sync_at")} IS NOT NULL AND latest.${q(database, "last_sync_at")} >= ${p(database, 4)}`)} AS ${q(database, "fresh_source_count")}, MAX(latest.${q(database, "last_sync_at")}) AS ${q(database, "latest_source_sync_at")} FROM ${q(database, "sources")} source LEFT JOIN (SELECT ${q(database, "tenant_id")}, ${q(database, "knowledge_space_id")}, ${q(database, "source_id")}, MAX(${q(database, "completed_at")}) AS ${q(database, "last_sync_at")} FROM ${q(database, "source_workflow_runs")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "kind")} = 'sync' AND ${q(database, "run_state")} IN ('completed', 'zero_results') GROUP BY ${q(database, "tenant_id")}, ${q(database, "knowledge_space_id")}, ${q(database, "source_id")}) latest ON latest.${q(database, "tenant_id")} = ${p(database, 1)} AND latest.${q(database, "knowledge_space_id")} = source.${q(database, "knowledge_space_id")} AND latest.${q(database, "source_id")} = source.${q(database, "id")} WHERE source.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${permissionScopeSql(database, `source.${q(database, "permission_scope")}`, p(database, 3))};`,
    tableName: "sources",
  });
  const row = result.rows[0] ?? {
    fresh_source_count: 0,
    latest_source_sync_at: null,
    source_count: 0,
    stale_source_count: 0,
  };
  return {
    freshSourceCount: numberColumn(row, "fresh_source_count"),
    latestSourceSyncAt: optionalStringColumn(row, "latest_source_sync_at"),
    sourceCount: numberColumn(row, "source_count"),
    staleSourceCount: numberColumn(row, "stale_source_count"),
  };
}

async function getHealth(
  database: DatabaseAdapter,
  input: {
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly staleBefore: string;
    readonly tenantId: string;
    readonly workerStaleBefore: string;
  },
): Promise<KnowledgeSpaceProductHealth> {
  const [core, source, worker] = await Promise.all([
    database.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, JSON.stringify(input.candidateGrants)],
      sql: `SELECT (${documentHealthCountSql(database, "failed", false)}) AS ${q(database, "failed_documents")}, (SELECT ${countAll(database)} FROM ${q(database, "projection_set_publication_heads")} publication WHERE publication.${q(database, "tenant_id")} = ${p(database, 1)} AND publication.${q(database, "knowledge_space_id")} = ${p(database, 2)}) AS ${q(database, "publication_heads")}, (SELECT ${countAll(database)} FROM ${q(database, "knowledge_space_profile_heads")} profile WHERE profile.${q(database, "tenant_id")} = ${p(database, 1)} AND profile.${q(database, "knowledge_space_id")} = ${p(database, 2)}) AS ${q(database, "profile_heads")}, (SELECT ${countAll(database)} FROM ${q(database, "knowledge_space_profile_publication_bindings")} binding WHERE binding.${q(database, "tenant_id")} = ${p(database, 1)} AND binding.${q(database, "knowledge_space_id")} = ${p(database, 2)}) AS ${q(database, "profile_bindings")}, (${documentHealthCountSql(database, "ready", true)}) AS ${q(database, "ready_documents")};`,
      tableName: "knowledge_spaces",
    }),
    sourceFreshness(database, input),
    database.execute({
      maxRows: 1,
      operation: "select",
      params: [
        input.tenantId,
        input.knowledgeSpaceId,
        input.workerStaleBefore,
        JSON.stringify(input.candidateGrants),
      ],
      sql: `SELECT (SELECT ${countAll(database)} FROM ${q(database, "document_compilation_attempts")} attempt WHERE attempt.${q(database, "tenant_id")} = ${p(database, 1)} AND attempt.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND attempt.${q(database, "active_slot")} = 1 AND attempt.${q(database, "updated_at")} < ${p(database, 3)} AND EXISTS (SELECT 1 FROM ${q(database, "document_assets")} attempt_asset WHERE attempt_asset.${q(database, "knowledge_space_id")} = attempt.${q(database, "knowledge_space_id")} AND attempt_asset.${q(database, "id")} = attempt.${q(database, "document_asset_id")} AND ${assetPermissionSql(database, "attempt_asset", p(database, 4))})) + (SELECT ${countAll(database)} FROM ${q(database, "source_workflow_runs")} run WHERE run.${q(database, "tenant_id")} = ${p(database, 1)} AND run.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND run.${q(database, "active_slot")} = 1 AND run.${q(database, "updated_at")} < ${p(database, 3)} AND (run.${q(database, "source_id")} IS NULL OR EXISTS (SELECT 1 FROM ${q(database, "sources")} workflow_source WHERE workflow_source.${q(database, "knowledge_space_id")} = run.${q(database, "knowledge_space_id")} AND workflow_source.${q(database, "id")} = run.${q(database, "source_id")} AND ${permissionScopeSql(database, `workflow_source.${q(database, "permission_scope")}`, p(database, 4))}))) + (SELECT ${countAll(database)} FROM ${q(database, "knowledge_space_profile_migration_runs")} migration WHERE migration.${q(database, "tenant_id")} = ${p(database, 1)} AND migration.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND migration.${q(database, "active_slot")} = 1 AND migration.${q(database, "updated_at")} < ${p(database, 3)}) AS ${q(database, "stale_workers")};`,
      tableName: "document_compilation_attempts",
    }),
  ]);
  const row = core.rows[0] ?? {
    failed_documents: 0,
    profile_bindings: 0,
    profile_heads: 0,
    publication_heads: 0,
    ready_documents: 0,
  };
  const failedDocuments = numberColumn(row, "failed_documents");
  const publicationHeads = numberColumn(row, "publication_heads");
  const profileHeads = numberColumn(row, "profile_heads");
  const profileBindings = numberColumn(row, "profile_bindings");
  const readyDocuments = numberColumn(row, "ready_documents");
  const staleWorkers = numberColumn(worker.rows[0] ?? { stale_workers: 0 }, "stale_workers");
  const ingestion = component(
    failedDocuments > 0 ? "degraded" : "healthy",
    failedDocuments > 0 ? ["INGESTION_FAILURE_PRESENT"] : [],
  );
  const index = component(
    readyDocuments > 0 && publicationHeads === 0 ? "unavailable" : "healthy",
    readyDocuments > 0 && publicationHeads === 0 ? ["PUBLISHED_INDEX_MISSING"] : [],
  );
  const profilePublication = component(
    profileHeads < 2 || (publicationHeads > 0 && profileBindings === 0) ? "unavailable" : "healthy",
    [
      ...(profileHeads < 2 ? ["PROFILE_HEADS_INCOMPLETE"] : []),
      ...(publicationHeads > 0 && profileBindings === 0
        ? ["PROFILE_PUBLICATION_BINDING_MISSING"]
        : []),
    ],
  );
  const sourceComponent = component(
    source.staleSourceCount > 0 ? "degraded" : "healthy",
    source.staleSourceCount > 0 ? ["SOURCE_FRESHNESS_STALE"] : [],
  );
  const workerReadiness = component(
    staleWorkers > 0 ? "degraded" : "healthy",
    staleWorkers > 0 ? ["WORKER_LEASE_STALE"] : [],
  );
  const queryAvailability = component(
    index.state === "unavailable" || profilePublication.state === "unavailable"
      ? "unavailable"
      : "healthy",
    [
      ...(index.state === "unavailable" ? ["QUERY_INDEX_UNAVAILABLE"] : []),
      ...(profilePublication.state === "unavailable" ? ["QUERY_PROFILE_UNAVAILABLE"] : []),
    ],
  );
  const components = {
    index,
    ingestion,
    profilePublication,
    queryAvailability,
    sourceFreshness: sourceComponent,
    workerReadiness,
  };
  const states = Object.values(components).map((value) => value.state);
  return {
    components,
    generatedAt: input.now,
    knowledgeSpaceId: input.knowledgeSpaceId,
    state: states.includes("unavailable")
      ? "unavailable"
      : states.includes("degraded")
        ? "degraded"
        : states.every((state) => state === "healthy")
          ? "healthy"
          : "unknown",
  };
}

interface AttentionState {
  readonly dismissedUntil?: string | undefined;
  readonly issueKey: string;
  readonly knowledgeSpaceId: string;
  readonly resourceId: string;
  readonly resourceType: KnowledgeSpaceAttentionIssue["resource"]["type"];
  readonly revision: number;
  readonly ruleId: KnowledgeSpaceAttentionRuleId;
  readonly status: KnowledgeSpaceAttentionIssue["status"];
  readonly tenantId: string;
  readonly updatedAt: string;
}

async function ensureAttentionState(
  database: DatabaseAdapter,
  issue: KnowledgeSpaceAttentionIssue,
  tenantId: string,
  id: string,
) {
  await database.transaction(async (transaction) => {
    if (
      !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
        knowledgeSpaceId: issue.knowledgeSpaceId,
        tenantId,
      }))
    ) {
      return;
    }
    await transaction.execute({
      maxRows: 0,
      operation: "insert",
      params: [
        id,
        tenantId,
        issue.knowledgeSpaceId,
        issue.issueKey,
        issue.ruleId,
        issue.resource.type,
        issue.resource.id,
        issue.updatedAt,
        issue.updatedAt,
      ],
      sql: `INSERT INTO ${q(database, "knowledge_space_attention_states")} (${["id", "tenant_id", "knowledge_space_id", "issue_key", "rule_id", "resource_type", "resource_id", "status", "revision", "created_at", "updated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, ${p(database, 7)}, 'active', 1, ${p(database, 8)}, ${p(database, 9)})${database.dialect === "postgres" ? ` ON CONFLICT (${q(database, "tenant_id")}, ${q(database, "knowledge_space_id")}, ${q(database, "issue_key")}) DO NOTHING` : ` ON DUPLICATE KEY UPDATE ${q(database, "id")} = ${q(database, "id")}`};`,
      tableName: "knowledge_space_attention_states",
    });
  });
}

async function readAttentionStates(
  database: DatabaseAdapter,
  input: {
    readonly issueKeys: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  },
) {
  const states = new Map<string, AttentionState>();
  for (const issueKey of input.issueKeys) {
    const state = await readAttentionState(database, database, { ...input, issueKey });
    if (state) states.set(issueKey, state);
  }
  return states;
}

async function readAttentionState(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly issueKey: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  },
  forUpdate = false,
): Promise<AttentionState | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.issueKey],
    sql: `SELECT * FROM ${q(database, "knowledge_space_attention_states")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "issue_key")} = ${p(database, 3)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "knowledge_space_attention_states",
  });
  return result.rows[0] ? mapAttentionState(result.rows[0]) : null;
}

async function signalFromStoredState(
  database: DatabaseAdapter,
  state: AttentionState,
  input: {
    readonly candidateGrants: readonly string[];
    readonly now: string;
    readonly subjectId: string;
    readonly tenantId: string;
  },
) {
  const signalInput: AttentionSignalInput = {
    candidateGrants: input.candidateGrants,
    knowledgeSpaceId: state.knowledgeSpaceId,
    limit: 1,
    now: input.now,
    staleBefore: new Date(Date.parse(input.now) - 7 * 24 * 60 * 60_000).toISOString(),
    subjectId: input.subjectId,
    tenantId: input.tenantId,
  };
  const signals =
    state.ruleId === "stale-source"
      ? await staleSourceSignals(database, signalInput, 1, state.resourceId)
      : state.ruleId === "failed-document"
        ? await failedDocumentSignals(database, signalInput, 1, state.resourceId)
        : state.ruleId === "low-quality-query"
          ? await lowQualitySignals(database, signalInput, 1, state.resourceId)
          : state.ruleId === "permission-readiness"
            ? await permissionSignals(database, signalInput)
            : await modelSignals(database, signalInput);
  return signals.find((candidate) => candidate.issueKey === state.issueKey) ?? null;
}

function mergeAttentionState(
  signal: KnowledgeSpaceAttentionIssue,
  state: AttentionState | undefined,
  now: string,
): KnowledgeSpaceAttentionIssue {
  if (!state) return signal;
  const expired =
    state.status === "dismissed" && state.dismissedUntil && state.dismissedUntil <= now;
  return {
    ...signal,
    ...(state.dismissedUntil && !expired ? { dismissedUntil: state.dismissedUntil } : {}),
    revision: state.revision,
    status: expired ? "active" : state.status,
    updatedAt: state.updatedAt,
  };
}

function attentionSignal(input: {
  readonly action: KnowledgeSpaceAttentionIssue["action"];
  readonly code: string;
  readonly knowledgeSpaceId: string;
  readonly now: string;
  readonly observedAt: string;
  readonly requiredPermissionScope: readonly string[];
  readonly resource: KnowledgeSpaceAttentionIssue["resource"];
  readonly ruleId: KnowledgeSpaceAttentionRuleId;
  readonly severity: KnowledgeSpaceAttentionIssue["severity"];
  readonly title: string;
}): KnowledgeSpaceAttentionIssue {
  return {
    action: input.action,
    evidence: [{ code: input.code, observedAt: input.observedAt }],
    issueKey: knowledgeSpaceAttentionIssueKey(input.ruleId, input.resource.type, input.resource.id),
    knowledgeSpaceId: input.knowledgeSpaceId,
    requiredPermissionScope: [...input.requiredPermissionScope],
    resource: input.resource,
    revision: 1,
    ruleId: input.ruleId,
    severity: input.severity,
    status: "active",
    title: input.title,
    updatedAt: input.now,
  };
}

async function readActivity(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: { readonly id: string; readonly knowledgeSpaceId: string; readonly tenantId: string },
) {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.id],
    sql: `SELECT * FROM ${q(database, "knowledge_space_activity_events")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} LIMIT 1;`,
    tableName: "knowledge_space_activity_events",
  });
  return result.rows[0] ? mapActivity(result.rows[0]) : null;
}

function mapActivity(row: DatabaseRow): KnowledgeSpaceActivityEvent {
  const action = enumValue(stringColumn(row, "action"), KnowledgeSpaceActivityActions, "action");
  const resourceType = enumValue(
    stringColumn(row, "resource_type"),
    KnowledgeSpaceActivityResourceTypes,
    "resource type",
  );
  const result = enumValue(stringColumn(row, "result"), KnowledgeSpaceActivityResults, "result");
  const actorType = enumValue(
    stringColumn(row, "actor_type"),
    ["member", "system"] as const,
    "actor type",
  );
  const actorId = optionalStringColumn(row, "actor_subject_id");
  return {
    action,
    actor: { ...(actorId ? { id: actorId } : {}), type: actorType },
    details: sanitizeKnowledgeSpaceActivityDetails(jsonObjectColumn(row, "details")),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    occurredAt: stringColumn(row, "occurred_at"),
    requiredPermissionScope: jsonStringArrayColumn(row, "required_permission_scope"),
    resource: {
      ...(optionalStringColumn(row, "resource_id")
        ? { id: optionalStringColumn(row, "resource_id") }
        : {}),
      type: resourceType,
    },
    result,
    tenantId: stringColumn(row, "tenant_id"),
  };
}

function mapAttentionState(row: DatabaseRow): AttentionState {
  return {
    ...(optionalStringColumn(row, "dismissed_until")
      ? { dismissedUntil: optionalStringColumn(row, "dismissed_until") }
      : {}),
    issueKey: stringColumn(row, "issue_key"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    resourceId: stringColumn(row, "resource_id"),
    resourceType: enumValue(
      stringColumn(row, "resource_type"),
      ["knowledge-space", "document", "source", "failed-query"] as const,
      "attention resource type",
    ),
    revision: numberColumn(row, "revision"),
    ruleId: enumValue(
      stringColumn(row, "rule_id"),
      KnowledgeSpaceAttentionRuleIds,
      "attention rule",
    ),
    status: enumValue(
      stringColumn(row, "status"),
      ["active", "dismissed", "resolved"] as const,
      "attention status",
    ),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function normalizeActivityInput(
  input: AppendKnowledgeSpaceActivityInput,
  id: string,
): KnowledgeSpaceActivityEvent {
  if (
    !input.tenantId ||
    !input.knowledgeSpaceId ||
    !id ||
    Number.isNaN(Date.parse(input.occurredAt))
  ) {
    throw new Error("Knowledge-space activity scope is invalid");
  }
  if (!KnowledgeSpaceActivityActions.includes(input.action))
    throw new Error("Unknown activity action");
  if (!KnowledgeSpaceActivityResourceTypes.includes(input.resource.type)) {
    throw new Error("Unknown activity resource type");
  }
  if (!KnowledgeSpaceActivityResults.includes(input.result))
    throw new Error("Unknown activity result");
  if (input.actor.type === "member" && !input.actor.id)
    throw new Error("Member actor id is required");
  const scope = candidatePermissionScopeSnapshot(input.requiredPermissionScope);
  if (!scope) throw new Error("Activity permission scope is invalid");
  return {
    ...input,
    actor: { ...input.actor },
    details: sanitizeKnowledgeSpaceActivityDetails(input.details),
    id,
    requiredPermissionScope: scope,
    resource: { ...input.resource },
  };
}

function sameActivity(left: KnowledgeSpaceActivityEvent, right: KnowledgeSpaceActivityEvent) {
  const { occurredAt: _leftOccurredAt, ...leftIdentity } = left;
  const { occurredAt: _rightOccurredAt, ...rightIdentity } = right;
  return stableJson(leftIdentity) === stableJson(rightIdentity);
}

function component(state: KnowledgeSpaceHealthState, codes: readonly string[]) {
  return { codes, state };
}

function severityRank(severity: KnowledgeSpaceAttentionIssue["severity"]) {
  return severity === "critical" ? 0 : severity === "warning" ? 1 : 2;
}

function validateLimit(limit: number, max: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Overview limit must be positive");
  if (limit > max) throw new KnowledgeSpaceOverviewLimitError(max);
}

function enumValue<const T extends readonly string[]>(
  value: string,
  values: T,
  name: string,
): T[number] {
  if (!(values as readonly string[]).includes(value)) throw new Error(`Unknown ${name}`);
  return value as T[number];
}

function q(database: DatabaseAdapter, value: string) {
  return quoteDatabaseIdentifier(database, value);
}

function p(database: DatabaseAdapter, position: number) {
  return databasePlaceholder(database, position);
}

function jsonP(database: DatabaseAdapter, position: number) {
  return jsonInsertPlaceholder(database, position, undefined);
}

function permissionScopeSql(database: DatabaseAdapter, column: string, grants: string) {
  return database.dialect === "postgres"
    ? `(jsonb_typeof(${column}) = 'array' AND ${grants}::jsonb @> ${column})`
    : `(JSON_TYPE(${column}) = 'ARRAY' AND JSON_CONTAINS(CAST(${grants} AS JSON), ${column}))`;
}

function assetPermissionSql(database: DatabaseAdapter, alias: string, grants: string) {
  const metadata = `${alias}.${q(database, "metadata")}`;
  return database.dialect === "postgres"
    ? `(NOT (${metadata} ? 'permissionScope') OR (jsonb_typeof(${metadata} -> 'permissionScope') = 'array' AND ${grants}::jsonb @> (${metadata} -> 'permissionScope')))`
    : `(JSON_CONTAINS_PATH(${metadata}, 'one', '$.permissionScope') = 0 OR (JSON_TYPE(JSON_EXTRACT(${metadata}, '$.permissionScope')) = 'ARRAY' AND JSON_CONTAINS(CAST(${grants} AS JSON), JSON_EXTRACT(${metadata}, '$.permissionScope'))))`;
}

function documentHealthCountSql(
  database: DatabaseAdapter,
  status: "failed" | "ready",
  activeRevision: boolean,
) {
  const revisionMatch = activeRevision
    ? `revision.${q(database, "revision")} = document.${q(database, "active_revision")} AND revision.${q(database, "state")} = 'active'`
    : `revision.${q(database, "revision")} = (SELECT MAX(candidate.${q(database, "revision")}) FROM ${q(database, "document_revisions")} candidate WHERE candidate.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND candidate.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND candidate.${q(database, "document_id")} = document.${q(database, "id")})`;
  return `SELECT ${countAll(database)} FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND ${revisionMatch} JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE document.${q(database, "tenant_id")} = ${p(database, 1)} AND document.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND document.${q(database, "status")} = '${status}' AND ${assetPermissionSql(database, "asset", p(database, 3))}`;
}

function countAll(database: DatabaseAdapter) {
  return database.dialect === "postgres" ? "CAST(COUNT(*) AS INTEGER)" : "CAST(COUNT(*) AS SIGNED)";
}

function countCase(database: DatabaseAdapter, predicate: string) {
  return database.dialect === "postgres"
    ? `CAST(COALESCE(SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END), 0) AS INTEGER)`
    : `CAST(COALESCE(SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END), 0) AS SIGNED)`;
}

function countDistinctCase(database: DatabaseAdapter, predicate: string, value: string) {
  return database.dialect === "postgres"
    ? `CAST(COUNT(DISTINCT CASE WHEN ${predicate} THEN ${value} ELSE NULL END) AS INTEGER)`
    : `CAST(COUNT(DISTINCT CASE WHEN ${predicate} THEN ${value} ELSE NULL END) AS SIGNED)`;
}

function answerPredicate(database: DatabaseAdapter, sincePosition: number) {
  return `event.${q(database, "action")} = 'query.requested' AND event.${q(database, "occurred_at")} >= ${p(database, sincePosition)} AND (EXISTS (SELECT 1 FROM ${q(database, "answer_traces")} answer_trace WHERE answer_trace.${q(database, "knowledge_space_id")} = event.${q(database, "knowledge_space_id")} AND ${textIdSql(database, "answer_trace", "id")} = event.${q(database, "resource_id")} AND answer_trace.${q(database, "subject_id")} = event.${q(database, "actor_subject_id")} AND answer_trace.${q(database, "completed")} = TRUE AND answer_trace.${q(database, "created_at")} >= event.${q(database, "occurred_at")}) OR EXISTS (SELECT 1 FROM ${q(database, "knowledge_space_activity_events")} terminal WHERE terminal.${q(database, "tenant_id")} = event.${q(database, "tenant_id")} AND terminal.${q(database, "knowledge_space_id")} = event.${q(database, "knowledge_space_id")} AND terminal.${q(database, "resource_id")} = event.${q(database, "resource_id")} AND terminal.${q(database, "action")} = 'query.completed' AND terminal.${q(database, "result")} = 'success' AND terminal.${q(database, "occurred_at")} >= event.${q(database, "occurred_at")}))`;
}

/**
 * AnswerTrace is the durable terminal fact for a query. Explicit terminal activity writes remain
 * useful for compatibility, but this read model reconstructs them after a crash between the
 * AnswerTrace transaction and the best-effort activity callback.
 */
function activityReadModelSql(database: DatabaseAdapter): string {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "actor_type",
    "actor_subject_id",
    "action",
    "resource_type",
    "resource_id",
    "result",
    "required_permission_scope",
    "details",
    "occurred_at",
  ] as const;
  const selectColumns = (alias: string) =>
    columns.map((column) => `${alias}.${q(database, column)}`).join(", ");
  const activity = q(database, "knowledge_space_activity_events");
  const traces = q(database, "answer_traces");

  return `SELECT ${selectColumns("stored_event")} FROM ${activity} stored_event WHERE NOT (stored_event.${q(database, "action")} IN ('query.completed', 'query.failed') AND EXISTS (SELECT 1 FROM ${traces} stored_trace WHERE stored_trace.${q(database, "knowledge_space_id")} = stored_event.${q(database, "knowledge_space_id")} AND ${textIdSql(database, "stored_trace", "id")} = stored_event.${q(database, "resource_id")} AND EXISTS (SELECT 1 FROM ${activity} stored_request WHERE stored_request.${q(database, "tenant_id")} = stored_event.${q(database, "tenant_id")} AND stored_request.${q(database, "knowledge_space_id")} = stored_event.${q(database, "knowledge_space_id")} AND stored_request.${q(database, "resource_id")} = stored_event.${q(database, "resource_id")} AND stored_request.${q(database, "actor_subject_id")} = stored_trace.${q(database, "subject_id")} AND stored_request.${q(database, "action")} = 'query.requested' AND stored_trace.${q(database, "created_at")} >= stored_request.${q(database, "occurred_at")}))) UNION ALL SELECT terminal_trace.${q(database, "id")} AS ${q(database, "id")}, requested.${q(database, "tenant_id")}, requested.${q(database, "knowledge_space_id")}, requested.${q(database, "actor_type")}, requested.${q(database, "actor_subject_id")}, CASE WHEN terminal_trace.${q(database, "completed")} = TRUE THEN 'query.completed' ELSE 'query.failed' END AS ${q(database, "action")}, requested.${q(database, "resource_type")}, requested.${q(database, "resource_id")}, CASE WHEN terminal_trace.${q(database, "completed")} = TRUE THEN 'success' ELSE 'failure' END AS ${q(database, "result")}, requested.${q(database, "required_permission_scope")}, requested.${q(database, "details")}, terminal_trace.${q(database, "created_at")} AS ${q(database, "occurred_at")} FROM ${traces} terminal_trace INNER JOIN ${activity} requested ON requested.${q(database, "knowledge_space_id")} = terminal_trace.${q(database, "knowledge_space_id")} AND requested.${q(database, "resource_id")} = ${textIdSql(database, "terminal_trace", "id")} AND requested.${q(database, "actor_subject_id")} = terminal_trace.${q(database, "subject_id")} AND requested.${q(database, "action")} = 'query.requested' AND requested.${q(database, "resource_type")} = 'query' AND terminal_trace.${q(database, "created_at")} >= requested.${q(database, "occurred_at")}`;
}

function textIdSql(database: DatabaseAdapter, alias: string, column: string): string {
  const identifier = `${alias}.${q(database, column)}`;
  return database.dialect === "postgres" ? `CAST(${identifier} AS TEXT)` : identifier;
}

function emptyActivityRow(): DatabaseRow {
  return {
    answers_24h: 0,
    answers_30d: 0,
    answers_7d: 0,
    queries_24h: 0,
    queries_30d: 0,
    queries_7d: 0,
  };
}
