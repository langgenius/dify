import { describe, expect, it } from "vitest";

import {
  knowledgeNodeSourceMetadataWithProjection,
  projectParseElementMetadataForKnowledgeNode,
} from "./source-element-metadata";

describe("knowledge node source metadata projection", () => {
  it("keeps compact reference fields but omits amplified payloads from source fragments", () => {
    const metadata = knowledgeNodeSourceMetadataWithProjection(
      {
        assetRef: { objectKey: "assets/table.png" },
        boundingBox: { height: 20, width: 40, x: 1, y: 2 },
        caption: "Quarterly metrics",
        ocrText: "large OCR payload",
        table: { html: "<table>large table</table>" },
        textAsHtml: "<table>large table</table>",
        title: "Metrics",
      },
      { completeElement: false },
    );

    expect(metadata).toMatchObject({
      assetRef: { objectKey: "assets/table.png" },
      boundingBox: { height: 20, width: 40, x: 1, y: 2 },
      caption: "Quarterly metrics",
      sourceMetadataProjection: {
        completeElement: false,
        omitted: [
          { field: "ocrText", reason: "fragmented-source-element" },
          { field: "table", reason: "fragmented-source-element" },
          { field: "textAsHtml", reason: "fragmented-source-element" },
        ],
      },
      title: "Metrics",
    });
    expect(metadata).not.toHaveProperty("ocrText");
    expect(metadata).not.toHaveProperty("table");
    expect(metadata).not.toHaveProperty("textAsHtml");
  });

  it("retains complete element metadata within the byte budget and clones output values", () => {
    const source = {
      table: { rows: [{ metric: "ARR", value: 42 }] },
      textAsHtml: "<table><tr><td>ARR</td></tr></table>",
      title: "Metrics",
    };
    const projected = projectParseElementMetadataForKnowledgeNode(source, {
      completeElement: true,
    });

    expect(projected.omissions).toEqual([]);
    expect(projected.metadata).toEqual(source);
    expect(projected.metadata.table).not.toBe(source.table);
  });

  it("omits oversized complete-element fields deterministically", () => {
    const metadata = knowledgeNodeSourceMetadataWithProjection(
      {
        assetRef: { objectKey: "assets/chart.png" },
        table: { html: "x".repeat(1_000) },
        title: "Chart",
      },
      { completeElement: true, maxBytes: 128 },
    );

    expect(metadata).toMatchObject({
      assetRef: { objectKey: "assets/chart.png" },
      sourceMetadataProjection: {
        completeElement: true,
        maxBytes: 128,
        omitted: [{ field: "table", reason: "size-limit" }],
      },
      title: "Chart",
    });
    expect(metadata).not.toHaveProperty("table");
  });

  it("uses the smaller default budget for metadata repeated across fragments", () => {
    const metadata = knowledgeNodeSourceMetadataWithProjection(
      {
        assetRef: { objectKey: "assets/chart.png" },
        caption: "x".repeat(20_000),
        title: "Chart",
      },
      { completeElement: false },
    );

    expect(metadata).toMatchObject({
      assetRef: { objectKey: "assets/chart.png" },
      sourceMetadataProjection: {
        completeElement: false,
        maxBytes: 16 * 1024,
        omitted: [{ field: "caption", reason: "size-limit" }],
      },
      title: "Chart",
    });
  });

  it("rejects an invalid projection budget before serializing fields", () => {
    expect(() =>
      projectParseElementMetadataForKnowledgeNode(
        { table: { rows: 1 } },
        {
          completeElement: true,
          maxBytes: 0,
        },
      ),
    ).toThrow("maxBytes must be at least 1");
  });
});
