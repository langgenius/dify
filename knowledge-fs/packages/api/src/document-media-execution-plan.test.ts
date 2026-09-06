import { describe, expect, it } from "vitest";
import {
  createDocumentMediaExecutionPlan,
  createProfileDocumentMediaCapabilityResolver,
  documentParserHints,
  withDocumentMediaExecutionPlan,
} from "./document-media-execution-plan";
import type { KnowledgeSpaceProfileHead } from "./knowledge-space-profile-repository";

describe("immutable document media execution plan", () => {
  it("persists the immutable plan without replacing other completeness diagnostics", () => {
    const original = {
      metadata: { parseCoverage: { text: { status: "complete" }, media: { status: "unknown" } } },
    } as unknown as import("@knowledge/core").ParseArtifact;
    const plan = createDocumentMediaExecutionPlan({
      hasPdfRasterizer: false,
      hasImageVariantGenerator: false,
      visualEmbeddingEnabled: true,
    });
    expect(withDocumentMediaExecutionPlan(original, plan).metadata).toMatchObject({
      mediaExecutionPlan: plan,
      parseCoverage: original.metadata.parseCoverage,
    });
    expect(
      withDocumentMediaExecutionPlan(original, { ...plan, materializeImages: false }).metadata,
    ).toMatchObject({
      parseCoverage: { text: { status: "complete" }, media: { status: "not-requested" } },
    });
    expect(withDocumentMediaExecutionPlan({ ...original, metadata: {} }, plan).metadata).toEqual({
      mediaExecutionPlan: plan,
    });
  });
  it("keeps source references but disables rasterization and decoding for a text-only profile", () => {
    const plan = createDocumentMediaExecutionPlan({
      profileImageExtractionEnabled: false,
      hasPdfRasterizer: true,
      hasImageVariantGenerator: true,
      visualEmbeddingEnabled: false,
    });
    expect(plan).toMatchObject({
      preserveSourceReferences: true,
      materializeImages: false,
      rasterizePdf: false,
      generateVariants: false,
      visualEmbedding: false,
    });
    expect(Object.isFrozen(plan)).toBe(true);
  });
  it("enables vision materialization independently of available embedding support", () => {
    expect(
      createDocumentMediaExecutionPlan({
        profileImageExtractionEnabled: true,
        hasPdfRasterizer: true,
        hasImageVariantGenerator: true,
        visualEmbeddingEnabled: false,
      }),
    ).toMatchObject({
      materializeImages: true,
      rasterizePdf: true,
      generateVariants: true,
      visualEmbedding: false,
    });
  });
  it("preserves legacy inline-image materialization without explicitly configured profiles", () => {
    expect(
      createDocumentMediaExecutionPlan({
        hasPdfRasterizer: false,
        hasImageVariantGenerator: false,
        visualEmbeddingEnabled: false,
      }),
    ).toMatchObject({ materializeImages: true, rasterizePdf: false, generateVariants: false });
  });
  it("captures identical bounded parser hints for synchronous and durable compilation", () => {
    expect(
      documentParserHints({
        assetMetadata: {
          language: " zh ",
          layoutComplexity: "complex",
          requiresOcr: true,
          requiresTables: true,
        },
        imagesHandledExternally: false,
        requiresImages: true,
      }),
    ).toEqual({
      language: "zh",
      layoutComplexity: "complex",
      requiresOcr: true,
      requiresTables: true,
      imagesHandledExternally: false,
      requiresImages: true,
    });
    expect(
      documentParserHints({
        assetMetadata: { language: 1, layoutComplexity: "invalid" },
        imagesHandledExternally: false,
        requiresImages: false,
      }),
    ).toEqual({ imagesHandledExternally: false, requiresImages: false });
  });
  it("resolves synchronous capabilities once from the space's immutable profile snapshots", async () => {
    const resolver = createProfileDocumentMediaCapabilityResolver({
      profiles: {
        getHead: async ({ kind }) =>
          ({
            profile: {
              capabilitySnapshot:
                kind === "embedding" ? { image: false } : { reasoning: { image: true } },
            },
          }) as unknown as KnowledgeSpaceProfileHead,
      },
      modalities: {
        resolve: async ({ snapshot }) =>
          (snapshot as { image: boolean }).image ? ["text", "image"] : ["text"],
      },
    });
    await expect(resolver({ knowledgeSpaceId: "space", tenantId: "tenant" })).resolves.toEqual({
      imageExtractionEnabled: true,
      visualEmbeddingEnabled: false,
    });
  });
  it("fails closed when neither profile contains a vision capability", async () => {
    const resolver = createProfileDocumentMediaCapabilityResolver({
      profiles: { getHead: async () => null },
      modalities: {
        resolve: async () => {
          throw new Error("No snapshot should resolve");
        },
      },
    });
    await expect(resolver({ knowledgeSpaceId: "space", tenantId: "tenant" })).resolves.toEqual({
      imageExtractionEnabled: false,
      visualEmbeddingEnabled: false,
    });
  });
});
