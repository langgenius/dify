import { describe, expect, it, vi } from "vitest";

import { createKnowledgeGatewayApp } from "./gateway-app";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import { registerModelCapabilityHandlers } from "./model-capability-handlers";
import {
  type ModelCapabilityCatalog,
  ModelCapabilityPreflightError,
  type ModelCatalogEntry,
} from "./model-capability-preflight";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const entry: ModelCatalogEntry = {
  capabilities: { contextWindow: 8192 },
  kinds: ["embedding"],
  model: "embed-384",
  pluginId: "langgenius/model:1@install",
  pluginUniqueIdentifier: "langgenius/model:1@sha256:installed",
  pluginVersion: "1",
  provider: "provider-a",
  schemaFingerprint: `sha256:${"b".repeat(64)}`,
};

describe("model capability handlers", () => {
  it("lists only the authenticated tenant's bounded catalog page", async () => {
    const list = vi.fn(async () => ({ items: [entry], nextCursor: "next" }));
    const app = await appWith({
      catalog: { list, resolve: async () => entry },
    });

    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/model-catalog?kind=embedding&limit=1`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [entry], nextCursor: "next" });
    expect(list).toHaveBeenCalledWith({ kind: "embedding", limit: 1, tenantId: "tenant-1" });
  });

  it("returns a stable unavailable response for malformed or failed catalog pages", async () => {
    const app = await appWith({
      catalog: {
        list: async () => ({ items: [entry, entry] }),
        resolve: async () => entry,
      },
    });
    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/model-catalog?kind=embedding&limit=1`,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "MODEL_CATALOG_UNAVAILABLE",
      error: "Model capability catalog is unavailable",
      retryable: true,
    });
  });

  it("returns a capability snapshot and maps validation/provider failures without leaking causes", async () => {
    const selection = { model: entry.model, pluginId: entry.pluginId, provider: entry.provider };
    const success = await appWith({
      preflight: {
        verify: async () => ({
          capabilityDigest: `sha256:${"c".repeat(64)}`,
          checkedAt: "2026-07-14T12:00:00.000Z",
          dimension: 384,
          distanceMetric: "cosine",
          kind: "embedding",
          pluginUniqueIdentifier: entry.pluginUniqueIdentifier,
          pluginVersion: "1",
          schemaFingerprint: entry.schemaFingerprint,
          selection,
        }),
      },
    });
    const successResponse = await success.request(
      `/knowledge-spaces/${SPACE_ID}/model-preflights`,
      {
        body: JSON.stringify({ kind: "embedding", selection }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(successResponse.status).toBe(200);
    await expect(successResponse.json()).resolves.toMatchObject({ dimension: 384 });

    const invalid = await appWith({
      preflight: {
        verify: async () => {
          throw new ModelCapabilityPreflightError(
            "MODEL_SELECTION_NOT_FOUND",
            "The selected model is not installed for this tenant",
            { cause: new Error("secret") },
          );
        },
      },
    });
    const invalidResponse = await invalid.request(
      `/knowledge-spaces/${SPACE_ID}/model-preflights`,
      {
        body: JSON.stringify({ kind: "embedding", selection }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(invalidResponse.status).toBe(422);
    const invalidText = await invalidResponse.text();
    expect(invalidText).toContain("MODEL_SELECTION_NOT_FOUND");
    expect(invalidText).not.toContain("secret");

    const unavailable = await appWith({
      preflight: {
        verify: async () => {
          throw new ModelCapabilityPreflightError(
            "MODEL_PREFLIGHT_FAILED",
            "The selected model failed its capability preflight",
            { cause: new Error("credential=secret"), retryable: true },
          );
        },
      },
    });
    const unavailableResponse = await unavailable.request(
      `/knowledge-spaces/${SPACE_ID}/model-preflights`,
      {
        body: JSON.stringify({ kind: "embedding", selection }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.text()).not.toContain("credential");
  });

  it("returns 404 for a space outside the authenticated tenant and 503 without capabilities", async () => {
    const app = await appWith({});
    const missing = await app.request(
      "/knowledge-spaces/20000000-0000-4000-8000-000000000002/model-catalog",
    );
    expect(missing.status).toBe(404);

    const unavailable = await app.request(`/knowledge-spaces/${SPACE_ID}/model-catalog`);
    expect(unavailable.status).toBe(503);
  });
});

async function appWith({
  catalog,
  preflight,
}: {
  readonly catalog?: ModelCapabilityCatalog | undefined;
  readonly preflight?: Parameters<typeof registerModelCapabilityHandlers>[0]["preflight"];
}) {
  const spaces = createInMemoryKnowledgeSpaceRepository({
    generateId: () => SPACE_ID,
    maxListLimit: 10,
    maxSpaces: 10,
  });
  await spaces.create({ name: "Space", slug: "space", tenantId: "tenant-1" });
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("callerKind", "interactive");
    context.set("rateLimitChecked", true);
    context.set("subject", {
      scopes: ["knowledge-spaces:*"],
      subjectId: "user-1",
      tenantId: "tenant-1",
    });
    context.set("traceId", "trace-1");
    await next();
  });
  registerModelCapabilityHandlers({
    app,
    ...(catalog ? { catalog } : {}),
    ...(preflight ? { preflight } : {}),
    spaces,
  });
  return app;
}
