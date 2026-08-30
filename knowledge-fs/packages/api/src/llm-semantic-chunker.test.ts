import {
  type KnowledgeNode,
  KnowledgeNodeSchema,
  type KnowledgeSpaceModelSelection,
  KnowledgeSpaceRetrievalProfileSchema,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";
import { countGraphemes } from "unicode-segmenter/grapheme";
import { describe, expect, it } from "vitest";

import { createInMemoryDocumentSemanticWindowCheckpointRepository } from "./document-semantic-window-checkpoint-repository";

import {
  DEFAULT_MAX_SEMANTIC_WINDOWS,
  type LlmSemanticCompletionCatalogEntry,
  type LlmSemanticWindowManifestEntry,
  type SemanticChunkingLlmProvider,
  type SemanticChunkingLlmStreamInput,
  assertValidLlmSemanticGenerationReplay,
  assertValidLlmSemanticWindowManifestReplay,
  createLlmSemanticChunker,
  hasValidLlmSemanticJointExtraction,
  llmSemanticCompletionFingerprint,
  preflightLlmSemanticWindows,
} from "./llm-semantic-chunker";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const DOCUMENT_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const PARSE_ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const GENERATION_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const GENERATION_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

interface PromptUnit {
  readonly boundaryPolicy?: "isolated";
  readonly graphemeLength: number;
  readonly id: string;
  readonly sourceElementId?: string;
  readonly sourceSectionPath?: readonly string[];
  readonly tableMode?: "matrix" | "record-list" | "single-record" | "unknown";
  readonly tableRecordCount?: number;
  readonly tableRecordIndex?: number;
  readonly tableSourceRowEnd?: number;
  readonly tableSourceRowStart?: number;
  readonly text: string;
  readonly type: string;
}

interface PromptTableSchema {
  readonly columns: readonly string[];
  readonly mode: "matrix" | "record-list" | "single-record" | "unknown";
  readonly recordCount: number;
  readonly sourceElementId: string;
}

interface PromptPayload {
  readonly atomicDocument?: boolean;
  readonly fixedCoreBoundary?: boolean;
  readonly lookAheadUnits?: readonly PromptUnit[];
  readonly sectionPath: readonly string[];
  readonly tableSchemas?: readonly PromptTableSchema[];
  readonly units: readonly PromptUnit[];
  readonly windowId: string;
}

type Script = (payload: PromptPayload) => unknown;

class ScriptedProvider implements SemanticChunkingLlmProvider {
  readonly calls: SemanticChunkingLlmStreamInput[] = [];
  readonly kind: string;
  private callIndex = 0;

  constructor(
    private readonly scripts: readonly Script[],
    private readonly terminal?:
      | {
          readonly finishReason?: string | undefined;
          readonly metadata?: unknown;
        }
      | undefined,
    kind = "test-plugin-daemon",
  ) {
    this.kind = kind;
  }

  async *stream(input: SemanticChunkingLlmStreamInput): AsyncIterable<{
    delta?: string;
    finishReason?: string;
    metadata?: unknown;
    type: "delta" | "done";
  }> {
    this.calls.push(input);
    const script = this.scripts[this.callIndex] ?? this.scripts.at(-1);
    this.callIndex += 1;
    if (!script) {
      throw new Error("Missing test response script");
    }
    const userMessage = input.messages.find((message) => message.role === "user");
    const payload = JSON.parse(userMessage?.content ?? "{}") as PromptPayload;
    const response = JSON.stringify(script(payload));
    const midpoint = Math.ceil(response.length / 2);
    yield { delta: response.slice(0, midpoint), type: "delta" };
    yield { delta: response.slice(midpoint), type: "delta" };
    yield {
      finishReason: this.terminal?.finishReason ?? "stop",
      metadata: this.terminal?.metadata ?? { model: input.model, provider: "plugin-daemon" },
      type: "done",
    };
  }
}

class BlockingEchoProvider implements SemanticChunkingLlmProvider {
  readonly calls: SemanticChunkingLlmStreamInput[] = [];
  readonly kind = "test-plugin-daemon";
  readonly saturated: Promise<void>;
  private active = 0;
  private releaseBlocked: (() => void) | undefined;
  private resolveSaturated: (() => void) | undefined;
  private readonly blocked: Promise<void>;
  maxActive = 0;

  constructor(private readonly expectedConcurrency: number) {
    this.saturated = new Promise<void>((resolve) => {
      this.resolveSaturated = resolve;
    });
    this.blocked = new Promise<void>((resolve) => {
      this.releaseBlocked = resolve;
    });
  }

  release(): void {
    this.releaseBlocked?.();
  }

  async *stream(input: SemanticChunkingLlmStreamInput): AsyncIterable<{
    delta?: string;
    finishReason?: string;
    metadata?: unknown;
    type: "delta" | "done";
  }> {
    this.calls.push(input);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.active === this.expectedConcurrency) this.resolveSaturated?.();
    try {
      await this.blocked;
      const userMessage = input.messages.find((message) => message.role === "user");
      const payload = JSON.parse(userMessage?.content ?? "{}") as PromptPayload;
      yield { delta: JSON.stringify(echoEachUnit(payload)), type: "delta" };
      yield {
        finishReason: "stop",
        metadata: { model: input.model, provider: "plugin-daemon" },
        type: "done",
      };
    } finally {
      this.active -= 1;
    }
  }
}

describe("LLM semantic chunker", () => {
  it("persists completed semantic windows and resumes after a later window fails", async () => {
    const checkpoints = createInMemoryDocumentSemanticWindowCheckpointRepository();
    const transient = new ScriptedProvider([
      echoEachUnit,
      () => {
        throw new Error("temporary model failure");
      },
    ]);
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "resume-paragraph",
          metadata: {},
          sectionPath: ["Resume"],
          text: "第一段。第二段。第三段。",
          type: "paragraph" as const,
        },
      ]),
      publicationGenerationId: GENERATION_A,
      retrievalProfile: profile(),
      tenantId: "tenant-1",
    };
    await expect(
      createLlmSemanticChunker({
        checkpoints,
        maxChunkChars: 4,
        maxConcurrentWindows: 2,
        maxWindowChars: 4,
        reasoningProviderFactory: () => transient,
      }).chunk(input),
    ).rejects.toThrow("temporary model failure");
    expect(transient.calls).toHaveLength(2);

    const resumed = new ScriptedProvider([echoEachUnit]);
    const nodes = await createLlmSemanticChunker({
      checkpoints,
      maxChunkChars: 4,
      maxWindowChars: 4,
      reasoningProviderFactory: () => resumed,
    }).chunk(input);

    expect(nodes.map((node) => node.text).join("")).toBe("第一段。第二段。第三段。");
    expect(resumed.calls).toHaveLength(2);
  });

  it("pushes disabled Graph and PageIndex capabilities into the model prompt", async () => {
    const provider = new ScriptedProvider([echoEachUnit]);
    await createLlmSemanticChunker({ reasoningProviderFactory: () => provider }).chunk({
      enableGraph: false,
      enablePageIndex: false,
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        { id: "flags", metadata: {}, sectionPath: ["Input"], text: "内容。", type: "paragraph" },
      ]),
      retrievalProfile: profile(),
      tenantId: "tenant-1",
    });

    const prompt = provider.calls[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("Graph extraction is disabled");
    expect(prompt).toContain("PageIndex is disabled");
    expect(prompt).toContain('"enableGraph":false');
    expect(prompt).toContain('"enablePageIndex":false');
  });

  it("uses the frozen reasoning selection and accepts semantic boundaries below the hard cap", async () => {
    const provider = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            endUnitId: units[1]?.id,
            entities: [
              {
                aliases: ["Policy A", "Policy A"],
                canonicalName: "Policy A",
                confidence: 0.96,
                id: "e-policy",
                text: "策略 A",
                type: "policy",
              },
              { confidence: 0.92, id: "e-product", text: "产品 B", type: "product" },
            ],
            relations: [
              {
                confidence: 0.9,
                objectEntityId: "e-product",
                subjectEntityId: "e-policy",
                type: "depends_on",
              },
            ],
            startUnitId: units[0]?.id,
          },
          {
            endUnitId: units[2]?.id,
            entities: [],
            relations: [],
            startUnitId: units[2]?.id,
          },
        ],
      }),
    ]);
    const selections: KnowledgeSpaceModelSelection[] = [];
    const chunker = createLlmSemanticChunker({
      now: () => "2026-07-19T12:00:00.000Z",
      reasoningProviderFactory: (selection) => {
        selections.push(selection);
        return provider;
      },
    });
    const nodes = await chunker.chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "paragraph-1",
          metadata: {},
          pageNumber: 2,
          sectionPath: ["Setup"],
          text: "  策略 A 已发布。策略 A 依赖产品 B。独立主题。  ",
          type: "paragraph",
        },
      ]),
      permissionScope: ["team:platform"],
      retrievalProfile: profile(),
      tenantId: "tenant-1",
    });

    expect(nodes).toHaveLength(2);
    expect(nodes.map((node) => node.text)).toEqual([
      "策略 A 已发布。策略 A 依赖产品 B。",
      "独立主题。",
    ]);
    expect(nodes[0]).toMatchObject({
      endOffset: new TextEncoder().encode("策略 A 已发布。策略 A 依赖产品 B。").byteLength,
      kind: "chunk",
      permissionScope: ["team:platform"],
      sourceLocation: { pageNumber: 2, sectionPath: ["Setup"], startOffset: 0 },
      startOffset: 0,
    });
    expect(nodes[0]?.metadata).toMatchObject({
      entityExtraction: {
        completed: true,
        entityCount: 2,
        model: "reasoner-model",
        promptVersion: "semantic-chunking-v6",
      },
      relationExtraction: { completed: true, relationCount: 1 },
      semanticChunking: {
        completed: true,
        completion: {
          actual: { finishReason: "stop", model: "reasoner-model", provider: "plugin-daemon" },
          requested: profile().reasoningModel,
        },
        documentChunkCount: 2,
        model: "reasoner-model",
        provider: "test-plugin-daemon",
        schemaVersion: 1,
        strategy: "llm-semantic-v1",
      },
    });
    expect(nodes[0]?.metadata.extractedRelations).toEqual([
      {
        confidence: 0.9,
        metadata: {
          objectEntityId: "e-product",
          source: "llm-semantic-chunking",
          subjectEntityId: "e-policy",
        },
        object: "产品 B",
        subject: "Policy A",
        type: "depends_on",
      },
    ]);
    expect(
      (nodes[0]?.metadata.extractedEntities as Array<{ metadata?: { aliases?: string[] } }>)[0]
        ?.metadata?.aliases,
    ).toEqual(["Policy A"]);
    expect(
      nodes.every(
        (node) =>
          (node.metadata.semanticChunking as { documentChunkCount?: number }).documentChunkCount ===
          2,
      ),
    ).toBe(true);
    expect(selections).toEqual([profile().reasoningModel]);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      model: "reasoner-model",
      temperature: 0,
      tenantId: "tenant-1",
    });
    expect(provider.calls[0]?.messages[0]?.content).toContain(
      "prefer natural topic boundaries over filling chunks",
    );
    expect(provider.calls[0]?.messages[0]?.content).toContain(
      "keep the complete list together under its heading",
    );
  });

  it("hard-splits an overlong sentence by Unicode grapheme without overlap", async () => {
    const provider = new ScriptedProvider([echoEachUnit]);
    const chunker = createLlmSemanticChunker({
      maxChunkChars: 3,
      maxWindowChars: 12,
      reasoningProviderFactory: () => provider,
    });
    const text = "A👨‍👩‍👧‍👦BCDE";
    const nodes = await chunker.chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "long-sentence",
          metadata: {},
          sectionPath: ["Unicode"],
          text,
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(nodes.map((node) => node.text)).toEqual(["A👨‍👩‍👧‍👦B", "CDE"]);
    expect(nodes.every((node) => countGraphemes(node.text) <= 3)).toBe(true);
    expect(nodes.map((node) => node.text).join("")).toBe(text);
    expect(nodes[0]?.endOffset).toBe(nodes[1]?.startOffset);
    expect(nodes[1]?.endOffset).toBe(new TextEncoder().encode(text).byteLength);
  });

  it("does not amplify large parser metadata across fragmented table units", async () => {
    const largeTableHtml = `<table>${"<tr><td>value</td></tr>".repeat(24_000)}</table>`;
    const text = Array.from(
      { length: 240 },
      (_, index) => `第 ${index + 1} 行 | 字段 ${index + 1} | 这是用于检索的表格内容`,
    ).join("\n");
    const parseArtifact = artifact([
      {
        id: "large-spreadsheet-table",
        metadata: {
          assetRef: { objectKey: "assets/spreadsheet-table.png" },
          table: { html: largeTableHtml },
          textAsHtml: largeTableHtml,
          title: "知识库",
        },
        sectionPath: ["知识库"],
        text,
        type: "table",
      },
    ]);
    const config = { maxChunkChars: 80, maxWindowChars: 320 } as const;
    const preflight = preflightLlmSemanticWindows({ config, parseArtifact });
    const provider = new ScriptedProvider([echoEachUnit]);
    const nodes = await createLlmSemanticChunker({
      ...config,
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(preflight.unitCount).toBeGreaterThan(20);
    expect(nodes).toHaveLength(preflight.unitCount);
    expect(nodes.map((node) => node.text).join("\n")).toBe(text);
    expect(nodes.at(-1)?.endOffset).toBe(new TextEncoder().encode(text).byteLength);
    for (const node of nodes) {
      expect(node.metadata).toMatchObject({
        assetRef: { objectKey: "assets/spreadsheet-table.png" },
        sourceMetadataProjection: {
          completeElement: false,
          omitted: [
            { field: "table", reason: "fragmented-source-element" },
            { field: "textAsHtml", reason: "fragmented-source-element" },
          ],
        },
        title: "知识库",
      });
      expect(node.metadata).not.toHaveProperty("table");
      expect(node.metadata).not.toHaveProperty("textAsHtml");
    }
  });

  it("records legacy overlap as unapplied provenance and keeps semantic chunks contiguous", async () => {
    const chunker = createLlmSemanticChunker({
      reasoningProviderFactory: () => new ScriptedProvider([echoEachUnit]),
    });
    const text = "Alpha. Beta.";
    const nodes = await chunker.chunk({
      config: { maxChunkChars: 20, overlapChars: 5 },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "legacy-overlap",
          metadata: {},
          sectionPath: ["Overlap"],
          text,
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(nodes).toHaveLength(2);
    expect(nodes.map((node) => node.text).join("")).toBe(text);
    expect(nodes[0]?.endOffset).toBe(nodes[1]?.startOffset);
    expect(nodes[0]?.metadata.semanticChunking).toMatchObject({
      overlapApplied: false,
      overlapPolicy: "non-overlapping-semantic-output",
      requestedOverlapChars: 5,
    });
  });

  it("batches source sections into one request while preserving table and image output boundaries", async () => {
    const provider = new ScriptedProvider([echoSemanticBoundaries]);
    const chunker = createLlmSemanticChunker({ reasoningProviderFactory: () => provider });
    const nodes = await chunker.chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "section-a",
          metadata: {},
          sectionPath: ["A"],
          text: "Section A.",
          type: "paragraph",
        },
        {
          id: "before-table",
          metadata: {},
          sectionPath: ["B"],
          text: "Before table.",
          type: "paragraph",
        },
        {
          id: "table-1",
          metadata: { table: { rows: 1 }, title: "Metrics" },
          sectionPath: ["B"],
          text: "Metric | Value",
          type: "table",
        },
        {
          id: "image-1",
          metadata: { assetRef: { objectKey: "assets/image.png" }, caption: "Architecture" },
          sectionPath: ["B"],
          text: "Architecture diagram",
          type: "image",
        },
        {
          id: "after-image-1",
          metadata: {},
          sectionPath: ["B"],
          text: "After image one.",
          type: "paragraph",
        },
        {
          id: "after-image-2",
          metadata: {},
          sectionPath: ["B"],
          text: "After image two.",
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(provider.calls).toHaveLength(1);
    const promptWindows = provider.calls.map((call) =>
      JSON.parse(call.messages.find((message) => message.role === "user")?.content ?? "{}"),
    ) as PromptPayload[];
    expect(promptWindows[0]?.units.map((unit) => unit.type)).toEqual([
      "paragraph",
      "paragraph",
      "table",
      "image",
      "paragraph",
      "paragraph",
    ]);
    expect(promptWindows[0]?.units.map((unit) => unit.sourceSectionPath)).toEqual([
      ["A"],
      ["B"],
      ["B"],
      ["B"],
      ["B"],
      ["B"],
    ]);
    expect(nodes.map((node) => node.kind)).toEqual(["chunk", "chunk", "table", "image", "chunk"]);
    expect(nodes[2]?.metadata).toMatchObject({ table: { rows: 1 }, title: "Metrics" });
    expect(nodes[3]?.metadata).toMatchObject({
      assetRef: { objectKey: "assets/image.png" },
      caption: "Architecture",
    });
    expect(nodes[4]?.text).toBe("After image one.\nAfter image two.");
    expect(nodes[2]?.metadata.semanticChunking).toMatchObject({
      sourceSpans: [
        {
          elementId: "table-1",
          elementType: "table",
          sectionPath: ["B"],
        },
      ],
      windowPlanning: {
        atomicDocument: false,
        sourceSectionPathCount: 2,
        version: "v6",
      },
    });
  });

  it("keeps an object-backed image indexable when the parser emits no text", async () => {
    const provider = new ScriptedProvider([echoSemanticBoundaries]);
    const chunker = createLlmSemanticChunker({ reasoningProviderFactory: () => provider });
    const nodes = await chunker.chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "image-only",
          metadata: { assetRef: { objectKey: "assets/image-only.png" } },
          sectionPath: [],
          type: "image",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(provider.calls).toHaveLength(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: "image",
      metadata: { assetRef: { objectKey: "assets/image-only.png" } },
      text: "Image",
    });
  });

  it("bounds compact parser units per request without invalidating v2 generation replay", async () => {
    const parseArtifact = artifact(
      Array.from({ length: 96 }, (_, index) => ({
        id: `compact-field-${index}`,
        metadata: {},
        sectionPath: ["Compact record"],
        text: `Field ${index}: value ${index}.`,
        type: "paragraph" as const,
      })),
    );
    const currentPreflight = preflightLlmSemanticWindows({ parseArtifact });
    const v2Preflight = preflightLlmSemanticWindows({
      parseArtifact,
      promptVersion: "semantic-chunking-v2",
    });
    const provider = new ScriptedProvider([echoEachUnit]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });
    const v2Provider = new ScriptedProvider([echoEachUnit]);
    const v2Nodes = await createLlmSemanticChunker({
      promptVersion: "semantic-chunking-v2",
      reasoningProviderFactory: () => v2Provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(currentPreflight).toEqual({ maximumWindowCount: 3, unitCount: 96 });
    expect(v2Preflight).toEqual({ maximumWindowCount: 1, unitCount: 96 });
    expect(provider.calls).toHaveLength(3);
    expect(v2Provider.calls).toHaveLength(1);
    const prompts = provider.calls.map((call) =>
      JSON.parse(call.messages.find((message) => message.role === "user")?.content ?? "{}"),
    ) as PromptPayload[];
    expect(prompts.every((prompt) => prompt.units.length <= 32)).toBe(true);
    expect(prompts.every((prompt) => (prompt.lookAheadUnits?.length ?? 0) <= 8)).toBe(true);
    expect(nodes.map((node) => node.text).join("\n")).toBe(
      parseArtifact.elements.map((element) => element.text?.trim() ?? "").join("\n"),
    );
    expect(nodes[0]?.metadata.semanticChunking).toMatchObject({
      windowPlanning: { version: "v6" },
    });
    expect(v2Nodes[0]?.metadata.semanticChunking).toMatchObject({
      windowPlanning: { version: "v2" },
    });
  });

  it("extends a fixed core boundary to keep a numbered list in one window", async () => {
    const parseArtifact = artifact([
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `preamble-${index}`,
        metadata: {},
        sectionPath: ["Preamble"],
        text: `Preamble ${index}.`,
        type: "paragraph" as const,
      })),
      {
        id: "list-heading",
        metadata: {},
        sectionPath: ["Negative list"],
        text: "施工企业安全穿透式管理负面清单",
        type: "paragraph" as const,
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `list-item-${index + 1}`,
        metadata: {},
        sectionPath: ["Negative list"],
        text: `${index + 1}. 第 ${index + 1} 项负面情形。`,
        type: "paragraph" as const,
      })),
    ]);
    const provider = new ScriptedProvider([echoEachUnit]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(preflightLlmSemanticWindows({ parseArtifact })).toEqual({
      maximumWindowCount: 1,
      unitCount: 43,
    });
    expect(provider.calls).toHaveLength(1);
    const prompt = JSON.parse(
      provider.calls[0]?.messages.find((message) => message.role === "user")?.content ?? "{}",
    ) as PromptPayload;
    expect(prompt.units).toHaveLength(43);
    expect(prompt.units.at(-1)?.text).toBe("第 9 项负面情形。");
    expect(nodes.map((node) => node.text).join("")).toBe(
      parseArtifact.elements.map((element) => element.text?.trim() ?? "").join(""),
    );
  });

  it("runs fixed-core semantic windows concurrently while preserving document order", async () => {
    const parseArtifact = artifact(
      Array.from({ length: 96 }, (_, index) => ({
        id: `parallel-field-${index}`,
        metadata: {},
        sectionPath: ["Parallel record"],
        text: `Field ${index}: value ${index}.`,
        type: "paragraph" as const,
      })),
    );
    const provider = new BlockingEchoProvider(2);
    const pending = createLlmSemanticChunker({
      maxConcurrentWindows: 2,
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    await provider.saturated;
    expect(provider.calls).toHaveLength(2);
    expect(provider.maxActive).toBe(2);
    provider.release();
    const nodes = await pending;

    expect(provider.calls).toHaveLength(3);
    expect(provider.maxActive).toBe(2);
    expect(
      provider.calls.every((call) => {
        const user = call.messages.find((message) => message.role === "user");
        return (JSON.parse(user?.content ?? "{}") as PromptPayload).fixedCoreBoundary === true;
      }),
    ).toBe(true);
    expect(nodes.map((node) => node.text).join("\n")).toBe(
      parseArtifact.elements.map((element) => element.text?.trim() ?? "").join("\n"),
    );
    expect(
      nodes.every((node) => {
        const semantic = node.metadata.semanticChunking as Record<string, unknown>;
        const core = semantic.windowCoreUnitRange as { endUnitId: string };
        const committed = semantic.windowCommittedUnitRange as { endUnitId: string };
        return core.endUnitId === committed.endUnitId;
      }),
    ).toBe(true);
  });

  it("rejects a v4 response that consumes read-only look-ahead context", async () => {
    const provider = new ScriptedProvider([
      ({ lookAheadUnits = [], units }) => ({
        chunks: [chunkRange(units[0]?.id, lookAheadUnits[0]?.id)],
      }),
    ]);

    await expect(
      createLlmSemanticChunker({
        maxChunkChars: 10,
        maxWindowChars: 15,
        reasoningProviderFactory: () => provider,
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "fixed-core-1",
            metadata: {},
            sectionPath: ["A"],
            text: "1234567.",
            type: "paragraph",
          },
          {
            id: "fixed-core-2",
            metadata: {},
            sectionPath: ["A"],
            text: "abc.",
            type: "paragraph",
          },
          {
            id: "fixed-core-look-ahead",
            metadata: {},
            sectionPath: ["A"],
            text: "def.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("must not commit read-only look-ahead units");
  });

  it("bounds per-document semantic window concurrency", () => {
    expect(() =>
      createLlmSemanticChunker({
        maxConcurrentWindows: 33,
        reasoningProviderFactory: () => new ScriptedProvider([echoEachUnit]),
      }),
    ).toThrow("maxConcurrentWindows must be at most 32");
  });

  it("propagates compilation cancellation into active semantic model calls", async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const provider: SemanticChunkingLlmProvider = {
      async *stream(input) {
        markStarted?.();
        if (!input.signal) throw new Error("semantic model call did not receive cancellation");
        await new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => reject(input.signal?.reason), {
            once: true,
          });
        });
      },
    };
    const pending = createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "cancelled-window",
          metadata: {},
          sectionPath: ["Cancellation"],
          text: "Cancel this semantic model request.",
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
      signal: controller.signal,
    });

    await started;
    controller.abort(new Error("compilation cancelled"));
    await expect(pending).rejects.toThrow("compilation cancelled");
  });

  it("keeps a one-page short structured record atomic across its table boundary", async () => {
    const parseArtifact = artifact([
      {
        id: "invoice-title",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["电子发票"],
        text: "电子发票（普通发票）",
        type: "title",
      },
      {
        id: "invoice-number",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["电子发票"],
        text: "发票号码：26322000006288006226",
        type: "paragraph",
      },
      {
        id: "invoice-table",
        metadata: { table: { rows: 1 }, title: "商品明细" },
        pageNumber: 1,
        sectionPath: ["电子发票"],
        text: "项目名称 | 金额 | 税额\n餐饮服务 | 533.96 | 32.04",
        type: "table",
      },
      {
        id: "invoice-total",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["电子发票"],
        text: "价税合计：¥566.00",
        type: "paragraph",
      },
    ]);
    const preflight = preflightLlmSemanticWindows({ parseArtifact });
    const legacyPreflight = preflightLlmSemanticWindows({
      parseArtifact,
      promptVersion: "semantic-chunking-v1",
    });
    const provider = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units.at(-1)?.id),
            entities: [
              {
                confidence: 0.99,
                id: "e-invoice",
                text: "26322000006288006226",
                type: "term",
              },
            ],
            sectionPath: ["电子发票"],
            sectionSummary: "发票号码、商品明细与价税合计。",
          },
        ],
      }),
    ]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(preflight).toEqual({ maximumWindowCount: 1, unitCount: 4 });
    expect(legacyPreflight).toEqual({ maximumWindowCount: 3, unitCount: 4 });
    expect(
      preflightLlmSemanticWindows({ parseArtifact, promptVersion: "custom-semantic-v1" }),
    ).toEqual(legacyPreflight);
    expect(provider.calls).toHaveLength(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: "chunk",
      sourceLocation: { pageNumber: 1, sectionPath: ["电子发票"] },
      text: parseArtifact.elements.map((element) => element.text?.trim() ?? "").join("\n"),
    });
    expect(nodes[0]?.metadata.semanticChunking).toMatchObject({
      section: {
        path: ["电子发票"],
        summary: "发票号码、商品明细与价税合计。",
      },
      sourceSpans: [
        { elementId: "invoice-title", elementType: "title", pageNumber: 1 },
        { elementId: "invoice-number", elementType: "paragraph", pageNumber: 1 },
        { elementId: "invoice-table", elementType: "table", pageNumber: 1 },
        { elementId: "invoice-total", elementType: "paragraph", pageNumber: 1 },
      ],
      windowPlanning: {
        atomicDocument: true,
        sourceSectionPathCount: 1,
        version: "v6",
      },
    });
    expect(nodes[0]?.metadata.extractedEntities).toEqual([
      expect.objectContaining({ text: "26322000006288006226", type: "term" }),
    ]);
  });

  it("materializes one table chunk per record even when the model groups the whole table", async () => {
    const parseArtifact = artifact([
      {
        id: "issue-records",
        metadata: {
          table: {
            columns: ["时间", "问题描述", "是否解决"],
            headerRowCount: 1,
            mode: "record-list",
            recordCount: 3,
            semanticVersion: 1,
            sourceRowCount: 4,
          },
        },
        sectionPath: ["Issue Log"],
        text: [
          "时间: 2026-07-01 | 问题描述: 复制按钮无法点击 | 是否解决: 是",
          "时间: 2026-07-02 | 问题描述: 工作流页面被清空 | 是否解决: 否",
          "时间: 2026-08-04 | 问题描述: 插件凭证被重置 | 是否解决: 否",
        ].join("\n"),
        type: "table",
      },
    ]);
    const provider = new ScriptedProvider([echoWholeWindow]);

    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(preflightLlmSemanticWindows({ parseArtifact })).toEqual({
      maximumWindowCount: 1,
      unitCount: 3,
    });
    expect(provider.calls).toHaveLength(1);
    expect(nodes).toHaveLength(3);
    expect(nodes.map((node) => node.kind)).toEqual(["table", "table", "table"]);
    expect(nodes.map((node) => node.text)).toEqual(parseArtifact.elements[0]?.text?.split("\n"));
    expect(
      nodes.map(
        (node) => (node.metadata.semanticChunking as { tableRecord?: unknown }).tableRecord,
      ),
    ).toEqual([
      {
        count: 3,
        index: 0,
        mode: "record-list",
        sourceRowEnd: 2,
        sourceRowStart: 2,
      },
      {
        count: 3,
        index: 1,
        mode: "record-list",
        sourceRowEnd: 3,
        sourceRowStart: 3,
      },
      {
        count: 3,
        index: 2,
        mode: "record-list",
        sourceRowEnd: 4,
        sourceRowStart: 4,
      },
    ]);

    const prompt = JSON.parse(
      provider.calls[0]?.messages.find((message) => message.role === "user")?.content ?? "{}",
    ) as PromptPayload;
    expect(prompt.atomicDocument).toBe(false);
    expect(prompt.tableSchemas).toEqual([
      {
        columns: ["时间", "问题描述", "是否解决"],
        mode: "record-list",
        recordCount: 3,
        sourceElementId: "issue-records",
      },
    ]);
    expect(prompt.units.map((unit) => unit.tableRecordIndex)).toEqual([0, 1, 2]);
    expect(prompt.units.map((unit) => unit.tableSourceRowStart)).toEqual([2, 3, 4]);
    expect(prompt.units.every((unit) => unit.tableMode === "record-list")).toBe(true);
    expect(prompt.units.every((unit) => !Object.hasOwn(unit, "tableColumns"))).toBe(true);
  });

  it("keeps a hard-split table record bounded without combining adjacent records", async () => {
    const parseArtifact = artifact([
      {
        id: "long-table-record",
        metadata: {
          table: {
            columns: ["问题", "详情"],
            headerRowCount: 1,
            mode: "record-list",
            recordCount: 2,
            semanticVersion: 1,
            sourceRowCount: 3,
          },
        },
        sectionPath: ["Issue Log"],
        text: [
          `问题: 超长记录 | 详情: ${"长文本".repeat(24)}`,
          "问题: 普通记录 | 详情: 已解决",
        ].join("\n"),
        type: "table",
      },
    ]);
    const provider = new ScriptedProvider([echoWholeWindow]);
    const nodes = await createLlmSemanticChunker({
      maxChunkChars: 24,
      maxWindowChars: 256,
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(nodes.length).toBeGreaterThan(2);
    expect(nodes.every((node) => countGraphemes(node.text) <= 24)).toBe(true);
    expect(
      nodes
        .map((node) => node.text)
        .join("\n")
        .replaceAll("\n\n", "\n"),
    ).toContain("问题: 普通记录 | 详情: 已解决");
    const recordIndexes = nodes.map(
      (node) =>
        (node.metadata.semanticChunking as { tableRecord?: { index?: number } }).tableRecord?.index,
    );
    expect(recordIndexes.at(-1)).toBe(1);
    expect(recordIndexes.slice(0, -1).every((index) => index === 0)).toBe(true);
  });

  it("splits legacy header-first table text without requiring a reparse", async () => {
    const parseArtifact = artifact([
      {
        id: "legacy-rows",
        metadata: {
          columns: ["name", "status"],
          format: "csv",
          rowCount: 3,
        },
        sectionPath: ["Legacy export"],
        text: "name | status\nAlpha | open\nBeta | closed\nGamma | open",
        type: "table",
      },
    ]);
    const provider = new ScriptedProvider([echoWholeWindow]);

    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(preflightLlmSemanticWindows({ parseArtifact })).toEqual({
      maximumWindowCount: 1,
      unitCount: 3,
    });
    expect(provider.calls).toHaveLength(1);
    expect(nodes.map((node) => node.text)).toEqual([
      "name | status\nAlpha | open",
      "Beta | closed",
      "Gamma | open",
    ]);
  });

  it("replays semantic-chunking-v4 with its original table unitization", () => {
    const parseArtifact = artifact([
      {
        id: "versioned-table",
        metadata: {
          table: {
            columns: ["name", "status"],
            headerRowCount: 1,
            mode: "record-list",
            recordCount: 2,
            semanticVersion: 1,
            sourceRowCount: 3,
          },
        },
        sectionPath: ["Versioned"],
        text: "name: Alpha | status: open\nname: Beta | status: closed",
        type: "table",
      },
    ]);

    expect(preflightLlmSemanticWindows({ parseArtifact })).toEqual({
      maximumWindowCount: 1,
      unitCount: 2,
    });
    expect(
      preflightLlmSemanticWindows({
        parseArtifact,
        promptVersion: "semantic-chunking-v4",
      }),
    ).toEqual({ maximumWindowCount: 1, unitCount: 1 });
  });

  it("does not invent a business record for a schema-only table", async () => {
    const parseArtifact = artifact([
      {
        id: "empty-table",
        metadata: {
          table: {
            columns: ["Name", "Status"],
            headerRowCount: 1,
            mode: "unknown",
            recordCount: 0,
            semanticVersion: 1,
            sourceRowCount: 1,
          },
        },
        sectionPath: ["Empty export"],
        text: "Name | Status",
        type: "table",
      },
    ]);
    const provider = new ScriptedProvider([echoWholeWindow]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    const prompt = JSON.parse(
      provider.calls[0]?.messages.find((message) => message.role === "user")?.content ?? "{}",
    ) as PromptPayload;
    expect(prompt.tableSchemas).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.metadata.semanticChunking).not.toHaveProperty("tableRecord");
  });

  it("fails closed when model output violates atomic-record or special-element boundaries", async () => {
    const atomicArtifact = artifact([
      {
        id: "atomic-text",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["Record"],
        text: "Record header.",
        type: "paragraph",
      },
      {
        id: "atomic-table",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["Record"],
        text: "Name | Value",
        type: "table",
      },
    ]);
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () => new ScriptedProvider([echoEachUnit]),
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: atomicArtifact,
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("atomic document must produce exactly one chunk");

    const ordinaryArtifact = artifact([
      {
        id: "ordinary-text",
        metadata: {},
        sectionPath: ["Document"],
        text: "Context before table.",
        type: "paragraph",
      },
      {
        id: "ordinary-table",
        metadata: {},
        sectionPath: ["Document"],
        text: "Name | Value",
        type: "table",
      },
    ]);
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow]),
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: ordinaryArtifact,
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("must keep table and image elements in isolated chunks");
  });

  it("budgets many parser section paths and tables by context instead of path count", async () => {
    const elements: Array<ParseArtifact["elements"][number]> = [];
    for (let index = 0; index < 68; index += 1) {
      elements.push({
        id: `section-${index}`,
        metadata: {},
        sectionPath: [`Section ${index}`],
        text: `Section ${index} policy details ${"x".repeat(96)}.`,
        type: "paragraph",
      });
      if (index % 10 === 0) {
        elements.push({
          id: `table-${index}`,
          metadata: { table: { rows: 1 } },
          sectionPath: [`Section ${index}`],
          text: `Metric ${index} | Value ${index}`,
          type: "table",
        });
      }
    }
    const parseArtifact = artifact(elements);
    const preflight = preflightLlmSemanticWindows({ parseArtifact });
    const legacyPreflight = preflightLlmSemanticWindows({
      parseArtifact,
      promptVersion: "semantic-chunking-v1",
    });
    const provider = new ScriptedProvider([echoSemanticBoundaries]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(preflight.maximumWindowCount).toBeLessThanOrEqual(3);
    expect(legacyPreflight.maximumWindowCount).toBe(75);
    expect(provider.calls).toHaveLength(preflight.maximumWindowCount);
    expect(nodes.filter((node) => node.kind === "table")).toHaveLength(7);
    expect(nodes.map((node) => node.text).join("\n")).toBe(
      parseArtifact.elements.map((element) => element.text?.trim() ?? "").join("\n"),
    );
    expect(
      nodes.every((node) =>
        Array.isArray((node.metadata.semanticChunking as { sourceSpans?: unknown }).sourceSpans),
      ),
    ).toBe(true);
  });

  it("lets the reasoning model replace unproven Unstructured title boundaries", async () => {
    const provider = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units.at(-1)?.id),
            sectionPath: ["电子发票", "购买方与金额"],
            sectionSummary: "包含发票号码、购方身份和价税合计。",
          },
        ],
      }),
    ]);
    const chunker = createLlmSemanticChunker({ reasoningProviderFactory: () => provider });
    const parseArtifact = ParseArtifactSchema.parse({
      ...artifact([
        {
          id: "invoice-title",
          metadata: {},
          pageNumber: 1,
          sectionPath: ["电子发票（普通发票）"],
          text: "电子发票（普通发票）",
          type: "title",
        },
        {
          id: "invoice-number",
          metadata: {},
          pageNumber: 1,
          sectionPath: ["电子发票（普通发票）"],
          text: "发票号码：26322000000000000000",
          type: "paragraph",
        },
        {
          id: "false-company-title",
          metadata: {},
          pageNumber: 1,
          sectionPath: ["名称：示例人工智能有限公司"],
          text: "名称：示例人工智能有限公司",
          type: "title",
        },
        {
          id: "buyer-tax-id",
          metadata: {},
          pageNumber: 1,
          sectionPath: ["名称：示例人工智能有限公司"],
          text: "统一社会信用代码：91320506EXAMPLE01",
          type: "paragraph",
        },
        {
          id: "false-tax-id-title",
          metadata: {},
          pageNumber: 1,
          sectionPath: ["91320506EXAMPLE02"],
          text: "91320506EXAMPLE02",
          type: "title",
        },
        {
          id: "totals",
          metadata: {},
          pageNumber: 1,
          sectionPath: ["91320506EXAMPLE02"],
          text: "餐饮服务，合计：566.00",
          type: "paragraph",
        },
      ]),
      parser: "unstructured",
    });

    const nodes = await chunker.chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });

    expect(provider.calls).toHaveLength(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.sourceLocation.sectionPath).toEqual(["电子发票", "购买方与金额"]);
    expect(nodes[0]?.text).toBe(
      [
        "电子发票（普通发票）",
        "发票号码：26322000000000000000",
        "名称：示例人工智能有限公司",
        "统一社会信用代码：91320506EXAMPLE01",
        "91320506EXAMPLE02",
        "餐饮服务，合计：566.00",
      ].join("\n"),
    );
    expect(nodes[0]?.metadata.semanticChunking).toMatchObject({
      layoutRecomposition: {
        modelDecidedHeadingBoundaries: 3,
        trustedHeadingBoundaries: 0,
      },
      section: {
        path: ["电子发票", "购买方与金额"],
        summary: "包含发票号码、购方身份和价税合计。",
      },
    });
  });

  it("falls back to trusted parser provenance when the model replaces its section prefix", async () => {
    const provider = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units.at(-1)?.id),
            sectionPath: ["Invented section"],
            sectionSummary: "A grounded summary of the trusted section.",
          },
        ],
      }),
    ]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "trusted-paragraph",
          metadata: {},
          sectionPath: ["Trusted", "Parser section"],
          text: "The immutable source content.",
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.sourceLocation.sectionPath).toEqual(["Trusted", "Parser section"]);
    expect(nodes[0]?.metadata.semanticChunking).toMatchObject({
      section: {
        path: ["Trusted", "Parser section"],
        summary: "A grounded summary of the trusted section.",
      },
    });
  });

  it("rebases deterministic node IDs onto the immutable publication generation", async () => {
    const chunker = createLlmSemanticChunker({
      reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow]),
    });
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "paragraph",
          metadata: {},
          sectionPath: ["A"],
          text: "Stable text.",
          type: "paragraph" as const,
        },
      ]),
      retrievalProfile: profile(),
    };
    const [first] = await chunker.chunk({ ...input, publicationGenerationId: GENERATION_A });
    const [replay] = await chunker.chunk({ ...input, publicationGenerationId: GENERATION_A });
    const [nextGeneration] = await chunker.chunk({
      ...input,
      publicationGenerationId: GENERATION_B,
    });

    expect(replay?.id).toBe(first?.id);
    expect(nextGeneration?.id).not.toBe(first?.id);
    expect(first?.publicationGenerationId).toBe(GENERATION_A);
    expect(nextGeneration?.publicationGenerationId).toBe(GENERATION_B);
  });

  it.each([
    {
      label: "gapped coverage",
      response: ({ units }: PromptPayload) => ({
        chunks: [chunkRange(units[1]?.id, units[1]?.id)],
      }),
      error: "contiguously without gaps or overlap",
    },
    {
      label: "unknown unit",
      response: ({ units }: PromptPayload) => ({
        chunks: [chunkRange(units[0]?.id, "u-missing")],
      }),
      error: "unknown unit ID",
    },
    {
      label: "relation to an entity from outside the chunk",
      response: ({ units }: PromptPayload) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units.at(-1)?.id),
            entities: [{ confidence: 1, id: "e-alpha", text: "Alpha", type: "term" }],
            relations: [
              {
                confidence: 1,
                objectEntityId: "e-missing",
                subjectEntityId: "e-alpha",
                type: "references",
              },
            ],
          },
        ],
      }),
      error: "relation endpoint ids must reference entities in the same chunk",
    },
    {
      label: "duplicate response-local entity ids",
      response: ({ units }: PromptPayload) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units.at(-1)?.id),
            entities: [
              { confidence: 1, id: "e-same", text: "Alpha", type: "term" },
              { confidence: 1, id: "e-same", text: "Beta", type: "term" },
            ],
          },
        ],
      }),
      error: "entity ids must be unique",
    },
  ])("rejects $label", async ({ response, error }) => {
    const chunker = createLlmSemanticChunker({
      maxChunkChars: 20,
      reasoningProviderFactory: () => new ScriptedProvider([response]),
    });

    await expect(
      chunker.chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "paragraph",
            metadata: {},
            sectionPath: ["Validation"],
            text: "Alpha. Beta.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow(error);
  });

  it("drops ungrounded image OCR entities and their relations without discarding the chunk", async () => {
    const provider = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units.at(-1)?.id),
            entities: [
              {
                confidence: 0.99,
                id: "e-output",
                text: "Output Probabilities",
                type: "term",
              },
              {
                confidence: 0.99,
                id: "e-attention",
                text: "Multi-Head Attention",
                type: "term",
              },
              { confidence: 0.99, id: "e-softmax", text: "Softmax", type: "term" },
              {
                confidence: 0.99,
                id: "e-masked-attention",
                text: "Masked Multi-Head Attention",
                type: "term",
              },
            ],
            relations: [
              {
                confidence: 0.95,
                objectEntityId: "e-attention",
                subjectEntityId: "e-output",
                type: "references",
              },
              {
                confidence: 0.95,
                objectEntityId: "e-attention",
                subjectEntityId: "e-softmax",
                type: "depends_on",
              },
              {
                confidence: 0.95,
                objectEntityId: "e-masked-attention",
                subjectEntityId: "e-attention",
                type: "references",
              },
            ],
          },
        ],
      }),
    ]);
    const sourceText =
      "Output Probabilities Add & Norm Feed Forward Add & Norm Multi-Head Attention";

    const [node] = await createLlmSemanticChunker({
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "transformer-architecture",
          metadata: { caption: "Transformer architecture" },
          pageNumber: 3,
          sectionPath: ["3 Model Architecture"],
          text: sourceText,
          type: "image",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(node?.text).toBe(sourceText);
    expect(node?.kind).toBe("image");
    expect(node?.metadata.extractedEntities).toMatchObject([
      { text: "Output Probabilities" },
      { text: "Multi-Head Attention" },
    ]);
    expect(node?.metadata.extractedRelations).toMatchObject([
      { object: "Multi-Head Attention", subject: "Output Probabilities", type: "references" },
    ]);
    expect(node?.metadata.entityExtraction).toMatchObject({ completed: true, entityCount: 2 });
    expect(node?.metadata.relationExtraction).toMatchObject({ completed: true, relationCount: 1 });
    expect(node && hasValidLlmSemanticJointExtraction(node)).toBe(true);
  });

  it("replays a checkpoint whose ungrounded graph output degrades to an empty graph", async () => {
    const checkpoints = createInMemoryDocumentSemanticWindowCheckpointRepository();
    const sourceText = "Add & Norm Feed Forward";
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "noisy-diagram",
          metadata: {},
          pageNumber: 3,
          sectionPath: ["Architecture"],
          text: sourceText,
          type: "image" as const,
        },
      ]),
      publicationGenerationId: GENERATION_A,
      retrievalProfile: profile(),
      tenantId: "tenant-1",
    };
    const firstProvider = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units.at(-1)?.id),
            entities: [{ confidence: 1, id: "e-softmax", text: "Softmax", type: "term" }],
            relations: [],
          },
        ],
      }),
    ]);
    const [first] = await createLlmSemanticChunker({
      checkpoints,
      now: () => "2026-08-17T07:00:00.000Z",
      reasoningProviderFactory: () => firstProvider,
    }).chunk(input);

    const replayProvider = new ScriptedProvider([
      () => {
        throw new Error("checkpoint replay unexpectedly called the provider");
      },
    ]);
    const [replay] = await createLlmSemanticChunker({
      checkpoints,
      now: () => "2026-08-17T07:00:00.000Z",
      reasoningProviderFactory: () => replayProvider,
    }).chunk(input);

    expect(first?.text).toBe(sourceText);
    expect(first?.metadata.extractedEntities).toEqual([]);
    expect(first?.metadata.extractedRelations).toEqual([]);
    expect(replay).toEqual(first);
    expect(firstProvider.calls).toHaveLength(1);
    expect(replayProvider.calls).toHaveLength(0);
  });

  it("rejects a model range over the Unicode-grapheme hard limit", async () => {
    const provider = new ScriptedProvider([
      ({ units }) => ({
        chunks: [chunkRange(units[0]?.id, units.at(-1)?.id)],
      }),
    ]);
    const chunker = createLlmSemanticChunker({
      maxChunkChars: 7,
      maxWindowChars: 20,
      reasoningProviderFactory: () => provider,
    });

    await expect(
      chunker.chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "paragraph",
            metadata: {},
            sectionPath: ["Validation"],
            text: "One. Two.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("exceeded maxChunkChars=7");
  });

  it("fails closed on invalid structured output or a missing terminal stream event", async () => {
    const invalidSchema = new ScriptedProvider([
      ({ units }) => ({
        chunks: [{ ...chunkRange(units[0]?.id, units[0]?.id), text: "rewritten" }],
      }),
    ]);
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "paragraph",
          metadata: {},
          sectionPath: [],
          text: "Original.",
          type: "paragraph" as const,
        },
      ]),
      retrievalProfile: profile(),
    };
    await expect(
      createLlmSemanticChunker({ reasoningProviderFactory: () => invalidSchema }).chunk(input),
    ).rejects.toThrow("invalid response schema");

    const noTerminalProvider: SemanticChunkingLlmProvider = {
      async *stream() {
        yield { delta: '{"chunks":[]}', type: "delta" };
      },
    };
    await expect(
      createLlmSemanticChunker({ reasoningProviderFactory: () => noTerminalProvider }).chunk(input),
    ).rejects.toThrow("without a terminal event");
  });

  it("rejects a terminal actual model that differs from the frozen reasoning selection", async () => {
    const provider = new ScriptedProvider([echoWholeWindow], {
      finishReason: "stop",
      metadata: { model: "silently-routed-model", provider: "plugin-daemon" },
    });
    await expect(
      createLlmSemanticChunker({ reasoningProviderFactory: () => provider }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "model-identity",
            metadata: {},
            sectionPath: [],
            text: "Frozen model content.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("expected frozen model=reasoner-model");
  });

  it("recomputes canonical generation identity and fails closed on replay corruption", async () => {
    const parseArtifact = artifact([
      {
        id: "replay",
        metadata: {},
        pageNumber: 4,
        sectionPath: ["Replay"],
        text: "Replay-safe content.",
        type: "paragraph",
      },
    ]);
    const permissionScope = ["tenant:one", "team:search"];
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow]),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      permissionScope,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: profile(),
    });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        modelSelection: profile().reasoningModel,
        nodes,
        parseArtifact,
        permissionScope,
        publicationGenerationId: GENERATION_A,
      }),
    ).not.toThrow();

    const node = nodes[0] as (typeof nodes)[number];
    const marker = node.metadata.semanticChunking as Record<string, unknown>;
    const corruptedFingerprint = KnowledgeNodeSchema.parse({
      ...node,
      metadata: {
        ...node.metadata,
        semanticChunking: { ...marker, inputFingerprint: `sha256:${"0".repeat(64)}` },
      },
    });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        modelSelection: profile().reasoningModel,
        nodes: [corruptedFingerprint],
        parseArtifact,
        permissionScope,
        publicationGenerationId: GENERATION_A,
      }),
    ).toThrow("window fingerprint");

    const corruptedAcl = KnowledgeNodeSchema.parse({ ...node, permissionScope: ["tenant:other"] });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        modelSelection: profile().reasoningModel,
        nodes: [corruptedAcl],
        parseArtifact,
        permissionScope,
        publicationGenerationId: GENERATION_A,
      }),
    ).toThrow("ACL");

    const corruptedIdentity = KnowledgeNodeSchema.parse({ ...node, id: GENERATION_B });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        modelSelection: profile().reasoningModel,
        nodes: [corruptedIdentity],
        parseArtifact,
        permissionScope,
        publicationGenerationId: GENERATION_A,
      }),
    ).toThrow("identity");

    const corruptedLanguage = KnowledgeNodeSchema.parse({
      ...node,
      metadata: { ...node.metadata, language: "fr" },
    });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        modelSelection: profile().reasoningModel,
        nodes: [corruptedLanguage],
        parseArtifact,
        permissionScope,
        publicationGenerationId: GENERATION_A,
      }),
    ).toThrow("language");

    const impossibleDocumentCount = KnowledgeNodeSchema.parse({
      ...node,
      metadata: {
        ...node.metadata,
        semanticChunking: {
          ...marker,
          documentChunkCount: Number.MAX_SAFE_INTEGER,
        },
      },
    });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        config: { maxNodes: 1 },
        modelSelection: profile().reasoningModel,
        nodes: [impossibleDocumentCount],
        parseArtifact,
        permissionScope,
        publicationGenerationId: GENERATION_A,
      }),
    ).toThrow("documentChunkCount exceeds maxNodes=1");
  });

  it("requires frozen terminal identity when replay provenance says plugin-daemon", async () => {
    const parseArtifact = artifact([
      {
        id: "plugin-replay",
        metadata: {},
        sectionPath: [],
        text: "Plugin replay identity.",
        type: "paragraph",
      },
    ]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () =>
        new ScriptedProvider([echoWholeWindow], undefined, "plugin-daemon"),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });
    const node = nodes[0] as (typeof nodes)[number];
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        modelSelection: profile().reasoningModel,
        nodes,
        parseArtifact,
      }),
    ).not.toThrow();

    for (const actual of [
      { model: "silently-routed-model", provider: "plugin-daemon" },
      { model: "reasoner-model", provider: "proxy" },
      { provider: "plugin-daemon" },
      { model: "reasoner-model" },
    ]) {
      const semantic = node.metadata.semanticChunking as Record<string, unknown>;
      const completion = semantic.completion as Record<string, unknown>;
      const corrupted = KnowledgeNodeSchema.parse({
        ...node,
        metadata: {
          ...node.metadata,
          semanticChunking: {
            ...semantic,
            completion: { ...completion, actual },
          },
        },
      });
      expect(() =>
        assertValidLlmSemanticGenerationReplay({
          modelSelection: profile().reasoningModel,
          nodes: [corrupted],
          parseArtifact,
        }),
      ).toThrow("incompatible semantic provenance");
    }

    const semantic = node.metadata.semanticChunking as Record<string, unknown>;
    const completion = semantic.completion as Record<string, unknown>;
    const nonPluginWithoutActualRoute = KnowledgeNodeSchema.parse({
      ...node,
      metadata: {
        ...node.metadata,
        semanticChunking: {
          ...semantic,
          completion: { ...completion, actual: {} },
          provider: "custom-provider",
        },
      },
    });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        modelSelection: profile().reasoningModel,
        nodes: [nonPluginWithoutActualRoute],
        parseArtifact,
      }),
    ).not.toThrow();
  });

  it("canonically replays a complete compact manifest for all- and middle-excluded windows", async () => {
    const parseArtifact = artifact([
      {
        id: "manifest-first",
        metadata: {},
        sectionPath: ["First"],
        text: "Alpha policy.",
        type: "paragraph",
      },
      {
        id: "manifest-middle",
        metadata: {},
        sectionPath: ["Middle"],
        text: "Beta contract.",
        type: "paragraph",
      },
      {
        id: "manifest-last",
        metadata: {},
        sectionPath: ["Last"],
        text: "Gamma proof.",
        type: "paragraph",
      },
    ]);
    const nodes = await createLlmSemanticChunker({
      maxChunkChars: 14,
      maxWindowChars: 14,
      reasoningProviderFactory: () =>
        new ScriptedProvider([echoWholeWindow], undefined, "plugin-daemon"),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });
    const receipt = compactWindowManifest(nodes);

    expect(receipt.windowManifest).toHaveLength(3);
    expect(() =>
      assertValidLlmSemanticWindowManifestReplay({
        completionCatalog: receipt.completionCatalog,
        config: { maxChunkChars: 14, maxWindowChars: 14 },
        documentChunkCount: nodes.length,
        modelSelection: profile().reasoningModel,
        parseArtifact,
        windowManifest: receipt.windowManifest,
      }),
    ).not.toThrow();
    // Stored nodes may be empty or omit the complete middle window; canonical validation relies on
    // the complete receipt manifest and therefore has no dependency on either visible node set.
    expect(nodes.filter((_, index) => index !== 1)).toHaveLength(2);
  });

  it("fails closed on compact manifest window, completion, coverage, and cap corruption", async () => {
    const parseArtifact = artifact([
      {
        id: "compact-1",
        metadata: {},
        sectionPath: ["A"],
        text: "1234567.",
        type: "paragraph",
      },
      {
        id: "compact-2",
        metadata: {},
        sectionPath: ["A"],
        text: "abc.",
        type: "paragraph",
      },
      {
        id: "compact-3",
        metadata: {},
        sectionPath: ["A"],
        text: "def.",
        type: "paragraph",
      },
    ]);
    const nodes = await createLlmSemanticChunker({
      maxChunkChars: 10,
      maxWindowChars: 15,
      promptVersion: "semantic-chunking-v3",
      reasoningProviderFactory: () =>
        new ScriptedProvider(
          [
            ({ lookAheadUnits = [], units }) => ({
              chunks: [
                chunkRange(units[0]?.id, units[0]?.id),
                chunkRange(units[1]?.id, lookAheadUnits[0]?.id),
              ],
            }),
          ],
          undefined,
          "plugin-daemon",
        ),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });
    const receipt = compactWindowManifest(nodes);
    const validate = (overrides: {
      completionCatalog?: readonly LlmSemanticCompletionCatalogEntry[];
      documentChunkCount?: number;
      windowManifest?: readonly LlmSemanticWindowManifestEntry[];
    }) =>
      assertValidLlmSemanticWindowManifestReplay({
        completionCatalog: overrides.completionCatalog ?? receipt.completionCatalog,
        config: { maxChunkChars: 10, maxWindowChars: 15 },
        documentChunkCount: overrides.documentChunkCount ?? nodes.length,
        modelSelection: profile().reasoningModel,
        parseArtifact,
        promptVersion: "semantic-chunking-v3",
        windowManifest: overrides.windowManifest ?? receipt.windowManifest,
      });
    const firstWindow = receipt.windowManifest[0] as LlmSemanticWindowManifestEntry;
    const replaceWindow = (
      patch: Partial<LlmSemanticWindowManifestEntry>,
    ): LlmSemanticWindowManifestEntry[] => [{ ...firstWindow, ...patch }];

    expect(() =>
      validate({
        windowManifest: replaceWindow({
          coreUnitRange: [firstWindow.coreUnitRange[0], "u-000002-000000"],
        }),
      }),
    ).toThrow("canonical core/look-ahead");
    expect(() =>
      validate({
        windowManifest: replaceWindow({
          coreUnitRange: {
            endUnitId: firstWindow.coreUnitRange[1],
            startUnitId: firstWindow.coreUnitRange[0],
          } as unknown as LlmSemanticWindowManifestEntry["coreUnitRange"],
        }),
      }),
    ).toThrow("canonical core/look-ahead");
    expect(() =>
      validate({ windowManifest: replaceWindow({ lookAheadUnitRange: undefined }) }),
    ).toThrow("canonical core/look-ahead");
    expect(() =>
      validate({
        windowManifest: replaceWindow({
          committedUnitRange: [firstWindow.committedUnitRange[0], "u-000001-000000"],
        }),
      }),
    ).toThrow("gap, overlap, or context-only range");
    expect(() =>
      validate({
        windowManifest: replaceWindow({ inputFingerprint: `sha256:${"0".repeat(64)}` }),
      }),
    ).toThrow("canonical core/look-ahead");
    expect(() => validate({ windowManifest: replaceWindow({ firstChunkIndex: 1 }) })).toThrow(
      "invalid or unbounded chunk list",
    );
    expect(() =>
      validate({ windowManifest: replaceWindow({ responseFingerprint: "not-a-hash" }) }),
    ).toThrow("invalid or unbounded chunk list");

    const completion = receipt.completionCatalog[0] as LlmSemanticCompletionCatalogEntry;
    expect(() =>
      validate({
        completionCatalog: [{ ...completion, fingerprint: `sha256:${"0".repeat(64)}` }],
      }),
    ).toThrow("invalid or duplicate identity");
    const wrongCompletion = {
      ...completion,
      actualProvider: "proxy",
      fingerprint: "",
    };
    wrongCompletion.fingerprint = llmSemanticCompletionFingerprint(wrongCompletion);
    expect(() => validate({ completionCatalog: [wrongCompletion] })).toThrow("frozen model");

    expect(() =>
      validate({
        windowManifest: replaceWindow({
          chunkRanges: [
            firstWindow.chunkRanges[0] as readonly [string, string],
            ["u-000002-000000", "u-000002-000000"],
          ],
        }),
      }),
    ).toThrow("gap, overlap, or context-only range");
    expect(() =>
      validate({
        windowManifest: replaceWindow({
          chunkRanges: [
            ["u-000000-000000", "u-000001-000000"],
            firstWindow.chunkRanges[1] as readonly [string, string],
          ],
        }),
      }),
    ).toThrow("exceeds maxChunkChars=10");
    expect(() => validate({ documentChunkCount: Number.MAX_SAFE_INTEGER })).toThrow(
      "documentChunkCount exceeds maxNodes=20000",
    );
  });

  it("validates empty and minimal compact manifests without trusting optional completion fields", async () => {
    expect(() =>
      assertValidLlmSemanticWindowManifestReplay({
        completionCatalog: [],
        documentChunkCount: 0,
        modelSelection: profile().reasoningModel,
        parseArtifact: artifact([]),
        windowManifest: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertValidLlmSemanticWindowManifestReplay({
        completionCatalog: [],
        documentChunkCount: 1,
        modelSelection: profile().reasoningModel,
        parseArtifact: artifact([]),
        windowManifest: [],
      }),
    ).toThrow("empty canonical input has receipt windows or chunks");

    const parseArtifact = artifact([
      {
        id: "minimal-manifest",
        metadata: {},
        sectionPath: [],
        text: "Minimal manifest.",
        type: "paragraph",
      },
    ]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow], undefined, "custom"),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });
    const receipt = compactWindowManifest(nodes);
    const minimalCompletion = { fingerprint: llmSemanticCompletionFingerprint({}) };
    const validate = (overrides: {
      completionCatalog?: readonly LlmSemanticCompletionCatalogEntry[];
      windowManifest?: readonly LlmSemanticWindowManifestEntry[];
    }) =>
      assertValidLlmSemanticWindowManifestReplay({
        completionCatalog: overrides.completionCatalog ?? [minimalCompletion],
        documentChunkCount: 1,
        modelSelection: profile().reasoningModel,
        parseArtifact,
        windowManifest: overrides.windowManifest ?? receipt.windowManifest,
      });

    expect(() => validate({})).not.toThrow();
    expect(() =>
      validate({ completionCatalog: [null as unknown as LlmSemanticCompletionCatalogEntry] }),
    ).toThrow("must be an object");
    expect(() =>
      validate({
        windowManifest: [
          {
            ...receipt.windowManifest[0],
            windowId: "window-invalid",
          } as LlmSemanticWindowManifestEntry,
        ],
      }),
    ).toThrow("invalid or non-sequential windowId");
    expect(() =>
      validate({
        windowManifest: [
          {
            ...receipt.windowManifest[0],
            chunkRanges: [["invalid", "invalid"]],
          } as LlmSemanticWindowManifestEntry,
        ],
      }),
    ).toThrow("chunk 0 has invalid identity");
    expect(() =>
      assertValidLlmSemanticWindowManifestReplay({
        completionCatalog: [],
        documentChunkCount: 1,
        modelSelection: profile().reasoningModel,
        parseArtifact,
        windowManifest: [],
      }),
    ).toThrow("non-empty canonical input has an incomplete receipt manifest");
  });

  it("fails closed when stored joint extraction metadata is tampered", async () => {
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () =>
        new ScriptedProvider([
          ({ units }) => ({
            chunks: [
              {
                ...chunkRange(units[0]?.id, units.at(-1)?.id),
                entities: [
                  {
                    canonicalName: "Alpha",
                    confidence: 0.9,
                    id: "alpha",
                    text: "Alpha",
                    type: "term",
                  },
                  { confidence: 0.8, id: "beta", text: "Beta", type: "term" },
                ],
                relations: [
                  {
                    confidence: 0.7,
                    objectEntityId: "beta",
                    subjectEntityId: "alpha",
                    type: "references",
                  },
                ],
              },
            ],
          }),
        ]),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "joint-extraction",
          metadata: {},
          sectionPath: [],
          text: "Alpha references Beta.",
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
    });
    const node = nodes[0] as KnowledgeNode;
    const semantic = node.metadata.semanticChunking as Record<string, unknown>;
    const entities = node.metadata.extractedEntities as readonly Record<string, unknown>[];
    const relations = node.metadata.extractedRelations as readonly Record<string, unknown>[];
    const entityMetadata = entities[0]?.metadata as Record<string, unknown>;
    const relationMetadata = relations[0]?.metadata as Record<string, unknown>;
    const withMetadata = (metadata: Record<string, unknown>) =>
      ({ ...node, metadata: { ...node.metadata, ...metadata } }) as KnowledgeNode;

    expect(hasValidLlmSemanticJointExtraction(node)).toBe(true);
    for (const corrupted of [
      withMetadata({ extractedEntities: "invalid" }),
      withMetadata({ semanticChunking: { ...semantic, completed: false } }),
      withMetadata({ semanticChunking: { ...semantic, windowId: "invalid" } }),
      withMetadata({ semanticChunking: { ...semantic, completion: {} } }),
      withMetadata({ extractedEntities: [null], extractedRelations: [] }),
      withMetadata({
        extractedEntities: [{ ...entities[0], text: "Not present" }, entities[1]],
      }),
      withMetadata({
        extractedEntities: [
          { ...entities[0], metadata: { ...entityMetadata, canonicalName: " " } },
          entities[1],
        ],
      }),
      withMetadata({
        extractedEntities: [
          entities[0],
          {
            ...entities[1],
            metadata: { ...(entities[1]?.metadata as object), responseEntityId: "alpha" },
          },
        ],
      }),
      withMetadata({ extractedRelations: [null] }),
      withMetadata({
        extractedRelations: [
          { ...relations[0], metadata: { ...relationMetadata, source: "tampered" } },
        ],
      }),
      withMetadata({ extractedRelations: [{ ...relations[0], subject: "Beta" }] }),
    ]) {
      expect(hasValidLlmSemanticJointExtraction(corrupted)).toBe(false);
    }
  });

  it("bounds terminal completion metadata and accepts each exact boundary", async () => {
    const parseArtifact = artifact([
      {
        id: "terminal-bounds",
        metadata: {},
        sectionPath: [],
        text: "Bounded terminal metadata.",
        type: "paragraph",
      },
    ]);
    const selectedProfile = KnowledgeSpaceRetrievalProfileSchema.parse({
      ...profile(),
      reasoningModel: {
        ...profile().reasoningModel,
        model: "m".repeat(255),
      },
    });
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () =>
          new ScriptedProvider([echoWholeWindow], {
            finishReason: "f".repeat(64),
            metadata: { model: "m".repeat(255), provider: "p".repeat(255) },
          }),
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact,
        retrievalProfile: selectedProfile,
      }),
    ).resolves.toHaveLength(1);

    for (const terminal of [
      { finishReason: "f".repeat(65), metadata: { model: "reasoner-model" } },
      { metadata: { model: "m".repeat(256) } },
      { metadata: { model: "reasoner-model", provider: "p".repeat(256) } },
    ]) {
      await expect(
        createLlmSemanticChunker({
          reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow], terminal),
        }).chunk({
          knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
          parseArtifact,
          retrievalProfile: profile(),
        }),
      ).rejects.toThrow("at most");
    }
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () =>
          new ScriptedProvider([echoWholeWindow], undefined, "p".repeat(256)),
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact,
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("at most 255");
  });

  it("rejects an excessive deterministic window count before provider construction", async () => {
    const parseArtifact = artifact(
      Array.from({ length: DEFAULT_MAX_SEMANTIC_WINDOWS + 1 }, (_, index) => ({
        id: `preflight-${index}`,
        metadata: {},
        sectionPath: [`Section ${index}`],
        text: "x",
        type: "paragraph" as const,
      })),
    );
    const config = { maxChunkChars: 1, maxWindowChars: 1 } as const;
    expect(() => preflightLlmSemanticWindows({ config, parseArtifact })).toThrow(
      `maxSemanticWindows=${DEFAULT_MAX_SEMANTIC_WINDOWS}`,
    );
    let providerConstructions = 0;
    await expect(
      createLlmSemanticChunker({
        maxChunkChars: 1,
        maxWindowChars: 1,
        reasoningProviderFactory: () => {
          providerConstructions += 1;
          return new ScriptedProvider([echoWholeWindow]);
        },
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact,
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow(`maxSemanticWindows=${DEFAULT_MAX_SEMANTIC_WINDOWS}`);
    expect(providerConstructions).toBe(0);
  });

  it("validates construction and request bounds before invoking the model", async () => {
    const factory = () => new ScriptedProvider([echoWholeWindow]);
    expect(() =>
      createLlmSemanticChunker({ maxChunkChars: 0, reasoningProviderFactory: factory }),
    ).toThrow("maxChunkChars must be at least 1");
    expect(() =>
      createLlmSemanticChunker({
        maxChunkChars: 20,
        maxWindowChars: 10,
        reasoningProviderFactory: factory,
      }),
    ).toThrow("maxWindowChars must be at least maxChunkChars");
    expect(() =>
      createLlmSemanticChunker({ promptVersion: " ", reasoningProviderFactory: factory }),
    ).toThrow("promptVersion is required");
    expect(() =>
      preflightLlmSemanticWindows({ parseArtifact: artifact([]), promptVersion: " " }),
    ).toThrow("preflight promptVersion is required");
    expect(() =>
      createLlmSemanticChunker({ reasoningProviderFactory: factory, temperature: -1 }),
    ).toThrow("temperature must be non-negative");
    expect(() =>
      createLlmSemanticChunker({
        maxProviderOutputRetries: 4,
        reasoningProviderFactory: factory,
      }),
    ).toThrow("maxProviderOutputRetries must be at most 3");
    expect(() =>
      createLlmSemanticChunker({
        maxProviderOutputRetries: -1,
        reasoningProviderFactory: factory,
      }),
    ).toThrow("maxProviderOutputRetries must be a non-negative integer");
    for (const [name, options] of [
      ["maxEntitiesPerChunk", { maxEntitiesPerChunk: 0 }],
      ["maxNodes", { maxNodes: 0 }],
      ["maxOutputTokens", { maxOutputTokens: 0 }],
      ["maxRelationsPerChunk", { maxRelationsPerChunk: 0 }],
      ["maxResponseChars", { maxResponseChars: 0 }],
    ] as const) {
      expect(() =>
        createLlmSemanticChunker({ ...options, reasoningProviderFactory: factory }),
      ).toThrow(`${name} must be at least 1`);
    }

    let factoryCalls = 0;
    const chunker = createLlmSemanticChunker({
      reasoningProviderFactory: () => {
        factoryCalls += 1;
        return new ScriptedProvider([echoWholeWindow]);
      },
    });
    await expect(
      chunker.chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "empty",
            metadata: {},
            sectionPath: [],
            text: "   ",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).resolves.toEqual([]);
    expect(factoryCalls).toBe(0);

    await expect(
      chunker.chunk({
        config: { maxChunkChars: 20, maxWindowChars: 10 },
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "non-empty",
            metadata: {},
            sectionPath: [],
            text: "Content.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("maxWindowChars must be at least maxChunkChars");

    const largeCapProvider = new ScriptedProvider([echoWholeWindow]);
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () => largeCapProvider,
      }).chunk({
        config: { maxChunkChars: 8_192 },
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "large-cap",
            metadata: {},
            sectionPath: [],
            text: "Content.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).resolves.toHaveLength(1);
    expect(largeCapProvider.calls[0]?.messages[0]?.content).toContain("at most 8192 Unicode");

    await expect(
      chunker.chunk({
        config: { maxChunkChars: 8_192, maxWindowChars: 8_191 },
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "explicit-small-window",
            metadata: {},
            sectionPath: [],
            text: "Content.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("maxWindowChars must be at least maxChunkChars");

    for (const overlapChars of [-1, 1.5, 20]) {
      await expect(
        chunker.chunk({
          config: { maxChunkChars: 20, overlapChars },
          knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
          parseArtifact: artifact([
            {
              id: "invalid-overlap",
              metadata: {},
              sectionPath: [],
              text: "Content.",
              type: "paragraph",
            },
          ]),
          retrievalProfile: profile(),
        }),
      ).rejects.toThrow(overlapChars === 20 ? "less than maxChunkChars" : "non-negative integer");
    }
  });

  it("fails closed on replay shape, empty-input, and exclusion corruption", async () => {
    const parseArtifact = artifact([
      {
        id: "replay-validation",
        metadata: {},
        sectionPath: [],
        text: "Replay validation.",
        type: "paragraph",
      },
    ]);
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow]),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      retrievalProfile: profile(),
    });
    const node = nodes[0] as KnowledgeNode;
    const marker = node.metadata.semanticChunking as Record<string, unknown>;
    const replay = (overrides: {
      excludedNodeOrdinals?: readonly number[];
      nodes?: readonly KnowledgeNode[];
      parseArtifact?: ParseArtifact;
      promptVersion?: string;
    }) =>
      assertValidLlmSemanticGenerationReplay({
        ...(overrides.excludedNodeOrdinals !== undefined
          ? { excludedNodeOrdinals: overrides.excludedNodeOrdinals }
          : {}),
        modelSelection: profile().reasoningModel,
        nodes: overrides.nodes ?? nodes,
        parseArtifact: overrides.parseArtifact ?? parseArtifact,
        ...(overrides.promptVersion !== undefined
          ? { promptVersion: overrides.promptVersion }
          : {}),
      });

    expect(() => replay({ promptVersion: " " })).toThrow("promptVersion is required");
    expect(() => replay({ nodes: [], parseArtifact: artifact([]) })).not.toThrow();
    expect(() => replay({ parseArtifact: artifact([]) })).toThrow(
      "stored nodes exist for an empty parse artifact",
    );
    expect(() => replay({ nodes: [] })).toThrow("no stored nodes cover");
    expect(() =>
      replay({
        nodes: [
          {
            ...node,
            metadata: {
              ...node.metadata,
              semanticChunking: { ...marker, documentChunkCount: "one" },
            },
          },
        ],
      }),
    ).toThrow("documentChunkCount is missing or invalid");
    for (const ordinal of [-1, 1, Number.NaN]) {
      expect(() => replay({ excludedNodeOrdinals: [ordinal] })).toThrow(
        "outside documentChunkCount",
      );
    }
  });

  it("rejects malformed terminal events and data emitted after completion", async () => {
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "terminal-validation",
          metadata: {},
          sectionPath: [],
          text: "Terminal validation.",
          type: "paragraph" as const,
        },
      ]),
      retrievalProfile: profile(),
    };
    for (const terminal of [
      { finishReason: " ", metadata: {} },
      { finishReason: 1 as unknown as string, metadata: {} },
      { metadata: { model: 1 } },
      { metadata: { model: " " } },
      { metadata: { provider: 1 } },
      { metadata: { provider: " " } },
    ]) {
      await expect(
        createLlmSemanticChunker({
          reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow], terminal),
        }).chunk(input),
      ).rejects.toThrow("must be a non-empty string");
    }

    const afterDone: SemanticChunkingLlmProvider = {
      async *stream(streamInput) {
        const userMessage = streamInput.messages.find((message) => message.role === "user");
        const payload = JSON.parse(userMessage?.content ?? "{}") as PromptPayload;
        yield { type: "done" };
        yield { delta: JSON.stringify(echoWholeWindow(payload)), type: "delta" };
      },
    };
    await expect(
      createLlmSemanticChunker({ reasoningProviderFactory: () => afterDone }).chunk(input),
    ).rejects.toThrow("emitted data after its terminal event");
  });

  it("bounds distinct provider completion identities across a document", async () => {
    let completionIndex = 0;
    const provider: SemanticChunkingLlmProvider = {
      async *stream(input) {
        const userMessage = input.messages.find((message) => message.role === "user");
        const payload = JSON.parse(userMessage?.content ?? "{}") as PromptPayload;
        yield { delta: JSON.stringify(echoWholeWindow(payload)), type: "delta" };
        yield { finishReason: `stop-${completionIndex++}`, type: "done" };
      },
    };
    await expect(
      createLlmSemanticChunker({
        maxChunkChars: 20,
        maxWindowChars: 20,
        reasoningProviderFactory: () => provider,
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact(
          Array.from({ length: 65 }, (_, index) => ({
            id: `completion-${index}`,
            metadata: {},
            sectionPath: [`Section ${index}`],
            text: `Completion ${index}.`,
            type: "paragraph" as const,
          })),
        ),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("maxCompletionCatalogEntries=64");
  });

  it("uses no page number when a semantic chunk spans multiple source pages", async () => {
    const nodes = await createLlmSemanticChunker({
      reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow]),
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "page-one",
          metadata: {},
          pageNumber: 1,
          sectionPath: ["Shared"],
          text: "First page.",
          type: "paragraph",
        },
        {
          id: "page-two",
          metadata: {},
          pageNumber: 2,
          sectionPath: ["Shared"],
          text: "Second page.",
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.sourceLocation.pageNumber).toBeUndefined();
  });

  it("bounds windows independently from chunks and enforces the document node cap", async () => {
    const provider = new ScriptedProvider([echoWholeWindow]);
    const windowBounded = createLlmSemanticChunker({
      maxChunkChars: 10,
      maxWindowChars: 10,
      reasoningProviderFactory: () => provider,
    });
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "windowed",
          metadata: {},
          sectionPath: ["A"],
          text: "First. Second. Third.",
          type: "paragraph" as const,
        },
      ]),
      retrievalProfile: profile(),
    };
    const nodes = await windowBounded.chunk(input);
    expect(provider.calls.length).toBeGreaterThan(1);
    expect(nodes.map((node) => node.text).join("")).toBe("First. Second. Third.");

    const capped = createLlmSemanticChunker({
      maxChunkChars: 20,
      maxNodes: 1,
      reasoningProviderFactory: () => new ScriptedProvider([echoEachUnit]),
    });
    await expect(capped.chunk(input)).rejects.toThrow("output exceeds maxNodes=1");
  });

  it("lets the final core chunk commit across deterministic look-ahead without overlap", async () => {
    const observedPrompts: PromptPayload[] = [];
    const provider = new ScriptedProvider([
      (payload) => {
        observedPrompts.push(payload);
        return {
          chunks: [
            chunkRange(payload.units[0]?.id, payload.units[0]?.id),
            chunkRange(payload.units[1]?.id, payload.lookAheadUnits?.[0]?.id),
          ],
        };
      },
    ]);
    const parseArtifact = artifact([
      {
        id: "look-ahead-1",
        metadata: {},
        sectionPath: ["A"],
        text: "1234567.",
        type: "paragraph",
      },
      {
        id: "look-ahead-2",
        metadata: {},
        sectionPath: ["A"],
        text: "abc.",
        type: "paragraph",
      },
      {
        id: "look-ahead-3",
        metadata: {},
        sectionPath: ["A"],
        text: "def.",
        type: "paragraph",
      },
    ]);
    const nodes = await createLlmSemanticChunker({
      maxChunkChars: 10,
      maxWindowChars: 15,
      promptVersion: "semantic-chunking-v3",
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: profile(),
    });

    expect(provider.calls).toHaveLength(1);
    expect(observedPrompts[0]?.units.map((unit) => unit.text)).toEqual(["1234567.", "abc."]);
    expect(observedPrompts[0]?.lookAheadUnits?.map((unit) => unit.text)).toEqual(["def."]);
    expect(nodes.map((node) => node.text)).toEqual(["1234567.", "abc.\ndef."]);
    expect(nodes.map((node) => countGraphemes(node.text))).toEqual([8, 9]);
    expect((nodes[0]?.endOffset ?? 0) + 1).toBe(nodes[1]?.startOffset);
    expect(nodes[1]?.metadata.semanticChunking).toMatchObject({
      windowCommittedUnitRange: {
        endUnitId: "u-000002-000000",
        startUnitId: "u-000000-000000",
      },
      windowCoreUnitRange: {
        endUnitId: "u-000001-000000",
        startUnitId: "u-000000-000000",
      },
      windowLookAheadUnitRange: {
        endUnitId: "u-000002-000000",
        startUnitId: "u-000002-000000",
      },
    });
    expect(() =>
      assertValidLlmSemanticGenerationReplay({
        config: { maxChunkChars: 10, maxWindowChars: 15 },
        modelSelection: profile().reasoningModel,
        nodes,
        parseArtifact,
        promptVersion: "semantic-chunking-v3",
        publicationGenerationId: GENERATION_A,
      }),
    ).not.toThrow();
  });

  it("rejects output chunks that start wholly inside look-ahead context", async () => {
    const provider = new ScriptedProvider([
      ({ lookAheadUnits = [], units }) => ({
        chunks: [
          chunkRange(units[0]?.id, units[0]?.id),
          chunkRange(units[1]?.id, units[1]?.id),
          chunkRange(lookAheadUnits[0]?.id, lookAheadUnits[0]?.id),
        ],
      }),
    ]);
    await expect(
      createLlmSemanticChunker({
        maxChunkChars: 10,
        maxWindowChars: 15,
        promptVersion: "semantic-chunking-v3",
        reasoningProviderFactory: () => provider,
      }).chunk({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact([
          {
            id: "look-ahead-only-1",
            metadata: {},
            sectionPath: ["A"],
            text: "1234567.",
            type: "paragraph",
          },
          {
            id: "look-ahead-only-2",
            metadata: {},
            sectionPath: ["A"],
            text: "abc.",
            type: "paragraph",
          },
          {
            id: "look-ahead-only-3",
            metadata: {},
            sectionPath: ["A"],
            text: "def.",
            type: "paragraph",
          },
        ]),
        retrievalProfile: profile(),
      }),
    ).rejects.toThrow("final chunk must start in the core window");
  });

  it("fails closed on response size, empty JSON, malformed JSON, and incomplete coverage", async () => {
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "validation",
          metadata: {},
          sectionPath: [],
          text: "Alpha. Beta.",
          type: "paragraph" as const,
        },
      ]),
      retrievalProfile: profile(),
    };
    await expect(
      createLlmSemanticChunker({
        maxResponseChars: 5,
        reasoningProviderFactory: () => new ScriptedProvider([echoWholeWindow]),
      }).chunk(input),
    ).rejects.toThrow("response exceeds maxResponseChars=5");
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () => rawProvider("", true),
      }).chunk(input),
    ).rejects.toThrow("empty response");
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () => rawProvider("not-json", true),
      }).chunk(input),
    ).rejects.toThrow("non-JSON output");
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () => rawProvider("prefix {broken} suffix", true),
      }).chunk(input),
    ).rejects.toThrow("invalid JSON");
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () => new ScriptedProvider([() => ({ chunks: [] })]),
      }).chunk(input),
    ).rejects.toThrow("did not cover any input units");
    await expect(
      createLlmSemanticChunker({
        reasoningProviderFactory: () =>
          new ScriptedProvider([
            ({ units }) => ({ chunks: [chunkRange(units[0]?.id, units[0]?.id)] }),
          ]),
      }).chunk(input),
    ).rejects.toThrow("contiguously without gaps or overlap");
  });

  it("retries one invalid provider response before committing the window", async () => {
    const provider = new ScriptedProvider([() => ({ chunks: "invalid" }), echoWholeWindow]);
    const nodes = await createLlmSemanticChunker({
      maxProviderOutputRetries: 1,
      reasoningProviderFactory: () => provider,
    }).chunk({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "retry-provider-output",
          metadata: {},
          sectionPath: [],
          text: "Alpha. Beta.",
          type: "paragraph",
        },
      ]),
      retrievalProfile: profile(),
    });

    expect(nodes).toHaveLength(1);
    expect(provider.calls).toHaveLength(2);
  });

  it("accepts JSON wrapped in provider prose but strictly caps joint extraction arrays", async () => {
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: artifact([
        {
          id: "validation",
          metadata: {},
          sectionPath: [],
          text: "Alpha references Beta.",
          type: "paragraph" as const,
        },
      ]),
      retrievalProfile: profile(),
    };
    const wrapped = wrappingProvider(({ units }) => ({
      chunks: [chunkRange(units[0]?.id, units[0]?.id)],
    }));
    await expect(
      createLlmSemanticChunker({ reasoningProviderFactory: () => wrapped }).chunk(input),
    ).resolves.toHaveLength(1);

    const tooManyEntities = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units[0]?.id),
            entities: [
              { confidence: 1, id: "e-alpha", text: "Alpha", type: "term" },
              { confidence: 1, id: "e-beta", text: "Beta", type: "term" },
            ],
          },
        ],
      }),
    ]);
    await expect(
      createLlmSemanticChunker({
        maxEntitiesPerChunk: 1,
        reasoningProviderFactory: () => tooManyEntities,
      }).chunk(input),
    ).rejects.toThrow("exceeded maxEntitiesPerChunk=1");

    const tooManyRelations = new ScriptedProvider([
      ({ units }) => ({
        chunks: [
          {
            ...chunkRange(units[0]?.id, units[0]?.id),
            entities: [
              { confidence: 1, id: "e-alpha", text: "Alpha", type: "term" },
              { confidence: 1, id: "e-beta", text: "Beta", type: "term" },
            ],
            relations: [
              {
                confidence: 1,
                objectEntityId: "e-beta",
                subjectEntityId: "e-alpha",
                type: "references",
              },
              {
                confidence: 1,
                objectEntityId: "e-alpha",
                subjectEntityId: "e-beta",
                type: "mentions",
              },
            ],
          },
        ],
      }),
    ]);
    await expect(
      createLlmSemanticChunker({
        maxRelationsPerChunk: 1,
        reasoningProviderFactory: () => tooManyRelations,
      }).chunk(input),
    ).rejects.toThrow("exceeded maxRelationsPerChunk=1");
  });
});

function artifact(elements: ParseArtifact["elements"]) {
  return ParseArtifactSchema.parse({
    artifactHash: "a".repeat(64),
    contentType: "structured",
    createdAt: "2026-07-19T00:00:00.000Z",
    documentAssetId: DOCUMENT_ASSET_ID,
    elements,
    id: PARSE_ARTIFACT_ID,
    metadata: {},
    parser: "native-structured",
    version: 1,
  });
}

function profile() {
  return KnowledgeSpaceRetrievalProfileSchema.parse({
    defaultMode: "deep",
    reasoningModel: {
      model: "reasoner-model",
      pluginId: "reasoning-plugin",
      provider: "reasoning-provider",
    },
    rerank: {
      enabled: true,
      model: {
        model: "rerank-model",
        pluginId: "rerank-plugin",
        provider: "rerank-provider",
      },
    },
    revision: 4,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 10,
  });
}

function compactWindowManifest(nodes: readonly KnowledgeNode[]): {
  readonly completionCatalog: readonly LlmSemanticCompletionCatalogEntry[];
  readonly windowManifest: readonly LlmSemanticWindowManifestEntry[];
} {
  const completionCatalog: LlmSemanticCompletionCatalogEntry[] = [];
  const completionIndexes = new Map<string, number>();
  const windows = new Map<string, LlmSemanticWindowManifestEntry>();

  for (const node of nodes) {
    const semantic = node.metadata.semanticChunking as Record<string, unknown>;
    const completion = semantic.completion as {
      actual: { finishReason?: string; model?: string; provider?: string };
    };
    const identityWithoutFingerprint = {
      ...(completion.actual.model ? { actualModel: completion.actual.model } : {}),
      ...(completion.actual.provider ? { actualProvider: completion.actual.provider } : {}),
      ...(completion.actual.finishReason ? { finishReason: completion.actual.finishReason } : {}),
      ...(typeof semantic.provider === "string" ? { transportProvider: semantic.provider } : {}),
    };
    const fingerprint = llmSemanticCompletionFingerprint(identityWithoutFingerprint);
    let completionIndex = completionIndexes.get(fingerprint);
    if (completionIndex === undefined) {
      completionIndex = completionCatalog.length;
      completionIndexes.set(fingerprint, completionIndex);
      completionCatalog.push({ ...identityWithoutFingerprint, fingerprint });
    }
    const windowId = semantic.windowId as string;
    const unitRange = semantic.unitRange as { endUnitId: string; startUnitId: string };
    const committedUnitRange = semantic.windowCommittedUnitRange as {
      endUnitId: string;
      startUnitId: string;
    };
    const coreUnitRange = semantic.windowCoreUnitRange as {
      endUnitId: string;
      startUnitId: string;
    };
    const lookAheadUnitRange = semantic.windowLookAheadUnitRange as
      | { endUnitId: string; startUnitId: string }
      | undefined;
    const existing = windows.get(windowId);
    if (existing) {
      windows.set(windowId, {
        ...existing,
        chunkRanges: [
          ...existing.chunkRanges,
          [unitRange.startUnitId, unitRange.endUnitId] as const,
        ],
      });
      continue;
    }
    windows.set(windowId, {
      chunkRanges: [[unitRange.startUnitId, unitRange.endUnitId]],
      committedUnitRange: [committedUnitRange.startUnitId, committedUnitRange.endUnitId],
      completionIndex,
      coreUnitRange: [coreUnitRange.startUnitId, coreUnitRange.endUnitId],
      firstChunkIndex: node.metadata.chunkIndex as number,
      inputFingerprint: semantic.inputFingerprint as string,
      ...(lookAheadUnitRange
        ? {
            lookAheadUnitRange: [
              lookAheadUnitRange.startUnitId,
              lookAheadUnitRange.endUnitId,
            ] as const,
          }
        : {}),
      responseFingerprint: semantic.inputFingerprint as string,
      windowId,
    });
  }

  return { completionCatalog, windowManifest: [...windows.values()] };
}

function echoEachUnit({ units }: PromptPayload) {
  return {
    chunks: units.map((unit) => chunkRange(unit.id, unit.id)),
  };
}

function echoWholeWindow({ units }: PromptPayload) {
  return {
    chunks: [chunkRange(units[0]?.id, units.at(-1)?.id)],
  };
}

function echoSemanticBoundaries({ atomicDocument, units }: PromptPayload) {
  if (atomicDocument) {
    return { chunks: [chunkRange(units[0]?.id, units.at(-1)?.id)] };
  }
  const chunks: ReturnType<typeof chunkRange>[] = [];
  let start = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index] as PromptUnit;
    const next = units[index + 1];
    const isolated = unit.boundaryPolicy === "isolated";
    const nextStartsBoundary = next?.boundaryPolicy === "isolated";
    const sectionChanges =
      next !== undefined &&
      JSON.stringify(unit.sourceSectionPath ?? []) !== JSON.stringify(next.sourceSectionPath ?? []);
    if (isolated || nextStartsBoundary || sectionChanges || next === undefined) {
      chunks.push(chunkRange((units[start] as PromptUnit).id, unit.id));
      start = index + 1;
    }
  }
  return { chunks };
}

function chunkRange(startUnitId: string | undefined, endUnitId: string | undefined) {
  return {
    endUnitId,
    entities: [],
    relations: [],
    startUnitId,
  };
}

function rawProvider(text: string, terminal: boolean): SemanticChunkingLlmProvider {
  return {
    async *stream() {
      if (text) {
        yield { delta: text, type: "delta" };
      }
      if (terminal) {
        yield { type: "done" };
      }
    },
  };
}

function wrappingProvider(script: Script): SemanticChunkingLlmProvider {
  return {
    async *stream(input) {
      const userMessage = input.messages.find((message) => message.role === "user");
      const payload = JSON.parse(userMessage?.content ?? "{}") as PromptPayload;
      yield { delta: `Result follows:\n${JSON.stringify(script(payload))}\nEnd.`, type: "delta" };
      yield { type: "done" };
    },
  };
}
