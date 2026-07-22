import { describe, expect, it } from "vitest";

import { createDocumentHealthReport } from "./document-health";

describe("createDocumentHealthReport", () => {
  it("summarizes parse status, node count, quality risks, and publish readiness", () => {
    const report = createDocumentHealthReport({
      artifact: {
        elements: [
          { id: "title", metadata: {}, sectionPath: [], text: "Roadmap", type: "title" },
          {
            id: "body",
            metadata: {},
            sectionPath: ["Roadmap"],
            text: "Useful content",
            type: "paragraph",
          },
        ],
        parser: "native-markdown",
      },
      asset: {
        filename: "roadmap.md",
        parserStatus: "parsed",
        sizeBytes: 128,
      },
      nodeCount: 2,
    });

    expect(report).toEqual({
      documentName: "roadmap.md",
      elementCount: 2,
      nodeCount: 2,
      parser: "native-markdown",
      parserStatus: "parsed",
      publishReadiness: "ready",
      qualityRisks: [],
      sizeLabel: "128 B",
    });
  });

  it("flags failed or empty parse outputs without retaining unbounded risk lists", () => {
    const report = createDocumentHealthReport({
      artifact: { elements: [], parser: "unstructured" },
      asset: {
        filename: "broken.pdf",
        parserStatus: "failed",
        sizeBytes: 12_000_000,
      },
      maxRisks: 2,
      nodeCount: 0,
    });

    expect(report.publishReadiness).toBe("blocked");
    expect(report.qualityRisks).toEqual(["Parser failed", "No parse elements"]);
    expect(report.sizeLabel).toBe("11.4 MiB");
  });
});
