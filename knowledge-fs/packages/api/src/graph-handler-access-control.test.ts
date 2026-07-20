import type { AuthSubject } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createKnowledgeGatewayApp } from "./gateway-app";
import { registerGraphHandlers } from "./graph-handlers";
import type { GraphTraversalResult } from "./graph-index-repository";
import type { KnowledgeSpaceAuthorizationDecision } from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { PublishedGraphIndexRepository } from "./published-graph-index-repository";
import type {
  PublishedProjectionReadSnapshot,
  PublishedProjectionReadSnapshotResolver,
} from "./published-projection-read-snapshot";

const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const entityId = "20000000-0000-4000-8000-000000000001";
const subject: AuthSubject = {
  scopes: ["attacker:forged"],
  subjectId: "member-a",
  tenantId: "tenant-a",
};
const snapshot: PublishedProjectionReadSnapshot = {
  fingerprint: "published-fingerprint",
  headRevision: 3,
  knowledgeSpaceId,
  projectionVersion: 7,
  publicationId: "30000000-0000-4000-8000-000000000001",
  tenantId: subject.tenantId,
};

describe("graph traversal HTTP authorization", () => {
  it("uses only current server grants and one immutable published snapshot", async () => {
    const traverse = vi.fn(async () => traversal());
    const resolve = vi.fn(async () => snapshot);
    const app = graphApp({
      decision: decision(["server:member-a"]),
      projectionSnapshotResolver: { resolve },
      publishedGraph: publishedGraph(traverse),
    });

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/graph/traverse?entityId=${entityId}`,
    );

    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith({
      knowledgeSpaceId,
      resolvedMode: "deep",
      tenantId: subject.tenantId,
    });
    expect(traverse).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionScope: ["server:member-a"],
        snapshot,
        startEntityId: entityId,
      }),
    );
    expect(JSON.stringify(traverse.mock.calls)).not.toContain("attacker:forged");
  });

  it("rejects attempts to inject a candidate grant through the public query", async () => {
    const traverse = vi.fn(async () => traversal());
    const app = graphApp({
      decision: decision(["server:member-a"]),
      projectionSnapshotResolver: { resolve: async () => snapshot },
      publishedGraph: publishedGraph(traverse),
    });

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/graph/traverse?entityId=${entityId}&permissionScope=attacker%3Aforged`,
    );

    expect(response.status).toBe(400);
    expect(traverse).not.toHaveBeenCalled();
  });

  it("returns a stable 503 when immutable published traversal is not wired", async () => {
    const app = graphApp({ decision: decision(["server:member-a"]) });

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/graph/traverse?entityId=${entityId}`,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Published graph traversal is unavailable",
    });
  });

  it("does not accept a grant snapshot issued to another member", async () => {
    const traverse = vi.fn(async () => traversal());
    const app = graphApp({
      decision: decision(["server:other-member"], "other-member"),
      projectionSnapshotResolver: { resolve: async () => snapshot },
      publishedGraph: publishedGraph(traverse),
    });

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/graph/traverse?entityId=${entityId}`,
    );

    expect(response.status).toBe(503);
    expect(traverse).not.toHaveBeenCalled();
  });
});

function graphApp({
  decision: authorizationDecision,
  projectionSnapshotResolver,
  publishedGraph: graph,
}: {
  readonly decision: KnowledgeSpaceAuthorizationDecision;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly publishedGraph?: PublishedGraphIndexRepository | undefined;
}) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("subject", subject);
    context.set("authorizationDecision", authorizationDecision);
    await next();
  });
  registerGraphHandlers({
    app,
    ...(projectionSnapshotResolver ? { projectionSnapshotResolver } : {}),
    ...(graph ? { publishedGraph: graph } : {}),
    spaces: { get: async () => ({ id: knowledgeSpaceId }) } as unknown as KnowledgeSpaceRepository,
  });
  return app;
}

function decision(
  candidateGrants: readonly string[],
  snapshotSubjectId = subject.subjectId,
): KnowledgeSpaceAuthorizationDecision {
  return {
    accessContext: {},
    permissionSnapshot: {
      candidateGrants,
      knowledgeSpaceId,
      subjectId: snapshotSubjectId,
      tenantId: subject.tenantId,
    },
  } as unknown as KnowledgeSpaceAuthorizationDecision;
}

function publishedGraph(
  traverse: PublishedGraphIndexRepository["traverse"],
): PublishedGraphIndexRepository {
  return {
    findSeedEntityIds: async () => [],
    traverse,
  };
}

function traversal(): GraphTraversalResult {
  return {
    entities: [
      {
        aliases: ["Acme"],
        canonicalKey: "organization:acme",
        confidence: 1,
        createdAt: "2026-07-14T00:00:00.000Z",
        depth: 0,
        extractionVersion: 1,
        id: entityId,
        knowledgeSpaceId,
        metadata: {},
        name: "Acme",
        permissionScope: ["server:member-a"],
        sourceNodeIds: ["40000000-0000-4000-8000-000000000001"],
        type: "organization",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
    ],
    metrics: {
      depthReached: 0,
      elapsedMs: 1,
      exploredRelations: 0,
      fanout: 20,
      maxDepth: 2,
      maxNodes: 200,
      timedOut: false,
    },
    relations: [],
    truncated: false,
  };
}
