import type { MiddlewareHandler } from "hono";

import {
  type AdmitCapabilityGrantInput,
  CapabilityGrantConflictError,
  type CapabilityGrantProvenanceRepository,
} from "./capability-grant-provenance";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

/** Convert the transient verified claims summary to the only durable authorization representation. */
export function capabilityGrantAdmissionFromDify(
  grant: DifyCapabilityV2SanitizedGrant,
): AdmitCapabilityGrantInput | null {
  if (grant.resource.type === "namespace") return null;
  const knowledgeSpaceId =
    grant.resource.type === "knowledge_space" ? grant.resource.id : grant.resource.parent_id;
  if (!knowledgeSpaceId) return null;
  return {
    action: grant.action,
    actorId: grant.actor,
    authzRevision: {
      credentialRevision: grant.authzRevision.credential_revision,
      externalAccessEpoch: grant.authzRevision.external_access_epoch,
      membershipEpoch: grant.authzRevision.membership_epoch,
      spaceAclEpoch: grant.authzRevision.space_acl_epoch,
    },
    callerKind: grant.callerKind,
    contentPolicyRevision: grant.contentPolicyRevision,
    contentScopeIds: [...grant.contentScopeIds],
    expiresAt: epochSecondsToIso(grant.expiresAt),
    grantId: grant.grantId,
    issuedAt: epochSecondsToIso(grant.issuedAt),
    jtiHash: grant.jtiHash,
    knowledgeSpaceId,
    resource: {
      id: grant.resource.id,
      parentId: grant.resource.parent_id,
      type: grant.resource.type,
    },
    subjectId: grant.subject,
    tenantId: grant.namespaceId,
    traceId: grant.traceId,
  };
}

/**
 * Admit verified non-namespace grants before handlers enqueue work. Namespace provisioning is
 * excluded because the target Space does not exist yet and cannot satisfy the durable FK.
 */
export function createCapabilityGrantAdmissionMiddleware(
  grants: CapabilityGrantProvenanceRepository,
): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    const verified = context.get("capabilityV2Grant");
    if (!verified) {
      await next();
      return;
    }
    const admission = capabilityGrantAdmissionFromDify(verified);
    if (!admission) {
      if (verified.resource.type !== "namespace") {
        return context.json({ error: "Forbidden" }, 403);
      }
      await next();
      return;
    }
    try {
      await grants.admit(admission);
    } catch (error) {
      if (error instanceof CapabilityGrantConflictError) {
        return context.json({ error: "Forbidden" }, 403);
      }
      throw error;
    }
    await next();
  };
}

function epochSecondsToIso(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Capability epoch seconds must be a nonnegative integer");
  }
  return new Date(value * 1_000).toISOString();
}
