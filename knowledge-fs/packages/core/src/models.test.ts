import { describe, expect, it } from "vitest";

import {
  AnswerTraceSchema,
  ArtifactSegmentSchema,
  AuthSubjectSchema,
  DocumentAssetSchema,
  DocumentMultimodalManifestSchema,
  DocumentOutlineSchema,
  EmbeddingModelSchema,
  EvidenceBundleSchema,
  GoldenQuestionSchema,
  IndexProjectionSchema,
  KnowledgeFsGcDryRunReportSchema,
  KnowledgeFsLeaseSchema,
  KnowledgeFsNamespaceSchema,
  KnowledgeFsSessionSchema,
  KnowledgeFsckReportSchema,
  KnowledgeNodeSchema,
  KnowledgePathSchema,
  KnowledgeSpaceConsistencyClassSchema,
  KnowledgeSpaceEmbeddingSelectionSchema,
  KnowledgeSpaceManifestSchema,
  KnowledgeSpacePendingModelConfigurationSchema,
  KnowledgeSpaceQuotaPolicySchema,
  KnowledgeSpaceRetrievalProfileInputSchema,
  KnowledgeSpaceRetrievalProfileModeError,
  KnowledgeSpaceSchema,
  KnowledgeSpaceStagedCommitSchema,
  PUBLICATION_GENERATION_ID_SENTINEL,
  ParseArtifactSchema,
  ProjectionSetFingerprintMaterialSchema,
  ProjectionSetFingerprintSchema,
  PublicationGenerationIdSchema,
  ResourceMountSchema,
  SourceSchema,
  buildKnowledgeFsPath,
  buildProjectionSetFingerprint,
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceEmbeddingProfile,
  createKnowledgeSpaceRetrievalProfile,
  getKnowledgeFsNamespaceSpec,
  getKnowledgeFsPathNamespace,
  normalizeProjectionSetFingerprintMaterial,
  updateKnowledgeSpaceEmbeddingProfile,
  validateKnowledgeSpaceRetrievalProfileForMode,
} from "./models";

const createdAt = "2026-05-08T07:55:00.000Z";
const updatedAt = "2026-05-08T07:56:00.000Z";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const nodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const bundleId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const sha256 = "a".repeat(64);

const generationScopedDerivedArtifacts = [
  {
    input: {
      artifactHash: sha256,
      documentAssetId,
      endOffset: 42,
      id: nodeId,
      kind: "chunk",
      knowledgeSpaceId,
      parseArtifactId,
      permissionScope: ["tenant:tenant-1"],
      sourceLocation: { startOffset: 0 },
      startOffset: 0,
      text: "KnowledgeFS exposes agent-readable evidence.",
    },
    schema: KnowledgeNodeSchema,
  },
  {
    input: {
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
      knowledgeSpaceId,
      nodeId,
      projectionVersion: 1,
      status: "ready",
      type: "dense-vector",
    },
    schema: IndexProjectionSchema,
  },
  {
    input: {
      artifactHash: sha256,
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      knowledgeSpaceId,
      nodes: [],
      outlineVersion: "document-outline-v1",
      parseArtifactId,
      version: 1,
    },
    schema: DocumentOutlineSchema,
  },
  {
    input: {
      artifactHash: sha256,
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      items: [],
      knowledgeSpaceId,
      manifestVersion: "document-multimodal-manifest-v1",
      parseArtifactId,
      version: 1,
    },
    schema: DocumentMultimodalManifestSchema,
  },
  {
    input: {
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      knowledgeSpaceId,
      resourceType: "node",
      targetId: nodeId,
      viewName: "by-type",
      viewType: "physical",
      virtualPath: "/knowledge/engineering/overview",
    },
    schema: KnowledgePathSchema,
  },
] as const;

describe("core domain models", () => {
  it("accepts authenticated subject claims for tenant-scoped requests", () => {
    const subject = AuthSubjectSchema.parse({
      scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
      subjectId: "user-1",
      tenantId: "tenant-1",
    });

    expect(subject).toEqual({
      scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
      subjectId: "user-1",
      tenantId: "tenant-1",
    });
  });

  it("rejects tenant identifiers that cannot be persisted losslessly", () => {
    const oversizedTenantId = "t".repeat(256);

    expect(() =>
      AuthSubjectSchema.parse({
        scopes: [],
        subjectId: "user-1",
        tenantId: oversizedTenantId,
      }),
    ).toThrow();
    expect(() =>
      KnowledgeSpaceSchema.parse({
        createdAt,
        id: knowledgeSpaceId,
        name: "Engineering Knowledge",
        revision: 1,
        slug: "engineering-knowledge",
        tenantId: oversizedTenantId,
        updatedAt,
      }),
    ).toThrow();
  });

  it("accepts the minimum first-sprint space, source, and document asset contracts", () => {
    const space = KnowledgeSpaceSchema.parse({
      createdAt,
      id: knowledgeSpaceId,
      name: "Engineering Knowledge",
      revision: 1,
      slug: "engineering-knowledge",
      tenantId: "tenant-1",
      updatedAt,
    });
    const source = SourceSchema.parse({
      createdAt,
      id: sourceId,
      knowledgeSpaceId,
      name: "Architecture Uploads",
      status: "active",
      type: "upload",
      updatedAt,
      uri: "s3://knowledge/uploads",
    });
    const asset = DocumentAssetSchema.parse({
      createdAt,
      filename: "architecture.md",
      id: documentAssetId,
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/documents/architecture.md",
      parserStatus: "pending",
      sha256,
      sizeBytes: 4096,
      sourceId,
      updatedAt,
      version: 1,
    });

    expect(space.slug).toBe("engineering-knowledge");
    expect(source.permissionScope).toEqual([]);
    expect(asset.version).toBe(1);
    expect(asset.updatedAt).toBe(updatedAt);
  });

  it("rejects identifiers and paths that exceed portable TiDB key bounds", () => {
    expect(() =>
      KnowledgeSpaceSchema.parse({
        createdAt,
        id: knowledgeSpaceId,
        name: "Engineering Knowledge",
        revision: 1,
        slug: "a".repeat(161),
        tenantId: "tenant-1",
        updatedAt,
      }),
    ).toThrow();

    expect(() =>
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
        knowledgeSpaceId,
        resourceType: "node",
        targetId: nodeId,
        viewName: "by-type",
        viewType: "physical",
        virtualPath: `/knowledge/${"a".repeat(374)}`,
      }),
    ).toThrow();
  });

  it("accepts parse artifacts, knowledge nodes, and index projections with versioning fields", () => {
    const artifact = ParseArtifactSchema.parse({
      artifactHash: sha256,
      contentType: "structured",
      createdAt,
      documentAssetId,
      elements: [
        {
          id: "element-1",
          pageNumber: 1,
          sectionPath: ["Overview"],
          text: "KnowledgeFS exposes agent-readable evidence.",
          type: "paragraph",
        },
      ],
      id: parseArtifactId,
      parser: "native-markdown",
      updatedAt,
      version: 1,
    });
    const node = KnowledgeNodeSchema.parse({
      artifactHash: sha256,
      documentAssetId,
      endOffset: 42,
      id: nodeId,
      kind: "chunk",
      knowledgeSpaceId,
      parseArtifactId,
      permissionScope: ["tenant:tenant-1"],
      sourceLocation: {
        pageNumber: 1,
        sectionPath: ["Overview"],
        startOffset: 0,
      },
      startOffset: 0,
      text: "KnowledgeFS exposes agent-readable evidence.",
      updatedAt,
    });
    const projection = IndexProjectionSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
      knowledgeSpaceId,
      model: "text-embedding-3-small",
      nodeId,
      projectionVersion: 1,
      status: "ready",
      type: "dense-vector",
      updatedAt,
    });

    expect(artifact.elements).toHaveLength(1);
    expect(node.sourceLocation.sectionPath).toEqual(["Overview"]);
    expect(projection.projectionVersion).toBe(1);
    expect(artifact.updatedAt).toBe(updatedAt);
    expect(node.updatedAt).toBe(updatedAt);
    expect(projection.updatedAt).toBe(updatedAt);
  });

  it("accepts publication generation IDs on generation-scoped derived artifacts", () => {
    for (const { input, schema } of generationScopedDerivedArtifacts) {
      const artifact = schema.parse({ ...input, publicationGenerationId });

      expect(artifact.publicationGenerationId).toBe(publicationGenerationId);
    }
  });

  it("keeps generation-scoped derived artifacts without publication IDs backward compatible", () => {
    for (const { input, schema } of generationScopedDerivedArtifacts) {
      const artifact = schema.parse(input);

      expect(artifact.publicationGenerationId).toBeUndefined();
    }
  });

  it("rejects invalid publication generation IDs on generation-scoped derived artifacts", () => {
    for (const { input, schema } of generationScopedDerivedArtifacts) {
      expect(() => schema.parse({ ...input, publicationGenerationId: "not-a-uuid" })).toThrow();
    }
  });

  it("rejects the reserved zero UUID for publication generations", () => {
    expect(() => PublicationGenerationIdSchema.parse(PUBLICATION_GENERATION_ID_SENTINEL)).toThrow(
      "Publication generation ID must be a non-zero UUID",
    );

    for (const { input, schema } of generationScopedDerivedArtifacts) {
      expect(() =>
        schema.parse({
          ...input,
          publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
        }),
      ).toThrow("Publication generation ID must be a non-zero UUID");
    }
  });

  it("canonicalizes publication generation IDs before deterministic builders consume them", () => {
    expect(PublicationGenerationIdSchema.parse("018F0D60-7A49-7CC2-9C1B-5B36F18F2E01")).toBe(
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
    );
  });

  it("accepts document outlines as a citeable document-structure layer", () => {
    const outline = DocumentOutlineSchema.parse({
      artifactHash: sha256,
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      knowledgeSpaceId,
      nodes: [
        {
          childNodeIds: ["section-1-1"],
          children: [
            {
              endOffset: 120,
              endPage: 2,
              id: "section-1-1",
              level: 2,
              sectionPath: ["Overview", "Architecture"],
              sourceElementIds: ["element-2"],
              startOffset: 40,
              startPage: 1,
              summary: "Architecture details",
              title: "Architecture",
              titleLocation: {
                confidence: 0.98,
                endOffset: 52,
                matchedText: "Architecture",
                pageNumber: 1,
                source: "parser-heading",
                startOffset: 40,
              },
              tocSource: "parser-heading",
            },
          ],
          endOffset: 120,
          endPage: 2,
          id: "section-1",
          level: 1,
          metadata: { quality: "verified" },
          sectionPath: ["Overview"],
          sourceElementIds: ["element-1"],
          sourceNodeIds: [nodeId],
          startOffset: 0,
          startPage: 1,
          summary: "Overview summary",
          title: "Overview",
          tocSource: "native-toc",
        },
      ],
      outlineVersion: "document-outline-v1",
      parseArtifactId,
      updatedAt,
      version: 1,
    });

    expect(outline.nodes[0]?.children[0]?.sectionPath).toEqual(["Overview", "Architecture"]);
    expect(outline.nodes[0]?.children[0]?.sourceNodeIds).toEqual([]);
    expect(outline.nodes[0]?.metadata).toEqual({ quality: "verified" });
  });

  it("accepts document multimodal manifests as a document resource inventory", () => {
    const manifest = DocumentMultimodalManifestSchema.parse({
      artifactHash: sha256,
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      items: [
        {
          assetRef: {
            contentType: "image/png",
            objectKey:
              "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/artifacts/figure-1.png",
            sha256: "b".repeat(64),
            variants: {
              thumbnail: {
                contentType: "image/png",
                height: 90,
                objectKey:
                  "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/artifacts/figure-1-thumbnail.png",
                sha256: "c".repeat(64),
                width: 120,
              },
            },
          },
          boundingBox: { height: 120, width: 240, x: 10, y: 20 },
          caption: "Renewal trend chart",
          enrichment: {
            asset: "provided",
            caption: "provided",
            ocr: "provided",
            tableStructure: "unsupported",
            visualEmbedding: "missing",
          },
          id: "figure-1",
          modality: "image",
          ocrText: "Q1 renewals increased 12%",
          pageNumber: 2,
          parseElementId: "element-image-1",
          sectionPath: ["Metrics"],
          sourceMetadata: { caption: "Renewal trend chart" },
          textPreview: "Q1 renewals increased 12%",
          title: "Renewal trend chart",
        },
      ],
      knowledgeSpaceId,
      manifestVersion: "document-multimodal-manifest-v1",
      metadata: { modalityCounts: { image: 1 } },
      parseArtifactId,
      updatedAt,
      version: 1,
    });

    expect(manifest.items[0]?.boundingBox).toEqual({ height: 120, width: 240, x: 10, y: 20 });
    expect(manifest.items[0]?.assetRef?.variants?.thumbnail?.width).toBe(120);
    expect(manifest.items[0]?.enrichment.visualEmbedding).toBe("missing");
  });

  it("builds stable projection set fingerprints from model, strategy, version, and source snapshots", async () => {
    const material = ProjectionSetFingerprintMaterialSchema.parse({
      chunkerVersion: "chunker-v1",
      indexVersion: "index-v1",
      knowledgeSpaceId,
      nodeSchemaVersion: 1,
      parserPolicyVersion: "parser-v1",
      projectionSetVersion: "projection-set-v1",
      projections: [
        {
          indexVersion: "fts-v1",
          projectionVersion: 4,
          strategy: "bm25-default",
          type: "fts",
        },
        {
          indexVersion: "dense-v1",
          model: "text-embedding-3-small",
          projectionVersion: 4,
          strategy: "semantic-default",
          type: "dense-vector",
        },
      ],
      sourceSnapshots: [
        {
          artifactHash: "b".repeat(64),
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
          sha256: "c".repeat(64),
          version: 2,
        },
        {
          artifactHash: "d".repeat(64),
          documentAssetId,
          sha256,
          version: 1,
        },
      ],
    });
    const reordered = ProjectionSetFingerprintMaterialSchema.parse({
      ...material,
      projections: [...material.projections].reverse(),
      sourceSnapshots: [...material.sourceSnapshots].reverse(),
    });

    const fingerprint = await buildProjectionSetFingerprint(material);

    expect(ProjectionSetFingerprintSchema.parse(fingerprint)).toBe(fingerprint);
    await expect(buildProjectionSetFingerprint(reordered)).resolves.toBe(fingerprint);
    await expect(
      buildProjectionSetFingerprint({
        ...material,
        parserPolicyVersion: "parser-v2",
      }),
    ).resolves.not.toBe(fingerprint);
    expect(
      normalizeProjectionSetFingerprintMaterial(material).projections.map((item) => item.type),
    ).toEqual(["dense-vector", "fts"]);
    expect(() =>
      ProjectionSetFingerprintMaterialSchema.parse({
        ...material,
        projections: [],
      }),
    ).toThrow();
  });

  it("accepts bounded artifact segments with inline text or immutable object pointers", () => {
    const inlineSegment = ArtifactSegmentSchema.parse({
      artifactHash: sha256,
      checksum: sha256,
      contentEncoding: "utf-8",
      createdAt,
      documentAssetId,
      endOffset: 42,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
      inlineText: "KnowledgeFS exposes agent-readable evidence.",
      knowledgeSpaceId,
      parseArtifactId,
      segmentIndex: 0,
      segmentType: "text",
      sourceLocation: {
        pageNumber: 1,
        sectionPath: ["Overview"],
        startOffset: 0,
      },
      startOffset: 0,
      updatedAt,
    });
    const objectSegment = ArtifactSegmentSchema.parse({
      artifactHash: sha256,
      checksum: "b".repeat(64),
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
      knowledgeSpaceId,
      objectKey:
        "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/artifacts/018f0d60-7a49-7cc2-9c1b-5b36f18f2c45/000001.json",
      parseArtifactId,
      segmentIndex: 1,
      segmentType: "table",
      sourceLocation: {
        pageNumber: 2,
        sectionPath: ["Data"],
      },
      sizeBytes: 4096,
    });

    expect(inlineSegment.metadata).toEqual({});
    expect(inlineSegment.sourceLocation.sectionPath).toEqual(["Overview"]);
    expect(objectSegment.objectKey).toContain("/artifacts/");
    expect(objectSegment.contentEncoding).toBe("utf-8");
  });

  it("rejects unsafe or unbounded artifact segments", () => {
    expect(() =>
      ArtifactSegmentSchema.parse({
        artifactHash: sha256,
        checksum: sha256,
        createdAt,
        documentAssetId,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12",
        inlineText: "x".repeat(64 * 1024 + 1),
        knowledgeSpaceId,
        parseArtifactId,
        segmentIndex: 0,
        segmentType: "text",
        sourceLocation: {},
      }),
    ).toThrow();
    expect(() =>
      ArtifactSegmentSchema.parse({
        artifactHash: sha256,
        checksum: sha256,
        createdAt,
        documentAssetId,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d13",
        knowledgeSpaceId,
        objectKey: "../tenant-1/artifact.json",
        parseArtifactId,
        segmentIndex: 0,
        segmentType: "text",
        sourceLocation: {},
      }),
    ).toThrow();
    expect(() =>
      ArtifactSegmentSchema.parse({
        artifactHash: sha256,
        checksum: sha256,
        createdAt,
        documentAssetId,
        endOffset: 10,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d14",
        knowledgeSpaceId,
        parseArtifactId,
        segmentIndex: 0,
        segmentType: "text",
        sourceLocation: {},
        startOffset: 11,
      }),
    ).toThrow();
  });

  it("accepts embedding model registry entries for versioned projection builds", () => {
    const model = EmbeddingModelSchema.parse({
      createdAt,
      dimension: 1536,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4a",
      maxTokens: 8192,
      metadata: { family: "text-embedding" },
      metric: "cosine",
      modelId: "text-embedding-3-small",
      provider: "openai",
      status: "active",
      tokenizer: "cl100k_base",
      updatedAt,
      version: "2026-05-01",
    });

    expect(model.dimension).toBe(1536);
    expect(model.metric).toBe("cosine");
    expect(model.maxTokens).toBe(8192);
    expect(() =>
      EmbeddingModelSchema.parse({
        ...model,
        modelId: "m".repeat(256),
      }),
    ).toThrow();
  });

  it("creates a default KnowledgeSpace manifest with explicit control-plane policy versions", () => {
    const manifest = createDefaultKnowledgeSpaceManifest({
      createdAt,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4b",
      knowledgeSpaceId,
      tenantId: "tenant-1",
      updatedAt,
    });

    expect(manifest).toEqual({
      consistencyPolicy: {
        defaultClass: "path-consistent",
        snapshotTtlSeconds: 3600,
      },
      createdAt,
      encryptionPolicy: {
        strategy: "provider-managed",
      },
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4b",
      knowledgeSpaceId,
      manifestVersion: 1,
      metadata: {},
      metadataDialect: "portable",
      minClientVersion: "0.0.0",
      nodeSchemaVersion: 1,
      objectKeyPrefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      parserPolicyVersion: "default-v1",
      projectionSetVersion: "default-v1",
      quotaPolicy: {
        maxActiveJobCount: null,
        maxActiveSessionCount: null,
        maxArtifactBytes: null,
        maxGraphEntityCount: null,
        maxGraphRelationCount: null,
        maxNodeCount: null,
        maxProjectionCount: null,
        maxRawDocumentBytes: null,
        maxSegmentCount: null,
        maxTraceBytes: null,
        providerBudgets: {
          maxEmbeddingTokensPerDay: null,
          maxLlmTokensPerDay: null,
          maxParserPagesPerDay: null,
          maxRerankRequestsPerDay: null,
        },
      },
      retentionPolicy: {
        artifactVersionsToKeep: 3,
        failedCommitRetentionDays: 14,
        traceRetentionDays: 30,
      },
      storageProvider: "memory-dev",
      tenantId: "tenant-1",
      updatedAt,
    });
  });

  it("creates stable opaque vector-space ids and revisions embedding profile changes", async () => {
    const selection = {
      model: "text-embedding/custom-v2",
      pluginId: "plugin-demo",
      provider: "tenant-provider",
    };
    const profile = await createKnowledgeSpaceEmbeddingProfile(selection);
    const repeated = await createKnowledgeSpaceEmbeddingProfile(selection);

    expect(profile).toEqual(repeated);
    expect(profile).toMatchObject({ ...selection, revision: 1 });
    expect(profile.vectorSpaceId).toMatch(/^embedding-space-sha256:[a-f0-9]{64}$/);
    expect(profile.vectorSpaceId).not.toContain(selection.model);
    await expect(updateKnowledgeSpaceEmbeddingProfile(profile, selection)).resolves.toBe(profile);

    const initial = await updateKnowledgeSpaceEmbeddingProfile(undefined, selection);
    expect(initial).toMatchObject({ ...selection, revision: 1 });
    expect(initial.vectorSpaceId).toBe(profile.vectorSpaceId);

    const changed = await updateKnowledgeSpaceEmbeddingProfile(profile, {
      ...selection,
      model: "text-embedding/custom-v3",
    });
    expect(changed.revision).toBe(2);
    expect(changed.vectorSpaceId).not.toBe(profile.vectorSpaceId);

    const installIdentity = {
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      dimension: 1536,
      distanceMetric: "cosine" as const,
      pluginUniqueIdentifier: "plugin-demo:2@sha256:installed-a",
      schemaFingerprint: `sha256:${"b".repeat(64)}`,
    };
    const installBound = await createKnowledgeSpaceEmbeddingProfile(selection, 1, installIdentity);
    expect(installBound.vectorSpaceId).not.toBe(profile.vectorSpaceId);
    await expect(
      updateKnowledgeSpaceEmbeddingProfile(installBound, selection, installIdentity),
    ).resolves.toBe(installBound);
    const upgradedInstall = await updateKnowledgeSpaceEmbeddingProfile(installBound, selection, {
      ...installIdentity,
      pluginUniqueIdentifier: "plugin-demo:3@sha256:installed-b",
    });
    expect(upgradedInstall.revision).toBe(2);
    expect(upgradedInstall.vectorSpaceId).not.toBe(installBound.vectorSpaceId);

    expect(() =>
      KnowledgeSpaceEmbeddingSelectionSchema.parse({
        ...selection,
        credentials: { apiKey: "must-not-persist" },
      }),
    ).toThrow();
    expect(() =>
      KnowledgeSpaceEmbeddingSelectionSchema.parse({ ...selection, dimension: 1536 }),
    ).toThrow();
  });

  it("validates versioned per-space retrieval profiles and mode-final thresholds", () => {
    const input = {
      defaultMode: "deep" as const,
      reasoningModel: {
        model: "gpt-4.1",
        pluginId: "openai-plugin",
        provider: "openai",
      },
      rerank: {
        enabled: true,
        model: {
          model: "rerank-v3.5",
          pluginId: "cohere-plugin",
          provider: "cohere",
        },
      },
      scoreThreshold: { enabled: true, stage: "rerank" as const, value: 0.5 },
      topK: 8,
    };

    expect(createKnowledgeSpaceRetrievalProfile(input)).toMatchObject({
      ...input,
      revision: 1,
    });
    expect(createKnowledgeSpaceRetrievalProfile(input, 3).revision).toBe(3);
    expect(() =>
      KnowledgeSpaceRetrievalProfileInputSchema.parse({
        ...input,
        rerank: { enabled: true },
      }),
    ).toThrow("Enabled rerank requires a model selection");
    expect(
      KnowledgeSpaceRetrievalProfileInputSchema.parse({
        ...input,
        defaultMode: "research",
        rerank: { enabled: false },
        scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
      }),
    ).toMatchObject({
      defaultMode: "research",
      rerank: { enabled: false },
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
    });
    const thresholdWithoutRerank = {
      ...input,
      rerank: { enabled: false },
      scoreThreshold: { enabled: true, stage: "mode-final" as const, value: 0.5 },
    };
    expect(
      validateKnowledgeSpaceRetrievalProfileForMode(thresholdWithoutRerank, "research"),
    ).toBeUndefined();
    expect(validateKnowledgeSpaceRetrievalProfileForMode(thresholdWithoutRerank, "fast")).toEqual({
      code: "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK",
      message:
        "Fast/Deep mode-final score threshold requires the knowledge-space reranker to be enabled",
      mode: "fast",
    });
    expect(() =>
      createKnowledgeSpaceRetrievalProfile({ ...thresholdWithoutRerank, defaultMode: "deep" }),
    ).toThrow(KnowledgeSpaceRetrievalProfileModeError);
    expect(
      createKnowledgeSpaceRetrievalProfile({
        ...thresholdWithoutRerank,
        defaultMode: "research",
      }),
    ).toMatchObject({
      defaultMode: "research",
      rerank: { enabled: false },
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
    });
    expect(() =>
      KnowledgeSpaceRetrievalProfileInputSchema.parse({
        ...input,
        scoreThreshold: { enabled: true, stage: "rerank" },
      }),
    ).toThrow("Enabled score threshold requires a value");
  });

  it("validates the supported KnowledgeSpace consistency classes", () => {
    expect(KnowledgeSpaceConsistencyClassSchema.options).toEqual([
      "path-consistent",
      "snapshot-consistent",
      "cache-consistent",
      "eventual-preview",
    ]);

    expect(KnowledgeSpaceConsistencyClassSchema.parse("path-consistent")).toBe("path-consistent");
    expect(KnowledgeSpaceConsistencyClassSchema.parse("snapshot-consistent")).toBe(
      "snapshot-consistent",
    );
    expect(KnowledgeSpaceConsistencyClassSchema.parse("cache-consistent")).toBe("cache-consistent");
    expect(KnowledgeSpaceConsistencyClassSchema.parse("eventual-preview")).toBe("eventual-preview");
    expect(() => KnowledgeSpaceConsistencyClassSchema.parse("linearizable")).toThrow();
  });

  it("accepts durable KnowledgeSpace manifest settings and rejects unsafe object prefixes", () => {
    const manifest = KnowledgeSpaceManifestSchema.parse({
      consistencyPolicy: {
        cacheTtlSeconds: 30,
        defaultClass: "snapshot-consistent",
        snapshotTtlSeconds: 600,
      },
      createdAt,
      embeddingProfileFrozenAt: updatedAt,
      encryptionPolicy: {
        keyRef: "kms://tenant-1/knowledge",
        strategy: "customer-managed",
      },
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4c",
      knowledgeSpaceId,
      manifestVersion: 2,
      metadata: { rollout: "blue" },
      metadataDialect: "postgres",
      minClientVersion: "1.2.3",
      nodeSchemaVersion: 4,
      objectKeyPrefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      parserPolicyVersion: "parser-v7",
      projectionSetVersion: "projection-v5",
      quotaPolicy: {
        maxActiveJobCount: 25,
        maxActiveSessionCount: 50,
        maxArtifactBytes: 20_000,
        maxGraphEntityCount: 2_000,
        maxGraphRelationCount: 5_000,
        maxNodeCount: 500,
        maxProjectionCount: 1_000,
        maxRawDocumentBytes: 10_000,
        maxSegmentCount: 250,
        maxTraceBytes: 1_000_000,
        providerBudgets: {
          maxEmbeddingTokensPerDay: 1_000_000,
          maxLlmTokensPerDay: 500_000,
          maxParserPagesPerDay: 10_000,
          maxRerankRequestsPerDay: 20_000,
        },
      },
      retentionPolicy: {
        artifactVersionsToKeep: 5,
        failedCommitRetentionDays: 7,
        traceRetentionDays: 60,
      },
      storageProvider: "s3-compatible",
      tenantId: "tenant-1",
      updatedAt,
    });

    expect(manifest.storageProvider).toBe("s3-compatible");
    expect(manifest.embeddingProfileFrozenAt).toBe(updatedAt);
    expect(manifest.consistencyPolicy.defaultClass).toBe("snapshot-consistent");
    expect(manifest.quotaPolicy.maxSegmentCount).toBe(250);
    expect(manifest.quotaPolicy.maxTraceBytes).toBe(1_000_000);
    expect(manifest.quotaPolicy.providerBudgets.maxLlmTokensPerDay).toBe(500_000);
    expect(() =>
      KnowledgeSpaceManifestSchema.parse({
        ...manifest,
        objectKeyPrefix: "../tenant-1/spaces/bad",
      }),
    ).toThrow();
    expect(() =>
      KnowledgeSpaceManifestSchema.parse({
        ...manifest,
        embeddingProfileFrozenAt: "not-a-date",
      }),
    ).toThrow();
  });

  it("keeps unverified model intent separate from active profile fields", () => {
    const pending = KnowledgeSpacePendingModelConfigurationSchema.parse({
      digest: sha256,
      embeddingSelection: {
        model: "embed-user-selected",
        pluginId: "plugin-demo",
        provider: "tenant-provider",
      },
      retrievalProfile: {
        defaultMode: "fast",
        reasoningModel: {
          model: "reasoning-user-selected",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        rerank: { enabled: false },
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 5,
      },
      revision: 1,
      state: "pending-validation",
    });

    expect(pending).not.toHaveProperty("dimension");
    expect(pending).not.toHaveProperty("vectorSpaceId");
    expect(() =>
      KnowledgeSpacePendingModelConfigurationSchema.parse({
        digest: sha256,
        retrievalProfile: { ...pending.retrievalProfile, defaultMode: "deep" },
        revision: 1,
        state: "pending-validation",
      }),
    ).toThrow("Fast/Deep pending model configuration requires an embedding selection");
    expect(() =>
      KnowledgeSpacePendingModelConfigurationSchema.parse({
        ...pending,
        failure: {
          code: "MODEL_SELECTION_NOT_FOUND",
          failedAt: updatedAt,
          message: "provider secret must never be persisted here",
          retryable: false,
        },
        state: "validation-failed",
      }),
    ).toThrow();
  });

  it("rejects pending model configuration without any model selection", () => {
    expect(() =>
      KnowledgeSpacePendingModelConfigurationSchema.parse({
        digest: sha256,
        revision: 1,
        state: "pending-validation",
      }),
    ).toThrow("A pending model configuration must contain at least one model selection");
  });

  it("rejects pending validation state that already contains failure metadata", () => {
    expect(() =>
      KnowledgeSpacePendingModelConfigurationSchema.parse({
        digest: sha256,
        embeddingSelection: {
          model: "embed-user-selected",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        failure: {
          code: "MODEL_SELECTION_NOT_FOUND",
          failedAt: updatedAt,
          retryable: false,
        },
        revision: 1,
        state: "pending-validation",
      }),
    ).toThrow("Pending model validation must not contain a failure");
  });

  it("rejects failed validation state without failure metadata", () => {
    expect(() =>
      KnowledgeSpacePendingModelConfigurationSchema.parse({
        digest: sha256,
        embeddingSelection: {
          model: "embed-user-selected",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        revision: 1,
        state: "validation-failed",
      }),
    ).toThrow("Failed model validation requires failure metadata");
  });

  it("validates expanded KnowledgeSpace quota policies with defaulted nullable limits", () => {
    const policy = KnowledgeSpaceQuotaPolicySchema.parse({
      maxRawDocumentBytes: 10_000,
      providerBudgets: {
        maxEmbeddingTokensPerDay: 1_000_000,
      },
    });

    expect(policy).toEqual({
      maxActiveJobCount: null,
      maxActiveSessionCount: null,
      maxArtifactBytes: null,
      maxGraphEntityCount: null,
      maxGraphRelationCount: null,
      maxNodeCount: null,
      maxProjectionCount: null,
      maxRawDocumentBytes: 10_000,
      maxSegmentCount: null,
      maxTraceBytes: null,
      providerBudgets: {
        maxEmbeddingTokensPerDay: 1_000_000,
        maxLlmTokensPerDay: null,
        maxParserPagesPerDay: null,
        maxRerankRequestsPerDay: null,
      },
    });
    expect(() =>
      KnowledgeSpaceQuotaPolicySchema.parse({
        maxGraphEntityCount: 0,
      }),
    ).toThrow();
    expect(() =>
      KnowledgeSpaceQuotaPolicySchema.parse({
        providerBudgets: {
          maxLlmTokensPerDay: -1,
        },
      }),
    ).toThrow();
  });

  it("accepts staged commit ledger entries for recoverable ingestion publication", () => {
    const commit = KnowledgeSpaceStagedCommitSchema.parse({
      checksum: sha256,
      createdAt,
      documentAssetId,
      errorCode: "parser_timeout",
      errorMessage: "Parser timed out before artifact publication.",
      expiresAt: "2026-06-10T08:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4d",
      idempotencyKey: "upload:tenant-1:architecture.md:1",
      knowledgeSpaceId,
      operationType: "document-upload",
      parseArtifactId,
      projectionFingerprint: "projection-v1:abc123",
      publishedObjectKey: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/final.md",
      rawObjectKey: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/staging/raw.md",
      sizeBytes: 4096,
      status: "failed-retryable",
      tenantId: "tenant-1",
      updatedAt,
    });

    expect(commit.operationType).toBe("document-upload");
    expect(commit.status).toBe("failed-retryable");
    expect(commit.errorCode).toBe("parser_timeout");
    expect(commit.sizeBytes).toBe(4096);
  });

  it("rejects staged commits with unbounded diagnostics or unsafe object keys", () => {
    const commit = {
      createdAt,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4e",
      idempotencyKey: "upload:tenant-1:architecture.md:2",
      knowledgeSpaceId,
      operationType: "artifact-segment-write",
      rawObjectKey: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/staging/segment-1.json",
      status: "object-staged",
      tenantId: "tenant-1",
      updatedAt,
    };

    expect(KnowledgeSpaceStagedCommitSchema.parse(commit).status).toBe("object-staged");
    expect(() =>
      KnowledgeSpaceStagedCommitSchema.parse({
        ...commit,
        errorMessage: "x".repeat(2001),
      }),
    ).toThrow();
    expect(() =>
      KnowledgeSpaceStagedCommitSchema.parse({
        ...commit,
        rawObjectKey: "../escape",
      }),
    ).toThrow();
    expect(() =>
      KnowledgeSpaceStagedCommitSchema.parse({
        ...commit,
        idempotencyKey: "i".repeat(256),
      }),
    ).toThrow();
  });

  it("accepts KnowledgeFS paths, evidence bundles, and answer traces", () => {
    const path = KnowledgePathSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      knowledgeSpaceId,
      metadata: { filename: "overview.md" },
      resourceType: "node",
      targetId: nodeId,
      version: 1,
      viewName: "by-type",
      viewType: "physical",
      virtualPath: "/knowledge/engineering/overview",
    });
    const bundle = EvidenceBundleSchema.parse({
      createdAt,
      id: bundleId,
      items: [
        {
          citations: [
            {
              documentAssetId,
              documentVersion: 1,
              pageNumber: 1,
              sectionPath: ["Overview"],
            },
          ],
          freshness: { status: "unknown" },
          metadata: {},
          nodeId,
          score: 0.93,
          scores: {
            final: 0.93,
            retrieval: 0.93,
          },
          text: "KnowledgeFS exposes agent-readable evidence.",
        },
      ],
      query: "What does KnowledgeFS expose?",
      state: "answerable",
      traceId,
    });
    const trace = AnswerTraceSchema.parse({
      createdAt,
      evidenceBundleId: bundleId,
      id: traceId,
      knowledgeSpaceId,
      mode: "fast",
      query: "What does KnowledgeFS expose?",
      steps: [
        {
          endedAt: updatedAt,
          name: "recall",
          startedAt: createdAt,
          status: "ok",
        },
      ],
    });

    expect(path.virtualPath).toBe("/knowledge/engineering/overview");
    expect(path.viewType).toBe("physical");
    expect(path.viewName).toBe("by-type");
    expect(path.metadata).toEqual({ filename: "overview.md" });
    expect(bundle.items[0]?.score).toBe(0.93);
    expect(trace.steps[0]?.name).toBe("recall");
  });

  it("requires evidence bundles to carry scores, citations, conflicts, freshness, and missing evidence details", () => {
    const bundle = EvidenceBundleSchema.parse({
      createdAt,
      id: bundleId,
      items: [
        {
          citations: [
            {
              artifactHash: "a".repeat(64),
              documentAssetId,
              documentVersion: 1,
              endOffset: 128,
              pageNumber: 2,
              sectionPath: ["Roadmap", "Milestones"],
              startOffset: 42,
            },
          ],
          conflicts: [
            {
              reason: "Newer roadmap contradicts the deprecated milestone date.",
              severity: "warning",
              withNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00",
            },
          ],
          freshness: {
            observedAt: createdAt,
            sourceUpdatedAt: updatedAt,
            status: "fresh",
          },
          metadata: { source: "evaluation" },
          nodeId,
          score: 0.92,
          scores: {
            final: 0.92,
            freshness: 0.8,
            rerank: 0.95,
            retrieval: 0.88,
          },
          text: "KnowledgeFS exposes agent-readable evidence.",
        },
      ],
      missingEvidence: [
        {
          expectedEvidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
          metadata: { source: "golden-question" },
          reason: "not-retrieved",
          text: "Need deployment latency evidence.",
        },
      ],
      query: "What does KnowledgeFS expose?",
      state: "partial",
      traceId,
    });

    expect(bundle.items[0]?.scores).toEqual({
      final: 0.92,
      freshness: 0.8,
      rerank: 0.95,
      retrieval: 0.88,
    });
    expect(bundle.items[0]?.citations[0]).toMatchObject({
      artifactHash: "a".repeat(64),
      startOffset: 42,
    });
    expect(bundle.items[0]?.freshness.status).toBe("fresh");
    expect(bundle.missingEvidence[0]).toMatchObject({
      reason: "not-retrieved",
      text: "Need deployment latency evidence.",
    });
    expect(() =>
      EvidenceBundleSchema.parse({
        createdAt,
        id: bundleId,
        items: [
          {
            nodeId,
            score: 1.2,
            text: "Invalid score.",
          },
        ],
        missingEvidence: ["missing old string"],
        query: "Invalid bundle",
        state: "partial",
      }),
    ).toThrow();
  });

  it("accepts golden questions with human-labeled expected evidence ids", () => {
    const goldenQuestion = GoldenQuestionSchema.parse({
      createdAt,
      expectedEvidenceIds: [nodeId],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      knowledgeSpaceId,
      metadata: { owner: "eval" },
      question: "What does KnowledgeFS expose?",
      tags: ["phase-1", "retrieval"],
      updatedAt,
    });

    expect(goldenQuestion.expectedEvidenceIds).toEqual([nodeId]);
    expect(goldenQuestion.metadata).toEqual({ owner: "eval" });
    expect(goldenQuestion.tags).toEqual(["phase-1", "retrieval"]);
  });

  it("defines SourceFS, KnowledgeFS, EvidenceFS, and workspace path namespaces", () => {
    expect(KnowledgeFsNamespaceSchema.options).toEqual([
      "sources",
      "knowledge",
      "evidence",
      "workspaces",
    ]);
    expect(buildKnowledgeFsPath("sources", ["uploads", "vendor-contract.pdf"])).toBe(
      "/sources/uploads/vendor-contract.pdf",
    );
    expect(buildKnowledgeFsPath("knowledge")).toBe("/knowledge");
    expect(buildKnowledgeFsPath("evidence", ["bundles", bundleId])).toBe(
      `/evidence/bundles/${bundleId}`,
    );
    expect(getKnowledgeFsPathNamespace("/knowledge/by-type/contract")).toBe("knowledge");
    expect(getKnowledgeFsPathNamespace("/workspaces/research/run-1")).toBe("workspaces");
    expect(getKnowledgeFsNamespaceSpec("sources")).toEqual({
      root: "/sources",
      supportsPhysicalViews: true,
    });
    expect(getKnowledgeFsNamespaceSpec("evidence")).toEqual({
      root: "/evidence",
      supportsPhysicalViews: false,
    });
    expect(() => buildKnowledgeFsPath("sources", ["bad/segment"])).toThrow(
      "KnowledgeFS path segments must not contain slashes",
    );
    expect(() => buildKnowledgeFsPath("sources", [""])).toThrow(
      "KnowledgeFS path segments must not be empty",
    );
    expect(() => buildKnowledgeFsPath("sources", ["bad segment"])).toThrow(
      "KnowledgeFS path segments must not contain whitespace",
    );
    expect(() => getKnowledgeFsPathNamespace("/tmp/outside")).toThrow(
      "KnowledgeFS path must start with a known namespace",
    );
  });

  it("accepts ResourceMount contracts for mounted SourceFS and KnowledgeFS resources", () => {
    const mount = ResourceMountSchema.parse({
      cachePolicy: {
        maxBytes: 1_048_576,
        strategy: "memory",
        ttlSeconds: 300,
      },
      capabilities: ["ls", "cat", "sync"],
      createdAt,
      freshnessPolicy: {
        strategy: "realtime",
      },
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      knowledgeSpaceId,
      lastSyncedAt: updatedAt,
      metadata: { label: "Uploads" },
      mode: "read",
      mountPath: "/sources/uploads",
      permissionScope: ["tenant:tenant-1"],
      permissionSnapshotVersion: 1,
      provider: "upload",
      resourceType: "source",
      sourcePointer: "upload://tenant-1/default",
      tenantId: "tenant-1",
    });

    expect(mount.mountPath).toBe("/sources/uploads");
    expect(mount.capabilities).toEqual(["ls", "cat", "sync"]);
    expect(mount.freshnessPolicy.strategy).toBe("realtime");
    expect(mount.cachePolicy.maxBytes).toBe(1_048_576);

    const defaulted = ResourceMountSchema.parse({
      capabilities: ["ls"],
      createdAt,
      freshnessPolicy: {
        strategy: "manual",
      },
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      knowledgeSpaceId,
      metadata: {},
      mode: "read",
      mountPath: "/sources/defaulted",
      permissionScope: ["tenant:tenant-1"],
      permissionSnapshotVersion: 1,
      provider: "upload",
      resourceType: "source",
      sourcePointer: "upload://tenant-1/defaulted",
      tenantId: "tenant-1",
    });

    expect(defaulted.cachePolicy).toEqual({ strategy: "none" });
    expect(() =>
      ResourceMountSchema.parse({
        ...defaulted,
        cachePolicy: { strategy: "memory", ttlSeconds: 86_401 },
      }),
    ).toThrow();
    expect(() =>
      ResourceMountSchema.parse({
        ...defaulted,
        cachePolicy: { maxBytes: 1_073_741_825, strategy: "memory" },
      }),
    ).toThrow();
  });

  it("validates KnowledgeFS runtime session contracts", () => {
    const session = KnowledgeFsSessionSchema.parse({
      clientKind: "mcp",
      clientVersion: "1.4.0",
      consistencyClass: "snapshot-consistent",
      createdAt,
      expiresAt: "2026-05-08T08:10:00.000Z",
      heartbeatAt: "2026-05-08T08:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      knowledgeSpaceId,
      metadata: { userAgent: "knowledge-mcp" },
      permissionSnapshot: ["knowledge-spaces:read", "knowledge-spaces:read"],
      subject: {
        scopes: ["knowledge-spaces:read"],
        subjectId: "subject-1",
        tenantId: "tenant-1",
      },
      tenantId: "tenant-1",
      updatedAt,
    });

    expect(session.clientKind).toBe("mcp");
    expect(session.consistencyClass).toBe("snapshot-consistent");
    expect(session.permissionSnapshot).toEqual(["knowledge-spaces:read", "knowledge-spaces:read"]);
    expect(() =>
      KnowledgeFsSessionSchema.parse({
        ...session,
        clientKind: "browser",
      }),
    ).toThrow();
    expect(() =>
      KnowledgeFsSessionSchema.parse({
        ...session,
        clientVersion: "dev",
      }),
    ).toThrow();
    expect(() =>
      KnowledgeFsSessionSchema.parse({
        ...session,
        consistencyClass: "linearizable",
      }),
    ).toThrow();
  });

  it("validates KnowledgeFS runtime lease contracts", () => {
    const lease = KnowledgeFsLeaseSchema.parse({
      acquiredAt: createdAt,
      expiresAt: "2026-05-08T08:10:00.000Z",
      heartbeatAt: "2026-05-08T08:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
      knowledgeSpaceId,
      leaseType: "publish",
      metadata: { commitId: "commit-1" },
      sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      status: "active",
      targetId: documentAssetId,
      targetType: "document-asset",
      targetVersion: 2,
      tenantId: "tenant-1",
      updatedAt,
      virtualPath: "/sources/uploads/architecture.md",
    });

    expect(lease.leaseType).toBe("publish");
    expect(lease.targetVersion).toBe(2);
    expect(lease.sessionId).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f2c53");
    expect(
      KnowledgeFsLeaseSchema.parse({
        ...lease,
        targetId: "tenant-1/staged/upload.md",
        targetType: "staged-commit",
        virtualPath: "/sources/staged/tenant-1%2Fstaged%2Fupload.md",
      }).targetType,
    ).toBe("staged-commit");
    expect(() =>
      KnowledgeFsLeaseSchema.parse({
        ...lease,
        leaseType: "exclusive-write",
      }),
    ).toThrow();
    expect(() =>
      KnowledgeFsLeaseSchema.parse({
        ...lease,
        virtualPath: "/unknown/uploads/architecture.md",
      }),
    ).toThrow();
    expect(() =>
      KnowledgeFsLeaseSchema.parse({
        ...lease,
        targetVersion: 0,
      }),
    ).toThrow();
  });

  it("validates KnowledgeFS fsck diagnostic contracts", () => {
    const report = KnowledgeFsckReportSchema.parse({
      cursor: "fsck-cursor-1",
      issues: [
        {
          code: "raw-object-missing",
          message: "Raw document object is missing",
          repairability: "manual",
          severity: "error",
          target: {
            documentAssetId,
            objectKey: "tenant-1/spaces/space/documents/asset.md",
            type: "raw-object",
          },
          type: "missing-raw-object",
        },
      ],
      knowledgeSpaceId,
      scannedAt: updatedAt,
      summary: {
        critical: 0,
        error: 1,
        info: 0,
        repairable: 0,
        scanned: 12,
        warning: 0,
      },
      tenantId: "tenant-1",
    });

    expect(report.issues[0]?.severity).toBe("error");
    expect(report.summary.scanned).toBe(12);
    expect(() =>
      KnowledgeFsckReportSchema.parse({
        ...report,
        issues: [
          {
            ...report.issues[0],
            severity: "panic",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      KnowledgeFsckReportSchema.parse({
        ...report,
        summary: {
          ...report.summary,
          scanned: -1,
        },
      }),
    ).toThrow();
  });

  it("validates KnowledgeFS GC dry-run contracts", () => {
    const report = KnowledgeFsGcDryRunReportSchema.parse({
      candidates: [
        {
          candidateType: "staged-object",
          count: 1,
          estimatedBytes: 2048,
          idempotencyKey: "gc:tenant-1:space-1:staged-object:object-1",
          reason: "expired staged upload",
          target: {
            objectKey: "tenant-1/spaces/space/staged/object-1",
            type: "staged-commit",
          },
        },
      ],
      cursor: "gc-cursor-1",
      dryRunId: "gc-dry-run-1",
      generatedAt: updatedAt,
      knowledgeSpaceId,
      summary: {
        candidateCount: 1,
        estimatedBytes: 2048,
        failedCommitCount: 0,
        stagedObjectCount: 1,
      },
      tenantId: "tenant-1",
    });

    expect(report.candidates[0]?.idempotencyKey).toContain("staged-object");
    expect(report.summary.estimatedBytes).toBe(2048);
    expect(() =>
      KnowledgeFsGcDryRunReportSchema.parse({
        ...report,
        candidates: [
          {
            ...report.candidates[0],
            candidateType: "everything",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      KnowledgeFsGcDryRunReportSchema.parse({
        ...report,
        summary: {
          ...report.summary,
          candidateCount: -1,
        },
      }),
    ).toThrow();
  });

  it("rejects invalid hashes, paths, scores, and offset ranges", () => {
    expect(() =>
      DocumentAssetSchema.parse({
        createdAt,
        filename: "bad.md",
        id: documentAssetId,
        knowledgeSpaceId,
        mimeType: "text/markdown",
        objectKey: "tenant-1/documents/bad.md",
        parserStatus: "pending",
        sha256: "not-a-sha",
        sizeBytes: 1,
        version: 1,
      }),
    ).toThrow();

    expect(() =>
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        knowledgeSpaceId,
        metadata: {},
        resourceType: "node",
        targetId: nodeId,
        viewName: "tmp",
        viewType: "physical",
        virtualPath: "/tmp/outside-namespace",
      }),
    ).toThrow();

    expect(() =>
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["shell"],
        createdAt,
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        knowledgeSpaceId,
        mode: "exec",
        mountPath: "/tmp/outside",
        permissionSnapshotVersion: 1,
        provider: "upload",
        resourceType: "source",
        sourcePointer: "upload://tenant-1/default",
        tenantId: "tenant-1",
      }),
    ).toThrow();

    expect(() =>
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        knowledgeSpaceId,
        metadata: {},
        resourceType: "node",
        targetId: nodeId,
        viewName: "knowledge",
        viewType: "physical",
        virtualPath: "knowledge/missing-leading-slash",
      }),
    ).toThrow();

    expect(() =>
      EvidenceBundleSchema.parse({
        createdAt,
        id: bundleId,
        items: [{ nodeId, score: 1.2, text: "too high" }],
        query: "bad score",
        state: "answerable",
      }),
    ).toThrow();

    expect(() =>
      KnowledgeNodeSchema.parse({
        artifactHash: sha256,
        documentAssetId,
        endOffset: 1,
        id: nodeId,
        kind: "chunk",
        knowledgeSpaceId,
        parseArtifactId,
        sourceLocation: { startOffset: 2 },
        startOffset: 2,
        text: "bad offsets",
      }),
    ).toThrow();
  });
});
