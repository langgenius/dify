import { describe, expect, it } from "vitest";

import { createInMemoryArtifactSegmentRepository } from "./artifact-segment-repository";
import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED,
  CandidateVisibilityScanBudgetExceededError,
} from "./candidate-content-authorization";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import type { DocumentMultimodalManifestEnhancer } from "./document-multimodal-manifest-enhancer";
import { createInMemoryDocumentOutlineRepository } from "./document-outline-repository";
import type { GraphIndexRepository } from "./graph-index-repository";
import { createKnowledgeFsCommandRegistry } from "./knowledge-fs-command-registry";
import type { SemanticDiffProvider } from "./knowledge-fs-types";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

import {
  ArtifactSegmentSchema,
  type AuthSubject,
  type CommandName,
  DocumentOutlineSchema,
  KnowledgeNodeSchema,
  KnowledgePathSchema,
  ParseArtifactSchema,
} from "@knowledge/core";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SHA = "c".repeat(64);
const READER: AuthSubject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "subject-1",
  tenantId: "tenant-1",
};
const READER_WITHOUT_TENANT: AuthSubject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "subject-1",
  tenantId: "",
};
const WRITER: AuthSubject = {
  scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
  subjectId: "subject-2",
  tenantId: "tenant-1",
};

function uuid(suffix: string): string {
  return `018f0d60-7a49-7cc2-9c1b-5b36f18f${suffix}`;
}

interface HarnessOptions {
  readonly enhancer?: DocumentMultimodalManifestEnhancer;
  readonly graph?: GraphIndexRepository;
  readonly semanticDiffProvider?: SemanticDiffProvider;
}

function createHarness(options: HarnessOptions = {}) {
  const artifactSegments = createInMemoryArtifactSegmentRepository({
    maxBatchSize: 20,
    maxListLimit: 200,
    maxSegments: 60,
  });
  const assets = createInMemoryDocumentAssetRepository({
    maxAssets: 40,
    now: () => "2026-06-03T00:00:00.000Z",
  });
  const nodes = createInMemoryKnowledgeNodeRepository({
    maxBatchSize: 20,
    maxListLimit: 20,
    maxNodes: 40,
  });
  const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 10 });
  const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 20 });
  const paths = createInMemoryKnowledgePathRepository({ maxListLimit: 20, maxPaths: 60 });
  const objects = new Map<string, Uint8Array>();
  const objectStorage = {
    getObject: async (key: string) => objects.get(key) ?? null,
    putObject: async ({ body, key }: { readonly body: Uint8Array; readonly key: string }) => {
      objects.set(key, body);

      return { key, metadata: {}, sizeBytes: body.byteLength };
    },
  };
  const compute = {
    diffText: ({ newText, oldText }: { readonly newText: string; readonly oldText: string }) => ({
      operations: [
        { kind: "delete", text: oldText },
        { kind: "insert", text: newText },
      ],
      stats: { delete: 1, equal: 0, insert: 1 },
    }),
  };
  const registry = createKnowledgeFsCommandRegistry({
    artifactSegments,
    assets,
    compute,
    graph: options.graph ?? {},
    maxTreeDepth: 4,
    multimodalManifestEnhancer: options.enhancer,
    nodes,
    objectStorage,
    outlines,
    parseArtifacts,
    paths,
    semanticDiffProvider: options.semanticDiffProvider,
  } as unknown as Parameters<typeof createKnowledgeFsCommandRegistry>[0]);
  const execute = (name: string, input: Record<string, unknown>, subject: AuthSubject = READER) =>
    registry.execute({
      context: { resourceType: "workspace", subject },
      input,
      name: name as CommandName,
    });

  return { artifactSegments, assets, execute, nodes, objects, outlines, parseArtifacts, paths };
}

type Harness = ReturnType<typeof createHarness>;

async function addPath(
  harness: Harness,
  path: {
    readonly id: string;
    readonly metadata?: Record<string, unknown>;
    readonly resourceType: string;
    readonly targetId: string;
    readonly version?: number;
    readonly viewName?: string;
    readonly viewType?: string;
    readonly virtualPath: string;
  },
) {
  return harness.paths.create(
    KnowledgePathSchema.parse({
      id: path.id,
      knowledgeSpaceId: SPACE_ID,
      metadata: path.metadata ?? {},
      resourceType: path.resourceType,
      targetId: path.targetId,
      ...(path.version === undefined ? {} : { version: path.version }),
      viewName: path.viewName ?? "docs",
      viewType: path.viewType ?? "physical",
      virtualPath: path.virtualPath,
    }),
  );
}

function makeSegment(segment: {
  readonly artifactId: string;
  readonly id: string;
  readonly index: number;
  readonly inlineText?: string;
  readonly metadata?: Record<string, unknown>;
  readonly objectKey?: string;
  readonly startOffset?: number;
}) {
  return ArtifactSegmentSchema.parse({
    artifactHash: "a".repeat(64),
    checksum: "b".repeat(64),
    contentEncoding: "utf-8",
    createdAt: "2026-05-27T10:00:00.000Z",
    documentAssetId: uuid("cc43"),
    id: segment.id,
    ...(segment.inlineText === undefined ? {} : { inlineText: segment.inlineText }),
    knowledgeSpaceId: SPACE_ID,
    metadata: segment.metadata ?? {},
    ...(segment.objectKey === undefined ? {} : { objectKey: segment.objectKey }),
    parseArtifactId: segment.artifactId,
    segmentIndex: segment.index,
    segmentType: "text",
    sourceLocation: {},
    ...(segment.startOffset === undefined ? {} : { startOffset: segment.startOffset }),
  });
}

function makeNode(node: {
  readonly documentAssetId?: string;
  readonly endOffset?: number;
  readonly id: string;
  readonly kind: string;
  readonly metadata?: Record<string, unknown>;
  readonly permissionScope?: readonly string[];
  readonly sourceLocation?: Record<string, unknown>;
  readonly startOffset?: number;
  readonly text: string;
}) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: node.documentAssetId ?? uuid("cc43"),
    endOffset: node.endOffset ?? 10,
    id: node.id,
    kind: node.kind,
    knowledgeSpaceId: SPACE_ID,
    metadata: node.metadata ?? {},
    parseArtifactId: uuid("cc44"),
    permissionScope: node.permissionScope ?? [],
    sourceLocation: node.sourceLocation ?? {},
    startOffset: node.startOffset ?? 0,
    text: node.text,
  });
}

function makeParseArtifact(artifact: {
  readonly contentType?: string;
  readonly documentAssetId?: string;
  readonly elements: readonly Record<string, unknown>[];
  readonly id: string;
  readonly version?: number;
}) {
  return ParseArtifactSchema.parse({
    artifactHash: "a".repeat(64),
    contentType: artifact.contentType ?? "text",
    createdAt: "2026-05-27T10:00:00.000Z",
    documentAssetId: artifact.documentAssetId ?? uuid("cc43"),
    elements: artifact.elements,
    id: artifact.id,
    metadata: {},
    parser: "native-markdown",
    version: artifact.version ?? 1,
  });
}

function makeOutlineNode(node: {
  readonly children?: readonly unknown[];
  readonly id: string;
  readonly sectionPath: readonly string[];
  readonly summary?: string;
  readonly title: string;
}): Record<string, unknown> {
  return {
    childNodeIds: [],
    children: node.children ?? [],
    id: node.id,
    level: 1,
    metadata: {},
    sectionPath: node.sectionPath,
    sourceElementIds: [],
    sourceNodeIds: [],
    ...(node.summary === undefined ? {} : { summary: node.summary }),
    title: node.title,
    tocSource: "parser-heading",
  };
}

async function addDocument(
  harness: Harness,
  document: {
    readonly assetId: string;
    readonly content?: string;
    readonly filename: string;
    readonly mimeType?: string;
    readonly pathId: string;
    readonly pathMetadata?: Record<string, unknown>;
    readonly version?: number;
    readonly virtualPath: string;
  },
) {
  const objectKey = `objects/${document.filename}`;
  const asset = await harness.assets.create({
    filename: document.filename,
    id: document.assetId,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    mimeType: document.mimeType ?? "text/markdown",
    objectKey,
    sha256: SHA,
    sizeBytes: 10,
  });

  if (document.content !== undefined) {
    harness.objects.set(objectKey, new TextEncoder().encode(document.content));
  }

  await addPath(harness, {
    id: document.pathId,
    metadata: { filename: document.filename, ...document.pathMetadata },
    resourceType: "document",
    targetId: document.assetId,
    ...(document.version === undefined ? {} : { version: document.version }),
    virtualPath: document.virtualPath,
  });

  return asset;
}

async function addOpenArtifactBackingAsset(harness: Harness, assetId = uuid("cc43")) {
  return harness.assets.create({
    filename: `${assetId}.md`,
    id: assetId,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    mimeType: "text/markdown",
    objectKey: `objects/${assetId}.md`,
    sha256: SHA,
    sizeBytes: 10,
  });
}

async function addOpenSemanticArtifact(harness: Harness, artifactId: string, assetId: string) {
  await addOpenArtifactBackingAsset(harness, assetId);
  await harness.parseArtifacts.create(
    makeParseArtifact({ documentAssetId: assetId, elements: [], id: artifactId }),
  );
}

describe("knowledge-fs command registry coverage", () => {
  it("lists by-community entries and collapses duplicate community directories", async () => {
    const harness = createHarness();
    await addOpenSemanticArtifact(harness, uuid("aa11"), uuid("aa21"));
    await addOpenSemanticArtifact(harness, uuid("aa12"), uuid("aa22"));
    await addPath(harness, {
      id: uuid("aa01"),
      metadata: { communityId: "c1" },
      resourceType: "artifact",
      targetId: uuid("aa11"),
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/c1/a.md",
    });
    await addPath(harness, {
      id: uuid("aa02"),
      resourceType: "artifact",
      targetId: uuid("aa12"),
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/c1/b.md",
    });

    await expect(
      harness.execute("ls", {
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        path: "/knowledge/by-community",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [
          {
            kind: "directory",
            metadata: { communityId: "c1" },
            name: "c1",
            path: "/knowledge/by-community/c1",
          },
        ],
        path: "/knowledge/by-community",
        truncated: false,
      },
    });
  });

  it("paginates by-community listings with cursors", async () => {
    const harness = createHarness();
    await addOpenSemanticArtifact(harness, uuid("aa15"), uuid("aa25"));
    await addOpenSemanticArtifact(harness, uuid("aa16"), uuid("aa26"));
    await addPath(harness, {
      id: uuid("aa05"),
      resourceType: "artifact",
      targetId: uuid("aa15"),
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/c1/a.md",
    });
    await addPath(harness, {
      id: uuid("aa06"),
      resourceType: "artifact",
      targetId: uuid("aa16"),
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/c2/b.md",
    });

    const firstPage = await harness.execute("ls", {
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      path: "/knowledge/by-community",
    });
    const firstOutput = firstPage.output as {
      items: Array<{ name: string }>;
      nextCursor?: string;
      truncated: boolean;
    };

    expect(firstOutput.items.map((item) => item.name)).toEqual(["c1"]);
    expect(firstOutput.truncated).toBe(true);
    expect(firstOutput.nextCursor).toBeDefined();

    await expect(
      harness.execute("ls", {
        cursor: firstOutput.nextCursor,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        path: "/knowledge/by-community",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [{ kind: "directory", name: "c2" }],
      },
    });
  });

  it("paginates by-topic listings with cursors", async () => {
    const harness = createHarness();
    await addOpenSemanticArtifact(harness, uuid("aa13"), uuid("aa23"));
    await addOpenSemanticArtifact(harness, uuid("aa14"), uuid("aa24"));
    await addPath(harness, {
      id: uuid("aa03"),
      resourceType: "artifact",
      targetId: uuid("aa13"),
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/alpha/a.md",
    });
    await addPath(harness, {
      id: uuid("aa04"),
      resourceType: "artifact",
      targetId: uuid("aa14"),
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/beta/b.md",
    });

    const firstPage = await harness.execute("ls", {
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      path: "/knowledge/by-topic",
    });
    const firstOutput = firstPage.output as {
      items: Array<{ name: string }>;
      nextCursor?: string;
      truncated: boolean;
    };

    expect(firstOutput.items.map((item) => item.name)).toEqual(["alpha"]);
    expect(firstOutput.truncated).toBe(true);
    expect(firstOutput.nextCursor).toBeDefined();

    await expect(
      harness.execute("ls", {
        cursor: firstOutput.nextCursor,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        path: "/knowledge/by-topic",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [{ kind: "directory", name: "beta" }],
      },
    });
  });

  it("fails closed for every listing view rather than returning hidden repository cursors", async () => {
    const harness = createHarness();
    const views = [
      {
        command: "ls",
        parentPath: "/knowledge/docs/paged",
        viewName: "docs",
        viewType: "physical",
      },
      {
        command: "tree",
        parentPath: "/knowledge/docs/paged",
        viewName: "docs",
        viewType: "physical",
      },
      {
        command: "ls",
        parentPath: "/knowledge/by-topic",
        viewName: "by-topic",
        viewType: "semantic",
      },
      {
        command: "ls",
        parentPath: "/knowledge/by-community",
        viewName: "by-community",
        viewType: "semantic",
      },
    ] as const;

    for (const [viewIndex, view] of views.entries()) {
      // Tree and physical ls intentionally exercise the same persisted rows.
      if (view.command !== "tree") {
        for (let rowIndex = 0; rowIndex <= 10; rowIndex += 1) {
          const rowName = `${String(rowIndex).padStart(2, "0")}-${rowIndex < 10 ? "hidden" : "visible"}`;
          const virtualPath =
            view.viewType === "physical"
              ? `${view.parentPath}/${rowName}.md`
              : `${view.parentPath}/${rowName}/document.md`;
          await addPath(harness, {
            id: uuid(`d${viewIndex}${rowIndex.toString(16).padStart(2, "0")}`),
            metadata: rowIndex < 10 ? { permissionScope: ["restricted"] } : {},
            resourceType: "source",
            targetId: `target-${viewIndex}-${rowIndex}`,
            viewName: view.viewName,
            viewType: view.viewType,
            virtualPath,
          });
        }
      }

      await expect(
        harness.execute(view.command, {
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          path: view.parentPath,
        }),
      ).rejects.toMatchObject({
        code: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED,
      });
    }
  });

  it("fails closed for find, grep, and by-entity scans that only saw hidden candidates", async () => {
    const graphEntities = Array.from({ length: 11 }, (_value, index) => ({
      aliases: [],
      canonicalKey: `entity-${index}`,
      confidence: 1,
      createdAt: "2026-06-03T00:00:00.000Z",
      extractionVersion: 1,
      id: `entity-${String(index).padStart(2, "0")}`,
      knowledgeSpaceId: SPACE_ID,
      metadata: {},
      name: `Entity ${String(index).padStart(2, "0")}`,
      permissionScope: index < 10 ? ["restricted"] : [],
      sourceNodeIds: [],
      type: "organization" as const,
      updatedAt: "2026-06-03T00:00:00.000Z",
    }));
    const graph = {
      listEntities: async (input: {
        readonly cursor?: { readonly id: string };
        readonly limit: number;
      }) => {
        const start = input.cursor
          ? graphEntities.findIndex((entity) => entity.id === input.cursor?.id) + 1
          : 0;
        const items = graphEntities.slice(start, start + input.limit);
        const last = items.at(-1);
        return {
          items,
          ...(start + items.length < graphEntities.length && last
            ? { nextCursor: { id: last.id, name: last.name } }
            : {}),
        };
      },
    } as unknown as GraphIndexRepository;
    const harness = createHarness({ graph });

    for (let index = 0; index < 10; index += 1) {
      const suffix = String(index).padStart(2, "0");
      await addPath(harness, {
        id: uuid(`e0${suffix}`),
        metadata: { permissionScope: ["restricted"] },
        resourceType: "source",
        targetId: `find-hidden-${suffix}`,
        virtualPath: `/knowledge/docs/find-budget/${suffix}-hidden.md`,
      });
      await addPath(harness, {
        id: uuid(`e1${suffix}`),
        metadata: { permissionScope: ["restricted"] },
        resourceType: "document",
        targetId: uuid(`e2${suffix}`),
        virtualPath: `/knowledge/docs/grep-budget/${suffix}-hidden.md`,
      });
    }
    await addPath(harness, {
      id: uuid("e00a"),
      resourceType: "source",
      targetId: "find-visible",
      virtualPath: "/knowledge/docs/find-budget/10-visible.md",
    });
    await addDocument(harness, {
      assetId: uuid("e20a"),
      content: "needle",
      filename: "10-visible.md",
      pathId: uuid("e10a"),
      virtualPath: "/knowledge/docs/grep-budget/10-visible.md",
    });

    const requests = [
      harness.execute("find", {
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        path: "/knowledge/docs/find-budget",
      }),
      harness.execute("grep", {
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        path: "/knowledge/docs/grep-budget",
        q: "needle",
      }),
      harness.execute("ls", {
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        path: "/knowledge/by-entity",
      }),
    ];
    for (const request of requests) {
      await expect(request).rejects.toBeInstanceOf(CandidateVisibilityScanBudgetExceededError);
    }
  });

  it("hides community summaries unless every referenced document asset is readable", async () => {
    const harness = createHarness();
    const publicAssetId = uuid("d400");
    const restrictedAssetId = uuid("d401");
    await harness.assets.create({
      filename: "public.md",
      id: publicAssetId,
      knowledgeSpaceId: SPACE_ID,
      metadata: {},
      mimeType: "text/markdown",
      objectKey: "objects/public.md",
      sha256: SHA,
      sizeBytes: 10,
    });
    await harness.assets.create({
      filename: "restricted.md",
      id: restrictedAssetId,
      knowledgeSpaceId: SPACE_ID,
      metadata: { permissionScope: ["restricted"] },
      mimeType: "text/markdown",
      objectKey: "objects/restricted.md",
      sha256: SHA,
      sizeBytes: 10,
    });
    await addPath(harness, {
      id: uuid("d410"),
      metadata: {
        documentAssetIds: [publicAssetId, restrictedAssetId],
        summary: "mixed community secret summary",
      },
      resourceType: "workspace",
      targetId: SPACE_ID,
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/mixed",
    });
    await addPath(harness, {
      id: uuid("d411"),
      metadata: { documentAssetIds: [publicAssetId, uuid("d499")], summary: "missing asset" },
      resourceType: "workspace",
      targetId: SPACE_ID,
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/missing",
    });
    await addPath(harness, {
      id: uuid("d412"),
      metadata: { documentAssetIds: "malformed", summary: "malformed closure" },
      resourceType: "workspace",
      targetId: SPACE_ID,
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/malformed",
    });

    const denied = await harness.execute("ls", {
      knowledgeSpaceId: SPACE_ID,
      limit: 10,
      path: "/knowledge/by-community",
    });
    expect(JSON.stringify(denied.output)).not.toContain("mixed community secret summary");
    expect(JSON.stringify(denied.output)).not.toContain(restrictedAssetId);
    await expect(
      harness.execute("stat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-community/mixed",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-community/mixed",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");

    const allowed = await harness.execute("ls", {
      candidatePermissionScope: ["restricted"],
      knowledgeSpaceId: SPACE_ID,
      limit: 10,
      path: "/knowledge/by-community",
    });
    const allowedText = JSON.stringify(allowed.output);
    expect(allowedText).toContain("mixed community secret summary");
    expect(allowedText).not.toContain("missing asset");
    expect(allowedText).not.toContain("malformed closure");
    await expect(
      harness.execute("stat", {
        candidatePermissionScope: ["restricted"],
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-community/mixed",
      }),
    ).resolves.toMatchObject({
      output: { metadata: { summary: "mixed community secret summary" } },
    });
  });

  it("requires both node and backing asset permission in entity and direct node views", async () => {
    const nodeId = uuid("d500");
    const assetId = uuid("d501");
    const entity = {
      aliases: [],
      canonicalKey: "legacy-entity",
      confidence: 1,
      createdAt: "2026-06-03T00:00:00.000Z",
      extractionVersion: 1,
      id: "legacy-entity",
      knowledgeSpaceId: SPACE_ID,
      metadata: {},
      name: "Legacy Entity",
      permissionScope: [],
      sourceNodeIds: [nodeId],
      type: "organization" as const,
      updatedAt: "2026-06-03T00:00:00.000Z",
    };
    const graph = {
      listEntities: async () => ({ items: [entity] }),
      traverse: async () => ({
        entities: [{ ...entity, depth: 0 }],
        metrics: {
          depthReached: 0,
          elapsedMs: 1,
          exploredRelations: 0,
          fanout: 1,
          maxDepth: 2,
          maxNodes: 4,
          timedOut: false,
        },
        relations: [],
        truncated: false,
      }),
    } as unknown as GraphIndexRepository;
    const harness = createHarness({ graph });
    await harness.assets.create({
      filename: "restricted.md",
      id: assetId,
      knowledgeSpaceId: SPACE_ID,
      metadata: { permissionScope: ["restricted"] },
      mimeType: "text/markdown",
      objectKey: "objects/restricted-entity.md",
      sha256: SHA,
      sizeBytes: 10,
    });
    await harness.nodes.createMany([
      makeNode({
        documentAssetId: assetId,
        id: nodeId,
        kind: "chunk",
        permissionScope: [],
        text: "legacy node on a restricted asset",
      }),
    ]);

    await expect(
      harness.execute("ls", {
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        path: "/knowledge/by-entity",
      }),
    ).resolves.toMatchObject({ output: { items: [] } });
    await expect(
      harness.execute("ls", {
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        path: "/knowledge/by-entity/legacy-entity",
      }),
    ).resolves.toMatchObject({ output: { items: [] } });
    await expect(
      harness.execute("open_node", { knowledgeSpaceId: SPACE_ID, nodeId }),
    ).rejects.toThrow("KnowledgeFS node not found");

    await expect(
      harness.execute("ls", {
        candidatePermissionScope: ["restricted"],
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        path: "/knowledge/by-entity",
      }),
    ).resolves.toMatchObject({ output: { items: [{ targetId: "legacy-entity" }] } });
    await expect(
      harness.execute("ls", {
        candidatePermissionScope: ["restricted"],
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        path: "/knowledge/by-entity/legacy-entity",
      }),
    ).resolves.toMatchObject({ output: { items: [{ targetId: assetId }] } });
    await expect(
      harness.execute("open_node", {
        candidatePermissionScope: ["restricted"],
        knowledgeSpaceId: SPACE_ID,
        nodeId,
      }),
    ).resolves.toMatchObject({ output: { node: { id: nodeId } } });
  });

  it("lists by-entity documents as empty when traversal has no source nodes", async () => {
    const graph = {
      traverse: async () => ({
        entities: [
          {
            aliases: [],
            canonicalKey: "acme",
            confidence: 1,
            createdAt: "2026-06-03T00:00:00.000Z",
            depth: 0,
            extractionVersion: 1,
            id: "entity-1",
            knowledgeSpaceId: SPACE_ID,
            metadata: {},
            name: "Acme",
            permissionScope: [],
            sourceNodeIds: [],
            type: "organization",
            updatedAt: "2026-06-03T00:00:00.000Z",
          },
        ],
        metrics: {
          depthReached: 1,
          elapsedMs: 1,
          exploredRelations: 0,
          fanout: 5,
          maxDepth: 2,
          maxNodes: 20,
          timedOut: false,
        },
        relations: [],
        truncated: false,
      }),
    } as unknown as GraphIndexRepository;
    const harness = createHarness({ graph });

    await expect(
      harness.execute("ls", {
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        path: "/knowledge/by-entity/entity-1",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [],
        path: "/knowledge/by-entity/entity-1",
        truncated: false,
      },
    });
  });

  it("finds exact paths and applies metadata filters on directories", async () => {
    const harness = createHarness();
    await addDocument(harness, {
      assetId: uuid("ab01"),
      filename: "aaa.md",
      pathId: uuid("ab02"),
      virtualPath: "/knowledge/docs/aaa.md",
    });

    await expect(
      harness.execute("find", {
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        path: "/knowledge/docs/aaa.md",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [
          {
            kind: "resource",
            name: "aaa.md",
            path: "/knowledge/docs/aaa.md",
            resourceType: "document",
            targetId: uuid("ab01"),
          },
        ],
        path: "/knowledge/docs/aaa.md",
        truncated: false,
      },
    });
    await expect(
      harness.execute("find", {
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        metadataKey: "flavor",
        metadataValue: "spicy",
        path: "/knowledge/docs",
      }),
    ).resolves.toMatchObject({
      output: { items: [], truncated: false },
    });
    await expect(
      harness.execute("find", {
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        metadataKey: "filename",
        metadataValue: "aaa.md",
        path: "/knowledge/docs",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [{ name: "aaa.md" }],
        truncated: false,
      },
    });
  });

  it("resumes directory finds from an encoded cursor", async () => {
    const harness = createHarness();
    await addDocument(harness, {
      assetId: uuid("ab11"),
      filename: "aaa.md",
      pathId: uuid("ab12"),
      virtualPath: "/knowledge/docs/aaa.md",
    });
    await addDocument(harness, {
      assetId: uuid("ab13"),
      filename: "bbb.md",
      pathId: uuid("ab14"),
      virtualPath: "/knowledge/docs/bbb.md",
    });

    const firstPage = await harness.execute("find", {
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      nameContains: "md",
      path: "/knowledge/docs",
    });
    const firstOutput = firstPage.output as {
      items: Array<{ name: string }>;
      nextCursor?: string;
      truncated: boolean;
    };

    expect(firstOutput.items.map((item) => item.name)).toEqual(["aaa.md"]);
    expect(firstOutput.truncated).toBe(true);
    expect(firstOutput.nextCursor).toBeDefined();

    await expect(
      harness.execute("find", {
        cursor: firstOutput.nextCursor,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        nameContains: "md",
        path: "/knowledge/docs",
      }),
    ).resolves.toMatchObject({
      output: {
        items: [{ name: "bbb.md" }],
        truncated: false,
      },
    });
  });

  it("filters and paginates artifact segment finds", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const artifactId = uuid("ac00");
    await addPath(harness, {
      id: uuid("ac01"),
      resourceType: "artifact",
      targetId: artifactId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/seg.md",
    });
    await harness.artifactSegments.createMany({
      segments: [
        makeSegment({
          artifactId,
          id: uuid("ac02"),
          index: 0,
          inlineText: "alpha",
          metadata: { rank: 7 },
        }),
        makeSegment({ artifactId, id: uuid("ac03"), index: 1, inlineText: "bravo" }),
        makeSegment({ artifactId, id: uuid("ac04"), index: 2, inlineText: "charlie" }),
      ],
    });
    const find = (input: Record<string, unknown>) =>
      harness.execute("find", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/seg.md",
        ...input,
      });

    await expect(find({ limit: 1 })).resolves.toMatchObject({
      output: {
        items: [{ name: "segment-0" }],
        nextCursor: "0",
        truncated: true,
      },
    });

    const afterCursor = await find({ cursor: "0", limit: 5 });

    expect(
      (afterCursor.output as { items: Array<{ name: string }> }).items.map((item) => item.name),
    ).toEqual(["segment-1", "segment-2"]);
    await expect(find({ limit: 5, resourceType: "document" })).resolves.toMatchObject({
      output: { items: [] },
    });
    await expect(find({ limit: 5, nameContains: "zzz" })).resolves.toMatchObject({
      output: { items: [] },
    });
    await expect(
      find({ limit: 5, metadataKey: "rank", metadataValue: "7" }),
    ).resolves.toMatchObject({
      output: { items: [{ name: "segment-0" }] },
    });
    await expect(find({ limit: 1, nameContains: "segment-0" })).resolves.toMatchObject({
      output: {
        items: [{ name: "segment-0" }],
        nextCursor: "1",
        truncated: true,
      },
    });
  });

  it("greps exact node and document paths", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const nodeId = uuid("ad01");
    await harness.nodes.createMany([
      makeNode({ id: nodeId, kind: "chunk", text: "alpha needle beta" }),
    ]);
    await addPath(harness, {
      id: uuid("ad02"),
      resourceType: "node",
      targetId: nodeId,
      virtualPath: "/knowledge/docs/note-node",
    });
    await addDocument(harness, {
      assetId: uuid("ad03"),
      content: "the needle text",
      filename: "readme.md",
      pathId: uuid("ad04"),
      virtualPath: "/knowledge/docs/readme.md",
    });
    await addDocument(harness, {
      assetId: uuid("ad05"),
      filename: "ghost.md",
      pathId: uuid("ad06"),
      virtualPath: "/knowledge/docs/ghost.md",
    });

    await expect(
      harness.execute("grep", {
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        path: "/knowledge/docs/note-node",
        q: "needle",
      }),
    ).resolves.toMatchObject({
      output: {
        matches: [
          {
            endOffset: 12,
            kind: "node",
            nodeId,
            path: "/knowledge/docs/note-node",
            snippet: "alpha needle beta",
            startOffset: 6,
          },
        ],
        truncated: false,
      },
    });
    await expect(
      harness.execute(
        "grep",
        {
          knowledgeSpaceId: SPACE_ID,
          limit: 5,
          path: "/knowledge/docs/readme.md",
          q: "needle",
        },
        READER_WITHOUT_TENANT,
      ),
    ).resolves.toMatchObject({
      output: {
        matches: [
          {
            endOffset: 10,
            kind: "segment",
            path: "/knowledge/docs/readme.md",
            snippet: "the needle text",
            startOffset: 4,
          },
        ],
        truncated: false,
      },
    });
    await expect(
      harness.execute(
        "grep",
        {
          knowledgeSpaceId: SPACE_ID,
          limit: 5,
          path: "/knowledge/docs/ghost.md",
          q: "needle",
        },
        READER_WITHOUT_TENANT,
      ),
    ).resolves.toMatchObject({
      output: { matches: [], truncated: false },
    });
  });

  it("skips non-content descendants during directory grep scans", async () => {
    const harness = createHarness();
    await addPath(harness, {
      id: uuid("ae01"),
      resourceType: "workspace",
      targetId: "ws-1",
      virtualPath: "/knowledge/docs/ws-item",
    });
    await addDocument(harness, {
      assetId: uuid("ae02"),
      content: "needle here",
      filename: "hit.md",
      pathId: uuid("ae03"),
      virtualPath: "/knowledge/docs/hit.md",
    });

    await expect(
      harness.execute(
        "grep",
        {
          knowledgeSpaceId: SPACE_ID,
          limit: 5,
          path: "/knowledge/docs",
          q: "needle",
        },
        READER_WITHOUT_TENANT,
      ),
    ).resolves.toMatchObject({
      output: {
        matches: [{ kind: "segment", path: "/knowledge/docs/hit.md", startOffset: 0 }],
        truncated: false,
      },
    });
  });

  it("greps artifact segments with offsets, cursors, and repository pagination", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const artifactId = uuid("af00");
    await addPath(harness, {
      id: uuid("af01"),
      resourceType: "artifact",
      targetId: artifactId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/grep.md",
    });
    await harness.artifactSegments.createMany({
      segments: [
        makeSegment({
          artifactId,
          id: uuid("af02"),
          index: 0,
          inlineText: "nothing here",
          startOffset: 0,
        }),
        makeSegment({ artifactId, id: uuid("af03"), index: 1, inlineText: "the needle text" }),
        makeSegment({
          artifactId,
          id: uuid("af04"),
          index: 2,
          inlineText: "needle again",
          startOffset: 20,
        }),
      ],
    });
    const grep = (input: Record<string, unknown>) =>
      harness.execute("grep", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/grep.md",
        q: "needle",
        ...input,
      });
    const fullScan = await grep({ limit: 5 });

    expect(fullScan.output).toMatchObject({
      matches: [
        { endOffset: 10, segmentId: uuid("af03"), startOffset: 4 },
        { endOffset: 26, segmentId: uuid("af04"), startOffset: 20 },
      ],
      truncated: false,
    });
    expect(fullScan.output).not.toHaveProperty("nextCursor");
    await expect(grep({ limit: 1 })).resolves.toMatchObject({
      output: {
        matches: [{ segmentId: uuid("af03") }],
        nextCursor: "1",
        truncated: true,
      },
    });
    await expect(grep({ cursor: "0", limit: 5 })).resolves.toMatchObject({
      output: {
        matches: [{ segmentId: uuid("af03") }, { segmentId: uuid("af04") }],
        truncated: false,
      },
    });
  });

  it("covers artifact cat edge cases and invalid cursors", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const artifactId = uuid("b000");
    await addPath(harness, {
      id: uuid("b001"),
      resourceType: "artifact",
      targetId: artifactId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/plain.md",
    });
    await harness.artifactSegments.createMany({
      segments: [makeSegment({ artifactId, id: uuid("b002"), index: 0, inlineText: "hello" })],
    });
    await addPath(harness, {
      id: uuid("b003"),
      resourceType: "workspace",
      targetId: "ws-2",
      virtualPath: "/knowledge/docs/opaque",
    });

    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/plain.md",
      }),
    ).resolves.toMatchObject({
      output: {
        contentType: "text/plain",
        text: "hello",
        truncated: false,
      },
    });
    await expect(
      harness.execute("cat", {
        cursor: "9",
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/plain.md",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      harness.execute("cat", {
        cursor: "abc",
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/plain.md",
      }),
    ).rejects.toThrow("Invalid artifact segment cursor");
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/opaque",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
  });

  it("reads artifact segment bodies from object storage", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const artifactId = uuid("b010");
    await addPath(harness, {
      id: uuid("b011"),
      metadata: { contentType: "text/markdown" },
      resourceType: "artifact",
      targetId: artifactId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/stored.md",
    });
    await harness.artifactSegments.createMany({
      segments: [makeSegment({ artifactId, id: uuid("b012"), index: 0, objectKey: "segments/f0" })],
    });
    harness.objects.set("segments/f0", new TextEncoder().encode("from object storage"));

    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/stored.md",
      }),
    ).resolves.toMatchObject({
      output: {
        contentType: "text/markdown",
        text: "from object storage",
        truncated: false,
      },
    });
  });

  it("pages legacy parse artifacts with cursors and maps content types", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    await addOpenArtifactBackingAsset(harness, uuid("b024"));
    await addOpenArtifactBackingAsset(harness, uuid("b027"));
    const legacyId = uuid("b020");
    await addPath(harness, {
      id: uuid("b021"),
      resourceType: "artifact",
      targetId: legacyId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/legacy.md",
    });
    await harness.parseArtifacts.create(
      makeParseArtifact({
        elements: [
          { id: "e0", metadata: {}, text: "one ", type: "paragraph" },
          { id: "e1", metadata: {}, type: "paragraph" },
          { id: "e2", metadata: {}, text: "three", type: "paragraph" },
        ],
        id: legacyId,
      }),
    );
    const structuredId = uuid("b022");
    await addPath(harness, {
      id: uuid("b023"),
      resourceType: "artifact",
      targetId: structuredId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/structured.json",
    });
    await harness.parseArtifacts.create(
      makeParseArtifact({
        contentType: "structured",
        documentAssetId: uuid("b024"),
        elements: [{ id: "s0", metadata: {}, text: "{}", type: "paragraph" }],
        id: structuredId,
      }),
    );
    const mixedId = uuid("b025");
    await addPath(harness, {
      id: uuid("b026"),
      resourceType: "artifact",
      targetId: mixedId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/mixed.md",
    });
    await harness.parseArtifacts.create(
      makeParseArtifact({
        contentType: "mixed",
        documentAssetId: uuid("b027"),
        elements: [{ id: "m0", metadata: {}, text: "mix", type: "paragraph" }],
        id: mixedId,
      }),
    );

    const paged = await harness.execute("cat", {
      cursor: "0",
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/by-topic/legacy.md",
    });

    expect(paged.output).toEqual({
      contentType: "text/plain",
      path: "/knowledge/by-topic/legacy.md",
      text: "three",
      truncated: false,
    });
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        path: "/knowledge/by-topic/structured.json",
      }),
    ).resolves.toMatchObject({
      output: { contentType: "application/json", text: "{}" },
    });
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        path: "/knowledge/by-topic/mixed.md",
      }),
    ).resolves.toMatchObject({
      output: { contentType: "text/markdown", text: "mix" },
    });
  });

  it("renders table nodes as html with normalized rows", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const tableId = uuid("b030");
    await harness.nodes.createMany([
      makeNode({
        id: tableId,
        kind: "table",
        text: '{"columns":["a","b"],"rows":[["1"],{"a":"x"},7]}',
      }),
    ]);
    await addPath(harness, {
      id: uuid("b031"),
      resourceType: "node",
      targetId: tableId,
      virtualPath: "/knowledge/docs/table.html",
    });

    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/table.html",
      }),
    ).resolves.toMatchObject({
      output: {
        contentType: "text/html",
        text: "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td></td></tr><tr><td>x</td><td></td></tr><tr><td></td><td></td></tr></tbody></table>",
      },
    });
  });

  it("falls back to preformatted text for unusable table payloads", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const cases: Array<{ readonly id: string; readonly pathId: string; readonly text: string }> = [
      { id: uuid("b040"), pathId: uuid("b041"), text: "[1,2]" },
      { id: uuid("b042"), pathId: uuid("b043"), text: '{"foo":1}' },
      { id: uuid("b044"), pathId: uuid("b045"), text: '{"columns":[],"rows":[]}' },
    ];

    for (const [index, tableCase] of cases.entries()) {
      const startOffset = index * 11;
      await harness.nodes.createMany([
        makeNode({
          endOffset: startOffset + 10,
          id: tableCase.id,
          kind: "table",
          startOffset,
          text: tableCase.text,
        }),
      ]);
      await addPath(harness, {
        id: tableCase.pathId,
        resourceType: "node",
        targetId: tableCase.id,
        virtualPath: `/knowledge/docs/table-${index}.html`,
      });

      const result = await harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: `/knowledge/docs/table-${index}.html`,
      });

      expect((result.output as { text: string }).text).toBe(
        `<pre>${tableCase.text.replaceAll('"', "&quot;")}</pre>`,
      );
    }
  });

  it("renders image node offsets from source location or node offsets", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const locatedId = uuid("b050");
    const bareId = uuid("b051");
    await harness.nodes.createMany([
      makeNode({
        endOffset: 9,
        id: locatedId,
        kind: "image",
        sourceLocation: { endOffset: 9, sectionPath: ["S"], startOffset: 3 },
        startOffset: 3,
        text: "ocr body",
      }),
      makeNode({ id: bareId, kind: "image", text: "ocr body" }),
    ]);
    await addPath(harness, {
      id: uuid("b052"),
      resourceType: "node",
      targetId: locatedId,
      virtualPath: "/knowledge/docs/figure-located",
    });
    await addPath(harness, {
      id: uuid("b053"),
      resourceType: "node",
      targetId: bareId,
      virtualPath: "/knowledge/docs/figure-bare",
    });

    const located = await harness.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/figure-located",
    });
    const bare = await harness.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/figure-bare",
    });

    expect((located.output as { text: string }).text).toContain("- Offsets: 3-9");
    expect((located.output as { text: string }).text).toContain("- Section: S");
    expect((bare.output as { text: string }).text).toContain("- Offsets: 0-10");
    expect((bare.output as { text: string }).text).toContain("- Section: Document");
  });

  it("builds open_node citations from source locations and node offsets", async () => {
    const harness = createHarness();
    await addOpenArtifactBackingAsset(harness);
    const fullId = uuid("b060");
    const bareId = uuid("b061");
    await harness.nodes.createMany([
      makeNode({
        endOffset: 31,
        id: fullId,
        kind: "chunk",
        sourceLocation: { endOffset: 20, pageNumber: 2, sectionPath: ["Intro"], startOffset: 5 },
        startOffset: 2,
        text: "full node",
      }),
      makeNode({ endOffset: 30, id: bareId, kind: "chunk", startOffset: 1, text: "bare node" }),
    ]);

    const full = await harness.execute("open_node", {
      knowledgeSpaceId: SPACE_ID,
      nodeId: fullId,
    });
    const bare = await harness.execute("open_node", {
      knowledgeSpaceId: SPACE_ID,
      nodeId: bareId,
    });

    expect((full.output as { citation: unknown }).citation).toEqual({
      artifactHash: "a".repeat(64),
      documentAssetId: uuid("cc43"),
      endOffset: 20,
      pageNumber: 2,
      parseArtifactId: uuid("cc44"),
      sectionPath: ["Intro"],
      startOffset: 5,
    });
    expect((bare.output as { citation: unknown }).citation).toEqual({
      artifactHash: "a".repeat(64),
      documentAssetId: uuid("cc43"),
      endOffset: 30,
      parseArtifactId: uuid("cc44"),
      sectionPath: [],
      startOffset: 1,
    });
  });

  it("diffs paths without a tenant and summarizes without a model", async () => {
    const provider: SemanticDiffProvider = {
      summarize: async () => ({
        changes: [{ category: "content", evidence: ["old text"], summary: "changed" }],
        metadata: {},
        summary: "summary without model",
      }),
    };
    const harness = createHarness({ semanticDiffProvider: provider });
    await addOpenArtifactBackingAsset(harness);
    const oldArtifact = uuid("b070");
    const newArtifact = uuid("b071");
    await addPath(harness, {
      id: uuid("b072"),
      resourceType: "artifact",
      targetId: oldArtifact,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/old.md",
    });
    await addPath(harness, {
      id: uuid("b073"),
      resourceType: "artifact",
      targetId: newArtifact,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/new.md",
    });
    await harness.artifactSegments.createMany({
      segments: [
        makeSegment({
          artifactId: oldArtifact,
          id: uuid("b074"),
          index: 0,
          inlineText: "old text",
        }),
        makeSegment({
          artifactId: newArtifact,
          id: uuid("b075"),
          index: 0,
          inlineText: "new text",
        }),
      ],
    });

    await expect(
      harness.execute(
        "diff",
        {
          knowledgeSpaceId: SPACE_ID,
          newPath: "/knowledge/by-topic/new.md",
          oldPath: "/knowledge/by-topic/old.md",
        },
        READER_WITHOUT_TENANT,
      ),
    ).resolves.toMatchObject({
      output: {
        mode: "line",
        newPath: "/knowledge/by-topic/new.md",
        oldPath: "/knowledge/by-topic/old.md",
        operations: [
          { kind: "delete", text: "old text" },
          { kind: "insert", text: "new text" },
        ],
        stats: { delete: 1, equal: 0, insert: 1 },
      },
    });

    const semantic = await harness.execute("diff", {
      knowledgeSpaceId: SPACE_ID,
      newPath: "/knowledge/by-topic/new.md",
      oldPath: "/knowledge/by-topic/old.md",
      semantic: "true",
    });

    expect((semantic.output as { semantic: unknown }).semantic).toEqual({
      changes: [{ category: "content", evidence: ["old text"], summary: "changed" }],
      metadata: {},
      summary: "summary without model",
    });
  });

  it("cats documents without a tenant id", async () => {
    const harness = createHarness();
    await addDocument(harness, {
      assetId: uuid("b080"),
      content: "tenantless body",
      filename: "open.md",
      pathId: uuid("b081"),
      virtualPath: "/knowledge/docs/open.md",
    });

    await expect(
      harness.execute(
        "cat",
        { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/open.md" },
        READER_WITHOUT_TENANT,
      ),
    ).resolves.toMatchObject({
      output: {
        contentType: "text/markdown",
        text: "tenantless body",
        truncated: false,
      },
    });
  });

  it("serves document outlines by version and rejects missing outlines", async () => {
    const harness = createHarness();
    const assetId = uuid("b090");
    const outlineId = uuid("b091");
    await addDocument(harness, {
      assetId,
      filename: "outlined.md",
      pathId: uuid("b092"),
      pathMetadata: { contentKind: "document-outline" },
      version: 1,
      virtualPath: "/knowledge/docs/outlined.md",
    });
    await addPath(harness, {
      id: uuid("b093"),
      metadata: { contentKind: "document-outline" },
      resourceType: "document",
      targetId: assetId,
      virtualPath: "/knowledge/docs/outline-missing.md",
    });
    await harness.outlines.create(
      DocumentOutlineSchema.parse({
        artifactHash: "a".repeat(64),
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: assetId,
        id: outlineId,
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        nodes: [makeOutlineNode({ id: "n1", sectionPath: ["Intro"], title: "Intro" })],
        outlineVersion: "v1",
        parseArtifactId: uuid("b094"),
        version: 1,
      }),
    );

    const found = await harness.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/outlined.md",
    });

    expect((found.output as { contentType: string }).contentType).toBe("application/json");
    expect(JSON.parse((found.output as { text: string }).text).id).toBe(outlineId);

    // Same asset, but this path has no version pinned and version fallback also has no outline
    // at a different version once the outline map misses.
    await harness.assets.updateParserStatus({
      id: assetId,
      knowledgeSpaceId: SPACE_ID,
      parserStatus: "parsed",
    });
    await harness.outlines.deleteByDocumentAsset({ documentAssetId: assetId, maxOutlines: 5 });
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/outline-missing.md",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
  });

  it("serves multimodal manifests through the enhancer and rejects missing artifacts", async () => {
    const enhancer = {
      enhance: async ({ manifest }: { manifest: Record<string, unknown> }) => ({
        ...manifest,
        enhanced: true,
        items: [{ assetRef: { contentType: "image/png" }, id: "item-1" }, { id: "item-2" }],
      }),
      model: "test-model",
      promptVersion: "v1",
    } as unknown as DocumentMultimodalManifestEnhancer;
    const harness = createHarness({ enhancer });
    const assetId = uuid("b0a0");
    await addDocument(harness, {
      assetId,
      filename: "media.md",
      pathId: uuid("b0a1"),
      pathMetadata: { contentKind: "document-multimodal-manifest" },
      version: 1,
      virtualPath: "/knowledge/docs/media-manifest.json",
    });
    await addPath(harness, {
      id: uuid("b0a2"),
      metadata: { contentKind: "document-multimodal-manifest" },
      resourceType: "document",
      targetId: assetId,
      virtualPath: "/knowledge/docs/manifest-missing.json",
    });

    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/manifest-missing.json",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");

    await harness.parseArtifacts.create(
      makeParseArtifact({
        documentAssetId: assetId,
        elements: [{ id: "p0", metadata: {}, text: "plain", type: "paragraph" }],
        id: uuid("b0a3"),
      }),
    );

    const manifest = await harness.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/media-manifest.json",
    });

    expect((manifest.output as { contentType: string }).contentType).toBe("application/json");
    expect((manifest.output as { text: string }).text).toContain('"enhanced": true');

    const tenantless = await harness.execute(
      "cat",
      { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/media-manifest.json" },
      READER_WITHOUT_TENANT,
    );

    expect((tenantless.output as { text: string }).text).toContain('"enhanced": true');
  });

  it("resolves multimodal asset descriptors and rejects unresolved items", async () => {
    const enhancer = {
      enhance: async ({ manifest }: { manifest: Record<string, unknown> }) => ({
        ...manifest,
        items: [
          { assetRef: { contentType: "image/png" }, id: "item-1" },
          { id: "item-2" },
          {
            assetRef: {
              objectKey: "assets/full.png",
              variants: { thumbnail: { objectKey: "assets/thumb.png" } },
            },
            id: "item-3",
          },
        ],
      }),
      model: "test-model",
      promptVersion: "v1",
    } as unknown as DocumentMultimodalManifestEnhancer;
    const bare = createHarness();
    const bareAssetId = uuid("b0b0");
    await addDocument(bare, {
      assetId: bareAssetId,
      filename: "asset-doc.md",
      pathId: uuid("b0b1"),
      pathMetadata: { contentKind: "document-multimodal-asset", itemId: "item-1" },
      virtualPath: "/knowledge/docs/asset-no-artifact.json",
    });

    // No parse artifact at all.
    await expect(
      bare.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/asset-no-artifact.json",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");

    await bare.parseArtifacts.create(
      makeParseArtifact({
        documentAssetId: bareAssetId,
        elements: [{ id: "p0", metadata: {}, text: "plain", type: "paragraph" }],
        id: uuid("b0b2"),
      }),
    );
    await addPath(bare, {
      id: uuid("b0b3"),
      metadata: { contentKind: "document-multimodal-asset" },
      resourceType: "document",
      targetId: bareAssetId,
      version: 1,
      virtualPath: "/knowledge/docs/asset-no-item-id.json",
    });
    await addPath(bare, {
      id: uuid("b0b4"),
      metadata: { contentKind: "document-multimodal-asset", itemId: "missing" },
      resourceType: "document",
      targetId: bareAssetId,
      version: 1,
      virtualPath: "/knowledge/docs/asset-missing-item.json",
    });

    // Artifact exists but itemId metadata is absent, then the item cannot be found.
    await expect(
      bare.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/asset-no-item-id.json",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      bare.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/asset-missing-item.json",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");

    const enhanced = createHarness({ enhancer });
    const assetId = uuid("b0b5");
    await addDocument(enhanced, {
      assetId,
      filename: "asset-hit.md",
      pathId: uuid("b0b6"),
      pathMetadata: { contentKind: "document-multimodal-asset", itemId: "item-1" },
      version: 1,
      virtualPath: "/knowledge/docs/asset-hit.json",
    });
    await enhanced.parseArtifacts.create(
      makeParseArtifact({
        documentAssetId: assetId,
        elements: [{ id: "p0", metadata: {}, text: "plain", type: "paragraph" }],
        id: uuid("b0b7"),
      }),
    );
    await addPath(enhanced, {
      id: uuid("b0b8"),
      metadata: { contentKind: "document-multimodal-figure", itemId: "item-1" },
      resourceType: "document",
      targetId: assetId,
      version: 1,
      virtualPath: "/knowledge/docs/figure-descriptor.json",
    });

    await addPath(enhanced, {
      id: uuid("b0b9"),
      metadata: { contentKind: "document-multimodal-table", itemId: "item-2" },
      resourceType: "document",
      targetId: assetId,
      version: 1,
      virtualPath: "/knowledge/docs/table-descriptor.json",
    });
    await addPath(enhanced, {
      id: uuid("b0ba"),
      metadata: { contentKind: "document-multimodal-page-thumbnail", itemId: "item-3" },
      resourceType: "document",
      targetId: assetId,
      version: 1,
      virtualPath: "/knowledge/docs/thumb-descriptor.json",
    });

    const assetResult = await enhanced.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/asset-hit.json",
    });
    const assetText = (assetResult.output as { text: string }).text;

    expect(assetText).toContain('"itemId": "item-1"');
    expect(assetText).not.toContain("assetUrl");
    expect(assetText).not.toContain("thumbnail");

    const tenantlessAsset = await enhanced.execute(
      "cat",
      { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/asset-hit.json" },
      READER_WITHOUT_TENANT,
    );

    expect((tenantlessAsset.output as { text: string }).text).toContain('"itemId": "item-1"');

    const descriptorResult = await enhanced.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/figure-descriptor.json",
    });
    const descriptorText = (descriptorResult.output as { text: string }).text;

    expect(descriptorText).toContain('"resourceKind": "figure"');
    expect(descriptorText).toContain('"itemId": "item-1"');

    const tenantlessDescriptor = await enhanced.execute(
      "cat",
      { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/figure-descriptor.json" },
      READER_WITHOUT_TENANT,
    );

    expect((tenantlessDescriptor.output as { text: string }).text).toContain(
      '"resourceKind": "figure"',
    );

    const tableDescriptor = await enhanced.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/table-descriptor.json",
    });
    const tableText = (tableDescriptor.output as { text: string }).text;

    expect(tableText).toContain('"resourceKind": "table"');
    expect(tableText).not.toContain('"assetRef"');

    const thumbDescriptor = await enhanced.execute("cat", {
      knowledgeSpaceId: SPACE_ID,
      path: "/knowledge/docs/thumb-descriptor.json",
    });
    const thumbText = (thumbDescriptor.output as { text: string }).text;

    expect(thumbText).toContain('"resourceKind": "page-thumbnail"');
    expect(thumbText).toContain('"assetUrl"');
    expect(thumbText).toContain('"thumbnailAssetUrl"');
  });

  it("rejects descriptor reads without an enhancer when items are unresolved", async () => {
    const harness = createHarness();
    const assetId = uuid("b100");
    await addDocument(harness, {
      assetId,
      filename: "descriptor-doc.md",
      pathId: uuid("b101"),
      pathMetadata: { contentKind: "document-multimodal-table", itemId: "item-x" },
      virtualPath: "/knowledge/docs/descriptor-fallback.json",
    });
    await harness.parseArtifacts.create(
      makeParseArtifact({
        documentAssetId: assetId,
        elements: [{ id: "p0", metadata: {}, text: "plain", type: "paragraph" }],
        id: uuid("b102"),
      }),
    );
    await addPath(harness, {
      id: uuid("b103"),
      metadata: { contentKind: "document-multimodal-figure" },
      resourceType: "document",
      targetId: assetId,
      version: 1,
      virtualPath: "/knowledge/docs/descriptor-no-item-id.json",
    });
    const orphanAssetId = uuid("b104");
    await addDocument(harness, {
      assetId: orphanAssetId,
      filename: "descriptor-orphan.md",
      pathId: uuid("b105"),
      pathMetadata: { contentKind: "document-multimodal-figure", itemId: "item-x" },
      virtualPath: "/knowledge/docs/descriptor-no-artifact.json",
    });

    // Deterministic manifest has no items, so the descriptor item cannot resolve.
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/descriptor-fallback.json",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/descriptor-no-item-id.json",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/descriptor-no-artifact.json",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
  });

  it("rejects artifact segments whose stored bodies are missing", async () => {
    const harness = createHarness();
    const artifactId = uuid("b110");
    await addPath(harness, {
      id: uuid("b111"),
      resourceType: "artifact",
      targetId: artifactId,
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/void.md",
    });
    await harness.artifactSegments.createMany({
      segments: [
        makeSegment({ artifactId, id: uuid("b112"), index: 0, objectKey: "segments/void" }),
      ],
    });

    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/void.md",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
  });

  it("renders document sections and falls back to summaries", async () => {
    const harness = createHarness();
    const assetId = uuid("b0c0");
    await addDocument(harness, {
      assetId,
      filename: "sectioned.md",
      mimeType: "application/pdf",
      pathId: uuid("b0c1"),
      pathMetadata: { contentKind: "document-section", outlineNodeId: "n2" },
      version: 1,
      virtualPath: "/knowledge/docs/section-ok.md",
    });
    await harness.parseArtifacts.create(
      makeParseArtifact({
        documentAssetId: assetId,
        elements: [
          {
            id: "e1",
            metadata: {},
            sectionPath: ["Intro", "Sub"],
            text: "Doc Title",
            type: "title",
          },
          { id: "e2", metadata: {}, sectionPath: ["Intro", "Sub"], text: "H", type: "heading" },
          { id: "e3", metadata: {}, sectionPath: ["Intro", "Sub"], text: "x=1", type: "code" },
          { id: "e4", metadata: {}, sectionPath: ["Intro", "Sub"], text: "   ", type: "paragraph" },
          { id: "e5", metadata: {}, sectionPath: ["Other"], text: "Other", type: "paragraph" },
        ],
        id: uuid("b0c2"),
      }),
    );
    await harness.outlines.create(
      DocumentOutlineSchema.parse({
        artifactHash: "a".repeat(64),
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: assetId,
        id: uuid("b0c3"),
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        nodes: [
          makeOutlineNode({
            children: [makeOutlineNode({ id: "n2", sectionPath: ["Intro", "Sub"], title: "Sub" })],
            id: "n1",
            sectionPath: ["Intro"],
            title: "Intro",
          }),
          makeOutlineNode({
            id: "n3",
            sectionPath: ["Empty"],
            summary: "Sec summary",
            title: "Empty Section",
          }),
          makeOutlineNode({ id: "n4", sectionPath: ["Void"], title: "Void Section" }),
        ],
        outlineVersion: "v1",
        parseArtifactId: uuid("b0c2"),
        version: 1,
      }),
    );
    const sectionPaths: Array<{
      readonly metadata: Record<string, unknown>;
      readonly pathId: string;
      readonly virtualPath: string;
    }> = [
      {
        metadata: { contentKind: "document-section" },
        pathId: uuid("b0c4"),
        virtualPath: "/knowledge/docs/section-no-node-id.md",
      },
      {
        metadata: { contentKind: "document-section", outlineNodeId: "ghost" },
        pathId: uuid("b0c5"),
        virtualPath: "/knowledge/docs/section-ghost.md",
      },
      {
        metadata: { contentKind: "document-section", outlineNodeId: "n3" },
        pathId: uuid("b0c6"),
        virtualPath: "/knowledge/docs/section-summary.md",
      },
      {
        metadata: { contentKind: "document-section", outlineNodeId: "n4" },
        pathId: uuid("b0c7"),
        virtualPath: "/knowledge/docs/section-no-summary.md",
      },
    ];

    for (const sectionPath of sectionPaths) {
      await addPath(harness, {
        id: sectionPath.pathId,
        metadata: sectionPath.metadata,
        resourceType: "document",
        targetId: assetId,
        version: 1,
        virtualPath: sectionPath.virtualPath,
      });
    }

    // Outline missing entirely for a second asset.
    const orphanAssetId = uuid("b0c8");
    await addDocument(harness, {
      assetId: orphanAssetId,
      filename: "orphan.md",
      pathId: uuid("b0c9"),
      pathMetadata: { contentKind: "document-section", outlineNodeId: "n2" },
      virtualPath: "/knowledge/docs/section-no-outline.md",
    });

    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/section-no-outline.md",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/section-no-node-id.md",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/section-ghost.md",
      }),
    ).rejects.toThrow("KnowledgeFS path not found");
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/section-ok.md",
      }),
    ).resolves.toMatchObject({
      output: {
        contentType: "text/markdown",
        text: "# Doc Title\n\n## H\n\n```\nx=1\n```",
      },
    });
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/section-summary.md",
      }),
    ).resolves.toMatchObject({
      output: { text: "# Empty Section\n\nSec summary" },
    });
    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/section-no-summary.md",
      }),
    ).resolves.toMatchObject({
      output: { text: "# Void Section\n\nNo parsed content was available for this section." },
    });
  });

  it("falls back to raw object bytes for binary documents without artifacts", async () => {
    const harness = createHarness();
    await addDocument(harness, {
      assetId: uuid("b0d0"),
      content: "raw pdf body",
      filename: "binary.pdf",
      mimeType: "application/pdf",
      pathId: uuid("b0d1"),
      virtualPath: "/knowledge/docs/binary.pdf",
    });

    await expect(
      harness.execute("cat", {
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/docs/binary.pdf",
      }),
    ).resolves.toMatchObject({
      output: {
        contentType: "application/pdf",
        text: "raw pdf body",
        truncated: false,
      },
    });
  });

  it("validates write targets and appends over unreadable documents", async () => {
    const harness = createHarness();

    await expect(
      harness.execute(
        "write",
        { knowledgeSpaceId: SPACE_ID, path: "/knowledge/by-topic/x.md", text: "nope" },
        WRITER,
      ),
    ).rejects.toThrow("KnowledgeFS write path must be a file under /knowledge/docs");
    await expect(
      harness.execute(
        "write",
        { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/..", text: "nope" },
        WRITER,
      ),
    ).rejects.toThrow("KnowledgeFS write path must include a filename");

    const nodeId = uuid("b0e0");
    await harness.nodes.createMany([makeNode({ id: nodeId, kind: "chunk", text: "occupied" })]);
    await addPath(harness, {
      id: uuid("b0e1"),
      resourceType: "node",
      targetId: nodeId,
      virtualPath: "/knowledge/docs/blocked.md",
    });
    await expect(
      harness.execute(
        "write",
        { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/blocked.md", text: "nope" },
        WRITER,
      ),
    ).rejects.toThrow("KnowledgeFS write path must target a document");

    // Existing document whose stored object is gone: append treats prior text as empty.
    await addDocument(harness, {
      assetId: uuid("b0e2"),
      filename: "ghost.md",
      pathId: uuid("b0e3"),
      virtualPath: "/knowledge/docs/ghost.md",
    });
    await expect(
      harness.execute(
        "append",
        { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/ghost.md", text: "tail" },
        WRITER,
      ),
    ).resolves.toMatchObject({
      output: {
        bytesWritten: 4,
        mode: "append",
        path: "/knowledge/docs/ghost.md",
      },
    });
    await expect(
      harness.execute("cat", { knowledgeSpaceId: SPACE_ID, path: "/knowledge/docs/ghost.md" }),
    ).resolves.toMatchObject({
      output: { text: "tail" },
    });
  });

  it("infers writable document mime types from filename extensions", async () => {
    const harness = createHarness();
    const expectations: Array<readonly [string, string]> = [
      ["/knowledge/docs/note.md", "text/markdown"],
      ["/knowledge/docs/data.json", "application/json"],
      ["/knowledge/docs/page.html", "text/html"],
      ["/knowledge/docs/feed.xml", "application/xml"],
    ];

    for (const [path, contentType] of expectations) {
      await expect(
        harness.execute("write", { knowledgeSpaceId: SPACE_ID, path, text: "body" }, WRITER),
      ).resolves.toMatchObject({
        output: { bytesWritten: 4, mode: "write", path },
      });
      await expect(
        harness.execute("stat", { knowledgeSpaceId: SPACE_ID, path }),
      ).resolves.toMatchObject({
        output: { contentType, resourceType: "document" },
      });
    }
  });

  it("paginates tree listings with encoded cursors", async () => {
    const harness = createHarness();
    await addDocument(harness, {
      assetId: uuid("b0f0"),
      filename: "one.md",
      pathId: uuid("b0f1"),
      virtualPath: "/knowledge/docs/one.md",
    });
    await addDocument(harness, {
      assetId: uuid("b0f2"),
      filename: "two.md",
      pathId: uuid("b0f3"),
      virtualPath: "/knowledge/docs/two.md",
    });

    const result = await harness.execute("tree", {
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      path: "/knowledge/docs",
    });
    const output = result.output as {
      nextCursor?: string;
      root: { children?: Array<{ name: string }> };
      truncated: boolean;
    };

    expect(output.truncated).toBe(true);
    expect(output.nextCursor).toBeDefined();
    expect(output.root.children?.map((child) => child.name)).toEqual(["one.md"]);
  });
});
