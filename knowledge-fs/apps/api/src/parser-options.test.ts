import { describe, expect, it } from "vitest";

import type { Dispatcher } from "undici";

import { createApiDocumentParser, createNodeUnstructuredFetch } from "./parser-options";

const encoder = new TextEncoder();

describe("createApiDocumentParser", () => {
  it("translates native requests onto a matching Node transport with aligned timeouts", async () => {
    let dispatcherOptions: Readonly<{ bodyTimeout: number; headersTimeout: number }> | undefined;
    let requestDispatcher: Dispatcher | undefined;
    let receivedBody: BodyInit | null | undefined;
    let receivedInput: RequestInfo | URL | undefined;
    let receivedMethod: string | undefined;
    const dispatcher = {} as Dispatcher;
    const nodeFetch = createNodeUnstructuredFetch({
      createDispatcher: (options) => {
        dispatcherOptions = options;
        return dispatcher;
      },
      fetch: async (input, init) => {
        receivedBody = init?.body;
        receivedInput = input;
        receivedMethod = init?.method;
        requestDispatcher = (init as (RequestInit & { dispatcher?: Dispatcher }) | undefined)
          ?.dispatcher;
        return new Response("[]");
      },
      requestTimeoutMs: 600_000,
    });
    const request = new Request("https://unstructured.example.test/general/v0/general", {
      body: "document",
      method: "POST",
    });

    await nodeFetch(request);

    expect(dispatcherOptions).toEqual({
      bodyTimeout: 600_000,
      headersTimeout: 600_000,
    });
    expect(receivedInput).toBe(request.url);
    expect(receivedMethod).toBe("POST");
    expect(receivedBody).toBe(request.body);
    expect(requestDispatcher).toBe(dispatcher);
  });

  it("keeps Markdown and structured data on native parsers", async () => {
    let fetchCalls = 0;
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_API_URL: "https://unstructured.example.test" },
      fetch: async () => {
        fetchCalls += 1;
        return new Response("[]");
      },
    });

    const markdown = await parser.parse({
      body: encoder.encode("# Native"),
      documentAssetId: "00000000-0000-4000-8000-000000000001",
      filename: "doc.md",
      mimeType: "text/markdown",
      version: 1,
    });
    const csv = await parser.parse({
      body: encoder.encode("name,value\nalpha,1\n"),
      documentAssetId: "00000000-0000-4000-8000-000000000002",
      filename: "metrics.csv",
      mimeType: "text/csv",
      version: 1,
    });

    expect(markdown.parser).toBe("native-markdown");
    expect(csv.parser).toBe("native-structured");
    expect(fetchCalls).toBe(0);
  });

  it("routes complex documents to the configured Unstructured API", async () => {
    let requestedUrl = "";
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_API_URL: "https://unstructured.example.test/" },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requestedUrl = request.url;

        return new Response(
          JSON.stringify([
            {
              metadata: { page_number: 2 },
              text: "Parsed PDF text",
              type: "NarrativeText",
            },
          ]),
          { headers: { "content-type": "application/json" } },
        );
      },
    });

    const artifact = await parser.parse({
      body: encoder.encode("%PDF-1.7"),
      documentAssetId: "00000000-0000-4000-8000-000000000003",
      filename: "report.pdf",
      mimeType: "application/pdf",
      version: 1,
    });

    expect(requestedUrl).toBe("https://unstructured.example.test/general/v0/general");
    expect(artifact).toMatchObject({
      metadata: {
        routeReason: "complex-file-type",
        routedParser: "unstructured",
      },
      parser: "unstructured",
    });
    expect(artifact.elements[0]).toMatchObject({
      pageNumber: 2,
      text: "Parsed PDF text",
      type: "paragraph",
    });
  });

  it("forwards the configured default language to Unstructured", async () => {
    let requestedLanguage: FormDataEntryValue | null = null;
    const parser = createApiDocumentParser({
      env: {
        UNSTRUCTURED_API_URL: "https://unstructured.example.test",
        UNSTRUCTURED_DEFAULT_LANGUAGE: "zh-CN",
      },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requestedLanguage = (await request.formData()).get("languages");
        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    });

    await parser.parse({
      body: encoder.encode("%PDF-1.7"),
      documentAssetId: "00000000-0000-4000-8000-000000000007",
      filename: "report.pdf",
      mimeType: "application/pdf",
      version: 1,
    });

    expect(requestedLanguage).toBe("zho");
  });

  it("can derive the local Unstructured URL from UNSTRUCTURED_PORT outside production", async () => {
    let requestedUrl = "";
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_PORT: "8000" },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requestedUrl = request.url;

        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    });

    await parser.parse({
      body: encoder.encode("%PDF-1.7"),
      documentAssetId: "00000000-0000-4000-8000-000000000004",
      filename: "report.pdf",
      mimeType: "application/pdf",
      version: 1,
    });

    expect(requestedUrl).toBe("http://127.0.0.1:8000/general/v0/general");
  });

  it("fails closed for complex documents when Unstructured is not configured", async () => {
    const parser = createApiDocumentParser({ env: { NODE_ENV: "production" } });

    await expect(
      parser.parse({
        body: encoder.encode("%PDF-1.7"),
        documentAssetId: "00000000-0000-4000-8000-000000000005",
        filename: "report.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow("Unstructured parser is not configured");
  });

  it("rejects invalid parser environment bounds", () => {
    expect(() =>
      createApiDocumentParser({
        env: { UNSTRUCTURED_API_URL: "http://parser", UNSTRUCTURED_PORT: "0" },
      }),
    ).not.toThrow();
    expect(() => createApiDocumentParser({ env: { UNSTRUCTURED_PORT: "70000" } })).toThrow(
      "UNSTRUCTURED_PORT must be between 1 and 65535",
    );
    expect(() =>
      createApiDocumentParser({
        env: { UNSTRUCTURED_API_URL: "http://parser", UNSTRUCTURED_MAX_RESPONSE_BYTES: "0" },
      }),
    ).toThrow("UNSTRUCTURED_MAX_RESPONSE_BYTES must be at least 1");
    expect(() =>
      createApiDocumentParser({
        env: { UNSTRUCTURED_API_URL: "http://parser", UNSTRUCTURED_MAX_CONCURRENCY: "33" },
      }),
    ).toThrow("UNSTRUCTURED_MAX_CONCURRENCY must be between 1 and 32");
    expect(() =>
      createApiDocumentParser({
        env: {
          UNSTRUCTURED_API_URL: "http://parser",
          UNSTRUCTURED_REQUEST_TIMEOUT_MS: "1800001",
        },
      }),
    ).toThrow("UNSTRUCTURED_REQUEST_TIMEOUT_MS must be between 1 and 1800000");
  });
});
