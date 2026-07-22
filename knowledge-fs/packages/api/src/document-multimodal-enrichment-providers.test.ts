import type { DocumentMultimodalItem, DocumentMultimodalManifest } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createCompositeDocumentMultimodalEnrichmentProvider,
  createMetadataDocumentMultimodalEnrichmentProvider,
  createUnderstandingDocumentMultimodalEnrichmentProvider,
} from "./document-multimodal-enrichment-providers";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("document multimodal enrichment providers", () => {
  it("normalizes parser metadata into enrichment provider results", async () => {
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "chart-1",
            metadata: {
              chartSummary: "ARR grew 18% quarter over quarter.",
              chartTitle: "ARR bridge",
              ocrText: "ARR +18%",
              visualEmbeddingStatus: "provided",
            },
            pageNumber: 2,
            sectionPath: ["Metrics"],
            type: "image",
          },
          {
            id: "table-1",
            metadata: {
              rows: [{ metric: "ARR", value: "$12M" }],
              tableSummary: "ARR table",
            },
            sectionPath: ["Metrics"],
            text: "metric | value\nARR | $12M",
            type: "table",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "unstructured",
        version: 1,
      },
      knowledgeSpaceId,
    });
    const provider = createMetadataDocumentMultimodalEnrichmentProvider();
    const chart = manifest.items.find((item) => item.parseElementId === "chart-1");
    const table = manifest.items.find((item) => item.parseElementId === "table-1");

    if (!chart || !table) {
      throw new Error("Expected multimodal manifest fixture items");
    }

    await expect(provider.enrich(providerInput(manifest, chart))).resolves.toMatchObject({
      metadata: {
        chartSummary: "ARR grew 18% quarter over quarter.",
        modality: "image",
        provider: "metadata",
      },
      ocrText: "ARR +18%",
      textPreview: "ARR +18%",
      title: "ARR bridge",
      visualEmbeddingStatus: "provided",
    });
    await expect(
      provider.enrich({
        ...providerInput(manifest, table),
        sourceText: "metric | value\nARR | $12M",
      }),
    ).resolves.toMatchObject({
      metadata: {
        modality: "table",
        provider: "metadata",
        tableSummary: "ARR table",
      },
      tableStructureStatus: "provided",
      textPreview: "metric | value\nARR | $12M",
    });
  });

  it("composes provider adapters with later providers filling richer fields", async () => {
    const calls: string[] = [];
    const provider = createCompositeDocumentMultimodalEnrichmentProvider({
      providers: [
        {
          enrich: async () => {
            calls.push("ocr");
            return { metadata: { ocrProvider: "static" }, ocrText: "OCR text" };
          },
        },
        {
          enrich: async () => {
            calls.push("caption");
            return {
              caption: "Caption text",
              metadata: { captionProvider: "static" },
              textPreview: "Caption text",
            };
          },
        },
      ],
    });

    const manifest = imageManifest();

    await expect(
      provider.enrich(providerInput(manifest, imageItem(manifest))),
    ).resolves.toMatchObject({
      caption: "Caption text",
      metadata: { captionProvider: "static", ocrProvider: "static" },
      ocrText: "OCR text",
      textPreview: "Caption text",
    });
    expect(calls).toEqual(["ocr", "caption"]);
    expect(() => createCompositeDocumentMultimodalEnrichmentProvider({ providers: [] })).toThrow(
      "Composite multimodal enrichment provider requires at least 1 provider",
    );
  });

  it("adapts chart and table understanding providers into manifest enrichment results", async () => {
    const calls: unknown[] = [];
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      maxSummaryChars: 40,
      provider: {
        kind: "static-understanding",
        understand: async (input) => {
          calls.push(input);

          return input.task === "table"
            ? {
                metadata: { requestId: "table-req" },
                summary: "ARR table shows $12M.",
                tableStructureStatus: "provided",
                title: "ARR table",
              }
            : {
                caption: "ARR bridge chart",
                metadata: { requestId: "chart-req" },
                ocrText: "ARR +18%",
                summary: "ARR grew 18% quarter over quarter with expansion leading the bridge.",
                title: "ARR bridge",
              };
        },
      },
    });
    const manifest = createDocumentMultimodalManifestBuilder().build({
      artifact: {
        artifactHash: "a".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "chart-1",
            metadata: { chartTitle: "ARR bridge" },
            pageNumber: 2,
            sectionPath: ["Metrics"],
            type: "image",
          },
          {
            id: "table-1",
            metadata: {},
            sectionPath: ["Metrics"],
            text: "metric | value\nARR | $12M",
            type: "table",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "unstructured",
        version: 1,
      },
      knowledgeSpaceId,
    });
    const chart = manifest.items.find((item) => item.parseElementId === "chart-1");
    const table = manifest.items.find((item) => item.parseElementId === "table-1");

    if (!chart || !table) {
      throw new Error("Expected multimodal manifest fixture items");
    }

    await expect(provider.enrich(providerInput(manifest, chart))).resolves.toMatchObject({
      caption: "ARR bridge chart",
      metadata: {
        model: "metadata",
        promptVersion: "metadata-v1",
        provider: "static-understanding",
        requestId: "chart-req",
        status: "provided",
        summary: "ARR grew 18% quarter over quarter wit...",
        task: "chart",
      },
      ocrText: "ARR +18%",
      textPreview: "ARR grew 18% quarter over quarter wit...",
      title: "ARR bridge",
    });
    await expect(
      provider.enrich({
        ...providerInput(manifest, table),
        sourceText: "metric | value\nARR | $12M",
      }),
    ).resolves.toMatchObject({
      metadata: {
        requestId: "table-req",
        status: "provided",
        summary: "ARR table shows $12M.",
        task: "table",
      },
      tableStructureStatus: "provided",
      textPreview: "ARR table shows $12M.",
      title: "ARR table",
    });
    expect(calls).toEqual([
      expect.objectContaining({ task: "chart" }),
      expect.objectContaining({ sourceText: "metric | value\nARR | $12M", task: "table" }),
    ]);
  });

  it("can recover failed understanding providers into enrichment metadata", async () => {
    const provider = createUnderstandingDocumentMultimodalEnrichmentProvider({
      provider: {
        kind: "failing-understanding",
        understand: async () => {
          throw new Error("vision model unavailable");
        },
      },
    });
    const manifest = imageManifest();

    await expect(
      provider.enrich(providerInput(manifest, imageItem(manifest))),
    ).resolves.toMatchObject({
      metadata: {
        error: "vision model unavailable",
        provider: "failing-understanding",
        status: "failed",
        task: "image",
      },
    });
  });
});

function providerInput(manifest: DocumentMultimodalManifest, item: DocumentMultimodalItem) {
  return {
    documentAssetId: manifest.documentAssetId,
    item,
    knowledgeSpaceId: manifest.knowledgeSpaceId,
    manifestId: manifest.id,
    manifestVersion: manifest.manifestVersion,
    model: "metadata",
    parseArtifactId: manifest.parseArtifactId,
    promptVersion: "metadata-v1",
  };
}

function imageItem(manifest: DocumentMultimodalManifest): DocumentMultimodalItem {
  const item = manifest.items[0];

  if (!item) {
    throw new Error("Expected image fixture item");
  }

  return item;
}

function imageManifest(): DocumentMultimodalManifest {
  return createDocumentMultimodalManifestBuilder().build({
    artifact: {
      artifactHash: "b".repeat(64),
      contentType: "mixed",
      createdAt: "2026-06-23T00:00:00.000Z",
      documentAssetId,
      elements: [{ id: "image-1", metadata: {}, sectionPath: [], type: "image" }],
      id: parseArtifactId,
      metadata: {},
      parser: "unstructured",
      version: 1,
    },
    knowledgeSpaceId,
  });
}
