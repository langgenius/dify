import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createStaticAuthVerifier } from "./auth";
import { createDefaultComputeRuntime, createDefaultParser } from "./gateway-defaults";
import { createKnowledgeGateway } from "./index";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

describe("gateway defaults", () => {
  it("creates native parser fallback with unavailable unstructured parser", async () => {
    const parser = createDefaultParser();

    const markdownArtifact = await parser.parse({
      body: new TextEncoder().encode("# Title\n\nBody\n\n![Diagram](https://cdn.test/diagram.png)"),
      documentAssetId: "00000000-0000-4000-8000-000000000001",
      filename: "doc.md",
      mimeType: "text/markdown",
      version: 1,
    });

    expect(markdownArtifact.elements.map((element) => element.type)).toContain("heading");
    expect(markdownArtifact.elements).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          assetRef: {
            contentType: "image/png",
            uri: "https://cdn.test/diagram.png",
          },
          caption: "Diagram",
          source: "markdown-image",
        }),
        text: "Diagram",
        type: "image",
      }),
    );

    await expect(
      parser.parse({
        body: new Uint8Array([1, 2, 3]),
        documentAssetId: "00000000-0000-4000-8000-000000000002",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser is not configured");
  });

  it("creates a built-in TypeScript compute runtime", () => {
    const compute = createDefaultComputeRuntime();

    expect(compute.countTokens("hello")).toBeGreaterThan(0);
    expect(compute.diffText({ oldText: "a", newText: "b" }).operations).toEqual([
      expect.objectContaining({ kind: "delete", text: "a" }),
      expect.objectContaining({ kind: "insert", text: "b" }),
    ]);
  });

  it("fails closed when no query generator or explicit local fallback is configured", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const space = await spaces.create({
      name: "Unavailable query backend",
      slug: "unavailable-query-backend",
      tenantId: "tenant-1",
    });
    const token = "read-token";
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "reader-1",
          tenantId: "tenant-1",
        },
        token,
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        {
          knowledgeSpaceId: space.id,
          ownerSubjectId: "reader-1",
        },
      ]),
      knowledgeSpaces: spaces,
    });

    const response = await app.request("/queries", {
      body: JSON.stringify({
        knowledgeSpaceId: space.id,
        mode: "deep",
        query: "Do not scan local nodes implicitly",
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Query generation unavailable" });
  });
});
