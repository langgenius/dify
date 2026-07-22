import type { OpenAPIHono } from "@hono/zod-openapi";

import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import type { BulkOperation, BulkOperationRepository } from "./bulk-operation";
import { summarizeBulkOperation } from "./bulk-operation-summary";
import {
  candidatePermissionAllowsAsset,
  candidatePermissionScopeAllows,
} from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  revalidateKnowledgeSpaceDurablePermission,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  getBulkOperationRoute,
  getKnowledgeSpaceRetentionPolicyRoute,
  getTenantRetentionPolicyRoute,
  updateKnowledgeSpaceRetentionPolicyRoute,
  updateTenantRetentionPolicyRoute,
} from "./operation-policy-routes";
import type { RetentionPolicyRepository } from "./retention-policy";

export interface RegisterOperationPolicyHandlersOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization?: KnowledgeSpaceAuthorizationGuard | undefined;
  readonly assets: DocumentAssetRepository;
  readonly bulkOperationRepository: BulkOperationRepository;
  readonly documentCompilationJobs: DocumentCompilationJobStateMachine | undefined;
  readonly retentionPolicyRepository: RetentionPolicyRepository;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerOperationPolicyHandlers({
  access,
  app,
  authorization,
  assets,
  bulkOperationRepository,
  documentCompilationJobs,
  retentionPolicyRepository,
  spaces,
}: RegisterOperationPolicyHandlersOptions): void {
  app.openapi(getBulkOperationRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const operation = await bulkOperationRepository.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!operation) {
      return context.json({ error: "Bulk operation not found" }, 404);
    }

    if (
      !isAuthenticatedApiKeyBoundToKnowledgeSpace({
        authenticatedApiKeyKnowledgeSpaceId: context.get("authenticatedApiKeyKnowledgeSpaceId"),
        callerKind: context.get("callerKind"),
        knowledgeSpaceId: operation.knowledgeSpaceId,
      })
    ) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const capabilityGrant = context.get("capabilityV2Grant");
    const hasCapability =
      capabilityGrant?.resource.type === "job" &&
      capabilityGrant.resource.id === operation.id &&
      capabilityGrant.resource.parent_id === operation.knowledgeSpaceId &&
      capabilityGrant.namespaceId === subject.tenantId &&
      capabilityGrant.subject === subject.subjectId;
    let candidateGrants: readonly string[];
    if (hasCapability && capabilityGrant) {
      candidateGrants = capabilityGrant.contentScopeIds;
    } else {
      if (operation.requestedBySubjectId !== subject.subjectId || !operation.permissionSnapshot) {
        return context.json({ error: "Bulk operation not found" }, 404);
      }
      let durablePermission: KnowledgeSpacePermissionSnapshot;
      try {
        durablePermission = await revalidateKnowledgeSpaceDurablePermission({
          access,
          callerKind: context.get("callerKind") ?? "interactive",
          currentApiKeyId: context.get("authenticatedApiKey")?.id,
          knowledgeSpaceId: operation.knowledgeSpaceId,
          permissionSnapshot: operation.permissionSnapshot,
          subject,
        });
      } catch (error) {
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ error: "Bulk operation not found" }, 404);
        }
        throw error;
      }

      if (authorization) {
        try {
          await authorization.authorize({
            callerKind: context.get("callerKind") ?? "interactive",
            knowledgeSpaceId: operation.knowledgeSpaceId,
            requiredAccess: "read",
            subject,
          });
        } catch (error) {
          if (error instanceof KnowledgeSpaceAuthorizationError) {
            return context.json({ error: error.message }, 403);
          }
          throw error;
        }
      }
      candidateGrants = durablePermission.permissionScopes;
    }
    if (
      !(await canReadBulkOperationDocuments({
        assets,
        candidateGrants,
        operation,
        subjectId: subject.subjectId,
      }))
    ) {
      return context.json({ error: "Bulk operation not found" }, 404);
    }

    const hasCompilationJobs = operation.items.some((item) => item.compilationJobId);

    if (hasCompilationJobs && !documentCompilationJobs) {
      return context.json({ error: "Document compilation jobs unavailable" }, 503);
    }

    return context.json(await summarizeBulkOperation(operation, documentCompilationJobs), 200);
  });

  app.openapi(getTenantRetentionPolicyRoute, async (context) => {
    const subject = context.get("subject");

    return context.json(await retentionPolicyRepository.get({ tenantId: subject.tenantId }), 200);
  });

  app.openapi(updateTenantRetentionPolicyRoute, async (context) => {
    const subject = context.get("subject");

    return context.json(
      await retentionPolicyRepository.update({
        patch: context.req.valid("json"),
        scope: { tenantId: subject.tenantId },
      }),
      200,
    );
  });

  app.openapi(getKnowledgeSpaceRetentionPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({
      id: knowledgeSpaceId,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    return context.json(
      await retentionPolicyRepository.get({
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      }),
      200,
    );
  });

  app.openapi(updateKnowledgeSpaceRetentionPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({
      id: knowledgeSpaceId,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    return context.json(
      await retentionPolicyRepository.update({
        patch: context.req.valid("json"),
        scope: {
          knowledgeSpaceId,
          tenantId: subject.tenantId,
        },
      }),
      200,
    );
  });
}

async function canReadBulkOperationDocuments({
  assets,
  candidateGrants,
  operation,
  subjectId,
}: {
  readonly assets: DocumentAssetRepository;
  readonly candidateGrants: readonly string[];
  readonly operation: BulkOperation;
  readonly subjectId: string;
}): Promise<boolean> {
  for (const item of operation.items) {
    if (item.status === "not_found") {
      if (operation.requestedBySubjectId !== subjectId) {
        return false;
      }
      continue;
    }

    if (
      item.requiredPermissionScope &&
      !candidatePermissionScopeAllows(item.requiredPermissionScope, candidateGrants)
    ) {
      return false;
    }

    const asset = await assets.get({
      id: item.documentId,
      knowledgeSpaceId: operation.knowledgeSpaceId,
    });
    if (!asset) {
      // New operations carry a durable scope binding. Legacy rows without one fail closed once
      // their backing asset disappears instead of trusting requester identity alone.
      if (!item.requiredPermissionScope) {
        return false;
      }
      continue;
    }
    if (!candidatePermissionAllowsAsset(asset, candidateGrants)) {
      return false;
    }
  }

  return true;
}
