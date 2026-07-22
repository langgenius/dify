import type { AuthSubject, DocumentAsset, KnowledgeNode } from "@knowledge/core";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { KnowledgeSpaceAuthorizationDecision } from "./knowledge-space-authorization";

export const CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED =
  "CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED" as const;
export const CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE =
  "Candidate visibility scan budget exceeded" as const;

export class CandidateVisibilityScanBudgetExceededError extends Error {
  readonly code = CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED;

  constructor() {
    super(CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE);
    this.name = "CandidateVisibilityScanBudgetExceededError";
  }
}

/**
 * Candidate scopes are an AND policy: every scope persisted on the content must be present in the
 * current, server-issued permission snapshot. Missing legacy scopes remain public within the
 * already-authorized knowledge space, while malformed persisted policy fails closed.
 */
export function candidatePermissionScopeAllows(
  requiredScope: unknown,
  candidateGrants: readonly string[],
): boolean {
  const grants = normalizeCandidateGrants(candidateGrants);
  if (!grants) {
    return false;
  }

  const required = candidatePermissionScopeSnapshot(requiredScope);
  return required?.every((scope) => grants.has(scope)) ?? false;
}

/**
 * Canonicalize the policy stored on candidate content before copying it into a durable operation
 * authorization binding. An absent legacy policy means space-visible content; malformed policy
 * fails closed and therefore cannot produce a snapshot.
 */
export function candidatePermissionScopeSnapshot(requiredScope: unknown): readonly string[] | null {
  if (requiredScope === undefined) {
    return [];
  }
  if (!Array.isArray(requiredScope)) {
    return null;
  }

  return normalizePermissionScope(requiredScope);
}

export function candidatePermissionAllowsAsset(
  asset: Pick<DocumentAsset, "metadata">,
  candidateGrants: readonly string[],
): boolean {
  return candidatePermissionScopeAllows(asset.metadata.permissionScope, candidateGrants);
}

export function candidatePermissionAllowsNode(
  node: Pick<KnowledgeNode, "permissionScope">,
  candidateGrants: readonly string[],
): boolean {
  return candidatePermissionScopeAllows(node.permissionScope, candidateGrants);
}

/**
 * Accept only a snapshot bound to the exact authenticated subject and target knowledge space. This
 * prevents a stale/misrouted middleware decision from becoming a cross-space candidate grant.
 */
export function currentCandidateGrants(input: {
  readonly capabilityGrant?: DifyCapabilityV2SanitizedGrant | undefined;
  readonly decision: KnowledgeSpaceAuthorizationDecision | undefined;
  readonly knowledgeSpaceId: string;
  readonly subject: AuthSubject;
}): readonly string[] | null {
  const capabilitySpaceId =
    input.capabilityGrant?.resource.type === "knowledge_space"
      ? input.capabilityGrant.resource.id
      : input.capabilityGrant?.resource.parent_id;
  if (
    input.capabilityGrant &&
    input.capabilityGrant.namespaceId === input.subject.tenantId &&
    input.capabilityGrant.subject === input.subject.subjectId &&
    capabilitySpaceId === input.knowledgeSpaceId
  ) {
    const grants = normalizeCandidateGrants(input.capabilityGrant.contentScopeIds);
    return grants ? [...grants].sort() : null;
  }

  const snapshot = input.decision?.permissionSnapshot;
  if (
    !snapshot ||
    snapshot.knowledgeSpaceId !== input.knowledgeSpaceId ||
    snapshot.subjectId !== input.subject.subjectId ||
    snapshot.tenantId !== input.subject.tenantId
  ) {
    return null;
  }

  const grants = normalizeCandidateGrants(snapshot.candidateGrants);
  return grants ? [...grants].sort() : null;
}

function normalizeCandidateGrants(scopes: readonly string[]): ReadonlySet<string> | null {
  if (!Array.isArray(scopes)) {
    return null;
  }

  const normalized = normalizePermissionScope(scopes);
  return normalized === null ? null : new Set(normalized);
}

function normalizePermissionScope(scopes: readonly unknown[]): string[] | null {
  const normalized: string[] = [];
  for (const scope of scopes) {
    if (typeof scope !== "string") {
      return null;
    }
    const value = scope.trim();
    if (!value || value !== scope || value.length > 512) {
      return null;
    }
    normalized.push(value);
  }
  return [...new Set(normalized)];
}
