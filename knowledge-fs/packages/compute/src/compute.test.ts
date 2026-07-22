import type { EvidenceBundle, ParseArtifact } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createTypeScriptComputeRuntime } from "./index";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const evidenceBundleId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const nodeA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const nodeB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const nodeC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const artifactHash = "a".repeat(64);

describe("createTypeScriptComputeRuntime", () => {
  const runtime = createTypeScriptComputeRuntime();

  describe("token counting", () => {
    it("matches the deterministic Latin, CJK, punctuation, and grapheme rules", () => {
      expect(runtime.countTokens("unbelievable")).toBe(3);
      expect(runtime.countApproxTokens("KnowledgeFS parses documents.")).toBe(8);
      expect(runtime.countTokens("café mañana")).toBe(2);
      expect(runtime.countTokens("知识库检索")).toBe(5);
      expect(runtime.countTokens("Hello 世界! 🚀")).toBe(5);
      expect(runtime.countTokens("👨‍👩‍👧‍👦")).toBe(1);
      expect(runtime.countTokens("")).toBe(0);
      expect(
        runtime.countTokens(
          [0x3400, 0xf900, 0x20000, 0x2a700, 0x2b740, 0x2b820, 0x2ceb0, 0x30000]
            .map((codePoint) => String.fromCodePoint(codePoint))
            .join(" "),
        ),
      ).toBe(8);
    });

    it("enforces the fixed 10 MiB UTF-8 input boundary", () => {
      expect(() => runtime.countTokens("x".repeat(10 * 1024 * 1024 + 1))).toThrow(
        "token input exceeds maxInputBytes=10485760",
      );
    });
  });

  describe("fixed Unicode 17 segmentation", () => {
    it("matches Rust unicode-segmentation 1.13.2 golden words and graphemes", () => {
      const golden = [
        {
          graphemes: ["知", "识", "库", "检", "索"],
          text: "知识库检索",
          words: ["知", "识", "库", "检", "索"],
        },
        {
          graphemes: ["日", "本", "語", "カ", "タ", "カ", "ナ", "ひ", "ら", "が", "な"],
          text: "日本語カタカナひらがな",
          words: ["日", "本", "語", "カタカナ", "ひ", "ら", "が", "な"],
        },
        {
          graphemes: ["ภ", "า", "ษ", "า", "ไ", "ท", "ย", "ท", "ด", "ส", "อ", "บ"],
          text: "ภาษาไทยทดสอบ",
          words: ["ภ", "า", "ษ", "า", "ไ", "ท", "ย", "ท", "ด", "ส", "อ", "บ"],
        },
        {
          graphemes: ["c", "a", "f", "é", " ", "n", "a", "ï", "v", "e"],
          text: "café naïve",
          words: ["café", "naïve"],
        },
        {
          graphemes: ["c", "a", "n", "'", "t", " ", "c", "a", "n", "’", "t"],
          text: "can't can’t",
          words: ["can't", "can’t"],
        },
        {
          graphemes: ["3", "2", ".", "3", " ", "3", ",", "4", "5", "6", ".", "7", "8", "9"],
          text: "32.3 3,456.789",
          words: ["32.3", "3,456.789"],
        },
        {
          graphemes: ["h", "i", "👨‍👩‍👧‍👦", "🇺🇸"],
          text: "hi👨‍👩‍👧‍👦🇺🇸",
          words: ["hi"],
        },
        {
          // U+10940/U+10941 were assigned in Unicode 17 and are ALetter in Rust's table.
          graphemes: ["𐥀", "𐥁"],
          text: "𐥀𐥁",
          words: ["𐥀𐥁"],
        },
      ];

      for (const item of golden) {
        const diff = runtime.diffText({
          config: { mode: "word" },
          newText: item.text,
          oldText: "",
        });
        expect(diff.operations.map(({ text }) => text)).toEqual([item.words.join(" ")]);
        expect(diff.stats.insert).toBe(item.words.length);
        const nodes = runtime.chunkParseArtifact({
          config: { maxChunkChars: 1, overlapChars: 0 },
          knowledgeSpaceId,
          parseArtifact: artifact([paragraph(item.text)]),
        });
        expect(nodes.map(({ text }) => text)).toEqual(item.graphemes);
      }
    });
  });

  describe("parse-artifact chunking", () => {
    it("groups one section and emits the stable KnowledgeNode shape and UUID v5", () => {
      const nodes = runtime.chunkParseArtifact({
        config: { maxChunkChars: 120, overlapChars: 0 },
        knowledgeSpaceId,
        parseArtifact: artifact([
          {
            id: "element-1",
            metadata: {},
            pageNumber: 2,
            sectionPath: ["Overview"],
            text: "KnowledgeFS exposes agent-readable evidence.",
            type: "paragraph",
          },
        ]),
        permissionScope: ["tenant:tenant-1"],
      });

      expect(nodes).toEqual([
        {
          artifactHash,
          documentAssetId,
          endOffset: 44,
          id: "d5fbff7c-af51-5c03-b83b-9fbd70e1830b",
          kind: "chunk",
          knowledgeSpaceId,
          metadata: {
            chunkIndex: 0,
            elementIds: ["element-1"],
            elementSeparator: "\n",
            elementTypes: ["paragraph"],
            offsetEncoding: "utf-8-bytes",
            textNormalization: "unicode-whitespace-trim",
          },
          parseArtifactId,
          permissionScope: ["tenant:tenant-1"],
          sourceLocation: {
            endOffset: 44,
            pageNumber: 2,
            sectionPath: ["Overview"],
            startOffset: 0,
          },
          startOffset: 0,
          text: "KnowledgeFS exposes agent-readable evidence.",
        },
      ]);
    });

    it("normalizes Unicode whitespace and reports half-open UTF-8 byte offsets", () => {
      const nodes = runtime.chunkParseArtifact({
        config: { maxChunkChars: 120, overlapChars: 0 },
        knowledgeSpaceId,
        parseArtifact: artifact([
          {
            id: "heading",
            metadata: {},
            sectionPath: ["指南"],
            text: " \u3000标题🚀 \n",
            type: "heading",
          },
          {
            id: "empty",
            metadata: {},
            sectionPath: ["指南"],
            text: " \u3000\t",
            type: "paragraph",
          },
          {
            id: "page-break",
            metadata: {},
            sectionPath: ["指南"],
            type: "page-break",
          },
          {
            id: "body",
            metadata: {},
            sectionPath: ["指南"],
            text: "\t内容🙂  ",
            type: "paragraph",
          },
        ]),
      });

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({ endOffset: 21, startOffset: 0, text: "标题🚀\n内容🙂" });
      expect(nodes[0]?.sourceLocation).toMatchObject({ endOffset: 21, startOffset: 0 });
    });

    it("splits extended graphemes with overlap while preserving UTF-8 offsets", () => {
      const nodes = runtime.chunkParseArtifact({
        config: { maxChunkChars: 3, overlapChars: 1 },
        knowledgeSpaceId,
        parseArtifact: artifact([
          {
            id: "unicode",
            metadata: {},
            sectionPath: ["Unicode"],
            text: "a😀b😀c😀d",
            type: "paragraph",
          },
        ]),
      });

      expect(nodes.map(({ text }) => text)).toEqual(["a😀b", "b😀c", "c😀d"]);
      expect(nodes.map(({ startOffset, endOffset }) => [startOffset, endOffset])).toEqual([
        [0, 6],
        [5, 11],
        [10, 16],
      ]);
      expect(nodes.map(({ id }) => id)).toEqual([
        "d5fbff7c-af51-5c03-b83b-9fbd70e1830b",
        "24d2797f-71fa-5383-bfc5-a6e1f57d5eb0",
        "604d299e-128e-516e-a490-11e2e40fb904",
      ]);
    });

    it("does not merge sections and preserves image/table metadata", () => {
      const nodes = runtime.chunkParseArtifact({
        config: { maxChunkChars: 120, overlapChars: 0 },
        knowledgeSpaceId,
        parseArtifact: artifact([
          {
            id: "alpha",
            metadata: {},
            sectionPath: ["Alpha"],
            text: "Alpha paragraph.",
            type: "paragraph",
          },
          {
            id: "image",
            metadata: {
              assetRef: { objectKey: "space/chart.png" },
              caption: "Chart",
              ignored: "not copied",
              ocrText: "Revenue 12%",
            },
            pageNumber: 3,
            sectionPath: ["Media"],
            text: "Chart\nRevenue 12%",
            type: "image",
          },
          {
            id: "table",
            metadata: { table: { columns: 2 }, textAsHtml: "<table />" },
            sectionPath: ["Metrics"],
            text: "Metric | Value",
            type: "table",
          },
          {
            id: "beta",
            metadata: {},
            sectionPath: ["Beta"],
            text: "Beta paragraph.",
            type: "paragraph",
          },
        ]),
      });

      expect(nodes.map(({ kind }) => kind)).toEqual(["chunk", "image", "table", "chunk"]);
      expect(nodes[1]?.metadata).toMatchObject({
        assetRef: { objectKey: "space/chart.png" },
        caption: "Chart",
        ocrText: "Revenue 12%",
      });
      expect(nodes[1]?.metadata).not.toHaveProperty("ignored");
      expect(nodes[2]?.metadata).toMatchObject({ table: { columns: 2 }, textAsHtml: "<table />" });
    });

    it("returns independent output objects and enforces all configured bounds", () => {
      const input = {
        config: { maxChunkChars: 120, overlapChars: 0 },
        knowledgeSpaceId,
        parseArtifact: artifact([paragraph("Stable chunks keep stable ids.")]),
      };
      const first = runtime.chunkParseArtifact(input);
      const firstNode = first[0];
      if (!firstNode) throw new Error("Expected a chunk");
      firstNode.metadata.changed = true;
      expect(runtime.chunkParseArtifact(input)[0]?.metadata).not.toHaveProperty("changed");

      expect(() =>
        runtime.chunkParseArtifact({ ...input, config: { maxChunkChars: 4, overlapChars: 4 } }),
      ).toThrow("overlapChars must be less than maxChunkChars");
      expect(() => runtime.chunkParseArtifact({ ...input, config: { maxInputBytes: 32 } })).toThrow(
        "chunk input exceeds maxInputBytes=32",
      );
      expect(() =>
        runtime.chunkParseArtifact({
          ...input,
          config: { maxElements: 1 },
          parseArtifact: artifact([paragraph("One"), paragraph("Two", "element-2")]),
        }),
      ).toThrow("parse artifact exceeds maxElements=1");
      expect(() =>
        runtime.chunkParseArtifact({
          ...input,
          config: { maxChunkChars: 1, maxNodes: 2, overlapChars: 0 },
          parseArtifact: artifact([paragraph("abcd")]),
        }),
      ).toThrow("chunk output exceeds maxNodes=2");
    });

    it("flushes a same-section group at the chunk limit and omits a mixed page number", () => {
      const nodes = runtime.chunkParseArtifact({
        config: { maxChunkChars: 9, overlapChars: 0 },
        knowledgeSpaceId,
        parseArtifact: artifact([
          { ...paragraph("abcd", "one"), pageNumber: 1 },
          { ...paragraph("efgh", "two"), pageNumber: 2 },
          { ...paragraph("ijkl", "three"), pageNumber: 2 },
        ]),
      });

      expect(nodes.map(({ text }) => text)).toEqual(["abcd\nefgh", "ijkl"]);
      expect(nodes[0]?.sourceLocation).not.toHaveProperty("pageNumber");
      expect(nodes[1]?.sourceLocation.pageNumber).toBe(2);
    });
  });

  describe("text diff", () => {
    it("produces the same stable line LCS ranges and tie ordering", () => {
      expect(
        runtime.diffText({
          config: { mode: "line" },
          newText: "alpha\ngamma\ndelta",
          oldText: "alpha\nbeta\ndelta",
        }),
      ).toEqual({
        operations: [
          { kind: "equal", newEnd: 1, newStart: 1, oldEnd: 1, oldStart: 1, text: "alpha" },
          { kind: "delete", oldEnd: 2, oldStart: 2, text: "beta" },
          { kind: "insert", newEnd: 2, newStart: 2, text: "gamma" },
          { kind: "equal", newEnd: 3, newStart: 3, oldEnd: 3, oldStart: 3, text: "delta" },
        ],
        stats: { delete: 1, equal: 2, insert: 1 },
      });
    });

    it("segments Unicode words and returns fresh operation objects", () => {
      const input = {
        config: { mode: "word" as const },
        newText: "hello brave café",
        oldText: "hello café",
      };
      const first = runtime.diffText(input);
      expect(first).toEqual({
        operations: [
          { kind: "equal", newEnd: 1, newStart: 1, oldEnd: 1, oldStart: 1, text: "hello" },
          { kind: "insert", newEnd: 2, newStart: 2, text: "brave" },
          { kind: "equal", newEnd: 3, newStart: 3, oldEnd: 2, oldStart: 2, text: "café" },
        ],
        stats: { delete: 0, equal: 2, insert: 1 },
      });
      const firstOperation = first.operations[0];
      if (!firstOperation) throw new Error("Expected a diff operation");
      firstOperation.text = "mutated";
      expect(runtime.diffText(input).operations[0]?.text).toBe("hello");
    });

    it("handles empty sides, empty lines, CRLF, and a standalone carriage return", () => {
      expect(runtime.diffText({ newText: "", oldText: "" })).toEqual({
        operations: [],
        stats: { delete: 0, equal: 0, insert: 0 },
      });
      expect(runtime.diffText({ newText: "added", oldText: "" })).toMatchObject({
        operations: [{ kind: "insert", text: "added" }],
        stats: { insert: 1 },
      });
      expect(runtime.diffText({ newText: "", oldText: "removed" })).toMatchObject({
        operations: [{ kind: "delete", text: "removed" }],
        stats: { delete: 1 },
      });
      expect(runtime.diffText({ newText: "\n", oldText: "\n" })).toEqual({
        operations: [{ kind: "equal", newEnd: 1, newStart: 1, oldEnd: 1, oldStart: 1, text: "" }],
        stats: { delete: 0, equal: 1, insert: 0 },
      });
      expect(
        runtime.diffText({ newText: "alpha\r\nbeta\n", oldText: "alpha\r\nbeta\n" }),
      ).toMatchObject({
        operations: [{ kind: "equal", text: "alpha\nbeta" }],
        stats: { equal: 2 },
      });
      expect(runtime.diffText({ newText: "alpha\r", oldText: "alpha\r" }).operations[0]?.text).toBe(
        "alpha\r",
      );
    });

    it("enforces input, token, matrix, config, and operation limits", () => {
      expect(() =>
        runtime.diffText({ config: { maxInputBytes: 16 }, newText: "small", oldText: "too large" }),
      ).toThrow("diff input exceeds maxInputBytes=16");
      expect(() =>
        runtime.diffText({ config: { maxTokens: 1 }, newText: "alpha", oldText: "alpha\nbeta" }),
      ).toThrow("diff token count exceeds maxTokens=1");
      expect(() =>
        runtime.diffText({
          config: { maxDiffCells: 128, maxTokens: 100 },
          newText: "beta",
          oldText: "alpha",
        }),
      ).toThrow("maxTokens must fit within maxDiffCells");
      expect(() =>
        runtime.diffText({ config: { maxDiffCells: 1 }, newText: "", oldText: "" }),
      ).toThrow("maxTokens must be at least 1");
      expect(() =>
        runtime.diffText({
          config: { maxOperations: 3 },
          newText: "alpha\ngamma\ndelta",
          oldText: "alpha\nbeta\ndelta",
        }),
      ).toThrow("diff operations exceed maxOperations=3");
      for (const config of [
        { maxDiffCells: 2_000_001 },
        { maxInputBytes: 10 * 1024 * 1024 + 1 },
        { maxOperations: 40_001 },
        { maxTokens: 1_414 },
      ]) {
        expect(() => runtime.diffText({ config, newText: "", oldText: "" })).toThrow();
      }
      expect(() =>
        runtime.diffText({
          config: { maxDiffCells: 121, maxTokens: 10, mode: "word" },
          newText: "word ".repeat(100_000),
          oldText: "",
        }),
      ).toThrow("diff token count exceeds maxTokens=10");
    });
  });

  describe("reciprocal-rank fusion", () => {
    it("weights, de-duplicates, sorts, and retains the first available payload", () => {
      expect(
        runtime.rrfFuse({
          config: { k: 60, limit: 3 },
          rankedLists: [
            {
              items: [
                { id: "node-a", payload: { source: "dense" } },
                { id: "node-b" },
                { id: "node-a", payload: { ignored: true } },
              ],
            },
            {
              items: [{ id: "node-b", payload: { source: "fts" } }, { id: "node-c" }],
              weight: 2,
            },
          ],
        }),
      ).toEqual([
        {
          id: "node-b",
          payload: { source: "fts" },
          ranks: [
            { listIndex: 0, rank: 2, weight: 1 },
            { listIndex: 1, rank: 1, weight: 2 },
          ],
          score: 1 / 62 + 2 / 61,
        },
        {
          id: "node-c",
          ranks: [{ listIndex: 1, rank: 2, weight: 2 }],
          score: 2 / 62,
        },
        {
          id: "node-a",
          payload: { source: "dense" },
          ranks: [{ listIndex: 0, rank: 1, weight: 1 }],
          score: 1 / 61,
        },
      ]);
    });

    it("returns independent values and enforces candidate bounds", () => {
      const input = { rankedLists: [{ items: [{ id: "node-a", payload: { source: "dense" } }] }] };
      const first = runtime.rrfFuse(input);
      const firstItem = first[0];
      if (!firstItem) throw new Error("Expected a fused item");
      firstItem.payload = { changed: true };
      firstItem.ranks[0] = { listIndex: 99, rank: 99, weight: 99 };
      expect(runtime.rrfFuse(input)[0]).toMatchObject({
        payload: { source: "dense" },
        ranks: [{ listIndex: 0, rank: 1, weight: 1 }],
      });
      expect(() =>
        runtime.rrfFuse({ config: { maxLists: 1 }, rankedLists: [{ items: [] }, { items: [] }] }),
      ).toThrow("rankedLists exceeds maxLists=1");
      expect(() =>
        runtime.rrfFuse({
          config: { maxItemsPerList: 1 },
          rankedLists: [{ items: [{ id: "a" }, { id: "b" }] }],
        }),
      ).toThrow("ranked list exceeds maxItemsPerList=1");
      expect(() =>
        runtime.rrfFuse({
          config: { limit: 1, maxOutputItems: 1 },
          rankedLists: [{ items: [{ id: "a" }, { id: "b" }] }],
        }),
      ).toThrow("RRF output candidates exceed maxOutputItems=1");
      expect(() => runtime.rrfFuse({ rankedLists: [{ items: [{ id: "   " }] }] })).toThrow(
        "ranked item id must be non-empty",
      );
    });

    it("uses UTF-8 byte ordering for score ties and handles repeated items without payloads", () => {
      expect(
        runtime
          .rrfFuse({
            rankedLists: [
              { items: [{ id: "b" }, { id: "shared", payload: { first: true } }] },
              { items: [{ id: "aa" }, { id: "shared" }] },
              { items: [{ id: "a" }] },
            ],
          })
          .filter(({ id }) => id !== "shared")
          .map(({ id }) => id),
      ).toEqual(["a", "aa", "b"]);
      expect(
        runtime.rrfFuse({
          rankedLists: [
            { items: [{ id: "without-payload" }] },
            { items: [{ id: "without-payload" }] },
          ],
        })[0],
      ).not.toHaveProperty("payload");
    });

    it("fails closed on non-finite accumulation while preserving finite underflow", () => {
      expect(() =>
        runtime.rrfFuse({
          config: { k: Number.MIN_VALUE },
          rankedLists: [
            { items: [{ id: "same" }], weight: Number.MAX_VALUE },
            { items: [{ id: "same" }], weight: Number.MAX_VALUE },
          ],
        }),
      ).toThrow("RRF score must remain finite");
      expect(
        runtime.rrfFuse({
          rankedLists: [{ items: [{ id: "tiny" }], weight: Number.MIN_VALUE }],
        })[0]?.score,
      ).toBe(0);
    });
  });

  describe("evidence packing", () => {
    it("packs in source order, numbers markers, and omits over-budget items", () => {
      const packed = runtime.packEvidence({
        evidenceBundle: evidenceBundle([
          evidence(parseArtifactId, " \t ", 0.95),
          evidence(nodeA, " alpha beta ", 0.9),
          evidence(nodeB, "this item has far too many tokens for the tiny budget", 0.8),
          evidence(nodeC, "gamma", 0.7),
        ]),
        model: "gpt-test",
        tokenBudget: 3,
      });

      expect(packed).toEqual({
        context: "[E1] alpha beta\n\n[E2] gamma",
        items: [
          expect.objectContaining({ marker: "E1", nodeId: nodeA, text: "alpha beta", tokens: 2 }),
          expect.objectContaining({ marker: "E2", nodeId: nodeC, text: "gamma", tokens: 1 }),
        ],
        model: "gpt-test",
        omitted: [{ nodeId: nodeB, reason: "token-budget", tokens: 11 }],
        tokenBudget: 3,
        usedTokens: 3,
      });
    });

    it("returns fresh citations and enforces item, context, and input limits", () => {
      const input = {
        evidenceBundle: evidenceBundle([evidence(nodeA, "alpha", 0.9)]),
        tokenBudget: 64,
      };
      const first = runtime.packEvidence(input);
      (first.items[0]?.citations[0] as Record<string, unknown>).changed = true;
      expect(runtime.packEvidence(input).items[0]?.citations[0]).not.toHaveProperty("changed");
      expect(() => runtime.packEvidence({ ...input, config: { maxInputBytes: 32 } })).toThrow(
        "evidence packing input exceeds maxInputBytes=32",
      );
      expect(() =>
        runtime.packEvidence({
          config: { maxItems: 1 },
          evidenceBundle: evidenceBundle([
            evidence(nodeA, "alpha", 0.9),
            evidence(nodeB, "beta", 0.8),
          ]),
          tokenBudget: 64,
        }),
      ).toThrow("evidence item count exceeds maxItems=1");
      expect(() => runtime.packEvidence({ ...input, config: { maxContextChars: 8 } })).toThrow(
        "packed evidence context exceeds maxContextChars=8",
      );
    });
  });

  describe("algorithm input validation", () => {
    it("rejects unpaired UTF-16 surrogates at every public boundary", () => {
      const unpairedHigh = "\ud800";
      const unpairedLow = "\udc00";
      expect(() => runtime.countTokens(unpairedHigh)).toThrow(
        "token input contains unpaired surrogate",
      );
      expect(() =>
        runtime.chunkParseArtifact({
          knowledgeSpaceId,
          parseArtifact: artifact([{ ...paragraph("valid"), metadata: { nested: unpairedLow } }]),
        }),
      ).toThrow("chunk input contains unpaired surrogate");
      expect(() => runtime.diffText({ newText: unpairedHigh, oldText: "valid" })).toThrow(
        "diff input contains unpaired surrogate",
      );
      expect(() =>
        runtime.rrfFuse({
          rankedLists: [{ items: [{ id: "valid", payload: { nested: unpairedLow } }] }],
        }),
      ).toThrow("RRF input contains unpaired surrogate");
      expect(() =>
        runtime.packEvidence({
          evidenceBundle: evidenceBundle([evidence(nodeA, unpairedHigh, 0.9)]),
          tokenBudget: 64,
        }),
      ).toThrow("evidence packing input contains unpaired surrogate");
    });

    it("bounds recursive validation depth and node count before serialization", () => {
      let deep: Record<string, unknown> = {};
      for (let depth = 0; depth < 130; depth += 1) deep = { child: deep };
      expect(() =>
        runtime.chunkParseArtifact({
          knowledgeSpaceId,
          parseArtifact: { ...artifact([paragraph("valid")]), metadata: deep },
        }),
      ).toThrow("chunk input exceeds validation depth=128");
      expect(() =>
        runtime.rrfFuse({
          rankedLists: [
            {
              items: [
                { id: "valid", payload: { values: Array.from({ length: 500_001 }, () => null) } },
              ],
            },
          ],
        }),
      ).toThrow("RRF input exceeds validation nodes=500000");
    });

    it("allows the complete default 20,000 ParseElement contract", () => {
      const elements = Array.from({ length: 20_000 }, (_, index) => ({
        id: `page-break-${index}`,
        metadata: {},
        sectionPath: [],
        type: "page-break" as const,
      }));
      expect(
        runtime.chunkParseArtifact({
          knowledgeSpaceId,
          parseArtifact: artifact(elements),
        }),
      ).toEqual([]);
    });
  });
});

function artifact(elements: ParseArtifact["elements"]): ParseArtifact {
  return {
    artifactHash,
    contentType: "text",
    createdAt: "2026-05-11T10:00:00.000Z",
    documentAssetId,
    elements,
    id: parseArtifactId,
    metadata: {},
    parser: "native-markdown",
    version: 1,
  };
}

function paragraph(text: string, id = "element-1"): ParseArtifact["elements"][number] {
  return { id, metadata: {}, sectionPath: ["Overview"], text, type: "paragraph" };
}

function evidenceBundle(items: EvidenceBundle["items"]): EvidenceBundle {
  return {
    createdAt: "2026-05-11T10:00:00.000Z",
    id: evidenceBundleId,
    items,
    missingEvidence: [],
    query: "What does KnowledgeFS expose?",
    state: "answerable",
  };
}

function evidence(nodeId: string, text: string, score: number): EvidenceBundle["items"][number] {
  return {
    citations: [
      {
        artifactHash,
        documentAssetId,
        documentVersion: 1,
        endOffset: 12,
        pageNumber: 1,
        sectionPath: ["Overview"],
        startOffset: 0,
      },
    ],
    conflicts: [],
    freshness: { status: "fresh" },
    metadata: {},
    nodeId,
    score,
    scores: { final: score, retrieval: score },
    text,
  };
}
