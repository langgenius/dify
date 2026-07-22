import type { OpenAPIHono } from "@hono/zod-openapi";

import type { DocumentAssetRepository } from "./document-asset-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  MAX_BATCH_KNOWLEDGE_SPACE_PRODUCT_SUMMARIES,
  batchKnowledgeSpaceProductSummariesRoute,
} from "./knowledge-space-routes";

const BATCH_SUMMARY_ACTION = "knowledge_spaces.status.batch";

export interface RegisterKnowledgeSpaceProductSummaryHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly assets: Pick<DocumentAssetRepository, "getStorageUsage">;
  readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get">;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}

/**
 * Registers the Dify-only batch projection. The signed ID set is checked before any repository
 * read, so body limits cannot be used to move authorization behind a candidate query or LIMIT.
 */
export function registerKnowledgeSpaceProductSummaryHandlers({
  app,
  assets,
  manifests,
  spaces,
}: RegisterKnowledgeSpaceProductSummaryHandlersOptions): void {
  app.openapi(batchKnowledgeSpaceProductSummariesRoute, async (context) => {
    const subject = context.get("subject");
    const grant = context.get("capabilityV2Grant");
    const { knowledgeSpaceIds } = context.req.valid("json");

    if (
      !grant ||
      grant.action !== BATCH_SUMMARY_ACTION ||
      grant.resource.type !== "namespace" ||
      grant.namespaceId !== subject.tenantId ||
      grant.resource.id !== subject.tenantId ||
      grant.contentScopeIds.length === 0 ||
      grant.contentScopeIds.length > MAX_BATCH_KNOWLEDGE_SPACE_PRODUCT_SUMMARIES ||
      new Set(grant.contentScopeIds).size !== grant.contentScopeIds.length ||
      !sameIdSet(grant.contentScopeIds, knowledgeSpaceIds)
    ) {
      return context.json({ error: "Capability scope does not match the requested batch" }, 403);
    }

    const loadedSpaces = await Promise.all(
      knowledgeSpaceIds.map((id) => spaces.get({ id, tenantId: subject.tenantId })),
    );
    const visibleSpaces = loadedSpaces.filter((space) => space !== null);
    const items = await Promise.all(
      visibleSpaces.map(async (space) => {
        const [usage, manifest] = await Promise.all([
          assets.getStorageUsage({ knowledgeSpaceId: space.id }),
          manifests.get({ knowledgeSpaceId: space.id, tenantId: subject.tenantId }),
        ]);
        return {
          description: space.description ?? null,
          documentCount: usage.documentCount,
          icon: space.iconRef ?? null,
          indexState: null,
          knowledgeSpaceId: space.id,
          lastJobState: null,
          modelProfile: manifest
            ? {
                embeddingProfile: manifest.embeddingProfile ?? null,
                pendingModelConfiguration: manifest.pendingModelConfiguration ?? null,
                retrievalProfile: manifest.retrievalProfile ?? null,
              }
            : null,
          name: space.name,
          revision: space.revision,
          slug: space.slug,
        };
      }),
    );

    return context.json({ items }, 200);
  });
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}
