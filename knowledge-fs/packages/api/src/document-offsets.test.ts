import type { ParseArtifact } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createArtifactSegments } from "./document-compilation-pipeline";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const createdAt = "2026-07-12T00:00:00.000Z";

describe("canonical document offsets", () => {
  it("materializes trimmed CJK and emoji segments as half-open UTF-8 byte ranges", async () => {
    const ids = ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c50", "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51"];
    const artifact: ParseArtifact = {
      artifactHash: "a".repeat(64),
      contentType: "text",
      createdAt,
      documentAssetId,
      elements: [
        {
          id: "heading",
          metadata: {},
          sectionPath: ["指南"],
          text: " \u3000标题🚀 \n",
          type: "heading",
        },
        {
          id: "empty",
          metadata: {},
          sectionPath: ["指南"],
          text: " \u3000\t",
          type: "paragraph",
        },
        {
          id: "body",
          metadata: {},
          sectionPath: ["指南"],
          text: "\t内容🙂  ",
          type: "paragraph",
        },
      ],
      id: parseArtifactId,
      metadata: { parserVersion: "native-markdown@1" },
      parser: "native-markdown",
      version: 1,
    };
    const segments = await createArtifactSegments({
      artifact,
      generateId: () => ids.shift() ?? "missing-id",
      knowledgeSpaceId,
      now: () => createdAt,
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      endOffset: 10,
      inlineText: "标题🚀",
      metadata: {
        elementSeparator: "\n",
        offsetEncoding: "utf-8-bytes",
        textNormalization: "unicode-whitespace-trim",
      },
      segmentIndex: 0,
      sizeBytes: 10,
      sourceLocation: { endOffset: 10, startOffset: 0 },
      startOffset: 0,
    });
    expect(segments[1]).toMatchObject({
      endOffset: 21,
      inlineText: "内容🙂",
      segmentIndex: 1,
      sizeBytes: 10,
      sourceLocation: { endOffset: 21, startOffset: 11 },
      startOffset: 11,
    });

    const canonicalText = segments.map((segment) => segment.inlineText).join("\n");
    expect(canonicalText).toBe("标题🚀\n内容🙂");
    expect(new TextEncoder().encode(canonicalText).byteLength).toBe(21);
  });
});
