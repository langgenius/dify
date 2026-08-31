import { describe, expect, it } from "vitest";

import type { Dispatcher } from "undici";

import {
  createApiDocumentParser,
  createApiUnstructuredConcurrencyOptions,
  createNodeUnstructuredFetch,
} from "./parser-options";

const encoder = new TextEncoder();

function ordinaryDocx(): Uint8Array {
  const filename = encoder.encode("word/document.xml");
  const localHeader = new Uint8Array(30);
  const centralDirectory = new Uint8Array(46 + filename.byteLength);
  const endOfCentralDirectory = new Uint8Array(22);
  const localView = new DataView(localHeader.buffer);
  const centralView = new DataView(centralDirectory.buffer);
  const endView = new DataView(endOfCentralDirectory.buffer);

  localView.setUint32(0, 0x04034b50, true);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint32(20, 1, true);
  centralView.setUint32(24, 1, true);
  centralView.setUint16(28, filename.byteLength, true);
  centralDirectory.set(filename, 46);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localHeader.byteLength, true);

  const body = new Uint8Array(
    localHeader.byteLength + centralDirectory.byteLength + endOfCentralDirectory.byteLength,
  );
  body.set(localHeader);
  body.set(centralDirectory, localHeader.byteLength);
  body.set(endOfCentralDirectory, localHeader.byteLength + centralDirectory.byteLength);
  return body;
}

describe("createApiDocumentParser", () => {
  it("resolves parser lane widths and preserves the legacy heavy alias", () => {
    expect(createApiUnstructuredConcurrencyOptions({})).toEqual({
      heavyMaxConcurrency: 2,
      maxConcurrency: 2,
    });
    expect(
      createApiUnstructuredConcurrencyOptions({
        UNSTRUCTURED_HEAVY_MAX_CONCURRENCY: "3",
        UNSTRUCTURED_MAX_CONCURRENCY: "4",
      }),
    ).toEqual({ heavyMaxConcurrency: 3, maxConcurrency: 4 });
    expect(
      createApiUnstructuredConcurrencyOptions({
        UNSTRUCTURED_MAX_CONCURRENCY: "4",
        UNSTRUCTURED_PDF_MAX_CONCURRENCY: "2",
      }),
    ).toEqual({ heavyMaxConcurrency: 2, maxConcurrency: 4 });
    expect(() =>
      createApiUnstructuredConcurrencyOptions({
        UNSTRUCTURED_HEAVY_MAX_CONCURRENCY: "3",
        UNSTRUCTURED_MAX_CONCURRENCY: "2",
      }),
    ).toThrow("UNSTRUCTURED_HEAVY_MAX_CONCURRENCY must not exceed UNSTRUCTURED_MAX_CONCURRENCY");
  });

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
      heavyRequestTimeoutMs: 2_400_000,
      requestTimeoutMs: 600_000,
    });
    const request = new Request("https://unstructured.example.test/general/v0/general", {
      body: "document",
      method: "POST",
    });

    await nodeFetch(request);

    expect(dispatcherOptions).toEqual({
      bodyTimeout: 2_400_000,
      headersTimeout: 2_400_000,
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

  it("routes an admitted 11 MiB structured upload to the remote parser", async () => {
    let fetchCalls = 0;
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_API_URL: "https://unstructured.example.test" },
      fetch: async () => {
        fetchCalls += 1;
        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    });

    const artifact = await parser.parse({
      body: new Uint8Array(11 * 1024 * 1024),
      documentAssetId: "00000000-0000-4000-8000-000000000020",
      filename: "large.csv",
      mimeType: "text/csv",
      version: 1,
    });

    expect(fetchCalls).toBe(1);
    expect(artifact).toMatchObject({
      metadata: { routeReason: "native-size-limit", routedParser: "unstructured" },
      parser: "unstructured",
    });
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

  it("keeps configured PDF admission independent from ordinary documents", async () => {
    const activeByFormat = { document: 0, pdf: 0 };
    const maxActiveByFormat = { document: 0, pdf: 0 };
    let maxCombinedActive = 0;
    const parser = createApiDocumentParser({
      env: {
        UNSTRUCTURED_API_URL: "https://unstructured.example.test",
        UNSTRUCTURED_MAX_CONCURRENCY: "2",
        UNSTRUCTURED_PDF_MAX_CONCURRENCY: "1",
      },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        const file = (await request.formData()).get("files");
        const format = file instanceof File && file.name.endsWith(".pdf") ? "pdf" : "document";
        activeByFormat[format] += 1;
        maxActiveByFormat[format] = Math.max(maxActiveByFormat[format], activeByFormat[format]);
        maxCombinedActive = Math.max(
          maxCombinedActive,
          activeByFormat.document + activeByFormat.pdf,
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeByFormat[format] -= 1;
        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    });
    expect(parser.heavyWorkloadMaxConcurrency).toBe(1);
    const parses = [
      parser.parse({
        body: encoder.encode("%PDF-1.7"),
        documentAssetId: "00000000-0000-4000-8000-000000000010",
        filename: "first.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
      parser.parse({
        body: encoder.encode("%PDF-1.7"),
        documentAssetId: "00000000-0000-4000-8000-000000000011",
        filename: "second.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
      parser.parse({
        body: ordinaryDocx(),
        documentAssetId: "00000000-0000-4000-8000-000000000012",
        filename: "first.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        version: 1,
      }),
      parser.parse({
        body: ordinaryDocx(),
        documentAssetId: "00000000-0000-4000-8000-000000000013",
        filename: "second.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        version: 1,
      }),
    ];

    await expect(Promise.all(parses)).resolves.toHaveLength(4);
    expect(maxActiveByFormat.pdf).toBe(1);
    expect(maxActiveByFormat.document).toBeLessThanOrEqual(2);
    expect(maxCombinedActive).toBe(2);
  });

  it("uses a ten-minute ordinary request deadline by default", () => {
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_API_URL: "https://unstructured.example.test" },
    });

    expect(
      parser.leaseMs?.({
        body: ordinaryDocx(),
        documentAssetId: "00000000-0000-4000-8000-000000000020",
        filename: "ordinary.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        version: 1,
      }),
    ).toBe(900_000);
  });

  it("prefers generic heavy settings over their legacy PDF aliases", async () => {
    const parser = createApiDocumentParser({
      env: {
        UNSTRUCTURED_API_URL: "https://unstructured.example.test",
        UNSTRUCTURED_HEAVY_REQUEST_TIMEOUT_MS: "1",
        UNSTRUCTURED_PDF_REQUEST_TIMEOUT_MS: "10",
        UNSTRUCTURED_REQUEST_TIMEOUT_MS: "20",
      },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
    });

    await expect(
      parser.parse({
        body: encoder.encode("%PDF-1.7"),
        documentAssetId: "00000000-0000-4000-8000-000000000021",
        filename: "report.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toThrow(/^Unstructured parser request timed out after requestTimeoutMs=1$/u);
  });

  it("forwards the PDF-specific request deadline without extending ordinary documents", async () => {
    const parser = createApiDocumentParser({
      env: {
        UNSTRUCTURED_API_URL: "https://unstructured.example.test",
        UNSTRUCTURED_PDF_REQUEST_TIMEOUT_MS: "1",
        UNSTRUCTURED_REQUEST_TIMEOUT_MS: "10",
      },
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
    });

    await expect(
      parser.parse({
        body: encoder.encode("%PDF-1.7"),
        documentAssetId: "00000000-0000-4000-8000-000000000012",
        filename: "report.pdf",
        mimeType: "application/pdf; charset=binary",
        version: 1,
      }),
    ).rejects.toThrow(/^Unstructured parser request timed out after requestTimeoutMs=1$/u);
    await expect(
      parser.parse({
        body: ordinaryDocx(),
        documentAssetId: "00000000-0000-4000-8000-000000000013",
        filename: "report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        version: 1,
      }),
    ).rejects.toThrow(/^Unstructured parser request timed out after requestTimeoutMs=10$/u);
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
        env: { UNSTRUCTURED_API_URL: "http://parser", UNSTRUCTURED_HEAVY_MAX_CONCURRENCY: "0" },
      }),
    ).toThrow("UNSTRUCTURED_HEAVY_MAX_CONCURRENCY must be at least 1");
    expect(() =>
      createApiDocumentParser({
        env: { UNSTRUCTURED_API_URL: "http://parser", UNSTRUCTURED_MAX_INPUT_BYTES: "52428801" },
      }),
    ).toThrow("UNSTRUCTURED_MAX_INPUT_BYTES must be between 1 and 52428800");
    expect(() =>
      createApiDocumentParser({
        env: { UNSTRUCTURED_API_URL: "http://parser", UNSTRUCTURED_PDF_MAX_CONCURRENCY: "0" },
      }),
    ).toThrow("UNSTRUCTURED_PDF_MAX_CONCURRENCY must be at least 1");
    expect(() =>
      createApiDocumentParser({
        env: { UNSTRUCTURED_API_URL: "http://parser", UNSTRUCTURED_PDF_MAX_CONCURRENCY: "33" },
      }),
    ).toThrow("UNSTRUCTURED_PDF_MAX_CONCURRENCY must be between 1 and 32");
    expect(() =>
      createApiDocumentParser({
        env: {
          UNSTRUCTURED_API_URL: "http://parser",
          UNSTRUCTURED_REQUEST_TIMEOUT_MS: "3600000",
        },
      }),
    ).not.toThrow();
    expect(() =>
      createApiDocumentParser({
        env: {
          UNSTRUCTURED_API_URL: "http://parser",
          UNSTRUCTURED_REQUEST_TIMEOUT_MS: "3600001",
        },
      }),
    ).toThrow("UNSTRUCTURED_REQUEST_TIMEOUT_MS must be between 1 and 3600000");
    expect(() =>
      createApiDocumentParser({
        env: {
          UNSTRUCTURED_API_URL: "http://parser",
          UNSTRUCTURED_HEAVY_REQUEST_TIMEOUT_MS: "3600001",
        },
      }),
    ).toThrow("UNSTRUCTURED_HEAVY_REQUEST_TIMEOUT_MS must be between 1 and 3600000");
    expect(() =>
      createApiDocumentParser({
        env: {
          UNSTRUCTURED_API_URL: "http://parser",
          UNSTRUCTURED_PDF_REQUEST_TIMEOUT_MS: "3600000",
        },
      }),
    ).not.toThrow();
    expect(() =>
      createApiDocumentParser({
        env: {
          UNSTRUCTURED_API_URL: "http://parser",
          UNSTRUCTURED_PDF_REQUEST_TIMEOUT_MS: "3600001",
        },
      }),
    ).toThrow("UNSTRUCTURED_PDF_REQUEST_TIMEOUT_MS must be between 1 and 3600000");
  });
});
