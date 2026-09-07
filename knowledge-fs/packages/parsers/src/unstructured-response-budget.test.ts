import { afterEach, describe, expect, it, vi } from "vitest";

import { createUnstructuredParserClient } from "./index";

vi.mock("./parser-resource-budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parser-resource-budget")>();
  return {
    ...actual,
    parserResourceLimits: {
      ...actual.parserResourceLimits,
      // Allow the bounded artifact-level provenance/coverage envelope as well as elements.
      maxArtifactNodes: 64,
      maxRawElements: 3,
    },
  };
});

const input = {
  body: new TextEncoder().encode("%PDF-1.4\n"),
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  filename: "raw-response.pdf",
  mimeType: "application/pdf",
  version: 1,
};

function parserFor(body: string) {
  return createUnstructuredParserClient({
    endpoint: "http://parser.invalid",
    fetch: async () => new Response(body),
  });
}

describe("provider response admission before normalization", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects excessive raw elements even when normalization would discard them all", async () => {
    await expect(parserFor("[{},{},{},{}]").parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("admits the raw-element boundary without changing normal output filtering", async () => {
    const artifact = await parserFor("[{},{},{}]").parse(input);
    expect(artifact.elements).toEqual([]);
  });

  it("rejects excessive metadata nodes that output filtering would otherwise hide", async () => {
    const body = JSON.stringify([
      { metadata: { nested: Array.from({ length: 100 }, () => null) } },
    ]);
    await expect(parserFor(body).parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("rejects excessive JSON depth before invoking the recursive decoder", async () => {
    const body = `[{"metadata":{"nested":${"[".repeat(129)}0${"]".repeat(129)}}}]`;
    const parser = parserFor(body);
    const decode = vi.spyOn(JSON, "parse");
    await expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it("keeps invalid JSON and invalid top-level shapes classified as provider responses", async () => {
    await expect(parserFor("[{]").parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
    await expect(parserFor('{"text":"not an element array"}').parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });
});
