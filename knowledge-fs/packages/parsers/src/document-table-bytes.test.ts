import { describe, expect, it, vi } from "vitest";

import {
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createUnstructuredParserClient,
} from "./index";

vi.mock("./parser-resource-budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parser-resource-budget")>();
  return {
    ...actual,
    parserResourceLimits: { ...actual.parserResourceLimits, maxOutputBytes: 64 },
  };
});

function input(body: string, extension = "html") {
  return {
    body: new TextEncoder().encode(body),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    filename: `tables.${extension}`,
    mimeType:
      extension === "html"
        ? "text/html"
        : extension === "pdf"
          ? "application/pdf"
          : "text/markdown",
    version: 1,
  };
}

const label = "中".repeat(12);
const htmlTable = `<table><tr><th>${label}</th></tr></table>`;
const markdownTable = `| ${label} |\n| --- |`;

describe("document-local table projection bytes", () => {
  it("charges header-only HTML tables against one byte budget", async () => {
    await expect(
      createNativeHtmlParser().parse(input(htmlTable + htmlTable)),
    ).rejects.toMatchObject({
      code: "provider_input",
      retryable: false,
      message: expect.stringContaining("table projection bytes"),
    });
  });

  it("charges headerless HTML data rows against one byte budget", async () => {
    const table = `<table><tr><td>${label}</td></tr></table>`;
    await expect(createNativeHtmlParser().parse(input(table + table))).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("table projection bytes"),
    });
  });

  it.each(["md", "mdx"])(
    "shares bytes across ordinary tables and HTML tokens in %s",
    async (extension) => {
      for (const body of [
        `${markdownTable}\n\nBetween\n\n${markdownTable}`,
        `${markdownTable}\n\n${htmlTable}`,
      ]) {
        await expect(
          createNativeMarkdownParser().parse(input(body, extension)),
        ).rejects.toMatchObject({
          code: "provider_input",
          message: expect.stringContaining("table projection bytes"),
        });
      }
    },
  );

  it("charges every provider table before joining subsequent table output", async () => {
    const table = { type: "Table", metadata: { text_as_html: htmlTable } };
    const parser = createUnstructuredParserClient({
      endpoint: "http://parser.invalid",
      fetch: async () => Response.json([table, table]),
    });
    await expect(parser.parse(input("%PDF-1.4", "pdf"))).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
      cause: { message: expect.stringContaining("table projection bytes") },
    });
  });

  it("admits the exact cumulative byte boundary without charging header labels twice", async () => {
    const table = `<table><tr><th>${"x".repeat(32)}</th></tr></table>`;
    const artifact = await createNativeHtmlParser().parse(input(table + table));
    expect(artifact.elements.map((element) => element.text)).toEqual([
      "x".repeat(32),
      "x".repeat(32),
    ]);
  });

  it.each(["html", "md", "mdx"])(
    "keeps independent %s parses byte-budget isolated",
    async (extension) => {
      const parser = extension === "html" ? createNativeHtmlParser() : createNativeMarkdownParser();
      const source = input(extension === "html" ? htmlTable : markdownTable, extension);
      expect((await parser.parse(source)).elements[0]?.text).toBe(label);
      expect((await parser.parse(source)).elements[0]?.text).toBe(label);
    },
  );

  it("keeps independent provider transports byte-budget isolated", async () => {
    const table = { type: "Table", metadata: { text_as_html: htmlTable } };
    const fetch = vi.fn(async () => Response.json([table]));
    const parser = createUnstructuredParserClient({ endpoint: "http://parser.invalid", fetch });
    const source = input("%PDF-1.4", "pdf");
    expect((await parser.parse(source)).elements[0]?.text).toBe(label);
    expect((await parser.parse(source)).elements[0]?.text).toBe(label);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
