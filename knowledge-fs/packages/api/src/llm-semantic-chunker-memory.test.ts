import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("LLM semantic chunker memory admission", () => {
  it.each([false, true])(
    "preflights a production-sized spreadsheet under a 128 MiB heap (model-aware: %s)",
    (modelAware) => {
      const coreUrl = new URL("../../core/src/index.ts", import.meta.url).href;
      const chunkerUrl = new URL("./llm-semantic-chunker.ts", import.meta.url).href;
      const budgetUrl = new URL("./semantic-token-budget.ts", import.meta.url).href;
      const script = `
      import { ParseArtifactSchema } from ${JSON.stringify(coreUrl)};
      import { preflightLlmSemanticWindows } from ${JSON.stringify(chunkerUrl)};
      import { createSemanticTokenBudget } from ${JSON.stringify(budgetUrl)};
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
      const config = ${modelAware} ? { maxWindowChars: 200_000, tokenBudget: createSemanticTokenBudget({
        limits: { contextTokens: 131_072, maxOutputTokens: 32_768 },
        enableGraph: true, enablePageIndex: true, legacyWindowLayout: false,
      }) } : undefined;
      const result = preflightLlmSemanticWindows({ parseArtifact, config });
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
      expect(result.unitCount).toBe(526);
      if (modelAware) expect(result.maximumWindowCount).toBeLessThan(132);
      else expect(result.maximumWindowCount).toBe(132);
      expect(result.heapUsed).toBeLessThan(128 * 1024 * 1024);
    },
  );

  it.each([false, true])(
    "preflights 2,000 records without per-row schema copies (model-aware: %s)",
    (modelAware) => {
      const coreUrl = new URL("../../core/src/index.ts", import.meta.url).href;
      const chunkerUrl = new URL("./llm-semantic-chunker.ts", import.meta.url).href;
      const budgetUrl = new URL("./semantic-token-budget.ts", import.meta.url).href;
      const script = `
      import { ParseArtifactSchema } from ${JSON.stringify(coreUrl)};
      import { preflightLlmSemanticWindows } from ${JSON.stringify(chunkerUrl)};
      import { createSemanticTokenBudget } from ${JSON.stringify(budgetUrl)};
      const columns = ["time", "question", "detail", "severity", "resolved", "resolvedAt", "resolution"];
      const text = Array.from({ length: 2_000 }, (_, index) =>
        columns.map((column) => \`\${column}: value-\${index}\`).join(" | ")
      ).join("\\n");
      const parseArtifact = ParseArtifactSchema.parse({
        artifactHash: "b".repeat(64),
        contentType: "structured",
        createdAt: "2026-08-26T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        elements: [{
          id: "sheet-records",
          metadata: {
            table: {
              columns,
              headerRowCount: 1,
              mode: "record-list",
              recordCount: 2_000,
              semanticVersion: 1,
              sourceRowCount: 2_001,
            },
          },
          sectionPath: ["Issue Log"],
          text,
          type: "table",
        }],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        metadata: {},
        parser: "unstructured",
        version: 1,
      });
      const config = ${modelAware} ? { maxWindowChars: 200_000, tokenBudget: createSemanticTokenBudget({
        limits: { contextTokens: 131_072, maxOutputTokens: 32_768 },
        enableGraph: true, enablePageIndex: true, legacyWindowLayout: false,
      }) } : undefined;
      const result = preflightLlmSemanticWindows({ parseArtifact, config });
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
      expect(result.unitCount).toBe(2_000);
      if (modelAware) expect(result.maximumWindowCount).toBeLessThan(65);
      else expect(result.maximumWindowCount).toBe(65);
      expect(result.heapUsed).toBeLessThan(128 * 1024 * 1024);
    },
  );
});
