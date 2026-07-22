import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseRow,
  DocumentAssetSchema,
  DocumentOutlineSchema,
  IndexProjectionSchema,
  KnowledgeNodeSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { ProjectionSetPublicationMember } from "./projection-publication-member-repository";
import {
  PublishedPageIndexNodeNotFoundError,
  PublishedPageIndexOutlineNotFoundError,
  PublishedPageIndexProjectionLimitExceededError,
  PublishedPageIndexRangeUnavailableError,
  PublishedPageIndexSnapshotNotFoundError,
  createDatabasePublishedPageIndexRepository,
  createInMemoryPublishedPageIndexRepository,
} from "./published-page-index-repository";

const TENANT_ID = "tenant-1";
const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_SPACE_ID = "10000000-0000-4000-8000-000000000002";
const PUBLICATION_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_PUBLICATION_ID = "20000000-0000-4000-8000-000000000002";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_GENERATION_ID = "30000000-0000-4000-8000-000000000002";
const FINGERPRINT = `projection-set-sha256:${"a".repeat(64)}`;
const ARTIFACT_HASH = "b".repeat(64);

describe("in-memory published PageIndex repository", () => {
  it("paginates only readable outlines from the exact published component closure", async () => {
    const first = documentFixture(1, ["team:camera"]);
    const hidden = documentFixture(2, ["team:secret"]);
    const second = documentFixture(3, []);
    const harness = memoryHarness([first, hidden, second]);

    const firstPage = await harness.repository.listOutlines({
      fingerprint: FINGERPRINT,
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      permissionScope: ["team:camera"],
      publicationId: PUBLICATION_ID,
      tenantId: TENANT_ID,
    });

    expect(firstPage.items.map((item) => item.outline.id)).toEqual([first.outline.id]);
    expect(firstPage.nextCursor).toEqual({ componentKey: first.outline.id });
    expect(firstPage.filteredCount).toBe(1);

    const secondPage = await harness.repository.listOutlines({
      cursor: firstPage.nextCursor,
      fingerprint: FINGERPRINT,
      knowledgeSpaceId: SPACE_ID,
      limit: 2,
      permissionScope: ["team:camera"],
      publicationId: PUBLICATION_ID,
      tenantId: TENANT_ID,
    });

    expect(secondPage.items.map((item) => item.outline.id)).toEqual([second.outline.id]);
    expect(secondPage.nextCursor).toBeUndefined();

    const publicOnly = await harness.repository.listOutlines({
      fingerprint: FINGERPRINT,
      knowledgeSpaceId: SPACE_ID,
      limit: 3,
      permissionScope: [],
      publicationId: PUBLICATION_ID,
      tenantId: TENANT_ID,
    });
    expect(publicOnly.items.map((item) => item.outline.id)).toEqual([second.outline.id]);
  });

  it("opens half-open leaf ranges after the caller can read the complete Outline lineage", async () => {
    const fixture = documentFixture(1, ["team:camera"]);
    const before = knowledgeNode(20, fixture, { endOffset: 10, startOffset: 0 });
    const leftOverlap = knowledgeNode(21, fixture, { endOffset: 11, startOffset: 5 });
    const rightOverlap = knowledgeNode(22, fixture, { endOffset: 25, startOffset: 19 });
    const after = knowledgeNode(23, fixture, { endOffset: 30, startOffset: 20 });
    const denied = knowledgeNode(24, fixture, {
      endOffset: 15,
      permissionScope: ["team:camera", "classification:restricted"],
      startOffset: 10,
    });
    const fixtures = [
      fixtureWithNodes(fixture, [before, leftOverlap, rightOverlap, after, denied]),
    ];
    const harness = memoryHarness(fixtures);

    const result = await harness.repository.openLeafEvidence({
      documentAssetId: fixture.asset.id,
      fingerprint: FINGERPRINT,
      generationId: GENERATION_ID,
      knowledgeSpaceId: SPACE_ID,
      limit: 10,
      outlineId: fixture.outline.id,
      outlineNodeId: fixture.outline.nodes[0]?.id ?? "missing",
      permissionScope: ["team:camera", "classification:restricted"],
      publicationId: PUBLICATION_ID,
      tenantId: TENANT_ID,
    });

    expect(result.openedRange).toEqual({ endOffset: 20, startOffset: 10 });
    expect(result.items.map((item) => item.node.id)).toEqual([
      leftOverlap.id,
      denied.id,
      rightOverlap.id,
    ]);
    expect(result.items.every((item) => item.projections.length === 1)).toBe(true);
    expect(result.items[0]?.citation).toMatchObject({
      documentAssetId: fixture.asset.id,
      documentVersion: 1,
      endOffset: 11,
      startOffset: 5,
    });
  });

  it("does not expose a whole Outline when any eligible published sibling node is unreadable", async () => {
    const fixture = documentFixture(1, ["team:camera"]);
    const readable = knowledgeNode(31, fixture, { endOffset: 15, startOffset: 10 });
    const secret = knowledgeNode(32, fixture, {
      endOffset: 20,
      permissionScope: ["team:camera", "classification:restricted"],
      startOffset: 15,
    });
    const repository = memoryHarness([fixtureWithNodes(fixture, [readable, secret])]).repository;
    const scope = {
      fingerprint: FINGERPRINT,
      knowledgeSpaceId: SPACE_ID,
      publicationId: PUBLICATION_ID,
      tenantId: TENANT_ID,
    } as const;

    await expect(
      repository.listOutlines({ ...scope, limit: 10, permissionScope: ["team:camera"] }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      repository.openLeafEvidence({
        ...scope,
        documentAssetId: fixture.asset.id,
        generationId: GENERATION_ID,
        limit: 10,
        outlineId: fixture.outline.id,
        outlineNodeId: fixture.outline.nodes[0]?.id ?? "missing",
        permissionScope: ["team:camera"],
      }),
    ).rejects.toBeInstanceOf(PublishedPageIndexOutlineNotFoundError);

    await expect(
      repository.listOutlines({
        ...scope,
        limit: 10,
        permissionScope: ["team:camera", "classification:restricted"],
      }),
    ).resolves.toMatchObject({ items: [{ outline: { id: fixture.outline.id } }] });
  });

  it("fails closed for a stale publication id, missing permissions, and cross-publication members", async () => {
    const fixture = documentFixture(1, ["team:camera"]);
    const crossPublication = {
      ...fixture,
      members: fixture.members.map((member) => ({
        ...member,
        publicationId: OTHER_PUBLICATION_ID,
      })),
    };
    const repository = memoryHarness([crossPublication]).repository;

    await expect(
      repository.listOutlines({
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        permissionScope: [],
        publicationId: OTHER_PUBLICATION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(PublishedPageIndexSnapshotNotFoundError);

    await expect(
      repository.listOutlines({
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        permissionScope: undefined as never,
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("permissionScope is required");

    await expect(
      repository.openLeafEvidence({
        documentAssetId: fixture.asset.id,
        fingerprint: FINGERPRINT,
        generationId: GENERATION_ID,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        outlineId: fixture.outline.id,
        outlineNodeId: "section-1",
        permissionScope: ["team:camera"],
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(PublishedPageIndexSnapshotNotFoundError);
  });

  it("implements indexed-search semantics and explicit threshold accounting in memory", async () => {
    const fixture = documentFixture(1, ["team:camera"]);
    const hidden = documentFixture(2, ["team:secret"]);
    const repository = memoryHarness([fixture, hidden]).repository;

    const result = await repository.searchSections?.({
      fingerprint: FINGERPRINT,
      knowledgeSpaceId: SPACE_ID,
      limit: 10,
      permissionScope: ["team:camera"],
      publicationId: PUBLICATION_ID,
      scoreThreshold: 0.95,
      tenantId: TENANT_ID,
      terms: ["summary"],
    });

    expect(result).toEqual({
      filteredCount: 1,
      items: [],
      tokenizerVersion: "pageindex-nfkc-exact-v1",
      truncated: false,
    });
  });

  it("continues the fixed snapshot after a newer head supersedes its publication", async () => {
    const fixture = documentFixture(1, ["team:camera"]);
    let publicationStatus: "published" | "superseded" = "published";
    const repository = memoryHarness([fixture], {
      publicationStatus: () => publicationStatus,
    }).repository;

    const first = await repository.listOutlines({
      fingerprint: FINGERPRINT,
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      permissionScope: ["team:camera"],
      publicationId: PUBLICATION_ID,
      tenantId: TENANT_ID,
    });
    publicationStatus = "superseded";
    const afterHeadSwitch = await repository.openLeafEvidence({
      documentAssetId: fixture.asset.id,
      fingerprint: FINGERPRINT,
      generationId: GENERATION_ID,
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      outlineId: first.items[0]?.outline.id ?? "missing",
      outlineNodeId: fixture.outline.nodes[0]?.id ?? "missing",
      permissionScope: ["team:camera"],
      publicationId: PUBLICATION_ID,
      tenantId: TENANT_ID,
    });

    expect(afterHeadSwitch.items).toHaveLength(1);
  });
});

describe("published PageIndex repository branch boundaries", () => {
  const scope = {
    fingerprint: FINGERPRINT,
    knowledgeSpaceId: SPACE_ID,
    publicationId: PUBLICATION_ID,
    tenantId: TENANT_ID,
  } as const;

  it("validates configured bounds and request limits before reading dependencies", async () => {
    const fixture = documentFixture(1, []);

    expect(() => memoryHarness([fixture], { maxLeafLimit: Number.NaN })).toThrow(
      "maxLeafLimit must be at least 1",
    );
    expect(() => memoryHarness([fixture], { maxProjectionMembers: 0 })).toThrow(
      "maxProjectionRows must be at least 1",
    );

    const database = createSchemaDatabaseAdapter({
      executor: async () => ({ rows: [], rowsAffected: 0 }),
      kind: "postgres",
    });
    expect(() =>
      createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 1,
        maxOutlinePageSize: 1,
        maxProjectionRows: 1,
        maxSectionCandidateNodes: 0,
      }),
    ).toThrow("maxSectionCandidateNodes must be at least 1");

    const repository = memoryHarness([fixture]).repository;
    await expect(
      repository.listOutlines({ ...scope, limit: 0, permissionScope: [] }),
    ).rejects.toThrow("outline page size must be at least 1");
    await expect(
      repository.listOutlines({ ...scope, limit: 21, permissionScope: [] }),
    ).rejects.toThrow("outline page size exceeds maximum=20");
    await expect(
      repository.openLeafEvidence({
        ...scope,
        documentAssetId: fixture.asset.id,
        generationId: GENERATION_ID,
        limit: 21,
        outlineId: fixture.outline.id,
        outlineNodeId: "section-1",
        permissionScope: [],
      }),
    ).rejects.toThrow("leaf limit exceeds maximum=20");
  });

  it("normalizes and rejects malformed search controls", async () => {
    const fixture = documentFixture(1, []);
    const repository = memoryHarness([fixture]).repository;
    const search = (overrides: Record<string, unknown>) =>
      repository.searchSections?.({
        ...scope,
        limit: 10,
        permissionScope: [],
        terms: ["camera"],
        ...overrides,
      });

    await expect(search({ terms: undefined })).rejects.toThrow("search terms are required");
    await expect(search({ terms: Array.from({ length: 65 }, () => "term") })).rejects.toThrow(
      "search terms exceed maximum=64",
    );
    await expect(search({ terms: [" "] })).rejects.toThrow("search term is required");
    await expect(search({ scoreThreshold: Number.POSITIVE_INFINITY })).rejects.toThrow(
      "scoreThreshold must be between 0 and 1",
    );
    await expect(search({ scoreThreshold: -0.1 })).rejects.toThrow(
      "scoreThreshold must be between 0 and 1",
    );
    await expect(search({ scoreThreshold: 1.1 })).rejects.toThrow(
      "scoreThreshold must be between 0 and 1",
    );
    await expect(
      repository.listOutlines({ ...scope, limit: 1, permissionScope: [" "] }),
    ).rejects.toThrow("permissionScope is required");
    await expect(
      repository.openLeafEvidence({
        ...scope,
        documentAssetId: fixture.asset.id,
        generationId: GENERATION_ID,
        limit: 1,
        outlineId: fixture.outline.id,
        outlineNodeId: " ",
        permissionScope: [],
      }),
    ).rejects.toThrow("outlineNodeId is required");

    await expect(search({ permissionScope: [" public ", "public"], terms: [] })).resolves.toEqual({
      items: [],
      tokenizerVersion: "pageindex-nfkc-exact-v1",
      truncated: false,
    });
    await expect(search({ scoreThreshold: 0, terms: [] })).resolves.toEqual({
      filteredCount: 0,
      items: [],
      tokenizerVersion: "pageindex-nfkc-exact-v1",
      truncated: false,
    });
  });

  it("fails closed for every mismatched publication identity field and status", async () => {
    const fixture = documentFixture(1, []);
    const repositories = [
      memoryHarness([fixture], { publicationOverride: () => null }).repository,
      memoryHarness([fixture], {
        publicationOverride: (publication) => ({ ...publication, id: OTHER_PUBLICATION_ID }),
      }).repository,
      memoryHarness([fixture], {
        publicationOverride: (publication) => ({
          ...publication,
          fingerprint: `projection-set-sha256:${"d".repeat(64)}`,
        }),
      }).repository,
      memoryHarness([fixture], {
        publicationOverride: (publication) => ({
          ...publication,
          knowledgeSpaceId: OTHER_SPACE_ID,
        }),
      }).repository,
      memoryHarness([fixture], {
        publicationOverride: (publication) => ({ ...publication, tenantId: "tenant-2" }),
      }).repository,
      memoryHarness([fixture], {
        publicationOverride: (publication) => ({ ...publication, status: "candidate" }),
      }).repository,
    ];

    for (const repository of repositories) {
      await expect(
        repository.listOutlines({ ...scope, limit: 1, permissionScope: [] }),
      ).rejects.toBeInstanceOf(PublishedPageIndexSnapshotNotFoundError);
    }
  });

  it("rejects mismatched publication members and oversized projection closures", async () => {
    const fixture = documentFixture(1, []);
    const fixtureNode = fixture.nodes[0];
    if (!fixtureNode) {
      throw new Error("fixture node is required");
    }
    const repositories = [
      memoryHarness([fixture], {
        membersOverride: (members) =>
          members.map((member, index) =>
            index === 0 ? { ...member, tenantId: "tenant-2" } : member,
          ),
      }).repository,
      memoryHarness([fixture], {
        membersOverride: (members) =>
          members.map((member, index) =>
            index === 0 ? { ...member, knowledgeSpaceId: OTHER_SPACE_ID } : member,
          ),
      }).repository,
      memoryHarness([fixture], {
        membersOverride: (members) =>
          members.map((member, index) =>
            index === 0 ? { ...member, publicationId: OTHER_PUBLICATION_ID } : member,
          ),
      }).repository,
    ];

    for (const repository of repositories) {
      await expect(
        repository.listOutlines({ ...scope, limit: 1, permissionScope: [] }),
      ).rejects.toBeInstanceOf(PublishedPageIndexSnapshotNotFoundError);
    }

    await expect(
      memoryHarness([fixtureWithNodes(fixture, [fixtureNode, fixtureNode])], {
        maxProjectionMembers: 1,
      }).repository.listOutlines({ ...scope, limit: 1, permissionScope: [] }),
    ).rejects.toBeInstanceOf(PublishedPageIndexProjectionLimitExceededError);
  });

  it("filters every corrupt projection and node ownership variant", async () => {
    const fixture = documentFixture(1, []);
    const repositories = [
      memoryHarness([fixture], { projectionsOverride: () => [] }).repository,
      memoryHarness([fixture], {
        projectionsOverride: (projections) =>
          projections.map((projection) => ({
            ...projection,
            knowledgeSpaceId: OTHER_SPACE_ID,
          })),
      }).repository,
      memoryHarness([fixture], {
        projectionsOverride: (projections) =>
          projections.map((projection) => ({
            ...projection,
            publicationGenerationId: OTHER_GENERATION_ID,
          })),
      }).repository,
      memoryHarness([fixture], {
        projectionsOverride: (projections) =>
          projections.map((projection) => ({ ...projection, status: "failed" })),
      }).repository,
      memoryHarness([fixture], {
        membersOverride: (members) =>
          members.map((member) =>
            member.componentType === "index-projection"
              ? { ...member, generationId: OTHER_GENERATION_ID }
              : member,
          ),
      }).repository,
      memoryHarness([fixture], {
        membersOverride: (members) =>
          members.map((member) =>
            member.componentType === "index-projection"
              ? { ...member, documentAssetId: uuid(9_991) }
              : member,
          ),
      }).repository,
      memoryHarness([fixture], { nodeOverride: () => null }).repository,
      memoryHarness([fixture], {
        nodeOverride: (node) => (node ? { ...node, kind: "summary" } : null),
      }).repository,
      memoryHarness([fixture], {
        nodeOverride: (node) => (node ? { ...node, documentAssetId: uuid(9_992) } : null),
      }).repository,
      memoryHarness([fixture], {
        nodeOverride: (node) =>
          node ? { ...node, publicationGenerationId: OTHER_GENERATION_ID } : null,
      }).repository,
      memoryHarness([fixture], {
        nodeOverride: (node) => (node ? { ...node, parseArtifactId: uuid(9_993) } : null),
      }).repository,
      memoryHarness([fixture], {
        nodeOverride: (node) => (node ? { ...node, artifactHash: "e".repeat(64) } : null),
      }).repository,
    ];

    for (const repository of repositories) {
      await expect(
        repository.listOutlines({ ...scope, limit: 1, permissionScope: [] }),
      ).resolves.toMatchObject({ filteredCount: 1, items: [] });
    }
  });

  it("filters every corrupt outline and asset ownership variant", async () => {
    const fixture = documentFixture(1, []);
    const repositories = [
      memoryHarness([fixture], { outlineOverride: () => null }).repository,
      memoryHarness([fixture], { assetOverride: () => null }).repository,
      memoryHarness([fixture], {
        assetOverride: (asset) => (asset ? { ...asset, parserStatus: "failed" } : null),
      }).repository,
      memoryHarness([fixture], {
        outlineOverride: (outline) => (outline ? { ...outline, id: uuid(9_994) } : null),
      }).repository,
      memoryHarness([fixture], {
        outlineOverride: (outline) =>
          outline ? { ...outline, knowledgeSpaceId: OTHER_SPACE_ID } : null,
      }).repository,
      memoryHarness([fixture], {
        outlineOverride: (outline) =>
          outline ? { ...outline, publicationGenerationId: OTHER_GENERATION_ID } : null,
      }).repository,
      memoryHarness([fixture], {
        outlineOverride: (outline) =>
          outline ? { ...outline, documentAssetId: uuid(9_995) } : null,
      }).repository,
    ];

    for (const repository of repositories) {
      await expect(
        repository.listOutlines({ ...scope, limit: 1, permissionScope: [] }),
      ).resolves.toMatchObject({ filteredCount: 1, items: [] });
    }
  });

  it("rethrows unexpected dependency errors from outline listing and search", async () => {
    const fixture = documentFixture(1, []);
    const dependencyError = new Error("outline storage unavailable");
    const repository = memoryHarness([fixture], {
      outlineOverride: async () => {
        throw dependencyError;
      },
    }).repository;

    await expect(repository.listOutlines({ ...scope, limit: 1, permissionScope: [] })).rejects.toBe(
      dependencyError,
    );
    await expect(
      repository.searchSections?.({
        ...scope,
        limit: 1,
        permissionScope: [],
        terms: ["camera"],
      }),
    ).rejects.toBe(dependencyError);
  });

  it("visits nested searchable ranges, ignores closed ranges, and applies deterministic ties", async () => {
    const fixture = documentFixture(1, []);
    const template = fixture.outline.nodes[0];
    if (!template) {
      throw new Error("fixture outline node is required");
    }
    const searchable = (id: string) => ({
      ...template,
      children: [],
      id,
      sourceNodeIds: [],
      summary: undefined,
      title: "Camera",
    });
    const outline = DocumentOutlineSchema.parse({
      ...fixture.outline,
      nodes: [
        {
          ...template,
          children: [searchable("deep-match")],
          endOffset: undefined,
          id: "root-without-end",
          startOffset: undefined,
          summary: undefined,
          title: "Ignored",
        },
        { ...searchable("closed-range"), endOffset: 10, startOffset: 10 },
        { ...searchable("no-end"), endOffset: undefined },
        { ...searchable("zero-score"), title: "Unrelated" },
        searchable("tie-b"),
        searchable("tie-a"),
      ],
    });
    const repository = memoryHarness([{ ...fixture, outline }]).repository;

    const result = await repository.searchSections?.({
      ...scope,
      limit: 1,
      permissionScope: [],
      terms: ["camera", "camera"],
    });

    expect(result?.items).toHaveLength(1);
    expect(result?.truncated).toBe(true);
    expect(result?.items[0]?.visitedNodeIds.length).toBeGreaterThan(0);
    expect(result?.filteredCount).toBeUndefined();
  });

  it("reports missing nodes and every unavailable selected range", async () => {
    const fixture = documentFixture(1, []);
    const template = fixture.outline.nodes[0];
    if (!template) {
      throw new Error("fixture outline node is required");
    }
    const repository = memoryHarness([fixture]).repository;
    const open = (outlineNodeId: string) =>
      repository.openLeafEvidence({
        ...scope,
        documentAssetId: fixture.asset.id,
        generationId: GENERATION_ID,
        limit: 1,
        outlineId: fixture.outline.id,
        outlineNodeId,
        permissionScope: [],
      });

    await expect(open("missing-node")).rejects.toBeInstanceOf(PublishedPageIndexNodeNotFoundError);

    for (const node of [
      { ...template, endOffset: undefined, id: "no-end" },
      { ...template, id: "no-start", startOffset: undefined },
      { ...template, endOffset: 10, id: "empty", startOffset: 10 },
    ]) {
      const outline = DocumentOutlineSchema.parse({ ...fixture.outline, nodes: [node] });
      const rangeRepository = memoryHarness([{ ...fixture, outline }]).repository;
      await expect(
        rangeRepository.openLeafEvidence({
          ...scope,
          documentAssetId: fixture.asset.id,
          generationId: GENERATION_ID,
          limit: 1,
          outlineId: outline.id,
          outlineNodeId: node.id,
          permissionScope: [],
        }),
      ).rejects.toBeInstanceOf(PublishedPageIndexRangeUnavailableError);
    }
  });

  it("deduplicates repeated projection members and truncates stable leaf ordering", async () => {
    const fixture = documentFixture(1, []);
    const first = knowledgeNode(31, fixture, {
      endOffset: 16,
      permissionScope: [],
      startOffset: 10,
    });
    const second = knowledgeNode(32, fixture, {
      endOffset: 18,
      permissionScope: [],
      startOffset: 10,
    });
    const withRepeatedNode = fixtureWithNodes(fixture, [first, first, second]);
    const repeatedProjectionMember = withRepeatedNode.members.find(
      (member) => member.componentType === "index-projection",
    );
    if (!repeatedProjectionMember) {
      throw new Error("fixture projection member is required");
    }
    const repository = memoryHarness([
      {
        ...withRepeatedNode,
        members: [...withRepeatedNode.members, repeatedProjectionMember],
      },
    ]).repository;

    const result = await repository.openLeafEvidence({
      ...scope,
      documentAssetId: fixture.asset.id,
      generationId: GENERATION_ID,
      limit: 1,
      outlineId: fixture.outline.id,
      outlineNodeId: fixture.outline.nodes[0]?.id ?? "missing",
      permissionScope: [],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.node.id).toBe(first.id);
    expect(result.items[0]?.projections).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("uses node offsets when source locations omit them and includes page numbers", async () => {
    const fixture = documentFixture(1, []);
    const fixtureNode = fixture.nodes[0];
    if (!fixtureNode) {
      throw new Error("fixture node is required");
    }
    const node = KnowledgeNodeSchema.parse({
      ...fixtureNode,
      permissionScope: [],
      sourceLocation: { pageNumber: 7, sectionPath: ["Support"] },
    });
    const repository = memoryHarness([fixtureWithNodes(fixture, [node])]).repository;

    const result = await repository.openLeafEvidence({
      ...scope,
      documentAssetId: fixture.asset.id,
      generationId: GENERATION_ID,
      limit: 1,
      outlineId: fixture.outline.id,
      outlineNodeId: fixture.outline.nodes[0]?.id ?? "missing",
      permissionScope: [],
    });

    expect(result.items[0]?.citation).toMatchObject({
      endOffset: node.endOffset,
      pageNumber: 7,
      startOffset: node.startOffset,
    });
  });
});

describe.each(["postgres", "tidb"] as const)(
  "database published PageIndex repository (%s)",
  (dialect) => {
    it("searches the fixed publication through the space-leading exact-term index", async () => {
      const fixture = documentFixture(1, ["team:camera"]);
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (calls.length === 1) {
            return { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 };
          }
          return {
            rows: [pageIndexScoredNodeDatabaseRow(fixture, { score: 0.5 })],
            rowsAffected: 1,
          };
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 100,
        maxProjectionRows: 20,
      });

      const result = await repository.searchSections?.({
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 20,
        permissionScope: ["team:camera"],
        publicationId: PUBLICATION_ID,
        scoreThreshold: 0.5,
        tenantId: TENANT_ID,
        terms: ["camera", "warranty"],
      });

      expect(result?.items).toHaveLength(1);
      expect(result?.items[0]?.score).toBe(0.5);
      expect(calls).toHaveLength(2);
      const search = calls[1];
      expect(search?.tableName).toBe("page_index_terms");
      expect(search?.sql).toContain(
        dialect === "postgres" ? 'pit."knowledge_space_id" = $1' : "pit.`knowledge_space_id` = ?",
      );
      expect(search?.sql).toContain("COUNT(DISTINCT CASE WHEN");
      expect(search?.sql).toContain("GROUP BY");
      expect(search?.sql).toContain("GREATEST");
      expect(search?.sql).toContain("ORDER BY");
      expect(search?.sql).toContain("score");
      expect(search?.sql).toContain("projection_set_publications");
      expect(search?.sql).toContain("projection_set_publication_members");
      expect(search?.sql).toContain("page_index_manifests");
      expect(search?.sql).toContain("document_outlines");
      expect(search?.sql).toContain("document_assets");
      expect(search?.sql).toContain("lifecycle_state");
      expect(search?.sql).toContain("'active'");
      expect(search?.sql).toContain("outline_parent_source");
      expect(search?.sql).toContain("<> 'deleting'");
      expect(search?.sql).toContain("deletion_job_id");
      expect(search?.sql).toContain("index_projections");
      expect(search?.sql).toContain("knowledge_nodes");
      expect(search?.sql).toContain("publication_generation_id");
      expect(search?.sql).toContain("permission_scope");
      expect(search?.sql).toContain("NOT EXISTS");
      const groupedPostingSql = search?.sql.slice(0, search.sql.indexOf("GROUP BY")) ?? "";
      expect(groupedPostingSql).toContain("page_index_terms");
      expect(groupedPostingSql).toContain("page_index_manifests");
      expect(groupedPostingSql).toContain("projection_set_publication_members");
      expect(groupedPostingSql).toContain("projection_set_publications");
      expect(groupedPostingSql).toContain("scoped_pim");
      expect(groupedPostingSql).toContain("scoped_om");
      expect(groupedPostingSql).toContain("scoped_pub");
      expect(groupedPostingSql).toContain("'document-outline'");
      expect(groupedPostingSql).toContain("'ready'");
      expect(groupedPostingSql).toContain("'published', 'superseded'");
      expect(groupedPostingSql).toContain("publication_generation_id");
      expect(groupedPostingSql).toContain("document_asset_id");
      expect(groupedPostingSql).toContain("tokenizer_version");
      expect(groupedPostingSql).toContain(
        dialect === "postgres"
          ? 'scoped_pim."id" = pit."manifest_id"'
          : "scoped_pim.`id` = pit.`manifest_id`",
      );
      expect(groupedPostingSql).toContain(
        dialect === "postgres"
          ? 'scoped_om."component_key" = scoped_pim."document_outline_id"'
          : "scoped_om.`component_key` = scoped_pim.`document_outline_id`",
      );
      expect(groupedPostingSql).toContain(
        dialect === "postgres"
          ? 'scoped_om."generation_id" = scoped_pim."publication_generation_id"'
          : "scoped_om.`generation_id` = scoped_pim.`publication_generation_id`",
      );
      expect(groupedPostingSql).toContain(
        dialect === "postgres"
          ? 'scoped_pub."id" = scoped_om."publication_id"'
          : "scoped_pub.`id` = scoped_om.`publication_id`",
      );
      expect(groupedPostingSql).toContain(
        dialect === "postgres" ? 'scoped_pub."fingerprint" = $7' : "scoped_pub.`fingerprint` = ?",
      );
      expect(search?.sql).toContain(
        dialect === "postgres" ? 'da."version" = o."version"' : "da.`version` = o.`version`",
      );
      expect(search?.sql).toContain(
        dialect === "postgres"
          ? 'om."document_asset_id" = pim."document_asset_id"'
          : "om.`document_asset_id` = pim.`document_asset_id`",
      );
      expect(search?.sql).toContain(
        dialect === "postgres"
          ? 'o."version" = pim."document_version"'
          : "o.`version` = pim.`document_version`",
      );
      expect(search?.sql).not.toContain(
        dialect === "postgres" ? 'pit."manifest_id" IN (' : "pit.`manifest_id` IN (",
      );
      expect(search?.sql.match(/\bLIMIT\b/g)).toHaveLength(1);
      expect(search?.params).toEqual([
        SPACE_ID,
        "camera",
        "warranty",
        TENANT_ID,
        SPACE_ID,
        PUBLICATION_ID,
        FINGERPRINT,
        TENANT_ID,
        SPACE_ID,
        PUBLICATION_ID,
        FINGERPRINT,
        JSON.stringify(["team:camera"]),
        6_401,
      ]);
      expect(search?.maxRows).toBe(6_401);
      expect(search?.sql.match(/\?/g)?.length ?? 0).toBe(
        dialect === "tidb" ? search?.params.length : 0,
      );
      if (dialect === "postgres") {
        expect(search?.sql).toContain(`$${search?.params.length ?? 0}`);
      }
      expect(result?.filteredCount).toBe(0);
    });

    it("bounds common-term nodes only after scoring and traces candidate truncation", async () => {
      const fixture = documentFixture(1, ["team:camera"]);
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (calls.length === 1) {
            return { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 };
          }
          return {
            rows: [
              pageIndexScoredNodeDatabaseRow(fixture, { nodeId: "section-1", score: 1 }),
              pageIndexScoredNodeDatabaseRow(fixture, { nodeId: "section-2", score: 0.9 }),
              pageIndexScoredNodeDatabaseRow(fixture, { nodeId: "section-3", score: 0.8 }),
            ],
            rowsAffected: 3,
          };
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 100,
        maxProjectionRows: 20,
        maxSectionCandidateNodes: 2,
      });

      const result = await repository.searchSections?.({
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        permissionScope: ["team:camera"],
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
        terms: ["camera"],
      });

      expect(result?.items).toHaveLength(2);
      expect(result?.truncated).toBe(true);
      expect(calls[1]?.maxRows).toBe(3);
      expect(calls[1]?.params.at(-1)).toBe(3);
      expect(calls[1]?.sql).toContain("GROUP BY");
      expect(calls[1]?.sql).toMatch(/ORDER BY .*score.* DESC/);
      expect(calls[1]?.sql).toContain("LIMIT");
    });

    it("reports threshold-filtered candidates from the bounded repository window", async () => {
      const fixture = documentFixture(1, ["team:camera"]);
      let calls = 0;
      const database = createSchemaDatabaseAdapter({
        executor: async () => {
          calls += 1;
          if (calls === 1) {
            return { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 };
          }
          return {
            rows: [
              pageIndexScoredNodeDatabaseRow(fixture, {
                nodeId: "weak-section",
                score: 0.8,
              }),
              pageIndexScoredNodeDatabaseRow(fixture, {
                nodeId: "strong-section",
                score: 1,
              }),
              pageIndexScoredNodeDatabaseRow(fixture, {
                nodeId: "second-strong-section",
                score: 0.95,
              }),
            ],
            rowsAffected: 3,
          };
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 100,
        maxProjectionRows: 20,
      });

      const result = await repository.searchSections?.({
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        permissionScope: ["team:camera"],
        publicationId: PUBLICATION_ID,
        scoreThreshold: 0.9,
        tenantId: TENANT_ID,
        terms: ["camera"],
      });

      expect(result?.items.map((item) => item.node.id)).toEqual(["strong-section"]);
      expect(result?.filteredCount).toBe(1);
      expect(result?.truncated).toBe(true);
    });

    it("does not let many low-id irrelevant manifests exclude a high-id strong match", async () => {
      const highMatch = documentFixture(99, ["team:camera"]);
      const lowIrrelevantManifestIds = Array.from({ length: 128 }, (_, index) => uuid(index + 1));
      const highManifestId = uuid(9_999);
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (calls.length === 1) {
            return { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 };
          }
          expect(
            input.params.some((value) => lowIrrelevantManifestIds.includes(String(value))),
          ).toBe(false);
          expect(input.sql).not.toContain(
            dialect === "postgres" ? 'pim."id" ASC LIMIT' : "pim.`id` ASC LIMIT",
          );
          expect(input.sql).not.toContain(
            dialect === "postgres" ? 'pit."manifest_id" IN (' : "pit.`manifest_id` IN (",
          );
          return {
            rows: [
              pageIndexScoredNodeDatabaseRow(highMatch, {
                manifestId: highManifestId,
                nodeId: "high-id-strong-section",
                score: 1,
              }),
            ],
            rowsAffected: 1,
          };
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 100,
        maxProjectionRows: 20,
      });

      const result = await repository.searchSections?.({
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        permissionScope: ["team:camera"],
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
        terms: ["camera", "warranty"],
      });

      expect(result?.items.map((item) => item.node.id)).toEqual(["high-id-strong-section"]);
      expect(result?.items[0]?.documentAssetId).toBe(highMatch.asset.id);
      expect(calls).toHaveLength(2);
    });

    it("rejects overlong direct-repository terms before touching the database", async () => {
      let calls = 0;
      const database = createSchemaDatabaseAdapter({
        executor: async () => {
          calls += 1;
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 100,
        maxProjectionRows: 20,
      });
      const scope = {
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        permissionScope: [],
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
      } as const;

      await expect(
        repository.searchSections?.({ ...scope, terms: ["a".repeat(129)] }),
      ).rejects.toThrow("maximum characters=128");
      await expect(
        repository.searchSections?.({ ...scope, terms: ["𐐀".repeat(100)] }),
      ).rejects.toThrow("maximum bytes=256");
      expect(calls).toBe(0);
    });

    it("keeps corpus-wide PageIndex completeness verification out of the query hot path", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return calls.length === 1
            ? { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 100,
        maxProjectionRows: 20,
      });

      await expect(
        repository.searchSections?.({
          fingerprint: FINGERPRINT,
          knowledgeSpaceId: SPACE_ID,
          limit: 20,
          permissionScope: [],
          publicationId: PUBLICATION_ID,
          tenantId: TENANT_ID,
          terms: ["camera"],
        }),
      ).resolves.toMatchObject({ items: [], truncated: false });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.sql).not.toContain("missing_outline_id");
      expect(calls[1]?.sql).not.toContain("readiness_");
      expect(calls[1]?.sql).not.toMatch(/SELECT COUNT\(\*\) FROM [^ ]*page_index_nodes/);
    });

    it("uses a bounded, ACL-filtered publication-member join for outline pagination", async () => {
      const fixture = documentFixture(1, ["team:camera"]);
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (calls.length === 1) {
            return { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 };
          }
          return {
            rows: [outlineDatabaseRow(fixture), outlineDatabaseRow(documentFixture(2, []))],
            rowsAffected: 2,
          };
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 10,
        maxProjectionRows: 20,
      });

      const page = await repository.listOutlines({
        fingerprint: FINGERPRINT,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        permissionScope: ["team:camera", "document:read"],
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
      });

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toEqual({ componentKey: fixture.outline.id });
      expect(calls.map((call) => call.maxRows)).toEqual([1, 2]);
      expect(calls[1]?.params).toEqual([
        TENANT_ID,
        SPACE_ID,
        PUBLICATION_ID,
        FINGERPRINT,
        JSON.stringify(["document:read", "team:camera"]),
        2,
      ]);
      const sql = calls[1]?.sql ?? "";
      expect(sql).toContain("document-outline");
      expect(sql).toContain("index-projection");
      expect(sql).toContain("publication_generation_id");
      expect(sql).toContain("component_key");
      expect(sql).toContain("permission_scope");
      expect(sql).toContain(dialect === "postgres" ? "::jsonb @>" : "JSON_CONTAINS");
      expect(sql).toContain("NOT EXISTS");
      expect(sql).toContain("IS NOT TRUE");
      expect(sql).toContain("LIMIT");
      expect(sql).toContain("superseded");
      expect(sql).toContain("lifecycle_state");
      expect(sql).toContain("'active'");
      expect(sql).not.toContain("projection_set_publication_heads");
    });

    it("opens a bounded half-open range and reloads only exact published projections", async () => {
      const fixture = documentFixture(1, ["team:camera"]);
      const node = knowledgeNode(21, fixture, { endOffset: 11, startOffset: 5 });
      const projection = projectionForNode(31, node);
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          switch (calls.length) {
            case 1:
              return { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 };
            case 2:
              return { rows: [outlineDatabaseRow(fixture)], rowsAffected: 1 };
            case 3:
              return { rows: [knowledgeNodeDatabaseRow(node)], rowsAffected: 1 };
            default:
              return { rows: [indexProjectionDatabaseRow(projection)], rowsAffected: 1 };
          }
        },
        kind: dialect,
      });
      const repository = createDatabasePublishedPageIndexRepository({
        database,
        maxLeafLimit: 10,
        maxOutlinePageSize: 10,
        maxProjectionRows: 5,
      });

      const result = await repository.openLeafEvidence({
        documentAssetId: fixture.asset.id,
        fingerprint: FINGERPRINT,
        generationId: GENERATION_ID,
        knowledgeSpaceId: SPACE_ID,
        limit: 2,
        outlineId: fixture.outline.id,
        outlineNodeId: fixture.outline.nodes[0]?.id ?? "missing",
        permissionScope: ["team:camera"],
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
      });

      expect(result.items.map((item) => item.node.id)).toEqual([node.id]);
      expect(calls.map((call) => call.maxRows)).toEqual([1, 1, 3, 6]);
      const leafCall = calls[2];
      expect(leafCall?.params).toEqual([
        SPACE_ID,
        fixture.asset.id,
        GENERATION_ID,
        fixture.outline.parseArtifactId,
        ARTIFACT_HASH,
        20,
        10,
        JSON.stringify(["team:camera"]),
        TENANT_ID,
        PUBLICATION_ID,
        FINGERPRINT,
        3,
      ]);
      expect(leafCall?.sql).toContain(
        dialect === "postgres" ? '"start_offset" < $6' : "`start_offset` < ?",
      );
      expect(leafCall?.sql).toContain(
        dialect === "postgres" ? '"end_offset" > $7' : "`end_offset` > ?",
      );
      expect(leafCall?.sql).toContain("index-projection");
      expect(leafCall?.sql).toContain("lifecycle_state");
      expect(leafCall?.sql).toContain("'active'");
      expect(leafCall?.sql).toContain("leaf_parent_source");
      expect(leafCall?.sql).toContain("<> 'deleting'");
      expect(calls[3]?.sql).toContain("component_key");
      expect(calls[3]?.sql).toContain("publication_generation_id");
      expect(calls[3]?.sql).toContain("LIMIT");
      expect(calls[3]?.sql).toContain("lifecycle_state");
      expect(calls[3]?.sql).toContain("'active'");
      expect(calls[3]?.sql).toContain("projection_parent_source");
      expect(calls[3]?.sql).toContain("deletion_job_id");
      expect(calls[3]?.sql).not.toContain("dense_vector");
      expect(calls[3]?.sql).not.toContain("visual_vector");
      expect(calls[3]?.sql).not.toContain("ip.*");
      expect(calls[3]?.sql).not.toContain("projection_set_publication_heads");
    });
  },
);

interface Fixture {
  readonly asset: ReturnType<typeof DocumentAssetSchema.parse>;
  readonly members: readonly ProjectionSetPublicationMember[];
  readonly nodes: readonly ReturnType<typeof KnowledgeNodeSchema.parse>[];
  readonly outline: ReturnType<typeof DocumentOutlineSchema.parse>;
  readonly projections: readonly ReturnType<typeof IndexProjectionSchema.parse>[];
}

function documentFixture(index: number, permissionScope: readonly string[]): Fixture {
  const assetId = uuid(100 + index);
  const outlineId = uuid(200 + index);
  const parseArtifactId = uuid(300 + index);
  const node = KnowledgeNodeSchema.parse({
    artifactHash: ARTIFACT_HASH,
    documentAssetId: assetId,
    endOffset: 20,
    id: uuid(400 + index),
    kind: "chunk",
    knowledgeSpaceId: SPACE_ID,
    metadata: { fixture: index },
    parseArtifactId,
    permissionScope,
    publicationGenerationId: GENERATION_ID,
    sourceLocation: { endOffset: 20, sectionPath: ["Support"], startOffset: 10 },
    startOffset: 10,
    text: `evidence ${index}`,
  });
  const projection = projectionForNode(500 + index, node);
  const outline = DocumentOutlineSchema.parse({
    artifactHash: ARTIFACT_HASH,
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId: assetId,
    id: outlineId,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    nodes: [
      {
        childNodeIds: [],
        children: [],
        endOffset: 20,
        id: `section-${index}`,
        level: 1,
        metadata: {},
        sectionPath: ["Support"],
        sourceElementIds: [],
        sourceNodeIds: [node.id],
        startOffset: 10,
        summary: `Summary ${index}`,
        title: `Title ${index}`,
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "document-outline-v1",
    parseArtifactId,
    publicationGenerationId: GENERATION_ID,
    version: 1,
  });
  const asset = DocumentAssetSchema.parse({
    createdAt: "2026-07-14T00:00:00.000Z",
    filename: `document-${index}.md`,
    id: assetId,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    mimeType: "text/markdown",
    objectKey: `documents/${index}.md`,
    parserStatus: "parsed",
    sha256: "c".repeat(64),
    sizeBytes: 100,
    version: 1,
  });

  return {
    asset,
    members: [
      publicationMember("document-outline", outline.id, asset.id),
      publicationMember("index-projection", projection.id, asset.id),
    ],
    nodes: [node],
    outline,
    projections: [projection],
  };
}

function fixtureWithNodes(
  fixture: Fixture,
  nodes: readonly ReturnType<typeof KnowledgeNodeSchema.parse>[],
): Fixture {
  const projections = nodes.map((node, index) => projectionForNode(600 + index, node));
  return {
    ...fixture,
    members: [
      publicationMember("document-outline", fixture.outline.id, fixture.asset.id),
      ...projections.map((projection) =>
        publicationMember("index-projection", projection.id, fixture.asset.id),
      ),
    ],
    nodes,
    projections,
  };
}

function knowledgeNode(
  index: number,
  fixture: Fixture,
  overrides: {
    readonly endOffset: number;
    readonly permissionScope?: readonly string[];
    readonly startOffset: number;
  },
) {
  return KnowledgeNodeSchema.parse({
    artifactHash: ARTIFACT_HASH,
    documentAssetId: fixture.asset.id,
    endOffset: overrides.endOffset,
    id: uuid(700 + index),
    kind: "chunk",
    knowledgeSpaceId: SPACE_ID,
    metadata: { index },
    parseArtifactId: fixture.outline.parseArtifactId,
    permissionScope: overrides.permissionScope ?? ["team:camera"],
    publicationGenerationId: GENERATION_ID,
    sourceLocation: {
      endOffset: overrides.endOffset,
      sectionPath: ["Support"],
      startOffset: overrides.startOffset,
    },
    startOffset: overrides.startOffset,
    text: `node ${index}`,
  });
}

function projectionForNode(index: number, node: ReturnType<typeof KnowledgeNodeSchema.parse>) {
  return IndexProjectionSchema.parse({
    id: uuid(800 + index),
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    model: "embedding-model",
    nodeId: node.id,
    projectionVersion: 1,
    publicationGenerationId: GENERATION_ID,
    status: "ready",
    type: "dense-vector",
  });
}

function publicationMember(
  componentType: ProjectionSetPublicationMember["componentType"],
  componentKey: string,
  documentAssetId: string,
): ProjectionSetPublicationMember {
  return {
    componentKey,
    componentType,
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId,
    generationId: GENERATION_ID,
    knowledgeSpaceId: SPACE_ID,
    publicationId: PUBLICATION_ID,
    tenantId: TENANT_ID,
  };
}

function memoryHarness(
  fixtures: readonly Fixture[],
  options: {
    readonly assetOverride?: (
      asset: Fixture["asset"] | null,
    ) => Fixture["asset"] | null | Promise<Fixture["asset"] | null>;
    readonly maxLeafLimit?: number | undefined;
    readonly maxOutlinePageSize?: number | undefined;
    readonly maxProjectionMembers?: number | undefined;
    readonly membersOverride?: (
      members: readonly ProjectionSetPublicationMember[],
    ) => readonly ProjectionSetPublicationMember[];
    readonly nodeOverride?: (
      node: Fixture["nodes"][number] | null,
    ) => Fixture["nodes"][number] | null | Promise<Fixture["nodes"][number] | null>;
    readonly outlineOverride?: (
      outline: Fixture["outline"] | null,
    ) => Fixture["outline"] | null | Promise<Fixture["outline"] | null>;
    readonly publicationStatus?: (() => "published" | "superseded") | undefined;
    readonly publicationOverride?: (publication: {
      readonly createdAt: string;
      readonly fingerprint: string;
      readonly id: string;
      readonly knowledgeSpaceId: string;
      readonly metadata: Record<string, never>;
      readonly projectionVersion: number;
      readonly status: "published" | "superseded";
      readonly tenantId: string;
      readonly updatedAt: string;
    }) => {
      readonly createdAt: string;
      readonly fingerprint: string;
      readonly id: string;
      readonly knowledgeSpaceId: string;
      readonly metadata: Record<string, never>;
      readonly projectionVersion: number;
      readonly status: "candidate" | "published" | "superseded";
      readonly tenantId: string;
      readonly updatedAt: string;
    } | null;
    readonly projectionsOverride?: (
      projections: readonly Fixture["projections"][number][],
    ) => readonly Fixture["projections"][number][];
  } = {},
) {
  const outlines = new Map(fixtures.map((fixture) => [fixture.outline.id, fixture.outline]));
  const assets = new Map(fixtures.map((fixture) => [fixture.asset.id, fixture.asset]));
  const nodes = new Map(
    fixtures.flatMap((fixture) => fixture.nodes.map((node) => [node.id, node])),
  );
  const projections = new Map(
    fixtures.flatMap((fixture) =>
      fixture.projections.map((projection) => [projection.id, projection]),
    ),
  );
  const fixtureMembers = fixtures.flatMap((fixture) => fixture.members);
  const members = options.membersOverride?.(fixtureMembers) ?? fixtureMembers;

  return {
    repository: createInMemoryPublishedPageIndexRepository({
      documentAssets: {
        get: async ({ id, knowledgeSpaceId }) => {
          const asset = assets.get(id);
          const owned = asset?.knowledgeSpaceId === knowledgeSpaceId ? asset : null;
          return options.assetOverride ? options.assetOverride(owned) : owned;
        },
      },
      indexProjections: {
        getMany: async ({ ids, knowledgeSpaceId }) => {
          const owned = ids
            .map((id) => projections.get(id))
            .filter(
              (projection): projection is NonNullable<typeof projection> =>
                projection !== undefined && projection.knowledgeSpaceId === knowledgeSpaceId,
            );
          return [...(options.projectionsOverride?.(owned) ?? owned)];
        },
      },
      maxLeafLimit: options.maxLeafLimit ?? 20,
      maxOutlinePageSize: options.maxOutlinePageSize ?? 20,
      maxProjectionMembers: options.maxProjectionMembers ?? 100,
      members: { listByPublication: async () => members },
      nodes: {
        get: async ({ id, knowledgeSpaceId, publicationGenerationId }) => {
          const node = nodes.get(id);
          const owned =
            node?.knowledgeSpaceId === knowledgeSpaceId &&
            node.publicationGenerationId === publicationGenerationId
              ? node
              : null;
          return options.nodeOverride ? options.nodeOverride(owned) : owned;
        },
      },
      outlines: {
        getById: async ({ id }) => {
          const outline = outlines.get(id) ?? null;
          return options.outlineOverride ? options.outlineOverride(outline) : outline;
        },
      },
      publications: {
        getByFingerprint: async ({ fingerprint, knowledgeSpaceId, tenantId }) => {
          if (
            fingerprint !== FINGERPRINT ||
            knowledgeSpaceId !== SPACE_ID ||
            tenantId !== TENANT_ID
          ) {
            return null;
          }
          const publication = {
            createdAt: "2026-07-14T00:00:00.000Z",
            fingerprint: FINGERPRINT,
            id: PUBLICATION_ID,
            knowledgeSpaceId: SPACE_ID,
            metadata: {},
            projectionVersion: 1,
            status: options.publicationStatus?.() ?? "published",
            tenantId: TENANT_ID,
            updatedAt: "2026-07-14T00:00:00.000Z",
          } as const;
          return options.publicationOverride
            ? options.publicationOverride(publication)
            : publication;
        },
      },
    }),
  };
}

function outlineDatabaseRow(fixture: Fixture): DatabaseRow {
  return {
    outline_artifact_hash: fixture.outline.artifactHash,
    outline_created_at: fixture.outline.createdAt,
    outline_document_asset_id: fixture.outline.documentAssetId,
    outline_id: fixture.outline.id,
    outline_knowledge_space_id: fixture.outline.knowledgeSpaceId,
    outline_metadata: JSON.stringify(fixture.outline.metadata),
    outline_nodes: JSON.stringify(fixture.outline.nodes),
    outline_outline_version: fixture.outline.outlineVersion,
    outline_parse_artifact_id: fixture.outline.parseArtifactId,
    outline_publication_generation_id: fixture.outline.publicationGenerationId,
    outline_updated_at: null,
    outline_version: fixture.outline.version,
  };
}

function pageIndexScoredNodeDatabaseRow(
  fixture: Fixture,
  overrides: {
    readonly manifestId?: string | undefined;
    readonly nodeId?: string | undefined;
    readonly score?: number | undefined;
  } = {},
): DatabaseRow {
  const nodeId = overrides.nodeId ?? fixture.outline.nodes[0]?.id ?? "section-1";
  return {
    document_asset_id: fixture.asset.id,
    document_version: fixture.outline.version,
    end_offset: 20,
    generation_id: GENERATION_ID,
    level: 1,
    manifest_id: overrides.manifestId ?? uuid(901),
    outline_id: fixture.outline.id,
    outline_node_id: nodeId,
    outline_version: fixture.outline.outlineVersion,
    section_path: JSON.stringify(["Support"]),
    score: overrides.score ?? 1,
    start_offset: 10,
    summary: "Camera warranty",
    title: "Camera",
    toc_source: "parser-heading",
    visited_node_ids: JSON.stringify([nodeId]),
  };
}

function knowledgeNodeDatabaseRow(node: ReturnType<typeof KnowledgeNodeSchema.parse>): DatabaseRow {
  return {
    artifact_hash: node.artifactHash,
    document_asset_id: node.documentAssetId,
    end_offset: node.endOffset,
    id: node.id,
    kind: node.kind,
    knowledge_space_id: node.knowledgeSpaceId,
    metadata: JSON.stringify(node.metadata),
    parse_artifact_id: node.parseArtifactId,
    permission_scope: JSON.stringify(node.permissionScope),
    publication_generation_id: node.publicationGenerationId,
    source_location: JSON.stringify(node.sourceLocation),
    start_offset: node.startOffset,
    text: node.text,
    updated_at: null,
  };
}

function indexProjectionDatabaseRow(
  projection: ReturnType<typeof IndexProjectionSchema.parse>,
): DatabaseRow {
  return {
    id: projection.id,
    knowledge_space_id: projection.knowledgeSpaceId,
    metadata: JSON.stringify(projection.metadata),
    model: projection.model,
    node_id: projection.nodeId,
    projection_version: projection.projectionVersion,
    publication_generation_id: projection.publicationGenerationId,
    status: projection.status,
    type: projection.type,
  };
}

function uuid(index: number): string {
  return `90000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}
