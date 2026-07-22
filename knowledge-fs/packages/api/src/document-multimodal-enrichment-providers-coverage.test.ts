import type { DocumentMultimodalItem } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createCompositeDocumentMultimodalEnrichmentProvider,
  createMetadataDocumentMultimodalEnrichmentProvider,
  createUnderstandingDocumentMultimodalEnrichmentProvider,
} from "./document-multimodal-enrichment-providers";
import type { DocumentMultimodalUnderstandingProviderInput } from "./document-multimodal-enrichment-providers";
import type { DocumentMultimodalEnrichmentProviderInput } from "./document-multimodal-manifest-enhancer";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const manifestId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

function multimodalItem(overrides: Partial<DocumentMultimodalItem> = {}): DocumentMultimodalItem {
  return {
    enrichment: {
      asset: "missing",
      caption: "missing",
      ocr: "missing",
      tableStructure: "missing",
      visualEmbedding: "missing",
    },
    id: "item-1",
    modality: "image",
    parseElementId: "element-1",
    sectionPath: [],
    sourceMetadata: {},
    ...overrides,
  };
}

function providerInput(
  item: DocumentMultimodalItem,
  overrides: Partial<DocumentMultimodalEnrichmentProviderInput> = {},
): DocumentMultimodalEnrichmentProviderInput {
  return {
    documentAssetId,
    item,
    knowledgeSpaceId,
    manifestId,
    manifestVersion: "multimodal-manifest-v1",
    model: "vision-model",
    parseArtifactId,
    promptVersion: "prompt-v1",
    ...overrides,
  };
}

describe("document multimodal enrichment providers coverage", () => {
  it("validates understanding provider options", () => {
    expect(() =>
      createUnderstandingDocumentMultimodalEnrichmentProvider({
        maxSummaryChars: 0,
        provider: {
          understand: async () => ({}),
        },
      }),
    ).toThrow("Understanding multimodal enrichment maxSummaryChars must be at least 1");
  });

  it("skips modalities that have no understanding task", async () => {
    let calls = 0;
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      provider: {
        understand: async () => {
          calls += 1;
          return {};
        },
      },
    });

    await expect(
      provider.enrich(providerInput(multimodalItem({ modality: "code" }))),
    ).resolves.toEqual({});
    await expect(
      provider.enrich(providerInput(multimodalItem({ modality: "page" }))),
    ).resolves.toEqual({});
    expect(calls).toBe(0);
  });

  it("forwards tenant and trace ids to the understanding provider", async () => {
    const calls: DocumentMultimodalUnderstandingProviderInput[] = [];
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      provider: {
        understand: async (input) => {
          calls.push(input);
          return {};
        },
      },
    });

    await provider.enrich(
      providerInput(multimodalItem(), { tenantId: "tenant-1", traceId: "trace-1" }),
    );

    expect(calls[0]).toMatchObject({ task: "image", tenantId: "tenant-1", traceId: "trace-1" });
  });

  it("builds minimal metadata for kindless providers returning empty results", async () => {
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      provider: { understand: async () => ({ summary: "   " }) },
    });

    const result = await provider.enrich(providerInput(multimodalItem()));

    expect(result).toEqual({
      metadata: {
        model: "vision-model",
        promptVersion: "prompt-v1",
        status: "provided",
        task: "image",
      },
    });
    expect(result.metadata).not.toHaveProperty("provider");
    expect(result.metadata).not.toHaveProperty("summary");
  });

  it("defaults the table structure status when the provider omits it", async () => {
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      provider: { understand: async () => ({ summary: "Rows of ARR data" }) },
    });

    await expect(
      provider.enrich(providerInput(multimodalItem({ modality: "table" }))),
    ).resolves.toMatchObject({
      tableStructureStatus: "provided",
      textPreview: "Rows of ARR data",
    });
  });

  it("rethrows provider errors when recovery is disabled", async () => {
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      provider: {
        understand: async () => {
          throw new Error("vision model unavailable");
        },
      },
      recoverProviderErrors: false,
    });

    await expect(provider.enrich(providerInput(multimodalItem()))).rejects.toThrow(
      "vision model unavailable",
    );
  });

  it("records unknown errors from kindless providers as failed metadata", async () => {
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      provider: {
        understand: async () => {
          throw "boom" as unknown as Error;
        },
      },
    });

    const result = await provider.enrich(providerInput(multimodalItem()));

    expect(result.metadata).toMatchObject({
      error: "Unknown multimodal provider error",
      status: "failed",
      task: "image",
    });
    expect(result.metadata).not.toHaveProperty("provider");
  });

  it("passes through asset refs, bounding boxes, and caption-derived fields", async () => {
    const provider = createMetadataDocumentMultimodalEnrichmentProvider();

    const result = await provider.enrich(
      providerInput(
        multimodalItem({
          assetRef: { objectKey: "tenant/spaces/space/assets/figure.png" },
          boundingBox: { height: 10, width: 20, x: 1, y: 2 },
          sourceMetadata: { caption: "Figure caption" },
        }),
      ),
    );

    expect(result).toMatchObject({
      assetRef: { objectKey: "tenant/spaces/space/assets/figure.png" },
      boundingBox: { height: 10, width: 20, x: 1, y: 2 },
      caption: "Figure caption",
      textPreview: "Figure caption",
      title: "Figure caption",
    });
  });

  it("resolves text previews through each metadata fallback", async () => {
    const provider = createMetadataDocumentMultimodalEnrichmentProvider();

    await expect(
      provider.enrich(providerInput(multimodalItem({ textPreview: "explicit preview" }))),
    ).resolves.toMatchObject({ textPreview: "explicit preview" });
    await expect(
      provider.enrich(
        providerInput(
          multimodalItem({
            modality: "table",
            sourceMetadata: { tableSummary: "table summary" },
          }),
        ),
      ),
    ).resolves.toMatchObject({ tableStructureStatus: "missing", textPreview: "table summary" });
    await expect(
      provider.enrich(
        providerInput(multimodalItem({ sourceMetadata: { chartDescription: "chart summary" } })),
      ),
    ).resolves.toMatchObject({ textPreview: "chart summary" });

    const empty = await provider.enrich(providerInput(multimodalItem()));
    expect(empty).not.toHaveProperty("textPreview");
    expect(empty).not.toHaveProperty("caption");
    expect(empty).not.toHaveProperty("title");
    expect(empty).not.toHaveProperty("assetRef");
    expect(empty).not.toHaveProperty("boundingBox");
  });

  it("marks table structure as provided from structured table metadata", async () => {
    const provider = createMetadataDocumentMultimodalEnrichmentProvider();

    await expect(
      provider.enrich(
        providerInput(
          multimodalItem({
            modality: "table",
            sourceMetadata: { table: { columns: ["metric"] } },
          }),
        ),
      ),
    ).resolves.toMatchObject({ tableStructureStatus: "provided" });
  });

  it("merges composite provider metadata across partial results", async () => {
    const merging = createCompositeDocumentMultimodalEnrichmentProvider({
      providers: [
        { enrich: async () => ({ metadata: { first: 1 }, title: "First title" }) },
        { enrich: async () => ({ caption: "Second caption" }) },
      ],
    });

    await expect(merging.enrich(providerInput(multimodalItem()))).resolves.toEqual({
      caption: "Second caption",
      metadata: { first: 1 },
      title: "First title",
    });

    const metadataless = createCompositeDocumentMultimodalEnrichmentProvider({
      providers: [{ enrich: async () => ({}) }, { enrich: async () => ({}) }],
    });
    const result = await metadataless.enrich(providerInput(multimodalItem()));
    expect(result.metadata).toBeUndefined();
  });
});
