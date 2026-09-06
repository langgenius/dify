import { XMLParser } from "fast-xml-parser";
import { describe, expect, it, vi } from "vitest";
import { createNativeStructuredDataParser } from "./index";
import { assertXmlStructureBudget, iterateDocumentLines } from "./structured-stream-admission";

const input = (body: string, extension: string) => ({
  body: new TextEncoder().encode(body),
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  filename: `x.${extension}`,
  mimeType: `application/${extension}`,
  version: 1,
});

describe("structured parser incremental admission", () => {
  it.each([
    ["", [""]],
    ["first", ["first"]],
    ["a\n", ["a", ""]],
    ["a\r\nb\n\nc\r", ["a\r", "b", "", "c\r"]],
  ])("iterates line slices without a document-wide line array %#", (source, expected) => {
    expect([...iterateDocumentLines(source)]).toEqual(expected);
  });
  it("stops JSONL admission before decoding a malformed tail after the row budget", async () => {
    await expect(
      createNativeStructuredDataParser({ maxRows: 1 }).parse(
        input("9007199254740993\r\n\n{", "jsonl"),
      ),
    ).rejects.toThrow("maxRows=1");
  });
  it("keeps CSV admission ahead of later invalid records", async () => {
    await expect(
      createNativeStructuredDataParser({ maxRows: 1 }).parse(
        input('key\none\ntwo\n"unclosed', "csv"),
      ),
    ).rejects.toThrow("maxRows=1");
  });
  it("rejects deep XML before constructing its object graph", async () => {
    const parse = vi.spyOn(XMLParser.prototype, "parse");
    try {
      await expect(
        createNativeStructuredDataParser().parse(
          input(`${"<item>".repeat(129)}x${"</item>".repeat(129)}`, "xml"),
        ),
      ).rejects.toMatchObject({ code: "provider_input" });
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
  it("charges repeated nodes, attributes and text against a preallocation budget", () => {
    expect(() =>
      assertXmlStructureBudget('<root a="1" b="2"><item>text</item></root>', { maxNodes: 4 }),
    ).toThrow("XML node count");
    expect(() =>
      assertXmlStructureBudget("<root><item/><item/><item/></root>", { maxNodes: 3 }),
    ).toThrow("XML node count");
    expect(() =>
      assertXmlStructureBudget("<root><item>value</item></root>", { maxDepth: 1 }),
    ).toThrow("XML nesting depth");
  });
  it("does not mistake comments, CDATA, namespace tags or escaped literals for structure", () => {
    const xml =
      '<?xml version="1.0"?><ns:root xmlns:ns="urn:example"><!-- <fake><deep> --><item><![CDATA[<literal>]]>&lt;text&gt;</item><empty/></ns:root>';
    expect(() => assertXmlStructureBudget(xml, { maxDepth: 2, maxNodes: 12 })).not.toThrow();
  });
  it("checks cancellation before scanning XML or yielding lines", () => {
    const signal = AbortSignal.abort(new Error("stop"));
    expect(() => assertXmlStructureBudget("<root/>", { signal })).toThrow("stop");
    expect(() => [...iterateDocumentLines("first\nsecond", signal)]).toThrow("stop");
  });
  it.each([{ maxNodes: 0 }, { maxNodes: Number.NaN }, { maxDepth: -1 }, { maxDepth: 1.2 }])(
    "rejects invalid XML budgets %#",
    (options) => {
      expect(() => assertXmlStructureBudget("<root/>", options)).toThrow(
        "invalid XML admission budget",
      );
    },
  );
  it("scans across chunk boundaries without materializing a tree", () => {
    const text = `<root><item>${"x".repeat(131_072)}</item><next/></root>`;
    expect(() => assertXmlStructureBudget(text, { maxDepth: 2, maxNodes: 12 })).not.toThrow();
  });
  it("does not charge indentation that the authoritative XML projection discards", () => {
    expect(() =>
      assertXmlStructureBudget("<root>\n  <item/>\n  <item/>\n  <item/>\n</root>", { maxNodes: 4 }),
    ).not.toThrow();
  });
});
