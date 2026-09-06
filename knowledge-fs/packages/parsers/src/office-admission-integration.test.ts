import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { createUnstructuredParserClient } from "./index";

const identity = { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44", version: 1 };
const spreadsheetMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("Office resource admission at the provider boundary", () => {
  it("rejects tiny sparse workbooks before the provider or retries and releases the admission slot", async () => {
    const fetch = vi.fn(async () => Response.json([{ type: "NarrativeText", text: "retained" }]));
    const parser = createUnstructuredParserClient({
      endpoint: "https://parser.invalid",
      fetch,
      maxRetries: 3,
      maxConcurrency: 1,
    });
    const rejected = {
      ...identity,
      filename: "sparse.xlsx",
      mimeType: spreadsheetMime,
      body: zipSync({
        "xl/worksheets/sheet1.xml": strToU8(
          '<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>',
        ),
      }),
    };
    await expect(parser.parse(rejected)).rejects.toMatchObject({
      code: "provider_input",
      retryable: false,
      requestOutcomeAmbiguous: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    const artifact = await parser.parse({
      ...rejected,
      version: 2,
      body: zipSync({
        "xl/worksheets/sheet1.xml": strToU8(
          '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
        ),
      }),
    });
    expect(artifact.elements[0]?.text).toBe("retained");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["docx", "pptx", "odt", "epub"])(
    "rejects oversized XML structure in %s before sending it",
    async (extension) => {
      const fetch = vi.fn(async () => Response.json([]));
      const parser = createUnstructuredParserClient({ endpoint: "https://parser.invalid", fetch });
      await expect(
        parser.parse({
          ...identity,
          filename: `deep.${extension}`,
          mimeType: "application/octet-stream",
          body: zipSync({
            "content.xml": strToU8("<document>".repeat(129) + "</document>".repeat(129)),
          }),
        }),
      ).rejects.toMatchObject({ code: "provider_input", retryable: false });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps ordinary archive bytes and provider extraction options unchanged", async () => {
    const body = zipSync({
      "word/document.xml": strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const fetch = vi.fn(async (request: RequestInfo | URL) => {
      if (!(request instanceof Request)) throw new Error("Expected Request");
      const form = await request.formData();
      const file = form.get("files");
      if (!(file instanceof File)) throw new Error("Expected file");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(body);
      expect(form.get("strategy")).toBe("auto");
      return Response.json([{ type: "NarrativeText", text: "hello" }]);
    });
    const parser = createUnstructuredParserClient({ endpoint: "https://parser.invalid", fetch });
    const artifact = await parser.parse({
      ...identity,
      body,
      filename: "ordinary.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(artifact.elements[0]?.text).toBe("hello");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
