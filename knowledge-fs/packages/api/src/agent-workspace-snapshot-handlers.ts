import type { OpenAPIHono } from "@hono/zod-openapi";

import type {
  AgentWorkspaceReplayService,
  AgentWorkspaceSnapshotRepository,
} from "./agent-workspace-snapshot";
import {
  createAgentWorkspaceSnapshotRoute,
  getAgentWorkspaceSnapshotRoute,
  replayAgentWorkspaceSnapshotRoute,
} from "./agent-workspace-snapshot-routes";
import type {
  AgentWorkspaceSnapshotParams,
  CreateAgentWorkspaceSnapshotBody,
} from "./agent-workspace-snapshot-schemas";
import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import {
  DerivedResultOwnerMismatchError,
  authorizeAgentWorkspaceDerivedResult,
  issueKnowledgeSpaceDurablePermission,
  toPublicAgentWorkspaceReplay,
  toPublicAgentWorkspaceSnapshot,
} from "./derived-result-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { evidenceBundlesHaveActiveDocuments } from "./evidence-bundle-visibility";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import { type LooseOpenApiContext, openApiHandler } from "./openapi-handler-utils";

export interface RegisterAgentWorkspaceSnapshotHandlersOptions {
  readonly access: KnowledgeSpaceAccessService;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly generateAgentWorkspaceSnapshotId: () => string;
  readonly spaces: KnowledgeSpaceRepository;
  readonly workspaceReplayService: AgentWorkspaceReplayService;
  readonly workspaceSnapshotRepository: AgentWorkspaceSnapshotRepository;
  readonly permissionSnapshotTtlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

export function registerAgentWorkspaceSnapshotHandlers({
  access,
  app,
  authorization,
  assets,
  generateAgentWorkspaceSnapshotId,
  spaces,
  workspaceReplayService,
  workspaceSnapshotRepository,
  permissionSnapshotTtlMs = 60 * 60_000,
  now = Date.now,
}: RegisterAgentWorkspaceSnapshotHandlersOptions): void {
  if (!Number.isSafeInteger(permissionSnapshotTtlMs) || permissionSnapshotTtlMs < 1) {
    throw new Error("Agent workspace permissionSnapshotTtlMs must be a positive integer");
  }
  app.openapi(
    createAgentWorkspaceSnapshotRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const body = context.req.valid("json") as CreateAgentWorkspaceSnapshotBody;
      const space = await spaces.get({
        id: body.knowledgeSpaceId,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      try {
        if (
          !(await evidenceBundlesHaveActiveDocuments({
            assets,
            bundles: body.evidenceBundles,
            knowledgeSpaceId: space.id,
          }))
        ) {
          return context.json({ error: "Agent workspace evidence is no longer active" }, 409);
        }
        const callerKind = context.get("callerKind") ?? "interactive";
        const authenticatedApiKey = context.get("authenticatedApiKey");
        const expiresAt = Math.min(
          now() + permissionSnapshotTtlMs,
          authenticatedApiKey?.expiresAt
            ? Date.parse(authenticatedApiKey.expiresAt)
            : Number.POSITIVE_INFINITY,
        );
        const durablePermission = await issueKnowledgeSpaceDurablePermission({
          access,
          ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
          authorization,
          callerKind,
          expiresAt: new Date(expiresAt).toISOString(),
          knowledgeSpaceId: space.id,
          requiredAccess: "write",
          subject,
        });
        const snapshot = await workspaceSnapshotRepository.create({
          commandLog: body.commandLog,
          evidenceBundles: body.evidenceBundles,
          id: generateAgentWorkspaceSnapshotId(),
          indexProjection: body.indexProjection,
          knowledgeSpaceId: space.id,
          manifestVersion: body.manifestVersion,
          metadata: body.metadata,
          mounts: body.mounts,
          pathVersions: body.pathVersions,
          permissionSnapshot: {
            accessChannel: durablePermission.accessChannel,
            id: durablePermission.id,
            revision: durablePermission.revision,
            scopes: [...durablePermission.permissionScopes],
            subjectId: subject.subjectId,
            tenantId: subject.tenantId,
          },
          researchTaskJobId: body.researchTaskJobId,
          sourceVersions: body.sourceVersions,
          tenantId: subject.tenantId,
          traceIds: body.traceIds,
        });

        return context.json(toPublicAgentWorkspaceSnapshot(snapshot), 201);
      } catch (error) {
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ error: error.message }, 403);
        }
        return context.json(
          {
            error:
              error instanceof Error ? error.message : "Invalid agent workspace snapshot request",
          },
          400,
        );
      }
    }),
  );

  app.openapi(
    getAgentWorkspaceSnapshotRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const params = context.req.valid("param") as AgentWorkspaceSnapshotParams;
      const snapshot = await workspaceSnapshotRepository.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!snapshot) {
        return context.json({ error: "Agent workspace snapshot not found" }, 404);
      }

      if (!apiKeyMatchesSnapshotSpace(context, snapshot.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      try {
        await authorizeAgentWorkspaceDerivedResult({
          access,
          authorization,
          callerKind: context.get("callerKind") ?? "interactive",
          currentApiKeyId: context.get("authenticatedApiKey")?.id,
          requiredAccess: "read",
          snapshot,
          subject,
        });
      } catch (error) {
        if (error instanceof DerivedResultOwnerMismatchError) {
          return context.json({ error: "Agent workspace snapshot not found" }, 404);
        }
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ error: error.message }, 403);
        }
        throw error;
      }

      if (
        !(await evidenceBundlesHaveActiveDocuments({
          assets,
          bundles: snapshot.evidenceBundles,
          knowledgeSpaceId: snapshot.knowledgeSpaceId,
        }))
      ) {
        return context.json({ error: "Agent workspace snapshot not found" }, 404);
      }

      return context.json(toPublicAgentWorkspaceSnapshot(snapshot), 200);
    }),
  );

  app.openapi(
    replayAgentWorkspaceSnapshotRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const params = context.req.valid("param") as AgentWorkspaceSnapshotParams;
      const traceId = context.get("traceId");

      try {
        const snapshot = await workspaceSnapshotRepository.get({
          id: params.id,
          tenantId: subject.tenantId,
        });
        if (!snapshot) {
          return context.json({ error: "Agent workspace snapshot not found" }, 404);
        }
        if (!apiKeyMatchesSnapshotSpace(context, snapshot.knowledgeSpaceId)) {
          return context.json({ error: "Knowledge space access denied" }, 403);
        }
        const durablePermission = await authorizeAgentWorkspaceDerivedResult({
          access,
          authorization,
          callerKind: context.get("callerKind") ?? "interactive",
          currentApiKeyId: context.get("authenticatedApiKey")?.id,
          requiredAccess: "write",
          snapshot,
          subject,
        });
        if (
          !(await evidenceBundlesHaveActiveDocuments({
            assets,
            bundles: snapshot.evidenceBundles,
            knowledgeSpaceId: snapshot.knowledgeSpaceId,
          }))
        ) {
          return context.json({ error: "Agent workspace snapshot not found" }, 404);
        }
        const replay = await workspaceReplayService.replay({
          id: params.id,
          permissionSnapshot: {
            scopes: [...durablePermission.permissionScopes],
            subjectId: subject.subjectId,
            tenantId: subject.tenantId,
          },
          tenantId: subject.tenantId,
          ...(traceId ? { traceId } : {}),
        });

        if (!replay) {
          return context.json({ error: "Agent workspace snapshot not found" }, 404);
        }

        await authorizeAgentWorkspaceDerivedResult({
          access,
          authorization,
          callerKind: context.get("callerKind") ?? "interactive",
          currentApiKeyId: context.get("authenticatedApiKey")?.id,
          requiredAccess: "write",
          snapshot,
          subject,
        });

        return context.json(toPublicAgentWorkspaceReplay(replay), 200);
      } catch (error) {
        if (error instanceof DerivedResultOwnerMismatchError) {
          return context.json({ error: "Agent workspace snapshot not found" }, 404);
        }
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ error: error.message }, 403);
        }
        return context.json(
          {
            error:
              error instanceof Error ? error.message : "Agent workspace snapshot replay failed",
          },
          409,
        );
      }
    }),
  );
}

function apiKeyMatchesSnapshotSpace(
  context: Pick<LooseOpenApiContext, "get">,
  knowledgeSpaceId: string,
): boolean {
  return isAuthenticatedApiKeyBoundToKnowledgeSpace({
    authenticatedApiKeyKnowledgeSpaceId: context.get("authenticatedApiKeyKnowledgeSpaceId"),
    callerKind: context.get("callerKind"),
    knowledgeSpaceId,
  });
}
