import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  ProviderInputError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderResponseError,
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createNativeStructuredDataParser,
  createParserRouter,
  createUnstructuredParserClient,
} from "./index";

const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const createdAt = "2026-05-10T10:00:00.000Z";

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function utf8Length(text: string): number {
  return textBytes(text).byteLength;
}

function spreadsheetImageAnchorXml({
  column,
  kind = "twoCellAnchor",
  relationshipId,
  row,
}: {
  readonly column: number;
  readonly kind?: "oneCellAnchor" | "twoCellAnchor";
  readonly relationshipId: string;
  readonly row: number;
}): string {
  return [
    `<xdr:${kind}>`,
    `<xdr:from><xdr:col>${column}</xdr:col><xdr:row>${row}</xdr:row></xdr:from>`,
    `<xdr:pic><xdr:blipFill><a:blip r:embed="${relationshipId}"/></xdr:blipFill></xdr:pic>`,
    "<xdr:clientData/>",
    `</xdr:${kind}>`,
  ].join("");
}

function createParseInput({
  body,
  filename,
  mimeType,
}: {
  readonly body: string;
  readonly filename: string;
  readonly mimeType: string;
}) {
  return {
    body: textBytes(body),
    documentAssetId,
    filename,
    mimeType,
    version: 1,
  };
}

function unstructuredCoordinates({
  height,
  layoutHeight = 1_000,
  layoutWidth = 1_000,
  width,
  x,
  y,
}: {
  readonly height: number;
  readonly layoutHeight?: number;
  readonly layoutWidth?: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}) {
  return {
    layout_height: layoutHeight,
    layout_width: layoutWidth,
    points: [
      [x, y],
      [x, y + height],
      [x + width, y + height],
      [x + width, y],
    ],
    system: "PixelSpace",
  };
}

describe("parser adapters", () => {
  it("parses Markdown into stable structured parse artifacts", async () => {
    const parser = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      now: () => createdAt,
    });

    const artifact = await parser.parse(
      createParseInput({
        body: [
          "# Overview",
          "",
          "KnowledgeFS exposes evidence.",
          "",
          "- First item",
          "- Second item",
          "",
          "```ts",
          "const answer = 42;",
          "```",
          "",
          "```",
          "plain code block",
          "```",
          "",
          "| A | B |",
          "| - | - |",
          "| 1 | 2 |",
        ].join("\n"),
        filename: "architecture.md",
        mimeType: "text/markdown",
      }),
    );

    expect(artifact).toMatchObject({
      contentType: "mixed",
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      metadata: {
        filename: "architecture.md",
        mimeType: "text/markdown",
        parserVersion: "native-markdown@2",
      },
      parser: "native-markdown",
      version: 1,
    });
    expect(artifact.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.elements).toEqual([
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-1",
        metadata: { depth: 1 },
        sectionPath: ["Overview"],
        text: "Overview",
        type: "heading",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-2",
        metadata: {},
        sectionPath: ["Overview"],
        text: "KnowledgeFS exposes evidence.",
        type: "paragraph",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-3",
        metadata: {},
        sectionPath: ["Overview"],
        text: "First item\nSecond item",
        type: "list",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-4",
        metadata: { language: "ts" },
        sectionPath: ["Overview"],
        text: "const answer = 42;",
        type: "code",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-5",
        metadata: {},
        sectionPath: ["Overview"],
        text: "plain code block",
        type: "code",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-6",
        metadata: {
          table: {
            columns: ["A", "B"],
            headerRowCount: 1,
            mode: "single-record",
            recordCount: 1,
            semanticVersion: 1,
            sourceRowCount: 2,
          },
        },
        sectionPath: ["Overview"],
        text: "A: 1 | B: 2",
        type: "table",
      },
    ]);
  });

  it.each(["text/mdx", "text/plain"])(
    "preserves searchable text inside MDX JSX blocks declared as %s",
    async (mimeType) => {
      const parser = createNativeMarkdownParser({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c95",
        now: () => createdAt,
      });

      const artifact = await parser.parse(
        createParseInput({
          body: [
            "# Overview",
            "",
            '<Callout title="Important">',
            "MDX keeps this searchable.",
            "<strong>Nested detail</strong>",
            "<script>ignored()</script>",
            "</Callout>",
          ].join("\n"),
          filename: "guide.mdx",
          mimeType,
        }),
      );

      expect(artifact.elements.map((element) => element.text)).toEqual([
        "Overview",
        "MDX keeps this searchable.\nNested detail",
      ]);
      expect(artifact.metadata.parserVersion).toBe("native-mdx@2");
    },
  );

  it("keeps plain Markdown raw HTML behavior while using the table-aware parser version", async () => {
    const parser = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c96",
      now: () => createdAt,
    });

    const artifact = await parser.parse(
      createParseInput({
        body: ["<Callout>", "Plain Markdown keeps its existing behavior.", "</Callout>"].join("\n"),
        filename: "guide.md",
        mimeType: "text/markdown",
      }),
    );

    expect(artifact.elements).toEqual([]);
    expect(artifact.metadata.parserVersion).toBe("native-markdown@2");
  });

  it("preserves the schema of a Markdown table that has no data records", async () => {
    const parser = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca5",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: "| Name | Status |\n| --- | --- |",
        filename: "empty-table.md",
        mimeType: "text/markdown",
      }),
    );

    expect(artifact.elements).toEqual([
      expect.objectContaining({
        metadata: {
          table: {
            columns: ["Name", "Status"],
            headerRowCount: 1,
            mode: "unknown",
            recordCount: 0,
            semanticVersion: 1,
            sourceRowCount: 1,
          },
        },
        text: "Name | Status",
        type: "table",
      }),
    ]);
  });

  it("normalizes Markdown image references into image parse elements", async () => {
    const parser = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d45",
      now: () => createdAt,
    });

    const artifact = await parser.parse(
      createParseInput({
        body: [
          "# Architecture",
          "",
          '![Pipeline diagram](https://cdn.example.test/pipeline.png "System pipeline")',
        ].join("\n"),
        filename: "architecture.md",
        mimeType: "text/markdown",
      }),
    );

    expect(artifact.contentType).toBe("mixed");
    expect(artifact.elements).toEqual([
      expect.objectContaining({
        metadata: { depth: 1 },
        sectionPath: ["Architecture"],
        text: "Architecture",
        type: "heading",
      }),
      expect.objectContaining({
        metadata: {
          assetRef: {
            contentType: "image/png",
            uri: "https://cdn.example.test/pipeline.png",
          },
          caption: "Pipeline diagram",
          source: "markdown-image",
          title: "System pipeline",
        },
        sectionPath: ["Architecture"],
        text: "Pipeline diagram",
        type: "image",
      }),
    ]);
  });

  it("parses HTML body content without materializing the metadata title", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
      now: () => createdAt,
    });

    const artifact = await parser.parse(
      createParseInput({
        body: [
          "<html><head><title>Ignored Title</title><style>.x{}</style></head>",
          "<body><script>alert('x')</script><h1>Guide</h1>",
          "<p>Read the docs.</p><ul><li>Install</li><li>Run</li></ul>",
          "<pre><code>pnpm check</code></pre>",
          "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
          "</body></html>",
        ].join(""),
        filename: "guide.html",
        mimeType: "text/html",
      }),
    );

    expect(artifact.parser).toBe("native-html");
    expect(artifact.metadata.documentTitle).toBe("Ignored Title");
    expect(artifact.metadata.parserVersion).toBe("native-html@3");
    expect(artifact.elements.map((element) => element.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "code",
      "table",
    ]);
    expect(artifact.elements.map((element) => element.text)).toEqual([
      "Guide",
      "Read the docs.",
      "Install\nRun",
      "pnpm check",
      "A: 1 | B: 2",
    ]);
    expect(artifact.elements.at(-1)?.metadata).toEqual({
      table: {
        columns: ["A", "B"],
        headerRowCount: 1,
        mode: "single-record",
        recordCount: 1,
        semanticVersion: 1,
        sourceRowCount: 2,
      },
    });
    expect(artifact.elements.map((element) => element.sectionPath)).toEqual([
      ["Guide"],
      ["Guide"],
      ["Guide"],
      ["Guide"],
      ["Guide"],
    ]);
  });

  it("distinguishes record lists, matrices, and key-value tables without changing table kind", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca1",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: [
          "<table><tr><td>姓名</td><td>得分</td></tr><tr><td>Ada</td><td>10</td></tr><tr><td>Lin</td><td>9</td></tr></table>",
          "<table><tr><th>地区</th><th>Q1</th><th>Q2</th></tr><tr><td>华东</td><td>10</td><td>20</td></tr><tr><td>华南</td><td>12</td><td>18</td></tr></table>",
          "<table><tr><td>发票号码</td><td>26322001</td></tr><tr><td>开票日期</td><td>2026-08-26</td></tr><tr><td>价税合计</td><td>566.00</td></tr></table>",
        ].join(""),
        filename: "tables.html",
        mimeType: "text/html",
      }),
    );

    expect(artifact.elements).toEqual([
      expect.objectContaining({
        metadata: {
          table: expect.objectContaining({
            columns: ["姓名", "得分"],
            mode: "record-list",
            recordCount: 2,
            sourceRowCount: 3,
          }),
        },
        text: "姓名: Ada | 得分: 10\n姓名: Lin | 得分: 9",
        type: "table",
      }),
      expect.objectContaining({
        metadata: {
          table: expect.objectContaining({
            columns: ["地区", "Q1", "Q2"],
            mode: "matrix",
            recordCount: 2,
            sourceRowCount: 3,
          }),
        },
        text: "地区: 华东 | Q1: 10 | Q2: 20\n地区: 华南 | Q1: 12 | Q2: 18",
        type: "table",
      }),
      expect.objectContaining({
        metadata: {
          table: expect.objectContaining({
            columns: ["发票号码", "开票日期", "价税合计"],
            mode: "single-record",
            recordCount: 1,
            sourceRowCount: 3,
          }),
        },
        text: "发票号码: 26322001 | 开票日期: 2026-08-26 | 价税合计: 566.00",
        type: "table",
      }),
    ]);
  });

  it("handles empty, header-group, inferred, duplicate, and genuinely headerless tables", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca3",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: [
          "<table></table>",
          "<table><tr><td>orphan</td></tr></table>",
          "<table><thead><tr><td>Alpha</td><td>Beta</td></tr></thead><tbody><tr><td>Ada</td><td>ready</td></tr></tbody></table>",
          "<table><tr><td>Alpha</td><td>Beta</td></tr><tr><td>1</td><td>true</td></tr><tr><td>2</td><td>false</td></tr></table>",
          "<table><tr><td>Ada</td><td>red</td></tr><tr><td>Lin</td><td>blue</td></tr></table>",
          "<table><tr><th>Name</th><th>Name</th><th></th></tr><tr><td>Ada</td><td>Alias</td></tr></table>",
        ].join(""),
        filename: "edge-tables.html",
        mimeType: "text/html",
      }),
    );

    expect(artifact.elements.map((element) => element.text)).toEqual([
      "column_1: orphan",
      "Alpha: Ada | Beta: ready",
      "Alpha: 1 | Beta: true\nAlpha: 2 | Beta: false",
      "column_1: Ada | column_2: red\ncolumn_1: Lin | column_2: blue",
      "Name: Ada | Name_2: Alias | column_3:",
    ]);
    expect(
      artifact.elements.map(
        (element) =>
          (element.metadata.table as { mode?: string; sourceRowCount?: number } | undefined)?.mode,
      ),
    ).toEqual(["single-record", "single-record", "record-list", "record-list", "single-record"]);
    expect(
      (artifact.elements.at(-1)?.metadata.table as { columns?: string[] } | undefined)?.columns,
    ).toEqual(["Name", "Name_2", "column_3"]);
  });

  it("keeps ambiguous headerless rows instead of dropping the first record", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca4",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: [
          "<table><tr><td>Ada</td></tr><tr><td>Lin</td></tr></table>",
          "<table><tr><td>Status</td><td>open</td></tr><tr><td>Status</td><td>closed</td></tr></table>",
          "<table><tr><td></td><td>open</td></tr><tr><td>other</td><td>closed</td></tr></table>",
          "<table><tr><td>Alpha</td><td>Beta</td></tr><tr><td>2026-01-01</td><td>2026-02-01</td></tr><tr><td>2026-03-01</td><td>2026-04-01</td></tr></table>",
        ].join(""),
        filename: "ambiguous-tables.html",
        mimeType: "text/html",
      }),
    );

    expect(artifact.elements.map((element) => element.text)).toEqual([
      "column_1: Ada\ncolumn_1: Lin",
      "column_1: Status | column_2: open\ncolumn_1: Status | column_2: closed",
      "column_1: | column_2: open\ncolumn_1: other | column_2: closed",
      "Alpha: 2026-01-01 | Beta: 2026-02-01\nAlpha: 2026-03-01 | Beta: 2026-04-01",
    ]);
    expect(
      artifact.elements.map(
        (element) => (element.metadata.table as { mode?: string } | undefined)?.mode,
      ),
    ).toEqual(["record-list", "record-list", "record-list", "record-list"]);
  });

  it("flattens multi-row headers and HTML cell spans into a stable matrix schema", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca6",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: [
          "<table>",
          '<tr><th rowspan="2">地区</th><th colspan="2">收入</th></tr>',
          "<tr><th>Q1</th><th>Q2</th></tr>",
          "<tr><td>华东</td><td>10</td><td>20</td></tr>",
          "<tr><td>华南</td><td>12</td><td>18</td></tr>",
          "</table>",
        ].join(""),
        filename: "matrix.html",
        mimeType: "text/html",
      }),
    );

    expect(artifact.elements).toEqual([
      expect.objectContaining({
        metadata: {
          table: {
            columns: ["地区", "收入 / Q1", "收入 / Q2"],
            headerRowCount: 2,
            mode: "matrix",
            recordCount: 2,
            semanticVersion: 1,
            sourceRowCount: 4,
          },
        },
        text: "地区: 华东 | 收入 / Q1: 10 | 收入 / Q2: 20\n地区: 华南 | 收入 / Q1: 12 | 收入 / Q2: 18",
        type: "table",
      }),
    ]);
  });

  it("bounds invalid HTML row and column spans instead of expanding them", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca8",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: '<table><tr><th colspan="0" rowspan="999">Value</th></tr><tr><td>A</td></tr></table>',
        filename: "bounded-spans.html",
        mimeType: "text/html",
      }),
    );

    expect(artifact.elements[0]).toMatchObject({
      metadata: { table: { columns: ["Value"], recordCount: 1 } },
      text: "Value: A",
      type: "table",
    });
  });

  it("bounds an HTML metadata title without adding it to body elements", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      now: () => createdAt,
    });

    const artifact = await parser.parse(
      createParseInput({
        body: `<html><head><title>${"题".repeat(2_001)}</title></head><body><p>Body</p></body></html>`,
        filename: "bounded-title.html",
        mimeType: "text/html",
      }),
    );

    expect(Array.from(String(artifact.metadata.documentTitle))).toHaveLength(2_000);
    expect(artifact.elements.map((element) => element.text)).toEqual(["Body"]);
  });

  it("normalizes HTML image references into image parse elements", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d46",
      now: () => createdAt,
    });

    const artifact = await parser.parse(
      createParseInput({
        body: [
          "<html><body><h1>Architecture</h1>",
          '<figure><img src="/assets/pipeline.webp" alt="Pipeline alt">',
          "<figcaption>Pipeline caption</figcaption></figure>",
          "</body></html>",
        ].join(""),
        filename: "architecture.html",
        mimeType: "text/html",
      }),
    );

    expect(artifact.contentType).toBe("mixed");
    expect(artifact.elements).toEqual([
      expect.objectContaining({
        sectionPath: ["Architecture"],
        text: "Architecture",
        type: "heading",
      }),
      expect.objectContaining({
        metadata: {
          alt: "Pipeline alt",
          assetRef: {
            contentType: "image/webp",
            uri: "/assets/pipeline.webp",
          },
          caption: "Pipeline caption",
          source: "html-figure",
        },
        sectionPath: ["Architecture"],
        text: "Pipeline caption",
        type: "image",
      }),
    ]);
  });

  it("does not emit undefined section path entries when heading levels skip", async () => {
    const markdown = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
      now: () => createdAt,
    });
    const html = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
      now: () => createdAt,
    });

    const markdownArtifact = await markdown.parse(
      createParseInput({
        body: "# Top\n\n### Deep\n\nBody",
        filename: "skipped-heading.md",
        mimeType: "text/markdown",
      }),
    );
    const htmlArtifact = await html.parse(
      createParseInput({
        body: "<h1>Top</h1><h3>Deep</h3><p>Body</p>",
        filename: "skipped-heading.html",
        mimeType: "text/html",
      }),
    );

    expect(markdownArtifact.elements.map((element) => element.sectionPath)).toEqual([
      ["Top"],
      ["Top", "Deep"],
      ["Top", "Deep"],
    ]);
    expect(htmlArtifact.elements.map((element) => element.sectionPath)).toEqual([
      ["Top"],
      ["Top", "Deep"],
      ["Top", "Deep"],
    ]);
  });

  it("rejects native inputs and element counts beyond configured bounds", async () => {
    await expect(
      createNativeMarkdownParser({ maxInputBytes: 0 }).parse(
        createParseInput({
          body: "small",
          filename: "invalid-bound.md",
          mimeType: "text/markdown",
        }),
      ),
    ).rejects.toThrow("Parser maxInputBytes must be at least 1");
    await expect(
      createNativeMarkdownParser({ maxInputBytes: 0 }).parse(
        createParseInput({
          body: "small",
          filename: "invalid-bound.md",
          mimeType: "text/markdown",
        }),
      ),
    ).rejects.toBeInstanceOf(ProviderInputError);

    await expect(
      createNativeMarkdownParser({ maxInputBytes: 4 }).parse(
        createParseInput({
          body: "too large",
          filename: "large.md",
          mimeType: "text/markdown",
        }),
      ),
    ).rejects.toThrow("Parser input exceeds maxInputBytes=4");

    await expect(
      createNativeMarkdownParser({ maxElements: 1 }).parse(
        createParseInput({
          body: "# One\n\nParagraph one.\n\nParagraph two.",
          filename: "many.md",
          mimeType: "text/markdown",
        }),
      ),
    ).rejects.toThrow("Parser output exceeds maxElements=1");
  });

  it("skips empty native elements without breaking following content", async () => {
    await expect(
      createNativeMarkdownParser({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        now: () => createdAt,
      }).parse(
        createParseInput({
          body: "# \n\nVisible",
          filename: "empty-heading.md",
          mimeType: "text/markdown",
        }),
      ),
    ).resolves.toMatchObject({
      elements: [
        {
          sectionPath: [],
          text: "Visible",
          type: "paragraph",
        },
      ],
    });

    await expect(
      createNativeHtmlParser({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
        now: () => createdAt,
      }).parse(
        createParseInput({
          body: "<p>   </p><p>Visible</p>",
          filename: "empty.html",
          mimeType: "text/html",
        }),
      ),
    ).resolves.toMatchObject({
      elements: [
        {
          sectionPath: [],
          text: "Visible",
          type: "paragraph",
        },
      ],
    });
  });

  it("maps additional Unstructured element types", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            { text: "Section", type: "Heading" },
            { text: "A | B", type: "Table" },
            { text: "Item", type: "ListItem" },
            { text: "Diagram", type: "Image" },
            { text: "const x = 1;", type: "CodeSnippet" },
            { text: "", type: "NarrativeText" },
          ]),
          { status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "mixed.pdf",
      mimeType: "application/pdf",
      version: 1,
    });

    expect(artifact.contentType).toBe("mixed");
    expect(artifact.elements.map((element) => element.type)).toEqual([
      "heading",
      "table",
      "list",
      "image",
      "code",
    ]);
    expect(artifact.elements.map((element) => element.sectionPath)).toEqual([
      ["Section"],
      ["Section"],
      ["Section"],
      ["Section"],
      ["Section"],
    ]);
  });

  it("routes documents to the lightest parser that fits the mime type or filename", async () => {
    const selected: string[] = [];
    const markdown = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      now: () => createdAt,
    });
    const html = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
      now: () => createdAt,
    });
    const unstructured = {
      kind: "unstructured" as const,
      parse: async () => {
        selected.push("unstructured");
        return createNativeMarkdownParser({
          generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
          now: () => createdAt,
        }).parse(
          createParseInput({
            body: "Fallback",
            filename: "fallback.md",
            mimeType: "text/markdown",
          }),
        );
      },
    };
    const router = createParserRouter({
      html: {
        ...html,
        parse: async (input) => {
          selected.push("html");
          return html.parse(input);
        },
      },
      markdown: {
        ...markdown,
        parse: async (input) => {
          selected.push("markdown");
          return markdown.parse(input);
        },
      },
      unstructured,
    });

    await expect(
      router.parse(
        createParseInput({
          body: "# Router",
          filename: "README.md",
          mimeType: "application/octet-stream",
        }),
      ),
    ).resolves.toMatchObject({
      metadata: { routedParser: "native-markdown" },
      parser: "native-markdown",
    });
    await expect(
      router.parse(
        createParseInput({
          body: "<h1>Router</h1>",
          filename: "router.bin",
          mimeType: "application/xhtml+xml",
        }),
      ),
    ).resolves.toMatchObject({
      metadata: { routedParser: "native-html" },
      parser: "native-html",
    });
    await router.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId,
      filename: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      version: 1,
    });
    await router.parse({
      body: textBytes("%PDF-1.7"),
      documentAssetId,
      filename: "report.pdf",
      mimeType: "text/plain",
      version: 1,
    });

    expect(selected).toEqual(["markdown", "html", "unstructured", "unstructured"]);
  });

  it("routes by file size, OCR need, layout complexity, and language hints", async () => {
    const selected: string[] = [];
    const markdown = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
      now: () => createdAt,
    });
    const html = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c55",
      now: () => createdAt,
    });
    const unstructured = {
      kind: "unstructured" as const,
      parse: async () => {
        selected.push("unstructured");
        return createNativeMarkdownParser({
          generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c56",
          now: () => createdAt,
        }).parse(
          createParseInput({
            body: "Fallback",
            filename: "fallback.md",
            mimeType: "text/markdown",
          }),
        );
      },
    };
    const router = createParserRouter({
      html: {
        ...html,
        parse: async (input) => {
          selected.push("html");
          return html.parse(input);
        },
      },
      markdown: {
        ...markdown,
        parse: async (input) => {
          selected.push("markdown");
          return markdown.parse(input);
        },
      },
      maxNativeInputBytes: 8,
      nativeLanguages: ["en", "zh"],
      unstructured,
    });

    await router.parse({
      ...createParseInput({
        body: "# ok",
        filename: "small.md",
        mimeType: "text/markdown",
      }),
      parserHints: { language: "en", layoutComplexity: "simple" },
    });
    await router.parse({
      ...createParseInput({
        body: "# too large",
        filename: "large.md",
        mimeType: "text/markdown",
      }),
      parserHints: { language: "en", layoutComplexity: "simple" },
    });
    await router.parse({
      ...createParseInput({
        body: "# scan",
        filename: "scan.md",
        mimeType: "text/markdown",
      }),
      parserHints: { requiresOcr: true },
    });
    await router.parse({
      ...createParseInput({
        body: "<article><h1>Complex</h1></article>",
        filename: "layout.html",
        mimeType: "text/html",
      }),
      parserHints: { layoutComplexity: "complex", language: "en" },
    });
    await router.parse({
      ...createParseInput({
        body: "# Unsupported language",
        filename: "ja.md",
        mimeType: "text/markdown",
      }),
      parserHints: { language: "ja" },
    });

    expect(selected).toEqual([
      "markdown",
      "unstructured",
      "unstructured",
      "unstructured",
      "unstructured",
    ]);
  });

  it("parses native structured data formats into structured artifacts", async () => {
    const parser = createNativeStructuredDataParser({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c57",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c58",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c59",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c5a",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c5b",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No parser id available");
          }
          return id;
        };
      })(),
      now: () => createdAt,
    });

    await expect(
      parser.parse(
        createParseInput({
          body: "name,score\nAda,10\nLin,9",
          filename: "scores.csv",
          mimeType: "text/csv",
        }),
      ),
    ).resolves.toMatchObject({
      contentType: "structured",
      elements: [
        {
          metadata: {
            columns: ["name", "score"],
            format: "csv",
            rowCount: 2,
            table: {
              columns: ["name", "score"],
              headerRowCount: 1,
              mode: "record-list",
              recordCount: 2,
              semanticVersion: 1,
            },
          },
          text: "name: Ada | score: 10\nname: Lin | score: 9",
          type: "table",
        },
      ],
      metadata: {
        filename: "scores.csv",
        mimeType: "text/csv",
        parserVersion: "native-structured@2",
      },
      parser: "native-structured",
    });
    await expect(
      parser.parse(
        createParseInput({
          body: '{"name":"Ada","score":10}',
          filename: "record.json",
          mimeType: "application/json",
        }),
      ),
    ).resolves.toMatchObject({
      elements: [
        {
          metadata: { format: "json", rootType: "object" },
          text: '{\n  "name": "Ada",\n  "score": 10\n}',
          type: "code",
        },
      ],
    });
    await expect(
      parser.parse(
        createParseInput({
          body: '{"name":"Ada"}\n{"name":"Lin"}',
          filename: "records.jsonl",
          mimeType: "application/x-ndjson",
        }),
      ),
    ).resolves.toMatchObject({
      elements: [
        {
          metadata: {
            columns: ["name"],
            format: "jsonl",
            rowCount: 2,
            table: {
              columns: ["name"],
              headerRowCount: 0,
              mode: "record-list",
              recordCount: 2,
              semanticVersion: 1,
              sourceRowCount: 2,
            },
          },
          text: "name: Ada\nname: Lin",
          type: "table",
        },
      ],
    });
    await expect(
      parser.parse(
        createParseInput({
          body: "name: Ada\nscore: 10",
          filename: "record.yaml",
          mimeType: "application/yaml",
        }),
      ),
    ).resolves.toMatchObject({
      elements: [
        {
          metadata: { format: "yaml", rootType: "object" },
          text: '{\n  "name": "Ada",\n  "score": 10\n}',
          type: "code",
        },
      ],
    });
    await expect(
      parser.parse(
        createParseInput({
          body: "<record><name>Ada</name><score>10</score></record>",
          filename: "record.xml",
          mimeType: "application/xml",
        }),
      ),
    ).resolves.toMatchObject({
      elements: [
        {
          metadata: { format: "xml", rootType: "object" },
          text: '{\n  "record": {\n    "name": "Ada",\n    "score": 10\n  }\n}',
          type: "code",
        },
      ],
    });
  });

  it("uses the JSONL extension when the declared MIME type is application/json", async () => {
    const parser = createNativeStructuredDataParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c5d",
      now: () => createdAt,
    });

    await expect(
      parser.parse(
        createParseInput({
          body: '{"name":"Ada"}\n{"name":"Lin"}',
          filename: "records.jsonl",
          mimeType: "application/json",
        }),
      ),
    ).resolves.toMatchObject({
      elements: [
        {
          metadata: {
            columns: ["name"],
            format: "jsonl",
            rowCount: 2,
            table: {
              columns: ["name"],
              headerRowCount: 0,
              mode: "record-list",
              recordCount: 2,
              semanticVersion: 1,
              sourceRowCount: 2,
            },
          },
          text: "name: Ada\nname: Lin",
          type: "table",
        },
      ],
    });
  });

  it("routes structured data formats to the native structured parser", async () => {
    const selected: string[] = [];
    const structured = createNativeStructuredDataParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c5c",
      now: () => createdAt,
    });
    const router = createParserRouter({
      html: createNativeHtmlParser(),
      markdown: createNativeMarkdownParser(),
      structured: {
        ...structured,
        parse: async (input) => {
          selected.push("structured");
          return structured.parse(input);
        },
      },
      unstructured: createNativeMarkdownParser(),
    });

    await expect(
      router.parse(
        createParseInput({
          body: "a,b\n1,2",
          filename: "table.csv",
          mimeType: "application/octet-stream",
        }),
      ),
    ).resolves.toMatchObject({
      metadata: { routeReason: "structured-file-type", routedParser: "native-structured" },
      parser: "native-structured",
    });
    expect(selected).toEqual(["structured"]);

    const sizeBoundedRouter = createParserRouter({
      html: createNativeHtmlParser(),
      markdown: createNativeMarkdownParser(),
      maxNativeInputBytes: 4,
      structured: createNativeStructuredDataParser(),
      unstructured: {
        kind: "unstructured",
        parse: async (input) => ({
          artifactHash: "a".repeat(64),
          contentType: "text",
          createdAt,
          documentAssetId: input.documentAssetId,
          elements: [],
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c5d",
          metadata: {},
          parser: "unstructured",
          version: input.version,
        }),
      },
    });

    await expect(
      sizeBoundedRouter.parse(
        createParseInput({
          body: "name\nAda",
          filename: "large.csv",
          mimeType: "text/csv",
        }),
      ),
    ).resolves.toMatchObject({
      metadata: { routeReason: "native-size-limit", routedParser: "unstructured" },
      parser: "unstructured",
    });
  });

  it.each([
    ["captions.vtt", "text/vtt"],
    ["application.properties", "text/x-java-properties"],
  ])("routes lightweight text format %s to the native text parser", async (filename, mimeType) => {
    const router = createParserRouter({
      html: createNativeHtmlParser(),
      markdown: createNativeMarkdownParser(),
      structured: createNativeStructuredDataParser(),
      unstructured: {
        kind: "unstructured",
        parse: async () => {
          throw new Error("lightweight text should not require Unstructured");
        },
      },
    });

    await expect(
      router.parse(
        createParseInput({
          body: "first line\nsecond line",
          filename,
          mimeType,
        }),
      ),
    ).resolves.toMatchObject({
      metadata: { routeReason: "native-file-type", routedParser: "native-markdown" },
      parser: "native-markdown",
    });
  });

  it("rejects invalid or unbounded structured data inputs", async () => {
    await expect(
      createNativeStructuredDataParser({ maxRows: 1 }).parse(
        createParseInput({
          body: "name\nAda\nLin",
          filename: "too-many.csv",
          mimeType: "text/csv",
        }),
      ),
    ).rejects.toThrow("Structured parser row count exceeds maxRows=1");
    await expect(
      createNativeStructuredDataParser().parse(
        createParseInput({
          body: '{"name":',
          filename: "bad.json",
          mimeType: "application/json",
        }),
      ),
    ).rejects.toThrow("Structured parser returned an invalid response");
  });

  it("maps Unstructured API responses into parse artifacts", async () => {
    const requests: Request[] = [];
    const parser = createUnstructuredParserClient({
      apiKey: "test-key",
      endpoint: "https://unstructured.example.test",
      fetch: async (request) => {
        const parsedRequest = request instanceof Request ? request : new Request(request);
        requests.push(parsedRequest);
        expect(parsedRequest.url).toBe("https://unstructured.example.test/general/v0/general");
        expect(parsedRequest.headers.get("authorization")).toBe("Bearer test-key");
        expect(parsedRequest.body).toBeTruthy();
        const form = await parsedRequest.formData();
        expect(form.get("coordinates")).toBe("true");
        expect(form.get("strategy")).toBe("auto");
        expect(form.getAll("extract_image_block_types")).toEqual([]);
        expect(form.get("extract_image_block_to_payload")).toBeNull();
        expect(form.get("files")).toBeInstanceOf(File);

        return new Response(
          JSON.stringify([
            {
              metadata: { page_number: 1 },
              text: "Executive Summary",
              type: "Title",
            },
            {
              metadata: { page_number: 1 },
              text: "The system parses documents.",
              type: "NarrativeText",
            },
            {
              metadata: {
                coordinates: {
                  points: [
                    [10, 20],
                    [250, 20],
                    [250, 140],
                    [10, 140],
                  ],
                },
                image_mime_type: "image/png",
                image_base64: "iVBORw0KGgo=\n",
                page_number: 2,
              },
              type: "Image",
            },
            {
              metadata: {
                page_number: 3,
                text_as_html: "<table><tr><td>ARR</td></tr></table>",
              },
              text: "ARR",
              type: "Table",
            },
          ]),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      },
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId,
      filename: "report.pdf",
      mimeType: "application/pdf",
      version: 1,
    });

    expect(requests).toHaveLength(1);
    expect(artifact).toMatchObject({
      contentType: "mixed",
      createdAt,
      documentAssetId,
      metadata: {
        filename: "report.pdf",
        mimeType: "application/pdf",
        parserVersion: "unstructured@9",
      },
      parser: "unstructured",
      version: 1,
    });
    expect(artifact.elements).toEqual([
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50:element-1",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["Executive Summary"],
        text: "Executive Summary",
        type: "title",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50:element-2",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["Executive Summary"],
        text: "The system parses documents.",
        type: "paragraph",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50:element-3",
        metadata: {
          assetRef: {
            contentType: "image/png",
            uri: "data:image/png;base64,iVBORw0KGgo=",
          },
          boundingBox: { height: 120, width: 240, x: 10, y: 20 },
          coordinates: {
            points: [
              [10, 20],
              [250, 20],
              [250, 140],
              [10, 140],
            ],
          },
          image_mime_type: "image/png",
          unstructuredType: "Image",
        },
        pageNumber: 2,
        sectionPath: ["Executive Summary"],
        type: "image",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50:element-4",
        metadata: {
          table: {
            columns: ["column_1"],
            headerRowCount: 0,
            html: "<table><tr><td>ARR</td></tr></table>",
            mode: "single-record",
            recordCount: 1,
            semanticVersion: 1,
            sourceRowCount: 1,
          },
          textAsHtml: "<table><tr><td>ARR</td></tr></table>",
          unstructuredType: "Table",
        },
        pageNumber: 3,
        sectionPath: ["Executive Summary"],
        text: "column_1: ARR",
        type: "table",
      },
    ]);
  });

  it("projects an Unstructured spreadsheet table into independently retrievable records", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              metadata: {
                page_name: "问题收集",
                text_as_html:
                  "<table><tr><td>时间</td><td>问题描述</td><td>报错详情（截图等）</td><td>问题严重等级</td><td>是否解决</td><td>解决时间</td><td>解决办法</td></tr><tr><td>2026-07-01</td><td>复制按钮无法点击</td><td>Web 地址</td><td>P3</td><td>是</td><td>2026-07-02</td><td>升级版本</td></tr><tr><td>2026-07-08</td><td>服务器日期不对</td><td></td><td>P3</td><td>是</td><td>2026-07-09</td><td>调整时区</td></tr></table>",
              },
              text: "flattened provider text is not used",
              type: "Table",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca2",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId,
      filename: "issues.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      version: 1,
    });

    expect(artifact.elements).toHaveLength(1);
    expect(artifact.elements[0]).toMatchObject({
      metadata: {
        page_name: "问题收集",
        table: {
          columns: [
            "时间",
            "问题描述",
            "报错详情（截图等）",
            "问题严重等级",
            "是否解决",
            "解决时间",
            "解决办法",
          ],
          headerRowCount: 1,
          mode: "record-list",
          recordCount: 2,
          semanticVersion: 1,
          sourceRowCount: 3,
        },
      },
      text: expect.stringContaining("时间: 2026-07-01 | 问题描述: 复制按钮无法点击"),
      type: "table",
    });
    expect(artifact.elements[0]?.text?.split("\n")).toHaveLength(2);
  });

  it("keeps worksheets as separate table elements with their own record schemas", async () => {
    const table = (sheet: string, value: string) => ({
      metadata: {
        page_name: sheet,
        text_as_html: `<table><tr><th>sheet</th><th>value</th></tr><tr><td>${sheet}</td><td>${value}</td></tr></table>`,
      },
      text: `${sheet} ${value}`,
      type: "Table",
    });
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(JSON.stringify([table("问题收集", "7"), table("归档", "12")]), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca7",
      now: () => createdAt,
    });
    const artifact = await parser.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId,
      filename: "multi-sheet.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      version: 1,
    });

    expect(artifact.elements.map((element) => element.metadata.page_name)).toEqual([
      "问题收集",
      "归档",
    ]);
    expect(artifact.elements.map((element) => element.text)).toEqual([
      "sheet: 问题收集 | value: 7",
      "sheet: 归档 | value: 12",
    ]);
    expect(
      artifact.elements.every(
        (element) =>
          (element.metadata.table as { recordCount?: number } | undefined)?.recordCount === 1,
      ),
    ).toBe(true);
  });

  it.each(["application/pdf", " Application/PDF; charset=binary "])(
    "requests PDF image and table payloads for MIME %s without an external handler",
    async (mimeType) => {
      const parser = createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async (request) => {
          const form = await (request instanceof Request
            ? request
            : new Request(request)
          ).formData();

          expect(form.get("strategy")).toBe("hi_res");
          expect(form.getAll("extract_image_block_types")).toEqual(["Image", "Table"]);
          expect(form.get("extract_image_block_to_payload")).toBe("true");

          return new Response("[]", { status: 200 });
        },
      });

      await expect(
        parser.parse({
          body: new Uint8Array([1, 2, 3]),
          documentAssetId,
          filename: "report.pdf",
          mimeType,
          parserHints: { requiresImages: true },
          version: 1,
        }),
      ).resolves.toMatchObject({
        metadata: { parserVersion: "unstructured@9" },
        parser: "unstructured",
      });
    },
  );

  it("keeps hi_res PDF coordinates but suppresses payloads for an explicit external handler", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (request) => {
        const form = await (request instanceof Request ? request : new Request(request)).formData();

        expect(form.get("strategy")).toBe("hi_res");
        expect(form.getAll("extract_image_block_types")).toEqual([]);
        expect(form.get("extract_image_block_to_payload")).toBeNull();

        return new Response("[]", { status: 200 });
      },
    });

    await parser.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId,
      filename: "report.pdf",
      mimeType: "application/pdf",
      parserHints: { imagesHandledExternally: true, requiresImages: true },
      version: 1,
    });
  });

  it("does not request image payloads when the caller does not require images", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (request) => {
        const form = await (request instanceof Request ? request : new Request(request)).formData();

        expect(form.get("strategy")).toBe("auto");
        expect(form.getAll("extract_image_block_types")).toEqual([]);
        expect(form.get("extract_image_block_to_payload")).toBeNull();

        return new Response("[]", { status: 200 });
      },
    });

    await parser.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId,
      filename: "report.pdf",
      mimeType: "application/pdf",
      version: 1,
    });
  });

  it.each([
    [{ layoutComplexity: "simple" as const }, "fast", false],
    [{ requiresOcr: true }, "hi_res", false],
    [{ requiresTables: true }, "hi_res", false],
    [{ requiresImages: true }, "hi_res", true],
    [{ imagesHandledExternally: true, requiresImages: true }, "hi_res", true],
  ])(
    "selects %s parsing hints without forcing hi_res for every document",
    async (parserHints, expectedStrategy, expectedImages) => {
      const parser = createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async (request) => {
          const form = await (request instanceof Request
            ? request
            : new Request(request)
          ).formData();
          expect(form.get("strategy")).toBe(expectedStrategy);
          expect(form.getAll("extract_image_block_types")).toEqual(expectedImages ? ["Image"] : []);
          return new Response("[]", { status: 200 });
        },
      });

      await parser.parse({
        body: new Uint8Array([1, 2, 3]),
        documentAssetId,
        filename: "message.eml",
        mimeType: "message/rfc822",
        parserHints,
        version: 1,
      });
    },
  );

  it("includes Unstructured request strategy and parser hints in artifact hashes", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => new Response("[]", { status: 200 }),
    });
    const parseWithHints = (parserHints: {
      readonly imagesHandledExternally?: boolean;
      readonly layoutComplexity?: "complex" | "simple";
      readonly requiresImages?: boolean;
      readonly requiresOcr?: boolean;
      readonly requiresTables?: boolean;
    }) =>
      parser.parse({
        body: new Uint8Array([1, 2, 3]),
        documentAssetId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        parserHints,
        version: 1,
      });

    const [fast, ocr, tables, providerImages, externalImages] = await Promise.all([
      parseWithHints({ layoutComplexity: "simple" }),
      parseWithHints({ requiresOcr: true }),
      parseWithHints({ requiresTables: true }),
      parseWithHints({ requiresImages: true }),
      parseWithHints({ imagesHandledExternally: true, requiresImages: true }),
    ]);

    expect(
      new Set([
        fast.artifactHash,
        ocr.artifactHash,
        tables.artifactHash,
        providerImages.artifactHash,
        externalImages.artifactHash,
      ]).size,
    ).toBe(5);
  });

  it.each([
    [
      "handbook.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "word/media/image1.png",
    ],
    [
      "briefing.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "ppt/media/image1.png",
    ],
    [
      "forecast.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "xl/media/image1.png",
    ],
    ["manual.odt", "application/vnd.oasis.opendocument.text", "Pictures/image1.png"],
    ["book.epub", "application/epub+zip", "OEBPS/images/image1.png"],
    ["diagram.vsdx", "application/vnd.ms-visio.drawing", "visio/media/image1.png"],
  ])(
    "extracts embedded archive media when the provider omits images for %s",
    async (filename, mimeType, archivePath) => {
      const body = zipSync(
        {
          "../outside.png": new Uint8Array([9, 9, 9]),
          "metadata/readme.txt": textBytes("not an image"),
          [archivePath]: new Uint8Array([1, 2, 3, 4]),
        },
        { level: 0 },
      );
      const parser = createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async (request) => {
          const form = await (request instanceof Request
            ? request
            : new Request(request)
          ).formData();

          expect(form.get("strategy")).toBe("auto");
          expect(form.getAll("extract_image_block_types")).toEqual([]);
          expect(form.get("extract_image_block_to_payload")).toBeNull();

          return new Response(
            JSON.stringify([
              {
                metadata: { page_number: 1 },
                text: "Provider text",
                type: "NarrativeText",
              },
            ]),
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        },
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        now: () => createdAt,
      });

      const artifact = await parser.parse({
        body,
        documentAssetId,
        filename,
        mimeType,
        parserHints: { requiresImages: true },
        version: 1,
      });

      expect(artifact.elements).toHaveLength(2);
      expect(artifact.elements[1]).toMatchObject({
        metadata: {
          archivePath,
          assetRef: {
            contentType: "image/png",
            uri: "data:image/png;base64,AQIDBA==",
          },
          positionUnknown: true,
          source: "archive-media-fallback",
          title: "image1.png",
        },
        sectionPath: [],
        type: "image",
      });
      expect(artifact.elements).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({ archivePath: "../outside.png" }),
          }),
        ]),
      );
    },
  );

  it("keeps DOCX archive images attached to their Word paragraphs", async () => {
    const body = zipSync(
      {
        "word/_rels/document.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdImage1" Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdImage2" Target="media/image2.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdExternal" Target="https://example.com/external.png" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdWrong" Target="media/orphan.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"/>',
            "</Relationships>",
          ].join(""),
        ),
        "word/document.xml": textBytes(
          [
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>',
            "<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>流程图</w:t></w:r></w:p>",
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdImage1"/></w:drawing></w:r></w:p>',
            "<w:p><w:r><w:t>Beta</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>流程图</w:t></w:r></w:p>",
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdImage2"/></w:drawing></w:r></w:p>',
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdImage2"/></w:drawing></w:r></w:p>',
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdExternal"/></w:drawing></w:r></w:p>',
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdWrong"/></w:drawing></w:r></w:p>',
            "</w:body></w:document>",
          ].join(""),
        ),
        "word/media/image1.png": new Uint8Array([1, 2, 3, 4]),
        "word/media/image2.png": new Uint8Array([5, 6, 7, 8]),
        "word/media/orphan.png": new Uint8Array([9, 10, 11, 12]),
      },
      { level: 0 },
    );
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            { element_id: "alpha", text: "Alpha", type: "Title" },
            { text: "流程图", type: "NarrativeText" },
            { element_id: "beta", text: "Beta", type: "Title" },
            { text: "流程图", type: "NarrativeText" },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c64",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body,
      documentAssetId,
      filename: "flows.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      parserHints: { requiresImages: true },
      version: 1,
    });
    const images = artifact.elements.filter((element) => element.type === "image");

    expect(images).toHaveLength(4);
    expect(images).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          archivePath: "word/media/image1.png",
          endOffset: utf8Length("Alpha\n流程图"),
          startOffset: utf8Length("Alpha\n"),
          wordAnchor: { paragraphIndex: 3 },
        }),
        sectionPath: ["Alpha"],
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          archivePath: "word/media/image2.png",
          endOffset: utf8Length("Alpha\n流程图\nBeta\n流程图"),
          startOffset: utf8Length("Alpha\n流程图\nBeta\n"),
          wordAnchor: { paragraphIndex: 6 },
        }),
        sectionPath: ["Beta"],
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          archivePath: "word/media/image2.png",
          wordAnchor: { paragraphIndex: 7 },
        }),
        sectionPath: ["Beta"],
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          archivePath: "word/media/orphan.png",
          positionUnknown: true,
        }),
        sectionPath: [],
      }),
    ]);
  });

  it.each([
    {
      expectedArchivePath: "word/media/fallback.png",
      fallback: true,
      requires: "w14",
      scenario: "falls back from an unsupported namespace",
    },
    {
      expectedArchivePath: "word/media/choice.png",
      fallback: true,
      requires: "a",
      scenario: "selects a supported namespace",
    },
    {
      expectedArchivePath: "word/media/fallback.png",
      fallback: true,
      requires: "a w14",
      scenario: "requires every namespace in a Choice",
    },
    {
      expectedArchivePath: "word/media/fallback.png",
      fallback: true,
      requires: undefined,
      scenario: "falls back when Choice omits Requires",
    },
    {
      expectedArchivePath: undefined,
      fallback: false,
      requires: "w14",
      scenario: "suppresses an unsupported Choice without a Fallback",
    },
  ])("$scenario in DOCX AlternateContent", async ({ expectedArchivePath, fallback, requires }) => {
    const body = zipSync(
      {
        "word/_rels/document.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdChoice" Target="media/choice.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdFallback" Target="media/fallback.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            "</Relationships>",
          ].join(""),
        ),
        "word/document.xml": textBytes(
          [
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>',
            "<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>流程图</w:t></w:r></w:p>",
            `<w:p><w:r><mc:AlternateContent><mc:Choice${requires ? ` Requires="${requires}"` : ""}><w:drawing><a:blip r:embed="rIdChoice"/></w:drawing></mc:Choice>${fallback ? '<mc:Fallback><w:pict><v:imagedata r:id="rIdFallback"/></w:pict></mc:Fallback>' : ""}</mc:AlternateContent></w:r></w:p>`,
            "</w:body></w:document>",
          ].join(""),
        ),
        "word/media/choice.png": new Uint8Array([1, 2, 3, 4]),
        ...(fallback ? { "word/media/fallback.png": new Uint8Array([5, 6, 7, 8]) } : {}),
      },
      { level: 0 },
    );
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            { element_id: "alpha", text: "Alpha", type: "Title" },
            { text: "流程图", type: "NarrativeText" },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c66",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body,
      documentAssetId,
      filename: "alternate-content.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      parserHints: { requiresImages: true },
      version: 1,
    });
    const images = artifact.elements.filter((element) => element.type === "image");

    expect(images).toHaveLength(expectedArchivePath ? 1 : 0);
    if (!expectedArchivePath) return;
    expect(images[0]).toMatchObject({
      metadata: {
        archivePath: expectedArchivePath,
        endOffset: utf8Length("Alpha\n流程图"),
        startOffset: utf8Length("Alpha\n"),
        wordAnchor: { paragraphIndex: 3 },
      },
      sectionPath: ["Alpha"],
    });
  });

  it("keeps repeated DOCX paragraph images unpositioned when the provider omits an occurrence", async () => {
    const body = zipSync(
      {
        "word/_rels/document.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdImage1" Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdImage2" Target="media/image2.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            "</Relationships>",
          ].join(""),
        ),
        "word/document.xml": textBytes(
          [
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>',
            "<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>流程图</w:t></w:r></w:p>",
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdImage1"/></w:drawing></w:r></w:p>',
            "<w:p><w:r><w:t>Beta</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>流程图</w:t></w:r></w:p>",
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdImage2"/></w:drawing></w:r></w:p>',
            "</w:body></w:document>",
          ].join(""),
        ),
        "word/media/image1.png": new Uint8Array([1, 2, 3, 4]),
        "word/media/image2.png": new Uint8Array([5, 6, 7, 8]),
      },
      { level: 0 },
    );
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            { element_id: "alpha", text: "Alpha", type: "Title" },
            { element_id: "beta", text: "Beta", type: "Title" },
            { text: "流程图", type: "NarrativeText" },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c65",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body,
      documentAssetId,
      filename: "ambiguous-flows.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      parserHints: { requiresImages: true },
      version: 1,
    });
    const images = artifact.elements.filter((element) => element.type === "image");

    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.metadata).toMatchObject({ positionUnknown: true });
      expect(image.metadata).not.toHaveProperty("startOffset");
      expect(image.metadata).not.toHaveProperty("endOffset");
    }
  });

  it("keeps spreadsheet images attached to their original worksheet records", async () => {
    const body = zipSync(
      {
        "xl/_rels/workbook.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            "</Relationships>",
          ].join(""),
        ),
        "xl/drawings/_rels/drawing1.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdImage1" Target="../media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdImage2" Target="../media/image2.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdImage3" Target="../media/image3.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            "</Relationships>",
          ].join(""),
        ),
        "xl/drawings/drawing1.xml": textBytes(
          [
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            spreadsheetImageAnchorXml({ column: 2, relationshipId: "rIdImage1", row: 1 }),
            spreadsheetImageAnchorXml({ column: 2, relationshipId: "rIdImage2", row: 3 }),
            spreadsheetImageAnchorXml({ column: 7, relationshipId: "rIdImage3", row: 3 }),
            "</xdr:wsDr>",
          ].join(""),
        ),
        "xl/media/image1.png": new Uint8Array([1, 2, 3, 4]),
        "xl/media/image2.png": new Uint8Array([5, 6, 7, 8]),
        "xl/media/image3.png": new Uint8Array([9, 10, 11, 12]),
        "xl/media/unplaced.png": new Uint8Array([13, 14, 15, 16]),
        "xl/workbook.xml": textBytes(
          [
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            '<sheets><sheet name="Issues" sheetId="1" r:id="rId1"/></sheets>',
            "</workbook>",
          ].join(""),
        ),
        "xl/worksheets/_rels/sheet1.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdDrawing" Target="../drawings/drawing1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"/>',
            "</Relationships>",
          ].join(""),
        ),
        "xl/worksheets/sheet1.xml": textBytes(
          [
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            [
              '<sheetData><row r="1"><c r="A1"><v>header</v></c></row>',
              '<row r="2"><c r="A2"><v>first</v></c></row>',
              '<row r="4"><c r="A4"><v>second</v></c></row>',
              '<row r="5"><c r="A5"><v>third</v></c></row></sheetData>',
              '<drawing r:id="rIdDrawing"/>',
            ].join(""),
            "</worksheet>",
          ].join(""),
        ),
      },
      { level: 0 },
    );
    const tableText = [
      "Date: 2026-08-01 | Issue: First issue",
      "Date: 2026-08-02 | Issue: Second issue",
      "Date: 2026-08-03 | Issue: Third issue",
    ].join("\n");
    const secondRecordStart = utf8Length(`${tableText.split("\n")[0]}\n`);
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              metadata: {
                page_name: "Issues",
                text_as_html: [
                  "<table><thead><tr><th>Date</th><th>Issue</th></tr></thead><tbody>",
                  "<tr><td>2026-08-01</td><td>First issue</td></tr>",
                  "<tr><td>2026-08-02</td><td>Second issue</td></tr>",
                  "<tr><td>2026-08-03</td><td>Third issue</td></tr>",
                  "</tbody></table>",
                ].join(""),
              },
              type: "Table",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body,
      documentAssetId,
      filename: "issues.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parserHints: { requiresImages: true, requiresTables: true },
      version: 1,
    });
    const images = artifact.elements.filter((element) => element.type === "image");

    expect(artifact.elements[0]?.text).toBe(tableText);
    expect(images).toHaveLength(4);
    expect(images.slice(0, 3)).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          archivePath: "xl/media/image1.png",
          endOffset: utf8Length(tableText.split("\n")[0] as string),
          spreadsheetAnchor: {
            sourceColumn: 3,
            sourceRow: 2,
            sheetIndex: 0,
            sheetName: "Issues",
          },
          startOffset: 0,
        }),
        sectionPath: [],
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          archivePath: "xl/media/image2.png",
          endOffset: secondRecordStart + utf8Length(tableText.split("\n")[1] as string),
          spreadsheetAnchor: {
            sourceColumn: 3,
            sourceRow: 4,
            sheetIndex: 0,
            sheetName: "Issues",
          },
          startOffset: secondRecordStart,
        }),
        sectionPath: [],
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          archivePath: "xl/media/image3.png",
          spreadsheetAnchor: expect.objectContaining({ sourceColumn: 8, sourceRow: 4 }),
          startOffset: secondRecordStart,
        }),
      }),
    ]);
    expect(images[3]).toMatchObject({
      metadata: {
        archivePath: "xl/media/unplaced.png",
        positionUnknown: true,
      },
      sectionPath: [],
    });
  });

  it("matches worksheet anchors without trusting malformed or external OOXML relationships", async () => {
    const body = zipSync(
      {
        "xl/_rels/workbook.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdIssues" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="rIdNotes" Target="/xl/worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="rIdWrong" Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Target="worksheets/missing-id.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="missing-target" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="external" Target="https://example.com/sheet.xml" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="query" Target="worksheets/sheet.xml?version=1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="dot" Target="./worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="escape" Target="../../../outside.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
            '<Relationship Id="no-type" Target="worksheets/sheet2.xml"/>',
            "</Relationships>",
          ].join(""),
        ),
        "xl/drawings/_rels/drawing1.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdImage" Target="..\\media\\image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdBlank" Target="../media/blank.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            '<Relationship Id="rIdWrong" Target="../media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"/>',
            '<Relationship Id="rIdText" Target="../media/not-an-image.txt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            "</Relationships>",
          ].join(""),
        ),
        "xl/drawings/drawing1.xml": textBytes(
          [
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            spreadsheetImageAnchorXml({
              column: 2,
              kind: "oneCellAnchor",
              relationshipId: "rIdImage",
              row: 1,
            }),
            spreadsheetImageAnchorXml({ column: 3, relationshipId: "rIdBlank", row: 2 }),
            spreadsheetImageAnchorXml({
              column: 2,
              kind: "oneCellAnchor",
              relationshipId: "rIdImage",
              row: 1,
            }),
            spreadsheetImageAnchorXml({ column: -1, relationshipId: "rIdImage", row: 1 }),
            spreadsheetImageAnchorXml({ column: 2, relationshipId: "missing", row: 1 }),
            spreadsheetImageAnchorXml({ column: 2, relationshipId: "rIdWrong", row: 1 }),
            spreadsheetImageAnchorXml({ column: 2, relationshipId: "rIdText", row: 1 }),
            "<xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:row>1</xdr:row></xdr:from></xdr:twoCellAnchor>",
            "</xdr:wsDr>",
          ].join(""),
        ),
        "xl/media/image1.png": new Uint8Array([1, 2, 3, 4]),
        "xl/media/blank.png": new Uint8Array([5, 6, 7, 8]),
        "xl/media/orphan.png": new Uint8Array([9, 10, 11, 12]),
        "xl/workbook.xml": textBytes(
          [
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            '<sheets><sheet name="Issues" sheetId="1" r:id="rIdIssues"/>',
            '<sheet name="Notes" sheetId="2" r:id="rIdNotes"/>',
            '<sheet name="Missing relationship" sheetId="3"/>',
            '<sheet sheetId="4" r:id="rIdIssues"/>',
            '<sheet name="Wrong type" sheetId="5" r:id="rIdWrong"/>',
            '<sheet name="No type" sheetId="6" r:id="no-type"/></sheets>',
            "</workbook>",
          ].join(""),
        ),
        "xl/worksheets/_rels/sheet1.xml.rels": textBytes(
          [
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rIdDrawing" Target="../drawings/drawing1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"/>',
            '<Relationship Id="rIdWrong" Target="../media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>',
            "</Relationships>",
          ].join(""),
        ),
        "xl/worksheets/sheet1.xml": textBytes(
          [
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            '<sheetData><row r="1"><c r="A1"><v>header</v></c></row>',
            '<row r="2"><c r="A2"><is><t>record</t></is></c></row>',
            '<row r="3"><c r="A3"/></row><row r="0"><c r="A0"><v>invalid</v></c></row></sheetData>',
            '<drawing r:id="rIdDrawing"/><drawing/><drawing r:id="rIdWrong"/>',
            "</worksheet>",
          ].join(""),
        ),
        "xl/worksheets/sheet2.xml": textBytes(
          [
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
            '<sheetData><row r="1"><c r="A1"><v>header</v></c></row>',
            '<row r="2"><c r="A2"><v>note</v></c></row></sheetData>',
            "</worksheet>",
          ].join(""),
        ),
      },
      { level: 0 },
    );
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              metadata: {
                page_number: 1,
                page_name: "Issues",
                text_as_html:
                  "<table><thead><tr><th>Issue</th></tr></thead><tbody><tr><td>First issue</td></tr></tbody></table>",
              },
              type: "Table",
            },
            {
              metadata: {
                sheet_name: "Notes",
                text_as_html:
                  "<table><thead><tr><th>Note</th></tr></thead><tbody><tr><td>First note</td></tr></tbody></table>",
              },
              type: "Table",
            },
            {
              metadata: {
                text_as_html:
                  "<table><thead><tr><th>Other</th></tr></thead><tbody><tr><td>Other record</td></tr></tbody></table>",
              },
              type: "Table",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body,
      documentAssetId,
      filename: "multiple-sheets.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parserHints: { requiresImages: true, requiresTables: true },
      version: 1,
    });
    const images = artifact.elements.filter((element) => element.type === "image");
    const imageByArchivePath = new Map(
      images.map((image) => [image.metadata.archivePath, image] as const),
    );

    expect(images).toHaveLength(3);
    expect(imageByArchivePath.get("xl/media/image1.png")).toMatchObject({
      metadata: {
        archivePath: "xl/media/image1.png",
        endOffset: utf8Length("Issue: First issue"),
        spreadsheetAnchor: {
          sheetIndex: 0,
          sheetName: "Issues",
          sourceColumn: 3,
          sourceRow: 2,
        },
        startOffset: 0,
      },
    });
    expect(imageByArchivePath.get("xl/media/blank.png")).toMatchObject({
      metadata: {
        archivePath: "xl/media/blank.png",
        positionUnknown: true,
        spreadsheetAnchor: {
          sheetIndex: 0,
          sheetName: "Issues",
          sourceColumn: 4,
          sourceRow: 3,
        },
      },
    });
    expect(imageByArchivePath.get("xl/media/orphan.png")).toMatchObject({
      metadata: {
        archivePath: "xl/media/orphan.png",
        positionUnknown: true,
      },
    });
  });

  it("keeps parser text usable when optional spreadsheet media metadata is malformed", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(JSON.stringify([{ text: "Provider text", type: "NarrativeText" }]), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c63",
      now: () => createdAt,
    });
    const parse = (body: Uint8Array) =>
      parser.parse({
        body,
        documentAssetId,
        filename: "malformed.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        parserHints: { requiresImages: true, requiresTables: true },
        version: 1,
      });

    const malformedZip = await parse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]));
    expect(malformedZip.elements).toHaveLength(1);

    const malformedRelationships = await parse(
      zipSync(
        {
          "xl/media/image1.png": new Uint8Array([1, 2, 3, 4]),
          "xl/workbook.xml": textBytes("<workbook><"),
        },
        { level: 0 },
      ),
    );
    expect(malformedRelationships.elements).toHaveLength(2);
    expect(malformedRelationships.elements[1]).toMatchObject({
      metadata: {
        archivePath: "xl/media/image1.png",
        positionUnknown: true,
      },
      type: "image",
    });
  });

  it("deduplicates provider images while filling archive images that the provider omitted", async () => {
    const body = zipSync(
      {
        "word/media/image1.png": new Uint8Array([1, 2, 3, 4]),
        "word/media/image2.png": new Uint8Array([5, 6, 7, 8]),
      },
      { level: 0 },
    );
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              metadata: {
                image_base64: "AQIDBA==",
                image_mime_type: "image/png",
                page_number: 1,
              },
              type: "Image",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body,
      documentAssetId,
      filename: "handbook.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      version: 1,
    });
    const images = artifact.elements.filter((element) => element.type === "image");

    expect(images).toHaveLength(2);
    expect(images[0]?.metadata).toMatchObject({
      assetRef: { uri: "data:image/png;base64,AQIDBA==" },
      unstructuredType: "Image",
    });
    expect(images[1]?.metadata).toMatchObject({
      archivePath: "word/media/image2.png",
      assetRef: { uri: "data:image/png;base64,BQYHCA==" },
      source: "archive-media-fallback",
    });
  });

  it("requests and preserves provider image payloads for legacy DOC files", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (request) => {
        const form = await (request instanceof Request ? request : new Request(request)).formData();

        expect(form.get("strategy")).toBe("hi_res");
        expect(form.getAll("extract_image_block_types")).toEqual(["Image"]);
        expect(form.get("extract_image_block_to_payload")).toBe("true");

        return new Response(
          JSON.stringify([
            {
              metadata: {
                image_base64: "AQIDBA==",
                image_mime_type: "image/png",
                page_number: 1,
              },
              type: "Image",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      },
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]),
      documentAssetId,
      filename: "legacy.doc",
      mimeType: "application/msword",
      parserHints: { requiresImages: true },
      version: 1,
    });

    expect(artifact.elements).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          assetRef: {
            contentType: "image/png",
            uri: "data:image/png;base64,AQIDBA==",
          },
        }),
        type: "image",
      }),
    ]);
  });

  it("preserves nested Unstructured title paths from parent ids and category depth", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              element_id: "chapter",
              metadata: { category_depth: 0, page_number: 1 },
              text: "Detailed features",
              type: "Title",
            },
            {
              element_id: "section",
              metadata: { category_depth: 1, page_number: 1, parent_id: "chapter" },
              text: "Document upload",
              type: "Title",
            },
            {
              element_id: "subsection",
              metadata: { category_depth: 2, page_number: 1, parent_id: "section" },
              text: "Retry and recovery",
              type: "Title",
            },
            {
              metadata: { page_number: 1, parent_id: "subsection" },
              text: "Failed jobs can be retried after their dependency recovers.",
              type: "NarrativeText",
            },
            {
              element_id: "sibling",
              metadata: { category_depth: 1, page_number: 2, parent_id: "chapter" },
              text: "Retrieval modes",
              type: "Title",
            },
            {
              metadata: { page_number: 2, parent_id: "sibling" },
              text: "Fast, Deep, and Research use different retrieval paths.",
              type: "NarrativeText",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body: new Uint8Array([1, 2, 3]),
      documentAssetId,
      filename: "manual.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      version: 1,
    });

    expect(artifact.elements.map((element) => element.sectionPath)).toEqual([
      ["Detailed features"],
      ["Detailed features", "Document upload"],
      ["Detailed features", "Document upload", "Retry and recovery"],
      ["Detailed features", "Document upload", "Retry and recovery"],
      ["Detailed features", "Retrieval modes"],
      ["Detailed features", "Retrieval modes"],
    ]);
  });

  it("normalizes vertical CJK layout and removes coordinate-backed parsing noise", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 40,
                  width: 200,
                  x: 300,
                  y: 20,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "电子发票",
              type: "Title",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 20,
                  width: 20,
                  x: 20,
                  y: 100,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "购",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 200,
                  width: 900,
                  x: 40,
                  y: 100,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "名称：示例公司",
              type: "Table",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 20,
                  width: 20,
                  x: 20,
                  y: 124,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "买",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 20,
                  width: 20,
                  x: 20,
                  y: 148,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "方",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 24,
                  width: 250,
                  x: 600,
                  y: 150,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "统一社会信用代码",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 20,
                  width: 20,
                  x: 20,
                  y: 172,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "信",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 20,
                  width: 20,
                  x: 20,
                  y: 196,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "息",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 30,
                  width: 20,
                  x: 250,
                  y: 400,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "Q)",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 24,
                  width: 35,
                  x: 300,
                  y: 400,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "A)",
              type: "ListItem",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 20,
                  width: 20,
                  x: 20,
                  y: 500,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "备",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 20,
                  width: 20,
                  x: 20,
                  y: 538,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "注",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 30,
                  width: 100,
                  x: 20,
                  y: 1_100,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "重复姓名",
              type: "UncategorizedText",
            },
            {
              metadata: {
                coordinates: unstructuredCoordinates({
                  height: 100,
                  width: 10,
                  x: 980,
                  y: 100,
                }),
                languages: ["zho"],
                page_number: 1,
              },
              text: "gL |",
              type: "UncategorizedText",
            },
          ]),
          { status: 200 },
        ),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
      now: () => createdAt,
    });

    const artifact = await parser.parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      version: 1,
    });

    expect(artifact.elements.map((element) => [element.text, element.type])).toEqual([
      ["电子发票", "title"],
      ["购买方信息", "paragraph"],
      ["名称：示例公司", "table"],
      ["统一社会信用代码", "paragraph"],
      ["A)", "list"],
      ["备注", "paragraph"],
    ]);
    expect(artifact.elements[1]).toMatchObject({
      metadata: {
        boundingBox: { height: 116, width: 20, x: 20, y: 100 },
        layout_normalization: {
          operation: "merge_vertical_text",
          source_element_count: 5,
        },
      },
      pageNumber: 1,
      text: "购买方信息",
    });
    expect(artifact.elements[5]).toMatchObject({
      metadata: {
        boundingBox: { height: 58, width: 20, x: 20, y: 500 },
        layout_normalization: {
          operation: "merge_vertical_text",
          source_element_count: 2,
        },
      },
      text: "备注",
    });
  });

  it("accepts a full Unstructured partition endpoint URL", async () => {
    let requestedUrl = "";
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test/general/v0/general",
      fetch: async (request) => {
        const parsedRequest = request instanceof Request ? request : new Request(request);
        requestedUrl = parsedRequest.url;

        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    });

    await parser.parse(
      createParseInput({
        body: "%PDF-1.7",
        filename: "doc.pdf",
        mimeType: "application/pdf",
      }),
    );

    expect(requestedUrl).toBe("https://unstructured.example.test/general/v0/general");
  });

  it("retries retryable Unstructured failures", async () => {
    const statuses = [429, 200];
    const delays: number[] = [];
    const seenAbortedSignals: boolean[] = [];
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (request) => {
        const parsedRequest = request instanceof Request ? request : new Request(request);
        seenAbortedSignals.push(parsedRequest.signal.aborted);
        const status = statuses.shift() ?? 500;

        return new Response(JSON.stringify([{ text: "Retried parse", type: "NarrativeText" }]), {
          headers: { "content-type": "application/json" },
          status,
        });
      },
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c70",
      maxRetries: 1,
      now: () => createdAt,
      retryDelayMs: 10,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await expect(
      parser.parse({
        body: new Uint8Array([1, 2, 3]),
        documentAssetId,
        filename: "retry.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).resolves.toMatchObject({
      elements: [
        {
          text: "Retried parse",
          type: "paragraph",
        },
      ],
      parser: "unstructured",
    });
    expect(delays).toEqual([10]);
    expect(seenAbortedSignals).toEqual([false, false]);
  });

  it("retries transient network failures without sleeping when retryDelayMs is zero", async () => {
    let fetchCalls = 0;
    let sleepCalls = 0;
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) throw new TypeError("connection reset");
        return new Response(JSON.stringify([{ text: "Recovered", type: "NarrativeText" }]), {
          status: 200,
        });
      },
      maxRetries: 1,
      retryDelayMs: 0,
      sleep: async () => {
        sleepCalls += 1;
      },
    });

    await expect(
      parser.parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "network-retry.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).resolves.toMatchObject({ parser: "unstructured" });
    expect(fetchCalls).toBe(2);
    expect(sleepCalls).toBe(0);
  });

  it.each([0, 1])(
    "uses the bounded default delay before retrying a transient provider failure (%d ms)",
    async (retryDelayMs) => {
      let fetchCalls = 0;
      const parser = createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => {
          fetchCalls += 1;
          return new Response(JSON.stringify([{ text: "Recovered", type: "NarrativeText" }]), {
            status: fetchCalls === 1 ? 500 : 200,
          });
        },
        maxRetries: 1,
        retryDelayMs,
      });

      await expect(
        parser.parse({
          body: new Uint8Array([1]),
          documentAssetId,
          filename: "delayed-retry.pdf",
          mimeType: "application/pdf",
          version: 1,
        }),
      ).resolves.toMatchObject({ parser: "unstructured" });
      expect(fetchCalls).toBe(2);
    },
  );

  it("preserves caller cancellation while an Unstructured request is active", async () => {
    const controller = new AbortController();
    let fetchStarted = false;
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        fetchStarted = true;
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
    });
    const pending = parser.parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "cancel-active.pdf",
      mimeType: "application/pdf",
      signal: controller.signal,
      version: 1,
    });

    await waitForCondition(() => fetchStarted);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects an Unstructured request whose caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => new Response("[]"),
    });

    await expect(
      parser.parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "already-aborted.pdf",
        mimeType: "application/pdf",
        signal: controller.signal,
        version: 1,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts an active Unstructured request when its deadline expires", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
      requestTimeoutMs: 1,
    });

    await expect(
      parser.parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "timeout.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser request timed out after requestTimeoutMs=1");
  });

  it("rejects a successful Unstructured response completed after its deadline", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify([{ text: "Too late", type: "NarrativeText" }]));
      },
      requestTimeoutMs: 1,
    });

    await expect(
      parser.parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "late-success.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser request timed out after requestTimeoutMs=1");
  });

  it("uses the standard AbortError when an abort event has no signal reason", async () => {
    const controller = new AbortController();
    let fetchStarted = false;
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        fetchStarted = true;
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
    });
    const pending = parser.parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "abort-event.pdf",
      mimeType: "application/pdf",
      signal: controller.signal,
      version: 1,
    });

    await waitForCondition(() => fetchStarted);
    controller.signal.dispatchEvent(new Event("abort"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates Unstructured retry and resource bounds", () => {
    const base = {
      endpoint: "https://unstructured.example.test",
      fetch: async () => new Response("[]", { status: 200 }),
    };

    expect(() => createUnstructuredParserClient({ ...base, maxRetries: -1 })).toThrow(
      "maxRetries must be a non-negative integer",
    );
    expect(() => createUnstructuredParserClient({ ...base, maxRetries: 0.5 })).toThrow(
      "maxRetries must be a non-negative integer",
    );
    expect(() => createUnstructuredParserClient({ ...base, retryDelayMs: -1 })).toThrow(
      "retryDelayMs must be a non-negative integer",
    );
    expect(() => createUnstructuredParserClient({ ...base, retryDelayMs: 0.5 })).toThrow(
      "retryDelayMs must be a non-negative integer",
    );
    expect(() => createUnstructuredParserClient({ ...base, maxConcurrency: 0 })).toThrow(
      "maxConcurrency must be an integer between 1 and 32",
    );
    expect(() => createUnstructuredParserClient({ ...base, maxConcurrency: 33 })).toThrow(
      "maxConcurrency must be an integer between 1 and 32",
    );
    expect(() => createUnstructuredParserClient({ ...base, maxConcurrency: 1.5 })).toThrow(
      "maxConcurrency must be an integer between 1 and 32",
    );
    expect(() => createUnstructuredParserClient({ ...base, requestTimeoutMs: 0 })).toThrow(
      "requestTimeoutMs must be an integer between 1 and 600000",
    );
    expect(() => createUnstructuredParserClient({ ...base, requestTimeoutMs: 600_001 })).toThrow(
      "requestTimeoutMs must be an integer between 1 and 600000",
    );
    expect(() => createUnstructuredParserClient({ ...base, requestTimeoutMs: 1.5 })).toThrow(
      "requestTimeoutMs must be an integer between 1 and 600000",
    );
  });

  it("rejects failed, invalid, and oversized Unstructured responses", async () => {
    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => new Response("nope", { status: 429 }),
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "bad.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser request failed with status 429");
    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => new Response("nope", { status: 429 }),
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "bad.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);

    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => new Response(JSON.stringify({ bad: true }), { status: 200 }),
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "bad.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser returned an invalid response");
    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => new Response(JSON.stringify({ bad: true }), { status: 200 }),
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "bad.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => new Response("not-json", { status: 200 }),
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "not-json.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser returned an invalid response");

    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () =>
          new Response(
            JSON.stringify([
              { text: "one", type: "NarrativeText" },
              { text: "two", type: "NarrativeText" },
            ]),
            { status: 200 },
          ),
        maxElements: 1,
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "too-many.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Parser output exceeds maxElements=1");

    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => new Response("[]", { status: 200 }),
        maxResponseBytes: 0,
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "invalid-bound.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser maxResponseBytes must be at least 1");

    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () =>
          new Response("[]", {
            headers: { "content-length": "4" },
            status: 200,
          }),
        maxResponseBytes: 3,
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "content-length.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser response exceeds maxResponseBytes=3");

    await expect(
      createUnstructuredParserClient({
        endpoint: "https://unstructured.example.test",
        fetch: async () => new Response("[{}]", { status: 200 }),
        maxResponseBytes: 3,
      }).parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "body-size.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser response exceeds maxResponseBytes=3");
  });

  it("cancels an oversized streaming Unstructured response before reading later chunks", async () => {
    let canceled = false;
    let pullCount = 0;
    const responseBody = new ReadableStream<Uint8Array>(
      {
        cancel: () => {
          canceled = true;
        },
        pull: (controller) => {
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(new Uint8Array([91, 123]));
            return;
          }
          if (pullCount === 2) {
            controller.enqueue(new Uint8Array([125, 93]));
            return;
          }
          controller.enqueue(new Uint8Array([32, 32]));
        },
      },
      { highWaterMark: 0 },
    );
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => new Response(responseBody, { status: 200 }),
      maxResponseBytes: 3,
    });

    await expect(
      parser.parse({
        body: new Uint8Array([1]),
        documentAssetId,
        filename: "streamed.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser response exceeds maxResponseBytes=3");
    expect(canceled).toBe(true);
    expect(pullCount).toBe(2);
  });

  it("limits concurrent Unstructured requests and releases queued calls in FIFO order", async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return new Response("[]", { status: 200 });
      },
      maxConcurrency: 2,
    });
    const parses = Array.from({ length: 4 }, (_, index) =>
      parser.parse({
        body: new Uint8Array([index]),
        documentAssetId,
        filename: `concurrent-${index}.pdf`,
        mimeType: "application/pdf",
        version: 1,
      }),
    );

    await waitForCondition(() => releases.length === 2);
    expect(active).toBe(2);
    for (const release of releases.splice(0, 2)) release();
    await waitForCondition(() => releases.length === 2);
    for (const release of releases.splice(0, 2)) release();

    await expect(Promise.all(parses)).resolves.toHaveLength(4);
    expect(maxActive).toBe(2);
  });

  it("removes an aborted Unstructured request while it waits for the concurrency gate", async () => {
    let fetchCalls = 0;
    let releaseFirst: (() => void) | undefined;
    const parser = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => {
        fetchCalls += 1;
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return new Response("[]", { status: 200 });
      },
      maxConcurrency: 1,
    });
    const first = parser.parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "first.pdf",
      mimeType: "application/pdf",
      version: 1,
    });
    await waitForCondition(() => fetchCalls === 1);
    const controller = new AbortController();
    const queued = parser.parse({
      body: new Uint8Array([2]),
      documentAssetId,
      filename: "queued.pdf",
      mimeType: "application/pdf",
      signal: controller.signal,
      version: 1,
    });
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchCalls).toBe(1);
    releaseFirst?.();
    await expect(first).resolves.toMatchObject({ parser: "unstructured" });
  });

  it("bounds stalled Unstructured response headers and response bodies", async () => {
    const stalledHeaders = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
      requestTimeoutMs: 10,
    });
    const stalledHeadersResult = stalledHeaders.parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "headers.pdf",
      mimeType: "application/pdf",
      version: 1,
    });
    await expect(stalledHeadersResult).rejects.toMatchObject({
      code: "provider_request_failed",
      retryable: true,
    });

    const stalledBody = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        return new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              );
            },
          }),
          { status: 200 },
        );
      },
      requestTimeoutMs: 10,
    });
    const stalledBodyResult = stalledBody.parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "body.pdf",
      mimeType: "application/pdf",
      version: 1,
    });
    await expect(stalledBodyResult).rejects.toMatchObject({
      code: "provider_request_failed",
      retryable: true,
    });
  });

  it("classifies transient provider failures as retryable without retrying invalid input", async () => {
    const networkFailure = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => {
        throw new TypeError("connection reset");
      },
    }).parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "network.pdf",
      mimeType: "application/pdf",
      version: 1,
    });
    await expect(networkFailure).rejects.toBeInstanceOf(ProviderRequestError);
    await expect(networkFailure).rejects.toMatchObject({ retryable: true });

    const inputFailure = createUnstructuredParserClient({
      endpoint: "https://unstructured.example.test",
      fetch: async () => new Response("bad request", { status: 400 }),
    }).parse({
      body: new Uint8Array([1]),
      documentAssetId,
      filename: "input.pdf",
      mimeType: "application/pdf",
      version: 1,
    });
    await expect(inputFailure).rejects.toMatchObject({ retryable: false, status: 400 });
  });
});

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for parser test condition");
}

describe("structured data parser coverage", () => {
  const structured = () =>
    createNativeStructuredDataParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      now: () => createdAt,
    });

  it("parses JSON Lines into a table and mixed cell types into strings", async () => {
    const artifact = await structured().parse(
      createParseInput({
        body: [
          '{"name":"a","count":1,"flag":true,"nested":{"x":1},"empty":null}',
          "",
          '{"name":"b","extra":"y"}',
        ].join("\n"),
        filename: "rows.jsonl",
        mimeType: "application/x-ndjson",
      }),
    );

    const table = artifact.elements[0];
    expect(table?.type).toBe("table");
    expect(table?.metadata).toMatchObject({
      table: {
        columns: ["name", "count", "flag", "nested", "empty", "extra"],
        headerRowCount: 0,
        mode: "record-list",
        recordCount: 2,
        semanticVersion: 1,
      },
    });
    expect(table?.text).toContain(
      'name: a | count: 1 | flag: true | nested: {"x":1} | empty:  | extra: ',
    );
    expect(table?.text).toContain("name: b | count:  | flag:  | nested:  | empty:  | extra: y");
  });

  it("keeps quoted CSV newlines and delimiters inside their logical record", async () => {
    const artifact = await structured().parse(
      createParseInput({
        body: 'id,description\n1,"first line\nsecond line"\n2,"contains, comma"',
        filename: "quoted.csv",
        mimeType: "text/csv",
      }),
    );

    expect(artifact.elements[0]).toMatchObject({
      metadata: {
        table: {
          columns: ["id", "description"],
          mode: "record-list",
          recordCount: 2,
          sourceRowCount: 3,
        },
      },
      text: "id: 1 | description: first line second line\nid: 2 | description: contains, comma",
      type: "table",
    });
  });

  it("renders non-tabular JSON as a code element with root type metadata", async () => {
    const artifact = await structured().parse(
      createParseInput({
        body: '{"single":"object"}',
        filename: "config.json",
        mimeType: "application/json",
      }),
    );
    expect(artifact.elements[0]).toMatchObject({
      metadata: { format: "json", rootType: "object" },
      type: "code",
    });

    const arrayArtifact = await structured().parse(
      createParseInput({
        body: "[1,2,3]",
        filename: "list.json",
        mimeType: "application/json",
      }),
    );
    expect(arrayArtifact.elements[0]).toMatchObject({
      metadata: { format: "json", rootType: "array" },
      type: "code",
    });
  });

  it("enforces maxRows and rejects unsupported or invalid structured content", async () => {
    const bounded = createNativeStructuredDataParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      maxRows: 1,
      now: () => createdAt,
    });

    await expect(
      bounded.parse(
        createParseInput({
          body: '{"a":1}\n{"a":2}',
          filename: "rows.jsonl",
          mimeType: "application/x-ndjson",
        }),
      ),
    ).rejects.toThrow("exceeds maxRows=1");
    await expect(
      structured().parse(
        createParseInput({ body: "a: 1", filename: "notes.txt", mimeType: "text/plain" }),
      ),
    ).rejects.toThrow("unsupported file type");
    await expect(
      structured().parse(
        createParseInput({ body: "{broken", filename: "bad.json", mimeType: "application/json" }),
      ),
    ).rejects.toThrow("invalid response");
  });
});

describe("image element extraction coverage", () => {
  it("extracts markdown images with inferred content types and optional alt/title", async () => {
    const parser = createNativeMarkdownParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: [
          "# Gallery",
          "",
          '![Chart](https://cdn.example.com/chart.png "Quarterly")',
          "![](https://cdn.example.com/photo.jpeg)",
          "![Anim](https://cdn.example.com/anim.gif?size=2#frag)",
          "![Web](https://cdn.example.com/pic.webp)",
          "![Vec](https://cdn.example.com/logo.svg)",
          "![Av](https://cdn.example.com/av.avif)",
          "![Inline](data:image/png;base64,AAAA)",
          "![NoExt](https://cdn.example.com/binary)",
        ].join("\n"),
        filename: "gallery.md",
        mimeType: "text/markdown",
      }),
    );

    const images = artifact.elements.filter((element) => element.type === "image");
    expect(images.length).toBeGreaterThanOrEqual(8);
    const contentTypes = images.map(
      (element) => (element.metadata.assetRef as { contentType?: string } | undefined)?.contentType,
    );
    expect(contentTypes).toEqual(
      expect.arrayContaining([
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/svg+xml",
        "image/avif",
        undefined,
      ]),
    );
  });

  it("extracts html img and figure images with captions", async () => {
    const parser = createNativeHtmlParser({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      now: () => createdAt,
    });
    const artifact = await parser.parse(
      createParseInput({
        body: [
          "<h1>Doc</h1>",
          '<img src="https://cdn.example.com/a.png" alt="Alt text" title="Title text" />',
          '<img src="https://cdn.example.com/b.jpg" />',
          "<img />",
          "<figure><img src='https://cdn.example.com/c.webp' /><figcaption>Figure caption</figcaption></figure>",
        ].join("\n"),
        filename: "gallery.html",
        mimeType: "text/html",
      }),
    );

    const images = artifact.elements.filter((element) => element.type === "image");
    expect(images.length).toBe(3);
    expect(images.map((element) => element.metadata.source)).toEqual(
      expect.arrayContaining(["html-img", "html-figure"]),
    );
    expect(
      images.some(
        (element) => (element.metadata as { caption?: string }).caption === "Figure caption",
      ),
    ).toBe(true);
  });
});
