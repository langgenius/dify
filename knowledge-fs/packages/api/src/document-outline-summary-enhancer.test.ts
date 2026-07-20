import type { ParseArtifact } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDocumentOutlineBuilder } from "./document-outline-builder";
import {
  type DocumentOutlineSummaryProvider,
  createDocumentOutlineSummaryEnhancer,
} from "./document-outline-summary-enhancer";

const createdAt = "2026-06-22T00:00:00.000Z";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("document outline summary enhancer", () => {
  it("replaces deterministic summaries with provider summaries and prompt metadata", async () => {
    const calls: Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][] = [];
    const provider: DocumentOutlineSummaryProvider = {
      summarize: async (input) => {
        calls.push(input);

        return {
          metadata: { requestId: `summary-${calls.length}` },
          summary: `provider:${input.sectionPath.join("/")}:${input.text.slice(0, 24)}`,
        };
      },
    };
    const artifact = parseArtifact();
    const outline = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      ]),
      maxElements: 10,
      maxNodes: 10,
      maxSummaryChars: 120,
      now: () => createdAt,
    }).build({ knowledgeSpaceId, parseArtifact: artifact });
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxInputChars: 80,
      maxSummaryChars: 60,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      provider,
    });

    const enhanced = await enhancer.enhance({
      outline,
      parseArtifact: artifact,
      traceId: "trace-outline-summary-1",
    });

    expect(calls.map((call) => call.sectionPath)).toEqual([["Guide", "Refunds"], ["Guide"]]);
    expect(calls[0]).toMatchObject({
      childSummaries: [],
      maxSummaryChars: 60,
      outlineNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      promptVersion: "document-outline-summary-v1",
      text: "Refunds\n\nRefund approvals require manager review.",
      traceId: "trace-outline-summary-1",
    });
    expect(calls[1]?.childSummaries[0]).toContain("provider:Guide/Refunds");
    expect(enhanced.metadata.summary).toEqual({
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      source: "provider",
    });
    expect(enhanced.nodes[0]?.summary).toContain("provider:Guide:Guide");
    expect(enhanced.nodes[0]?.metadata.summary).toMatchObject({
      metadata: { requestId: "summary-2" },
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      source: "provider",
    });
    expect(enhanced.nodes[0]?.children[0]?.summary).toContain("provider:Guide/Refunds");
  });

  it("validates summary provider bounds", () => {
    const provider: DocumentOutlineSummaryProvider = {
      summarize: async () => ({ summary: "unused" }),
    };

    expect(() =>
      createDocumentOutlineSummaryEnhancer({
        maxConcurrentSummaries: 0,
        maxInputChars: 10,
        maxSummaryChars: 10,
        model: "model",
        promptVersion: "prompt",
        provider,
      }),
    ).toThrow("Document outline summary maxConcurrentSummaries must be at least 1");
    expect(() =>
      createDocumentOutlineSummaryEnhancer({
        maxInputChars: 0,
        maxSummaryChars: 10,
        model: "model",
        promptVersion: "prompt",
        provider,
      }),
    ).toThrow("Document outline summary maxInputChars must be at least 1");
    expect(() =>
      createDocumentOutlineSummaryEnhancer({
        maxInputChars: 10,
        maxSummaryChars: 0,
        model: "model",
        promptVersion: "prompt",
        provider,
      }),
    ).toThrow("Document outline summary maxSummaryChars must be at least 1");
  });

  it("bounds provider concurrency across independent outline branches", async () => {
    let active = 0;
    let maxActive = 0;
    const artifact = parseArtifactWithSiblingSection();
    const outline = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      ]),
      maxElements: 10,
      maxNodes: 10,
      maxSummaryChars: 120,
      now: () => createdAt,
    }).build({ knowledgeSpaceId, parseArtifact: artifact });
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxConcurrentSummaries: 2,
      maxInputChars: 80,
      maxSummaryChars: 60,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      provider: {
        summarize: async (input) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { summary: `provider:${input.sectionPath.join("/")}` };
        },
      },
    });

    await enhancer.enhance({ outline, parseArtifact: artifact });

    expect(maxActive).toBe(2);
  });
});

function parseArtifact(): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt,
    documentAssetId,
    elements: [
      {
        id: "element-1",
        metadata: {},
        sectionPath: ["Guide"],
        text: "Guide",
        type: "heading",
      },
      {
        id: "element-2",
        metadata: {},
        sectionPath: ["Guide", "Refunds"],
        text: "Refunds",
        type: "heading",
      },
      {
        id: "element-3",
        metadata: {},
        sectionPath: ["Guide", "Refunds"],
        text: "Refund approvals require manager review.",
        type: "paragraph",
      },
    ],
    id: parseArtifactId,
    metadata: { parserVersion: "native-markdown@1" },
    parser: "native-markdown",
    version: 1,
  };
}

function parseArtifactWithSiblingSection(): ParseArtifact {
  const artifact = parseArtifact();
  return {
    ...artifact,
    elements: [
      ...artifact.elements,
      {
        id: "element-4",
        metadata: {},
        sectionPath: ["Shipping"],
        text: "Shipping",
        type: "heading",
      },
      {
        id: "element-5",
        metadata: {},
        sectionPath: ["Shipping"],
        text: "Shipping takes three days.",
        type: "paragraph",
      },
    ],
  };
}

function sequenceIds(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];

    if (!id) {
      throw new Error("No test id left");
    }

    index += 1;
    return id;
  };
}
