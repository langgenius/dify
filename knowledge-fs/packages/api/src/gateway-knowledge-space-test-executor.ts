import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";

interface KnowledgeSpaceRow {
  created_at: string;
  description?: null | string;
  icon_ref?: null | string;
  id: string;
  name: string;
  revision: number;
  slug: string;
  tenant_id: string;
  updated_at: string;
}

export function createFakeKnowledgeSpaceExecutor(
  initialRows: readonly KnowledgeSpaceRow[] = [],
  options: { readonly returnRowsForWrites?: boolean } = {},
) {
  const returnRowsForWrites = options.returnRowsForWrites ?? true;
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
  const activities = new Map<string, Record<string, unknown>>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });
    if (
      input.operation === "select" &&
      input.tableName === "knowledge_space_permission_snapshots"
    ) {
      const [tenantId, knowledgeSpaceId, snapshotId] = input.params;
      const row = {
        access_channel: "interactive",
        access_policy_revision: 1,
        api_access_revision: 1,
        api_key_expires_at: null,
        api_key_id: null,
        api_key_revision: null,
        created_at: "2026-05-09T09:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        id: snapshotId,
        knowledge_space_id: knowledgeSpaceId,
        member_revision: 1,
        permission_scopes: [],
        revision: 1,
        revoked_at: null,
        role: "editor",
        status: "active",
        subject_id: "editor-1",
        tenant_id: tenantId,
        updated_at: "2026-05-09T09:00:00.000Z",
        visibility: "all_members",
      };
      return { rows: [row], rowsAffected: 1 };
    }
    if (
      input.operation === "select" &&
      (input.tableName === "knowledge_space_members" ||
        input.tableName === "knowledge_space_access_policies" ||
        input.tableName === "knowledge_space_api_access")
    ) {
      return { rows: [{ id: `locked-${input.tableName}` }], rowsAffected: 1 };
    }
    if (input.operation === "select" && input.tableName === "deletion_jobs") {
      return { rows: [], rowsAffected: 0 };
    }
    if (input.operation === "insert" && input.tableName === "knowledge_space_activity_events") {
      const [
        id,
        tenantId,
        knowledgeSpaceId,
        actorType,
        actorSubjectId,
        action,
        resourceType,
        resourceId,
        result,
        requiredPermissionScope,
        details,
        occurredAt,
      ] = input.params;
      if (!activities.has(String(id))) {
        activities.set(String(id), {
          action,
          actor_subject_id: actorSubjectId,
          actor_type: actorType,
          details,
          id,
          knowledge_space_id: knowledgeSpaceId,
          occurred_at: occurredAt,
          required_permission_scope: requiredPermissionScope,
          resource_id: resourceId,
          resource_type: resourceType,
          result,
          tenant_id: tenantId,
        });
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (input.operation === "select" && input.tableName === "knowledge_space_activity_events") {
      const [tenantId, knowledgeSpaceId, id] = input.params;
      const row = activities.get(String(id));
      const selected =
        row && row.tenant_id === tenantId && row.knowledge_space_id === knowledgeSpaceId
          ? [{ ...row }]
          : [];
      return { rows: selected, rowsAffected: selected.length };
    }
    if (input.operation === "insert") {
      const [id, tenantId, slug, name, description, iconRef, revision, createdAt, updatedAt] =
        input.params;
      const row = {
        created_at: String(createdAt),
        description: description === null ? null : String(description),
        icon_ref: iconRef === null ? null : String(iconRef),
        id: String(id),
        name: String(name),
        revision: Number(revision),
        slug: String(slug),
        tenant_id: String(tenantId),
        updated_at: String(updatedAt),
      };
      rows.set(row.id, row);
      return { rows: returnRowsForWrites ? [{ ...row }] : [], rowsAffected: 1 };
    }
    if (input.operation === "update") {
      const [
        name,
        slug,
        description,
        iconRef,
        revision,
        updatedAt,
        tenantId,
        id,
        expectedRevision,
      ] = input.params;
      const row = rows.get(String(id));
      if (!row || row.tenant_id !== tenantId || row.revision !== expectedRevision) {
        return { rows: [], rowsAffected: 0 };
      }
      const updated = {
        ...row,
        description: description === null ? null : String(description),
        icon_ref: iconRef === null ? null : String(iconRef),
        name: String(name),
        revision: Number(revision),
        slug: String(slug),
        updated_at: String(updatedAt),
      };
      rows.set(updated.id, updated);
      return { rows: returnRowsForWrites ? [{ ...updated }] : [], rowsAffected: 1 };
    }
    if (input.operation === "delete") {
      const [tenantId, id] = input.params;
      const row = rows.get(String(id));
      if (!row || row.tenant_id !== tenantId) return { rows: [], rowsAffected: 0 };
      rows.delete(row.id);
      return { rows: [], rowsAffected: 1 };
    }
    if (input.sql.includes("ORDER BY")) {
      const [tenantId, maybeCursor, maybeLimit] = input.params;
      const hasCursor = typeof maybeLimit === "number";
      const cursor = hasCursor ? String(maybeCursor) : undefined;
      const limit = Number(hasCursor ? maybeLimit : maybeCursor);
      const selected = [...rows.values()]
        .filter((row) => row.tenant_id === tenantId)
        .filter((row) => (cursor ? row.slug > cursor : true))
        .sort((first, second) => first.slug.localeCompare(second.slug))
        .slice(0, limit)
        .map((row) => ({ ...row }));
      return { rows: selected, rowsAffected: selected.length };
    }
    if (input.sql.includes('"slug" =') || input.sql.includes("`slug` =")) {
      const [tenantId, slug] = input.params;
      const selected = [...rows.values()]
        .filter((row) => row.tenant_id === tenantId && row.slug === slug)
        .slice(0, input.maxRows)
        .map((row) => ({ ...row }));
      return { rows: selected, rowsAffected: selected.length };
    }
    if (input.sql.includes('"id" =') || input.sql.includes("`id` =")) {
      const [tenantId, id] = input.params;
      const row = rows.get(String(id));
      const selected =
        row && row.tenant_id === tenantId
          ? [{ ...row, deletion_job_id: null, lifecycle_state: "active" }]
          : [];
      return { rows: selected, rowsAffected: selected.length };
    }
    return { rows: [], rowsAffected: 0 };
  };
  return { calls, executor, rows };
}
