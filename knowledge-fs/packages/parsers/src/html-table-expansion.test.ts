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
    parserResourceLimits: {
      ...actual.parserResourceLimits,
      maxOutputBytes: 256,
      maxTableCells: 6,
      maxTableColumns: 4,
    },
  };
});

function parseTable(table: string) {
  return createNativeHtmlParser().parse({
    body: new TextEncoder().encode(table),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    filename: "table.html",
    mimeType: "text/html",
    version: 1,
  });
}

describe("HTML table pre-expansion resource budget", () => {
  it("shares the expansion budget across separate empty HTML tables", async () => {
    const table = '<table><tr><td colspan="4"></td></tr></table>';
    await expect(parseTable(table + table)).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("expanded HTML table cell count"),
    });
  });

  it("charges ragged-row padding against the document budget before dense projection", async () => {
    const table = "<table><tr><td>A</td></tr><tr><td>B</td><td>C</td></tr></table>";
    await expect(parseTable(table + table)).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("expanded HTML table cell count"),
    });
  });

  it.each(["md", "mdx"])(
    "shares the expansion budget across separate %s HTML tokens",
    async (extension) => {
      const table = '<table><tr><td colspan="4"></td></tr></table>';
      await expect(
        createNativeMarkdownParser().parse({
          body: new TextEncoder().encode(`${table}\n\nBetween\n\n${table}`),
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          filename: `table.${extension}`,
          mimeType: "text/markdown",
          version: 1,
        }),
      ).rejects.toMatchObject({
        code: "provider_input",
        message: expect.stringContaining("expanded HTML table cell count"),
      });
    },
  );

  it("shares the expansion budget across separate provider tables", async () => {
    const table = {
      type: "Table",
      metadata: { text_as_html: '<table><tr><td colspan="4"></td></tr></table>' },
    };
    const parser = createUnstructuredParserClient({
      endpoint: "http://parser.invalid",
      fetch: async () => new Response(JSON.stringify([table, table])),
    });
    await expect(
      parser.parse({
        body: new TextEncoder().encode("%PDF-1.4\n"),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        filename: "table.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
      cause: { message: expect.stringContaining("expanded HTML table cell count") },
    });
  });

  it("does not retain provider table budget between independent transports", async () => {
    const table = {
      type: "Table",
      metadata: {
        text_as_html: '<table><tr><td colspan="3" rowspan="2"></td></tr><tr></tr></table>',
      },
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify([table])));
    const parser = createUnstructuredParserClient({ endpoint: "http://parser.invalid", fetch });
    const input = {
      body: new TextEncoder().encode("%PDF-1.4\n"),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      filename: "table.pdf",
      mimeType: "application/pdf",
      version: 1,
    };
    await expect(parser.parse(input)).resolves.toMatchObject({ parser: "unstructured" });
    await expect(parser.parse(input)).resolves.toMatchObject({ parser: "unstructured" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["html", "md", "mdx"])(
    "does not share the expansion budget across independent %s parses",
    async (extension) => {
      const parser = extension === "html" ? createNativeHtmlParser() : createNativeMarkdownParser();
      const input = {
        body: new TextEncoder().encode(
          '<table><tr><td colspan="3" rowspan="2"></td></tr><tr></tr></table>',
        ),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        filename: `table.${extension}`,
        mimeType: extension === "html" ? "text/html" : "text/markdown",
        version: 1,
      };
      await expect(parser.parse(input)).resolves.toMatchObject({ elements: [] });
      await expect(parser.parse(input)).resolves.toMatchObject({ elements: [] });
    },
  );

  it("rejects an overwide empty colspan before filtered rows can hide its allocation", async () => {
    await expect(parseTable('<table><tr><td colspan="5"></td></tr></table>')).rejects.toMatchObject(
      {
        code: "provider_input",
        retryable: false,
        message: expect.stringContaining("HTML table column count"),
      },
    );
  });

  it("charges cumulative empty cell spans even when no row produces searchable text", async () => {
    const html = '<table><tr><td colspan="4"></td></tr><tr><td colspan="4"></td></tr></table>';
    await expect(parseTable(html)).rejects.toMatchObject({
      code: "provider_input",
      retryable: false,
      message: expect.stringContaining("expanded HTML table cell count"),
    });
  });

  it("charges carried rowspans against the same cumulative cell budget", async () => {
    const html = '<table><tr><td colspan="3" rowspan="3"></td></tr><tr></tr><tr></tr></table>';
    await expect(parseTable(html)).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("expanded HTML table cell count"),
    });
  });

  it("charges the logical width of sparse carried rows, not just their nonempty cell count", async () => {
    const html =
      '<table><tr><td colspan="3"></td><td rowspan="3"></td></tr><tr></tr><tr></tr></table>';
    await expect(parseTable(html)).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("expanded HTML table cell count"),
    });
  });

  it("bounds dense header traversal before flattening ragged rows", async () => {
    const html = '<table><tr><th colspan="2">A</th></tr><tr><th colspan="4">B</th></tr></table>';
    await expect(parseTable(html)).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("expanded HTML table cell count"),
    });
  });

  it("bounds dense headerless traversal before inferring column types", async () => {
    const html = '<table><tr><td colspan="2">A</td></tr><tr><td colspan="4">B</td></tr></table>';
    await expect(parseTable(html)).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("expanded HTML table cell count"),
    });
  });

  it("bounds repeated header label bytes before constructing joined columns", async () => {
    const html = `<table><tr><th colspan="4">${"x".repeat(65)}</th></tr></table>`;
    await expect(parseTable(html)).rejects.toMatchObject({
      code: "provider_input",
      message: expect.stringContaining("HTML table header bytes"),
    });
  });

  it("preserves empty tables exactly at the expansion boundary", async () => {
    const artifact = await parseTable(
      '<table><tr><td colspan="3" rowspan="2"></td></tr><tr></tr></table>',
    );
    expect(artifact.elements).toEqual([]);
  });

  it("preserves admitted multirow headers and rowspan carry semantics", async () => {
    const html =
      '<table><tr><th rowspan="2">Name</th><th>Q1</th></tr><tr><th>Q2</th></tr><tr><td>A</td><td>1</td></tr></table>';
    const artifact = await parseTable(html);
    expect(artifact.elements[0]?.text).toBe("Name: A | Q1 / Q2: 1");
    expect(artifact.elements[0]?.metadata.table).toMatchObject({
      columns: ["Name", "Q1 / Q2"],
      headerRowCount: 2,
      recordCount: 1,
      sourceRowCount: 3,
    });
  });

  it("preserves colspan carry before a later source cell without double charging", async () => {
    const html = '<table><tr><td rowspan="2" colspan="2">X</td></tr><tr><td>Y</td></tr></table>';
    const artifact = await parseTable(html);
    expect(artifact.elements[0]?.text).toBe(
      "column_1: X | column_2: X | column_3:\ncolumn_1: X | column_2: X | column_3: Y",
    );
  });
});
