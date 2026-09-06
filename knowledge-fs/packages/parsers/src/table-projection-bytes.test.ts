import { describe, expect, it, vi } from "vitest";

import { createNativeMarkdownParser, createUnstructuredParserClient } from "./index";

vi.mock("./parser-resource-budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parser-resource-budget")>();
  return {
    ...actual,
    parserResourceLimits: { ...actual.parserResourceLimits, maxOutputBytes: 64 },
  };
});

const parse = (body: string) =>
  createNativeMarkdownParser().parse({
    body: new TextEncoder().encode(body),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    filename: "table.md",
    mimeType: "text/markdown",
    version: 1,
  });

describe("table projection byte admission", () => {
  it("classifies provider table expansion as a terminal invalid provider response", async () => {
    const parser = createUnstructuredParserClient({
      endpoint: "https://parser.invalid",
      fetch: async () =>
        Response.json([
          {
            type: "Table",
            text: "table",
            metadata: { text_as_html: `<table><tr><td>${"中".repeat(30)}</td></tr></table>` },
          },
        ]),
    });
    await expect(
      parser.parse({
        body: new TextEncoder().encode("%PDF-1.4"),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        filename: "provider.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "provider_response_invalid", retryable: false });
  });
  it("counts header-only UTF-8 output before joining the labels", async () => {
    await expect(
      parse(`| ${"中".repeat(12)} | ${"文".repeat(12)} |\n| --- | --- |`),
    ).rejects.toMatchObject({ code: "provider_input", retryable: false });
  });
  it("counts repeated column labels before joining data rows", async () => {
    await expect(
      parse(`| ${"中".repeat(8)} |\n| --- |\n| one |\n| two |\n| three |`),
    ).rejects.toMatchObject({ code: "provider_input", retryable: false });
  });
  it("keeps a normal table within the byte limit unchanged", async () => {
    const artifact = await parse("| name | score |\n| --- | --- |\n| Ada | 2 |");
    expect(artifact.elements[0]?.text).toBe("name: Ada | score: 2");
  });
});
