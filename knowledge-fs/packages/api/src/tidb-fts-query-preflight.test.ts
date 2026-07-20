import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  type QueryGenerationEvent,
  TidbFtsPostingBackfillNotReadyError,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

const token = "read-token";
const subject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};

describe("TiDB FTS HTTP query preflight", () => {
  it("returns stable JSON 503 before SSE/session generation for Fast/Deep and bypasses Research", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "10000000-0000-4000-8000-000000000001",
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const space = await spaces.create({
      name: "Tenant docs",
      slug: "tenant-docs",
      tenantId: subject.tenantId,
    });
    let generatorCalls = 0;
    let readinessCalls = 0;
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [token]: subject } }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: space.id },
      ]),
      knowledgeSpaces: spaces,
      queryGenerator: {
        stream: async function* (): AsyncGenerator<QueryGenerationEvent> {
          generatorCalls += 1;
          yield { delta: "research answer", type: "delta" };
          yield { finishReason: "stop", type: "done" };
        },
      },
      tidbFtsPostingReadiness: {
        assertReady: async () => {
          readinessCalls += 1;
          throw new TidbFtsPostingBackfillNotReadyError("running");
        },
      },
    });

    for (const mode of ["fast", "deep"] as const) {
      const response = await app.request("/queries", {
        body: JSON.stringify({ knowledgeSpaceId: space.id, mode, query: "What changed?" }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("content-type")).not.toContain("text/event-stream");
      await expect(response.json()).resolves.toEqual({
        code: "TIDB_FTS_POSTINGS_NOT_READY",
        error: "TiDB lexical postings are not ready for Fast or Deep retrieval",
        runState: "running",
      });
    }
    expect(readinessCalls).toBe(2);
    expect(generatorCalls).toBe(0);

    const research = await app.request("/queries", {
      body: JSON.stringify({
        knowledgeSpaceId: space.id,
        mode: "research",
        query: "Open the outline",
      }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "POST",
    });
    expect(research.status).toBe(200);
    expect(research.headers.get("content-type")).toContain("text/event-stream");
    await expect(research.text()).resolves.toContain("research answer");
    expect(readinessCalls).toBe(2);
    expect(generatorCalls).toBe(1);
  });
});
