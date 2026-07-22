import { createHash, randomUUID } from "node:crypto";

import {
  type CommandCostEstimate,
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type EvidenceBundle,
  EvidenceBundleSchema,
  type ResourceMount,
  ResourceMountSchema,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import { normalizeKnowledgeFsPath } from "./knowledge-fs-path-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export interface AgentWorkspaceSnapshot {
  readonly commandLog: readonly AgentWorkspaceSnapshotCommand[];
  readonly createdAt: string;
  readonly evidenceBundles: readonly EvidenceBundle[];
  readonly fingerprint: string;
  readonly id: string;
  readonly indexProjection: AgentWorkspaceSnapshotIndexProjection;
  readonly knowledgeSpaceId: string;
  readonly manifestVersion: number;
  readonly metadata: Record<string, unknown>;
  readonly mounts: readonly ResourceMount[];
  readonly pathVersions: readonly AgentWorkspaceSnapshotPathVersion[];
  readonly permissionSnapshot: AgentWorkspaceSnapshotPermission;
  readonly researchTaskJobId?: string | undefined;
  readonly sourceVersions: readonly AgentWorkspaceSnapshotSourceVersion[];
  readonly tenantId: string;
  readonly traceIds: readonly string[];
}

export interface AgentWorkspaceSnapshotCommand {
  readonly command: string;
  readonly completedAt?: string | undefined;
  readonly cost?: CommandCostEstimate | undefined;
  readonly input: Record<string, unknown>;
  readonly outputSummary?: string | undefined;
  readonly startedAt: string;
}

export interface AgentWorkspaceSnapshotIndexProjection {
  readonly fingerprint: string;
  readonly projectionIds: readonly string[];
}

export interface AgentWorkspaceSnapshotPermission {
  readonly accessChannel?: "agent" | "interactive" | "mcp" | "service_api" | undefined;
  readonly id?: string | undefined;
  readonly revision?: number | undefined;
  readonly scopes: string[];
  readonly subjectId: string;
  readonly tenantId: string;
}

export interface AgentWorkspaceSnapshotSourceVersion {
  readonly provider: string;
  readonly providerResourceKey: string;
  readonly version: string;
}

export interface AgentWorkspaceSnapshotPathVersion {
  readonly version: string;
  readonly virtualPath: string;
}

export interface BuildAgentWorkspaceSnapshotFingerprintInput {
  readonly manifestVersion: number;
  readonly pathVersions: readonly AgentWorkspaceSnapshotPathVersion[];
  readonly permissionSnapshot: AgentWorkspaceSnapshotPermission;
  readonly projectionFingerprint: string;
  readonly sourceVersions: readonly AgentWorkspaceSnapshotSourceVersion[];
}

export interface CreateAgentWorkspaceSnapshotInput {
  readonly commandLog: readonly AgentWorkspaceSnapshotCommand[];
  readonly evidenceBundles: readonly EvidenceBundle[];
  readonly id: string;
  readonly indexProjection: AgentWorkspaceSnapshotIndexProjection;
  readonly knowledgeSpaceId: string;
  readonly manifestVersion?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly mounts: readonly ResourceMount[];
  readonly pathVersions?: readonly AgentWorkspaceSnapshotPathVersion[] | undefined;
  readonly permissionSnapshot: AgentWorkspaceSnapshotPermission;
  readonly researchTaskJobId?: string | undefined;
  readonly sourceVersions: readonly AgentWorkspaceSnapshotSourceVersion[];
  readonly tenantId: string;
  readonly traceIds: readonly string[];
}

export interface AgentWorkspaceSnapshotLookupInput {
  readonly id: string;
  readonly tenantId: string;
}

export interface AgentWorkspaceSnapshotSpaceCleanupInput {
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly tenantId: string;
}

export interface InvalidateAgentWorkspaceSnapshotsInput
  extends AgentWorkspaceSnapshotSpaceCleanupInput {
  readonly invalidatedAt: string;
  readonly reason: string;
}

export interface AgentWorkspaceSnapshotCleanupPage {
  readonly complete: boolean;
  readonly processed: number;
}

export interface AgentWorkspaceSnapshotRepository {
  create(input: CreateAgentWorkspaceSnapshotInput): Promise<AgentWorkspaceSnapshot>;
  deleteInvalidatedByKnowledgeSpace(
    input: AgentWorkspaceSnapshotSpaceCleanupInput,
  ): Promise<AgentWorkspaceSnapshotCleanupPage>;
  get(input: AgentWorkspaceSnapshotLookupInput): Promise<AgentWorkspaceSnapshot | null>;
  invalidateByKnowledgeSpace(
    input: InvalidateAgentWorkspaceSnapshotsInput,
  ): Promise<AgentWorkspaceSnapshotCleanupPage>;
}

export type AgentWorkspaceReplayCommandStatus = "changed" | "failed" | "matched";

export interface AgentWorkspaceReplay {
  readonly commands: readonly AgentWorkspaceReplayCommandResult[];
  readonly completedAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly snapshotId: string;
  readonly startedAt: string;
  readonly summary: AgentWorkspaceReplaySummary;
  readonly tenantId: string;
  readonly traceId?: string | undefined;
}

export interface AgentWorkspaceReplaySummary {
  readonly changed: number;
  readonly failed: number;
  readonly matched: number;
  readonly total: number;
}

export interface AgentWorkspaceReplayCommandResult {
  readonly command: string;
  readonly commandIndex: number;
  readonly completedAt: string;
  readonly error?: string | undefined;
  readonly input: Record<string, unknown>;
  readonly originalOutputSummary?: string | undefined;
  readonly replayedOutputSummary?: string | undefined;
  readonly startedAt: string;
  readonly status: AgentWorkspaceReplayCommandStatus;
}

export interface AgentWorkspaceReplayInput {
  readonly id: string;
  /** Fresh, server-authorized caller grants. Persisted creator grants are never replayed. */
  readonly permissionSnapshot: AgentWorkspaceSnapshotPermission;
  readonly snapshotFingerprint?: string | undefined;
  readonly tenantId: string;
  readonly traceId?: string | undefined;
}

export interface AgentWorkspaceReplayRunner {
  run(input: AgentWorkspaceReplayRunnerInput): Promise<AgentWorkspaceReplayRunnerOutput>;
}

export interface AgentWorkspaceReplayRunnerInput {
  readonly command: AgentWorkspaceSnapshotCommand;
  readonly commandIndex: number;
  readonly snapshot: AgentWorkspaceSnapshot;
  readonly traceId?: string | undefined;
}

export interface AgentWorkspaceReplayRunnerOutput {
  readonly outputSummary?: string | undefined;
}

export interface AgentWorkspaceReplayService {
  replay(input: AgentWorkspaceReplayInput): Promise<AgentWorkspaceReplay | null>;
}

export interface AgentWorkspaceReplayServiceOptions {
  readonly generateId?: () => string;
  readonly maxCommands: number;
  readonly maxOutputSummaryBytes: number;
  readonly now?: () => string;
  readonly runner: AgentWorkspaceReplayRunner;
  readonly snapshots: AgentWorkspaceSnapshotRepository;
}

export interface InMemoryAgentWorkspaceSnapshotRepositoryOptions {
  readonly maxCommandLogEntries: number;
  readonly maxEvidenceBundles: number;
  readonly maxMounts: number;
  readonly maxPathVersions?: number | undefined;
  readonly maxSnapshots: number;
  readonly maxSourceVersions: number;
  readonly now?: () => string;
}

export interface DatabaseAgentWorkspaceSnapshotRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxCommandLogEntries: number;
  readonly maxEvidenceBundles: number;
  readonly maxMounts: number;
  readonly maxPathVersions?: number | undefined;
  readonly maxSourceVersions: number;
  readonly now?: () => string;
}

export function createInMemoryAgentWorkspaceSnapshotRepository({
  maxCommandLogEntries,
  maxEvidenceBundles,
  maxMounts,
  maxSnapshots,
  maxSourceVersions,
  maxPathVersions = maxSourceVersions,
  now = () => new Date().toISOString(),
}: InMemoryAgentWorkspaceSnapshotRepositoryOptions): AgentWorkspaceSnapshotRepository {
  validatePositive(maxSnapshots, "maxSnapshots");
  validatePositive(maxMounts, "maxMounts");
  validatePositive(maxPathVersions, "maxPathVersions");
  validatePositive(maxSourceVersions, "maxSourceVersions");
  validatePositive(maxCommandLogEntries, "maxCommandLogEntries");
  validatePositive(maxEvidenceBundles, "maxEvidenceBundles");

  const snapshots = new Map<
    string,
    {
      readonly snapshot: AgentWorkspaceSnapshot;
      invalidatedAt?: string | undefined;
      invalidationReason?: string | undefined;
    }
  >();

  return {
    create: async (input) => {
      if (!snapshots.has(input.id) && snapshots.size >= maxSnapshots) {
        throw new Error(
          `Agent workspace snapshot repository maxSnapshots=${maxSnapshots} exceeded`,
        );
      }

      const snapshot = normalizeSnapshotInput(input, {
        maxCommandLogEntries,
        maxEvidenceBundles,
        maxMounts,
        maxPathVersions,
        maxSourceVersions,
        now,
      });
      snapshots.set(snapshot.id, { snapshot });

      return cloneSnapshot(snapshot);
    },
    deleteInvalidatedByKnowledgeSpace: async ({ knowledgeSpaceId, limit, tenantId }) => {
      validatePositive(limit, "cleanup limit");
      const matches = [...snapshots.entries()]
        .filter(
          ([, entry]) =>
            entry.snapshot.tenantId === tenantId &&
            entry.snapshot.knowledgeSpaceId === knowledgeSpaceId &&
            entry.invalidatedAt !== undefined,
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit);
      for (const [id] of matches) snapshots.delete(id);
      return { complete: matches.length < limit, processed: matches.length };
    },
    get: async ({ id, tenantId }) => {
      const entry = snapshots.get(id);

      if (!entry || entry.snapshot.tenantId !== tenantId || entry.invalidatedAt !== undefined) {
        return null;
      }

      return cloneSnapshot(entry.snapshot);
    },
    invalidateByKnowledgeSpace: async ({
      invalidatedAt,
      knowledgeSpaceId,
      limit,
      reason,
      tenantId,
    }) => {
      validatePositive(limit, "cleanup limit");
      const timestamp = requiredString(invalidatedAt, "invalidatedAt");
      const invalidationReason = requiredString(reason, "invalidation reason");
      const matches = [...snapshots.entries()]
        .filter(
          ([, entry]) =>
            entry.snapshot.tenantId === tenantId &&
            entry.snapshot.knowledgeSpaceId === knowledgeSpaceId &&
            entry.invalidatedAt === undefined,
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit);
      for (const [, entry] of matches) {
        entry.invalidatedAt = timestamp;
        entry.invalidationReason = invalidationReason;
      }
      return { complete: matches.length < limit, processed: matches.length };
    },
  };
}

/**
 * Multi-replica repository for production Agent workspaces. Authorization provenance is stored in
 * scalar columns rather than only inside the opaque payload, and invalidated rows are excluded by
 * the database predicate so GET/replay cannot observe a replica-local stale snapshot.
 */
export function createDatabaseAgentWorkspaceSnapshotRepository({
  database,
  maxCommandLogEntries,
  maxEvidenceBundles,
  maxMounts,
  maxSourceVersions,
  maxPathVersions = maxSourceVersions,
  now = () => new Date().toISOString(),
}: DatabaseAgentWorkspaceSnapshotRepositoryOptions): AgentWorkspaceSnapshotRepository {
  validatePositive(maxMounts, "maxMounts");
  validatePositive(maxPathVersions, "maxPathVersions");
  validatePositive(maxSourceVersions, "maxSourceVersions");
  validatePositive(maxCommandLogEntries, "maxCommandLogEntries");
  validatePositive(maxEvidenceBundles, "maxEvidenceBundles");
  const bounds = {
    maxCommandLogEntries,
    maxEvidenceBundles,
    maxMounts,
    maxPathVersions,
    maxSourceVersions,
  } as const;
  const tableName = "agent_workspace_snapshots";
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);

  return {
    async create(input) {
      const snapshot = normalizeSnapshotInput(input, { ...bounds, now });
      const permission = requireDurableWorkspacePermission(snapshot.permissionSnapshot);
      const params = [
        snapshot.id,
        snapshot.tenantId,
        snapshot.knowledgeSpaceId,
        permission.subjectId,
        permission.accessChannel,
        permission.id,
        permission.revision,
        JSON.stringify(permission.scopes),
        snapshot.fingerprint,
        JSON.stringify(agentWorkspaceSnapshotPayload(snapshot)),
        snapshot.createdAt,
      ] satisfies readonly DatabaseQueryValue[];
      const columns = [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "subject_id",
        "access_channel",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        "permission_scopes",
        "fingerprint",
        "payload",
        "created_at",
      ];
      const values = columns.map((column, index) =>
        column === "permission_scopes" || column === "payload"
          ? jsonInsertPlaceholder(database, index + 1, column)
          : p(index + 1),
      );
      const result = await database.transaction(async (transaction) => {
        if (
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId: snapshot.knowledgeSpaceId,
            tenantId: snapshot.tenantId,
          }))
        ) {
          return { rows: [], rowsAffected: 0 } as const;
        }
        return transaction.execute({
          maxRows: 1,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(tableName)} (${columns.map(q).join(", ")}) SELECT ${values.join(", ")} FROM ${q("knowledge_space_permission_snapshots")} AS workspace_permission WHERE workspace_permission.${q("tenant_id")} = ${p(2)} AND workspace_permission.${q("knowledge_space_id")} = ${p(3)} AND workspace_permission.${q("id")} = ${p(6)} AND workspace_permission.${q("subject_id")} = ${p(4)} AND workspace_permission.${q("access_channel")} = ${p(5)} AND workspace_permission.${q("revision")} = ${p(7)} AND workspace_permission.${q("status")} = 'active' AND workspace_permission.${q("expires_at")} > ${p(11)}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
      });
      if (result.rowsAffected !== 1 && result.rows.length !== 1) {
        throw new Error(
          "Agent workspace snapshot permission or knowledge-space lifecycle is no longer active",
        );
      }
      return result.rows[0]
        ? mapDatabaseAgentWorkspaceSnapshot(result.rows[0], bounds)
        : cloneSnapshot(snapshot);
    },
    async deleteInvalidatedByKnowledgeSpace({ knowledgeSpaceId, limit, tenantId }) {
      validatePositive(limit, "cleanup limit");
      const ids = await selectWorkspaceSnapshotIds(database, {
        invalidated: true,
        knowledgeSpaceId,
        limit,
        tenantId,
      });
      await deleteWorkspaceSnapshotIds(database, ids);
      return { complete: ids.length < limit, processed: ids.length };
    },
    async get({ id, tenantId }) {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [tenantId, id],
        sql: `SELECT * FROM ${q(tableName)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${q("invalidated_at")} IS NULL AND NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS active_deletion WHERE active_deletion.${q("tenant_id")} = ${q(tableName)}.${q("tenant_id")} AND active_deletion.${q("knowledge_space_id")} = ${q(tableName)}.${q("knowledge_space_id")} AND active_deletion.${q("active_slot")} = 1) LIMIT 1;`,
        tableName,
      });
      return result.rows[0] ? mapDatabaseAgentWorkspaceSnapshot(result.rows[0], bounds) : null;
    },
    async invalidateByKnowledgeSpace({ invalidatedAt, knowledgeSpaceId, limit, reason, tenantId }) {
      validatePositive(limit, "cleanup limit");
      const timestamp = requiredString(invalidatedAt, "invalidatedAt");
      const invalidationReason = requiredString(reason, "invalidation reason");
      const ids = await selectWorkspaceSnapshotIds(database, {
        invalidated: false,
        knowledgeSpaceId,
        limit,
        tenantId,
      });
      if (ids.length > 0) {
        const placeholders = ids.map((_, index) => p(index + 3)).join(", ");
        await database.execute({
          maxRows: 0,
          operation: "update",
          params: [timestamp, invalidationReason, ...ids],
          sql: `UPDATE ${q(tableName)} SET ${q("invalidated_at")} = ${p(1)}, ${q("invalidation_reason")} = ${p(2)} WHERE ${q("id")} IN (${placeholders}) AND ${q("invalidated_at")} IS NULL;`,
          tableName,
        });
      }
      return { complete: ids.length < limit, processed: ids.length };
    },
  };
}

export function buildAgentWorkspaceSnapshotFingerprint(
  input: BuildAgentWorkspaceSnapshotFingerprintInput,
): string {
  const manifestVersion = normalizeManifestVersion(input.manifestVersion);
  const permissionSnapshot = normalizePermissionSnapshot(input.permissionSnapshot);
  const pathVersions = normalizePathVersions(input.pathVersions);
  const projectionFingerprint = requiredString(
    input.projectionFingerprint,
    "projectionFingerprint",
  );
  const sourceVersions = normalizeSourceVersions(input.sourceVersions);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        manifestVersion,
        pathVersions,
        permissionSnapshot,
        projectionFingerprint,
        sourceVersions,
      }),
    )
    .digest("hex");

  return `snapshot-sha256:${digest}`;
}

export function createAgentWorkspaceReplayService({
  generateId = randomUUID,
  maxCommands,
  maxOutputSummaryBytes,
  now = () => new Date().toISOString(),
  runner,
  snapshots,
}: AgentWorkspaceReplayServiceOptions): AgentWorkspaceReplayService {
  validateReplayPositive(maxCommands, "maxCommands");
  validateReplayPositive(maxOutputSummaryBytes, "maxOutputSummaryBytes");

  return {
    replay: async ({ id, permissionSnapshot, snapshotFingerprint, tenantId, traceId }) => {
      const snapshot = await snapshots.get({ id, tenantId });

      if (!snapshot) {
        return null;
      }

      if (snapshotFingerprint && snapshot.fingerprint !== snapshotFingerprint) {
        return null;
      }
      const replayPermissionSnapshot = normalizePermissionSnapshot(permissionSnapshot);
      if (replayPermissionSnapshot.tenantId !== tenantId) {
        throw new Error("Agent workspace replay permission tenant does not match request tenant");
      }
      const replaySnapshot: AgentWorkspaceSnapshot = {
        ...snapshot,
        permissionSnapshot: replayPermissionSnapshot,
      };

      if (snapshot.commandLog.length > maxCommands) {
        throw new Error(`Agent workspace replay commandLog exceeds maxCommands=${maxCommands}`);
      }

      const startedAt = now();
      const commands: AgentWorkspaceReplayCommandResult[] = [];

      for (const [commandIndex, command] of snapshot.commandLog.entries()) {
        const commandStartedAt = now();
        const originalOutputSummary = boundedReplaySummary(
          command.outputSummary,
          maxOutputSummaryBytes,
        );

        try {
          const output = await runner.run({
            command,
            commandIndex,
            snapshot: replaySnapshot,
            ...(traceId ? { traceId } : {}),
          });
          const replayedOutputSummary = boundedReplaySummary(
            output.outputSummary,
            maxOutputSummaryBytes,
          );
          const status =
            (originalOutputSummary ?? "") === (replayedOutputSummary ?? "") ? "matched" : "changed";
          commands.push({
            command: command.command,
            commandIndex,
            completedAt: now(),
            input: cloneJson(command.input),
            ...(originalOutputSummary !== undefined ? { originalOutputSummary } : {}),
            ...(replayedOutputSummary !== undefined ? { replayedOutputSummary } : {}),
            startedAt: commandStartedAt,
            status,
          });
        } catch (error) {
          commands.push({
            command: command.command,
            commandIndex,
            completedAt: now(),
            error: error instanceof Error ? error.message : "Agent workspace replay command failed",
            input: cloneJson(command.input),
            ...(originalOutputSummary !== undefined ? { originalOutputSummary } : {}),
            startedAt: commandStartedAt,
            status: "failed",
          });
        }
      }

      const summary = summarizeReplayCommands(commands);
      const replay: AgentWorkspaceReplay = {
        commands,
        completedAt: now(),
        id: generateId(),
        knowledgeSpaceId: snapshot.knowledgeSpaceId,
        snapshotId: snapshot.id,
        startedAt,
        summary,
        tenantId: snapshot.tenantId,
        ...(traceId ? { traceId } : {}),
      };

      return cloneJson(replay);
    },
  };
}

function normalizeSnapshotInput(
  input: CreateAgentWorkspaceSnapshotInput,
  {
    maxCommandLogEntries,
    maxEvidenceBundles,
    maxMounts,
    maxPathVersions,
    maxSourceVersions,
    now,
  }: {
    readonly maxCommandLogEntries: number;
    readonly maxEvidenceBundles: number;
    readonly maxMounts: number;
    readonly maxPathVersions: number;
    readonly maxSourceVersions: number;
    readonly now: () => string;
  },
): AgentWorkspaceSnapshot {
  const id = requiredString(input.id, "id");
  const tenantId = requiredString(input.tenantId, "tenantId");
  const knowledgeSpaceId = requiredString(input.knowledgeSpaceId, "knowledgeSpaceId");

  assertMaxLength(input.mounts, maxMounts, "mounts", "maxMounts");
  assertMaxLength(input.sourceVersions, maxSourceVersions, "sourceVersions", "maxSourceVersions");
  assertMaxLength(input.pathVersions ?? [], maxPathVersions, "pathVersions", "maxPathVersions");
  assertMaxLength(input.commandLog, maxCommandLogEntries, "commandLog", "maxCommandLogEntries");
  assertMaxLength(
    input.evidenceBundles,
    maxEvidenceBundles,
    "evidenceBundles",
    "maxEvidenceBundles",
  );

  const manifestVersion = normalizeManifestVersion(input.manifestVersion ?? 1);
  const pathVersions = normalizePathVersions(input.pathVersions ?? []);
  const permissionSnapshot = normalizePermissionSnapshot(input.permissionSnapshot);
  const sourceVersions = normalizeSourceVersions(input.sourceVersions);
  const projectionFingerprint = requiredString(
    input.indexProjection.fingerprint,
    "indexProjection.fingerprint",
  );

  return {
    commandLog: cloneJson(input.commandLog),
    createdAt: now(),
    evidenceBundles: input.evidenceBundles.map((bundle) =>
      EvidenceBundleSchema.parse(cloneJson(bundle)),
    ),
    fingerprint: buildAgentWorkspaceSnapshotFingerprint({
      manifestVersion,
      pathVersions,
      permissionSnapshot,
      projectionFingerprint,
      sourceVersions,
    }),
    id,
    indexProjection: {
      fingerprint: projectionFingerprint,
      projectionIds: [...input.indexProjection.projectionIds],
    },
    knowledgeSpaceId,
    manifestVersion,
    metadata: cloneJson(input.metadata ?? {}),
    mounts: input.mounts.map((mount) => ResourceMountSchema.parse(cloneJson(mount))),
    pathVersions,
    permissionSnapshot,
    ...(input.researchTaskJobId ? { researchTaskJobId: input.researchTaskJobId } : {}),
    sourceVersions,
    tenantId,
    traceIds: input.traceIds.map((traceId) => requiredString(traceId, "traceIds")),
  };
}

function normalizeManifestVersion(manifestVersion: number): number {
  if (!Number.isSafeInteger(manifestVersion) || manifestVersion < 1) {
    throw new Error("Agent workspace snapshot manifestVersion must be at least 1");
  }

  return manifestVersion;
}

function normalizePermissionSnapshot(
  permissionSnapshot: AgentWorkspaceSnapshotPermission,
): AgentWorkspaceSnapshotPermission {
  const hasDurableReference = [
    permissionSnapshot.accessChannel,
    permissionSnapshot.id,
    permissionSnapshot.revision,
  ].filter((value) => value !== undefined).length;
  if (hasDurableReference !== 0 && hasDurableReference !== 3) {
    throw new Error("Agent workspace permission durable reference is incomplete");
  }
  if (
    permissionSnapshot.accessChannel !== undefined &&
    !["agent", "interactive", "mcp", "service_api"].includes(permissionSnapshot.accessChannel)
  ) {
    throw new Error("Agent workspace permission access channel is invalid");
  }
  return {
    ...(permissionSnapshot.accessChannel
      ? { accessChannel: permissionSnapshot.accessChannel }
      : {}),
    ...(permissionSnapshot.id
      ? { id: requiredString(permissionSnapshot.id, "permissionSnapshot.id") }
      : {}),
    ...(permissionSnapshot.revision !== undefined
      ? { revision: normalizeManifestVersion(permissionSnapshot.revision) }
      : {}),
    scopes: uniqueStrings(permissionSnapshot.scopes.map((scope) => scope.trim()))
      .filter(Boolean)
      .sort(),
    subjectId: requiredString(permissionSnapshot.subjectId, "permissionSnapshot.subjectId"),
    tenantId: requiredString(permissionSnapshot.tenantId, "permissionSnapshot.tenantId"),
  };
}

function normalizePathVersions(
  pathVersions: readonly AgentWorkspaceSnapshotPathVersion[],
): AgentWorkspaceSnapshotPathVersion[] {
  return pathVersions
    .map((pathVersion) => ({
      version: requiredString(pathVersion.version, "pathVersions.version"),
      virtualPath: normalizeKnowledgeFsPath(
        requiredString(pathVersion.virtualPath, "pathVersions.virtualPath"),
      ),
    }))
    .sort((left, right) =>
      `${left.virtualPath}\0${left.version}`.localeCompare(
        `${right.virtualPath}\0${right.version}`,
      ),
    );
}

function normalizeSourceVersions(
  sourceVersions: readonly AgentWorkspaceSnapshotSourceVersion[],
): AgentWorkspaceSnapshotSourceVersion[] {
  return sourceVersions
    .map((version) => ({
      provider: requiredString(version.provider, "sourceVersions.provider"),
      providerResourceKey: requiredString(
        version.providerResourceKey,
        "sourceVersions.providerResourceKey",
      ),
      version: requiredString(version.version, "sourceVersions.version"),
    }))
    .sort((left, right) =>
      `${left.provider}\0${left.providerResourceKey}\0${left.version}`.localeCompare(
        `${right.provider}\0${right.providerResourceKey}\0${right.version}`,
      ),
    );
}

function validatePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Agent workspace snapshot repository ${label} must be at least 1`);
  }
}

function validateReplayPositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Agent workspace replay ${label} must be at least 1`);
  }
}

function boundedReplaySummary(
  value: string | undefined,
  maxOutputSummaryBytes: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (new TextEncoder().encode(value).byteLength > maxOutputSummaryBytes) {
    throw new Error(
      `Agent workspace replay output summary exceeds maxOutputSummaryBytes=${maxOutputSummaryBytes}`,
    );
  }

  return value;
}

function summarizeReplayCommands(
  commands: readonly AgentWorkspaceReplayCommandResult[],
): AgentWorkspaceReplaySummary {
  let changed = 0;
  let failed = 0;
  let matched = 0;

  for (const command of commands) {
    if (command.status === "changed") {
      changed += 1;
      continue;
    }

    if (command.status === "failed") {
      failed += 1;
      continue;
    }

    matched += 1;
  }

  return {
    changed,
    failed,
    matched,
    total: commands.length,
  };
}

function assertMaxLength(
  input: readonly unknown[],
  maxLength: number,
  label: string,
  maxLabel: string,
): void {
  if (input.length > maxLength) {
    throw new Error(`Agent workspace snapshot ${label} exceed ${maxLabel}=${maxLength}`);
  }
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Agent workspace snapshot ${label} is required`);
  }

  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function requireDurableWorkspacePermission(
  permission: AgentWorkspaceSnapshotPermission,
): AgentWorkspaceSnapshotPermission & {
  readonly accessChannel: NonNullable<AgentWorkspaceSnapshotPermission["accessChannel"]>;
  readonly id: string;
  readonly revision: number;
} {
  if (!permission.accessChannel || !permission.id || permission.revision === undefined) {
    throw new Error(
      "Database Agent workspace snapshots require exact durable permission provenance",
    );
  }
  return {
    ...permission,
    accessChannel: permission.accessChannel,
    id: permission.id,
    revision: permission.revision,
  };
}

function agentWorkspaceSnapshotPayload(snapshot: AgentWorkspaceSnapshot): Record<string, unknown> {
  return cloneJson({
    commandLog: snapshot.commandLog,
    evidenceBundles: snapshot.evidenceBundles,
    indexProjection: snapshot.indexProjection,
    manifestVersion: snapshot.manifestVersion,
    metadata: snapshot.metadata,
    mounts: snapshot.mounts,
    pathVersions: snapshot.pathVersions,
    ...(snapshot.researchTaskJobId ? { researchTaskJobId: snapshot.researchTaskJobId } : {}),
    sourceVersions: snapshot.sourceVersions,
    traceIds: snapshot.traceIds,
  });
}

function mapDatabaseAgentWorkspaceSnapshot(
  row: DatabaseRow,
  bounds: {
    readonly maxCommandLogEntries: number;
    readonly maxEvidenceBundles: number;
    readonly maxMounts: number;
    readonly maxPathVersions: number;
    readonly maxSourceVersions: number;
  },
): AgentWorkspaceSnapshot {
  const payload = jsonObjectColumn(row, "payload");
  const permissionSnapshot = {
    accessChannel: workspaceAccessChannel(stringColumn(row, "access_channel")),
    id: stringColumn(row, "permission_snapshot_id"),
    revision: numberColumn(row, "permission_snapshot_revision"),
    scopes: jsonStringArrayColumn(row, "permission_scopes"),
    subjectId: stringColumn(row, "subject_id"),
    tenantId: stringColumn(row, "tenant_id"),
  } satisfies AgentWorkspaceSnapshotPermission;
  const researchTaskJobId = optionalPayloadString(payload, "researchTaskJobId");
  const snapshot = normalizeSnapshotInput(
    {
      commandLog: requiredPayloadArray<AgentWorkspaceSnapshotCommand>(payload, "commandLog"),
      evidenceBundles: requiredPayloadArray<EvidenceBundle>(payload, "evidenceBundles"),
      id: stringColumn(row, "id"),
      indexProjection: requiredPayloadObject<AgentWorkspaceSnapshotIndexProjection>(
        payload,
        "indexProjection",
      ),
      knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
      manifestVersion: requiredPayloadNumber(payload, "manifestVersion"),
      metadata: requiredPayloadObject<Record<string, unknown>>(payload, "metadata"),
      mounts: requiredPayloadArray<ResourceMount>(payload, "mounts"),
      pathVersions: requiredPayloadArray<AgentWorkspaceSnapshotPathVersion>(
        payload,
        "pathVersions",
      ),
      permissionSnapshot,
      ...(researchTaskJobId ? { researchTaskJobId } : {}),
      sourceVersions: requiredPayloadArray<AgentWorkspaceSnapshotSourceVersion>(
        payload,
        "sourceVersions",
      ),
      tenantId: stringColumn(row, "tenant_id"),
      traceIds: requiredPayloadArray<string>(payload, "traceIds"),
    },
    { ...bounds, now: () => stringColumn(row, "created_at") },
  );
  const persistedFingerprint = stringColumn(row, "fingerprint");
  if (snapshot.fingerprint !== persistedFingerprint) {
    throw new Error("Agent workspace snapshot fingerprint does not match durable payload");
  }
  return snapshot;
}

function workspaceAccessChannel(
  value: string,
): NonNullable<AgentWorkspaceSnapshotPermission["accessChannel"]> {
  if (value === "agent" || value === "interactive" || value === "mcp" || value === "service_api") {
    return value;
  }
  throw new Error("Agent workspace snapshot durable access channel is invalid");
}

function requiredPayloadArray<T>(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): readonly T[] {
  const value = payload[field];
  if (!Array.isArray(value)) {
    throw new Error(`Agent workspace snapshot durable payload ${field} must be an array`);
  }
  return cloneJson(value) as readonly T[];
}

function requiredPayloadObject<T>(payload: Readonly<Record<string, unknown>>, field: string): T {
  const value = payload[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Agent workspace snapshot durable payload ${field} must be an object`);
  }
  return cloneJson(value) as T;
}

function requiredPayloadNumber(payload: Readonly<Record<string, unknown>>, field: string): number {
  const value = payload[field];
  if (typeof value !== "number") {
    throw new Error(`Agent workspace snapshot durable payload ${field} must be a number`);
  }
  return value;
}

function optionalPayloadString(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Agent workspace snapshot durable payload ${field} must be a string`);
  }
  return value;
}

async function selectWorkspaceSnapshotIds(
  database: DatabaseAdapter,
  input: AgentWorkspaceSnapshotSpaceCleanupInput & { readonly invalidated: boolean },
): Promise<readonly string[]> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await database.execute({
    maxRows: input.limit,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.limit],
    sql: `SELECT ${q("id")} FROM ${q("agent_workspace_snapshots")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("invalidated_at")} IS ${input.invalidated ? "NOT " : ""}NULL ORDER BY ${q("id")} ASC LIMIT ${p(3)};`,
    tableName: "agent_workspace_snapshots",
  });
  return result.rows.map((row) => stringColumn(row, "id"));
}

async function deleteWorkspaceSnapshotIds(
  database: DatabaseAdapter,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const placeholders = ids.map((_, index) => databasePlaceholder(database, index + 1)).join(", ");
  await database.execute({
    maxRows: 0,
    operation: "delete",
    params: ids,
    sql: `DELETE FROM ${q("agent_workspace_snapshots")} WHERE ${q("id")} IN (${placeholders}) AND ${q("invalidated_at")} IS NOT NULL;`,
    tableName: "agent_workspace_snapshots",
  });
}

function cloneSnapshot(snapshot: AgentWorkspaceSnapshot): AgentWorkspaceSnapshot {
  return cloneJson(snapshot);
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
