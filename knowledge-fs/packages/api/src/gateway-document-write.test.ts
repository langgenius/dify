import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ComputeRuntime } from "@knowledge/compute";
import {
  IndexProjectionSchema,
  KnowledgeNodeSchema,
  KnowledgeSpaceSchema,
  ParseArtifactSchema,
  createDefaultKnowledgeSpaceManifest,
} from "@knowledge/core";
import type { EmbedTextsInput, EmbedTextsResult, EmbeddingProvider } from "@knowledge/embeddings";
import type { ParserAdapter } from "@knowledge/parsers";
import { describe, expect, it } from "vitest";

import { CandidateVisibilityScanBudgetExceededError } from "./candidate-content-authorization";
import {
  type RegisterDocumentWriteHandlersOptions,
  registerDocumentWriteHandlers,
} from "./document-write-handlers";
import { DurableDeletionServiceError } from "./durable-deletion-service";
import {
  createAcceptingDurableDeletionService,
  createAllowingDurableDeletionSafetyOptions,
} from "./durable-deletion-test-utils";
import { createKnowledgeGatewayApp } from "./gateway-app";
import {
  DeletionObjectWriteAdmissionError,
  createDeletionLifecycleFenceGuard,
  createDocumentCompilationJobStateMachine,
  createInMemoryArtifactSegmentRepository,
  createInMemoryBulkOperationRepository,
  createInMemoryDeletionLifecycleFenceReader,
  createInMemoryDocumentAssetRepository,
  createInMemoryDocumentCompilationJobRepository,
  createInMemoryDocumentMultimodalManifestRepository,
  createInMemoryDocumentOutlineRepository,
  createInMemoryGraphIndexRepository,
  createInMemoryIndexProjectionRepository,
  createInMemoryKnowledgeFsLeaseRepository,
  createInMemoryKnowledgeNodeRepository,
  createInMemoryKnowledgePathRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryLogicalDocumentRepository,
  createInMemoryParseArtifactRepository,
  createInMemoryStagedCommitRepository,
  createInMemoryTraceRecorder,
  createKnowledgeFsOperationLeaseCoordinator,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createStaticAuthVerifier,
  createStaticStorageQuotaRepository,
} from "./index";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";
import { KnowledgeSpaceQuotaExceededError } from "./knowledge-space-quota-admission";
import {
  KnowledgeSpaceDocumentMutationDeletionActiveError,
  KnowledgeSpaceDocumentMutationLeaseActiveError,
  LegacySpacePublicationBootstrapAdmissionError,
  LegacySpacePublicationBootstrapSnapshotConflictError,
} from "./legacy-space-publication-bootstrap";
import {
  LogicalDocumentConflictError,
  LogicalDocumentNotFoundError,
  LogicalDocumentValidationError,
} from "./logical-document-repository";
import { StorageQuotaExceededError } from "./storage-quota";
import { createInitializedTestDocumentAssets } from "./test-candidate-content";

const readToken = "read-token";
const writeToken = "write-token";
const writeOnlyToken = "write-only-token";
const otherTenantToken = "other-tenant-token";

const readSubject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};
const writeSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};
const writeOnlySubject = {
  scopes: ["knowledge-spaces:write"],
  subjectId: "user-3",
  tenantId: "tenant-1",
};
const otherTenantSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-2",
  tenantId: "tenant-2",
};

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createTestAuthVerifier() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [otherTenantToken]: otherTenantSubject,
      [readToken]: readSubject,
      [writeOnlyToken]: writeOnlySubject,
      [writeToken]: writeSubject,
    },
  });
}

async function createTestSpaceAccess(knowledgeSpaceId: string) {
  const access = createKnowledgeSpaceAccessService({
    repository: createInMemoryKnowledgeSpaceAccessRepository({
      maxApiKeysPerSpace: 10,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
    }),
  });
  await access.initialize({
    knowledgeSpaceId,
    ownerSubjectId: writeSubject.subjectId,
    tenantId: writeSubject.tenantId,
  });
  return access;
}

function createRecordingParser(
  options: {
    readonly contentType?: "mixed" | "structured" | "text";
    readonly elements?: readonly unknown[];
    readonly fail?: boolean;
  } = {},
) {
  const calls: Parameters<ParserAdapter["parse"]>[0][] = [];
  const parser: ParserAdapter = {
    kind: "native-markdown",
    parse: async (input) => {
      calls.push({
        ...input,
        body: new Uint8Array(input.body),
      });

      if (options.fail) {
        throw new Error("parser failed");
      }

      return ParseArtifactSchema.parse({
        artifactHash: "c".repeat(64),
        contentType: options.contentType ?? "text",
        createdAt: "2026-05-09T11:00:01.000Z",
        documentAssetId: input.documentAssetId,
        elements: options.elements ?? [
          {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-1",
            metadata: {},
            sectionPath: [],
            text: "Parsed upload",
            type: "paragraph",
          },
        ],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        metadata: {
          filename: input.filename,
          mimeType: input.mimeType,
        },
        parser: "native-markdown",
        version: input.version,
      });
    },
  };

  return { calls, parser };
}

function createRecordingCompute() {
  const calls: Parameters<ComputeRuntime["chunkParseArtifact"]>[0][] = [];
  const compute: ComputeRuntime = {
    chunkParseArtifact: (input) => {
      calls.push({
        ...input,
        parseArtifact: ParseArtifactSchema.parse(input.parseArtifact),
        ...(input.permissionScope ? { permissionScope: [...input.permissionScope] } : {}),
      });

      return [
        KnowledgeNodeSchema.parse({
          artifactHash: input.parseArtifact.artifactHash,
          documentAssetId: input.parseArtifact.documentAssetId,
          endOffset: "Parsed upload".length,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
          kind: "chunk",
          knowledgeSpaceId: input.knowledgeSpaceId,
          metadata: {
            chunkIndex: 1,
            elementIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-1"],
            elementTypes: ["paragraph"],
          },
          parseArtifactId: input.parseArtifact.id,
          permissionScope: input.permissionScope ? [...input.permissionScope] : [],
          sourceLocation: {
            endOffset: "Parsed upload".length,
            sectionPath: [],
            startOffset: 0,
          },
          startOffset: 0,
          text: "Parsed upload",
        }),
      ];
    },
    countApproxTokens: (input) => input.length,
    countTokens: (input) => input.length,
    diffText: () => ({
      operations: [],
      stats: { delete: 0, equal: 0, insert: 0 },
    }),
    packEvidence: (input) => ({
      context: "",
      items: [],
      omitted: [],
      tokenBudget: input.tokenBudget,
      usedTokens: 0,
    }),
    rrfFuse: () => [],
  };

  return { calls, compute };
}

function createRecordingEmbeddingProvider() {
  const calls: Array<{ inputType: string | undefined; model: string; texts: string[] }> = [];
  const provider: EmbeddingProvider = {
    embed: async (input): Promise<EmbedTextsResult> => {
      calls.push({
        inputType: input.inputType,
        model: input.model,
        texts: [...input.texts],
      });

      return {
        dense: input.texts.map(() =>
          Array.from({ length: 1_536 }, (_, index) => [0.1, 0.2, 0.3][index] ?? 0),
        ),
        metadata: { model: input.model, provider: "static" },
        model: input.model,
      };
    },
    kind: "static",
    models: async () => [],
  };

  return { calls, provider };
}

async function sha256Hex(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("document write gateway integration", () => {
  it("uploads a document asset into tenant-scoped object storage", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const traces = createInMemoryTraceRecorder();
    let getObjectCalls = 0;
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        getObjectStream: async () => null,
        getObject: async (key: string) => {
          getObjectCalls += 1;
          return baseAdapter.objectStorage.getObject(key);
        },
      },
    };
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    const documentMultimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 10,
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const parser = createRecordingParser();
    const app = createKnowledgeGateway({
      adapter,
      artifactSegments,
      auth: createTestAuthVerifier(),
      documentAssets: createInMemoryDocumentAssetRepository({
        maxAssets: 10,
        now: () => "2026-05-09T11:00:00.000Z",
      }),
      documentMultimodalManifests,
      generateArtifactSegmentId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceManifests: manifests,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      parseArtifacts,
      parser: parser.parser,
      traces,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const form = new FormData();
    form.set("sourceId", "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44");
    form.set("file", new File([bytes], "Road Map.md", { type: "text/markdown" }));

    const uploaded = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: { ...bearer(writeToken), "x-trace-id": "trace-upload-1" },
        method: "POST",
      },
    );

    expect(uploaded.status).toBe(201);
    expect(uploaded.headers.get("x-trace-id")).toBe("trace-upload-1");
    const response = await uploaded.json();
    await expect(
      manifests.get({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      embeddingProfileFrozenAt: expect.any(String),
      manifestVersion: 2,
    });
    const expectedObjectKey =
      "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/road-map.md";

    expect(response).toEqual({
      createdAt: "2026-05-09T11:00:00.000Z",
      filename: "Road Map.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: {
        permissionScope: [],
        tenantId: "tenant-1",
        traceId: "trace-upload-1",
        uploadedBy: "user-1",
      },
      mimeType: "text/markdown",
      objectKey: expectedObjectKey,
      parserStatus: "parsed",
      sha256: await sha256Hex(bytes),
      sizeBytes: 4,
      sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      version: 1,
    });

    await expect(adapter.objectStorage.headObject(expectedObjectKey)).resolves.toMatchObject({
      contentType: "text/markdown",
      metadata: {
        assetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        sha256: await sha256Hex(bytes),
        tenantId: "tenant-1",
      },
      sizeBytes: 4,
    });
    expect(getObjectCalls).toBe(0);
    expect(parser.calls).toEqual([
      expect.objectContaining({
        body: bytes,
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        filename: "Road Map.md",
        mimeType: "text/markdown",
        version: 1,
      }),
    ]);
    await expect(
      parseArtifacts.getByDocumentVersion({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        version: 1,
      }),
    ).resolves.toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      metadata: {
        traceId: "trace-upload-1",
      },
      parser: "native-markdown",
      version: 1,
    });
    await expect(
      artifactSegments.listByArtifact({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          inlineText: "Parsed upload",
          metadata: {
            parseElementId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:element-1",
            parseElementType: "paragraph",
          },
          segmentIndex: 0,
          segmentType: "text",
          sourceLocation: {
            sectionPath: [],
            startOffset: 0,
          },
        },
      ],
    });
    await expect(
      documentMultimodalManifests.getByDocumentVersion({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        version: 1,
      }),
    ).resolves.toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      version: 1,
    });
    expect(
      traces.spans
        .filter((span) => span.attributes.traceId === "trace-upload-1")
        .map((span) => span.name),
    ).toEqual([
      "http.request",
      "ingestion.space_lookup",
      "ingestion.upload_read_hash",
      "ingestion.storage_quota_check",
      "ingestion.manifest_quota_check",
      "ingestion.staged_commit_received",
      "ingestion.source_asset_reservation",
      "ingestion.object_put",
      "ingestion.staged_commit_object_staged",
      "ingestion.object_verify",
      "ingestion.staged_commit_object_verified",
      "ingestion.document_path_upsert",
      "ingestion.staged_commit_metadata_prepared",
      "ingestion.parser_parse",
      "ingestion.pdf_rasterize",
      "ingestion.multimodal_assets_extract",
      "ingestion.artifact_create",
      "ingestion.outline_build",
      "ingestion.nodes_reindex",
      "ingestion.multimodal_manifest_upsert",
      "ingestion.artifact_segments_create",
      "ingestion.projections_publish",
      "ingestion.staged_commit_artifacts_built",
      "ingestion.status_update",
      "ingestion.staged_commit_published",
    ]);
    expect(JSON.stringify(traces.spans)).not.toContain("Bearer");
    expect(JSON.stringify(traces.spans)).not.toContain("Road Map");
    expect(JSON.stringify(traces.spans)).not.toContain("[1,2,3,4]");

    const readDocument = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      { headers: bearer(readToken) },
    );
    expect(readDocument.status).toBe(200);
    expect(readDocument.headers.get("x-trace-id")).toBeTruthy();
    await expect(readDocument.json()).resolves.toMatchObject({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      parserStatus: "parsed",
      sha256: await sha256Hex(bytes),
    });

    const readArtifact = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/parse-artifacts/1",
      { headers: bearer(readToken) },
    );
    expect(readArtifact.status).toBe(200);
    expect(readArtifact.headers.get("x-trace-id")).toBeTruthy();
    await expect(readArtifact.json()).resolves.toMatchObject({
      artifactHash: "c".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      elements: [{ text: "Parsed upload", type: "paragraph" }],
      metadata: {
        filename: "Road Map.md",
        mimeType: "text/markdown",
        traceId: "trace-upload-1",
      },
      parser: "native-markdown",
      version: 1,
    });

    const readOutline = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/outline",
      { headers: bearer(readToken) },
    );
    expect(readOutline.status).toBe(200);
    await expect(readOutline.json()).resolves.toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      metadata: {
        builder: "deterministic-parse-artifact",
        parser: "native-markdown",
      },
      nodes: [
        expect.objectContaining({
          sectionPath: ["Document"],
          summary: "Parsed upload",
          title: "Document",
          tocSource: "fallback",
        }),
      ],
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      version: 1,
    });

    const readMultimodal = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal",
      { headers: bearer(readToken) },
    );
    expect(readMultimodal.status).toBe(200);
    await expect(readMultimodal.json()).resolves.toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      items: [],
      manifestVersion: "document-multimodal-manifest-v1",
      metadata: {
        modalityCounts: { code: 0, image: 0, page: 0, table: 0 },
        source: "parse-artifact",
      },
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      version: 1,
    });

    const readOutlineFile = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/cat?path=/knowledge/docs/Road-Map.md--018f0d60/outline.json",
      { headers: bearer(readToken) },
    );
    expect(readOutlineFile.status).toBe(200);
    const outlineFile = await readOutlineFile.json();
    expect(outlineFile).toMatchObject({
      contentType: "application/json",
      path: "/knowledge/docs/Road-Map.md--018f0d60/outline.json",
      truncated: false,
    });
    expect(JSON.parse(outlineFile.text)).toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      nodes: [
        expect.objectContaining({
          summary: "Parsed upload",
          title: "Document",
        }),
      ],
    });

    const readMultimodalFile = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/cat?path=/knowledge/docs/Road-Map.md--018f0d60/multimodal.json",
      { headers: bearer(readToken) },
    );
    expect(readMultimodalFile.status).toBe(200);
    const multimodalFile = await readMultimodalFile.json();
    expect(multimodalFile).toMatchObject({
      contentType: "application/json",
      path: "/knowledge/docs/Road-Map.md--018f0d60/multimodal.json",
      truncated: false,
    });
    expect(JSON.parse(multimodalFile.text)).toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      items: [],
      manifestVersion: "document-multimodal-manifest-v1",
    });

    const findSections = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/find?path=/knowledge/docs/Road-Map.md--018f0d60/sections&limit=10&metadataKey=contentKind&metadataValue=document-section",
      { headers: bearer(readToken) },
    );
    expect(findSections.status).toBe(200);
    const sectionList = await findSections.json();
    expect(sectionList.items).toHaveLength(1);
    expect(sectionList.items[0]).toMatchObject({
      metadata: {
        contentKind: "document-section",
        sectionPath: ["Document"],
        title: "Document",
      },
      resourceType: "document",
    });

    const readSectionFile = await app.request(
      `/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/cat?path=${encodeURIComponent(sectionList.items[0].path)}`,
      { headers: bearer(readToken) },
    );
    expect(readSectionFile.status).toBe(200);
    await expect(readSectionFile.json()).resolves.toMatchObject({
      contentType: "text/markdown",
      text: "Parsed upload",
      truncated: false,
    });
  });

  it("serves a tenant-scoped multimodal item asset from manifest asset refs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const thumbnailBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const imageObjectKey =
      "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/assets/figure-1.png";
    const thumbnailObjectKey =
      "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/assets/figure-1-thumbnail.png";
    const imageSha = await sha256Hex(imageBytes);
    const thumbnailSha = await sha256Hex(thumbnailBytes);
    const parser = createRecordingParser({
      contentType: "mixed",
      elements: [
        {
          id: "figure-1",
          metadata: {
            assetRef: {
              contentType: "image/png",
              objectKey: imageObjectKey,
              sha256: imageSha,
              variants: {
                thumbnail: {
                  contentType: "image/png",
                  objectKey: thumbnailObjectKey,
                  sha256: thumbnailSha,
                },
              },
            },
            caption: "Pipeline diagram",
          },
          pageNumber: 2,
          sectionPath: ["Architecture"],
          text: "OCR pipeline labels",
          type: "image",
        },
      ],
    });
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: createInMemoryDocumentAssetRepository({
        maxAssets: 10,
        now: () => "2026-05-09T11:00:00.000Z",
      }),
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      parser: parser.parser,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await adapter.objectStorage.putObject({
      body: imageBytes,
      contentType: "image/png",
      key: imageObjectKey,
      metadata: {
        kind: "document-multimodal-asset",
        tenantId: "tenant-1",
      },
    });
    await adapter.objectStorage.putObject({
      body: thumbnailBytes,
      contentType: "image/png",
      key: thumbnailObjectKey,
      metadata: {
        kind: "document-multimodal-asset-variant",
        tenantId: "tenant-1",
      },
    });

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "Diagram.md", { type: "text/markdown" }),
    );

    const uploaded = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(uploaded.status).toBe(201);

    const manifestResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal",
      { headers: bearer(readToken) },
    );
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json();
    expect(manifest.items[0]).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: imageObjectKey,
        sha256: imageSha,
        variants: {
          thumbnail: {
            contentType: "image/png",
            objectKey: thumbnailObjectKey,
            sha256: thumbnailSha,
          },
        },
      },
      caption: "Pipeline diagram",
      enrichment: {
        asset: "provided",
        caption: "provided",
        ocr: "provided",
        visualEmbedding: "missing",
      },
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45:0:figure-1",
      modality: "image",
      pageNumber: 2,
      sectionPath: ["Architecture"],
    });

    const assetResponse = await app.request(
      `/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/${encodeURIComponent(manifest.items[0].id)}/asset`,
      { headers: bearer(readToken) },
    );
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toBe("image/png");
    expect(assetResponse.headers.get("content-disposition")).toBe("inline");
    expect(assetResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(assetResponse.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(assetResponse.headers.get("x-document-multimodal-item-id")).toBe(manifest.items[0].id);
    expect([...new Uint8Array(await assetResponse.arrayBuffer())]).toEqual([...imageBytes]);

    const thumbnailResponse = await app.request(
      `/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/${encodeURIComponent(manifest.items[0].id)}/asset?variant=thumbnail`,
      { headers: bearer(readToken) },
    );
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/png");
    expect(thumbnailResponse.headers.get("x-document-multimodal-asset-variant")).toBe("thumbnail");
    expect([...new Uint8Array(await thumbnailResponse.arrayBuffer())]).toEqual([...thumbnailBytes]);

    const findAssets = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/find?path=/knowledge/docs/Diagram.md--018f0d60/assets&limit=10&metadataKey=contentKind&metadataValue=document-multimodal-asset",
      { headers: bearer(readToken) },
    );
    expect(findAssets.status).toBe(200);
    const assetList = await findAssets.json();
    expect(assetList.items).toHaveLength(1);
    expect(assetList.items[0]).toMatchObject({
      metadata: {
        contentKind: "document-multimodal-asset",
        itemId: manifest.items[0].id,
        modality: "image",
        objectKey: imageObjectKey,
      },
      path: "/knowledge/docs/Diagram.md--018f0d60/assets/image-Pipeline-diagram--018f0d60.json",
    });

    const assetDescriptor = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/cat?path=/knowledge/docs/Diagram.md--018f0d60/assets/image-Pipeline-diagram--018f0d60.json",
      { headers: bearer(readToken) },
    );
    expect(assetDescriptor.status).toBe(200);
    const descriptorFile = await assetDescriptor.json();
    expect(descriptorFile).toMatchObject({
      contentType: "application/json",
      truncated: false,
    });
    expect(JSON.parse(descriptorFile.text)).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: imageObjectKey,
        sha256: imageSha,
      },
      assetUrl:
        "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/018f0d60-7a49-7cc2-9c1b-5b36f18f2c45%3A0%3Afigure-1/asset",
      itemId: manifest.items[0].id,
      thumbnailAssetRef: {
        contentType: "image/png",
        objectKey: thumbnailObjectKey,
        sha256: thumbnailSha,
      },
      thumbnailAssetUrl:
        "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/018f0d60-7a49-7cc2-9c1b-5b36f18f2c45%3A0%3Afigure-1/asset?variant=thumbnail",
    });
  });

  it("extracts embedded multimodal data URI assets during ingestion", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const admittedScopes: { knowledgeSpaceId: string; tenantId: string }[] = [];
    const parser = createRecordingParser({
      contentType: "mixed",
      elements: [
        {
          id: "embedded-figure",
          metadata: {
            assetRef: {
              contentType: "image/png",
              uri: "data:image/png;base64,AQIDBA==",
            },
            caption: "Embedded diagram",
          },
          sectionPath: ["Architecture"],
          text: "Embedded diagram",
          type: "image",
        },
      ],
    });
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      deletionObjectWriteAdmission: {
        withSpaceWriteAdmission: async (scope, write) => {
          admittedScopes.push({ ...scope });
          return write();
        },
      },
      documentAssets: createInMemoryDocumentAssetRepository({
        maxAssets: 10,
        now: () => "2026-05-09T11:00:00.000Z",
      }),
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      parser: parser.parser,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "Embedded.md", { type: "text/markdown" }));

    const uploaded = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(uploaded.status).toBe(201);
    expect(admittedScopes).toEqual([
      {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      },
      {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      },
    ]);

    const manifestResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal",
      { headers: bearer(readToken) },
    );
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json();
    const item = manifest.items[0];
    expect(item.assetRef).toMatchObject({
      contentType: "image/png",
      objectKey: expect.stringMatching(
        /^tenant-1\/spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43\/assets\/embedded-figure-[a-f0-9]{12}\.png$/u,
      ),
      sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    });
    expect(item.assetRef).not.toHaveProperty("uri");

    const assetResponse = await app.request(
      `/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/${encodeURIComponent(item.id)}/asset`,
      { headers: bearer(readToken) },
    );
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await assetResponse.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  it("lists document assets without requiring a KnowledgeFS virtual path view", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-09T10:00:00.000Z",
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const space = await spaces.create({
      name: "Uploads",
      slug: "uploads",
      tenantId: "tenant-1",
    });
    await assets.create({
      filename: "First.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId: space.id,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/first.md",
      sha256: "a".repeat(64),
      sizeBytes: 10,
    });
    await assets.create({
      filename: "Second.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      knowledgeSpaceId: space.id,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/second.md",
      sha256: "b".repeat(64),
      sizeBytes: 20,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      knowledgeSpaceAccess: await createTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });

    const firstPageResponse = await app.request(`/knowledge-spaces/${space.id}/documents?limit=1`, {
      headers: bearer(readToken),
    });
    expect(firstPageResponse.status).toBe(200);
    await expect(firstPageResponse.json()).resolves.toMatchObject({
      items: [{ filename: "First.md", id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43" }],
      nextCursor: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    });

    const secondPageResponse = await app.request(
      `/knowledge-spaces/${space.id}/documents?limit=1&cursor=018f0d60-7a49-7cc2-9c1b-5b36f18f2c43`,
      { headers: bearer(readToken) },
    );
    expect(secondPageResponse.status).toBe(200);
    await expect(secondPageResponse.json()).resolves.toMatchObject({
      items: [{ filename: "Second.md", id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44" }],
    });
  });

  it("runs semantic operator actions for topic materialization and entity extraction", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-09T10:00:00.000Z",
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const space = await spaces.create({
      name: "Uploads",
      slug: "uploads",
      tenantId: "tenant-1",
    });
    await assets.create({
      filename: "Renewal Policy.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId: space.id,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/renewal-policy.md",
      sha256: "a".repeat(64),
      sizeBytes: 10,
    });
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "b".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 67,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        kind: "chunk",
        knowledgeSpaceId: space.id,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        permissionScope: ["tenant:tenant-1"],
        sourceLocation: { endOffset: 67, sectionPath: ["Renewal"], startOffset: 0 },
        startOffset: 0,
        text: "Acme Renewal Policy requires 95% coverage by 2026 for renewal operations.",
      }),
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      knowledgeNodes: nodes,
      knowledgeSpaceAccess: await createTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
      semanticEntityExtractionMaxNodesPerRun: 10,
      semanticEntityExtractionProvider: {
        extract: async () => ({
          entities: [
            {
              confidence: 0.95,
              metadata: { canonicalName: "Acme Renewal Policy" },
              text: "Acme Renewal Policy",
              type: "policy",
            },
          ],
          metadata: { provider: "test-llm" },
        }),
      },
    });

    const topicResponse = await app.request(
      `/knowledge-spaces/${space.id}/semantic-views/topic/materialize`,
      {
        body: JSON.stringify({ limit: 10 }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(topicResponse.status).toBe(200);
    await expect(topicResponse.json()).resolves.toMatchObject({
      documentCount: 1,
      pathCount: 1,
      topicSlug: "uploaded-documents",
    });
    const topicList = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-topic&limit=10`,
      { headers: bearer(readToken) },
    );
    expect(topicList.status).toBe(200);
    await expect(topicList.json()).resolves.toMatchObject({
      items: [{ name: "uploaded-documents", path: "/knowledge/by-topic/uploaded-documents" }],
    });

    const entityResponse = await app.request(
      `/knowledge-spaces/${space.id}/semantic-views/entities/extract`,
      {
        body: JSON.stringify({ limit: 10 }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(entityResponse.status).toBe(200);
    await expect(entityResponse.json()).resolves.toMatchObject({
      entitiesExtracted: expect.any(Number),
      graphEntitiesIndexed: expect.any(Number),
      nodesScanned: 1,
      nodesUpdated: 1,
    });
    const entityList = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-entity&limit=10`,
      { headers: bearer(readToken) },
    );
    expect(entityList.status).toBe(200);
    await expect(entityList.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ kind: "directory" })]),
    });
  });

  it("returns a client-visible error when semantic entity extraction has no LLM provider", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-09T10:00:00.000Z",
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const space = await spaces.create({
      name: "Uploads",
      slug: "uploads",
      tenantId: "tenant-1",
    });
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "b".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 67,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        kind: "chunk",
        knowledgeSpaceId: space.id,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        permissionScope: [],
        sourceLocation: { endOffset: 67, sectionPath: ["Renewal"], startOffset: 0 },
        startOffset: 0,
        text: "Acme Renewal Policy requires 95% coverage by 2026 for renewal operations.",
      }),
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: await createInitializedTestDocumentAssets(space.id, [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      ]),
      knowledgeSpaceAccess: await createTestSpaceAccess(space.id),
      knowledgeNodes: nodes,
      knowledgeSpaces: spaces,
      semanticEntityExtractionMaxNodesPerRun: 10,
    });

    const response = await app.request(
      `/knowledge-spaces/${space.id}/semantic-views/entities/extract`,
      {
        body: JSON.stringify({ limit: 10 }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Semantic entity extraction requires an LLM provider",
    });
  });

  it("scrubs every derived row before removing a source upload that loses its deletion fence", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
    const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 10 });
    const paths = createInMemoryKnowledgePathRepository({
      maxBatchSize: 20,
      maxListLimit: 20,
      maxPaths: 20,
    });
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 10,
    });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const recordingParser = createRecordingParser();
    const parser: ParserAdapter = {
      ...recordingParser.parser,
      parse: async (input) => {
        const artifact = await recordingParser.parser.parse(input);
        await fences.activateFence({
          id: "source-delete-fence",
          knowledgeSpaceId,
          targetId: sourceId,
          targetType: "source",
          tenantId: "tenant-1",
        });
        return artifact;
      },
    };
    const app = createKnowledgeGateway({
      adapter,
      artifactSegments,
      auth: createTestAuthVerifier(),
      deletionLifecycleFence: createDeletionLifecycleFenceGuard(fences),
      documentAssets: assets,
      documentMultimodalManifests: multimodalManifests,
      documentOutlines: outlines,
      generateArtifactSegmentId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
      generateDocumentAssetId: () => documentAssetId,
      knowledgePaths: paths,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      parseArtifacts,
      parser,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const form = new FormData();
    form.set("sourceId", sourceId);
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "stale.md", {
        type: "text/markdown",
      }),
    );

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Knowledge space or source deletion is active",
    });
    await expect(assets.list({ knowledgeSpaceId, limit: 10 })).resolves.toMatchObject({
      items: [],
    });
    await expect(
      parseArtifacts.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toBeNull();
    await expect(
      artifactSegments.listByDocumentAsset({ documentAssetId, knowledgeSpaceId, maxSegments: 10 }),
    ).resolves.toEqual([]);
    await expect(
      outlines.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toBeNull();
    await expect(
      multimodalManifests.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toBeNull();
    await expect(
      paths.listPhysicalView({ knowledgeSpaceId, limit: 20, viewName: "docs" }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      adapter.objectStorage.getObject(
        `tenant-1/spaces/${knowledgeSpaceId}/documents/${documentAssetId}/stale.md`,
      ),
    ).resolves.toBeNull();
  });

  it("converts a synchronous parser failure to the winning deletion fence before responding", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      deletionLifecycleFence: createDeletionLifecycleFenceGuard(fences),
      documentAssets: assets,
      generateDocumentAssetId: () => documentAssetId,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      parser: {
        kind: "native-markdown",
        parse: async () => {
          await fences.activateFence({
            id: "document-delete-after-parser-error",
            knowledgeSpaceId,
            targetId: documentAssetId,
            targetType: "document",
            tenantId: "tenant-1",
          });
          throw new Error("original parser failure");
        },
      },
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "late-error.md", {
        type: "text/markdown",
      }),
    );

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Knowledge space or source deletion is active",
    });
    await expect(assets.list({ knowledgeSpaceId, limit: 10 })).resolves.toMatchObject({
      items: [],
    });
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${knowledgeSpaceId}/documents/${documentAssetId}/`,
      }),
    ).resolves.toMatchObject({ objects: [] });
  });

  it("verifies staged upload objects before document asset visibility", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        headObject: async (key: string) =>
          key.includes("/documents/") ? null : baseAdapter.objectStorage.headObject(key),
      },
    };
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      now: () => "2026-05-09T12:00:00.000Z",
      parser: createRecordingParser().parser,
      stagedCommits,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "Verify.md", { type: "text/markdown" }));
    const response = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Document upload failed" });
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toBeNull();
    await expect(
      stagedCommits.list({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          errorCode: "object_verification_failed",
          rawObjectKey:
            "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/verify.md",
          status: "failed-retryable",
        },
      ],
    });
  });

  it("persists exact Source deletion inventory before a source upload object commit returns", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
    const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    let inventoryAtObjectCommit:
      | {
          readonly assetIds: readonly string[];
          readonly stagedDocumentAssetId: string | undefined;
          readonly stagedRawObjectKey: string | undefined;
        }
      | undefined;
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        putObject: async (input: Parameters<typeof baseAdapter.objectStorage.putObject>[0]) => {
          const stored = await baseAdapter.objectStorage.putObject(input);
          const [sourceAssets, stagedCommit] = await Promise.all([
            assets.listBySource({ knowledgeSpaceId, limit: 10, sourceId }),
            stagedCommits.get({ id: documentAssetId, knowledgeSpaceId, tenantId: "tenant-1" }),
          ]);
          inventoryAtObjectCommit = {
            assetIds: sourceAssets.items.map((asset) => asset.id),
            stagedDocumentAssetId: stagedCommit?.documentAssetId,
            stagedRawObjectKey: stagedCommit?.rawObjectKey,
          };
          return stored;
        },
      },
    };
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      generateDocumentAssetId: () => documentAssetId,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      now: () => "2026-05-09T12:00:00.000Z",
      parser: createRecordingParser().parser,
      stagedCommits,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const form = new FormData();
    form.set("sourceId", sourceId);
    form.set("file", new File([new Uint8Array([1, 2])], "Crash.md", { type: "text/markdown" }));

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(inventoryAtObjectCommit).toEqual({
      assetIds: [documentAssetId],
      stagedDocumentAssetId: documentAssetId,
      stagedRawObjectKey: `tenant-1/spaces/${knowledgeSpaceId}/documents/${documentAssetId}/crash.md`,
    });
  });

  it("maps an object-write admission rejection to a stable deletion conflict", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
    const adapter = createNodePlatformAdapter({ env: {} });
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      deletionObjectWriteAdmission: {
        withSpaceWriteAdmission: async () => {
          throw new DeletionObjectWriteAdmissionError();
        },
      },
      generateDocumentAssetId: () => documentAssetId,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      parser: createRecordingParser().parser,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "blocked.md", { type: "text/markdown" }));

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Knowledge space or source deletion is active",
    });
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${knowledgeSpaceId}/documents/${documentAssetId}/`,
      }),
    ).resolves.toMatchObject({ objects: [] });

    const knowledgeFsResponse = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/fs/write`,
      {
        body: JSON.stringify({ path: "/knowledge/docs/blocked.md", text: "blocked" }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(knowledgeFsResponse.status).toBe(409);
    await expect(knowledgeFsResponse.json()).resolves.toEqual({
      error: "Knowledge space deletion is active",
    });
  });

  it("records staged commit terminal failures when synchronous parsing fails", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 10,
      maxListLimit: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const parser = createRecordingParser({ fail: true });
    const app = createKnowledgeGateway({
      adapter: baseAdapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      now: () => "2026-05-09T12:00:00.000Z",
      parser: parser.parser,
      stagedCommits,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "Failure.md", { type: "text/markdown" }));
    const response = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );

    expect(response.status).toBe(500);
    await expect(
      stagedCommits.list({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          errorCode: "parser_failed",
          publishedObjectKey:
            "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/failure.md",
          status: "failed-terminal",
        },
      ],
    });
  });

  it("generates queryable knowledge nodes during synchronous upload when compute is configured", async () => {
    const traces = createInMemoryTraceRecorder();
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    });
    const parser = createRecordingParser();
    const compute = createRecordingCompute();
    const embeddings = createRecordingEmbeddingProvider();
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      compute: compute.compute,
      denseEmbeddingModel: "test-embedding",
      denseEmbeddingProvider: embeddings.provider,
      documentAssets: createInMemoryDocumentAssetRepository({
        maxAssets: 10,
        now: () => "2026-05-09T11:00:00.000Z",
      }),
      embeddingProvider: embeddings.provider,
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeNodes: nodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      graphIndex: graph,
      parseArtifacts,
      parser: parser.parser,
      projections,
      semanticEntityExtractionProvider: {
        extract: async () => ({
          entities: [
            {
              confidence: 0.97,
              metadata: { canonicalName: "Acme Corp" },
              text: "Acme Corp",
              type: "organization",
            },
            { confidence: 0.93, text: "Parsed upload", type: "term" },
          ],
          metadata: { provider: "llm-test" },
        }),
      },
      semanticEntityExtractionMaxNodesPerRun: 10,
      traces,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "Road Map.md", { type: "text/markdown" }),
    );
    const uploaded = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: { ...bearer(writeToken), "x-trace-id": "trace-upload-nodes" },
        method: "POST",
      },
    );

    expect(uploaded.status).toBe(201);
    await expect(uploaded.json()).resolves.toMatchObject({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      parserStatus: "parsed",
    });
    expect(compute.calls).toEqual([
      expect.objectContaining({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        parseArtifact: expect.objectContaining({
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          metadata: expect.objectContaining({
            traceId: "trace-upload-nodes",
          }),
        }),
      }),
    ]);
    await expect(
      parseArtifacts.getByDocumentVersion({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        version: 1,
      }),
    ).resolves.toMatchObject({
      artifactHash: "c".repeat(64),
      metadata: {
        traceId: "trace-upload-nodes",
      },
    });
    await expect(
      nodes.listByArtifact({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          artifactHash: "c".repeat(64),
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          text: "Parsed upload",
        }),
      ],
    });
    await expect(
      projections.listReadyBySpace({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        type: "fts",
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          metadata: expect.objectContaining({
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
            ftsText: "parsed upload",
            parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
          }),
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
          projectionVersion: 1,
          status: "ready",
          type: "fts",
        }),
      ],
    });
    await expect(
      projections.listReadyBySpace({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        type: "dense-vector",
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          metadata: expect.objectContaining({
            denseVector: expect.arrayContaining([0.1, 0.2, 0.3]),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
            embeddingProvider: "static",
            modelVersion: "test-embedding",
          }),
          projectionVersion: 1,
          status: "ready",
          type: "dense-vector",
        }),
      ],
    });
    expect(embeddings.calls).toEqual([
      {
        inputType: "search_document",
        model: "test-embedding",
        texts: ["Parsed upload"],
      },
    ]);
    await expect(
      graph.listEntities({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ traceId: "trace-upload-nodes" }),
          name: "Acme Corp",
          type: "organization",
        }),
      ]),
    });
    expect(
      traces.spans
        .filter((span) => span.attributes.traceId === "trace-upload-nodes")
        .map((span) => span.name),
    ).toEqual([
      "http.request",
      "ingestion.space_lookup",
      "ingestion.upload_read_hash",
      "ingestion.storage_quota_check",
      "ingestion.manifest_quota_check",
      "ingestion.staged_commit_received",
      "ingestion.object_put",
      "ingestion.staged_commit_object_staged",
      "ingestion.object_verify",
      "ingestion.staged_commit_object_verified",
      "ingestion.asset_create",
      "ingestion.document_path_upsert",
      "ingestion.staged_commit_metadata_prepared",
      "ingestion.parser_parse",
      "ingestion.pdf_rasterize",
      "ingestion.multimodal_assets_extract",
      "ingestion.artifact_create",
      "ingestion.outline_build",
      "ingestion.nodes_reindex",
      "ingestion.semantic_postprocess",
      "ingestion.multimodal_manifest_upsert",
      "ingestion.artifact_segments_create",
      "ingestion.projections_publish",
      "ingestion.staged_commit_artifacts_built",
      "ingestion.status_update",
      "ingestion.staged_commit_published",
    ]);
  });

  it("can migrate uploads to durable document compilation jobs without parsing on the request path", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const parser = createRecordingParser();
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-1",
      jobs: adapter.jobs,
      now: () => 1_777_777_000_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      generateDocumentId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
      maxDocuments: 10,
      maxRevisionsPerDocument: 2,
    });
    const generatedAssetIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    ];
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      deletionLifecycleFence: createDeletionLifecycleFenceGuard(fences),
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
      generateDocumentAssetId: () => {
        const id = generatedAssetIds.shift();
        if (!id) throw new Error("unexpected document asset id request");
        return id;
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      logicalDocuments,
      parseArtifacts,
      parser: parser.parser,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const bytes = new Uint8Array([5, 6, 7]);
    const form = new FormData();
    form.set("file", new File([bytes], "Async.md", { type: "text/markdown" }));
    const uploaded = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );

    expect(uploaded.status).toBe(202);
    expect(uploaded.headers.get("location")).toBe(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2d01/processing-tasks/document-compilation-job-1",
    );
    await expect(uploaded.json()).resolves.toMatchObject({
      asset: expect.objectContaining({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        parserStatus: "pending",
        sha256: await sha256Hex(bytes),
      }),
      compilationJob: {
        id: "document-compilation-job-1",
        stage: "queued",
      },
      documentRevision: 1,
      logicalDocument: {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
        revision: 1,
      },
      logicalDocumentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
      statusUrl:
        "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2d01/processing-tasks/document-compilation-job-1",
    });
    expect(parser.calls).toEqual([]);
    await expect(
      parseArtifacts.getByDocumentVersion({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        version: 1,
      }),
    ).resolves.toBeNull();
    await expect(compilationJobs.get("document-compilation-job-1")).resolves.toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      stage: "queued",
      tenantId: "tenant-1",
      version: 1,
    });
    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      idempotencyKey:
        "tenant-1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:018f0d60-7a49-7cc2-9c1b-5b36f18f2c43:1",
      payload: {
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        documentCompilationJobId: "document-compilation-job-1",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
        version: 1,
      },
      status: "queued",
      type: "document.compile",
    });

    await logicalDocuments.activateRevision({
      documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
      expectedActiveRevision: null,
      expectedRowVersion: 0,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      now: "2026-05-09T11:01:00.000Z",
      revision: 1,
      tenantId: "tenant-1",
    });
    const staleRevision = new FormData();
    staleRevision.set(
      "file",
      new File([new Uint8Array([8, 9])], "Stale.md", { type: "text/markdown" }),
    );
    staleRevision.set("documentId", "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01");
    staleRevision.set("expectedActiveRevision", "1");
    staleRevision.set("expectedDocumentRowVersion", "0");
    const staleResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      { body: staleRevision, headers: bearer(writeToken), method: "POST" },
    );
    expect(staleResponse.status).toBe(409);
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toBeNull();
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/",
      }),
    ).resolves.toMatchObject({
      objects: [
        { metadata: expect.objectContaining({ assetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43" }) },
      ],
    });
  });
  it("scrubs every bulk raw object when deletion wins over a later repository failure", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const documentAssetIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e11",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e12",
    ];
    const adapter = createNodePlatformAdapter({ env: {} });
    const deleteAttemptsByKey = new Map<string, number>();
    const faultingAdapter = {
      ...adapter,
      objectStorage: {
        ...adapter.objectStorage,
        deleteObject: async (key: string) => {
          const attempts = (deleteAttemptsByKey.get(key) ?? 0) + 1;
          deleteAttemptsByKey.set(key, attempts);
          if (attempts === 1) throw new Error("transient object delete failure");
          await adapter.objectStorage.deleteObject(key);
        },
      },
    };
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const baseBulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 10,
      maxOperations: 10,
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `late-bulk-compilation-${next++}`;
      })(),
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    const app = createKnowledgeGateway({
      adapter: faultingAdapter,
      auth: createTestAuthVerifier(),
      bulkOperations: {
        ...baseBulkOperations,
        create: async () => {
          await fences.activateFence({
            id: "space-delete-after-bulk-objects",
            knowledgeSpaceId,
            targetId: knowledgeSpaceId,
            targetType: "space",
            tenantId: "tenant-1",
          });
          throw new Error("original bulk repository failure");
        },
      },
      deletionLifecycleFence: createDeletionLifecycleFenceGuard(fences),
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
      generateBulkUploadId: () => "late-bulk-upload-1",
      generateDocumentAssetId: () => {
        const id = documentAssetIds.shift();
        if (!id) throw new Error("unexpected document id request");
        return id;
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      logicalDocuments,
      maxBulkUploadFiles: 2,
      parser: createRecordingParser().parser,
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Bulk", slug: "bulk" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1])], "one.md", { type: "text/markdown" }));
    form.append("files", new File([new Uint8Array([2])], "two.md", { type: "text/markdown" }));

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents/bulk`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Knowledge space deletion is active",
    });
    await expect(assets.list({ knowledgeSpaceId, limit: 10 })).resolves.toMatchObject({
      items: [],
    });
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${knowledgeSpaceId}/documents/`,
      }),
    ).resolves.toMatchObject({ objects: [] });
    expect([...deleteAttemptsByKey.values()].sort()).toEqual([2, 2]);
  });

  it("accepts bounded bulk document uploads as durable compilation jobs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const admittedScopes: { knowledgeSpaceId: string; tenantId: string }[] = [];
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-12T15:00:00.000Z",
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `document-compilation-job-${next++}`;
      })(),
      jobs: adapter.jobs,
      now: () => 1_777_777_000_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    const ids = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e04",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2e05",
    ];
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      deletionObjectWriteAdmission: {
        withSpaceWriteAdmission: async (scope, write) => {
          admittedScopes.push({ ...scope });
          return write();
        },
      },
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
      generateBulkUploadId: () => "bulk-upload-1",
      generateDocumentAssetId: () => {
        const id = ids.shift();
        if (!id) {
          throw new Error("unexpected document asset id request");
        }
        return id;
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      logicalDocuments,
      maxBulkUploadFiles: 2,
      maxUploadBytes: 8,
      parser: createRecordingParser().parser,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const firstBytes = new Uint8Array([1, 2, 3]);
    const secondBytes = new Uint8Array([4, 5]);
    const form = new FormData();
    form.append("files", new File([firstBytes], "First.md", { type: "text/markdown" }));
    form.append("files", new File([secondBytes], "Second.md", { type: "text/markdown" }));
    const accepted = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: form,
        headers: { ...bearer(writeToken), "x-trace-id": "trace-bulk-1" },
        method: "POST",
      },
    );

    expect(accepted.status).toBe(202);
    expect(admittedScopes).toEqual([
      {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      },
      {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      },
    ]);
    expect(accepted.headers.get("x-trace-id")).toBe("trace-bulk-1");
    await expect(accepted.json()).resolves.toMatchObject({
      accepted: 2,
      bulkJobId: "bulk-upload-1",
      excluded: 0,
      items: [
        {
          asset: expect.objectContaining({
            filename: "First.md",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
            parserStatus: "pending",
            sha256: await sha256Hex(firstBytes),
            sizeBytes: 3,
          }),
          compilationJob: {
            id: "document-compilation-job-1",
            stage: "queued",
          },
          documentRevision: 1,
          logicalDocument: { id: expect.any(String), revision: 1 },
          logicalDocumentId: expect.any(String),
          status: "accepted",
          statusUrl: expect.stringMatching(
            /^\/knowledge-spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/[0-9a-f-]+\/processing-tasks\/document-compilation-job-1$/,
          ),
        },
        {
          asset: expect.objectContaining({
            filename: "Second.md",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02",
            parserStatus: "pending",
            sha256: await sha256Hex(secondBytes),
            sizeBytes: 2,
          }),
          compilationJob: {
            id: "document-compilation-job-2",
            stage: "queued",
          },
          documentRevision: 1,
          logicalDocument: { id: expect.any(String), revision: 1 },
          logicalDocumentId: expect.any(String),
          status: "accepted",
          statusUrl: expect.stringMatching(
            /^\/knowledge-spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/[0-9a-f-]+\/processing-tasks\/document-compilation-job-2$/,
          ),
        },
      ],
      total: 2,
    });
    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      payload: {
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
        documentCompilationJobId: "document-compilation-job-1",
      },
      status: "queued",
      type: "document.compile",
    });
    await expect(adapter.jobs.status("job-2")).resolves.toMatchObject({
      payload: {
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02",
        documentCompilationJobId: "document-compilation-job-2",
      },
      status: "queued",
      type: "document.compile",
    });
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/",
      }),
    ).resolves.toMatchObject({
      objects: [
        expect.objectContaining({ key: expect.stringContaining("/first.md") }),
        expect.objectContaining({ key: expect.stringContaining("/second.md") }),
      ],
    });

    const singleFile = new FormData();
    singleFile.set("files", new File([new Uint8Array([6])], "Single.md"));
    const singleAccepted = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: singleFile,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(singleAccepted.status).toBe(202);
    await expect(singleAccepted.json()).resolves.toMatchObject({
      items: [
        {
          asset: {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03",
          },
        },
      ],
      total: 1,
    });

    const tooMany = new FormData();
    tooMany.append("files", new File([new Uint8Array([1])], "one.txt"));
    tooMany.append("files", new File([new Uint8Array([2])], "two.txt"));
    tooMany.append("files", new File([new Uint8Array([3])], "three.txt"));
    const tooManyResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: tooMany,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(tooManyResponse.status).toBe(202);
    await expect(tooManyResponse.json()).resolves.toMatchObject({
      accepted: 2,
      excluded: 1,
      items: [
        { status: "accepted" },
        { status: "accepted" },
        { index: 2, reason: "file_count_limit_exceeded", status: "excluded" },
      ],
      total: 3,
    });

    const emptyBulk = new FormData();
    const emptyBulkResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: emptyBulk,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(emptyBulkResponse.status).toBe(400);

    const invalidBulkMultipart = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: "not multipart",
        headers: { ...bearer(writeToken), "content-type": "multipart/form-data; boundary=bad" },
        method: "POST",
      },
    );
    expect(invalidBulkMultipart.status).toBe(400);

    const invalidBulkFiles = new FormData();
    invalidBulkFiles.append("files", "not-a-file");
    const invalidBulkFilesResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: invalidBulkFiles,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(invalidBulkFilesResponse.status).toBe(202);
    await expect(invalidBulkFilesResponse.json()).resolves.toMatchObject({
      accepted: 0,
      excluded: 1,
      items: [{ index: 0, reason: "invalid_file", status: "excluded" }],
    });

    const oversizedBulkFile = new FormData();
    oversizedBulkFile.append("files", new File([new Uint8Array(9)], "oversized.txt"));
    const oversizedBulkFileResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: oversizedBulkFile,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(oversizedBulkFileResponse.status).toBe(202);
    await expect(oversizedBulkFileResponse.json()).resolves.toMatchObject({
      accepted: 0,
      excluded: 1,
      items: [{ reason: "file_too_large", status: "excluded" }],
    });

    const totalBytesApp = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentCompilationJobs: createDocumentCompilationJobStateMachine({
        generateId: () => "unused-document-compilation-job",
        jobs: createNodePlatformAdapter({ env: {} }).jobs,
        now: () => 1_777_777_000_000,
        repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
      }),
      logicalDocuments: createInMemoryLogicalDocumentRepository({
        canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        maxDocuments: 10,
        maxRevisionsPerDocument: 10,
      }),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      maxBulkUploadBytes: 4,
      maxBulkUploadFiles: 2,
      maxUploadBytes: 8,
    });
    await totalBytesApp.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const tooManyBytes = new FormData();
    tooManyBytes.append("files", new File([new Uint8Array(3)], "a.txt"));
    tooManyBytes.append("files", new File([new Uint8Array(2)], "b.txt"));
    const tooManyBytesResponse = await totalBytesApp.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: tooManyBytes,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(tooManyBytesResponse.status).toBe(202);
    await expect(tooManyBytesResponse.json()).resolves.toMatchObject({
      accepted: 1,
      excluded: 1,
      items: [{ status: "accepted" }, { reason: "batch_byte_limit_exceeded", status: "excluded" }],
    });

    const quotaBulkAdapter = createNodePlatformAdapter({ env: {} });
    const quotaBulkAssets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-12T15:30:00.000Z",
    });
    await quotaBulkAssets.create({
      filename: "Existing.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e50",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey:
        "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/existing/existing.md",
      sha256: "f".repeat(64),
      sizeBytes: 2,
    });
    const quotaBulkApp = createKnowledgeGateway({
      adapter: quotaBulkAdapter,
      auth: createTestAuthVerifier(),
      documentAssets: quotaBulkAssets,
      documentCompilationJobs: createDocumentCompilationJobStateMachine({
        generateId: () => "unused-document-compilation-job",
        jobs: quotaBulkAdapter.jobs,
        now: () => 1_777_777_000_000,
        repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
      }),
      logicalDocuments: createInMemoryLogicalDocumentRepository({
        canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        maxDocuments: 10,
        maxRevisionsPerDocument: 10,
      }),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      storageQuotas: createStaticStorageQuotaRepository({ maxRawDocumentBytes: 5 }),
    });
    await quotaBulkApp.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const quotaBulkForm = new FormData();
    quotaBulkForm.append("files", new File([new Uint8Array(2)], "a.md"));
    quotaBulkForm.append("files", new File([new Uint8Array(2)], "b.md"));
    const quotaBulkResponse = await quotaBulkApp.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: quotaBulkForm,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(quotaBulkResponse.status).toBe(202);
    const quotaBulkPayload = (await quotaBulkResponse.json()) as {
      items: readonly {
        asset?: { readonly objectKey?: string };
        readonly reason?: string;
        readonly status?: string;
      }[];
    };
    expect(quotaBulkPayload).toMatchObject({
      accepted: 1,
      excluded: 1,
      items: [{ status: "accepted" }, { reason: "quota_exceeded", status: "excluded" }],
    });
    const acceptedObjectKey = quotaBulkPayload.items[0]?.asset?.objectKey;
    expect(acceptedObjectKey).toEqual(expect.any(String));
    await expect(
      quotaBulkAdapter.objectStorage.headObject(acceptedObjectKey ?? ""),
    ).resolves.toMatchObject({ key: acceptedObjectKey });

    const manifestQuotaAdapter = createNodePlatformAdapter({ env: {} });
    const manifestQuotaManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const manifestQuotaApp = createKnowledgeGateway({
      adapter: manifestQuotaAdapter,
      auth: createTestAuthVerifier(),
      generateKnowledgeSpaceManifestId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f4e90",
      knowledgeSpaceManifests: manifestQuotaManifests,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
    });
    await manifestQuotaApp.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const manifestQuotaManifest = await manifestQuotaManifests.get({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      tenantId: "tenant-1",
    });
    expect(manifestQuotaManifest).toBeTruthy();
    if (!manifestQuotaManifest) {
      throw new Error("Expected manifest quota test manifest");
    }
    await manifestQuotaManifests.update({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      patch: {
        quotaPolicy: {
          ...manifestQuotaManifest.quotaPolicy,
          maxRawDocumentBytes: 2,
        },
      },
      tenantId: "tenant-1",
    });
    const manifestQuotaObjectPrefix =
      "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/";
    const objectsBeforeManifestQuotaRejection =
      await manifestQuotaAdapter.objectStorage.listObjects({
        limit: 10,
        prefix: manifestQuotaObjectPrefix,
      });
    const manifestQuotaForm = new FormData();
    manifestQuotaForm.append("file", new File([new Uint8Array(3)], "too-large.md"));
    const manifestQuotaResponse = await manifestQuotaApp.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: manifestQuotaForm,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(manifestQuotaResponse.status).toBe(413);
    await expect(manifestQuotaResponse.json()).resolves.toEqual({
      error: "KnowledgeSpace quota exceeded: maxRawDocumentBytes",
    });
    await expect(
      manifestQuotaAdapter.objectStorage.listObjects({
        limit: 10,
        prefix: manifestQuotaObjectPrefix,
      }),
    ).resolves.toEqual(objectsBeforeManifestQuotaRejection);

    const noDurableJobsApp = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
    });
    await noDurableJobsApp.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const noDurableJobsForm = new FormData();
    noDurableJobsForm.append("files", new File([new Uint8Array([1])], "queued.txt"));
    const noDurableJobs = await noDurableJobsApp.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: noDurableJobsForm,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(noDurableJobs.status).toBe(503);

    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxBulkUploadFiles: 0,
      }),
    ).toThrow("Bulk document upload maxBulkUploadFiles must be between 1 and 25");
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxBulkUploadBytes: 0,
      }),
    ).toThrow("Bulk document upload maxBulkUploadBytes must be between 1 and 1310720000");
  });

  it("isolates a runtime failure to one bulk-upload item and continues later valid files", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const baseCompilationJobs = createDocumentCompilationJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `isolated-compilation-${next++}`;
      })(),
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    let startAttempt = 0;
    const compilationJobs = {
      ...baseCompilationJobs,
      start: async (...args: Parameters<typeof baseCompilationJobs.start>) => {
        startAttempt += 1;
        if (startAttempt === 2) throw new Error("injected second-file compilation failure");
        return baseCompilationJobs.start(...args);
      },
    };
    const assetIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f4b01",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f4b02",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f4b03",
    ];
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
      generateBulkUploadId: () => "isolated-bulk-upload",
      generateDocumentAssetId: () => {
        const id = assetIds.shift();
        if (!id) throw new Error("unexpected document asset id request");
        return id;
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      logicalDocuments: createInMemoryLogicalDocumentRepository({
        canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        maxDocuments: 10,
        maxRevisionsPerDocument: 10,
      }),
      maxBulkUploadFiles: 3,
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Isolated bulk", slug: "isolated-bulk" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1])], "one.md", { type: "text/markdown" }));
    form.append("files", new File([new Uint8Array([2])], "two.md", { type: "text/markdown" }));
    form.append("files", new File([new Uint8Array([3])], "three.md", { type: "text/markdown" }));

    const response = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      { body: form, headers: bearer(writeToken), method: "POST" },
    );

    expect(response.status, await response.clone().text()).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: 2,
      excluded: 1,
      items: [
        {
          asset: { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4b01" },
          status: "accepted",
        },
        { filename: "two.md", index: 1, reason: "processing_failed", status: "excluded" },
        {
          asset: { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4b03" },
          status: "accepted",
        },
      ],
      total: 3,
    });
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4b01",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({ parserStatus: "pending" });
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4b02",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({ parserStatus: "failed" });
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4b03",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({ parserStatus: "pending" });
    await expect(baseCompilationJobs.get("isolated-compilation-1")).resolves.toMatchObject({
      stage: "queued",
    });
    await expect(baseCompilationJobs.get("isolated-compilation-2")).resolves.toMatchObject({
      stage: "queued",
    });
  });

  it("uses explicit bulk targets for logical v2 CAS and isolates a stale target from later files", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const targetDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5d01";
    const newDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5d02";
    const adapter = createNodePlatformAdapter({ env: {} });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    let compilationSequence = 0;
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => `target-isolated-compilation-${++compilationSequence}`,
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const generatedLogicalDocumentIds = [targetDocumentId, newDocumentId];
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      generateDocumentId: () => {
        const id = generatedLogicalDocumentIds.shift();
        if (!id) throw new Error("unexpected logical document id request");
        return id;
      },
      maxDocuments: 10,
      maxRevisionsPerDocument: 2,
    });
    const initial = await logicalDocuments.createCandidateRevision({
      contentHash: "a".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5a01",
      documentAssetVersion: 1,
      knowledgeSpaceId,
      mimeType: "text/markdown",
      now: "2026-07-14T12:00:00.000Z",
      sizeBytes: 3,
      systemMetadata: {},
      tenantId: "tenant-1",
      title: "Existing.md",
    });
    await logicalDocuments.activateRevision({
      documentId: targetDocumentId,
      expectedActiveRevision: null,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now: "2026-07-14T12:01:00.000Z",
      revision: initial.revision.revision,
      tenantId: "tenant-1",
    });

    const assetIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f5b02",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f5b03",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f5b04",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f5b05",
    ];
    let bulkUploadSequence = 0;
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      deletionLifecycleFence: createDeletionLifecycleFenceGuard(fences),
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
      generateBulkUploadId: () => `target-isolated-bulk-upload-${++bulkUploadSequence}`,
      generateDocumentAssetId: () => {
        const id = assetIds.shift();
        if (!id) throw new Error("unexpected document asset id request");
        return id;
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      logicalDocuments,
      maxBulkUploadFiles: 2,
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Targeted bulk", slug: "targeted-bulk" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const duplicateTargets = new FormData();
    duplicateTargets.append(
      "files",
      new File([new Uint8Array([1])], "one.md", { type: "text/markdown" }),
    );
    duplicateTargets.append(
      "files",
      new File([new Uint8Array([2])], "two.md", { type: "text/markdown" }),
    );
    duplicateTargets.set(
      "targets",
      JSON.stringify([
        {
          documentId: targetDocumentId,
          expectedActiveRevision: 1,
          expectedDocumentRowVersion: 1,
          index: 0,
        },
        {
          documentId: targetDocumentId,
          expectedActiveRevision: 1,
          expectedDocumentRowVersion: 1,
          index: 1,
        },
      ]),
    );
    const duplicateResponse = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/bulk`,
      { body: duplicateTargets, headers: bearer(writeToken), method: "POST" },
    );
    expect(duplicateResponse.status).toBe(400);
    await expect(duplicateResponse.json()).resolves.toEqual({
      error: `Bulk document upload targets contain duplicate documentId ${targetDocumentId}`,
    });
    await expect(assets.list({ knowledgeSpaceId, limit: 10 })).resolves.toMatchObject({
      items: [],
    });

    const form = new FormData();
    form.append(
      "files",
      new File([new Uint8Array([3])], "stale-target.md", { type: "text/markdown" }),
    );
    form.append(
      "files",
      new File([new Uint8Array([4])], "new-document.md", { type: "text/markdown" }),
    );
    form.set(
      "targets",
      JSON.stringify([
        {
          documentId: targetDocumentId,
          expectedActiveRevision: 1,
          // A concurrent activation advanced rowVersion to 1 before this batch arrived.
          expectedDocumentRowVersion: 0,
          index: 0,
        },
      ]),
    );

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents/bulk`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: 1,
      excluded: 1,
      items: [
        {
          filename: "stale-target.md",
          index: 0,
          reason: "revision_conflict",
          status: "excluded",
        },
        {
          asset: { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b02" },
          documentRevision: 1,
          logicalDocument: { id: newDocumentId, revision: 1 },
          logicalDocumentId: newDocumentId,
          status: "accepted",
        },
      ],
      total: 2,
    });
    await expect(
      logicalDocuments.listRevisions({
        candidateGrants: ["document:read"],
        documentId: targetDocumentId,
        knowledgeSpaceId,
        limit: 10,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ items: [{ revision: 1, state: "active" }] });
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
        knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b02",
        knowledgeSpaceId,
      }),
    ).resolves.toMatchObject({ parserStatus: "pending" });

    const revisionForm = new FormData();
    revisionForm.set(
      "files",
      new File([new Uint8Array([5])], "explicit-revision.md", { type: "text/markdown" }),
    );
    revisionForm.set(
      "targets",
      JSON.stringify([
        {
          documentId: targetDocumentId,
          expectedActiveRevision: 1,
          expectedDocumentRowVersion: 1,
          index: 0,
        },
      ]),
    );
    const revisionResponse = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/bulk`,
      { body: revisionForm, headers: bearer(writeToken), method: "POST" },
    );
    expect(revisionResponse.status, await revisionResponse.clone().text()).toBe(202);
    await expect(revisionResponse.json()).resolves.toMatchObject({
      accepted: 1,
      excluded: 0,
      items: [
        {
          asset: { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b03" },
          documentRevision: 2,
          logicalDocument: { id: targetDocumentId, revision: 2 },
          logicalDocumentId: targetDocumentId,
          status: "accepted",
        },
      ],
    });
    await expect(
      logicalDocuments.listRevisions({
        candidateGrants: ["document:read"],
        documentId: targetDocumentId,
        knowledgeSpaceId,
        limit: 10,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [
        { revision: 2, state: "candidate" },
        { revision: 1, state: "active" },
      ],
    });

    const missingTargetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5d99";
    const missingForm = new FormData();
    missingForm.set(
      "files",
      new File([new Uint8Array([6])], "missing-target.md", { type: "text/markdown" }),
    );
    missingForm.set(
      "targets",
      JSON.stringify([
        {
          documentId: missingTargetId,
          expectedActiveRevision: 1,
          expectedDocumentRowVersion: 1,
          index: 0,
        },
      ]),
    );
    const missingResponse = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/bulk`,
      { body: missingForm, headers: bearer(writeToken), method: "POST" },
    );
    expect(missingResponse.status, await missingResponse.clone().text()).toBe(202);
    await expect(missingResponse.json()).resolves.toMatchObject({
      accepted: 0,
      excluded: 1,
      items: [{ index: 0, reason: "document_not_found", status: "excluded" }],
    });

    const invalidForm = new FormData();
    invalidForm.set(
      "files",
      new File([new Uint8Array([7])], "invalid-target.md", { type: "text/markdown" }),
    );
    invalidForm.set(
      "targets",
      JSON.stringify([
        {
          documentId: targetDocumentId,
          expectedActiveRevision: 1,
          expectedDocumentRowVersion: 1,
          index: 0,
        },
      ]),
    );
    const invalidResponse = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/bulk`,
      { body: invalidForm, headers: bearer(writeToken), method: "POST" },
    );
    expect(invalidResponse.status, await invalidResponse.clone().text()).toBe(202);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      accepted: 0,
      excluded: 1,
      items: [{ index: 0, reason: "invalid_target", status: "excluded" }],
    });
  });

  it("accepts durable bulk deletion without synchronously removing document data", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-12T16:00:00.000Z",
    });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    });
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    const acceptingDeletions = createAcceptingDurableDeletionService();
    const durableDeletions = createAcceptingDurableDeletionService({
      requestBulkDocumentDeletion: async (input) => {
        if (input.subject.tenantId !== "tenant-1") {
          throw new DurableDeletionServiceError(
            "DURABLE_DELETION_NOT_FOUND",
            "Deletion target not found",
          );
        }
        return acceptingDeletions.requestBulkDocumentDeletion(input);
      },
    });
    const app = createKnowledgeGateway({
      ...createAllowingDurableDeletionSafetyOptions(),
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      durableDeletions,
      generateBulkUploadId: () => "bulk-delete-1",
      knowledgeNodes: nodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      parseArtifacts: artifacts,
      maxBulkDeleteDocuments: 2,
      operationLeases: createKnowledgeFsOperationLeaseCoordinator({
        generateLeaseId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
        leaseTtlMs: 60_000,
        leases,
        now: () => "2026-05-09T10:00:00.000Z",
        sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      }),
      projections,
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Deletes", slug: "deletes" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const asset = await assets.create({
      filename: "Delete.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey:
        "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2f01/delete.md",
      sha256: "e".repeat(64),
      sizeBytes: 3,
    });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    await artifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "e".repeat(64),
        contentType: "text",
        createdAt: "2026-05-12T16:00:01.000Z",
        documentAssetId: asset.id,
        elements: [],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
        metadata: {},
        parser: "native-markdown",
        version: 1,
      }),
    );
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "e".repeat(64),
        documentAssetId: asset.id,
        endOffset: 6,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
        kind: "chunk",
        knowledgeSpaceId: asset.knowledgeSpaceId,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
        permissionScope: [],
        sourceLocation: { sectionPath: [] },
        startOffset: 0,
        text: "delete",
      }),
    ]);
    await projections.createMany([
      IndexProjectionSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f04",
        knowledgeSpaceId: asset.knowledgeSpaceId,
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
        projectionVersion: 1,
        status: "ready",
        type: "fts",
      }),
    ]);

    const deleted = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: JSON.stringify({
          documents: [
            { documentId: asset.id, expectedRevision: asset.version },
            {
              documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f99",
              expectedRevision: 1,
            },
          ],
        }),
        headers: {
          ...bearer(writeToken),
          "content-type": "application/json",
          "idempotency-key": "bulk-delete-documents",
        },
        method: "DELETE",
      },
    );

    expect(deleted.status).toBe(202);
    await expect(deleted.json()).resolves.toMatchObject({
      items: [
        { documentId: asset.id, job: { targetId: asset.id, targetType: "document" } },
        {
          documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f99",
          job: { targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f99" },
        },
      ],
      total: 2,
    });
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ id: asset.id });
    await expect(
      artifacts.getByDocumentVersion({ documentAssetId: asset.id, version: 1 }),
    ).resolves.toMatchObject({ documentAssetId: asset.id });
    await expect(adapter.objectStorage.getObject(asset.objectKey)).resolves.not.toBeNull();
    await expect(
      leases.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      artifacts.deleteByDocumentAsset({ documentAssetId: asset.id, maxArtifacts: 0 }),
    ).rejects.toThrow("Parse artifact delete maxArtifacts must be at least 1");
    await expect(
      nodes.deleteByDocumentAsset({
        documentAssetId: asset.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        maxNodes: 0,
      }),
    ).rejects.toThrow("Knowledge node delete maxNodes must be at least 1");
    await expect(
      projections.deleteByNodeIds({
        knowledgeSpaceId: asset.knowledgeSpaceId,
        maxProjections: 0,
        nodeIds: [],
      }),
    ).rejects.toThrow("Index projection delete maxProjections must be at least 1");

    const tooMany = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: JSON.stringify({
          documents: [
            {
              documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
              expectedRevision: 1,
            },
            {
              documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
              expectedRevision: 1,
            },
            {
              documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
              expectedRevision: 1,
            },
          ],
        }),
        headers: {
          ...bearer(writeToken),
          "content-type": "application/json",
          "idempotency-key": "too-many-documents",
        },
        method: "DELETE",
      },
    );
    expect(tooMany.status).toBe(400);

    const crossTenantDelete = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: JSON.stringify({
          documents: [{ documentId: asset.id, expectedRevision: asset.version }],
        }),
        headers: {
          ...bearer(otherTenantToken),
          "content-type": "application/json",
          "idempotency-key": "cross-tenant-delete",
        },
        method: "DELETE",
      },
    );
    expect(crossTenantDelete.status).toBe(404);

    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxBulkDeleteDocuments: 0,
      }),
    ).toThrow("Bulk document delete maxBulkDeleteDocuments must be at least 1");
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxCascadeDeleteArtifacts: 0,
      }),
    ).toThrow("Bulk document delete maxCascadeDeleteArtifacts must be at least 1");
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxCascadeDeleteNodes: 0,
      }),
    ).toThrow("Bulk document delete maxCascadeDeleteNodes must be at least 1");
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxCascadeDeleteProjections: 0,
      }),
    ).toThrow("Bulk document delete maxCascadeDeleteProjections must be at least 1");
  });

  it("accepts durable bulk deletion without running physical deletion in the request", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-12T16:10:00.000Z",
    });
    const app = createKnowledgeGateway({
      ...createAllowingDurableDeletionSafetyOptions(),
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      durableDeletions: createAcceptingDurableDeletionService(),
      generateBulkUploadId: () => "bulk-delete-lifecycle-1",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      maxBulkDeleteDocuments: 2,
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Lifecycle Deletes", slug: "lifecycle-deletes" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const asset = await assets.create({
      filename: "Lifecycle.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey:
        "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2e01/lifecycle.md",
      sha256: "f".repeat(64),
      sizeBytes: 3,
    });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });

    const deleted = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: JSON.stringify({
          documents: [
            { documentId: asset.id, expectedRevision: asset.version },
            {
              documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e99",
              expectedRevision: 1,
            },
          ],
        }),
        headers: {
          ...bearer(writeToken),
          "content-type": "application/json",
          "idempotency-key": "lifecycle-delete-docs",
          "x-trace-id": "delete-trace-1",
        },
        method: "DELETE",
      },
    );

    expect(deleted.status).toBe(202);
    await expect(adapter.objectStorage.getObject(asset.objectKey)).resolves.not.toBeNull();
  });

  it("bulk reindexes selected or all tenant-scoped documents with durable compilation jobs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-12T17:00:00.000Z",
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `document-compilation-job-${next++}`;
      })(),
      jobs: adapter.jobs,
      now: () => 1_777_777_000_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
      generateBulkUploadId: () => "bulk-reindex-1",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      maxBulkReindexDocuments: 2,
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Reindex", slug: "reindex" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const first = await assets.create({
      filename: "First.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/first.md",
      sha256: "a".repeat(64),
      sizeBytes: 1,
    });
    const second = await assets.create({
      filename: "Second.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02",
      knowledgeSpaceId: first.knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/second.md",
      sha256: "b".repeat(64),
      sizeBytes: 1,
    });

    const selected = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk/reindex",
      {
        body: JSON.stringify({ documentIds: [first.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f3a99"] }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(selected.status).toBe(202);
    await expect(selected.json()).resolves.toEqual({
      bulkJobId: "bulk-reindex-1",
      items: [
        {
          asset: expect.objectContaining({ id: first.id }),
          compilationJob: { id: "document-compilation-job-1", stage: "queued" },
          status: "queued",
          statusUrl:
            "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        },
        {
          documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a99",
          status: "not_found",
        },
      ],
      total: 2,
    });

    const all = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk/reindex",
      {
        body: JSON.stringify({ all: true }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(all.status).toBe(202);
    await expect(all.json()).resolves.toMatchObject({
      items: [
        { asset: { id: first.id }, status: "queued" },
        { asset: { id: second.id }, status: "queued" },
      ],
      total: 2,
    });

    const invalid = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk/reindex",
      {
        body: JSON.stringify({ all: true, documentIds: [first.id] }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(invalid.status).toBe(400);

    const tooManySelected = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk/reindex",
      {
        body: JSON.stringify({
          documentIds: [first.id, second.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f3a03"],
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(tooManySelected.status).toBe(400);

    await assets.create({
      filename: "Third.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a03",
      knowledgeSpaceId: first.knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/third.md",
      sha256: "c".repeat(64),
      sizeBytes: 1,
    });
    const tooManyAll = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk/reindex",
      {
        body: JSON.stringify({ all: true }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(tooManyAll.status).toBe(400);

    const noJobsSpaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-09T10:00:00.000Z",
    });
    const noJobsApp = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      knowledgeSpaces: noJobsSpaces,
    });
    await noJobsApp.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Reindex", slug: "reindex" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const noJobs = await noJobsApp.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk/reindex",
      {
        body: JSON.stringify({ documentIds: [first.id] }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(noJobs.status).toBe(503);

    expect(() =>
      createKnowledgeGateway({
        adapter,
        maxBulkReindexDocuments: 0,
      }),
    ).toThrow("Bulk document reindex maxBulkReindexDocuments must be at least 1");
  });

  it("reports tenant-scoped bulk job progress across queued and completed operations", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-12T18:00:00.000Z",
    });
    const bulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 5,
      maxOperations: 5,
      now: () => "2026-05-12T18:00:00.000Z",
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `document-compilation-job-${next++}`;
      })(),
      jobs: adapter.jobs,
      now: (() => {
        let tick = 1_777_777_000_000;
        return () => ++tick;
      })(),
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    const app = createKnowledgeGateway({
      ...createAllowingDurableDeletionSafetyOptions(),
      adapter,
      auth: createTestAuthVerifier(),
      bulkOperations,
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
      durableDeletions: createAcceptingDurableDeletionService(),
      generateBulkUploadId: (() => {
        const ids = ["bulk-upload-progress-1", "bulk-delete-progress-1"];
        return () => ids.shift() ?? "bulk-extra";
      })(),
      generateDocumentAssetId: (() => {
        let next = 1;
        return () => `018f0d60-7a49-7cc2-9c1b-5b36f18f4a0${next++}`;
      })(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      logicalDocuments,
      maxBulkDeleteDocuments: 5,
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Bulk Progress", slug: "bulk-progress" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.append("files", new File([new Uint8Array([1])], "First.md", { type: "text/markdown" }));
    form.append("files", new File([new Uint8Array([2])], "Second.md", { type: "text/markdown" }));
    const upload = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(upload.status).toBe(202);
    const uploadBody = await upload.json();
    expect(uploadBody.bulkJobId).toBe("bulk-upload-progress-1");

    const running = await app.request("/bulk-jobs/bulk-upload-progress-1", {
      headers: bearer(readToken),
    });
    expect(running.status).toBe(200);
    await expect(running.json()).resolves.toMatchObject({
      completedItems: 0,
      failedItemIds: [],
      failedItems: 0,
      id: "bulk-upload-progress-1",
      status: "running",
      totalItems: 2,
      type: "document_upload",
    });

    await compilationJobs.advance("document-compilation-job-1", "parsed");
    await compilationJobs.advance("document-compilation-job-1", "outline_built");
    await compilationJobs.advance("document-compilation-job-1", "nodes_generated");
    await compilationJobs.advance("document-compilation-job-1", "projection_built");
    await compilationJobs.fail("document-compilation-job-2", "parser failed");

    const progressed = await app.request("/bulk-jobs/bulk-upload-progress-1", {
      headers: bearer(readToken),
    });
    expect(progressed.status).toBe(200);
    await expect(progressed.json()).resolves.toMatchObject({
      completedItems: 1,
      failedItemIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a02"],
      failedItems: 1,
      status: "failed",
      totalItems: 2,
    });

    const writeOnlyProgress = await app.request("/bulk-jobs/bulk-upload-progress-1", {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnlyProgress.status).toBe(403);

    const crossTenantProgress = await app.request("/bulk-jobs/bulk-upload-progress-1", {
      headers: bearer(otherTenantToken),
    });
    expect(crossTenantProgress.status).toBe(404);

    const deleted = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/bulk",
      {
        body: JSON.stringify({
          documents: [
            {
              documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01",
              expectedRevision: 1,
            },
          ],
        }),
        headers: {
          ...bearer(writeToken),
          "content-type": "application/json",
          "idempotency-key": "bulk-progress-delete",
        },
        method: "DELETE",
      },
    );
    expect(deleted.status).toBe(202);
    await expect(deleted.json()).resolves.toMatchObject({ total: 1 });

    const deleteProgress = await app.request("/bulk-jobs/bulk-delete-progress-1", {
      headers: bearer(readToken),
    });
    expect(deleteProgress.status).toBe(404);
  });

  it("wraps every document mutation route in a lease and maps acquisition fences", async () => {
    const successfulLease = createMutationLeaseRepository();
    const middleware = captureDocumentMutationMiddleware(successfulLease.repository);
    let nextCalls = 0;
    const next = async () => {
      nextCalls += 1;
    };
    await middleware.upload(mutationContext("POST"), next);
    await middleware.reindex(mutationContext("POST"), next);
    await middleware.bulk(mutationContext("POST"), next);
    await middleware.bulk(mutationContext("DELETE"), next);
    await middleware.bulk(mutationContext("GET"), next);
    await middleware.upload(mutationContext("POST", null), next);
    expect(successfulLease.acquiredOperations).toEqual([
      "upload",
      "bulk-reindex",
      "bulk-upload",
      "bulk-delete",
    ]);
    expect(successfulLease.releasedOperations).toEqual(successfulLease.acquiredOperations);
    expect(nextCalls).toBe(6);

    const snapshotConflict = createMutationLeaseRepository(async () => {
      throw new LegacySpacePublicationBootstrapSnapshotConflictError();
    });
    const snapshotMiddleware = captureDocumentMutationMiddleware(snapshotConflict.repository);
    let snapshotNextCalls = 0;
    await snapshotMiddleware.upload(mutationContext("POST"), async () => {
      snapshotNextCalls += 1;
    });
    expect(snapshotNextCalls).toBe(1);

    for (const [error, message] of [
      [
        new KnowledgeSpaceDocumentMutationDeletionActiveError(),
        "Knowledge space deletion is active",
      ],
      [
        new LegacySpacePublicationBootstrapAdmissionError("bootstrap-1"),
        "Knowledge space publication bootstrap is active",
      ],
      [
        new KnowledgeSpaceDocumentMutationLeaseActiveError(),
        "Knowledge space publication bootstrap is active",
      ],
    ] as const) {
      const blocked = createMutationLeaseRepository(async () => {
        throw error;
      });
      const blockedMiddleware = captureDocumentMutationMiddleware(blocked.repository);
      const response = await blockedMiddleware.upload(
        mutationContext("POST"),
        async () => undefined,
      );
      expect(response?.status).toBe(409);
      if (!response) throw new Error("Expected mutation lease conflict response");
      await expect(response.json()).resolves.toEqual({ error: message });
    }

    const unexpected = createMutationLeaseRepository(async () => {
      throw new Error("unexpected lease failure");
    });
    const unexpectedMiddleware = captureDocumentMutationMiddleware(unexpected.repository);
    await expect(
      unexpectedMiddleware.upload(mutationContext("POST"), async () => undefined),
    ).rejects.toThrow("unexpected lease failure");

    const startedConflict = await middleware.upload(mutationContext("POST"), async () => {
      throw new LegacySpacePublicationBootstrapAdmissionError("bootstrap-after-start");
    });
    expect(startedConflict?.status).toBe(409);

    const missingSpaceApp = createDocumentWriteTestGateway();
    const missingUpload = await missingSpaceApp.request(
      `/knowledge-spaces/${writeSpaceId}/documents`,
      {
        body: documentForm("file", "missing.md"),
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(missingUpload.status).toBe(404);
    const missingBulk = await missingSpaceApp.request(
      `/knowledge-spaces/${writeSpaceId}/documents/bulk`,
      {
        body: documentForm("files", "missing-bulk.md"),
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(missingBulk.status).toBe(404);
    const missingReindex = await missingSpaceApp.request(
      `/knowledge-spaces/${writeSpaceId}/documents/bulk/reindex`,
      {
        body: JSON.stringify({ all: true }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(missingReindex.status).toBe(404);
  });

  it("fails fast across direct write handlers before durable mutation starts", async () => {
    const missing = captureDocumentWriteRouteHandlers({
      spaces: createDirectWriteSpaceRepository(null),
    });
    await expect(missing.reindex(writeRouteContext({ all: true }))).resolves.toMatchObject({
      status: 404,
    });
    await expect(missing.bulk(writeRouteContext())).resolves.toMatchObject({ status: 404 });
    await expect(missing.upload(writeRouteContext())).resolves.toMatchObject({ status: 404 });

    const denied = captureDocumentWriteRouteHandlers({
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(
      denied.reindex(writeRouteContext({ all: true }, { authorizationDecision: undefined })),
    ).resolves.toMatchObject({ status: 403 });

    const admission = captureDocumentWriteRouteHandlers({
      documentMutationAdmissionGuard: createDirectDocumentMutationAdmissionGuard({
        assertDocumentMutationAdmission: async () => {
          throw new LegacySpacePublicationBootstrapAdmissionError("bootstrap-handler");
        },
      }),
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(admission.reindex(writeRouteContext({ all: true }))).resolves.toMatchObject({
      status: 409,
    });
    await expect(admission.bulk(writeRouteContext())).resolves.toMatchObject({ status: 409 });
    await expect(admission.upload(writeRouteContext())).resolves.toMatchObject({ status: 409 });

    const noJobs = captureDocumentWriteRouteHandlers({
      documentMutationAdmissionGuard: createDirectDocumentMutationAdmissionGuard({
        assertDocumentMutationAdmission: async () => undefined,
      }),
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(noJobs.reindex(writeRouteContext({ all: true }))).resolves.toMatchObject({
      status: 503,
    });
    await expect(noJobs.bulk(writeRouteContext())).resolves.toMatchObject({ status: 503 });

    const scanBudget = captureDocumentWriteRouteHandlers({
      assets: createDirectDocumentAssetRepository({
        list: async () => {
          throw new CandidateVisibilityScanBudgetExceededError();
        },
      }),
      documentCompilationJobs: createDirectDocumentCompilationJobs(),
      maxBulkReindexDocuments: 10,
      spaces: createDirectWriteSpaceRepository(),
    });
    const scanResponse = await scanBudget.reindex(writeRouteContext({ all: true }));
    expect(scanResponse.status).toBe(503);

    const genericAdmission = captureDocumentWriteRouteHandlers({
      documentMutationAdmissionGuard: createDirectDocumentMutationAdmissionGuard({
        assertDocumentMutationAdmission: async () => {
          throw new Error("unexpected admission failure");
        },
      }),
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(genericAdmission.reindex(writeRouteContext({ all: true }))).rejects.toThrow(
      "unexpected admission failure",
    );
    await expect(genericAdmission.bulk(writeRouteContext())).rejects.toThrow(
      "unexpected admission failure",
    );
    await expect(genericAdmission.upload(writeRouteContext())).rejects.toThrow(
      "unexpected admission failure",
    );

    const genericScan = captureDocumentWriteRouteHandlers({
      assets: createDirectDocumentAssetRepository({
        list: async () => {
          throw new Error("unexpected scan failure");
        },
      }),
      documentCompilationJobs: createDirectDocumentCompilationJobs(),
      maxBulkReindexDocuments: 10,
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(genericScan.reindex(writeRouteContext({ all: true }))).rejects.toThrow(
      "unexpected scan failure",
    );

    const quotaRejected = captureDocumentWriteRouteHandlers({
      bulkOperationRepository: createDirectBulkOperationRepository(),
      documentCompilationJobs: createDirectDocumentCompilationJobs(),
      generateBulkUploadId: () => "quota-rejected",
      generateKnowledgeSpaceManifestId: () => "unused-manifest",
      knowledgeSpaceManifests: createDirectKnowledgeSpaceManifestRepository({
        get: async () => {
          throw new KnowledgeSpaceQuotaExceededError("maxRawDocumentBytes");
        },
      }),
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(
      quotaRejected.reindex(writeRouteContext({ documentIds: [] })),
    ).resolves.toMatchObject({ status: 413 });

    const quotaFailure = captureDocumentWriteRouteHandlers({
      bulkOperationRepository: createDirectBulkOperationRepository(),
      documentCompilationJobs: createDirectDocumentCompilationJobs(),
      generateKnowledgeSpaceManifestId: () => "unused-manifest",
      knowledgeSpaceManifests: createDirectKnowledgeSpaceManifestRepository({
        get: async () => {
          throw new Error("unexpected manifest quota failure");
        },
      }),
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(quotaFailure.reindex(writeRouteContext({ documentIds: [] }))).rejects.toThrow(
      "unexpected manifest quota failure",
    );
  });

  it("persists capability provenance for a direct bulk reindex", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createDirectDocumentAssetRepository();
    const asset = await assets.create({
      filename: "Capability.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
      knowledgeSpaceId: writeSpaceId,
      metadata: { permissionScope: [] },
      mimeType: "text/markdown",
      objectKey: `tenant-1/spaces/${writeSpaceId}/documents/capability/capability.md`,
      sha256: "a".repeat(64),
      sizeBytes: 1,
    });
    const bulkOperations = createDirectBulkOperationRepository();
    const created: Parameters<typeof bulkOperations.create>[0][] = [];
    const jobs = createDirectDocumentCompilationJobs(adapter);
    const started: Parameters<typeof jobs.start>[0][] = [];
    const manifest = {
      ...createDefaultKnowledgeSpaceManifest({
        createdAt: "2026-07-21T12:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b02",
        knowledgeSpaceId: writeSpaceId,
        tenantId: writeSubject.tenantId,
        updatedAt: "2026-07-21T12:00:00.000Z",
      }),
      projectionSetVersion: "projection-v7",
    };
    const handlers = captureDocumentWriteRouteHandlers({
      adapter,
      assets,
      bulkOperationRepository: {
        ...bulkOperations,
        create: async (input) => {
          created.push(input);
          return bulkOperations.create(input);
        },
      },
      documentCompilationJobs: {
        ...jobs,
        start: async (input) => {
          started.push(input);
          return jobs.start(input);
        },
      },
      generateBulkUploadId: () => "capability-reindex",
      generateKnowledgeSpaceManifestId: () => "unused-manifest",
      knowledgeSpaceManifests: createDirectKnowledgeSpaceManifestRepository({
        get: async () => manifest,
      }),
      spaces: createDirectWriteSpaceRepository(),
    });
    const grant = {
      contentScopeIds: ["document:read"],
      grantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b04",
      namespaceId: writeSubject.tenantId,
      resource: { id: writeSpaceId, parent_id: null, type: "knowledge_space" },
      subject: writeSubject.subjectId,
    };
    const response = await handlers.reindex(
      writeRouteContext(
        { documentIds: [asset.id] },
        { authorizationDecision: undefined, capabilityV2Grant: grant },
      ),
    );
    expect(response.status).toBe(202);
    expect(started).toEqual([
      expect.objectContaining({ capabilityGrantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b04" }),
    ]);
    expect(created).toEqual([
      expect.objectContaining({ capabilityGrantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b04" }),
    ]);
  });

  it("maps direct durable permission denial and legacy projection versions", async () => {
    const manifest = {
      ...createDefaultKnowledgeSpaceManifest({
        createdAt: "2026-07-21T12:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b03",
        knowledgeSpaceId: writeSpaceId,
        tenantId: writeSubject.tenantId,
        updatedAt: "2026-07-21T12:00:00.000Z",
      }),
      projectionSetVersion: "legacy-projection",
    };
    const handlers = captureDocumentWriteRouteHandlers({
      authorization: {
        authorize: async () => {
          throw new KnowledgeSpaceAuthorizationError(
            "KNOWLEDGE_SPACE_ACCESS_DENIED",
            "denied by direct fixture",
          );
        },
      },
      bulkOperationRepository: createDirectBulkOperationRepository(),
      documentCompilationJobs: createDirectDocumentCompilationJobs(),
      generateKnowledgeSpaceManifestId: () => "unused-manifest",
      knowledgeSpaceManifests: createDirectKnowledgeSpaceManifestRepository({
        get: async () => manifest,
      }),
      spaces: createDirectWriteSpaceRepository(),
    });

    await expect(handlers.reindex(writeRouteContext({ documentIds: [] }))).resolves.toMatchObject({
      status: 403,
    });

    const unexpected = captureDocumentWriteRouteHandlers({
      authorization: {
        authorize: async () => {
          throw new Error("unexpected authorization failure");
        },
      },
      bulkOperationRepository: createDirectBulkOperationRepository(),
      documentCompilationJobs: createDirectDocumentCompilationJobs(),
      generateKnowledgeSpaceManifestId: () => "unused-manifest",
      knowledgeSpaceManifests: createDirectKnowledgeSpaceManifestRepository({
        get: async () => manifest,
      }),
      spaces: createDirectWriteSpaceRepository(),
    });
    await expect(unexpected.reindex(writeRouteContext({ documentIds: [] }))).rejects.toThrow(
      "unexpected authorization failure",
    );
  });

  it.each(["size", "checksum"] as const)(
    "rejects a staged object with mismatched %s metadata",
    async (mismatch) => {
      const baseAdapter = createNodePlatformAdapter({ env: {} });
      const adapter = {
        ...baseAdapter,
        objectStorage: {
          ...baseAdapter.objectStorage,
          headObject: async (key: string) => {
            const metadata = await baseAdapter.objectStorage.headObject(key);
            if (!metadata) return null;
            return mismatch === "size"
              ? { ...metadata, sizeBytes: metadata.sizeBytes + 1 }
              : { ...metadata, metadata: { ...metadata.metadata, sha256: "invalid" } };
          },
        },
      };
      const app = await createInitializedDocumentWriteTestGateway({ adapter });
      const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents`, {
        body: documentForm("file", `${mismatch}.md`),
        headers: bearer(writeToken),
        method: "POST",
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "Document upload failed" });
    },
  );

  it("rolls back a source-owned reservation after staged object verification fails", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        headObject: async (key: string) => {
          const metadata = await baseAdapter.objectStorage.headObject(key);
          return metadata ? { ...metadata, sizeBytes: metadata.sizeBytes + 1 } : null;
        },
      },
    };
    const app = await createInitializedDocumentWriteTestGateway({ adapter });
    const form = documentForm("file", "source-owned.md");
    form.set("sourceId", "018f0d60-7a49-7cc2-9c1b-5b36f18f6c01");
    const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Document upload failed" });
    await expect(
      baseAdapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${writeSpaceId}/documents/`,
      }),
    ).resolves.toEqual({ objects: [] });
  });

  it("records a stable fallback message for a non-Error metadata failure", async () => {
    const baseAssets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const documentAssets: typeof baseAssets = {
      ...baseAssets,
      create: async () => {
        throw "non-error asset failure";
      },
    };
    const app = await createInitializedDocumentWriteTestGateway({ documentAssets });
    const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents`, {
      body: documentForm("file", "non-error.md"),
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Document upload failed" });
  });

  it("applies manifest raw-byte quota when admitting a bulk upload", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const knowledgeSpaceManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const app = await createInitializedDocumentWriteTestGateway({
      adapter,
      documentCompilationJobs: createDocumentCompilationJobStateMachine({
        generateId: () => "manifest-quota-bulk-compilation",
        jobs: adapter.jobs,
        repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
      }),
      knowledgeSpaceManifests,
      logicalDocuments: createInMemoryLogicalDocumentRepository({
        canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        maxDocuments: 10,
        maxRevisionsPerDocument: 10,
      }),
    });
    const manifest = await knowledgeSpaceManifests.get({
      knowledgeSpaceId: writeSpaceId,
      tenantId: writeSubject.tenantId,
    });
    if (!manifest) throw new Error("Expected initialized quota manifest");
    await knowledgeSpaceManifests.update({
      knowledgeSpaceId: writeSpaceId,
      patch: {
        projectionSetVersion: "projection-v7",
        quotaPolicy: { ...manifest.quotaPolicy, maxRawDocumentBytes: 10 },
      },
      tenantId: writeSubject.tenantId,
    });

    const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents/bulk`, {
      body: documentForm("files", "within-manifest-quota.md"),
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ accepted: 1, excluded: 0 });
  });

  it("maps bulk storage policy failures before reading multipart data", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const app = await createInitializedDocumentWriteTestGateway({
      adapter,
      documentCompilationJobs: createDocumentCompilationJobStateMachine({
        generateId: () => "unused-storage-quota-compilation",
        jobs: adapter.jobs,
        repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
      }),
      logicalDocuments: createInMemoryLogicalDocumentRepository({
        canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        maxDocuments: 10,
        maxRevisionsPerDocument: 10,
      }),
      storageQuotas: {
        get: async () => {
          throw new StorageQuotaExceededError();
        },
      },
    });
    const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents/bulk`, {
      body: documentForm("files", "storage-quota.md"),
      headers: bearer(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Storage quota exceeded" });
  });

  it("maps document capacity and logical candidate failures to stable upload responses", async () => {
    const capacityAssets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    await capacityAssets.create({
      filename: "Existing.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a01",
      knowledgeSpaceId: writeSpaceId,
      mimeType: "text/markdown",
      objectKey: `tenant-1/spaces/${writeSpaceId}/documents/existing/existing.md`,
      sha256: "a".repeat(64),
      sizeBytes: 1,
    });
    const capacityApp = await createInitializedDocumentWriteTestGateway({
      documentAssets: capacityAssets,
    });
    const capacity = await capacityApp.request(`/knowledge-spaces/${writeSpaceId}/documents`, {
      body: documentForm("file", "capacity.md"),
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(capacity.status).toBe(429);

    for (const [error, status] of [
      [new LogicalDocumentConflictError(1, 2, 3, 4), 409],
      [new LogicalDocumentNotFoundError("target missing"), 404],
      [new LogicalDocumentValidationError("target invalid"), 400],
    ] as const) {
      const adapter = createNodePlatformAdapter({ env: {} });
      const baseLogicalDocuments = createInMemoryLogicalDocumentRepository({
        canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
        maxDocuments: 10,
        maxRevisionsPerDocument: 10,
      });
      const logicalDocuments = {
        ...baseLogicalDocuments,
        createCandidateRevision: async () => {
          throw error;
        },
      };
      const app = await createInitializedDocumentWriteTestGateway({
        adapter,
        documentCompilationJobs: createDocumentCompilationJobStateMachine({
          generateId: () => "logical-error-compilation",
          jobs: adapter.jobs,
          repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
        }),
        logicalDocuments,
      });
      const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents`, {
        body: documentForm("file", "logical.md"),
        headers: bearer(writeToken),
        method: "POST",
      });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: error.message });
    }
  });

  it.each([
    ["job-without-logical", 500],
    ["job-start-failure", 500],
    ["deferred-release", 202],
    ["binding-failure", 500],
    ["scoped-asset-missing", 400],
    ["parsed-asset-missing", 500],
  ] as const)("handles durable upload edge %s", async (scenario, expectedStatus) => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const baseAssets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    let createdAssetId: string | undefined;
    const assets = {
      ...baseAssets,
      create: async (...args: Parameters<typeof baseAssets.create>) => {
        const asset = await baseAssets.create(...args);
        createdAssetId = asset.id;
        return asset;
      },
      get: async (...args: Parameters<typeof baseAssets.get>) => {
        if (scenario === "scoped-asset-missing" && createdAssetId) return null;
        return baseAssets.get(...args);
      },
      updateParserStatus: async (...args: Parameters<typeof baseAssets.updateParserStatus>) =>
        scenario === "parsed-asset-missing" ? null : baseAssets.updateParserStatus(...args),
    };
    const baseLogicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    const logicalDocuments = {
      ...baseLogicalDocuments,
      bindCompilationAttempt: async (
        ...args: Parameters<typeof baseLogicalDocuments.bindCompilationAttempt>
      ) => {
        if (scenario === "binding-failure") throw new Error("injected binding failure");
        return baseLogicalDocuments.bindCompilationAttempt(...args);
      },
    };
    const baseJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "durable-edge-compilation",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    let released = false;
    const jobs = {
      ...baseJobs,
      ...(scenario === "deferred-release"
        ? {
            releaseDispatch: async (id: string) => {
              released = true;
              const job = await baseJobs.get(id);
              if (!job) throw new Error("Expected deferred compilation job");
              return job;
            },
          }
        : {}),
      start: async (...args: Parameters<typeof baseJobs.start>) => {
        if (scenario === "job-start-failure") throw new Error("injected job start failure");
        return baseJobs.start(...args);
      },
    };
    const app = await createInitializedDocumentWriteTestGateway({
      adapter,
      documentAssets: assets,
      ...(scenario === "parsed-asset-missing" ? {} : { documentCompilationJobs: jobs }),
      ...(scenario === "job-without-logical" || scenario === "parsed-asset-missing"
        ? {}
        : { logicalDocuments }),
    });
    const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents`, {
      body: documentForm("file", `${scenario}.md`),
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(expectedStatus);
    if (scenario === "deferred-release") expect(released).toBe(true);
  });

  it("conceals a targeted bulk runtime failure as processing_failed", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const baseLogicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    const logicalDocuments = {
      ...baseLogicalDocuments,
      createCandidateRevision: async () => {
        throw new Error("injected targeted failure");
      },
    };
    const app = await createInitializedDocumentWriteTestGateway({
      adapter,
      documentCompilationJobs: createDocumentCompilationJobStateMachine({
        generateId: () => "targeted-error-compilation",
        jobs: adapter.jobs,
        repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
      }),
      logicalDocuments,
    });
    const form = documentForm("files", "targeted.md");
    form.set(
      "targets",
      JSON.stringify([
        {
          documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d01",
          expectedActiveRevision: 1,
          expectedDocumentRowVersion: 1,
          index: 0,
        },
      ]),
    );
    const response = await app.request(`/knowledge-spaces/${writeSpaceId}/documents/bulk`, {
      body: form,
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: 0,
      excluded: 1,
      items: [{ reason: "processing_failed", status: "excluded" }],
    });
  });
});

const writeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const directWriteSpace = KnowledgeSpaceSchema.parse({
  createdAt: "2026-07-21T12:00:00.000Z",
  id: writeSpaceId,
  name: "Direct write handler space",
  revision: 1,
  slug: "direct-write-handler-space",
  tenantId: writeSubject.tenantId,
  updatedAt: "2026-07-21T12:00:00.000Z",
});

function createDirectWriteSpaceRepository(
  space: typeof directWriteSpace | null = directWriteSpace,
) {
  return {
    ...createInMemoryKnowledgeSpaceRepository({
      generateId: () => writeSpaceId,
      maxListLimit: 10,
      maxSpaces: 10,
    }),
    get: async () => space,
  };
}

type DirectDocumentMutationAdmissionGuard = NonNullable<
  RegisterDocumentWriteHandlersOptions["documentMutationAdmissionGuard"]
>;

function createDirectDocumentMutationAdmissionGuard(
  overrides: Partial<DirectDocumentMutationAdmissionGuard> = {},
): DirectDocumentMutationAdmissionGuard {
  const lease = {
    acquiredAt: "2026-07-21T12:00:00.000Z",
    expiresAt: "2026-07-21T12:05:00.000Z",
    heartbeatAt: "2026-07-21T12:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
    knowledgeSpaceId: writeSpaceId,
    leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02",
    operation: "upload" as const,
    tenantId: writeSubject.tenantId,
  };
  return {
    acquireDocumentMutationLease: async (input) => ({ ...lease, ...input }),
    assertDocumentMutationAdmission: async () => undefined,
    heartbeatDocumentMutationLease: async (currentLease, heartbeatAt) => ({
      ...currentLease,
      heartbeatAt,
    }),
    releaseDocumentMutationLease: async () => undefined,
    ...overrides,
  };
}

function createDirectDocumentAssetRepository(
  overrides: Partial<RegisterDocumentWriteHandlersOptions["assets"]> = {},
): RegisterDocumentWriteHandlersOptions["assets"] {
  return {
    ...createInMemoryDocumentAssetRepository({ maxAssets: 10 }),
    ...overrides,
  };
}

function createDirectKnowledgeSpaceManifestRepository(
  overrides: Partial<RegisterDocumentWriteHandlersOptions["knowledgeSpaceManifests"]> = {},
): RegisterDocumentWriteHandlersOptions["knowledgeSpaceManifests"] {
  return {
    ...createInMemoryKnowledgeSpaceManifestRepository({ maxListLimit: 10, maxManifests: 10 }),
    ...overrides,
  };
}

function createDirectBulkOperationRepository(
  overrides: Partial<RegisterDocumentWriteHandlersOptions["bulkOperationRepository"]> = {},
): RegisterDocumentWriteHandlersOptions["bulkOperationRepository"] {
  return {
    ...createInMemoryBulkOperationRepository({ maxItems: 10, maxOperations: 10 }),
    ...overrides,
  };
}

function createDirectDocumentCompilationJobs(
  adapter = createNodePlatformAdapter({ env: {} }),
  overrides: Partial<
    NonNullable<RegisterDocumentWriteHandlersOptions["documentCompilationJobs"]>
  > = {},
): NonNullable<RegisterDocumentWriteHandlersOptions["documentCompilationJobs"]> {
  return {
    ...createDocumentCompilationJobStateMachine({
      generateId: () => "direct-write-compilation-job",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    }),
    ...overrides,
  };
}

type TestGatewayOptions = Parameters<typeof createKnowledgeGateway>[0];

function createDocumentWriteTestGateway(overrides: Partial<TestGatewayOptions> = {}) {
  return createKnowledgeGateway({
    ...overrides,
    adapter: overrides.adapter ?? createNodePlatformAdapter({ env: {} }),
    auth: overrides.auth ?? createTestAuthVerifier(),
    knowledgeSpaces:
      overrides.knowledgeSpaces ??
      createInMemoryKnowledgeSpaceRepository({
        generateId: () => writeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
  });
}

async function createInitializedDocumentWriteTestGateway(
  overrides: Partial<TestGatewayOptions> = {},
) {
  const app = createDocumentWriteTestGateway(overrides);
  const created = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: "Defensive uploads", slug: "defensive-uploads" }),
    headers: { ...bearer(writeToken), "content-type": "application/json" },
    method: "POST",
  });
  if (created.status !== 201) {
    throw new Error(`Expected test knowledge space creation, received ${created.status}`);
  }
  return app;
}

function documentForm(field: "file" | "files", filename: string): FormData {
  const form = new FormData();
  form.set(field, new File([new Uint8Array([1, 2])], filename, { type: "text/markdown" }));
  return form;
}

function createMutationLeaseRepository(
  acquire: DirectDocumentMutationAdmissionGuard["acquireDocumentMutationLease"] = async (
    input,
  ) => ({
    ...input,
    expiresAt: "2026-07-21T12:05:00.000Z",
    heartbeatAt: input.acquiredAt,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
    leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02",
  }),
) {
  const acquiredOperations: string[] = [];
  const releasedOperations: string[] = [];
  const repository = createDirectDocumentMutationAdmissionGuard({
    acquireDocumentMutationLease: async (
      input: Parameters<DirectDocumentMutationAdmissionGuard["acquireDocumentMutationLease"]>[0],
    ) => {
      acquiredOperations.push(input.operation);
      return acquire(input);
    },
    releaseDocumentMutationLease: async (
      lease: Parameters<DirectDocumentMutationAdmissionGuard["releaseDocumentMutationLease"]>[0],
    ) => {
      releasedOperations.push(lease.operation);
    },
  });
  return { acquiredOperations, releasedOperations, repository };
}

type CapturedMutationMiddleware = (
  context: unknown,
  next: () => Promise<void>,
) => Promise<Response | undefined>;

function captureDocumentMutationMiddleware(repository: DirectDocumentMutationAdmissionGuard) {
  const app = createKnowledgeGatewayApp();
  registerDocumentWriteHandlers({
    app,
    documentMutationAdmissionGuard: repository,
    now: () => "2026-07-21T12:00:00.000Z",
  } as RegisterDocumentWriteHandlersOptions);
  const middlewareForPath = (path: string): CapturedMutationMiddleware | undefined => {
    const route = app.routes.find(
      (candidate) => candidate.method === "ALL" && candidate.path === path,
    );
    if (!route) return undefined;
    return async (context, next) =>
      route.handler(context as Parameters<typeof route.handler>[0], next);
  };
  const upload = middlewareForPath("/knowledge-spaces/:id/documents");
  const reindex = middlewareForPath("/knowledge-spaces/:id/documents/bulk/reindex");
  const bulk = middlewareForPath("/knowledge-spaces/:id/documents/bulk");
  if (!upload || !reindex || !bulk) {
    throw new Error("Expected all document mutation middleware registrations");
  }
  return { bulk, reindex, upload };
}

function mutationContext(method: string, knowledgeSpaceId: string | null = writeSpaceId) {
  return {
    get: (key: string) => (key === "subject" ? writeSubject : undefined),
    json: (body: unknown, status: number) => Response.json(body, { status }),
    req: {
      method,
      param: () => knowledgeSpaceId ?? undefined,
    },
  };
}

type CapturedWriteRouteHandler = (context: unknown) => Promise<Response>;

function captureDocumentWriteRouteHandlers(
  overrides: Partial<RegisterDocumentWriteHandlersOptions>,
) {
  const app = createKnowledgeGatewayApp();
  registerDocumentWriteHandlers({
    ...overrides,
    adapter: overrides.adapter ?? createNodePlatformAdapter({ env: {} }),
    app,
    maxBulkReindexDocuments: overrides.maxBulkReindexDocuments ?? 10,
    now: overrides.now ?? (() => "2026-07-21T12:00:00.000Z"),
    traces: overrides.traces ?? createInMemoryTraceRecorder(),
  } as RegisterDocumentWriteHandlersOptions);
  const handlerForPath = (path: string): CapturedWriteRouteHandler | undefined => {
    const matchingRoutes = app.routes.filter(
      (candidate) => candidate.method === "POST" && candidate.path === path,
    );
    const route = matchingRoutes[matchingRoutes.length - 1];
    if (!route) return undefined;
    return async (context) => {
      const response = await route.handler(
        context as Parameters<typeof route.handler>[0],
        async () => undefined,
      );
      return response instanceof Response ? response : Response.json(null, { status: 204 });
    };
  };
  const reindex = handlerForPath("/knowledge-spaces/:id/documents/bulk/reindex");
  const bulk = handlerForPath("/knowledge-spaces/:id/documents/bulk");
  const upload = handlerForPath("/knowledge-spaces/:id/documents");
  if (!reindex || !bulk || !upload) {
    throw new Error("Expected all document write route registrations");
  }
  return { bulk, reindex, upload };
}

function writeRouteContext(
  json: unknown = {},
  values: {
    readonly authorizationDecision?: unknown;
    readonly capabilityV2Grant?: unknown;
  } = {
    authorizationDecision: {
      permissionSnapshot: {
        candidateGrants: ["document:read"],
        knowledgeSpaceId: writeSpaceId,
        subjectId: writeSubject.subjectId,
        tenantId: writeSubject.tenantId,
      },
    },
  },
) {
  const stored = new Map<string, unknown>([
    ["authorizationDecision", values.authorizationDecision],
    ["capabilityV2Grant", values.capabilityV2Grant],
    ["subject", writeSubject],
    ["traceId", "direct-write-handler-trace"],
  ]);
  return {
    get: (key: string) => stored.get(key),
    header: () => undefined,
    json: (body: unknown, status: number) => Response.json(body, { status }),
    req: {
      valid: (target: string) => (target === "param" ? { id: writeSpaceId } : json),
    },
  };
}
