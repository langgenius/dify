import { describe, expect, it, vi } from "vitest";

import { ProviderInputError, createUnstructuredParserClient } from "./index";

const input = {
  body: new TextEncoder().encode("%PDF-1.7"),
  documentAssetId: "00000000-0000-4000-8000-000000000001",
  filename: "banner.pdf",
  mimeType: "application/pdf",
  version: 1,
};

describe("Unstructured request preflight", () => {
  it("treats the provider raster guard as terminal input failure before inline retries", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          detail:
            "PDF page would render to too many pixels for safe processing: page=1, pixels=273439296, maximum=25000000. Try splitting the PDF, reducing the page dimensions, or using a lower render DPI.",
        },
        { status: 500 },
      ),
    );
    const parser = createUnstructuredParserClient({
      endpoint: "https://parser.example.test",
      fetch,
      maxRetries: 3,
      retryDelayMs: 0,
    });
    await expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_input",
      retryable: false,
      requestOutcomeAmbiguous: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects unsafe pages without sending or retrying a provider request", async () => {
    const fetch = vi.fn(async () => new Response("[]"));
    const check = vi.fn(async () => {
      throw new ProviderInputError("PDF page 1 exceeds the raster pixel budget");
    });
    const parser = createUnstructuredParserClient({
      endpoint: "https://parser.example.test",
      fetch,
      maxRetries: 3,
      requestPreflight: { check },
    });

    await expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_input",
      requestOutcomeAmbiguous: false,
      retryable: false,
    });
    expect(check).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("coalesces preflight with identical requests and preserves the original provider input", async () => {
    let finishPreflight = () => {};
    const waiting = new Promise<void>((resolve) => {
      finishPreflight = resolve;
    });
    const check = vi.fn(async () => waiting);
    const fetch = vi.fn(async (request: RequestInfo | URL) => {
      if (!(request instanceof Request)) throw new Error("Expected a Request");
      const form = await request.formData();
      const file = form.get("files");
      if (!(file instanceof File)) throw new Error("Expected original file");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(input.body);
      expect(form.get("strategy")).toBe("hi_res");
      return new Response("[]");
    });
    const parser = createUnstructuredParserClient({
      endpoint: "https://parser.example.test",
      fetch,
      requestPreflight: { check },
    });
    const imageInput = { ...input, parserHints: { requiresImages: true } };
    const first = parser.parse(imageInput);
    const second = parser.parse(imageInput);
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    finishPreflight();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels before transport and releases admission for the next file", async () => {
    let notifyStarted = () => {};
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const controller = new AbortController();
    const check = vi.fn(async (candidate: typeof input & { signal?: AbortSignal }) => {
      if (candidate.filename !== "banner.pdf") return;
      notifyStarted();
      await new Promise<void>((_, reject) => {
        candidate.signal?.addEventListener("abort", () => reject(candidate.signal?.reason), {
          once: true,
        });
      });
    });
    const fetch = vi.fn(async () => new Response("[]"));
    const parser = createUnstructuredParserClient({
      endpoint: "https://parser.example.test",
      fetch,
      maxConcurrency: 1,
      requestPreflight: { check },
    });
    const first = parser.parse({ ...input, signal: controller.signal });
    const rejected = expect(first).rejects.toThrow("Import canceled");
    await started;
    controller.abort(new Error("Import canceled"));
    await rejected;
    await parser.parse({ ...input, filename: "ordinary.pdf", version: 2 });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
