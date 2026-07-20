import {
  type DocumentOutline,
  type ParseArtifact,
  createDefaultKnowledgeSpaceManifest,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createKnowledgeSpaceOutlineSummaryEnhancer } from "./knowledge-space-outline-summary-enhancer";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

describe("knowledge-space PageIndex Summary enhancer", () => {
  it("uses the owning space reasoning model and records it on the Outline", async () => {
    const stream = vi.fn(async function* (input) {
      yield { delta: `Summary by ${input.model}`, type: "delta" as const };
      yield { metadata: { requestId: "req-1" }, type: "done" as const };
    });
    const factory = vi.fn(() => ({ kind: "plugin-daemon", stream }));
    const enhancer = createKnowledgeSpaceOutlineSummaryEnhancer({
      manifests: {
        get: async () => ({
          ...createDefaultKnowledgeSpaceManifest({
            createdAt: "2026-07-14T00:00:00.000Z",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
            knowledgeSpaceId: SPACE_ID,
            tenantId: "tenant-1",
            updatedAt: "2026-07-14T00:00:00.000Z",
          }),
          retrievalProfile: {
            defaultMode: "research",
            reasoningModel: {
              model: "space-reasoning-v3",
              pluginId: "vendor/chat",
              provider: "vendor",
            },
            rerank: { enabled: false },
            revision: 3,
            scoreThreshold: { enabled: false, stage: "mode-final" },
            topK: 8,
          },
        }),
      },
      maxInputChars: 4_000,
      maxOutputTokens: 256,
      maxSummaryChars: 1_000,
      providerFactory: factory,
    });

    const result = await enhancer.enhance({
      outline: outline(),
      parseArtifact: artifact(),
      tenantId: "tenant-1",
    });

    expect(factory).toHaveBeenCalledWith({
      model: "space-reasoning-v3",
      pluginId: "vendor/chat",
      provider: "vendor",
    });
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: "space-reasoning-v3" }));
    expect(result.nodes[0]?.summary).toBe("Summary by space-reasoning-v3");
    expect(result.metadata).toMatchObject({
      summary: { model: "space-reasoning-v3", source: "provider" },
    });
  });

  it("keeps deterministic summaries for legacy spaces without a retrieval profile", async () => {
    const original = outline();
    const enhancer = createKnowledgeSpaceOutlineSummaryEnhancer({
      manifests: { get: async () => null },
      maxInputChars: 4_000,
      maxOutputTokens: 256,
      maxSummaryChars: 1_000,
      providerFactory: () => {
        throw new Error("must not resolve provider");
      },
    });

    await expect(
      enhancer.enhance({ outline: original, parseArtifact: artifact(), tenantId: "tenant-1" }),
    ).resolves.toBe(original);
  });

  it("uses a frozen attempt profile without rereading the mutable manifest", async () => {
    const manifestGet = vi.fn(async () => {
      throw new Error("mutable manifest must not be read");
    });
    const factory = vi.fn(() => ({
      stream: async function* (input: { readonly model: string }) {
        yield { delta: `Frozen ${input.model}`, type: "delta" as const };
      },
    }));
    const enhancer = createKnowledgeSpaceOutlineSummaryEnhancer({
      manifests: { get: manifestGet },
      maxInputChars: 4_000,
      maxOutputTokens: 256,
      maxSummaryChars: 1_000,
      providerFactory: factory,
    });

    const result = await enhancer.enhance({
      outline: outline(),
      parseArtifact: artifact(),
      retrievalProfile: {
        defaultMode: "research",
        reasoningModel: {
          model: "frozen-reasoning-v9",
          pluginId: "vendor/chat",
          provider: "vendor",
        },
        rerank: { enabled: false },
        revision: 9,
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 6,
      },
      tenantId: "tenant-1",
    });

    expect(manifestGet).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ model: "frozen-reasoning-v9" }));
    expect(result.nodes[0]?.summary).toBe("Frozen frozen-reasoning-v9");
  });

  it("fails closed when profile resolution lacks tenant scope", async () => {
    const enhancer = createKnowledgeSpaceOutlineSummaryEnhancer({
      manifests: { get: async () => null },
      maxInputChars: 4_000,
      maxOutputTokens: 256,
      maxSummaryChars: 1_000,
      providerFactory: () => {
        throw new Error("unreachable");
      },
    });

    await expect(
      enhancer.enhance({ outline: outline(), parseArtifact: artifact() }),
    ).rejects.toThrow("requires a tenant scope");
  });

  it("fails closed without accumulating an unbounded provider stream", async () => {
    const enhancer = createKnowledgeSpaceOutlineSummaryEnhancer({
      manifests: {
        get: async () => ({
          ...createDefaultKnowledgeSpaceManifest({
            createdAt: "2026-07-14T00:00:00.000Z",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
            knowledgeSpaceId: SPACE_ID,
            tenantId: "tenant-1",
            updatedAt: "2026-07-14T00:00:00.000Z",
          }),
          retrievalProfile: {
            defaultMode: "research",
            reasoningModel: { model: "reasoning", pluginId: "vendor/chat", provider: "vendor" },
            rerank: { enabled: false },
            revision: 1,
            scoreThreshold: { enabled: false, stage: "mode-final" },
            topK: 5,
          },
        }),
      },
      maxInputChars: 4_000,
      maxOutputTokens: 256,
      maxSummaryChars: 10,
      providerFactory: () => ({
        stream: async function* () {
          yield { delta: "x".repeat(41), type: "delta" as const };
        },
      }),
    });

    await expect(
      enhancer.enhance({ outline: outline(), parseArtifact: artifact(), tenantId: "tenant-1" }),
    ).rejects.toThrow("output exceeds 40 characters");
  });
});

function outline(): DocumentOutline {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    nodes: [
      {
        childNodeIds: [],
        children: [],
        endOffset: 22,
        id: "section-1",
        level: 1,
        metadata: {},
        sectionPath: ["Warranty"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: "Deterministic summary",
        title: "Warranty",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "document-outline-v1",
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    version: 1,
  };
}

function artifact(): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    elements: [
      {
        id: "element-1",
        metadata: {},
        sectionPath: ["Warranty"],
        text: "Camera warranty policy",
        type: "paragraph",
      },
    ],
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    metadata: {},
    parser: "native-markdown",
    version: 1,
  };
}
