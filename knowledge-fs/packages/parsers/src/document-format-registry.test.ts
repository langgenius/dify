import { describe, expect, it } from "vitest";
import {
  DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION,
  documentMimeTypesForFilename,
  resolveDocumentFormat,
} from "./document-format-registry";
import {
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createParserRouter,
  createUnstructuredParserClient,
} from "./index";

describe("shared document format registry", () => {
  it("only returns MIME aliases for actual registered filename extensions", () => {
    expect(documentMimeTypesForFilename("file.docx")).toEqual([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    for (const filename of [
      "file.constructor",
      "file.__proto__",
      "file.unknown",
      "file.",
      "README",
    ])
      expect(documentMimeTypesForFilename(filename)).toBeUndefined();
  });
  it("preserves the existing upload allowlist exactly", () => {
    expect(Object.keys(DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION).sort()).toEqual(
      "csv doc docx eml epub htm html json jsonl markdown md mdx msg odt pdf ppt pptx properties rtf text txt vtt xls xlsx xml".split(
        " ",
      ),
    );
  });
  it.each([
    [" Report.JSONL ", "application/json", "jsonl"],
    ["x.csv", "application/vnd.ms-excel", "csv"],
    ["x.unknown", "text/html; charset=utf-8", "html"],
    ["x.yaml", "text/plain", "yaml"],
    ["README", "text/plain", "markdown"],
    ["x.pdf", "text/plain", "unstructured"],
    ["x.xyz", "", null],
    ["x.constructor", "", null],
    ["x.__proto__", "", null],
  ])("resolves %s deterministically", (filename, mimeType, expected) => {
    expect(resolveDocumentFormat({ filename, mimeType })).toBe(expected);
  });
  it("never bypasses native resource limits by sending oversized markup remotely", async () => {
    let requests = 0;
    const parser = createParserRouter({
      html: createNativeHtmlParser(),
      markdown: createNativeMarkdownParser(),
      maxNativeInputBytes: 3,
      unstructured: createUnstructuredParserClient({
        endpoint: "https://parser.test",
        fetch: async () => {
          requests += 1;
          return Response.json([]);
        },
      }),
    });
    await expect(
      parser.parse({
        body: new TextEncoder().encode("too long"),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        filename: "x.md",
        mimeType: "text/markdown",
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "provider_input" });
    expect(requests).toBe(0);
  });
});
