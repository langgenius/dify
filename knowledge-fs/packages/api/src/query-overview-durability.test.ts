import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  type KnowledgeSpaceOverviewRepository,
  type QueryGenerationEvent,
  createInMemoryAnswerTraceRepository,
  createInMemoryKnowledgeSpaceOverviewRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
  deterministicKnowledgeSpaceActivityId,
} from "./index";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

const READ_TOKEN = "read-token";
const QUERY_RUN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f9a03";
const SUBJECT = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};

describe("query Overview durability", () => {
  it("persists query.requested before admitting generation and records terminal activity", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9a02",
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const space = await spaces.create({
      name: "Durable overview",
      slug: "durable-overview",
      tenantId: SUBJECT.tenantId,
    });
    const storedOverview = createInMemoryKnowledgeSpaceOverviewRepository({
      maxEvents: 100,
      maxListLimit: 100,
    });
    let releaseRequested!: () => void;
    let markRequestedStarted!: () => void;
    const requestedGate = new Promise<void>((resolve) => {
      releaseRequested = resolve;
    });
    const requestedStarted = new Promise<void>((resolve) => {
      markRequestedStarted = resolve;
    });
    const overview: KnowledgeSpaceOverviewRepository = {
      ...storedOverview,
      appendActivity: async (input) => {
        if (input.action === "query.requested") {
          markRequestedStarted();
          await requestedGate;
        }
        return storedOverview.appendActivity(input);
      },
    };
    const answerTraces = createInMemoryAnswerTraceRepository({
      maxSteps: 100,
      maxTraces: 100,
    });
    const generatorInputs: unknown[] = [];
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      answerTraces,
      auth: createStaticAuthVerifier({ subjectsByToken: { [READ_TOKEN]: SUBJECT } }),
      generateQueryRunId: () => QUERY_RUN_ID,
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: space.id },
      ]),
      knowledgeSpaceOverview: overview,
      knowledgeSpaces: spaces,
      queryGenerator: {
        stream: async function* (input: unknown): AsyncGenerator<QueryGenerationEvent> {
          generatorInputs.push(input);
          yield { delta: "durable answer", type: "delta" };
          yield { finishReason: "stop", metadata: {}, type: "done" };
        },
      },
    });

    let requestSettled = false;
    const responsePromise = Promise.resolve(
      app.request("/queries", {
        body: JSON.stringify({
          knowledgeSpaceId: space.id,
          mode: "fast",
          query: "Is the request durable?",
        }),
        headers: {
          authorization: `Bearer ${READ_TOKEN}`,
          "content-type": "application/json",
          "x-trace-id": "client-correlation",
        },
        method: "POST",
      }),
    ).then((response) => {
      requestSettled = true;
      return response;
    });

    await requestedStarted;
    await Promise.resolve();
    expect(requestSettled).toBe(false);
    releaseRequested();
    const response = await responsePromise;
    await expect(response.text()).resolves.toContain("answer.done");
    expect(response.headers.get("x-trace-id")).toBe("client-correlation");
    expect(response.headers.get("x-query-run-id")).toBe(QUERY_RUN_ID);
    expect(generatorInputs).toEqual([expect.objectContaining({ traceId: QUERY_RUN_ID })]);
    await expect(
      answerTraces.get({ id: QUERY_RUN_ID, knowledgeSpaceId: space.id }),
    ).resolves.toMatchObject({ id: QUERY_RUN_ID, subjectId: SUBJECT.subjectId });

    const activity = await storedOverview.listActivity({
      candidateGrants: ownerCandidateScopes(space.id),
      knowledgeSpaceId: space.id,
      limit: 10,
      tenantId: SUBJECT.tenantId,
    });
    expect(activity.items.map((event) => event.action).sort()).toEqual([
      "query.completed",
      "query.requested",
    ]);
    expect(activity.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: deterministicKnowledgeSpaceActivityId(
            "query.requested",
            SUBJECT.tenantId,
            space.id,
            QUERY_RUN_ID,
          ),
          resource: { id: QUERY_RUN_ID, type: "query" },
        }),
        expect.objectContaining({
          id: deterministicKnowledgeSpaceActivityId(
            "query.succeeded",
            SUBJECT.tenantId,
            space.id,
            QUERY_RUN_ID,
          ),
          resource: { id: QUERY_RUN_ID, type: "query" },
        }),
      ]),
    );
  });
});

function ownerCandidateScopes(knowledgeSpaceId: string): string[] {
  return [
    `tenant:${SUBJECT.tenantId}`,
    `knowledge-space:${knowledgeSpaceId}`,
    `knowledge-space:${knowledgeSpaceId}:member:${SUBJECT.subjectId}`,
    `knowledge-space:${knowledgeSpaceId}:role:owner`,
    `knowledge-space:${knowledgeSpaceId}:visibility:only_me:${SUBJECT.subjectId}`,
  ].sort();
}
