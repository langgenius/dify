import { describe, expect, it } from "vitest";

import {
  ProviderInputError,
  ProviderRateLimitError,
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
        parserVersion: "native-markdown@1",
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
        text: "A | B\n1 | 2",
        type: "table",
      },
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

  it("parses HTML while ignoring script and style content", async () => {
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
    expect(artifact.elements.map((element) => element.type)).toEqual([
      "title",
      "heading",
      "paragraph",
      "list",
      "code",
      "table",
    ]);
    expect(artifact.elements.map((element) => element.text)).toEqual([
      "Ignored Title",
      "Guide",
      "Read the docs.",
      "Install\nRun",
      "pnpm check",
      "A | B\n1 | 2",
    ]);
    expect(artifact.elements.map((element) => element.sectionPath)).toEqual([
      [],
      ["Guide"],
      ["Guide"],
      ["Guide"],
      ["Guide"],
      ["Guide"],
    ]);
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

    expect(selected).toEqual(["markdown", "html", "unstructured"]);
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
          metadata: { columns: ["name", "score"], format: "csv", rowCount: 2 },
          text: "name | score\nAda | 10\nLin | 9",
          type: "table",
        },
      ],
      metadata: {
        filename: "scores.csv",
        mimeType: "text/csv",
        parserVersion: "native-structured@1",
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
          metadata: { columns: ["name"], format: "jsonl", rowCount: 2 },
          text: "name\nAda\nLin",
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
                image_path: "file:///tmp/report-figure-1.png",
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
        parserVersion: "unstructured@1",
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
            uri: "file:///tmp/report-figure-1.png",
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
          image_path: "file:///tmp/report-figure-1.png",
          unstructuredType: "Image",
        },
        pageNumber: 2,
        sectionPath: ["Executive Summary"],
        type: "image",
      },
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50:element-4",
        metadata: {
          table: { html: "<table><tr><td>ARR</td></tr></table>" },
          textAsHtml: "<table><tr><td>ARR</td></tr></table>",
          text_as_html: "<table><tr><td>ARR</td></tr></table>",
          unstructuredType: "Table",
        },
        pageNumber: 3,
        sectionPath: ["Executive Summary"],
        text: "ARR",
        type: "table",
      },
    ]);
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

  it("retries retryable Unstructured failures and propagates AbortSignal", async () => {
    const statuses = [429, 200];
    const delays: number[] = [];
    const seenAbortedSignals: boolean[] = [];
    const controller = new AbortController();
    controller.abort();
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
        signal: controller.signal,
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
    expect(seenAbortedSignals).toEqual([true, true]);
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
});

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
    expect(table?.text).toContain("name | count | flag | nested | empty | extra");
    expect(table?.text).toContain('a | 1 | true | {"x":1} |  | ');
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
