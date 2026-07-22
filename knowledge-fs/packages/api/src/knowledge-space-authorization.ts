import type { AuthSubject } from "@knowledge/core";

import {
  KNOWLEDGE_SPACE_MEMBER_ROLES,
  KNOWLEDGE_SPACE_VISIBILITIES,
  type KnowledgeSpaceAccessChannel,
  type KnowledgeSpaceAccessContext,
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
  type KnowledgeSpaceMemberRole,
  type KnowledgeSpacePermissionSnapshot,
  type KnowledgeSpaceVisibility,
  buildKnowledgeSpacePermissionScopes,
} from "./knowledge-space-access-control";

export const KnowledgeSpaceCallerKinds = [
  "interactive",
  "service_api",
  "api_key",
  "mcp",
  "agent",
] as const;
export type KnowledgeSpaceCallerKind = (typeof KnowledgeSpaceCallerKinds)[number];

export const KnowledgeSpaceRequiredAccessValues = ["read", "write", "admin"] as const;
export type KnowledgeSpaceRequiredAccess = (typeof KnowledgeSpaceRequiredAccessValues)[number];

export type KnowledgeSpaceAuthorizationMemberRole = KnowledgeSpaceMemberRole;
export type KnowledgeSpaceAuthorizationVisibility = KnowledgeSpaceVisibility;
export type KnowledgeSpaceAuthorizationAccessContext = KnowledgeSpaceAccessContext;

export interface KnowledgeSpaceAuthorizationAccessReader {
  getAccessContext(input: {
    readonly knowledgeSpaceId: string;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<KnowledgeSpaceAuthorizationAccessContext | null>;
}

/**
 * Immutable, server-issued grants that are safe to pass to candidate repositories.  The caller's
 * bearer scopes are deliberately absent: those scopes authenticate the outer API operation, but
 * they do not prove knowledge-space or document visibility.
 */
export interface KnowledgeSpaceCandidatePermissionSnapshot {
  readonly apiAccessRevision: number;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly candidateGrants: readonly string[];
  readonly issuedAt: string;
  readonly knowledgeSpaceId: string;
  readonly memberRevision: number;
  readonly memberRole: KnowledgeSpaceAuthorizationMemberRole;
  readonly policyRevision: number;
  readonly subjectId: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceAuthorizationDecision {
  readonly accessContext: KnowledgeSpaceAuthorizationAccessContext;
  readonly permissionSnapshot: KnowledgeSpaceCandidatePermissionSnapshot;
}

export interface KnowledgeSpaceDurablePermissionReference {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly id: string;
  readonly revision: number;
}

export interface KnowledgeSpaceAuthorizationInput {
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly knowledgeSpaceId: string;
  readonly requiredAccess: KnowledgeSpaceRequiredAccess;
  readonly subject: AuthSubject;
}

export type KnowledgeSpaceAuthorizationErrorCode =
  | "KNOWLEDGE_SPACE_ACCESS_DENIED"
  | "KNOWLEDGE_SPACE_API_ACCESS_DISABLED"
  | "KNOWLEDGE_SPACE_ROLE_DENIED"
  | "KNOWLEDGE_SPACE_VISIBILITY_DENIED";

export class KnowledgeSpaceAuthorizationError extends Error {
  readonly code: KnowledgeSpaceAuthorizationErrorCode;

  constructor(code: KnowledgeSpaceAuthorizationErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeSpaceAuthorizationError";
    this.code = code;
  }
}

export interface KnowledgeSpaceAuthorizationGuard {
  authorize(input: KnowledgeSpaceAuthorizationInput): Promise<KnowledgeSpaceAuthorizationDecision>;
}

export interface CreateKnowledgeSpaceAuthorizationGuardOptions {
  readonly access: KnowledgeSpaceAuthorizationAccessReader;
  readonly now?: (() => string) | undefined;
}

const externalCallerKinds: ReadonlySet<KnowledgeSpaceCallerKind> = new Set([
  "service_api",
  "api_key",
  "mcp",
  "agent",
]);

export function createKnowledgeSpaceAuthorizationGuard({
  access,
  now = () => new Date().toISOString(),
}: CreateKnowledgeSpaceAuthorizationGuardOptions): KnowledgeSpaceAuthorizationGuard {
  return {
    async authorize(input) {
      const normalized = normalizeAuthorizationInput(input);
      const accessContext = await access.getAccessContext({
        knowledgeSpaceId: normalized.knowledgeSpaceId,
        subjectId: normalized.subject.subjectId,
        tenantId: normalized.subject.tenantId,
      });

      if (!accessContext || accessContext.member.subjectId !== normalized.subject.subjectId) {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ACCESS_DENIED",
          "Knowledge space access denied",
        );
      }

      validateAccessContext(accessContext);

      if (externalCallerKinds.has(normalized.callerKind) && !accessContext.apiAccess.enabled) {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_API_ACCESS_DISABLED",
          "Knowledge space API access is disabled",
        );
      }

      if (!isVisibleToMember(accessContext)) {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_VISIBILITY_DENIED",
          "Knowledge space visibility does not include this member",
        );
      }

      if (!roleAllows(accessContext.member.role, normalized.requiredAccess)) {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ROLE_DENIED",
          "Knowledge space member role does not allow this operation",
        );
      }

      return {
        accessContext: cloneAccessContext(accessContext),
        permissionSnapshot: createKnowledgeSpaceCandidatePermissionSnapshot({
          accessContext,
          accessChannel: permissionSnapshotAccessChannel(normalized.callerKind),
          callerKind: normalized.callerKind,
          issuedAt: now(),
          knowledgeSpaceId: normalized.knowledgeSpaceId,
          subjectId: normalized.subject.subjectId,
          tenantId: normalized.subject.tenantId,
        }),
      };
    },
  };
}

export function createKnowledgeSpaceCandidatePermissionSnapshot(input: {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly accessContext: KnowledgeSpaceAuthorizationAccessContext;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly issuedAt: string;
  readonly knowledgeSpaceId: string;
  readonly subjectId: string;
  readonly tenantId: string;
}): KnowledgeSpaceCandidatePermissionSnapshot {
  validateAccessContext(input.accessContext);
  const tenantId = requiredString(input.tenantId, "tenantId");
  const knowledgeSpaceId = requiredString(input.knowledgeSpaceId, "knowledgeSpaceId");
  const subjectId = requiredString(input.subjectId, "subjectId");
  const issuedAt = validDateTime(input.issuedAt, "issuedAt");

  if (input.accessContext.member.subjectId !== subjectId) {
    throw new Error("Knowledge space permission snapshot member does not match subjectId");
  }

  const candidateGrants = buildKnowledgeSpacePermissionScopes({
    accessChannel: input.accessChannel,
    context: input.accessContext,
    knowledgeSpaceId,
    subjectId,
    tenantId,
  });

  return {
    apiAccessRevision: input.accessContext.apiAccess.revision,
    callerKind: input.callerKind,
    candidateGrants: [...candidateGrants],
    issuedAt,
    knowledgeSpaceId,
    memberRevision: input.accessContext.member.revision,
    memberRole: input.accessContext.member.role,
    policyRevision: input.accessContext.policy.revision,
    subjectId,
    tenantId,
  };
}

export function isKnowledgeSpaceExternalCallerKind(callerKind: KnowledgeSpaceCallerKind): boolean {
  return externalCallerKinds.has(callerKind);
}

export function knowledgeSpaceAccessChannelForCallerKind(
  callerKind: KnowledgeSpaceCallerKind,
): KnowledgeSpaceAccessChannel {
  return callerKind === "api_key" ? "service_api" : callerKind;
}

/**
 * Revalidates a durable derived-result grant against current ACL state and the credential used by
 * this request. Any policy/member/API-access/key revision drift fails closed.
 */
export async function revalidateKnowledgeSpaceDurablePermission(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly currentApiKeyId?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly permissionSnapshot: KnowledgeSpaceDurablePermissionReference;
  readonly subject: AuthSubject;
}): Promise<KnowledgeSpacePermissionSnapshot> {
  if (
    input.permissionSnapshot.accessChannel !==
    knowledgeSpaceAccessChannelForCallerKind(input.callerKind)
  ) {
    throw durablePermissionDenied();
  }
  try {
    const snapshot = await input.access.revalidatePermissionSnapshot({
      expectedAccessChannel: input.permissionSnapshot.accessChannel,
      id: input.permissionSnapshot.id,
      knowledgeSpaceId: input.knowledgeSpaceId,
      subjectId: input.subject.subjectId,
      tenantId: input.subject.tenantId,
    });
    if (
      snapshot.revision !== input.permissionSnapshot.revision ||
      snapshot.apiKeyId !== input.currentApiKeyId
    ) {
      throw durablePermissionDenied();
    }
    return snapshot;
  } catch (error) {
    if (error instanceof KnowledgeSpaceAccessError) {
      throw durablePermissionDenied();
    }
    throw error;
  }
}

function durablePermissionDenied(): KnowledgeSpaceAuthorizationError {
  return new KnowledgeSpaceAuthorizationError(
    "KNOWLEDGE_SPACE_ACCESS_DENIED",
    "Knowledge space access denied",
  );
}

function normalizeAuthorizationInput(
  input: KnowledgeSpaceAuthorizationInput,
): KnowledgeSpaceAuthorizationInput {
  if (!KnowledgeSpaceCallerKinds.includes(input.callerKind)) {
    throw new Error("Unsupported knowledge space caller kind");
  }
  if (!KnowledgeSpaceRequiredAccessValues.includes(input.requiredAccess)) {
    throw new Error("Unsupported knowledge space required access");
  }

  return {
    callerKind: input.callerKind,
    knowledgeSpaceId: requiredString(input.knowledgeSpaceId, "knowledgeSpaceId"),
    requiredAccess: input.requiredAccess,
    subject: {
      // Bearer scopes remain authentication metadata and must not become candidate grants.
      scopes: [...input.subject.scopes],
      subjectId: requiredString(input.subject.subjectId, "subject.subjectId"),
      tenantId: requiredString(input.subject.tenantId, "subject.tenantId"),
    },
  };
}

function validateAccessContext(context: KnowledgeSpaceAuthorizationAccessContext): void {
  requiredString(context.member.id, "member.id");
  requiredString(context.member.subjectId, "member.subjectId");
  positiveRevision(context.member.revision, "member.revision");
  if (!KNOWLEDGE_SPACE_MEMBER_ROLES.includes(context.member.role)) {
    throw new Error("Knowledge space authorization member.role is invalid");
  }
  requiredString(context.policy.id, "policy.id");
  requiredString(context.policy.ownerSubjectId, "policy.ownerSubjectId");
  positiveRevision(context.policy.revision, "policy.revision");
  if (!KNOWLEDGE_SPACE_VISIBILITIES.includes(context.policy.visibility)) {
    throw new Error("Knowledge space authorization policy.visibility is invalid");
  }
  requiredString(context.apiAccess.id, "apiAccess.id");
  positiveRevision(context.apiAccess.revision, "apiAccess.revision");
  if (typeof context.apiAccess.enabled !== "boolean") {
    throw new Error("Knowledge space authorization apiAccess.enabled must be boolean");
  }

  if (!Array.isArray(context.partialMemberSubjectIds)) {
    throw new Error("Knowledge space partial member subject IDs are required");
  }
  for (const subjectId of context.partialMemberSubjectIds) {
    requiredString(subjectId, "partialMemberSubjectIds[]");
  }
}

function isVisibleToMember(context: KnowledgeSpaceAuthorizationAccessContext): boolean {
  if (context.policy.visibility === "all_members") {
    return true;
  }
  if (context.policy.visibility === "only_me") {
    return context.policy.ownerSubjectId === context.member.subjectId;
  }
  return context.partialMemberSubjectIds.includes(context.member.subjectId);
}

function roleAllows(
  role: KnowledgeSpaceAuthorizationMemberRole,
  requiredAccess: KnowledgeSpaceRequiredAccess,
): boolean {
  if (requiredAccess === "read") {
    return role === "owner" || role === "editor" || role === "viewer";
  }
  if (requiredAccess === "write") {
    return role === "owner" || role === "editor";
  }
  return role === "owner";
}

function permissionSnapshotAccessChannel(
  callerKind: KnowledgeSpaceCallerKind,
): KnowledgeSpaceAccessChannel {
  return knowledgeSpaceAccessChannelForCallerKind(callerKind);
}

function cloneAccessContext(
  context: KnowledgeSpaceAuthorizationAccessContext,
): KnowledgeSpaceAuthorizationAccessContext {
  return {
    apiAccess: { ...context.apiAccess },
    member: { ...context.member },
    partialMemberSubjectIds: [...context.partialMemberSubjectIds],
    policy: { ...context.policy },
  };
}

function requiredString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Knowledge space authorization ${field} is required`);
  }
  return normalized;
}

function positiveRevision(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Knowledge space authorization ${field} must be a positive integer`);
  }
  return value;
}

function validDateTime(value: string, field: string): string {
  const normalized = requiredString(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`Knowledge space authorization ${field} must be an ISO date-time`);
  }
  return normalized;
}
