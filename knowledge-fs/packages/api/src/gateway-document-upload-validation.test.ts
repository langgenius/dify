import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ParserAdapter } from "@knowledge/parsers";
import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryDocumentAssetRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

describe("document upload gateway validation", () => {
  it("rejects a filename without a supported extension before object storage", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const adapter = createNodePlatformAdapter({ env: {} });
    const parse = vi.fn<ParserAdapter["parse"]>();
    const app = createKnowledgeGateway({
      adapter,
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          "write-token": {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      documentAssets: createInMemoryDocumentAssetRepository({
        maxAssets: 10,
        now: () => "2026-05-09T11:00:00.000Z",
      }),
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      parser: { kind: "native-markdown", parse },
    });
    const authorization = { authorization: "Bearer write-token" };
    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...authorization, "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "note"));
    const uploaded = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents`, {
      body: form,
      headers: authorization,
      method: "POST",
    });

    expect(uploaded.status).toBe(400);
    await expect(uploaded.json()).resolves.toEqual({
      error: "Document upload file type is not supported",
    });
    expect(parse).not.toHaveBeenCalled();
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${knowledgeSpaceId}/documents/`,
      }),
    ).resolves.toEqual({ objects: [] });
  });
});
