import type { AuthSubject } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createKnowledgeGatewayApp } from "./gateway-app";
import type { KnowledgeSpaceAuthorizationDecision } from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { SemanticOperator } from "./semantic-operator-actions";
import { registerSemanticOperatorHandlers } from "./semantic-operator-handlers";

const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const subject: AuthSubject = {
  scopes: ["attacker:forged"],
  subjectId: "member-a",
  tenantId: "tenant-a",
};

describe("semantic operator HTTP authorization", () => {
  it("injects current server grants into topic, entity, and community operations", async () => {
    const operator = recordingOperator();
    const app = semanticApp(operator, decision(["server:member-a"]));

    const topic = await post(app, "topic/materialize", { limit: 1 });
    const entities = await post(app, "entities/extract", { limit: 1 });
    const communities = await post(app, "communities/materialize", {});

    expect([topic.status, entities.status, communities.status]).toEqual([200, 200, 200]);
    for (const call of [
      operator.materializeTopicView.mock.calls[0]?.[0],
      operator.extractEntities.mock.calls[0]?.[0],
      operator.materializeCommunities.mock.calls[0]?.[0],
    ]) {
      expect(call).toMatchObject({
        candidateGrants: ["server:member-a"],
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      expect(JSON.stringify(call)).not.toContain("attacker:forged");
    }
  });

  it("rejects forged request grants before invoking the operator", async () => {
    const operator = recordingOperator();
    const app = semanticApp(operator, decision(["server:member-a"]));

    const response = await post(app, "topic/materialize", {
      candidateGrants: ["attacker:forged"],
      limit: 1,
    });

    expect(response.status).toBe(400);
    expect(operator.materializeTopicView).not.toHaveBeenCalled();
  });

  it("fails closed when the grant snapshot belongs to another member", async () => {
    const operator = recordingOperator();
    const app = semanticApp(operator, decision(["server:other"], "other-member"));

    const response = await post(app, "entities/extract", { limit: 1 });

    expect(response.status).toBe(503);
    expect(operator.extractEntities).not.toHaveBeenCalled();
  });
});

function semanticApp(
  operator: ReturnType<typeof recordingOperator>,
  authorizationDecision: KnowledgeSpaceAuthorizationDecision,
) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("subject", subject);
    context.set("authorizationDecision", authorizationDecision);
    await next();
  });
  registerSemanticOperatorHandlers({
    app,
    operator,
    spaces: { get: async () => ({ id: knowledgeSpaceId }) } as unknown as KnowledgeSpaceRepository,
  });
  return app;
}

function recordingOperator() {
  return {
    extractEntities: vi.fn(async (_input: Parameters<SemanticOperator["extractEntities"]>[0]) => ({
      entitiesExtracted: 0,
      extractionMode: "provider" as const,
      graphEntitiesIndexed: 0,
      graphRelationsIndexed: 0,
      knowledgeSpaceId,
      nodesScanned: 0,
      nodesUpdated: 0,
    })),
    materializeCommunities: vi.fn(
      async (_input: Parameters<SemanticOperator["materializeCommunities"]>[0]) => ({
        communityCount: 0,
        documentCount: 0,
        entityCount: 0,
        generatedVersion: "community-v1",
        knowledgeSpaceId,
        pathCount: 0,
        paths: [],
      }),
    ),
    materializeTopicView: vi.fn(
      async (_input: Parameters<SemanticOperator["materializeTopicView"]>[0]) => ({
        documentCount: 0,
        generatedVersion: "topic-v1",
        knowledgeSpaceId,
        pathCount: 0,
        paths: [],
        topicName: "Topic",
        topicSlug: "topic",
      }),
    ),
  } satisfies SemanticOperator;
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

function post(
  app: ReturnType<typeof createKnowledgeGatewayApp>,
  path: string,
  body: Readonly<Record<string, unknown>>,
) {
  return app.request(`/knowledge-spaces/${knowledgeSpaceId}/semantic-views/${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
