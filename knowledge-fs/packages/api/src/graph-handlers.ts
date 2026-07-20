import type { OpenAPIHono } from "@hono/zod-openapi";

import { currentCandidateGrants } from "./candidate-content-authorization";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { traverseGraphRoute } from "./graph-routes";
import { graphTraversalResponse } from "./graph-traversal-responses";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  type PublishedGraphIndexRepository,
  PublishedGraphSnapshotNotFoundError,
} from "./published-graph-index-repository";
import {
  type PublishedProjectionReadSnapshotResolver,
  PublishedProjectionReadUnavailableError,
} from "./published-projection-read-snapshot";

const PUBLISHED_GRAPH_UNAVAILABLE = "Published graph traversal is unavailable";

export interface RegisterGraphHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly publishedGraph?: PublishedGraphIndexRepository | undefined;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerGraphHandlers({
  app,
  projectionSnapshotResolver,
  publishedGraph,
  spaces,
}: RegisterGraphHandlersOptions): void {
  app.openapi(traverseGraphRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Graph entity not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants || !projectionSnapshotResolver || !publishedGraph) {
      return context.json({ error: PUBLISHED_GRAPH_UNAVAILABLE }, 503);
    }

    try {
      const snapshot = await projectionSnapshotResolver.resolve({
        knowledgeSpaceId: params.id,
        resolvedMode: "deep",
        tenantId: subject.tenantId,
      });
      const traversal = await publishedGraph.traverse({
        fanout: query.fanout,
        maxDepth: query.depth,
        maxNodes: query.maxNodes,
        permissionScope: candidateGrants,
        snapshot,
        startEntityId: query.entityId,
        timeoutMs: query.timeoutMs,
      });

      if (traversal.entities.length === 0) {
        return context.json({ error: "Graph entity not found" }, 404);
      }

      return context.json(graphTraversalResponse(traversal), 200);
    } catch (error) {
      if (
        error instanceof PublishedProjectionReadUnavailableError ||
        error instanceof PublishedGraphSnapshotNotFoundError
      ) {
        return context.json({ error: PUBLISHED_GRAPH_UNAVAILABLE }, 503);
      }
      throw error;
    }
  });
}
