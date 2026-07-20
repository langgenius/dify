import type { AuthSubject } from "@knowledge/core";

import type { AgentWorkspaceReplay, AgentWorkspaceSnapshot } from "./agent-workspace-snapshot";
import { omitKnowledgeFsReservedMetadata } from "./knowledge-fs-reserved-metadata";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpaceApiKeyPermissionBinding,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceCallerKind,
  type KnowledgeSpaceRequiredAccess,
  knowledgeSpaceAccessChannelForCallerKind,
  revalidateKnowledgeSpaceDurablePermission,
} from "./knowledge-space-authorization";
import type { ResearchTaskJob } from "./research-task-job";

export class DerivedResultOwnerMismatchError extends Error {
  constructor() {
    super("Derived result not found");
    this.name = "DerivedResultOwnerMismatchError";
  }
}

export async function issueKnowledgeSpaceDurablePermission(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly expiresAt: string;
  readonly knowledgeSpaceId: string;
  readonly requiredAccess: KnowledgeSpaceRequiredAccess;
  readonly subject: AuthSubject;
}): Promise<KnowledgeSpacePermissionSnapshot> {
  await input.authorization.authorize({
    callerKind: input.callerKind,
    knowledgeSpaceId: input.knowledgeSpaceId,
    requiredAccess: input.requiredAccess,
    subject: input.subject,
  });
  if (input.callerKind === "api_key" && !input.apiKey) {
    throw accessDenied();
  }
  let snapshot: KnowledgeSpacePermissionSnapshot;
  try {
    snapshot = await input.access.createPermissionSnapshot({
      accessChannel: knowledgeSpaceAccessChannelForCallerKind(input.callerKind),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      expiresAt: input.expiresAt,
      knowledgeSpaceId: input.knowledgeSpaceId,
      subjectId: input.subject.subjectId,
      tenantId: input.subject.tenantId,
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAccessError) {
      throw accessDenied();
    }
    throw error;
  }
  if (!roleAllows(snapshot.role, input.requiredAccess)) {
    throw accessDenied();
  }
  return snapshot;
}

export async function authorizeResearchTaskDerivedResult(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly currentApiKeyId?: string | undefined;
  readonly job: ResearchTaskJob;
  readonly requiredAccess: "read" | "write";
  readonly subject: AuthSubject;
}): Promise<KnowledgeSpacePermissionSnapshot> {
  if (
    input.job.subjectId !== input.subject.subjectId ||
    input.job.tenantId !== input.subject.tenantId
  ) {
    throw new DerivedResultOwnerMismatchError();
  }
  const snapshot = await revalidateKnowledgeSpaceDurablePermission({
    access: input.access,
    callerKind: input.callerKind,
    currentApiKeyId: input.currentApiKeyId,
    knowledgeSpaceId: input.job.knowledgeSpaceId,
    permissionSnapshot: input.job.permissionSnapshot,
    subject: input.subject,
  });
  await input.authorization.authorize({
    callerKind: input.callerKind,
    knowledgeSpaceId: input.job.knowledgeSpaceId,
    requiredAccess: input.requiredAccess,
    subject: input.subject,
  });
  return snapshot;
}

export async function authorizeAgentWorkspaceDerivedResult(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly currentApiKeyId?: string | undefined;
  readonly requiredAccess: "read" | "write";
  readonly snapshot: AgentWorkspaceSnapshot;
  readonly subject: AuthSubject;
}): Promise<KnowledgeSpacePermissionSnapshot> {
  const reference = input.snapshot.permissionSnapshot;
  if (
    input.snapshot.tenantId !== input.subject.tenantId ||
    reference.subjectId !== input.subject.subjectId ||
    reference.tenantId !== input.subject.tenantId ||
    !reference.accessChannel ||
    !reference.id ||
    !reference.revision
  ) {
    throw new DerivedResultOwnerMismatchError();
  }
  const durablePermission = await revalidateKnowledgeSpaceDurablePermission({
    access: input.access,
    callerKind: input.callerKind,
    currentApiKeyId: input.currentApiKeyId,
    knowledgeSpaceId: input.snapshot.knowledgeSpaceId,
    permissionSnapshot: {
      accessChannel: reference.accessChannel,
      id: reference.id,
      revision: reference.revision,
    },
    subject: input.subject,
  });
  await input.authorization.authorize({
    callerKind: input.callerKind,
    knowledgeSpaceId: input.snapshot.knowledgeSpaceId,
    requiredAccess: input.requiredAccess,
    subject: input.subject,
  });
  return durablePermission;
}

/** Explicit allow-list: broker, lease, ACL provenance, and tenant fencing never become API data. */
export function toPublicResearchTaskJob(job: ResearchTaskJob) {
  return {
    budgetUsd: job.budgetUsd,
    completedAt: job.completedAt,
    cost: job.cost,
    createdAt: job.createdAt,
    error: job.error,
    id: job.id,
    knowledgeSpaceId: job.knowledgeSpaceId,
    limits: job.limits,
    metadata: omitKnowledgeFsReservedMetadata(job.metadata),
    mode: job.mode,
    query: job.query,
    stage: job.stage,
    topK: job.topK,
    updatedAt: job.updatedAt,
  };
}

export function toPublicAgentWorkspaceSnapshot(
  snapshot: AgentWorkspaceSnapshot,
): Omit<AgentWorkspaceSnapshot, "permissionSnapshot" | "tenantId"> {
  const { permissionSnapshot: _permissionSnapshot, tenantId: _tenantId, ...response } = snapshot;
  return response;
}

export function toPublicAgentWorkspaceReplay(
  replay: AgentWorkspaceReplay,
): Omit<AgentWorkspaceReplay, "tenantId"> {
  const { tenantId: _tenantId, ...response } = replay;
  return response;
}

const MCP_INTERNAL_DERIVED_RESULT_KEYS = new Set([
  "apiKeyId",
  "executionAttempts",
  "heartbeatAt",
  "leaseExpiresAt",
  "leaseToken",
  "maxExecutionAttempts",
  "permissionScope",
  "permissionSnapshot",
  "permissionSnapshotVersion",
  "queueJobId",
  "retryAt",
  "rowVersion",
  "subjectId",
  "tenantId",
  "workerId",
]);

/** Removes durable ACL, tenancy, broker, lease, and fencing data from both MCP result forms. */
export function toMcpPublicDerivedResult(value: object): Record<string, unknown> {
  return redactMcpInternalDerivedResultFields(value) as Record<string, unknown>;
}

function redactMcpInternalDerivedResultFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMcpInternalDerivedResultFields);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !MCP_INTERNAL_DERIVED_RESULT_KEYS.has(key))
      .map(([key, entry]) => [key, redactMcpInternalDerivedResultFields(entry)]),
  );
}

function roleAllows(
  role: KnowledgeSpacePermissionSnapshot["role"],
  requiredAccess: KnowledgeSpaceRequiredAccess,
): boolean {
  if (requiredAccess === "read") {
    return true;
  }
  if (requiredAccess === "write") {
    return role === "owner" || role === "editor";
  }
  return role === "owner";
}

function accessDenied(): KnowledgeSpaceAuthorizationError {
  return new KnowledgeSpaceAuthorizationError(
    "KNOWLEDGE_SPACE_ACCESS_DENIED",
    "Knowledge space access denied",
  );
}
