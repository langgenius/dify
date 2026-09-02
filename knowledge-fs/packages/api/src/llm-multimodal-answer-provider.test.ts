import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import {
  type GenerateMultimodalAnswerContentInput,
  type GenerateMultimodalAnswerTextInput,
  createContentBlockMultimodalAnswerProvider,
  createLlmMultimodalAnswerProvider,
  createObjectStorageContentBlockMultimodalAnswerProvider,
} from "./llm-multimodal-answer-provider";

describe("createLlmMultimodalAnswerProvider", () => {
  it("generates a grounded answer prompt with multimodal attachment references", async () => {
    const calls: GenerateMultimodalAnswerTextInput[] = [];
    const provider = createLlmMultimodalAnswerProvider({
      model: "vision-text-answer",
      provider: {
        generate: async (input) => {
          calls.push(input);

          return {
            finishReason: "stop",
            metadata: { requestId: "req-1" },
            model: "vision-text-answer@1",
            text: "Revenue increased 12% on page 3.",
          };
        },
        kind: "static-llm",
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
              pageNumber: 3,
              sectionPath: ["Charts"],
            },
            nodeId: "node-1",
            text: "OCR says revenue increased 12%",
          },
        ],
        multimodalEvidence: [
          {
            assetDescriptorPath: "/knowledge/docs/Report.pdf--doc/assets/chart.json",
            assetRoute: "/knowledge-spaces/space-1/documents/doc-1/multimodal/item-1/asset",
            boundingBox: { height: 120, width: 240, x: 10, y: 20 },
            documentAssetId: "doc-1",
            manifestItemId: "item-1",
            modality: "image",
            pageNumber: 3,
            parseElementId: "chart-1",
            sectionPath: ["Charts"],
          },
        ],
        query: "What does the chart show?",
        traceId: "trace-1",
      }),
    ).resolves.toEqual({
      metadata: {
        finishReason: "stop",
        generationModel: "vision-text-answer@1",
        provider: "static-llm",
        requestId: "req-1",
      },
      text: "Revenue increased 12% on page 3.",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      maxOutputTokens: 1_000,
      model: "vision-text-answer",
      temperature: 0,
    });
    expect(calls[0]?.messages[1]?.content).toContain("OCR says revenue increased 12%");
    expect(calls[0]?.messages[1]?.content).toContain(
      "/knowledge-spaces/space-1/documents/doc-1/multimodal/item-1/asset",
    );
    expect(calls[0]?.messages[1]?.content).toContain(
      'bbox={"height":120,"width":240,"x":10,"y":20}',
    );
  });

  it("validates bounded configuration", () => {
    expect(() =>
      createLlmMultimodalAnswerProvider({
        model: " ",
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("LLM multimodal answer model is required");
    expect(() =>
      createLlmMultimodalAnswerProvider({
        maxOutputTokens: 0,
        model: "m",
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("LLM multimodal answer maxOutputTokens must be at least 1");
  });
});

describe("createContentBlockMultimodalAnswerProvider", () => {
  it("sends resolved image attachments as native content blocks", async () => {
    const calls: GenerateMultimodalAnswerContentInput[] = [];
    const provider = createContentBlockMultimodalAnswerProvider({
      assetUrlResolver: (attachment) =>
        attachment.assetRoute ? `https://api.example.test${attachment.assetRoute}` : undefined,
      imageDetail: "high",
      model: "vision-native-answer",
      provider: {
        generate: async (input) => {
          calls.push(input);

          return {
            finishReason: "stop",
            metadata: { requestId: "vlm-req-1" },
            model: "vision-native-answer@1",
            text: "The chart image shows revenue increased 12%.",
          };
        },
        kind: "content-block-vlm",
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
              pageNumber: 3,
              sectionPath: ["Charts"],
            },
            nodeId: "node-1",
            text: "OCR fallback says revenue increased 12%",
          },
        ],
        multimodalEvidence: [
          {
            assetDescriptorPath: "/knowledge/docs/Report.pdf--doc/assets/chart.json",
            assetRoute: "/knowledge-spaces/space-1/documents/doc-1/multimodal/item-1/asset",
            boundingBox: { height: 120, width: 240, x: 10, y: 20 },
            documentAssetId: "doc-1",
            manifestItemId: "item-1",
            modality: "image",
            pageNumber: 3,
            parseElementId: "chart-1",
            sectionPath: ["Charts"],
          },
          {
            documentAssetId: "doc-1",
            modality: "table",
            parseElementId: "table-1",
            sectionPath: ["Tables"],
          },
        ],
        query: "What does the chart show?",
        traceId: "trace-1",
      }),
    ).resolves.toEqual({
      metadata: {
        finishReason: "stop",
        generationModel: "vision-native-answer@1",
        imageBlockCount: 1,
        provider: "content-block-vlm",
        requestId: "vlm-req-1",
      },
      text: "The chart image shows revenue increased 12%.",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      maxOutputTokens: 1_000,
      model: "vision-native-answer",
      temperature: 0,
    });
    expect(calls[0]?.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          imageUrl: {
            detail: "high",
            url: "https://api.example.test/knowledge-spaces/space-1/documents/doc-1/multimodal/item-1/asset",
          },
          type: "image_url",
        }),
      ]),
    );
    expect(calls[0]?.messages[1]?.content[1]).toMatchObject({
      text: expect.stringContaining('bbox={"height":120,"width":240,"x":10,"y":20}'),
      type: "text",
    });
  });

  it("validates content-block provider configuration", () => {
    expect(() =>
      createContentBlockMultimodalAnswerProvider({
        model: " ",
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Content-block multimodal answer model is required");
    expect(() =>
      createContentBlockMultimodalAnswerProvider({
        maxImageAttachments: -1,
        model: "m",
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Content-block multimodal answer maxImageAttachments must be non-negative");
  });
});

describe("createObjectStorageContentBlockMultimodalAnswerProvider", () => {
  it("puts query images before evidence images and reserves the byte budget for them", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([9, 9, 9]),
      contentType: "image/png",
      key: "evidence.png",
    });
    const calls: GenerateMultimodalAnswerContentInput[] = [];
    const provider = createObjectStorageContentBlockMultimodalAnswerProvider({
      maxImageBytes: 3,
      maxTotalImageBytes: 3,
      model: "vision-native-answer",
      objectStorage: adapter.objectStorage,
      provider: {
        generate: async (input) => {
          calls.push(input);
          return { text: "grounded" };
        },
      },
    });

    await provider.generate({
      evidence: [],
      multimodalEvidence: [
        {
          assetRef: { contentType: "image/png", objectKey: "evidence.png" },
          documentAssetId: "doc-1",
          modality: "image",
          parseElementId: "image-1",
          sectionPath: [],
        },
      ],
      query: "find this image",
      queryImages: [
        {
          body: new Uint8Array([1, 2, 3]),
          byteSize: 3,
          mimeType: "image/png",
          sha256: "a".repeat(64),
          uploadFileId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    });

    const content = calls[0]?.messages[1]?.content ?? [];
    const imageBlocks = content.filter((block) => block.type === "image_url");
    expect(imageBlocks).toEqual([
      expect.objectContaining({
        imageUrl: { detail: "auto", url: "data:image/png;base64,AQID" },
      }),
    ]);
    expect(content[1]).toMatchObject({ type: "image_url" });
  });

  it("loads object-backed image attachments as data URL content blocks", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "tenant/spaces/space/documents/doc/assets/chart-thumbnail.png",
    });
    const calls: GenerateMultimodalAnswerContentInput[] = [];
    const provider = createObjectStorageContentBlockMultimodalAnswerProvider({
      model: "vision-native-answer",
      objectStorage: adapter.objectStorage,
      provider: {
        generate: async (input) => {
          calls.push(input);

          return {
            metadata: { requestId: "vlm-data-url-1" },
            text: "The object-backed image shows revenue increased.",
          };
        },
        kind: "content-block-vlm",
      },
    });

    await expect(
      provider.generate({
        evidence: [],
        multimodalEvidence: [
          {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/documents/doc/assets/chart.png",
              variants: {
                thumbnail: {
                  contentType: "image/png",
                  objectKey: "tenant/spaces/space/documents/doc/assets/chart-thumbnail.png",
                },
              },
            },
            documentAssetId: "doc-1",
            modality: "image",
            parseElementId: "chart-1",
            sectionPath: ["Charts"],
          },
        ],
        query: "What does the chart show?",
      }),
    ).resolves.toMatchObject({
      metadata: {
        imageBlockCount: 1,
        provider: "content-block-vlm",
        requestId: "vlm-data-url-1",
      },
      text: "The object-backed image shows revenue increased.",
    });
    expect(calls[0]?.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          imageUrl: {
            detail: "auto",
            url: "data:image/png;base64,AQID",
          },
          type: "image_url",
        }),
      ]),
    );
  });

  it("streams evidence images under the per-image hard limit without calling getObject", async () => {
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1024,
    });
    await objectStorage.putObject({
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/png",
      key: "oversized.png",
    });
    const getObject = vi.spyOn(objectStorage, "getObject");
    const getObjectStream = vi.spyOn(objectStorage, "getObjectStream");
    const calls: GenerateMultimodalAnswerContentInput[] = [];
    const provider = createObjectStorageContentBlockMultimodalAnswerProvider({
      maxImageBytes: 3,
      maxTotalImageBytes: 3,
      model: "vision-native-answer",
      objectStorage,
      provider: {
        generate: async (input) => {
          calls.push(input);
          return { text: "text-only fallback evidence" };
        },
      },
    });

    await provider.generate({
      evidence: [],
      multimodalEvidence: [
        {
          assetRef: { contentType: "image/png", objectKey: "oversized.png" },
          documentAssetId: "doc-1",
          modality: "image",
          parseElementId: "image-1",
          sectionPath: [],
        },
      ],
      query: "describe",
    });

    expect(getObject).not.toHaveBeenCalled();
    expect(getObjectStream).toHaveBeenCalledWith("oversized.png");
    expect(calls[0]?.messages.flatMap((message) => message.content)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image_url" })]),
    );
  });

  it("bounds an evidence stream by the aggregate bytes remaining after query images", async () => {
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1024,
    });
    const cancel = vi.fn();
    objectStorage.getObjectStream = async () =>
      new ReadableStream<Uint8Array>({
        cancel,
        start: (controller) => {
          controller.enqueue(new Uint8Array([7, 8]));
        },
      });
    const calls: GenerateMultimodalAnswerContentInput[] = [];
    const provider = createObjectStorageContentBlockMultimodalAnswerProvider({
      maxImageBytes: 3,
      maxTotalImageBytes: 3,
      model: "vision-native-answer",
      objectStorage,
      provider: {
        generate: async (input) => {
          calls.push(input);
          return { text: "query image only" };
        },
      },
    });

    await provider.generate({
      evidence: [],
      multimodalEvidence: [
        {
          assetRef: { contentType: "image/png", objectKey: "evidence.png" },
          documentAssetId: "doc-1",
          modality: "image",
          parseElementId: "image-1",
          sectionPath: [],
        },
      ],
      query: "find this",
      queryImages: [
        {
          body: new Uint8Array([1, 2]),
          byteSize: 2,
          mimeType: "image/png",
          sha256: "a".repeat(64),
          uploadFileId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    });

    expect(cancel).toHaveBeenCalled();
    expect(calls[0]?.messages.flatMap((message) => message.content)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          imageUrl: { detail: "auto", url: "data:image/png;base64,AQI=" },
          type: "image_url",
        }),
      ]),
    );
    expect(calls[0]?.messages.flatMap((message) => message.content)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          imageUrl: expect.objectContaining({ url: "data:image/png;base64,Bwg=" }),
        }),
      ]),
    );
  });

  it("cancels a stalled object stream before invoking the vision model", async () => {
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1024,
    });
    const cancel = vi.fn();
    objectStorage.getObjectStream = async () =>
      new ReadableStream<Uint8Array>({ cancel, start: () => undefined });
    const generate = vi.fn(async () => ({ text: "unexpected" }));
    const provider = createObjectStorageContentBlockMultimodalAnswerProvider({
      model: "vision-native-answer",
      objectStorage,
      provider: { generate },
    });
    const controller = new AbortController();
    const aborted = new Error("lease lost");
    const pending = provider.generate({
      evidence: [],
      multimodalEvidence: [
        {
          assetRef: { contentType: "image/png", objectKey: "stalled.png" },
          documentAssetId: "doc-1",
          modality: "image",
          parseElementId: "image-1",
          sectionPath: [],
        },
      ],
      query: "describe",
      signal: controller.signal,
    });

    controller.abort(aborted);

    await expect(pending).rejects.toBe(aborted);
    expect(cancel).toHaveBeenCalledWith(aborted);
    expect(generate).not.toHaveBeenCalled();
  });

  it("validates object-backed image block configuration", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    expect(() =>
      createObjectStorageContentBlockMultimodalAnswerProvider({
        maxImageBytes: 0,
        model: "m",
        objectStorage: adapter.objectStorage,
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Object-storage multimodal answer maxImageBytes must be at least 1");
  });
});
