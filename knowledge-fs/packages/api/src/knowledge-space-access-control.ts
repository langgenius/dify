import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { deterministicKnowledgeSpaceActivityId } from "./knowledge-space-overview";
import { appendKnowledgeSpaceActivityWithExecutor } from "./knowledge-space-overview-database-repository";

export const KNOWLEDGE_SPACE_MEMBER_ROLES = ["owner", "editor", "viewer"] as const;
export type KnowledgeSpaceMemberRole = (typeof KNOWLEDGE_SPACE_MEMBER_ROLES)[number];

export const KNOWLEDGE_SPACE_VISIBILITIES = ["only_me", "all_members", "partial_members"] as const;
export type KnowledgeSpaceVisibility = (typeof KNOWLEDGE_SPACE_VISIBILITIES)[number];

export const KNOWLEDGE_SPACE_ACCESS_CHANNELS = [
  "interactive",
  "service_api",
  "mcp",
  "agent",
] as const;
export type KnowledgeSpaceAccessChannel = (typeof KNOWLEDGE_SPACE_ACCESS_CHANNELS)[number];

export interface KnowledgeSpaceAccessScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface DatabaseKnowledgeSpacePermissionFence extends KnowledgeSpaceAccessScope {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly requestedBySubjectId: string;
}

/**
 * Locks and revalidates the complete durable permission provenance inside the caller's mutation
 * transaction. Final publication/terminal CAS operations use this to close the check-to-act race
 * left by worker heartbeats.
 */
export async function assertDatabaseKnowledgeSpacePermissionFence(input: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly fence: DatabaseKnowledgeSpacePermissionFence;
  readonly now: string;
  readonly requiredAccess: "read" | "write" | "admin";
}): Promise<KnowledgeSpacePermissionSnapshot> {
  const { database, executor, fence } = input;
  const snapshotResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [fence.tenantId, fence.knowledgeSpaceId, fence.permissionSnapshotId],
    sql: `SELECT * FROM ${q(database, "knowledge_space_permission_snapshots")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} LIMIT 1 FOR UPDATE;`,
    tableName: "knowledge_space_permission_snapshots",
  });
  const row = snapshotResult.rows[0];
  if (!row) throw invalidPermissionSnapshot();
  const snapshot = databasePermissionSnapshot(row);
  if (
    snapshot.revision !== fence.permissionSnapshotRevision ||
    snapshot.subjectId !== fence.requestedBySubjectId ||
    snapshot.accessChannel !== fence.accessChannel
  ) {
    throw invalidPermissionSnapshot();
  }

  // Lock every mutable authorization row used by the validation predicate before evaluating it.
  // Mutations of members/policy/API access/API keys therefore serialize with the final act.
  const locks: readonly {
    readonly params: readonly DatabaseQueryValue[];
    readonly sql: string;
    readonly tableName: string;
  }[] = [
    {
      params: [fence.tenantId, fence.knowledgeSpaceId, fence.requestedBySubjectId],
      sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_space_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "subject_id")} = ${p(database, 3)} FOR UPDATE;`,
      tableName: "knowledge_space_members",
    },
    {
      params: [fence.tenantId, fence.knowledgeSpaceId],
      sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_space_access_policies")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} FOR UPDATE;`,
      tableName: "knowledge_space_access_policies",
    },
    {
      params: [fence.tenantId, fence.knowledgeSpaceId],
      sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_space_api_access")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} FOR UPDATE;`,
      tableName: "knowledge_space_api_access",
    },
    ...(snapshot.apiKeyId
      ? [
          {
            params: [fence.tenantId, fence.knowledgeSpaceId, snapshot.apiKeyId],
            sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_space_api_keys")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} FOR UPDATE;`,
            tableName: "knowledge_space_api_keys",
          },
        ]
      : []),
  ];
  for (const lock of locks) {
    const locked = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: lock.params,
      sql: lock.sql,
      tableName: lock.tableName,
    });
    if (!locked.rows[0]) throw invalidPermissionSnapshot();
  }

  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      fence.tenantId,
      fence.knowledgeSpaceId,
      fence.permissionSnapshotId,
      fence.requestedBySubjectId,
      fence.accessChannel,
      input.now,
    ],
    sql: revalidatePermissionSnapshotSql(database),
    tableName: "knowledge_space_permission_snapshots",
  });
  const validated = result.rows[0] ? databasePermissionSnapshot(result.rows[0]) : null;
  if (
    !validated ||
    validated.revision !== fence.permissionSnapshotRevision ||
    (input.requiredAccess === "write" && validated.role === "viewer") ||
    (input.requiredAccess === "admin" && validated.role !== "owner")
  ) {
    throw invalidPermissionSnapshot();
  }
  return validated;
}

export interface KnowledgeSpaceMember extends KnowledgeSpaceAccessScope {
  readonly createdAt: string;
  readonly createdBySubjectId: string;
  readonly id: string;
  readonly revision: number;
  readonly role: KnowledgeSpaceMemberRole;
  readonly subjectId: string;
  readonly updatedAt: string;
}

export interface KnowledgeSpaceAccessPolicy extends KnowledgeSpaceAccessScope {
  readonly createdAt: string;
  readonly id: string;
  readonly ownerSubjectId: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBySubjectId: string;
  readonly visibility: KnowledgeSpaceVisibility;
}

export interface KnowledgeSpaceAccessPolicyState {
  readonly partialMemberSubjectIds: readonly string[];
  readonly policy: KnowledgeSpaceAccessPolicy;
}

export interface KnowledgeSpaceApiAccess extends KnowledgeSpaceAccessScope {
  readonly createdAt: string;
  readonly disabledAt?: string;
  readonly enabled: boolean;
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBySubjectId: string;
}

export interface KnowledgeSpaceApiKey extends KnowledgeSpaceAccessScope {
  readonly createdAt: string;
  readonly createdBySubjectId: string;
  readonly expiresAt?: string;
  readonly id: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly lastUsedAt?: string;
  readonly name: string;
  readonly principalSubjectId: string;
  readonly revision: number;
  readonly revokedAt?: string;
  readonly status: "active" | "revoked";
  readonly updatedAt: string;
}

export type KnowledgeSpaceApiKeySummary = Omit<KnowledgeSpaceApiKey, "keyHash">;

/** Non-secret, server-authenticated API-key identity captured by a durable grant. */
export interface KnowledgeSpaceApiKeyPermissionBinding {
  readonly expiresAt?: string | undefined;
  readonly id: string;
  readonly revision: number;
}

export interface KnowledgeSpacePermissionSnapshot extends KnowledgeSpaceAccessScope {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly accessPolicyRevision: number;
  readonly apiAccessRevision: number;
  readonly apiKeyExpiresAt?: string | undefined;
  readonly apiKeyId?: string | undefined;
  readonly apiKeyRevision?: number | undefined;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly memberRevision: number;
  readonly permissionScopes: readonly string[];
  readonly revision: number;
  readonly revokedAt?: string;
  readonly role: KnowledgeSpaceMemberRole;
  readonly status: "active" | "revoked" | "expired";
  readonly subjectId: string;
  readonly updatedAt: string;
  readonly visibility: KnowledgeSpaceVisibility;
}

export interface KnowledgeSpaceAccessContext {
  readonly apiAccess: Pick<KnowledgeSpaceApiAccess, "enabled" | "id" | "revision">;
  readonly member: Pick<KnowledgeSpaceMember, "id" | "revision" | "role" | "subjectId">;
  readonly partialMemberSubjectIds: readonly string[];
  readonly policy: Pick<
    KnowledgeSpaceAccessPolicy,
    "id" | "ownerSubjectId" | "revision" | "visibility"
  >;
}

export interface ListKnowledgeSpaceMembersInput extends KnowledgeSpaceAccessScope {
  readonly cursor?: string;
  readonly limit: number;
}

export interface ListKnowledgeSpaceMembersResult {
  readonly items: readonly KnowledgeSpaceMember[];
  readonly nextCursor?: string;
}

export interface ListKnowledgeSpaceApiKeysInput extends KnowledgeSpaceAccessScope {
  readonly cursor?: string;
  readonly limit: number;
}

export interface ListKnowledgeSpaceApiKeysResult {
  readonly items: readonly KnowledgeSpaceApiKey[];
  readonly nextCursor?: string;
}

export interface InitializeKnowledgeSpaceAccessInput extends KnowledgeSpaceAccessScope {
  readonly ownerSubjectId: string;
}

export interface SetKnowledgeSpaceMemberRoleInput extends KnowledgeSpaceAccessScope {
  readonly actorSubjectId: string;
  readonly expectedRevision: number;
  readonly role: KnowledgeSpaceMemberRole;
  readonly subjectId: string;
}

export interface RemoveKnowledgeSpaceMemberInput extends KnowledgeSpaceAccessScope {
  readonly actorSubjectId: string;
  readonly expectedRevision: number;
  readonly subjectId: string;
}

export interface UpdateKnowledgeSpaceAccessPolicyInput extends KnowledgeSpaceAccessScope {
  readonly actorSubjectId: string;
  readonly expectedRevision: number;
  readonly partialMemberSubjectIds: readonly string[];
  readonly visibility: KnowledgeSpaceVisibility;
}

export interface UpdateKnowledgeSpaceApiAccessInput extends KnowledgeSpaceAccessScope {
  readonly actorSubjectId: string;
  readonly enabled: boolean;
  readonly expectedRevision: number;
}

export interface CreateKnowledgeSpaceApiKeyInput extends KnowledgeSpaceAccessScope {
  readonly createdBySubjectId: string;
  readonly expiresAt?: string;
  readonly id: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly name: string;
  readonly principalSubjectId: string;
}

export interface IssueKnowledgeSpaceApiKeyInput extends KnowledgeSpaceAccessScope {
  readonly actorSubjectId: string;
  readonly expiresAt?: string;
  readonly name: string;
  readonly principalSubjectId: string;
}

export interface IssuedKnowledgeSpaceApiKey {
  readonly apiKey: KnowledgeSpaceApiKeySummary;
  /** The only plaintext copy. Callers must return it once and never persist or log it. */
  readonly token: string;
}

export interface RevokeKnowledgeSpaceApiKeyInput extends KnowledgeSpaceAccessScope {
  readonly actorSubjectId: string;
  readonly expectedRevision: number;
  readonly id: string;
}

export interface MarkKnowledgeSpaceApiKeyUsedInput extends KnowledgeSpaceAccessScope {
  readonly id: string;
  readonly usedAt: string;
}

export interface CreateKnowledgeSpacePermissionSnapshotInput extends KnowledgeSpaceAccessScope {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
  readonly expiresAt: string;
  readonly id: string;
  readonly subjectId: string;
}

export interface IssueKnowledgeSpacePermissionSnapshotInput extends KnowledgeSpaceAccessScope {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
  readonly expiresAt: string;
  readonly subjectId: string;
}

export interface RevokeKnowledgeSpacePermissionSnapshotInput extends KnowledgeSpaceAccessScope {
  readonly expectedRevision: number;
  readonly id: string;
}

export interface KnowledgeSpaceAccessRepository {
  createApiKey(input: CreateKnowledgeSpaceApiKeyInput): Promise<KnowledgeSpaceApiKey>;
  createPermissionSnapshot(
    input: CreateKnowledgeSpacePermissionSnapshotInput,
  ): Promise<KnowledgeSpacePermissionSnapshot>;
  deleteAggregate(input: KnowledgeSpaceAccessScope): Promise<boolean>;
  findActiveApiKeyById(input: { readonly id: string }): Promise<KnowledgeSpaceApiKey | null>;
  getAccessContext(
    input: KnowledgeSpaceAccessScope & { readonly subjectId: string },
  ): Promise<KnowledgeSpaceAccessContext | null>;
  getAccessPolicy(
    input: KnowledgeSpaceAccessScope,
  ): Promise<KnowledgeSpaceAccessPolicyState | null>;
  getActiveApiKeyById(
    input: KnowledgeSpaceAccessScope & { readonly id: string },
  ): Promise<KnowledgeSpaceApiKey | null>;
  getApiAccess(input: KnowledgeSpaceAccessScope): Promise<KnowledgeSpaceApiAccess | null>;
  getPermissionSnapshot(
    input: KnowledgeSpaceAccessScope & { readonly id: string },
  ): Promise<KnowledgeSpacePermissionSnapshot | null>;
  initialize(input: InitializeKnowledgeSpaceAccessInput): Promise<KnowledgeSpaceAccessContext>;
  listApiKeys(input: ListKnowledgeSpaceApiKeysInput): Promise<ListKnowledgeSpaceApiKeysResult>;
  listMembers(input: ListKnowledgeSpaceMembersInput): Promise<ListKnowledgeSpaceMembersResult>;
  markApiKeyUsed(input: MarkKnowledgeSpaceApiKeyUsedInput): Promise<boolean>;
  removeMember(input: RemoveKnowledgeSpaceMemberInput): Promise<boolean>;
  revalidatePermissionSnapshot(
    input: KnowledgeSpaceAccessScope & {
      readonly expectedAccessChannel: KnowledgeSpaceAccessChannel;
      readonly id: string;
      readonly subjectId: string;
    },
  ): Promise<KnowledgeSpacePermissionSnapshot>;
  revokeApiKey(input: RevokeKnowledgeSpaceApiKeyInput): Promise<KnowledgeSpaceApiKey>;
  revokePermissionSnapshot(
    input: RevokeKnowledgeSpacePermissionSnapshotInput,
  ): Promise<KnowledgeSpacePermissionSnapshot>;
  setMemberRole(input: SetKnowledgeSpaceMemberRoleInput): Promise<KnowledgeSpaceMember>;
  updateApiAccess(input: UpdateKnowledgeSpaceApiAccessInput): Promise<KnowledgeSpaceApiAccess>;
  updatePolicy(
    input: UpdateKnowledgeSpaceAccessPolicyInput,
  ): Promise<KnowledgeSpaceAccessPolicyState>;
}

export interface KnowledgeSpaceAccessService
  extends Omit<
    KnowledgeSpaceAccessRepository,
    "createApiKey" | "createPermissionSnapshot" | "listApiKeys"
  > {
  createPermissionSnapshot(
    input: IssueKnowledgeSpacePermissionSnapshotInput,
  ): Promise<KnowledgeSpacePermissionSnapshot>;
  issueApiKey(input: IssueKnowledgeSpaceApiKeyInput): Promise<IssuedKnowledgeSpaceApiKey>;
  listApiKeys(input: ListKnowledgeSpaceApiKeysInput): Promise<{
    readonly items: readonly KnowledgeSpaceApiKeySummary[];
    readonly nextCursor?: string;
  }>;
}

export interface InMemoryKnowledgeSpaceAccessRepositoryOptions {
  readonly generateId?: () => string;
  readonly maxApiKeysPerSpace: number;
  readonly maxListLimit: number;
  readonly maxMembersPerSpace: number;
  readonly now?: () => string;
}

export interface DatabaseKnowledgeSpaceAccessRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: () => string;
  readonly maxListLimit: number;
  readonly maxMembersPerSpace: number;
  readonly now?: () => string;
}

export interface KnowledgeSpaceAccessServiceOptions {
  readonly generateApiKeySecret?: () => string;
  readonly generateId?: () => string;
  readonly repository: KnowledgeSpaceAccessRepository;
}

export type KnowledgeSpaceAccessErrorCode =
  | "space_access_already_initialized"
  | "space_access_not_found"
  | "space_access_forbidden"
  | "space_access_revision_conflict"
  | "space_access_last_owner"
  | "space_access_policy_owner"
  | "space_access_partial_members_required"
  | "space_access_partial_member_not_found"
  | "space_access_capacity_exceeded"
  | "space_access_permission_snapshot_invalid"
  | "space_access_invalid_request";

export class KnowledgeSpaceAccessError extends Error {
  readonly code: KnowledgeSpaceAccessErrorCode;

  constructor(code: KnowledgeSpaceAccessErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeSpaceAccessError";
    this.code = code;
  }
}

export class KnowledgeSpaceAccessRevisionConflictError extends KnowledgeSpaceAccessError {
  readonly actualRevision: number;
  readonly expectedRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      "space_access_revision_conflict",
      `Knowledge-space access revision conflict: expected=${expectedRevision} actual=${actualRevision}`,
    );
    this.actualRevision = actualRevision;
    this.expectedRevision = expectedRevision;
  }
}

export function hashKnowledgeSpaceApiKey(fullToken: string): string {
  if (fullToken.length < 32 || fullToken.length > 512) {
    throw new Error("Knowledge-space API key token length must be between 32 and 512 characters");
  }
  return createHash("sha256").update(fullToken, "utf8").digest("hex");
}

interface InMemoryAccessAggregate {
  apiAccess: KnowledgeSpaceApiAccess;
  apiKeys: Map<string, KnowledgeSpaceApiKey>;
  members: Map<string, KnowledgeSpaceMember>;
  partialMemberSubjectIds: Set<string>;
  permissionSnapshots: Map<string, KnowledgeSpacePermissionSnapshot>;
  policy: KnowledgeSpaceAccessPolicy;
}

export function createInMemoryKnowledgeSpaceAccessRepository({
  generateId = randomUUID,
  maxApiKeysPerSpace,
  maxListLimit,
  maxMembersPerSpace,
  now = () => new Date().toISOString(),
}: InMemoryKnowledgeSpaceAccessRepositoryOptions): KnowledgeSpaceAccessRepository {
  validateRepositoryBounds({ maxApiKeysPerSpace, maxListLimit, maxMembersPerSpace });
  const aggregates = new Map<string, InMemoryAccessAggregate>();

  const requireAggregate = (scope: KnowledgeSpaceAccessScope): InMemoryAccessAggregate => {
    const aggregate = aggregates.get(accessScopeKey(scope));
    if (!aggregate) {
      throw accessNotFound();
    }
    return aggregate;
  };

  return {
    initialize: async (input) => {
      validateScope(input);
      validateSubjectId(input.ownerSubjectId);
      const key = accessScopeKey(input);
      if (aggregates.has(key)) {
        throw new KnowledgeSpaceAccessError(
          "space_access_already_initialized",
          "Knowledge-space access state is already initialized",
        );
      }

      const timestamp = now();
      const owner = createMember({
        ...input,
        createdAt: timestamp,
        createdBySubjectId: input.ownerSubjectId,
        id: generateId(),
        revision: 1,
        role: "owner",
        subjectId: input.ownerSubjectId,
        updatedAt: timestamp,
      });
      const policy = createPolicy({
        ...input,
        createdAt: timestamp,
        id: generateId(),
        ownerSubjectId: input.ownerSubjectId,
        revision: 1,
        updatedAt: timestamp,
        updatedBySubjectId: input.ownerSubjectId,
        visibility: "only_me",
      });
      const apiAccess = createApiAccess({
        ...input,
        createdAt: timestamp,
        disabledAt: timestamp,
        enabled: false,
        id: generateId(),
        revision: 1,
        updatedAt: timestamp,
        updatedBySubjectId: input.ownerSubjectId,
      });
      const aggregate: InMemoryAccessAggregate = {
        apiAccess,
        apiKeys: new Map(),
        members: new Map([[owner.subjectId, owner]]),
        partialMemberSubjectIds: new Set(),
        permissionSnapshots: new Map(),
        policy,
      };
      aggregates.set(key, aggregate);
      return cloneAccessContext({
        apiAccess,
        member: owner,
        partialMemberSubjectIds: [],
        policy,
      });
    },
    deleteAggregate: async (input) => aggregates.delete(accessScopeKey(input)),
    findActiveApiKeyById: async (input) => {
      for (const aggregate of aggregates.values()) {
        const apiKey = aggregate.apiKeys.get(input.id);
        if (
          apiKey?.status === "active" &&
          (!apiKey.expiresAt || Date.parse(apiKey.expiresAt) > Date.parse(now()))
        ) {
          return cloneApiKey(apiKey);
        }
      }
      return null;
    },
    getAccessContext: async (input) => {
      const aggregate = aggregates.get(accessScopeKey(input));
      const member = aggregate?.members.get(input.subjectId);
      return aggregate && member
        ? cloneAccessContext({
            apiAccess: aggregate.apiAccess,
            member,
            partialMemberSubjectIds: sortedStrings(aggregate.partialMemberSubjectIds),
            policy: aggregate.policy,
          })
        : null;
    },
    getAccessPolicy: async (input) => {
      const aggregate = aggregates.get(accessScopeKey(input));
      return aggregate
        ? {
            partialMemberSubjectIds: sortedStrings(aggregate.partialMemberSubjectIds),
            policy: clonePolicy(aggregate.policy),
          }
        : null;
    },
    getApiAccess: async (input) => {
      const aggregate = aggregates.get(accessScopeKey(input));
      return aggregate ? cloneApiAccess(aggregate.apiAccess) : null;
    },
    listMembers: async (input) => {
      validateListLimit(input.limit, maxListLimit);
      const aggregate = aggregates.get(accessScopeKey(input));
      if (!aggregate) {
        return { items: [] };
      }
      const page = [...aggregate.members.values()]
        .filter((member) => (input.cursor ? member.subjectId > input.cursor : true))
        .sort((left, right) => left.subjectId.localeCompare(right.subjectId))
        .slice(0, input.limit + 1);
      const items = page.slice(0, input.limit).map(cloneMember);
      const nextCursor = page.length > input.limit ? items.at(-1)?.subjectId : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
    markApiKeyUsed: async (input) => {
      const aggregate = aggregates.get(accessScopeKey(input));
      const apiKey = aggregate?.apiKeys.get(input.id);
      if (
        !aggregate ||
        !apiKey ||
        apiKey.status !== "active" ||
        (apiKey.expiresAt && Date.parse(apiKey.expiresAt) <= Date.parse(input.usedAt))
      ) {
        return false;
      }
      if (Number.isNaN(Date.parse(input.usedAt))) {
        throw new Error("Knowledge-space API key usedAt must be an ISO timestamp");
      }
      aggregate.apiKeys.set(
        apiKey.id,
        createApiKeyRecord({ ...apiKey, lastUsedAt: input.usedAt, updatedAt: input.usedAt }),
      );
      return true;
    },
    setMemberRole: async (input) => {
      validateMemberMutation(input);
      const aggregate = requireAggregate(input);
      requireOwner(aggregate, input.actorSubjectId);
      const existing = aggregate.members.get(input.subjectId);

      if (!existing) {
        if (input.expectedRevision !== 0) {
          throw new KnowledgeSpaceAccessRevisionConflictError(input.expectedRevision, 0);
        }
        if (aggregate.members.size >= maxMembersPerSpace) {
          throw capacityExceeded("members", maxMembersPerSpace);
        }
        const timestamp = now();
        const member = createMember({
          ...input,
          createdAt: timestamp,
          createdBySubjectId: input.actorSubjectId,
          id: generateId(),
          revision: 1,
          updatedAt: timestamp,
        });
        aggregate.members.set(member.subjectId, member);
        return cloneMember(member);
      }

      requireRevision(input.expectedRevision, existing.revision);
      assertCanChangeOrRemoveMember(aggregate, existing, input.role);
      const updated = createMember({
        ...existing,
        revision: existing.revision + 1,
        role: input.role,
        updatedAt: now(),
      });
      aggregate.members.set(updated.subjectId, updated);
      return cloneMember(updated);
    },
    removeMember: async (input) => {
      validateScope(input);
      validateSubjectId(input.actorSubjectId);
      validateSubjectId(input.subjectId);
      const aggregate = requireAggregate(input);
      requireOwner(aggregate, input.actorSubjectId);
      const existing = aggregate.members.get(input.subjectId);
      if (!existing) {
        return false;
      }
      requireRevision(input.expectedRevision, existing.revision);
      assertCanChangeOrRemoveMember(aggregate, existing, undefined);
      assertPartialPolicySurvivesRemoval(aggregate, existing.subjectId);
      aggregate.partialMemberSubjectIds.delete(existing.subjectId);
      aggregate.members.delete(existing.subjectId);
      for (const [id, apiKey] of aggregate.apiKeys) {
        if (apiKey.principalSubjectId === existing.subjectId) {
          aggregate.apiKeys.delete(id);
        }
      }
      return true;
    },
    revalidatePermissionSnapshot: async (input) => {
      const aggregate = aggregates.get(accessScopeKey(input));
      const snapshot = aggregate?.permissionSnapshots.get(input.id);
      const member = aggregate?.members.get(input.subjectId);
      const boundApiKey =
        aggregate && snapshot?.apiKeyId ? aggregate.apiKeys.get(snapshot.apiKeyId) : undefined;
      if (
        !aggregate ||
        !snapshot ||
        !member ||
        snapshot.subjectId !== input.subjectId ||
        snapshot.accessChannel !== input.expectedAccessChannel ||
        snapshot.status !== "active" ||
        Date.parse(snapshot.expiresAt) <= Date.parse(now()) ||
        snapshot.memberRevision !== member.revision ||
        snapshot.accessPolicyRevision !== aggregate.policy.revision ||
        snapshot.apiAccessRevision !== aggregate.apiAccess.revision ||
        !isPermissionSnapshotApiKeyBindingCurrent(snapshot, boundApiKey, now()) ||
        !canAccessAggregate(aggregate, member, snapshot.accessChannel)
      ) {
        throw invalidPermissionSnapshot();
      }
      return clonePermissionSnapshot(snapshot);
    },
    updatePolicy: async (input) => {
      validatePolicyMutation(input);
      const aggregate = requireAggregate(input);
      requireOwner(aggregate, input.actorSubjectId);
      requireRevision(input.expectedRevision, aggregate.policy.revision);
      const partialMembers = validatePartialMembers(input, aggregate.members);
      aggregate.policy = createPolicy({
        ...aggregate.policy,
        ownerSubjectId: input.actorSubjectId,
        revision: aggregate.policy.revision + 1,
        updatedAt: now(),
        updatedBySubjectId: input.actorSubjectId,
        visibility: input.visibility,
      });
      aggregate.partialMemberSubjectIds = new Set(partialMembers);
      return {
        partialMemberSubjectIds: [...partialMembers],
        policy: clonePolicy(aggregate.policy),
      };
    },
    updateApiAccess: async (input) => {
      validateScope(input);
      validateSubjectId(input.actorSubjectId);
      const aggregate = requireAggregate(input);
      requireOwner(aggregate, input.actorSubjectId);
      requireRevision(input.expectedRevision, aggregate.apiAccess.revision);
      aggregate.apiAccess = updatedApiAccess(
        aggregate.apiAccess,
        input.enabled,
        input.actorSubjectId,
        now(),
      );
      return cloneApiAccess(aggregate.apiAccess);
    },
    createApiKey: async (input) => {
      validateCreateApiKey(input, now());
      const aggregate = requireAggregate(input);
      requireOwner(aggregate, input.createdBySubjectId);
      if (!aggregate.members.has(input.principalSubjectId)) {
        throw partialMemberNotFound(input.principalSubjectId);
      }
      if (aggregate.apiKeys.size >= maxApiKeysPerSpace) {
        throw capacityExceeded("API keys", maxApiKeysPerSpace);
      }
      if ([...aggregates.values()].some((candidate) => candidate.apiKeys.has(input.id))) {
        throw new Error("Knowledge-space API key id already exists");
      }
      if (
        [...aggregates.values()].some((candidate) =>
          [...candidate.apiKeys.values()].some((apiKey) => apiKey.keyHash === input.keyHash),
        )
      ) {
        throw new Error("Knowledge-space API key hash already exists");
      }
      const timestamp = now();
      const apiKey = createApiKeyRecord({
        ...input,
        createdAt: timestamp,
        revision: 1,
        status: "active",
        updatedAt: timestamp,
      });
      aggregate.apiKeys.set(apiKey.id, apiKey);
      return cloneApiKey(apiKey);
    },
    getActiveApiKeyById: async (input) => {
      const apiKey = aggregates.get(accessScopeKey(input))?.apiKeys.get(input.id);
      return apiKey?.status === "active" &&
        (!apiKey.expiresAt || Date.parse(apiKey.expiresAt) > Date.parse(now()))
        ? cloneApiKey(apiKey)
        : null;
    },
    listApiKeys: async (input) => {
      validateListLimit(input.limit, maxListLimit);
      const aggregate = aggregates.get(accessScopeKey(input));
      if (!aggregate) {
        return { items: [] };
      }
      const cursor = input.cursor ? decodeApiKeyCursor(input.cursor) : undefined;
      const page = [...aggregate.apiKeys.values()]
        .filter((apiKey) => (cursor ? compareApiKeyCursor(apiKey, cursor) > 0 : true))
        .sort(compareApiKeys)
        .slice(0, input.limit + 1);
      const items = page.slice(0, input.limit).map(cloneApiKey);
      const next = page.length > input.limit ? items.at(-1) : undefined;
      return {
        items,
        ...(next ? { nextCursor: encodeApiKeyCursor(next) } : {}),
      };
    },
    revokeApiKey: async (input) => {
      validateScope(input);
      validateSubjectId(input.actorSubjectId);
      const aggregate = requireAggregate(input);
      requireOwner(aggregate, input.actorSubjectId);
      const apiKey = aggregate.apiKeys.get(input.id);
      if (!apiKey) {
        throw accessNotFound();
      }
      requireRevision(input.expectedRevision, apiKey.revision);
      if (apiKey.status === "revoked") {
        return cloneApiKey(apiKey);
      }
      const timestamp = now();
      const revoked = createApiKeyRecord({
        ...apiKey,
        revision: apiKey.revision + 1,
        revokedAt: timestamp,
        status: "revoked",
        updatedAt: timestamp,
      });
      aggregate.apiKeys.set(revoked.id, revoked);
      return cloneApiKey(revoked);
    },
    createPermissionSnapshot: async (input) => {
      const timestamp = now();
      validateSnapshotInput(input, timestamp);
      const aggregate = requireAggregate(input);
      const member = aggregate.members.get(input.subjectId);
      if (!member || !canAccessAggregate(aggregate, member, input.accessChannel)) {
        throw forbidden();
      }
      const apiKey = validatePermissionSnapshotApiKeyBinding({
        binding: input.apiKey,
        member,
        snapshotAccessChannel: input.accessChannel,
        snapshotExpiresAt: input.expiresAt,
        storedApiKey: input.apiKey ? aggregate.apiKeys.get(input.apiKey.id) : undefined,
        timestamp,
      });
      const permissionScopes = buildKnowledgeSpacePermissionScopes({
        accessChannel: input.accessChannel,
        context: {
          apiAccess: aggregate.apiAccess,
          member,
          partialMemberSubjectIds: sortedStrings(aggregate.partialMemberSubjectIds),
          policy: aggregate.policy,
        },
        knowledgeSpaceId: input.knowledgeSpaceId,
        subjectId: input.subjectId,
        tenantId: input.tenantId,
      });
      validatePermissionScopes(permissionScopes);
      const { apiKey: _apiKeyBinding, ...snapshotInput } = input;
      const snapshot = createPermissionSnapshotRecord({
        ...snapshotInput,
        ...(apiKey
          ? {
              ...(apiKey.expiresAt ? { apiKeyExpiresAt: apiKey.expiresAt } : {}),
              apiKeyId: apiKey.id,
              apiKeyRevision: apiKey.revision,
            }
          : {}),
        accessPolicyRevision: aggregate.policy.revision,
        apiAccessRevision: aggregate.apiAccess.revision,
        createdAt: timestamp,
        memberRevision: member.revision,
        permissionScopes,
        revision: 1,
        role: member.role,
        status: "active",
        updatedAt: timestamp,
        visibility: aggregate.policy.visibility,
      });
      aggregate.permissionSnapshots.set(snapshot.id, snapshot);
      return clonePermissionSnapshot(snapshot);
    },
    getPermissionSnapshot: async (input) => {
      const snapshot = aggregates.get(accessScopeKey(input))?.permissionSnapshots.get(input.id);
      return snapshot ? clonePermissionSnapshot(snapshot) : null;
    },
    revokePermissionSnapshot: async (input) => {
      const aggregate = requireAggregate(input);
      const snapshot = aggregate.permissionSnapshots.get(input.id);
      if (!snapshot) {
        throw accessNotFound();
      }
      requireRevision(input.expectedRevision, snapshot.revision);
      if (snapshot.status === "revoked") {
        return clonePermissionSnapshot(snapshot);
      }
      const timestamp = now();
      const revoked = createPermissionSnapshotRecord({
        ...snapshot,
        revision: snapshot.revision + 1,
        revokedAt: timestamp,
        status: "revoked",
        updatedAt: timestamp,
      });
      aggregate.permissionSnapshots.set(revoked.id, revoked);
      return clonePermissionSnapshot(revoked);
    },
  };
}

export function createKnowledgeSpaceAccessService({
  generateApiKeySecret = () => randomBytes(32).toString("base64url"),
  generateId = randomUUID,
  repository,
}: KnowledgeSpaceAccessServiceOptions): KnowledgeSpaceAccessService {
  return {
    initialize: (input) => repository.initialize(input),
    deleteAggregate: (input) => repository.deleteAggregate(input),
    findActiveApiKeyById: (input) => repository.findActiveApiKeyById(input),
    getAccessContext: (input) => repository.getAccessContext(input),
    getAccessPolicy: (input) => repository.getAccessPolicy(input),
    getActiveApiKeyById: (input) => repository.getActiveApiKeyById(input),
    getApiAccess: (input) => repository.getApiAccess(input),
    getPermissionSnapshot: (input) => repository.getPermissionSnapshot(input),
    listMembers: (input) => repository.listMembers(input),
    markApiKeyUsed: (input) => repository.markApiKeyUsed(input),
    removeMember: (input) => repository.removeMember(input),
    revalidatePermissionSnapshot: (input) => repository.revalidatePermissionSnapshot(input),
    revokeApiKey: (input) => repository.revokeApiKey(input),
    revokePermissionSnapshot: (input) => repository.revokePermissionSnapshot(input),
    setMemberRole: (input) => repository.setMemberRole(input),
    updateApiAccess: (input) => repository.updateApiAccess(input),
    updatePolicy: (input) => repository.updatePolicy(input),
    createPermissionSnapshot: (input) =>
      repository.createPermissionSnapshot({ ...input, id: generateId() }),
    issueApiKey: async (input) => {
      const id = generateId();
      const secret = generateApiKeySecret();
      if (!/^[A-Za-z0-9_-]{32,256}$/u.test(secret)) {
        throw new Error("Generated knowledge-space API key secret is not URL-safe or is too short");
      }
      const token = `kfs_${id}_${secret}`;
      const apiKey = await repository.createApiKey({
        ...input,
        createdBySubjectId: input.actorSubjectId,
        id,
        keyHash: hashKnowledgeSpaceApiKey(token),
        keyPrefix: `kfs_${id.slice(0, 8)}`,
      });
      return { apiKey: toApiKeySummary(apiKey), token };
    },
    listApiKeys: async (input) => {
      const result = await repository.listApiKeys(input);
      return {
        items: result.items.map(toApiKeySummary),
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    },
  };
}

async function appendPermissionActivity(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly actorSubjectId: string;
    readonly knowledgeSpaceId: string;
    readonly occurredAt: string;
    readonly resourceId: string;
    readonly revision: number;
    readonly statusCode: string;
    readonly tenantId: string;
  },
) {
  await appendKnowledgeSpaceActivityWithExecutor({
    database,
    executor,
    input: {
      action: "permission.updated",
      actor: { id: input.actorSubjectId, type: "member" },
      details: { statusCode: input.statusCode },
      id: deterministicKnowledgeSpaceActivityId(
        "permission.updated",
        input.tenantId,
        input.knowledgeSpaceId,
        input.resourceId,
        String(input.revision),
      ),
      knowledgeSpaceId: input.knowledgeSpaceId,
      occurredAt: input.occurredAt,
      requiredPermissionScope: [],
      resource: { id: input.resourceId, type: "permission" },
      result: "success",
      tenantId: input.tenantId,
    },
  });
}

export function createDatabaseKnowledgeSpaceAccessRepository({
  database,
  generateId = randomUUID,
  maxListLimit,
  maxMembersPerSpace,
  now = () => new Date().toISOString(),
}: DatabaseKnowledgeSpaceAccessRepositoryOptions): KnowledgeSpaceAccessRepository {
  validateRepositoryBounds({
    maxApiKeysPerSpace: Number.MAX_SAFE_INTEGER,
    maxListLimit,
    maxMembersPerSpace,
  });

  return {
    initialize: async (input) => {
      validateScope(input);
      validateSubjectId(input.ownerSubjectId);
      return database.transaction(async (transaction) => {
        const space = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_spaces")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} FOR UPDATE;`,
          tableName: "knowledge_spaces",
        });
        if (space.rows.length === 0) {
          throw accessNotFound();
        }
        const existing = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_space_access_policies")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)};`,
          tableName: "knowledge_space_access_policies",
        });
        if (existing.rows.length > 0) {
          throw new KnowledgeSpaceAccessError(
            "space_access_already_initialized",
            "Knowledge-space access state is already initialized",
          );
        }

        const timestamp = now();
        const member = createMember({
          ...input,
          createdAt: timestamp,
          createdBySubjectId: input.ownerSubjectId,
          id: generateId(),
          revision: 1,
          role: "owner",
          subjectId: input.ownerSubjectId,
          updatedAt: timestamp,
        });
        const policy = createPolicy({
          ...input,
          createdAt: timestamp,
          id: generateId(),
          ownerSubjectId: input.ownerSubjectId,
          revision: 1,
          updatedAt: timestamp,
          updatedBySubjectId: input.ownerSubjectId,
          visibility: "only_me",
        });
        const apiAccess = createApiAccess({
          ...input,
          createdAt: timestamp,
          disabledAt: timestamp,
          enabled: false,
          id: generateId(),
          revision: 1,
          updatedAt: timestamp,
          updatedBySubjectId: input.ownerSubjectId,
        });
        await insertDatabaseMember(database, transaction, member);
        await insertDatabasePolicy(database, transaction, policy);
        await insertDatabaseApiAccess(database, transaction, apiAccess);
        return cloneAccessContext({ apiAccess, member, partialMemberSubjectIds: [], policy });
      });
    },
    deleteAggregate: async (input) =>
      database.transaction(async (transaction) => {
        const policy = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `${selectPolicySql(database, false).replace(/;$/u, "")} FOR UPDATE;`,
          tableName: "knowledge_space_access_policies",
        });
        if (policy.rows.length === 0) {
          return false;
        }
        for (const tableName of [
          "knowledge_space_permission_snapshots",
          "knowledge_space_api_keys",
          "knowledge_space_api_access",
          "knowledge_space_access_policy_members",
          "knowledge_space_access_policies",
          "knowledge_space_members",
        ] as const) {
          await transaction.execute({
            maxRows: 0,
            operation: "delete",
            params: [input.tenantId, input.knowledgeSpaceId],
            sql: `DELETE FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)};`,
            tableName,
          });
        }
        return true;
      }),
    findActiveApiKeyById: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.id, now()],
        sql: `SELECT * FROM ${q(database, "knowledge_space_api_keys")} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "status")} = 'active' AND (${q(database, "expires_at")} IS NULL OR ${q(database, "expires_at")} > ${p(database, 2)});`,
        tableName: "knowledge_space_api_keys",
      });
      return result.rows[0] ? databaseApiKey(result.rows[0]) : null;
    },
    getAccessContext: async (input) =>
      readDatabaseAccessContext(database, database, input, maxMembersPerSpace),
    getAccessPolicy: async (input) => {
      const policyResult = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId],
        sql: selectPolicySql(database, false),
        tableName: "knowledge_space_access_policies",
      });
      const row = policyResult.rows[0];
      if (!row) {
        return null;
      }
      const policy = databasePolicy(row);
      const partialMemberSubjectIds = await readDatabasePartialMembers(
        database,
        database,
        input,
        policy.id,
        maxMembersPerSpace,
      );
      return { partialMemberSubjectIds, policy };
    },
    getApiAccess: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId],
        sql: selectApiAccessSql(database, false),
        tableName: "knowledge_space_api_access",
      });
      return result.rows[0] ? databaseApiAccess(result.rows[0]) : null;
    },
    listMembers: async (input) => {
      validateListLimit(input.limit, maxListLimit);
      const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId];
      const cursorSql = input.cursor
        ? (() => {
            params.push(input.cursor);
            return ` AND ${q(database, "subject_id")} > ${p(database, params.length)}`;
          })()
        : "";
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, "knowledge_space_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)}${cursorSql} ORDER BY ${q(database, "subject_id")} ASC, ${q(database, "id")} ASC LIMIT ${input.limit + 1};`,
        tableName: "knowledge_space_members",
      });
      const page = result.rows.map(databaseMember);
      const items = page.slice(0, input.limit);
      const nextCursor = page.length > input.limit ? items.at(-1)?.subjectId : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
    getActiveApiKeyById: async (input) => {
      const timestamp = now();
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId, input.id, timestamp],
        sql: `SELECT * FROM ${q(database, "knowledge_space_api_keys")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "status")} = 'active' AND (${q(database, "expires_at")} IS NULL OR ${q(database, "expires_at")} > ${p(database, 4)});`,
        tableName: "knowledge_space_api_keys",
      });
      return result.rows[0] ? databaseApiKey(result.rows[0]) : null;
    },
    listApiKeys: async (input) => {
      validateListLimit(input.limit, maxListLimit);
      const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId];
      let cursorSql = "";
      if (input.cursor) {
        const cursor = decodeApiKeyCursor(input.cursor);
        params.push(cursor.createdAt, cursor.createdAt, cursor.id);
        cursorSql = ` AND (${q(database, "created_at")} > ${p(database, 3)} OR (${q(database, "created_at")} = ${p(database, 4)} AND ${q(database, "id")} > ${p(database, 5)}))`;
      }
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, "knowledge_space_api_keys")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)}${cursorSql} ORDER BY ${q(database, "created_at")} ASC, ${q(database, "id")} ASC LIMIT ${input.limit + 1};`,
        tableName: "knowledge_space_api_keys",
      });
      const page = result.rows.map(databaseApiKey);
      const items = page.slice(0, input.limit);
      const next = page.length > input.limit ? items.at(-1) : undefined;
      return { items, ...(next ? { nextCursor: encodeApiKeyCursor(next) } : {}) };
    },
    markApiKeyUsed: async (input) => {
      if (Number.isNaN(Date.parse(input.usedAt))) {
        throw new Error("Knowledge-space API key usedAt must be an ISO timestamp");
      }
      const result = await database.execute({
        maxRows: 0,
        operation: "update",
        params: [input.usedAt, input.tenantId, input.knowledgeSpaceId, input.id],
        sql: `UPDATE ${q(database, "knowledge_space_api_keys")} SET ${q(database, "last_used_at")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "status")} = 'active' AND (${q(database, "expires_at")} IS NULL OR ${q(database, "expires_at")} > ${p(database, 1)});`,
        tableName: "knowledge_space_api_keys",
      });
      return result.rowsAffected === 1;
    },
    setMemberRole: async (input) => {
      validateMemberMutation(input);
      return database.transaction(async (transaction) => {
        const aggregate = await lockDatabaseAccessAggregate(
          database,
          transaction,
          input,
          maxMembersPerSpace,
        );
        requireDatabaseOwner(aggregate, input.actorSubjectId);
        const existing = aggregate.members.get(input.subjectId);
        if (!existing) {
          if (input.expectedRevision !== 0) {
            throw new KnowledgeSpaceAccessRevisionConflictError(input.expectedRevision, 0);
          }
          if (aggregate.members.size >= maxMembersPerSpace) {
            throw capacityExceeded("members", maxMembersPerSpace);
          }
          const timestamp = now();
          const member = createMember({
            ...input,
            createdAt: timestamp,
            createdBySubjectId: input.actorSubjectId,
            id: generateId(),
            revision: 1,
            updatedAt: timestamp,
          });
          await insertDatabaseMember(database, transaction, member);
          await appendPermissionActivity(database, transaction, {
            actorSubjectId: input.actorSubjectId,
            knowledgeSpaceId: input.knowledgeSpaceId,
            occurredAt: member.updatedAt,
            resourceId: member.id,
            revision: member.revision,
            statusCode: member.role,
            tenantId: input.tenantId,
          });
          return member;
        }
        requireRevision(input.expectedRevision, existing.revision);
        assertDatabaseCanChangeOrRemoveMember(aggregate, existing, input.role);
        const updated = createMember({
          ...existing,
          revision: existing.revision + 1,
          role: input.role,
          updatedAt: now(),
        });
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            updated.role,
            updated.revision,
            updated.updatedAt,
            input.tenantId,
            input.knowledgeSpaceId,
            input.subjectId,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "knowledge_space_members")} SET ${q(database, "role")} = ${p(database, 1)}, ${q(database, "revision")} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(database, "knowledge_space_id")} = ${p(database, 5)} AND ${q(database, "subject_id")} = ${p(database, 6)} AND ${q(database, "revision")} = ${p(database, 7)};`,
          tableName: "knowledge_space_members",
        });
        requireSingleCasWrite(result.rowsAffected, input.expectedRevision, existing.revision);
        await appendPermissionActivity(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          occurredAt: updated.updatedAt,
          resourceId: updated.id,
          revision: updated.revision,
          statusCode: updated.role,
          tenantId: input.tenantId,
        });
        return updated;
      });
    },
    removeMember: async (input) => {
      validateScope(input);
      validateSubjectId(input.actorSubjectId);
      validateSubjectId(input.subjectId);
      return database.transaction(async (transaction) => {
        const aggregate = await lockDatabaseAccessAggregate(
          database,
          transaction,
          input,
          maxMembersPerSpace,
        );
        requireDatabaseOwner(aggregate, input.actorSubjectId);
        const existing = aggregate.members.get(input.subjectId);
        if (!existing) {
          return false;
        }
        requireRevision(input.expectedRevision, existing.revision);
        assertDatabaseCanChangeOrRemoveMember(aggregate, existing, undefined);
        if (
          aggregate.policy.visibility === "partial_members" &&
          aggregate.partialMemberSubjectIds.includes(input.subjectId) &&
          aggregate.partialMemberSubjectIds.length === 1
        ) {
          throw new KnowledgeSpaceAccessError(
            "space_access_partial_members_required",
            "Removing this member would leave a partial_members policy empty",
          );
        }
        await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [input.tenantId, input.knowledgeSpaceId, input.subjectId],
          sql: `DELETE FROM ${q(database, "knowledge_space_access_policy_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "subject_id")} = ${p(database, 3)};`,
          tableName: "knowledge_space_access_policy_members",
        });
        const result = await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [input.tenantId, input.knowledgeSpaceId, input.subjectId, input.expectedRevision],
          sql: `DELETE FROM ${q(database, "knowledge_space_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "subject_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)};`,
          tableName: "knowledge_space_members",
        });
        requireSingleCasWrite(result.rowsAffected, input.expectedRevision, existing.revision);
        await appendPermissionActivity(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          occurredAt: now(),
          resourceId: existing.id,
          revision: existing.revision + 1,
          statusCode: "removed",
          tenantId: input.tenantId,
        });
        return true;
      });
    },
    updatePolicy: async (input) => {
      validatePolicyMutation(input);
      return database.transaction(async (transaction) => {
        const aggregate = await lockDatabaseAccessAggregate(
          database,
          transaction,
          input,
          maxMembersPerSpace,
        );
        requireDatabaseOwner(aggregate, input.actorSubjectId);
        requireRevision(input.expectedRevision, aggregate.policy.revision);
        const partialMembers = validatePartialMembers(input, aggregate.members);
        const updated = createPolicy({
          ...aggregate.policy,
          ownerSubjectId: input.actorSubjectId,
          revision: aggregate.policy.revision + 1,
          updatedAt: now(),
          updatedBySubjectId: input.actorSubjectId,
          visibility: input.visibility,
        });
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            updated.visibility,
            updated.ownerSubjectId,
            updated.revision,
            updated.updatedBySubjectId,
            updated.updatedAt,
            input.tenantId,
            input.knowledgeSpaceId,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "knowledge_space_access_policies")} SET ${q(database, "visibility")} = ${p(database, 1)}, ${q(database, "owner_subject_id")} = ${p(database, 2)}, ${q(database, "revision")} = ${p(database, 3)}, ${q(database, "updated_by_subject_id")} = ${p(database, 4)}, ${q(database, "updated_at")} = ${p(database, 5)} WHERE ${q(database, "tenant_id")} = ${p(database, 6)} AND ${q(database, "knowledge_space_id")} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(database, 8)};`,
          tableName: "knowledge_space_access_policies",
        });
        requireSingleCasWrite(
          result.rowsAffected,
          input.expectedRevision,
          aggregate.policy.revision,
        );
        await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [input.tenantId, input.knowledgeSpaceId, aggregate.policy.id],
          sql: `DELETE FROM ${q(database, "knowledge_space_access_policy_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "access_policy_id")} = ${p(database, 3)};`,
          tableName: "knowledge_space_access_policy_members",
        });
        for (const subjectId of partialMembers) {
          await insertDatabasePolicyMember(database, transaction, {
            ...input,
            accessPolicyId: aggregate.policy.id,
            createdAt: updated.updatedAt,
            id: generateId(),
            subjectId,
          });
        }
        await appendPermissionActivity(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          occurredAt: updated.updatedAt,
          resourceId: updated.id,
          revision: updated.revision,
          statusCode: updated.visibility,
          tenantId: input.tenantId,
        });
        return { partialMemberSubjectIds: partialMembers, policy: updated };
      });
    },
    updateApiAccess: async (input) => {
      validateScope(input);
      validateSubjectId(input.actorSubjectId);
      return database.transaction(async (transaction) => {
        const aggregate = await lockDatabaseAccessAggregate(
          database,
          transaction,
          input,
          maxMembersPerSpace,
        );
        requireDatabaseOwner(aggregate, input.actorSubjectId);
        requireRevision(input.expectedRevision, aggregate.apiAccess.revision);
        const updated = updatedApiAccess(
          aggregate.apiAccess,
          input.enabled,
          input.actorSubjectId,
          now(),
        );
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            updated.enabled,
            updated.disabledAt ?? null,
            updated.revision,
            updated.updatedBySubjectId,
            updated.updatedAt,
            input.tenantId,
            input.knowledgeSpaceId,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "knowledge_space_api_access")} SET ${q(database, "enabled")} = ${p(database, 1)}, ${q(database, "disabled_at")} = ${p(database, 2)}, ${q(database, "revision")} = ${p(database, 3)}, ${q(database, "updated_by_subject_id")} = ${p(database, 4)}, ${q(database, "updated_at")} = ${p(database, 5)} WHERE ${q(database, "tenant_id")} = ${p(database, 6)} AND ${q(database, "knowledge_space_id")} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(database, 8)};`,
          tableName: "knowledge_space_api_access",
        });
        requireSingleCasWrite(
          result.rowsAffected,
          input.expectedRevision,
          aggregate.apiAccess.revision,
        );
        await appendPermissionActivity(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          occurredAt: updated.updatedAt,
          resourceId: updated.id,
          revision: updated.revision,
          statusCode: updated.enabled ? "api-enabled" : "api-disabled",
          tenantId: input.tenantId,
        });
        return updated;
      });
    },

    createApiKey: async (input) => {
      validateCreateApiKey(input, now());
      return database.transaction(async (transaction) => {
        const aggregate = await lockDatabaseAccessAggregate(
          database,
          transaction,
          input,
          maxMembersPerSpace,
        );
        requireDatabaseOwner(aggregate, input.createdBySubjectId);
        if (!aggregate.members.has(input.principalSubjectId)) {
          throw partialMemberNotFound(input.principalSubjectId);
        }
        const timestamp = now();
        const apiKey = createApiKeyRecord({
          ...input,
          createdAt: timestamp,
          revision: 1,
          status: "active",
          updatedAt: timestamp,
        });
        const columns = [
          "id",
          "tenant_id",
          "knowledge_space_id",
          "name",
          "key_prefix",
          "key_hash",
          "principal_subject_id",
          "status",
          "revision",
          "created_by_subject_id",
          "last_used_at",
          "expires_at",
          "revoked_at",
          "created_at",
          "updated_at",
        ] as const;
        const params = [
          apiKey.id,
          apiKey.tenantId,
          apiKey.knowledgeSpaceId,
          apiKey.name,
          apiKey.keyPrefix,
          apiKey.keyHash,
          apiKey.principalSubjectId,
          apiKey.status,
          apiKey.revision,
          apiKey.createdBySubjectId,
          null,
          apiKey.expiresAt ?? null,
          null,
          apiKey.createdAt,
          apiKey.updatedAt,
        ] satisfies readonly DatabaseQueryValue[];
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params,
          sql: insertSql(database, "knowledge_space_api_keys", columns),
          tableName: "knowledge_space_api_keys",
        });
        return apiKey;
      });
    },
    revokeApiKey: async (input) => {
      validateScope(input);
      validateSubjectId(input.actorSubjectId);
      return database.transaction(async (transaction) => {
        const aggregate = await lockDatabaseAccessAggregate(
          database,
          transaction,
          input,
          maxMembersPerSpace,
        );
        requireDatabaseOwner(aggregate, input.actorSubjectId);
        const keyResult = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, input.id],
          sql: `SELECT * FROM ${q(database, "knowledge_space_api_keys")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} FOR UPDATE;`,
          tableName: "knowledge_space_api_keys",
        });
        if (!keyResult.rows[0]) {
          throw accessNotFound();
        }
        const apiKey = databaseApiKey(keyResult.rows[0]);
        requireRevision(input.expectedRevision, apiKey.revision);
        if (apiKey.status === "revoked") {
          return apiKey;
        }
        const timestamp = now();
        const revoked = createApiKeyRecord({
          ...apiKey,
          revision: apiKey.revision + 1,
          revokedAt: timestamp,
          status: "revoked",
          updatedAt: timestamp,
        });
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            revoked.status,
            revoked.revision,
            revoked.revokedAt ?? null,
            revoked.updatedAt,
            input.tenantId,
            input.knowledgeSpaceId,
            input.id,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "knowledge_space_api_keys")} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "revision")} = ${p(database, 2)}, ${q(database, "revoked_at")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "tenant_id")} = ${p(database, 5)} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(database, "id")} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(database, 8)};`,
          tableName: "knowledge_space_api_keys",
        });
        requireSingleCasWrite(result.rowsAffected, input.expectedRevision, apiKey.revision);
        return revoked;
      });
    },
    createPermissionSnapshot: async (input) => {
      const timestamp = now();
      validateSnapshotInput(input, timestamp);
      return database.transaction(async (transaction) => {
        const aggregate = await lockDatabaseAccessAggregate(
          database,
          transaction,
          input,
          maxMembersPerSpace,
        );
        const member = aggregate.members.get(input.subjectId);
        if (!member || !canAccessDatabaseAggregate(aggregate, member, input.accessChannel)) {
          throw forbidden();
        }
        const storedApiKey = input.apiKey
          ? await lockDatabaseApiKey(database, transaction, {
              ...input,
              id: input.apiKey.id,
            })
          : undefined;
        const apiKey = validatePermissionSnapshotApiKeyBinding({
          binding: input.apiKey,
          member,
          snapshotAccessChannel: input.accessChannel,
          snapshotExpiresAt: input.expiresAt,
          storedApiKey,
          timestamp,
        });
        const permissionScopes = buildKnowledgeSpacePermissionScopes({
          accessChannel: input.accessChannel,
          context: {
            apiAccess: aggregate.apiAccess,
            member,
            partialMemberSubjectIds: aggregate.partialMemberSubjectIds,
            policy: aggregate.policy,
          },
          knowledgeSpaceId: input.knowledgeSpaceId,
          subjectId: input.subjectId,
          tenantId: input.tenantId,
        });
        validatePermissionScopes(permissionScopes);
        const { apiKey: _apiKeyBinding, ...snapshotInput } = input;
        const snapshot = createPermissionSnapshotRecord({
          ...snapshotInput,
          ...(apiKey
            ? {
                ...(apiKey.expiresAt ? { apiKeyExpiresAt: apiKey.expiresAt } : {}),
                apiKeyId: apiKey.id,
                apiKeyRevision: apiKey.revision,
              }
            : {}),
          accessPolicyRevision: aggregate.policy.revision,
          apiAccessRevision: aggregate.apiAccess.revision,
          createdAt: timestamp,
          memberRevision: member.revision,
          permissionScopes,
          revision: 1,
          role: member.role,
          status: "active",
          updatedAt: timestamp,
          visibility: aggregate.policy.visibility,
        });
        await insertDatabasePermissionSnapshot(database, transaction, snapshot);
        return snapshot;
      });
    },
    getPermissionSnapshot: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId, input.id],
        sql: `SELECT * FROM ${q(database, "knowledge_space_permission_snapshots")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)};`,
        tableName: "knowledge_space_permission_snapshots",
      });
      return result.rows[0] ? databasePermissionSnapshot(result.rows[0]) : null;
    },
    revalidatePermissionSnapshot: async (input) => {
      const timestamp = now();
      const params = [
        input.tenantId,
        input.knowledgeSpaceId,
        input.id,
        input.subjectId,
        input.expectedAccessChannel,
        timestamp,
      ] satisfies readonly DatabaseQueryValue[];
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params,
        sql: revalidatePermissionSnapshotSql(database),
        tableName: "knowledge_space_permission_snapshots",
      });
      if (!result.rows[0]) {
        throw invalidPermissionSnapshot();
      }
      return databasePermissionSnapshot(result.rows[0]);
    },
    revokePermissionSnapshot: async (input) =>
      database.transaction(async (transaction) => {
        const result = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, input.id],
          sql: `SELECT * FROM ${q(database, "knowledge_space_permission_snapshots")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} FOR UPDATE;`,
          tableName: "knowledge_space_permission_snapshots",
        });
        if (!result.rows[0]) {
          throw accessNotFound();
        }
        const snapshot = databasePermissionSnapshot(result.rows[0]);
        requireRevision(input.expectedRevision, snapshot.revision);
        if (snapshot.status === "revoked") {
          return snapshot;
        }
        const timestamp = now();
        const revoked = createPermissionSnapshotRecord({
          ...snapshot,
          revision: snapshot.revision + 1,
          revokedAt: timestamp,
          status: "revoked",
          updatedAt: timestamp,
        });
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            revoked.status,
            revoked.revision,
            revoked.revokedAt ?? null,
            revoked.updatedAt,
            input.tenantId,
            input.knowledgeSpaceId,
            input.id,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "knowledge_space_permission_snapshots")} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "revision")} = ${p(database, 2)}, ${q(database, "revoked_at")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "tenant_id")} = ${p(database, 5)} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(database, "id")} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(database, 8)};`,
          tableName: "knowledge_space_permission_snapshots",
        });
        requireSingleCasWrite(updated.rowsAffected, input.expectedRevision, snapshot.revision);
        return revoked;
      }),
  };
}

interface DatabaseAccessAggregate {
  readonly apiAccess: KnowledgeSpaceApiAccess;
  readonly members: ReadonlyMap<string, KnowledgeSpaceMember>;
  readonly partialMemberSubjectIds: readonly string[];
  readonly policy: KnowledgeSpaceAccessPolicy;
}

async function lockDatabaseApiKey(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceAccessScope & { readonly id: string },
): Promise<KnowledgeSpaceApiKey | undefined> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.id],
    sql: `SELECT * FROM ${q(database, "knowledge_space_api_keys")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} FOR UPDATE;`,
    tableName: "knowledge_space_api_keys",
  });
  return result.rows[0] ? databaseApiKey(result.rows[0]) : undefined;
}

async function lockDatabaseAccessAggregate(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceAccessScope,
  maxMembersPerSpace: number,
): Promise<DatabaseAccessAggregate> {
  const params = [scope.tenantId, scope.knowledgeSpaceId] satisfies readonly DatabaseQueryValue[];
  const membersResult = await executor.execute({
    maxRows: maxMembersPerSpace + 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q(database, "knowledge_space_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} ORDER BY ${q(database, "id")} ASC LIMIT ${maxMembersPerSpace + 1} FOR UPDATE;`,
    tableName: "knowledge_space_members",
  });
  if (membersResult.rows.length > maxMembersPerSpace) {
    throw capacityExceeded("members", maxMembersPerSpace);
  }
  const policyResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: selectPolicySql(database, true),
    tableName: "knowledge_space_access_policies",
  });
  const apiAccessResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: selectApiAccessSql(database, true),
    tableName: "knowledge_space_api_access",
  });
  if (!policyResult.rows[0] || !apiAccessResult.rows[0]) {
    throw accessNotFound();
  }
  const policy = databasePolicy(policyResult.rows[0]);
  const partialMemberSubjectIds = await readDatabasePartialMembers(
    database,
    executor,
    scope,
    policy.id,
    maxMembersPerSpace,
    true,
  );
  return {
    apiAccess: databaseApiAccess(apiAccessResult.rows[0]),
    members: new Map(
      membersResult.rows.map((row) => {
        const member = databaseMember(row);
        return [member.subjectId, member] as const;
      }),
    ),
    partialMemberSubjectIds,
    policy,
  };
}

async function readDatabaseAccessContext(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceAccessScope & { readonly subjectId: string },
  maxMembersPerSpace: number,
): Promise<KnowledgeSpaceAccessContext | null> {
  const memberResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.subjectId],
    sql: `SELECT * FROM ${q(database, "knowledge_space_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "subject_id")} = ${p(database, 3)};`,
    tableName: "knowledge_space_members",
  });
  if (!memberResult.rows[0]) {
    return null;
  }
  const policyResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: selectPolicySql(database, false),
    tableName: "knowledge_space_access_policies",
  });
  const apiAccessResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: selectApiAccessSql(database, false),
    tableName: "knowledge_space_api_access",
  });
  if (!policyResult.rows[0] || !apiAccessResult.rows[0]) {
    return null;
  }
  const policy = databasePolicy(policyResult.rows[0]);
  const partialMemberSubjectIds = await readDatabasePartialMembers(
    database,
    executor,
    input,
    policy.id,
    maxMembersPerSpace,
  );
  return cloneAccessContext({
    apiAccess: databaseApiAccess(apiAccessResult.rows[0]),
    member: databaseMember(memberResult.rows[0]),
    partialMemberSubjectIds,
    policy,
  });
}

async function readDatabasePartialMembers(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceAccessScope,
  accessPolicyId: string,
  maxMembersPerSpace: number,
  lock = false,
): Promise<readonly string[]> {
  const result = await executor.execute({
    maxRows: maxMembersPerSpace + 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, accessPolicyId],
    sql: `SELECT ${q(database, "subject_id")} FROM ${q(database, "knowledge_space_access_policy_members")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "access_policy_id")} = ${p(database, 3)} ORDER BY ${q(database, "subject_id")} ASC LIMIT ${maxMembersPerSpace + 1}${lock ? " FOR UPDATE" : ""};`,
    tableName: "knowledge_space_access_policy_members",
  });
  if (result.rows.length > maxMembersPerSpace) {
    throw capacityExceeded("partial policy members", maxMembersPerSpace);
  }
  return result.rows.map((row) => stringColumn(row, "subject_id"));
}

function requireDatabaseOwner(aggregate: DatabaseAccessAggregate, subjectId: string): void {
  if (aggregate.members.get(subjectId)?.role !== "owner") {
    throw forbidden();
  }
}

function assertDatabaseCanChangeOrRemoveMember(
  aggregate: DatabaseAccessAggregate,
  existing: KnowledgeSpaceMember,
  nextRole: KnowledgeSpaceMemberRole | undefined,
): void {
  if (
    existing.role === "owner" &&
    nextRole !== "owner" &&
    [...aggregate.members.values()].filter((member) => member.role === "owner").length === 1
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_last_owner",
      "A knowledge space must retain at least one owner",
    );
  }
  if (existing.subjectId === aggregate.policy.ownerSubjectId && nextRole !== "owner") {
    throw new KnowledgeSpaceAccessError(
      "space_access_policy_owner",
      "The policy owner must be transferred before this member can be demoted or removed",
    );
  }
}

function canAccessDatabaseAggregate(
  aggregate: DatabaseAccessAggregate,
  member: KnowledgeSpaceMember,
  accessChannel: KnowledgeSpaceAccessChannel,
): boolean {
  if (accessChannel !== "interactive" && !aggregate.apiAccess.enabled) {
    return false;
  }
  if (aggregate.policy.visibility === "only_me") {
    return member.subjectId === aggregate.policy.ownerSubjectId;
  }
  if (aggregate.policy.visibility === "all_members") {
    return true;
  }
  return aggregate.partialMemberSubjectIds.includes(member.subjectId);
}

async function insertDatabaseMember(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  member: KnowledgeSpaceMember,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "subject_id",
    "role",
    "revision",
    "created_by_subject_id",
    "created_at",
    "updated_at",
  ] as const;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      member.id,
      member.tenantId,
      member.knowledgeSpaceId,
      member.subjectId,
      member.role,
      member.revision,
      member.createdBySubjectId,
      member.createdAt,
      member.updatedAt,
    ],
    sql: insertSql(database, "knowledge_space_members", columns),
    tableName: "knowledge_space_members",
  });
}

async function insertDatabasePolicy(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  policy: KnowledgeSpaceAccessPolicy,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "visibility",
    "owner_subject_id",
    "revision",
    "updated_by_subject_id",
    "created_at",
    "updated_at",
  ] as const;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      policy.id,
      policy.tenantId,
      policy.knowledgeSpaceId,
      policy.visibility,
      policy.ownerSubjectId,
      policy.revision,
      policy.updatedBySubjectId,
      policy.createdAt,
      policy.updatedAt,
    ],
    sql: insertSql(database, "knowledge_space_access_policies", columns),
    tableName: "knowledge_space_access_policies",
  });
}

async function insertDatabaseApiAccess(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  apiAccess: KnowledgeSpaceApiAccess,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "enabled",
    "disabled_at",
    "revision",
    "updated_by_subject_id",
    "created_at",
    "updated_at",
  ] as const;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      apiAccess.id,
      apiAccess.tenantId,
      apiAccess.knowledgeSpaceId,
      apiAccess.enabled,
      apiAccess.disabledAt ?? null,
      apiAccess.revision,
      apiAccess.updatedBySubjectId,
      apiAccess.createdAt,
      apiAccess.updatedAt,
    ],
    sql: insertSql(database, "knowledge_space_api_access", columns),
    tableName: "knowledge_space_api_access",
  });
}

async function insertDatabasePolicyMember(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceAccessScope & {
    readonly accessPolicyId: string;
    readonly createdAt: string;
    readonly id: string;
    readonly subjectId: string;
  },
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "access_policy_id",
    "subject_id",
    "created_at",
  ] as const;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      input.id,
      input.tenantId,
      input.knowledgeSpaceId,
      input.accessPolicyId,
      input.subjectId,
      input.createdAt,
    ],
    sql: insertSql(database, "knowledge_space_access_policy_members", columns),
    tableName: "knowledge_space_access_policy_members",
  });
}

async function insertDatabasePermissionSnapshot(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  snapshot: KnowledgeSpacePermissionSnapshot,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "subject_id",
    "role",
    "visibility",
    "access_channel",
    "member_revision",
    "access_policy_revision",
    "api_access_revision",
    "api_key_id",
    "api_key_revision",
    "api_key_expires_at",
    "permission_scopes",
    "status",
    "revision",
    "expires_at",
    "revoked_at",
    "created_at",
    "updated_at",
  ] as const;
  const params = [
    snapshot.id,
    snapshot.tenantId,
    snapshot.knowledgeSpaceId,
    snapshot.subjectId,
    snapshot.role,
    snapshot.visibility,
    snapshot.accessChannel,
    snapshot.memberRevision,
    snapshot.accessPolicyRevision,
    snapshot.apiAccessRevision,
    snapshot.apiKeyId ?? null,
    snapshot.apiKeyRevision ?? null,
    snapshot.apiKeyExpiresAt ?? null,
    JSON.stringify(snapshot.permissionScopes),
    snapshot.status,
    snapshot.revision,
    snapshot.expiresAt,
    snapshot.revokedAt ?? null,
    snapshot.createdAt,
    snapshot.updatedAt,
  ] satisfies readonly DatabaseQueryValue[];
  const placeholders = columns.map((column, index) => {
    const placeholder = p(database, index + 1);
    if (column === "permission_scopes") {
      return database.dialect === "postgres"
        ? `${placeholder}::jsonb`
        : `CAST(${placeholder} AS JSON)`;
    }
    return placeholder;
  });
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, "knowledge_space_permission_snapshots")} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${placeholders.join(", ")});`,
    tableName: "knowledge_space_permission_snapshots",
  });
}

function insertSql(
  database: DatabaseAdapter,
  tableName: string,
  columns: readonly string[],
): string {
  return `INSERT INTO ${q(database, tableName)} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${columns.map((_, index) => p(database, index + 1)).join(", ")});`;
}

function selectPolicySql(database: DatabaseAdapter, lock: boolean): string {
  return `SELECT * FROM ${q(database, "knowledge_space_access_policies")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)}${lock ? " FOR UPDATE" : ""};`;
}

function selectApiAccessSql(database: DatabaseAdapter, lock: boolean): string {
  return `SELECT * FROM ${q(database, "knowledge_space_api_access")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)}${lock ? " FOR UPDATE" : ""};`;
}

function revalidatePermissionSnapshotSql(database: DatabaseAdapter): string {
  const s = "s";
  const m = "m";
  const policy = "policy";
  const api = "api";
  const key = "api_key";
  const target = "target";
  const apiKeyJoin = ` LEFT JOIN ${q(database, "knowledge_space_api_keys")} ${key} ON ${key}.${q(database, "tenant_id")} = ${s}.${q(database, "tenant_id")} AND ${key}.${q(database, "knowledge_space_id")} = ${s}.${q(database, "knowledge_space_id")} AND ${key}.${q(database, "id")} = ${s}.${q(database, "api_key_id")}`;
  const apiKeyPredicate = `((${s}.${q(database, "api_key_id")} IS NULL AND ${s}.${q(database, "api_key_revision")} IS NULL AND ${s}.${q(database, "api_key_expires_at")} IS NULL) OR (${s}.${q(database, "api_key_id")} IS NOT NULL AND ${s}.${q(database, "api_key_revision")} = ${key}.${q(database, "revision")} AND ${s}.${q(database, "access_channel")} = 'service_api' AND ${key}.${q(database, "status")} = 'active' AND ${key}.${q(database, "revoked_at")} IS NULL AND ${key}.${q(database, "principal_subject_id")} = ${s}.${q(database, "subject_id")} AND ((${s}.${q(database, "api_key_expires_at")} IS NULL AND ${key}.${q(database, "expires_at")} IS NULL) OR ${s}.${q(database, "api_key_expires_at")} = ${key}.${q(database, "expires_at")}) AND (${key}.${q(database, "expires_at")} IS NULL OR ${key}.${q(database, "expires_at")} > ${p(database, 6)})))`;
  return `SELECT ${s}.* FROM ${q(database, "knowledge_space_permission_snapshots")} ${s} INNER JOIN ${q(database, "knowledge_space_members")} ${m} ON ${m}.${q(database, "tenant_id")} = ${s}.${q(database, "tenant_id")} AND ${m}.${q(database, "knowledge_space_id")} = ${s}.${q(database, "knowledge_space_id")} AND ${m}.${q(database, "subject_id")} = ${s}.${q(database, "subject_id")} INNER JOIN ${q(database, "knowledge_space_access_policies")} ${policy} ON ${policy}.${q(database, "tenant_id")} = ${s}.${q(database, "tenant_id")} AND ${policy}.${q(database, "knowledge_space_id")} = ${s}.${q(database, "knowledge_space_id")} INNER JOIN ${q(database, "knowledge_space_api_access")} ${api} ON ${api}.${q(database, "tenant_id")} = ${s}.${q(database, "tenant_id")} AND ${api}.${q(database, "knowledge_space_id")} = ${s}.${q(database, "knowledge_space_id")}${apiKeyJoin} WHERE ${s}.${q(database, "tenant_id")} = ${p(database, 1)} AND ${s}.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${s}.${q(database, "id")} = ${p(database, 3)} AND ${s}.${q(database, "subject_id")} = ${p(database, 4)} AND ${s}.${q(database, "access_channel")} = ${p(database, 5)} AND ${s}.${q(database, "status")} = 'active' AND ${s}.${q(database, "expires_at")} > ${p(database, 6)} AND ${s}.${q(database, "member_revision")} = ${m}.${q(database, "revision")} AND ${s}.${q(database, "access_policy_revision")} = ${policy}.${q(database, "revision")} AND ${s}.${q(database, "api_access_revision")} = ${api}.${q(database, "revision")} AND ${s}.${q(database, "role")} = ${m}.${q(database, "role")} AND ${s}.${q(database, "visibility")} = ${policy}.${q(database, "visibility")} AND (${s}.${q(database, "access_channel")} = 'interactive' OR ${api}.${q(database, "enabled")} = TRUE) AND ${apiKeyPredicate} AND ((${policy}.${q(database, "visibility")} = 'only_me' AND ${policy}.${q(database, "owner_subject_id")} = ${s}.${q(database, "subject_id")}) OR ${policy}.${q(database, "visibility")} = 'all_members' OR (${policy}.${q(database, "visibility")} = 'partial_members' AND EXISTS (SELECT 1 FROM ${q(database, "knowledge_space_access_policy_members")} ${target} WHERE ${target}.${q(database, "tenant_id")} = ${s}.${q(database, "tenant_id")} AND ${target}.${q(database, "knowledge_space_id")} = ${s}.${q(database, "knowledge_space_id")} AND ${target}.${q(database, "access_policy_id")} = ${policy}.${q(database, "id")} AND ${target}.${q(database, "subject_id")} = ${s}.${q(database, "subject_id")})));`;
}

function databaseMember(row: DatabaseRow): KnowledgeSpaceMember {
  const role = stringColumn(row, "role");
  if (!isMemberRole(role)) {
    throw new Error(`Database knowledge-space member role=${role} is invalid`);
  }
  return createMember({
    createdAt: stringColumn(row, "created_at"),
    createdBySubjectId: stringColumn(row, "created_by_subject_id"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    revision: positiveDatabaseRevision(row, "revision"),
    role,
    subjectId: stringColumn(row, "subject_id"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function databasePolicy(row: DatabaseRow): KnowledgeSpaceAccessPolicy {
  const visibility = stringColumn(row, "visibility");
  if (!isVisibility(visibility)) {
    throw new Error(`Database knowledge-space visibility=${visibility} is invalid`);
  }
  return createPolicy({
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ownerSubjectId: stringColumn(row, "owner_subject_id"),
    revision: positiveDatabaseRevision(row, "revision"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    updatedBySubjectId: stringColumn(row, "updated_by_subject_id"),
    visibility,
  });
}

function databaseApiAccess(row: DatabaseRow): KnowledgeSpaceApiAccess {
  const disabledAt = optionalStringColumn(row, "disabled_at");
  return createApiAccess({
    createdAt: stringColumn(row, "created_at"),
    ...(disabledAt ? { disabledAt } : {}),
    enabled: databaseBoolean(row, "enabled"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    revision: positiveDatabaseRevision(row, "revision"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    updatedBySubjectId: stringColumn(row, "updated_by_subject_id"),
  });
}

function databaseApiKey(row: DatabaseRow): KnowledgeSpaceApiKey {
  const status = stringColumn(row, "status");
  if (status !== "active" && status !== "revoked") {
    throw new Error(`Database knowledge-space API key status=${status} is invalid`);
  }
  const expiresAt = optionalStringColumn(row, "expires_at");
  const lastUsedAt = optionalStringColumn(row, "last_used_at");
  const revokedAt = optionalStringColumn(row, "revoked_at");
  return createApiKeyRecord({
    createdAt: stringColumn(row, "created_at"),
    createdBySubjectId: stringColumn(row, "created_by_subject_id"),
    ...(expiresAt ? { expiresAt } : {}),
    id: stringColumn(row, "id"),
    keyHash: stringColumn(row, "key_hash"),
    keyPrefix: stringColumn(row, "key_prefix"),
    ...(lastUsedAt ? { lastUsedAt } : {}),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    name: stringColumn(row, "name"),
    principalSubjectId: stringColumn(row, "principal_subject_id"),
    revision: positiveDatabaseRevision(row, "revision"),
    ...(revokedAt ? { revokedAt } : {}),
    status,
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function databasePermissionSnapshot(row: DatabaseRow): KnowledgeSpacePermissionSnapshot {
  const role = stringColumn(row, "role");
  const visibility = stringColumn(row, "visibility");
  const accessChannel = stringColumn(row, "access_channel");
  const status = stringColumn(row, "status");
  if (!isMemberRole(role) || !isVisibility(visibility) || !isAccessChannel(accessChannel)) {
    throw new Error("Database knowledge-space permission snapshot enum value is invalid");
  }
  if (status !== "active" && status !== "revoked" && status !== "expired") {
    throw new Error(`Database knowledge-space permission snapshot status=${status} is invalid`);
  }
  const revokedAt = optionalStringColumn(row, "revoked_at");
  const apiKeyId = optionalStringColumn(row, "api_key_id");
  const apiKeyExpiresAt = optionalStringColumn(row, "api_key_expires_at");
  const apiKeyRevision = optionalPositiveDatabaseRevision(row, "api_key_revision");
  return createPermissionSnapshotRecord({
    accessChannel,
    accessPolicyRevision: positiveDatabaseRevision(row, "access_policy_revision"),
    apiAccessRevision: positiveDatabaseRevision(row, "api_access_revision"),
    ...(apiKeyExpiresAt ? { apiKeyExpiresAt } : {}),
    ...(apiKeyId ? { apiKeyId } : {}),
    ...(apiKeyRevision ? { apiKeyRevision } : {}),
    createdAt: stringColumn(row, "created_at"),
    expiresAt: stringColumn(row, "expires_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    memberRevision: positiveDatabaseRevision(row, "member_revision"),
    permissionScopes: databaseStringArray(row, "permission_scopes"),
    revision: positiveDatabaseRevision(row, "revision"),
    ...(revokedAt ? { revokedAt } : {}),
    role,
    status,
    subjectId: stringColumn(row, "subject_id"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    visibility,
  });
}

function databaseBoolean(row: DatabaseRow, column: string): boolean {
  const value = row[column];
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }
  throw new Error(`Database row column ${column} must be a boolean`);
}

function databaseStringArray(row: DatabaseRow, column: string): readonly string[] {
  const value = row[column];
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`Database row column ${column} must be a JSON string array`);
    }
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Database row column ${column} must be a JSON string array`);
  }
  return [...parsed];
}

function positiveDatabaseRevision(row: DatabaseRow, column: string): number {
  const value = numberColumn(row, column);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Database row column ${column} must be a positive integer`);
  }
  return value;
}

function optionalPositiveDatabaseRevision(row: DatabaseRow, column: string): number | undefined {
  if (row[column] === null || row[column] === undefined) {
    return undefined;
  }
  return positiveDatabaseRevision(row, column);
}

function isMemberRole(value: string): value is KnowledgeSpaceMemberRole {
  return KNOWLEDGE_SPACE_MEMBER_ROLES.includes(value as KnowledgeSpaceMemberRole);
}

function isVisibility(value: string): value is KnowledgeSpaceVisibility {
  return KNOWLEDGE_SPACE_VISIBILITIES.includes(value as KnowledgeSpaceVisibility);
}

function isAccessChannel(value: string): value is KnowledgeSpaceAccessChannel {
  return KNOWLEDGE_SPACE_ACCESS_CHANNELS.includes(value as KnowledgeSpaceAccessChannel);
}

function requireSingleCasWrite(rowsAffected: number, expected: number, actual: number): void {
  if (rowsAffected !== 1) {
    throw new KnowledgeSpaceAccessRevisionConflictError(expected, actual);
  }
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
function validateRepositoryBounds({
  maxApiKeysPerSpace,
  maxListLimit,
  maxMembersPerSpace,
}: {
  readonly maxApiKeysPerSpace: number;
  readonly maxListLimit: number;
  readonly maxMembersPerSpace: number;
}): void {
  for (const [name, value] of [
    ["maxApiKeysPerSpace", maxApiKeysPerSpace],
    ["maxListLimit", maxListLimit],
    ["maxMembersPerSpace", maxMembersPerSpace],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Knowledge-space access ${name} must be a positive integer`);
    }
  }
}

function validateScope(scope: KnowledgeSpaceAccessScope): void {
  if (!scope.tenantId.trim() || scope.tenantId.length > 255) {
    throw new Error("Knowledge-space access tenantId must contain 1-255 characters");
  }
  if (!scope.knowledgeSpaceId.trim()) {
    throw new Error("Knowledge-space access knowledgeSpaceId is required");
  }
}

function validateSubjectId(subjectId: string): void {
  if (!subjectId.trim() || subjectId.length > 255) {
    throw new Error("Knowledge-space access subjectId must contain 1-255 characters");
  }
}

function validateListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new Error(`Knowledge-space access list limit must be between 1 and ${maxListLimit}`);
  }
}

function validateMemberMutation(input: SetKnowledgeSpaceMemberRoleInput): void {
  validateScope(input);
  validateSubjectId(input.actorSubjectId);
  validateSubjectId(input.subjectId);
  if (!KNOWLEDGE_SPACE_MEMBER_ROLES.includes(input.role)) {
    throw new Error("Knowledge-space member role is invalid");
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("Knowledge-space member expectedRevision must be nonnegative");
  }
}

function validatePolicyMutation(input: UpdateKnowledgeSpaceAccessPolicyInput): void {
  validateScope(input);
  validateSubjectId(input.actorSubjectId);
  if (!KNOWLEDGE_SPACE_VISIBILITIES.includes(input.visibility)) {
    throw new Error("Knowledge-space visibility is invalid");
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error("Knowledge-space policy expectedRevision must be positive");
  }
}

function validatePartialMembers(
  input: UpdateKnowledgeSpaceAccessPolicyInput,
  members: ReadonlyMap<string, KnowledgeSpaceMember>,
): readonly string[] {
  const partialMembers = sortedStrings(
    new Set(
      input.partialMemberSubjectIds.map((subjectId) => {
        validateSubjectId(subjectId);
        return subjectId;
      }),
    ),
  );
  if (input.visibility === "partial_members" && partialMembers.length === 0) {
    throw new KnowledgeSpaceAccessError(
      "space_access_partial_members_required",
      "partial_members visibility requires at least one member",
    );
  }
  if (input.visibility === "partial_members" && !partialMembers.includes(input.actorSubjectId)) {
    throw new KnowledgeSpaceAccessError(
      "space_access_policy_owner",
      "A partial_members policy must include the owner applying the policy",
    );
  }
  if (input.visibility !== "partial_members" && partialMembers.length > 0) {
    throw new Error("Partial member subjects are only valid for partial_members visibility");
  }
  for (const subjectId of partialMembers) {
    if (!members.has(subjectId)) {
      throw partialMemberNotFound(subjectId);
    }
  }
  return partialMembers;
}

function validateCreateApiKey(input: CreateKnowledgeSpaceApiKeyInput, timestamp: string): void {
  validateScope(input);
  validateSubjectId(input.createdBySubjectId);
  validateSubjectId(input.principalSubjectId);
  if (!input.id.trim()) {
    throw new Error("Knowledge-space API key id is required");
  }
  if (!input.name.trim() || input.name.length > 160) {
    throw new Error("Knowledge-space API key name must contain 1-160 characters");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.keyHash)) {
    throw new Error("Knowledge-space API key hash must be a lowercase SHA-256 digest");
  }
  if (!input.keyPrefix.trim() || input.keyPrefix.length > 24) {
    throw new Error("Knowledge-space API key prefix must contain 1-24 characters");
  }
  if (
    input.expiresAt &&
    (Number.isNaN(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(timestamp))
  ) {
    throw invalidRequest("Knowledge-space API key expiresAt must be a future ISO timestamp");
  }
}

function validateSnapshotInput(
  input: CreateKnowledgeSpacePermissionSnapshotInput,
  timestamp: string,
): void {
  validateScope(input);
  validateSubjectId(input.subjectId);
  if (!KNOWLEDGE_SPACE_ACCESS_CHANNELS.includes(input.accessChannel)) {
    throw new Error("Knowledge-space permission snapshot access channel is invalid");
  }
  if (
    Number.isNaN(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(timestamp)
  ) {
    throw invalidRequest("Knowledge-space permission snapshot expiry must be in the future");
  }
}

function validatePermissionSnapshotApiKeyBinding(input: {
  readonly binding?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
  readonly member: Pick<KnowledgeSpaceMember, "subjectId">;
  readonly snapshotAccessChannel: KnowledgeSpaceAccessChannel;
  readonly snapshotExpiresAt: string;
  readonly storedApiKey?: KnowledgeSpaceApiKey | undefined;
  readonly timestamp: string;
}): KnowledgeSpaceApiKey | undefined {
  if (!input.binding) {
    return undefined;
  }
  const binding = input.binding;
  const stored = input.storedApiKey;
  if (
    input.snapshotAccessChannel !== "service_api" ||
    !binding.id.trim() ||
    !Number.isSafeInteger(binding.revision) ||
    binding.revision < 1 ||
    !stored ||
    stored.id !== binding.id ||
    stored.revision !== binding.revision ||
    stored.principalSubjectId !== input.member.subjectId ||
    stored.status !== "active" ||
    stored.revokedAt !== undefined ||
    stored.expiresAt !== binding.expiresAt ||
    (stored.expiresAt !== undefined &&
      (Date.parse(stored.expiresAt) <= Date.parse(input.timestamp) ||
        Date.parse(input.snapshotExpiresAt) > Date.parse(stored.expiresAt)))
  ) {
    throw invalidPermissionSnapshot();
  }
  return stored;
}

function isPermissionSnapshotApiKeyBindingCurrent(
  snapshot: KnowledgeSpacePermissionSnapshot,
  storedApiKey: KnowledgeSpaceApiKey | undefined,
  timestamp: string,
): boolean {
  const hasId = snapshot.apiKeyId !== undefined;
  const hasRevision = snapshot.apiKeyRevision !== undefined;
  const hasExpiresAt = snapshot.apiKeyExpiresAt !== undefined;
  if (!hasId && !hasRevision && !hasExpiresAt) {
    return true;
  }
  return (
    hasId &&
    hasRevision &&
    snapshot.accessChannel === "service_api" &&
    storedApiKey !== undefined &&
    storedApiKey.id === snapshot.apiKeyId &&
    storedApiKey.revision === snapshot.apiKeyRevision &&
    storedApiKey.principalSubjectId === snapshot.subjectId &&
    storedApiKey.status === "active" &&
    storedApiKey.revokedAt === undefined &&
    storedApiKey.expiresAt === snapshot.apiKeyExpiresAt &&
    (storedApiKey.expiresAt === undefined ||
      Date.parse(storedApiKey.expiresAt) > Date.parse(timestamp))
  );
}

function validatePermissionScopes(permissionScopes: readonly string[]): void {
  if (new Set(permissionScopes).size !== permissionScopes.length) {
    throw new Error("Knowledge-space permission snapshot scopes must be unique");
  }
  for (const scope of permissionScopes) {
    if (!scope.trim() || scope.length > 512) {
      throw new Error("Knowledge-space permission snapshot scope is invalid");
    }
  }
}

function requireOwner(aggregate: InMemoryAccessAggregate, subjectId: string): void {
  if (aggregate.members.get(subjectId)?.role !== "owner") {
    throw forbidden();
  }
}

function assertCanChangeOrRemoveMember(
  aggregate: InMemoryAccessAggregate,
  existing: KnowledgeSpaceMember,
  nextRole: KnowledgeSpaceMemberRole | undefined,
): void {
  if (
    existing.role === "owner" &&
    nextRole !== "owner" &&
    [...aggregate.members.values()].filter((member) => member.role === "owner").length === 1
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_last_owner",
      "A knowledge space must retain at least one owner",
    );
  }
  if (existing.subjectId === aggregate.policy.ownerSubjectId && nextRole !== "owner") {
    throw new KnowledgeSpaceAccessError(
      "space_access_policy_owner",
      "The policy owner must be transferred before this member can be demoted or removed",
    );
  }
}

function assertPartialPolicySurvivesRemoval(
  aggregate: InMemoryAccessAggregate,
  subjectId: string,
): void {
  if (
    aggregate.policy.visibility === "partial_members" &&
    aggregate.partialMemberSubjectIds.has(subjectId) &&
    aggregate.partialMemberSubjectIds.size === 1
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_partial_members_required",
      "Removing this member would leave a partial_members policy empty",
    );
  }
}

function canAccessAggregate(
  aggregate: InMemoryAccessAggregate,
  member: KnowledgeSpaceMember,
  accessChannel: KnowledgeSpaceAccessChannel,
): boolean {
  if (accessChannel !== "interactive" && !aggregate.apiAccess.enabled) {
    return false;
  }
  if (aggregate.policy.visibility === "only_me") {
    return member.subjectId === aggregate.policy.ownerSubjectId;
  }
  if (aggregate.policy.visibility === "all_members") {
    return true;
  }
  return aggregate.partialMemberSubjectIds.has(member.subjectId);
}

export function buildKnowledgeSpacePermissionScopes(input: {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly context: KnowledgeSpaceAccessContext;
  readonly knowledgeSpaceId: string;
  readonly subjectId: string;
  readonly tenantId: string;
}): readonly string[] {
  validateScope(input);
  validateSubjectId(input.subjectId);
  if (input.context.member.subjectId !== input.subjectId) {
    throw new Error("Knowledge-space permission scope member does not match subjectId");
  }
  const visibilityGrant =
    input.context.policy.visibility === "all_members"
      ? `knowledge-space:${input.knowledgeSpaceId}:visibility:all_members`
      : `knowledge-space:${input.knowledgeSpaceId}:visibility:${input.context.policy.visibility}:${input.subjectId}`;
  return [
    `tenant:${input.tenantId}`,
    `knowledge-space:${input.knowledgeSpaceId}`,
    `knowledge-space:${input.knowledgeSpaceId}:member:${input.subjectId}`,
    `knowledge-space:${input.knowledgeSpaceId}:role:${input.context.member.role}`,
    visibilityGrant,
  ].sort();
}

function requireRevision(expected: number, actual: number): void {
  if (expected !== actual) {
    throw new KnowledgeSpaceAccessRevisionConflictError(expected, actual);
  }
}

function accessScopeKey(scope: KnowledgeSpaceAccessScope): string {
  return `${scope.tenantId}\u0000${scope.knowledgeSpaceId}`;
}

function accessNotFound(): KnowledgeSpaceAccessError {
  return new KnowledgeSpaceAccessError(
    "space_access_not_found",
    "Knowledge-space access state was not found",
  );
}

function forbidden(): KnowledgeSpaceAccessError {
  return new KnowledgeSpaceAccessError(
    "space_access_forbidden",
    "The subject is not allowed to manage this knowledge-space access state",
  );
}

function partialMemberNotFound(subjectId: string): KnowledgeSpaceAccessError {
  return new KnowledgeSpaceAccessError(
    "space_access_partial_member_not_found",
    `Knowledge-space member subjectId=${subjectId} was not found`,
  );
}

function capacityExceeded(kind: string, maximum: number): KnowledgeSpaceAccessError {
  return new KnowledgeSpaceAccessError(
    "space_access_capacity_exceeded",
    `Knowledge-space access ${kind} capacity ${maximum} exceeded`,
  );
}

function invalidPermissionSnapshot(): KnowledgeSpaceAccessError {
  return new KnowledgeSpaceAccessError(
    "space_access_permission_snapshot_invalid",
    "The permission snapshot is missing, revoked, expired, stale, or outside its access scope",
  );
}

function invalidRequest(message: string): KnowledgeSpaceAccessError {
  return new KnowledgeSpaceAccessError("space_access_invalid_request", message);
}

function sortedStrings(values: Iterable<string>): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function createMember(input: KnowledgeSpaceMember): KnowledgeSpaceMember {
  return { ...input };
}

function createPolicy(input: KnowledgeSpaceAccessPolicy): KnowledgeSpaceAccessPolicy {
  return { ...input };
}

function createApiAccess(input: KnowledgeSpaceApiAccess): KnowledgeSpaceApiAccess {
  return { ...input };
}

function updatedApiAccess(
  existing: KnowledgeSpaceApiAccess,
  enabled: boolean,
  actorSubjectId: string,
  timestamp: string,
): KnowledgeSpaceApiAccess {
  const { disabledAt: _disabledAt, ...stable } = existing;
  return createApiAccess({
    ...stable,
    ...(enabled ? {} : { disabledAt: timestamp }),
    enabled,
    revision: existing.revision + 1,
    updatedAt: timestamp,
    updatedBySubjectId: actorSubjectId,
  });
}

function createApiKeyRecord(input: KnowledgeSpaceApiKey): KnowledgeSpaceApiKey {
  return { ...input };
}

function createPermissionSnapshotRecord(
  input: KnowledgeSpacePermissionSnapshot,
): KnowledgeSpacePermissionSnapshot {
  return { ...input, permissionScopes: [...input.permissionScopes] };
}

function cloneMember(member: KnowledgeSpaceMember): KnowledgeSpaceMember {
  return { ...member };
}

function clonePolicy(policy: KnowledgeSpaceAccessPolicy): KnowledgeSpaceAccessPolicy {
  return { ...policy };
}

function cloneApiAccess(apiAccess: KnowledgeSpaceApiAccess): KnowledgeSpaceApiAccess {
  return { ...apiAccess };
}

function cloneApiKey(apiKey: KnowledgeSpaceApiKey): KnowledgeSpaceApiKey {
  return { ...apiKey };
}

function clonePermissionSnapshot(
  snapshot: KnowledgeSpacePermissionSnapshot,
): KnowledgeSpacePermissionSnapshot {
  return { ...snapshot, permissionScopes: [...snapshot.permissionScopes] };
}

function cloneAccessContext(context: KnowledgeSpaceAccessContext): KnowledgeSpaceAccessContext {
  return {
    apiAccess: { ...context.apiAccess },
    member: { ...context.member },
    partialMemberSubjectIds: [...context.partialMemberSubjectIds],
    policy: { ...context.policy },
  };
}

function toApiKeySummary(apiKey: KnowledgeSpaceApiKey): KnowledgeSpaceApiKeySummary {
  const { keyHash: _keyHash, ...summary } = apiKey;
  return { ...summary };
}

interface ApiKeyCursor {
  readonly createdAt: string;
  readonly id: string;
}

function encodeApiKeyCursor(apiKey: ApiKeyCursor): string {
  return Buffer.from(JSON.stringify(apiKey), "utf8").toString("base64url");
}

function decodeApiKeyCursor(cursor: string): ApiKeyCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      throw new Error("invalid shape");
    }
    return parsed as ApiKeyCursor;
  } catch {
    throw new Error("Knowledge-space API key cursor is invalid");
  }
}

function compareApiKeys(left: ApiKeyCursor, right: ApiKeyCursor): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareApiKeyCursor(apiKey: ApiKeyCursor, cursor: ApiKeyCursor): number {
  return compareApiKeys(apiKey, cursor);
}
