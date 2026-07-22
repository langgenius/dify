import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createGoldenEvidenceFixtures } from "./golden-question-test-fixtures";
import {
  type QueryGenerationEvent,
  type QueryGenerator,
  type RelevanceTriageSignals,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

const writeToken = "write-token";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(token: string) {
  return { ...bearer(token), "content-type": "application/json" };
}

// "unknown" -> empty retrieval; "lowconf" -> answered but low top score; else -> answered high score.
const queryGenerator: QueryGenerator = {
  stream: async function* (input): AsyncGenerator<QueryGenerationEvent> {
    if (input.query.includes("unknown")) {
      yield { delta: "no evidence", type: "delta" };
      yield { finishReason: "no-retrieval-evidence", type: "done" };
      return;
    }

    yield { delta: "answer", type: "delta" };
    yield {
      finishReason: "retrieval-evidence",
      metadata: { topScore: input.query.includes("lowconf") ? 0.1 : 0.9 },
      type: "done",
    };
  },
};

// On-topic when the query says "relevant"; the answer exists when it says "exists".
const relevanceTriageSignals: RelevanceTriageSignals = {
  answerability: async ({ query }) => ({
    confidence: 0.8,
    verdict: query.includes("exists") ? "retrieval-miss" : "coverage-gap",
  }),
  graphRelevance: async ({ query }) => ({ matched: query.includes("relevant") }),
  summaryRelevance: async () => ({ matched: false }),
};

function createApp(
  options: {
    documentAssets?: Parameters<typeof createKnowledgeGateway>[0]["documentAssets"];
    knowledgeNodes?: Parameters<typeof createKnowledgeGateway>[0]["knowledgeNodes"];
    knowledgeSpaces?: Parameters<typeof createKnowledgeGateway>[0]["knowledgeSpaces"];
    lowConfidenceScoreFloor?: number;
    withTriage?: boolean;
  } = {},
) {
  return createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subjectsByToken: {
        [writeToken]: { scopes: ["knowledge-spaces:*"], subjectId: "u1", tenantId: "tenant-1" },
      },
    }),
    ...(options.lowConfidenceScoreFloor !== undefined
      ? { failedQueryLowConfidenceScoreFloor: options.lowConfidenceScoreFloor }
      : {}),
    ...(options.documentAssets ? { documentAssets: options.documentAssets } : {}),
    ...(options.knowledgeNodes ? { knowledgeNodes: options.knowledgeNodes } : {}),
    ...(options.knowledgeSpaces ? { knowledgeSpaces: options.knowledgeSpaces } : {}),
    queryGenerator,
    ...(options.withTriage ? { relevanceTriageSignals } : {}),
  });
}

async function createSpace(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: "Space", slug: "space" }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(201);

  return (await response.json()).id;
}

async function runQuery(
  app: ReturnType<typeof createApp>,
  knowledgeSpaceId: string,
  query: string,
): Promise<void> {
  const response = await app.request("/queries", {
    body: JSON.stringify({ knowledgeSpaceId, query }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(200);
  // Drain the SSE stream so the post-stream failed-query capture runs.
  await response.text();
}

describe("failed query capture", () => {
  it("captures an empty-retrieval query as pending-triage and ignores answered queries", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    await runQuery(app, spaceId, "tell me about a well known topic");
    await runQuery(app, spaceId, "tell me about an unknown obscure thing");

    const listed = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries?limit=10`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      knowledgeSpaceId: spaceId,
      status: "pending-triage",
      trigger: "no-retrieval-evidence",
    });
    expect(listed.items[0].query).toContain("unknown");
    expect(listed.items[0]).not.toHaveProperty("answerTraceId");

    const pendingOnly = await (
      await app.request(
        `/knowledge-spaces/${spaceId}/failed-queries?limit=10&status=pending-triage`,
        { headers: bearer(writeToken) },
      )
    ).json();
    expect(pendingOnly.items).toHaveLength(1);

    const dismissed = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries?limit=10&status=dismissed`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(dismissed.items).toHaveLength(0);
  });

  it("captures low-confidence answers only when a score floor is configured", async () => {
    // No floor -> low-score answers are not captured.
    const withoutFloor = createApp();
    const spaceA = await createSpace(withoutFloor);
    await runQuery(withoutFloor, spaceA, "a lowconf answer");
    const noneA = await (
      await withoutFloor.request(`/knowledge-spaces/${spaceA}/failed-queries?limit=10`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(noneA.items).toHaveLength(0);

    // Floor 0.3 -> the lowconf answer (top score 0.1) is captured; the high-score one is not.
    const withFloor = createApp({ lowConfidenceScoreFloor: 0.3 });
    const spaceB = await createSpace(withFloor);
    await runQuery(withFloor, spaceB, "a confident answer");
    await runQuery(withFloor, spaceB, "a lowconf answer");
    const listed = await (
      await withFloor.request(`/knowledge-spaces/${spaceB}/failed-queries?limit=10`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ status: "pending-triage", trigger: "low-confidence" });
    expect(listed.items[0].metadata).toMatchObject({ topScore: 0.1 });
  });

  it("triage transitions pending queries: irrelevant -> dismissed, relevant -> pending-annotation", async () => {
    const noTriage = createApp();
    const spaceNo = await createSpace(noTriage);
    expect(
      (
        await noTriage.request(`/knowledge-spaces/${spaceNo}/failed-queries/triage`, {
          headers: bearer(writeToken),
          method: "POST",
        })
      ).status,
    ).toBe(501);

    const app = createApp({ withTriage: true });
    const spaceId = await createSpace(app);
    await runQuery(app, spaceId, "an unknown relevant topic whose answer exists"); // -> retrieval-miss
    await runQuery(app, spaceId, "an unknown off-topic noise query"); // -> irrelevant

    const triage = await app.request(`/knowledge-spaces/${spaceId}/failed-queries/triage`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(triage.status).toBe(200);
    expect(await triage.json()).toMatchObject({
      triaged: 2,
      verdicts: { irrelevant: 1, "retrieval-miss": 1 },
    });

    const annotation = await (
      await app.request(
        `/knowledge-spaces/${spaceId}/failed-queries?limit=10&status=pending-annotation`,
        { headers: bearer(writeToken) },
      )
    ).json();
    expect(annotation.items).toHaveLength(1);
    expect(annotation.items[0].metadata.triage).toMatchObject({ verdict: "retrieval-miss" });

    const dismissed = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries?limit=10&status=dismissed`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(dismissed.items).toHaveLength(1);
  });

  it("groups failed queries into clusters, most frequent first", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    await runQuery(app, spaceId, "unknown refund policy");
    await runQuery(app, spaceId, "the unknown refund policy");
    await runQuery(app, spaceId, "unknown shipping details");

    const clusters = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries/clusters?limit=100`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(clusters.clusters).toHaveLength(2);
    expect(clusters.clusters[0].count).toBe(2);
    expect(clusters.clusters[0].failedQueryIds).toHaveLength(2);
    expect(clusters.clusters[0].representative.query).toContain("refund");
    expect(clusters.clusters[0].representative).not.toHaveProperty("answerTraceId");
    expect(clusters.clusters[1].count).toBe(1);
  });

  async function captureOne(
    app: ReturnType<typeof createApp>,
    spaceId: string,
    query: string,
  ): Promise<string> {
    await runQuery(app, spaceId, query);
    const listed = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries?limit=10`, {
        headers: bearer(writeToken),
      })
    ).json();
    return listed.items.find((item: { query: string }) => item.query === query).id;
  }

  it("annotates a retrieval-miss and promotes it to a golden question", async () => {
    const expectedSpaceId = "10000000-0000-4000-8000-000000000001";
    const evidenceId = "20000000-0000-4000-8000-000000000001";
    const evidence = await createGoldenEvidenceFixtures(expectedSpaceId, [evidenceId]);
    const app = createApp({
      documentAssets: evidence.assets,
      knowledgeNodes: evidence.nodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => expectedSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
    });
    const spaceId = await createSpace(app);
    expect(spaceId).toBe(expectedSpaceId);
    const failedQueryId = await captureOne(app, spaceId, "unknown refund policy");

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/failed-queries/${failedQueryId}`,
      {
        body: JSON.stringify({
          expectedEvidenceIds: [evidenceId],
          note: "should have retrieved the refunds section",
          verdict: "retrieval-miss",
        }),
        headers: json(writeToken),
        method: "PATCH",
      },
    );
    expect(response.status).toBe(200);
    const annotated = await response.json();
    expect(annotated.status).toBe("promoted");
    expect(annotated).not.toHaveProperty("answerTraceId");
    expect(annotated.metadata.annotation).toMatchObject({
      annotatedBy: "u1",
      verdict: "retrieval-miss",
    });
    expect(annotated.metadata.annotation.goldenQuestionId).toEqual(expect.any(String));

    const golden = await (
      await app.request(`/knowledge-spaces/${spaceId}/golden-questions?limit=10`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(golden.items).toHaveLength(1);
    expect(golden.items[0]).toMatchObject({
      expectedEvidenceIds: [evidenceId],
      question: "unknown refund policy",
    });
  });

  it("annotates coverage-gap as annotated and irrelevant as dismissed (no golden question)", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const gapId = await captureOne(app, spaceId, "unknown coverage topic");
    const noiseId = await captureOne(app, spaceId, "unknown noise thing");

    const gap = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries/${gapId}`, {
        body: JSON.stringify({ verdict: "coverage-gap" }),
        headers: json(writeToken),
        method: "PATCH",
      })
    ).json();
    expect(gap.status).toBe("annotated");
    expect(gap.metadata.annotation.goldenQuestionId).toBeUndefined();

    const noise = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries/${noiseId}`, {
        body: JSON.stringify({ verdict: "irrelevant" }),
        headers: json(writeToken),
        method: "PATCH",
      })
    ).json();
    expect(noise.status).toBe("dismissed");

    const golden = await (
      await app.request(`/knowledge-spaces/${spaceId}/golden-questions?limit=10`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(golden.items).toHaveLength(0);
  });

  it("reports failed-query metrics by status with a promotion rate", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const promoteId = await captureOne(app, spaceId, "unknown promote me");
    await captureOne(app, spaceId, "unknown still pending");
    await app.request(`/knowledge-spaces/${spaceId}/failed-queries/${promoteId}`, {
      body: JSON.stringify({ verdict: "retrieval-miss" }),
      headers: json(writeToken),
      method: "PATCH",
    });

    const metrics = await (
      await app.request(`/knowledge-spaces/${spaceId}/failed-queries/metrics`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(metrics.total).toBe(2);
    expect(metrics.byStatus).toMatchObject({ "pending-triage": 1, promoted: 1 });
    expect(metrics.promotionRate).toBe(0.5);
  });
});
