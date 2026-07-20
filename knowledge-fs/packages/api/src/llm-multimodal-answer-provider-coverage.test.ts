import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  type GenerateMultimodalAnswerContentInput,
  type GenerateMultimodalAnswerTextInput,
  type LlmMultimodalContentBlock,
  createContentBlockMultimodalAnswerProvider,
  createLlmMultimodalAnswerProvider,
  createObjectStorageContentBlockMultimodalAnswerProvider,
} from "./llm-multimodal-answer-provider";
import type { MultimodalEvidenceAttachment } from "./multimodal-evidence";

describe("createLlmMultimodalAnswerProvider branch coverage", () => {
  it("rejects negative temperatures", () => {
    expect(() =>
      createLlmMultimodalAnswerProvider({
        model: "m",
        provider: { generate: async () => ({ text: "ok" }) },
        temperature: -0.5,
      }),
    ).toThrow("LLM multimodal answer temperature must be non-negative");
  });

  it("forwards tenant ids and tolerates bare provider results and sparse evidence", async () => {
    const calls: GenerateMultimodalAnswerTextInput[] = [];
    const provider = createLlmMultimodalAnswerProvider({
      model: "vision-text-answer",
      provider: {
        generate: async (input) => {
          calls.push(input);

          return { text: "  sparse answer  " };
        },
      },
    });

    await expect(
      provider.generate({
        evidence: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "doc-1",
              documentVersion: 1,
              sectionPath: [],
            },
            nodeId: "node-1",
            text: "Text without page or section.",
          },
        ],
        multimodalEvidence: [
          {
            documentAssetId: "doc-1",
            modality: "table",
            sectionPath: [],
          },
        ],
        query: "What does the table show?",
        tenantId: "tenant-42",
      }),
    ).resolves.toEqual({
      metadata: {},
      text: "sparse answer",
    });
    expect(calls[0]?.tenantId).toBe("tenant-42");
    const userMessage = calls[0]?.messages[1]?.content ?? "";
    expect(userMessage).toContain("[E1] node=node-1 page=unknown section=Document");
    expect(userMessage).toContain(
      "[M1] modality=table document=doc-1 page=unknown section=Document parseElement=unknown bbox=none assetRoute=none descriptor=none",
    );
  });
});

describe("createContentBlockMultimodalAnswerProvider branch coverage", () => {
  it("rejects invalid maxOutputTokens and temperature", () => {
    expect(() =>
      createContentBlockMultimodalAnswerProvider({
        maxOutputTokens: 0,
        model: "m",
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Content-block multimodal answer maxOutputTokens must be at least 1");
    expect(() =>
      createContentBlockMultimodalAnswerProvider({
        model: "m",
        provider: { generate: async () => ({ text: "ok" }) },
        temperature: -1,
      }),
    ).toThrow("Content-block multimodal answer temperature must be non-negative");
  });

  it("uses the default asset url resolver and sparse attachments without provider metadata", async () => {
    const calls: GenerateMultimodalAnswerContentInput[] = [];
    const provider = createContentBlockMultimodalAnswerProvider({
      model: "vision-native-answer",
      provider: {
        generate: async (input) => {
          calls.push(input);

          return { text: "answer" };
        },
      },
    });

    await expect(
      provider.generate({
        evidence: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "doc-1",
              documentVersion: 1,
              sectionPath: [],
            },
            nodeId: "node-1",
            text: "Sparse text evidence.",
          },
        ],
        multimodalEvidence: [
          // No assetRoute, no assetRef: the default resolver yields no image url.
          {
            documentAssetId: "doc-1",
            modality: "image",
            sectionPath: [],
          },
          // assetRef uri fallback (trimmed) via the default resolver.
          {
            assetRef: { uri: "  https://assets.example.test/figure.png  " },
            documentAssetId: "doc-1",
            modality: "image",
            parseElementId: "figure-2",
            sectionPath: ["Charts"],
          },
          // assetRoute takes precedence in the default resolver.
          {
            assetRoute: "/knowledge-spaces/space-1/documents/doc-1/multimodal/item-3/asset",
            documentAssetId: "doc-1",
            modality: "page",
            parseElementId: "page-3",
            sectionPath: ["Pages"],
          },
        ],
        query: "What does the figure show?",
        tenantId: "tenant-7",
      }),
    ).resolves.toEqual({
      metadata: { imageBlockCount: 2 },
      text: "answer",
    });
    expect(calls[0]?.tenantId).toBe("tenant-7");
    const content = calls[0]?.messages[1]?.content ?? [];
    const textBlocks = content.filter(
      (block): block is Extract<LlmMultimodalContentBlock, { type: "text" }> =>
        block.type === "text",
    );
    const imageBlocks = content.filter((block) => block.type === "image_url");

    expect(textBlocks[0]?.text).toContain("[E1] node=node-1 page=unknown section=Document");
    expect(textBlocks[1]?.text).toContain(
      "[M1] modality=image document=doc-1 page=unknown section=Document parseElement=unknown bbox=none imageUrl=none",
    );
    expect(imageBlocks).toEqual([
      {
        imageUrl: { detail: "auto", url: "https://assets.example.test/figure.png" },
        type: "image_url",
      },
      {
        imageUrl: {
          detail: "auto",
          url: "/knowledge-spaces/space-1/documents/doc-1/multimodal/item-3/asset",
        },
        type: "image_url",
      },
    ]);
  });
});

describe("createObjectStorageContentBlockMultimodalAnswerProvider branch coverage", () => {
  it("rejects a total image budget smaller than the per-image budget", () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    expect(() =>
      createObjectStorageContentBlockMultimodalAnswerProvider({
        maxTotalImageBytes: 1,
        model: "m",
        objectStorage: adapter.objectStorage,
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Object-storage multimodal answer maxTotalImageBytes must be at least maxImageBytes");
  });

  it("skips non-visual, unresolvable, missing, oversized, and duplicate assets and enforces the total budget", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "assets/small-a.png",
    });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([4, 5, 6]),
      contentType: "image/png",
      key: "assets/small-b.png",
    });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([7, 8, 9, 10, 11]),
      contentType: "image/png",
      key: "assets/too-big.png",
    });
    const calls: GenerateMultimodalAnswerContentInput[] = [];
    const provider = createObjectStorageContentBlockMultimodalAnswerProvider({
      maxImageBytes: 4,
      maxTotalImageBytes: 4,
      model: "vision-native-answer",
      objectStorage: adapter.objectStorage,
      provider: {
        generate: async (input) => {
          calls.push(input);

          return { text: "budgeted answer" };
        },
      },
    });

    const attachment = ({
      assetRef,
      modality,
    }: {
      readonly assetRef?: Record<string, unknown> | undefined;
      readonly modality: string;
    }): MultimodalEvidenceAttachment => ({
      ...(assetRef ? { assetRef } : {}),
      documentAssetId: "doc-1",
      modality,
      sectionPath: [],
    });

    const result = await provider.generate({
      evidence: [],
      multimodalEvidence: [
        // Non-visual attachments never load bytes, even with a valid asset ref.
        attachment({
          assetRef: { contentType: "image/png", objectKey: "assets/small-a.png" },
          modality: "table",
        }),
        // Visual attachment without an asset ref resolves no object key.
        attachment({ modality: "image" }),
        // Asset ref with a non-image content type is not object-backed.
        attachment({
          assetRef: { contentType: "application/pdf", objectKey: "assets/small-a.png" },
          modality: "image",
        }),
        // Asset ref without an object key (variants lack the preferred name) is skipped.
        attachment({
          assetRef: {
            contentType: "image/png",
            variants: { large: { contentType: "image/png", objectKey: "assets/small-b.png" } },
          },
          modality: "image",
        }),
        // Asset ref without a content type is skipped.
        attachment({ assetRef: { objectKey: "assets/small-a.png" }, modality: "image" }),
        // Object key that does not exist in storage is skipped.
        attachment({
          assetRef: { contentType: "image/png", objectKey: "assets/missing.png" },
          modality: "image",
        }),
        // Object above maxImageBytes is skipped.
        attachment({
          assetRef: { contentType: "image/png", objectKey: "assets/too-big.png" },
          modality: "image",
        }),
        // First loadable image consumes 3 of the 4-byte total budget.
        attachment({
          assetRef: { contentType: "image/png", objectKey: "assets/small-a.png" },
          modality: "image",
        }),
        // Duplicate object key reuses the already-loaded data url.
        attachment({
          assetRef: { contentType: "image/png", objectKey: "assets/small-a.png" },
          modality: "image",
        }),
        // Next image would exceed the total budget, so loading stops here.
        attachment({
          assetRef: { contentType: "image/png", objectKey: "assets/small-b.png" },
          modality: "image",
        }),
      ],
      query: "Which images fit the budget?",
    });

    expect(result).toMatchObject({
      metadata: { imageBlockCount: 2 },
      text: "budgeted answer",
    });
    const imageBlocks = (calls[0]?.messages[1]?.content ?? []).filter(
      (block): block is Extract<LlmMultimodalContentBlock, { type: "image_url" }> =>
        block.type === "image_url",
    );

    // Only the deduplicated small-a bytes were loaded; small-b hit the total budget.
    expect(imageBlocks.map((block) => block.imageUrl.url)).toEqual([
      "data:image/png;base64,AQID",
      "data:image/png;base64,AQID",
    ]);
  });
});
