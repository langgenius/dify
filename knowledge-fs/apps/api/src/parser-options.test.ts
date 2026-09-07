import { describe, expect, it, vi } from "vitest";

import { ProviderInputError } from "@knowledge/parsers";

import type { Dispatcher } from "undici";

import {
  createApiDocumentParser,
  createApiUnstructuredConcurrencyOptions,
  createNodeUnstructuredFetch,
} from "./parser-options";
import { createPdfParserPreflight } from "./pdf-parser-preflight";

// Parser routing/timeout tests use tiny transport fixtures. Real PDF inspection, child process
// limits and page geometry are exercised independently in pdf-parser-preflight.test.ts.
vi.mock("./pdf-parser-preflight", () => ({
  createPdfParserPreflight: vi.fn(() => ({
    check: vi.fn(async () => {}),
    policyFingerprint: "pdf-preflight-test",
  })),
}));

const encoder = new TextEncoder();

function ordinaryDocx(): Uint8Array {
  // Real deflated OOXML ZIP, generated with fflate.zipSync (fixed mtime), containing
  // [Content_Types].xml, _rels/.rels and a one-paragraph word/document.xml.
  return new Uint8Array(
    Buffer.from(
      "UEsDBBQAAAAIAACYn090JJxTuwAAAD4BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbJWQuQ7CMAyGX6XKiqgRAwNquwArMPACVuq2EbkUm+vtSTk6sDHa//FZrk6PSFzcnfVcq0EkrgFYD+SQyxDJZ6ULyaHkMfUQUZ+xJ1guFivQwQt5mcvYoZpqSx1erBS7e16zCb5WiSyrYvM2jqxaYYzWaJSsw9W3P5T5h1Dm5MvDg4k8ywYFTXW4UkqmpeKISfboch3cQmqhDfriMqIcjX/xQtcZTVN+bIspaGI2vne2nBSHxn/vgNfbmidQSwMEFAAAAAgAAJifT2F7L0OIAAAA8gAAAAsAAABfcmVscy8ucmVsc43POQ7CMBAF0KtEPkAmUFCg2BVNWsQFLHu8iHjReBBwe1xQEERBOYve15/PuGqOJbcQaxseac1NisBcjwDNBEy6jaVi7hdXKGnuI3mo2ly1R9hP0wHo0xBqYw6LlYIWuxPD5VnxH7s4Fw2eirklzPwj4uujy5o8shT3Qhbsez12VoCaYVNRvQBQSwMEFAAAAAgAAJifT/fkxAV3AAAAowAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDWNXQ6DIAyAr2I8wGr2sAfiuMLOwIApiW1JYUFvb4nx5evf13ZuJrD/Y6Q67LhRMe09rrVmA1D8GtGVB+dIOvuxoKtaygKNJWRhH0tJtOAGz2l6AbpEo9WTXw5Hj7lDOqr9SEjk5BjufzP0dqcaSpWV16omt2ZPUEsBAhQAFAAAAAgAAJifT3QknFO7AAAAPgEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACAAAmJ9PYXsvQ4gAAADyAAAACwAAAAAAAAAAAAAAAADsAAAAX3JlbHMvLnJlbHNQSwECFAAUAAAACAAAmJ9P9+TEBXcAAACjAAAAEQAAAAAAAAAAAAAAAACdAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAQwIAAAAA",
      "base64",
    ),
  );
}

describe("createApiDocumentParser", () => {
  it("includes the configured provider semantic revision in checkpoint identity", () => {
    const input = {
      body: ordinaryDocx(),
      documentAssetId: "00000000-0000-4000-8000-000000000001",
      filename: "a.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      version: 1,
    };
    const make = (revision: string) =>
      createApiDocumentParser({
        env: {
          UNSTRUCTURED_API_URL: "https://parser.example.test",
          UNSTRUCTURED_BACKEND_REVISION: revision,
        },
      });
    expect(make("parser-policy-v1").policyFingerprint?.(input)).not.toBe(
      make("parser-policy-v2").policyFingerprint?.(input),
    );
  });
  it("keeps a structured upload above 10 MiB on the native parser within the 15 MiB admission limit", async () => {
    const fetch = vi.fn(async () => new Response("[]"));
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_API_URL: "https://unstructured.example.test" },
      fetch,
    });
    const artifact = await parser.parse({
      body: encoder.encode(`${" ".repeat(10 * 1024 * 1024)}{"id":9007199254740993}`),
      documentAssetId: "00000000-0000-4000-8000-000000000001",
      filename: "large.json",
      mimeType: "application/json",
      version: 1,
    });
    expect(artifact.metadata.routedParser).toBe("native-structured");
    expect(artifact.metadata.parserExecution).toMatchObject({ isolation: "child-process" });
    expect(artifact.elements[0]?.text).toContain("9007199254740993");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies a configured input limit to native structured parsing even without a remote endpoint", async () => {
    const parser = createApiDocumentParser({ env: { UNSTRUCTURED_MAX_INPUT_BYTES: "8" } });
    await expect(
      parser.parse({
        body: encoder.encode('{"value":123}'),
        documentAssetId: "00000000-0000-4000-8000-000000000001",
        filename: "data.json",
        mimeType: "application/json",
        version: 1,
      }),
    ).rejects.toThrow("maxInputBytes=8");
  });

  it("always runs PDF safety inspection before the configured remote transport", async () => {
    const check = vi.fn(async () => {
      throw new ProviderInputError("PDF page 1 exceeds the raster pixel budget");
    });
    vi.mocked(createPdfParserPreflight).mockReturnValueOnce({
      check,
      policyFingerprint: "pdf-preflight-test",
    });
    const fetch = vi.fn(async () => new Response("[]"));
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_API_URL: "https://unstructured.example.test" },
      fetch,
    });

    await expect(
      parser.parse({
        body: encoder.encode("%PDF-1.7"),
        documentAssetId: "00000000-0000-4000-8000-000000000001",
        filename: "80x180cm.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "provider_input", retryable: false });
    expect(check).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

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

  it("preserves native CSV semantics for an admitted 11 MiB structured upload", async () => {
    let fetchCalls = 0;
    const parser = createApiDocumentParser({
      env: { UNSTRUCTURED_API_URL: "https://unstructured.example.test" },
      fetch: async () => {
        fetchCalls += 1;
        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    });

    const artifact = await parser.parse({
      body: encoder.encode(`${"\n".repeat(11 * 1024 * 1024)}name\nAda`),
      documentAssetId: "00000000-0000-4000-8000-000000000020",
      filename: "large.csv",
      mimeType: "text/csv",
      version: 1,
    });

    expect(fetchCalls).toBe(0);
    expect(artifact).toMatchObject({
      metadata: { routeReason: "structured-file-type", routedParser: "native-structured" },
      parser: "native-structured",
    });
    expect(artifact.elements[0]?.text).toBe("name: Ada");
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
