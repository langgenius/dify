import type { OpenAPIHono } from "@hono/zod-openapi";

import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import { candidatePermissionAllowsAsset } from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import {
  cancelDocumentCompilationJobRoute,
  getDocumentCompilationJobRoute,
  retryDocumentCompilationJobRoute,
} from "./document-compilation-routes";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceRequiredAccess,
  knowledgeSpaceAccessChannelForCallerKind,
  revalidateKnowledgeSpaceDurablePermission,
} from "./knowledge-space-authorization";

export interface RegisterDocumentCompilationHandlersOptions {
  readonly access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "revalidatePermissionSnapshot"
  >;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly assets: DocumentAssetRepository;
  readonly authorization?: KnowledgeSpaceAuthorizationGuard | undefined;
  readonly documentCompilationJobs: DocumentCompilationJobStateMachine | undefined;
}

export function registerDocumentCompilationHandlers({
  access,
  app,
  assets,
  authorization,
  documentCompilationJobs,
}: RegisterDocumentCompilationHandlersOptions): void {
  app.openapi(getDocumentCompilationJobRoute, async (context) => {
    if (!documentCompilationJobs) {
      return context.json({ error: "Document compilation jobs unavailable" }, 503);
    }

    const subject = context.get("subject");
    const params = context.req.valid("param");
    const job = await documentCompilationJobs.get(params.id);

    if (!job || job.tenantId !== subject.tenantId) {
      return context.json({ error: "Document compilation job not found" }, 404);
    }

    if (!apiKeyMatchesJobSpace(context, job.knowledgeSpaceId)) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const capabilityGrants = compilationCapabilityGrants(context, job);
    let candidateGrants: readonly string[];
    if (capabilityGrants) {
      candidateGrants = capabilityGrants;
    } else {
      if (job.requestedBySubjectId !== subject.subjectId || !job.permissionSnapshot) {
        return context.json({ error: "Document compilation job not found" }, 404);
      }
      const durablePermission = await revalidateCompilationJobPermission(context, access, job);
      if (!durablePermission) {
        return context.json({ error: "Document compilation job not found" }, 404);
      }
      const decision = await authorizeJob(context, authorization, job.knowledgeSpaceId, "read");
      if (!decision) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      candidateGrants = durablePermission.permissionScopes;
    }
    if (
      !(await canReadCompilationJobAsset({
        assets,
        candidateGrants,
        job,
      }))
    ) {
      return context.json({ error: "Document compilation job not found" }, 404);
    }

    return context.json(toPublicCompilationJob(job), 200);
  });

  app.openapi(cancelDocumentCompilationJobRoute, async (context) => {
    if (!documentCompilationJobs) {
      return context.json({ error: "Document compilation jobs unavailable" }, 503);
    }

    const subject = context.get("subject");
    const params = context.req.valid("param");
    const job = await documentCompilationJobs.get(params.id);

    if (!job || job.tenantId !== subject.tenantId) {
      return context.json({ error: "Document compilation job not found" }, 404);
    }

    if (!apiKeyMatchesJobSpace(context, job.knowledgeSpaceId)) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const capabilityGrants = compilationCapabilityGrants(context, job);
    let candidateGrants: readonly string[];
    if (capabilityGrants) {
      candidateGrants = capabilityGrants;
    } else {
      if (job.requestedBySubjectId !== subject.subjectId || !job.permissionSnapshot) {
        return context.json({ error: "Document compilation job not found" }, 404);
      }
      const durablePermission = await revalidateCompilationJobPermission(context, access, job);
      if (!durablePermission) {
        return context.json({ error: "Document compilation job not found" }, 404);
      }
      const decision = await authorizeJob(context, authorization, job.knowledgeSpaceId, "write");
      if (!decision) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      candidateGrants = durablePermission.permissionScopes;
    }
    if (
      !(await canReadCompilationJobAsset({
        assets,
        candidateGrants,
        job,
      }))
    ) {
      return context.json({ error: "Document compilation job not found" }, 404);
    }
    const capabilityGrant = context.get("capabilityV2Grant");
    const freshPermission = capabilityGrants
      ? undefined
      : await issueFreshCompilationControlPermission(context, access, job.knowledgeSpaceId);
    if (!capabilityGrants && !freshPermission) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const controlPermission =
      capabilityGrants && capabilityGrant
        ? { capabilityGrantId: capabilityGrant.grantId }
        : freshPermission
          ? { permissionSnapshot: freshPermission, requestedBySubjectId: subject.subjectId }
          : undefined;
    if (!controlPermission) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    try {
      const canceled = await documentCompilationJobs.cancel(
        params.id,
        "Canceled by request",
        controlPermission,
      );
      return context.json(toPublicCompilationJob(canceled), 200);
    } catch {
      return context.json({ error: "Document compilation job cannot be canceled" }, 409);
    }
  });

  app.openapi(retryDocumentCompilationJobRoute, async (context) => {
    if (!documentCompilationJobs) {
      return context.json({ error: "Document compilation jobs unavailable" }, 503);
    }

    const subject = context.get("subject");
    const params = context.req.valid("param");
    const job = await documentCompilationJobs.get(params.id);

    if (!job || job.tenantId !== subject.tenantId) {
      return context.json({ error: "Document compilation job not found" }, 404);
    }

    if (!apiKeyMatchesJobSpace(context, job.knowledgeSpaceId)) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const capabilityGrants = compilationCapabilityGrants(context, job);
    let candidateGrants: readonly string[];
    if (capabilityGrants) {
      candidateGrants = capabilityGrants;
    } else {
      if (job.requestedBySubjectId !== subject.subjectId || !job.permissionSnapshot) {
        return context.json({ error: "Document compilation job not found" }, 404);
      }
      const durablePermission = await revalidateCompilationJobPermission(context, access, job);
      if (!durablePermission) {
        return context.json({ error: "Document compilation job not found" }, 404);
      }
      const decision = await authorizeJob(context, authorization, job.knowledgeSpaceId, "write");
      if (!decision) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      candidateGrants = durablePermission.permissionScopes;
    }
    if (
      !(await canReadCompilationJobAsset({
        assets,
        candidateGrants,
        job,
      }))
    ) {
      return context.json({ error: "Document compilation job not found" }, 404);
    }
    const capabilityGrant = context.get("capabilityV2Grant");
    const freshPermission = capabilityGrants
      ? undefined
      : await issueFreshCompilationControlPermission(context, access, job.knowledgeSpaceId);
    if (!capabilityGrants && !freshPermission) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const controlPermission =
      capabilityGrants && capabilityGrant
        ? { capabilityGrantId: capabilityGrant.grantId }
        : freshPermission
          ? { permissionSnapshot: freshPermission, requestedBySubjectId: subject.subjectId }
          : undefined;
    if (!controlPermission) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    if (!documentCompilationJobs.retry) {
      return context.json({ error: "Document compilation job cannot be retried" }, 409);
    }

    try {
      return context.json(
        toPublicCompilationJob(await documentCompilationJobs.retry(params.id, controlPermission)),
        200,
      );
    } catch {
      return context.json({ error: "Document compilation job cannot be retried" }, 409);
    }
  });
}

function toPublicCompilationJob(
  job: DocumentCompilationJob,
): Omit<
  DocumentCompilationJob,
  "capabilityGrantId" | "permissionSnapshot" | "requestedBySubjectId"
> {
  const {
    capabilityGrantId: _capabilityGrantId,
    permissionSnapshot: _permissionSnapshot,
    requestedBySubjectId: _requestedBySubjectId,
    ...publicJob
  } = job;
  return publicJob;
}

async function revalidateCompilationJobPermission(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">,
  job: DocumentCompilationJob,
): Promise<KnowledgeSpacePermissionSnapshot | null> {
  if (!job.permissionSnapshot) {
    return null;
  }
  try {
    return await revalidateKnowledgeSpaceDurablePermission({
      access,
      callerKind: context.get("callerKind") ?? "interactive",
      currentApiKeyId: context.get("authenticatedApiKey")?.id,
      knowledgeSpaceId: job.knowledgeSpaceId,
      permissionSnapshot: job.permissionSnapshot,
      subject: context.get("subject"),
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError) {
      return null;
    }
    throw error;
  }
}

async function issueFreshCompilationControlPermission(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">,
  knowledgeSpaceId: string,
): Promise<KnowledgeSpacePermissionSnapshot | null> {
  const subject = context.get("subject");
  const callerKind = context.get("callerKind") ?? "interactive";
  const apiKey = context.get("authenticatedApiKey");
  const expiresAt = Math.min(
    Date.now() + 60 * 60_000,
    apiKey?.expiresAt ? Date.parse(apiKey.expiresAt) : Number.POSITIVE_INFINITY,
  );
  try {
    const snapshot = await access.createPermissionSnapshot({
      accessChannel: knowledgeSpaceAccessChannelForCallerKind(callerKind),
      ...(apiKey ? { apiKey } : {}),
      expiresAt: new Date(expiresAt).toISOString(),
      knowledgeSpaceId,
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
    });
    return snapshot.role === "viewer" ? null : snapshot;
  } catch (error) {
    if (error instanceof KnowledgeSpaceAccessError) return null;
    throw error;
  }
}

function apiKeyMatchesJobSpace(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  knowledgeSpaceId: string,
): boolean {
  return isAuthenticatedApiKeyBoundToKnowledgeSpace({
    authenticatedApiKeyKnowledgeSpaceId: context.get("authenticatedApiKeyKnowledgeSpaceId"),
    callerKind: context.get("callerKind"),
    knowledgeSpaceId,
  });
}

function compilationCapabilityGrants(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  job: DocumentCompilationJob,
): readonly string[] | null {
  const grant = context.get("capabilityV2Grant");
  const subject = context.get("subject");
  if (
    grant?.resource.type !== "job" ||
    grant.resource.id !== job.id ||
    grant.resource.parent_id !== job.knowledgeSpaceId ||
    grant.namespaceId !== subject.tenantId ||
    grant.subject !== subject.subjectId
  ) {
    return null;
  }
  return [...grant.contentScopeIds];
}

async function authorizeJob(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  authorization: KnowledgeSpaceAuthorizationGuard | undefined,
  knowledgeSpaceId: string,
  requiredAccess: KnowledgeSpaceRequiredAccess,
): Promise<Awaited<ReturnType<KnowledgeSpaceAuthorizationGuard["authorize"]>> | undefined> {
  if (!authorization) {
    return context.get("authorizationDecision");
  }

  try {
    return await authorization.authorize({
      callerKind: context.get("callerKind") ?? "interactive",
      knowledgeSpaceId,
      requiredAccess,
      subject: context.get("subject"),
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError) {
      return undefined;
    }
    throw error;
  }
}

async function canReadCompilationJobAsset({
  assets,
  candidateGrants,
  job,
}: {
  readonly assets: DocumentAssetRepository;
  readonly candidateGrants: readonly string[];
  readonly job: DocumentCompilationJob;
}): Promise<boolean> {
  const asset = await assets.get({
    id: job.documentAssetId,
    knowledgeSpaceId: job.knowledgeSpaceId,
  });
  return Boolean(asset && candidatePermissionAllowsAsset(asset, candidateGrants));
}
