import { describe, expect, it } from "vitest";

import {
  multimodalEvidenceAnswerLines,
  multimodalEvidenceFromCitations,
} from "./multimodal-evidence";

describe("multimodal evidence", () => {
  it("extracts structured attachments from resolved query citations", () => {
    const attachments = multimodalEvidenceFromCitations({
      citations: [
        {
          multimodalCandidate: {
            assetDescriptorPath:
              "/knowledge/docs/Report.pdf--018f0d60/assets/image-chart--018f0d60.json",
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/documents/document/assets/chart.png",
            },
            assetRoute:
              "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/item/asset",
            boundingBox: { height: 120, width: 240, x: 10, y: 20 },
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
            manifestItemId: "manifest:0:image-1",
            modality: "image",
            pageNumber: 3,
            parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            parseElementId: "image-1",
            sectionPath: ["Metrics"],
          },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        },
      ],
      maxItems: 5,
    });

    expect(attachments).toEqual([
      expect.objectContaining({
        assetDescriptorPath:
          "/knowledge/docs/Report.pdf--018f0d60/assets/image-chart--018f0d60.json",
        assetRoute:
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/item/asset",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        manifestItemId: "manifest:0:image-1",
        modality: "image",
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        pageNumber: 3,
        sectionPath: ["Metrics"],
      }),
    ]);
    expect(multimodalEvidenceAnswerLines(attachments)).toEqual([
      "Multimodal evidence:",
      "1. image (page 3, Metrics): /knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/item/asset",
    ]);
  });

  it("bounds extracted attachments", () => {
    expect(() => multimodalEvidenceFromCitations({ citations: [], maxItems: -1 })).toThrow(
      "Multimodal evidence maxItems must be non-negative",
    );
    expect(
      multimodalEvidenceFromCitations({
        citations: [
          {
            multimodalCandidate: {
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
              modality: "image",
            },
          },
        ],
        maxItems: 0,
      }),
    ).toEqual([]);
  });
});
