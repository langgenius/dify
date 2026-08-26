import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("LLM semantic chunker memory admission", () => {
  it("preflights a production-sized spreadsheet artifact under a 128 MiB V8 heap", () => {
    const coreUrl = new URL("../../core/src/index.ts", import.meta.url).href;
    const chunkerUrl = new URL("./llm-semantic-chunker.ts", import.meta.url).href;
    const script = `
      import { ParseArtifactSchema } from ${JSON.stringify(coreUrl)};
      import { preflightLlmSemanticWindows } from ${JSON.stringify(chunkerUrl)};
      const text = "行数据字段值。".repeat(90_159);
      const html = \`<table>\${"x".repeat(797_511)}</table>\`;
      const parseArtifact = ParseArtifactSchema.parse({
        artifactHash: "a".repeat(64),
        contentType: "structured",
        createdAt: "2026-08-26T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        elements: [{
          id: "sheet-1",
          metadata: { table: { html }, textAsHtml: html, text_as_html: html },
          sectionPath: ["知识库"],
          text,
          type: "table",
        }],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        metadata: {},
        parser: "unstructured",
        version: 1,
      });
      const result = preflightLlmSemanticWindows({ parseArtifact });
      console.log(JSON.stringify({ ...result, heapUsed: process.memoryUsage().heapUsed }));
    `;
    const completed = spawnSync(
      process.execPath,
      ["--max-old-space-size=128", "--import", "tsx", "--input-type=module", "-e", script],
      { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 15_000 },
    );

    expect(completed.status, completed.stderr).toBe(0);
    const result = JSON.parse(completed.stdout.trim()) as {
      heapUsed: number;
      maximumWindowCount: number;
      unitCount: number;
    };
    expect(result).toMatchObject({ maximumWindowCount: 132, unitCount: 526 });
    expect(result.heapUsed).toBeLessThan(128 * 1024 * 1024);
  });
});
