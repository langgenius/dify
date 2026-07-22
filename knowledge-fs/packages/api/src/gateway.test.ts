import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { type ComputeRuntime, createTypeScriptComputeRuntime } from "@knowledge/compute";
import {
  AnswerTraceSchema,
  type CacheAdapter,
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type EmbeddingModel,
  EmbeddingModelSchema,
  EvidenceBundleSchema,
  type IndexProjection,
  IndexProjectionSchema,
  type KnowledgeNode,
  KnowledgeNodeSchema,
  type KnowledgePath,
  KnowledgePathSchema,
  type ParseArtifact,
  ParseArtifactSchema,
  ResourceMountSchema,
} from "@knowledge/core";
import type {
  EmbedTextsInput,
  EmbedTextsResult,
  EmbeddingProvider,
  RerankDocumentsInput,
  RerankerProvider,
} from "@knowledge/embeddings";
import type { ParserAdapter } from "@knowledge/parsers";
import { describe, expect, it } from "vitest";

import {
  createAcceptingDurableDeletionService,
  createAllowingDurableDeletionSafetyOptions,
  createNotFoundDurableDeletionService,
} from "./durable-deletion-test-utils";
import { createFakeKnowledgeSpaceExecutor } from "./gateway-knowledge-space-test-executor";
import {
  createGoldenEvidenceFixtures,
  testGoldenQuestionPermission,
  testGoldenQuestionPermissionRow,
} from "./golden-question-test-fixtures";
import {
  type AdvancedRetrievalMetricJudge,
  type BasicHybridRetriever,
  type HybridRetrievalItem,
  type HybridRetrievalRepository,
  InMemoryRateLimitCapacityExceededError,
  type QueryGenerationEvent,
  type RetrievalCandidate,
  type RetrieveHybridInput,
  createAbRetrievalStrategyComparisonRunner,
  createAdvancedRetrievalEvaluationRunner,
  createAgentWorkspaceReplayService,
  createAnswerTraceRecorder,
  createAnswerabilityEvaluator,
  createBasicHybridRetriever,
  createCacheSessionContextRepository,
  createDatabaseAnswerTraceRepository,
  createDatabaseDocumentAssetRepository,
  createDatabaseDurableDeletionRepository,
  createDatabaseEmbeddingModelRegistry,
  createDatabaseGoldenQuestionRepository,
  createDatabaseHybridRetrievalRepository,
  createDatabaseIndexProjectionRepository,
  createDatabaseKnowledgeNodeRepository,
  createDatabaseKnowledgePathRepository,
  createDatabaseKnowledgeSpaceRepository,
  createDatabaseParseArtifactRepository,
  createDenseVectorProjectionBuilder,
  createDocumentCompilationJobStateMachine,
  createDocumentCompilationWorker,
  createEmbeddingModelUpgradeWorkflow,
  createEvidenceBundleAssembler,
  createEvidenceBundleCache,
  createFtsProjectionBuilder,
  createInMemoryAgentWorkspaceSnapshotRepository,
  createInMemoryAnswerTraceRepository,
  createInMemoryBulkOperationRepository,
  createInMemoryDocumentAssetRepository,
  createInMemoryDocumentCompilationJobRepository,
  createInMemoryDocumentMultimodalManifestRepository,
  createInMemoryEmbeddingModelRegistry,
  createInMemoryFailedQueryRepository,
  createInMemoryGoldenQuestionRepository,
  createInMemoryIndexProjectionRepository,
  createInMemoryKnowledgeNodeRepository,
  createInMemoryKnowledgePathRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryParseArtifactRepository,
  createInMemoryRateLimiter,
  createInMemoryResearchTaskJobRepository,
  createInMemoryResearchTaskPartialResultRepository,
  createInMemoryResearchTaskProgressRepository,
  createInMemoryRetentionPolicyRepository,
  createInMemoryTraceRecorder,
  createIncrementalReindexer,
  createIngestionSmokeEvaluationGate,
  createKnowledgeGateway,
  createKnowledgeSpaceRetentionCleanupWorker,
  createParseArtifactRetentionCleanupWorker,
  createQueryNormalizationCache,
  createResearchTaskDryRunPlanner,
  createResearchTaskJobStateMachine,
  createResearchTaskProgressPublisher,
  createRetrievalEvaluationRunner,
  createRetrievalImpactEvaluationRunner,
  createRetrievalPlanner,
  createRetrievalStrategyComparisonRunner,
  createStaticAuthVerifier,
  createStaticStorageQuotaRepository,
  normalizeMixedLanguageFtsText,
} from "./index";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import {
  createInitializedTestDocumentAssets,
  rollbackInitializedTestDocumentAsset,
} from "./test-candidate-content";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

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

function createGatewayTestSpaceAccess(knowledgeSpaceId: string) {
  return createInitializedTestKnowledgeSpaceAccess([{ knowledgeSpaceId }]);
}

function ownerCandidateScopes(knowledgeSpaceId: string): string[] {
  return [
    `tenant:${readSubject.tenantId}`,
    `knowledge-space:${knowledgeSpaceId}`,
    `knowledge-space:${knowledgeSpaceId}:member:${readSubject.subjectId}`,
    `knowledge-space:${knowledgeSpaceId}:role:owner`,
    `knowledge-space:${knowledgeSpaceId}:visibility:only_me:${readSubject.subjectId}`,
  ].sort();
}

function gatewayEvidenceBundle(id: string, text: string) {
  return EvidenceBundleSchema.parse({
    createdAt: "2026-05-12T15:00:00.000Z",
    id,
    items: [
      {
        citations: [
          {
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
            documentVersion: 1,
            startOffset: 0,
          },
        ],
        conflicts: [],
        freshness: { status: "fresh" },
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c01",
        score: 0.9,
        scores: { final: 0.9, retrieval: 0.9 },
        text,
      },
    ],
    missingEvidence: [],
    query: "research partials",
    state: "partial",
  });
}

function workspaceSnapshotRequestBody() {
  return {
    commandLog: [
      {
        command: "ls /knowledge/docs --limit 2",
        completedAt: "2026-05-12T16:19:02.000Z",
        cost: { estimatedRows: 2 },
        input: { path: "/knowledge/docs" },
        outputSummary: "2 docs",
        startedAt: "2026-05-12T16:19:01.000Z",
      },
    ],
    evidenceBundles: [gatewayEvidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a11", "snapshot")],
    indexProjection: {
      fingerprint: "projection-v1",
      projectionIds: ["projection-1"],
    },
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: { reason: "agent-resume" },
    mounts: [
      ResourceMountSchema.parse({
        cachePolicy: { strategy: "none" },
        capabilities: ["ls", "cat"],
        createdAt: "2026-05-12T16:18:00.000Z",
        freshnessPolicy: { strategy: "manual" },
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d11",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        metadata: {},
        mode: "read",
        mountPath: "/sources/uploads",
        permissionScope: ["tenant:tenant-1"],
        permissionSnapshotVersion: 1,
        provider: "object-storage",
        resourceType: "source",
        sourcePointer: "s3://knowledge-fs/tenant-1/uploads",
        tenantId: "tenant-1",
      }),
    ],
    researchTaskJobId: "research-task-job-1",
    sourceVersions: [
      {
        provider: "object-storage",
        providerResourceKey: "tenant-1/uploads/a.md",
        version: "sha256:abc",
      },
    ],
    traceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6e11"],
  };
}

interface DocumentAssetRow {
  created_at: string;
  filename: string;
  id: string;
  knowledge_space_id: string;
  metadata: Record<string, unknown>;
  mime_type: string;
  object_key: string;
  parser_status: string;
  sha256: string;
  size_bytes: number;
  source_id?: null | string;
  version: number;
}

interface ParseArtifactRow {
  artifact_hash: string;
  content_type: string;
  created_at: string;
  document_asset_id: string;
  elements: unknown;
  id: string;
  metadata: unknown;
  parser: string;
  version: number;
}

interface KnowledgeNodeRow {
  artifact_hash: string;
  document_asset_id: string;
  end_offset: number;
  id: string;
  kind: string;
  knowledge_space_id: string;
  metadata: unknown;
  parse_artifact_id: string;
  permission_scope: unknown;
  source_location: unknown;
  start_offset: number;
  text: string;
}

interface IndexProjectionRow {
  dense_vector: string | null;
  fts_document: string | null;
  visual_vector?: string | null;
  id: string;
  knowledge_space_id: string;
  metadata: unknown;
  model: string | null;
  node_id: string;
  projection_version: number;
  status: string;
  type: string;
}

interface EmbeddingModelRow {
  created_at: string;
  dimension: number;
  id: string;
  max_tokens: number;
  metadata: unknown;
  metric: string;
  model_id: string;
  provider: string;
  status: string;
  tokenizer: string;
  updated_at: string;
  version: string;
}

interface KnowledgePathRow extends Record<string, unknown> {
  id: string;
  knowledge_space_id: string;
  metadata: unknown;
  resource_type: string;
  target_id: string;
  version: null | number;
  view_name: string;
  view_type: string;
  virtual_path: string;
}

interface GoldenQuestionRow {
  created_at: string;
  expected_evidence_ids: unknown;
  id: string;
  knowledge_space_id: string;
  metadata: unknown;
  question: string;
  tags: unknown;
  updated_at: string;
}

function testKnowledgeSpaceUpdatePermission(knowledgeSpaceId: string) {
  return {
    fence: {
      accessChannel: "interactive" as const,
      knowledgeSpaceId,
      permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3afd",
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "editor-1",
      tenantId: "tenant-1",
    },
    now: "2026-05-09T10:00:00.000Z",
    requiredAccess: "write" as const,
  };
}

function createFakeGoldenQuestionExecutor(
  initialRows: readonly GoldenQuestionRow[] = [],
  options: { readonly returnRowsForWrites?: boolean } = {},
) {
  const returnRowsForWrites = options.returnRowsForWrites ?? true;
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [
          {
            deletion_job_id: null,
            id: String(input.params.at(-1)),
            lifecycle_state: "active",
            tenant_id: "tenant-1",
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "deletion_jobs") {
      return { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return {
        rows: [testGoldenQuestionPermissionRow(String(input.params[1]))],
        rowsAffected: 1,
      };
    }
    if (
      input.tableName === "knowledge_space_members" ||
      input.tableName === "knowledge_space_access_policies" ||
      input.tableName === "knowledge_space_api_access"
    ) {
      return { rows: [{ id: input.tableName }], rowsAffected: 1 };
    }

    if (input.operation === "insert") {
      const [
        id,
        tenantId,
        knowledgeSpaceId,
        question,
        expectedEvidenceIds,
        tags,
        metadata,
        requiredPermissionScope,
        createdAt,
        updatedAt,
      ] = input.params;
      const row = {
        created_at: String(createdAt),
        expected_evidence_ids: JSON.parse(String(expectedEvidenceIds)),
        id: String(id),
        knowledge_space_id: String(knowledgeSpaceId),
        metadata: JSON.parse(String(metadata)),
        question: String(question),
        required_permission_scope: JSON.parse(String(requiredPermissionScope)),
        tags: JSON.parse(String(tags)),
        tenant_id: String(tenantId),
        updated_at: String(updatedAt),
      };
      rows.set(row.id, row);

      return { rows: returnRowsForWrites ? [{ ...row }] : [], rowsAffected: 1 };
    }

    if (input.operation === "update") {
      const [
        question,
        expectedEvidenceIds,
        tags,
        metadata,
        requiredPermissionScope,
        updatedAt,
        ,
        knowledgeSpaceId,
        id,
      ] = input.params;
      const row = rows.get(String(id));

      if (!row || row.knowledge_space_id !== knowledgeSpaceId) {
        return { rows: [], rowsAffected: 0 };
      }

      const updated = {
        ...row,
        expected_evidence_ids: JSON.parse(String(expectedEvidenceIds)),
        metadata: JSON.parse(String(metadata)),
        question: String(question),
        required_permission_scope: JSON.parse(String(requiredPermissionScope)),
        tags: JSON.parse(String(tags)),
        updated_at: String(updatedAt),
      };
      rows.set(updated.id, updated);

      return { rows: returnRowsForWrites ? [{ ...updated }] : [], rowsAffected: 1 };
    }

    if (input.operation === "delete") {
      const [, knowledgeSpaceId, id] = input.params;
      const row = rows.get(String(id));

      if (!row || row.knowledge_space_id !== knowledgeSpaceId) {
        return { rows: [], rowsAffected: 0 };
      }

      rows.delete(row.id);

      return { rows: [], rowsAffected: 1 };
    }

    if (input.sql.includes("ORDER BY")) {
      const scoped = input.sql.includes("required_permission_scope");
      const knowledgeSpaceId = input.params[scoped ? 1 : 0];
      const cursorOffset = scoped ? 3 : 1;
      const hasCursor = input.params.length === cursorOffset + 3;
      const cursorCreatedAt = input.params[cursorOffset];
      const cursorId = input.params[cursorOffset + 1];
      const limit = Number(input.params.at(-1));
      const selected = [...rows.values()]
        .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
        .filter((row) =>
          hasCursor
            ? row.created_at > String(cursorCreatedAt) ||
              (row.created_at === cursorCreatedAt && row.id > String(cursorId))
            : true,
        )
        .sort(
          (first, second) =>
            first.created_at.localeCompare(second.created_at) || first.id.localeCompare(second.id),
        )
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    if (input.sql.includes('"id" =') || input.sql.includes("`id` =")) {
      const scoped = input.sql.includes("required_permission_scope");
      const knowledgeSpaceId = input.params[scoped ? 1 : 0];
      const id = input.params[scoped ? 2 : 1];
      const row = rows.get(String(id));
      const selected = row && row.knowledge_space_id === knowledgeSpaceId ? [{ ...row }] : [];

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor, rows };
}

function createFakeDocumentAssetExecutor(options: { readonly failInsert?: boolean } = {}) {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, DocumentAssetRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      if (options.failInsert) {
        throw new Error("document insert failed");
      }

      const [
        id,
        knowledgeSpaceId,
        sourceId,
        filename,
        mimeType,
        objectKey,
        sha256,
        sizeBytes,
        metadata,
        parserStatus,
        version,
        createdAt,
      ] = input.params;
      const row = {
        created_at: String(createdAt),
        filename: String(filename),
        id: String(id),
        knowledge_space_id: String(knowledgeSpaceId),
        metadata:
          typeof metadata === "string" ? (JSON.parse(metadata) as Record<string, unknown>) : {},
        mime_type: String(mimeType),
        object_key: String(objectKey),
        parser_status: String(parserStatus),
        sha256: String(sha256),
        size_bytes: Number(sizeBytes),
        source_id: sourceId === null ? null : String(sourceId),
        version: Number(version),
      };

      rows.set(row.id, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "update") {
      const [parserStatus, id, knowledgeSpaceId] = input.params;
      const row = rows.get(String(id));

      if (!row || row.knowledge_space_id !== knowledgeSpaceId) {
        return { rows: [], rowsAffected: 0 };
      }

      const updated = {
        ...row,
        parser_status: String(parserStatus),
      };
      rows.set(updated.id, updated);

      return { rows: [{ ...updated }], rowsAffected: 1 };
    }

    if (input.operation === "select") {
      if (input.sql.includes("COUNT(*)")) {
        const [knowledgeSpaceId] = input.params;
        const selected = Array.from(rows.values()).filter(
          (row) => row.knowledge_space_id === knowledgeSpaceId,
        );

        return {
          rows: [
            {
              document_count: selected.length,
              raw_document_bytes: selected.reduce((sum, row) => sum + row.size_bytes, 0),
            },
          ],
          rowsAffected: 1,
        };
      }

      if (input.sql.includes("ORDER BY")) {
        const [knowledgeSpaceId, cursorOrLimit, maybeLimit] = input.params;
        const cursor = maybeLimit === undefined ? undefined : String(cursorOrLimit);
        const limit = Number(maybeLimit ?? cursorOrLimit);
        const selected = Array.from(rows.values())
          .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
          .filter((row) => (cursor ? row.id > cursor : true))
          .sort((first, second) => first.id.localeCompare(second.id))
          .slice(0, limit)
          .map((row) => ({ ...row }));

        return { rows: selected, rowsAffected: selected.length };
      }

      const [id, knowledgeSpaceId] = input.params;
      const row = rows.get(String(id));
      const selected = row && row.knowledge_space_id === knowledgeSpaceId ? [{ ...row }] : [];

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor, rows };
}

function createFakeParseArtifactExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, ParseArtifactRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      const [
        id,
        documentAssetId,
        version,
        parser,
        contentType,
        artifactHash,
        elements,
        metadata,
        createdAt,
      ] = input.params;
      const row = {
        artifact_hash: String(artifactHash),
        content_type: String(contentType),
        created_at: String(createdAt),
        document_asset_id: String(documentAssetId),
        elements: typeof elements === "string" ? JSON.parse(elements) : elements,
        id: String(id),
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        parser: String(parser),
        version: Number(version),
      };

      rows.set(`${row.document_asset_id}:${row.version}`, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "select") {
      const [documentAssetId, version] = input.params;
      const row = rows.get(`${String(documentAssetId)}:${Number(version)}`);
      const selected = row ? [{ ...row }] : [];

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor, rows };
}

function createFakeKnowledgeNodeExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, KnowledgeNodeRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      const columnsPerNode = 14;

      for (let index = 0; index < input.params.length; index += columnsPerNode) {
        const [
          id,
          knowledgeSpaceId,
          publicationGenerationId,
          documentAssetId,
          parseArtifactId,
          kind,
          text,
          startOffset,
          endOffset,
          sourceLocation,
          permissionScope,
          artifactHash,
          metadata,
          updatedAt,
        ] = input.params.slice(index, index + columnsPerNode);
        const row = {
          artifact_hash: String(artifactHash),
          document_asset_id: String(documentAssetId),
          end_offset: Number(endOffset),
          id: String(id),
          kind: String(kind),
          knowledge_space_id: String(knowledgeSpaceId),
          metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
          parse_artifact_id: String(parseArtifactId),
          permission_scope:
            typeof permissionScope === "string" ? JSON.parse(permissionScope) : permissionScope,
          publication_generation_id:
            publicationGenerationId === null ? null : String(publicationGenerationId),
          source_location:
            typeof sourceLocation === "string" ? JSON.parse(sourceLocation) : sourceLocation,
          start_offset: Number(startOffset),
          text: String(text),
          updated_at: updatedAt === null ? null : String(updatedAt),
        };

        rows.set(row.id, row);
      }

      return {
        rows: Array.from(rows.values()).map((row) => ({ ...row })),
        rowsAffected: rows.size,
      };
    }

    if (input.operation === "select") {
      if (!input.sql.includes("ORDER BY")) {
        const [knowledgeSpaceId, id] = input.params;
        const row = rows.get(String(id));
        const selected = row && row.knowledge_space_id === knowledgeSpaceId ? [{ ...row }] : [];

        return { rows: selected, rowsAffected: selected.length };
      }

      const [knowledgeSpaceId, parseArtifactId, maybeStartOffset, maybeId, maybeLimit] =
        input.params;
      const limit = Number(maybeLimit ?? maybeStartOffset);
      const cursorStartOffset = maybeLimit === undefined ? undefined : Number(maybeStartOffset);
      const cursorId = maybeLimit === undefined ? undefined : String(maybeId);
      const selected = Array.from(rows.values())
        .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
        .filter((row) => row.parse_artifact_id === parseArtifactId)
        .filter(
          (row) =>
            cursorStartOffset === undefined ||
            row.start_offset > cursorStartOffset ||
            (row.start_offset === cursorStartOffset && row.id > String(cursorId)),
        )
        .sort(
          (left, right) =>
            left.start_offset - right.start_offset || left.id.localeCompare(right.id),
        )
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor, rows };
}

function createFakeIndexProjectionExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, IndexProjectionRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      if (input.tableName === "index_projection_fts_postings") {
        return { rows: [], rowsAffected: input.params.length / 8 };
      }
      const columnsPerProjection = 12;
      for (let index = 0; index < input.params.length; index += columnsPerProjection) {
        const [
          id,
          knowledgeSpaceId,
          ,
          nodeId,
          type,
          status,
          model,
          projectionVersion,
          denseVector,
          visualVector,
          ftsDocument,
          metadata,
        ] = input.params.slice(index, index + columnsPerProjection);
        const row: IndexProjectionRow = {
          dense_vector: denseVector === null ? null : String(denseVector),
          fts_document: ftsDocument === null ? null : String(ftsDocument),
          visual_vector: visualVector === null ? null : String(visualVector),
          id: String(id),
          knowledge_space_id: String(knowledgeSpaceId),
          metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
          model: model === null ? null : String(model),
          node_id: String(nodeId),
          projection_version: Number(projectionVersion),
          status: String(status),
          type: String(type),
        };
        rows.set(row.id, row);
      }
      return {
        rows: Array.from(rows.values()).map((row) => ({ ...row })),
        rowsAffected: rows.size,
      };
    }
    if (input.operation === "select" && input.sql.includes("COUNT(*)")) {
      const [knowledgeSpaceId, type, projectionVersion] = input.params;
      const counts = new Map<string, number>();
      for (const row of rows.values()) {
        if (
          row.knowledge_space_id === knowledgeSpaceId &&
          row.type === type &&
          row.projection_version === Number(projectionVersion)
        ) {
          counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
        }
      }
      return {
        rows: Array.from(counts, ([status, count]) => ({ count, status })),
        rowsAffected: counts.size,
      };
    }
    if (input.operation === "select") {
      const [knowledgeSpaceId, type, status, maybeNodeId, maybeId, maybeLimit] = input.params;
      const limit = Number(maybeLimit ?? maybeNodeId);
      const cursorNodeId = maybeLimit === undefined ? undefined : String(maybeNodeId);
      const cursorId = maybeLimit === undefined ? undefined : String(maybeId);
      const selected = Array.from(rows.values())
        .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
        .filter((row) => row.type === type)
        .filter((row) => row.status === status)
        .filter(
          (row) =>
            cursorNodeId === undefined ||
            row.node_id > cursorNodeId ||
            (row.node_id === cursorNodeId && row.id > String(cursorId)),
        )
        .sort(
          (left, right) =>
            left.node_id.localeCompare(right.node_id) || left.id.localeCompare(right.id),
        )
        .slice(0, limit)
        .map((row) => ({ ...row }));
      return { rows: selected, rowsAffected: selected.length };
    }
    if (input.operation === "update") {
      const [nextStatus, knowledgeSpaceId, type, maybeVersionOrStatus, maybeStatusOrVersion] =
        input.params;
      let rowsAffected = 0;

      for (const row of rows.values()) {
        if (row.knowledge_space_id !== knowledgeSpaceId || row.type !== type) {
          continue;
        }

        if (input.sql.includes("projection_version") && input.sql.includes("<>")) {
          if (
            row.status === String(maybeVersionOrStatus) &&
            row.projection_version !== Number(maybeStatusOrVersion)
          ) {
            row.status = String(nextStatus);
            rowsAffected += 1;
          }
          continue;
        }

        if (
          row.projection_version === Number(maybeVersionOrStatus) &&
          row.status === String(maybeStatusOrVersion)
        ) {
          row.status = String(nextStatus);
          rowsAffected += 1;
        }
      }

      return { rows: [], rowsAffected };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor, rows };
}

function createFakeEmbeddingModelExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, EmbeddingModelRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      const [
        id,
        provider,
        modelId,
        version,
        dimension,
        metric,
        tokenizer,
        maxTokens,
        status,
        metadata,
        createdAt,
        updatedAt,
      ] = input.params;
      const row: EmbeddingModelRow = {
        created_at: String(createdAt),
        dimension: Number(dimension),
        id: String(id),
        max_tokens: Number(maxTokens),
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        metric: String(metric),
        model_id: String(modelId),
        provider: String(provider),
        status: String(status),
        tokenizer: String(tokenizer),
        updated_at: String(updatedAt),
        version: String(version),
      };

      rows.set(`${row.model_id}:${row.version}`, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "select" && input.params.length === 2) {
      const [modelId, version] = input.params;
      const row = rows.get(`${String(modelId)}:${String(version)}`);
      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.operation === "select") {
      const [status] = input.params;
      const hasProviderFilter = input.sql.includes('"provider" =');
      const provider = hasProviderFilter ? input.params[1] : undefined;
      const cursorOffset = hasProviderFilter ? 2 : 1;
      const hasCursor = input.params.length - cursorOffset === 3;
      const limit = Number(input.params.at(-1));
      const cursor = hasCursor
        ? {
            id: String(input.params[cursorOffset + 1]),
            modelId: String(input.params[cursorOffset]),
          }
        : undefined;
      const selected = Array.from(rows.values())
        .filter((row) => row.status === status)
        .filter((row) => provider === undefined || row.provider === provider)
        .filter(
          (row) =>
            cursor === undefined ||
            row.model_id > cursor.modelId ||
            (row.model_id === cursor.modelId && row.id > cursor.id),
        )
        .sort(
          (left, right) =>
            left.model_id.localeCompare(right.model_id) || left.id.localeCompare(right.id),
        )
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor, rows };
}

function createFakeRetrievalExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.sql.includes("dense_vector")) {
      return {
        rows: [
          {
            artifact_hash: "d".repeat(64),
            document_created_at: "2026-05-01T00:00:00.000Z",
            document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
            document_metadata: {},
            document_type: "text/markdown",
            document_version: 1,
            end_offset: 32,
            metadata: { denseVector: [0.1, 0.2] },
            node_kind: "chunk",
            node_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
            node_metadata: {},
            permission_scope: [],
            projection_id: "dense-1",
            score: 0.9,
            source_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
            source_location: {
              endOffset: 32,
              pageNumber: 1,
              sectionPath: ["Contracts"],
              startOffset: 0,
            },
            start_offset: 0,
          },
          {
            artifact_hash: "e".repeat(64),
            document_created_at: "2026-05-01T00:00:00.000Z",
            document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            document_metadata: {},
            document_type: "text/markdown",
            document_version: 1,
            end_offset: 84,
            metadata: { denseVector: [0.3, 0.4] },
            node_kind: "chunk",
            node_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
            node_metadata: {},
            permission_scope: ["tenant:tenant-1"],
            projection_id: "dense-2",
            score: 0.8,
            source_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
            source_location: {
              endOffset: 84,
              pageNumber: 2,
              sectionPath: ["Contracts", "Renewal"],
              startOffset: 40,
            },
            start_offset: 40,
          },
        ].slice(0, input.maxRows),
        rowsAffected: Math.min(2, input.maxRows),
      };
    }

    if (input.sql.includes("fts_document")) {
      return {
        rows: [
          {
            artifact_hash: "e".repeat(64),
            document_created_at: "2026-05-01T00:00:00.000Z",
            document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            document_metadata: {},
            document_type: "text/markdown",
            document_version: 1,
            end_offset: 84,
            metadata: { ftsText: "Contract ABC-123" },
            node_kind: "chunk",
            node_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
            node_metadata: {},
            permission_scope: ["tenant:tenant-1"],
            projection_id: "fts-1",
            score: 0.7,
            source_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
            source_location: {
              endOffset: 84,
              pageNumber: 2,
              sectionPath: ["Contracts", "Renewal"],
              startOffset: 40,
            },
            start_offset: 40,
          },
          {
            artifact_hash: "f".repeat(64),
            document_created_at: "2026-05-01T00:00:00.000Z",
            document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
            document_metadata: {},
            document_type: "text/markdown",
            document_version: 1,
            end_offset: 112,
            metadata: { ftsText: "Policy renewal" },
            node_kind: "chunk",
            node_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
            node_metadata: {},
            permission_scope: ["tenant:tenant-2"],
            projection_id: "fts-2",
            score: 0.6,
            source_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
            source_location: {
              endOffset: 112,
              sectionPath: ["Policy"],
              startOffset: 90,
            },
            start_offset: 90,
          },
        ].slice(0, input.maxRows),
        rowsAffected: Math.min(2, input.maxRows),
      };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor };
}

function createFakeAnswerTraceExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "select" && input.tableName === "knowledge_spaces") {
      return {
        rows: [{ id: input.params[0], tenant_id: "tenant-1" }],
        rowsAffected: 1,
      };
    }
    return {
      rows: [],
      rowsAffected: input.operation === "insert" ? Math.max(1, input.maxRows) : 0,
    };
  };

  return { calls, executor };
}

function createRecordingCache(): CacheAdapter & {
  readonly getCalls: string[];
  readonly setCalls: {
    readonly key: string;
    readonly options?: { readonly ttlMs?: number };
    readonly value: Uint8Array;
  }[];
  readonly values: Map<string, Uint8Array>;
} {
  const values = new Map<string, Uint8Array>();
  const getCalls: string[] = [];
  const setCalls: {
    key: string;
    options?: { readonly ttlMs?: number };
    value: Uint8Array;
  }[] = [];

  return {
    getCalls,
    kind: "memory",
    setCalls,
    values,
    delete: async (key) => {
      values.delete(key);
    },
    get: async (key) => {
      getCalls.push(key);
      const value = values.get(key);
      return value ? new Uint8Array(value) : null;
    },
    health: async () => true,
    set: async (key, value, options) => {
      setCalls.push({
        key,
        ...(options === undefined ? {} : { options }),
        value: new Uint8Array(value),
      });
      values.set(key, new Uint8Array(value));
    },
    stats: async () => ({
      entries: values.size,
      totalBytes: [...values.values()].reduce((total, value) => total + value.byteLength, 0),
    }),
  };
}

function createFakeKnowledgePathExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, KnowledgePathRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      const [
        id,
        knowledgeSpaceId,
        ,
        virtualPath,
        resourceType,
        targetId,
        version,
        viewType,
        viewName,
        metadata,
      ] = input.params;
      const row: KnowledgePathRow = {
        id: String(id),
        knowledge_space_id: String(knowledgeSpaceId),
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        resource_type: String(resourceType),
        target_id: String(targetId),
        version: version === null ? null : Number(version),
        view_name: String(viewName),
        view_type: String(viewType),
        virtual_path: String(virtualPath),
      };
      rows.set(row.id, row);

      return { rows: [row], rowsAffected: 1 };
    }

    if (input.operation === "select" && input.params.length === 2) {
      const [knowledgeSpaceId, virtualPath] = input.params;
      const row = Array.from(rows.values()).find(
        (item) => item.knowledge_space_id === knowledgeSpaceId && item.virtual_path === virtualPath,
      );

      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.operation === "select") {
      const [knowledgeSpaceId, viewType, viewName] = input.params;
      const isPrefixQuery =
        input.params.length === 5 || input.params.length === 7
          ? String(input.params[3]).endsWith("%")
          : false;
      const prefix = isPrefixQuery ? String(input.params[3]).slice(0, -1) : undefined;
      const cursorPath =
        input.params.length === 7
          ? String(input.params[4])
          : !isPrefixQuery && input.params.length === 6
            ? String(input.params[3])
            : undefined;
      const cursorId =
        input.params.length === 7
          ? String(input.params[5])
          : !isPrefixQuery && input.params.length === 6
            ? String(input.params[4])
            : undefined;
      const limit = Number(input.params.at(-1));
      const selected = Array.from(rows.values())
        .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
        .filter((row) => row.view_type === viewType)
        .filter((row) => row.view_name === viewName)
        .filter((row) => prefix === undefined || row.virtual_path.startsWith(prefix))
        .filter(
          (row) =>
            cursorPath === undefined ||
            row.virtual_path > cursorPath ||
            (row.virtual_path === cursorPath && row.id > String(cursorId)),
        )
        .sort(
          (left, right) =>
            left.virtual_path.localeCompare(right.virtual_path) || left.id.localeCompare(right.id),
        )
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor };
}

function createRecordingParser(options: { readonly fail?: boolean } = {}) {
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
        contentType: "text",
        createdAt: "2026-05-09T11:00:01.000Z",
        documentAssetId: input.documentAssetId,
        elements: [
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

function retrievalEvaluationReport(
  metrics: {
    readonly citationHitRate?: number;
    readonly noAnswerRate?: number;
    readonly recallAtK?: number;
    readonly totalQuestions?: number;
  } = {},
) {
  return {
    items: [],
    metrics: {
      citationHitRate: metrics.citationHitRate ?? 1,
      noAnswerRate: metrics.noAnswerRate ?? 0,
      recallAtK: metrics.recallAtK ?? 1,
      totalQuestions: metrics.totalQuestions ?? 1,
    },
  };
}

function createRecordingEmbeddingProvider(options: { readonly mismatch?: boolean } = {}) {
  const calls: EmbedTextsInput[] = [];
  const provider: EmbeddingProvider = {
    kind: "static",
    embed: async (input): Promise<EmbedTextsResult> => {
      calls.push({
        ...input,
        texts: [...input.texts],
      });

      return {
        dense: options.mismatch
          ? [[0.1, 0.2]]
          : input.texts.map((text, index) => [index + 0.1, text.length]),
        metadata: {
          model: input.model,
          provider: "static",
        },
        model: input.model,
      };
    },
    models: async () => [
      {
        dimension: 2,
        distanceMetric: "cosine",
        id: "static-dense",
        maxInputTokens: 8191,
        provider: "static",
        recommendedBatchSize: 128,
        supportsDense: true,
        supportsMultiVector: false,
        supportsSparse: false,
        tokenizerVersion: "static",
        version: "static@1",
      },
    ],
  };

  return { calls, provider };
}

class RecordingUpgradeQueue {
  readonly enqueued: unknown[] = [];

  async enqueue(input: unknown) {
    this.enqueued.push(input);

    return {
      attempts: 0,
      createdAt: 1_000,
      id: `upgrade-queue-${this.enqueued.length}`,
      payload: null,
      status: "queued" as const,
      type: "embedding-model.upgrade",
    };
  }
}

function knowledgeNode({
  id,
  pageNumber,
  sectionPath = ["Intro"],
  startOffset,
  text,
}: {
  readonly id: string;
  readonly pageNumber?: number;
  readonly sectionPath?: readonly string[];
  readonly startOffset: number;
  readonly text: string;
}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "d".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    endOffset: startOffset + text.length,
    id,
    kind: "chunk",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: { chunkIndex: startOffset === 0 ? 1 : 2 },
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    permissionScope: ["tenant:tenant-1"],
    sourceLocation: {
      endOffset: startOffset + text.length,
      ...(pageNumber ? { pageNumber } : {}),
      sectionPath: [...sectionPath],
      startOffset,
    },
    startOffset,
    text,
  });
}

async function sha256Hex(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("createKnowledgeGateway", () => {
  it("exposes component health", async () => {
    const healthCalls: string[] = [];
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      componentHealth: {
        embedding: {
          health: async () => {
            healthCalls.push("embedding");
            return false;
          },
        },
        llm: {
          health: async () => {
            healthCalls.push("llm");
            return true;
          },
        },
        parser: {
          health: async () => {
            healthCalls.push("parser");
            return true;
          },
        },
        reranker: {
          models: async () => {
            healthCalls.push("reranker");
            return [];
          },
        },
      },
    });
    const response = await app.request("/health");

    expect(response.headers.get("x-trace-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    await expect(response.json()).resolves.toMatchObject({
      components: {
        cache: true,
        compute: true,
        database: true,
        embedding: false,
        jobs: true,
        llm: true,
        objectStorage: true,
        parser: true,
        reranker: true,
      },
      ok: true,
      runtime: "node-docker",
    });
    expect(healthCalls.sort()).toEqual(["embedding", "llm", "parser", "reranker"]);
  });

  it("reports an injected failing compute runtime as unhealthy", async () => {
    const compute = createTypeScriptComputeRuntime();
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      compute: {
        ...compute,
        rrfFuse: () => {
          throw new Error("compute probe failed");
        },
      },
    });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      components: { compute: false },
      ok: true,
      runtime: "node-docker",
    });
  });

  it("exposes an OpenAPI document", async () => {
    const app = createKnowledgeGateway({ adapter: createNodePlatformAdapter({ env: {} }) });
    const response = await app.request("/openapi.json");

    expect(response.headers.get("x-trace-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    await expect(response.json()).resolves.toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "Knowledge Platform API",
      },
      paths: {
        "/bulk-jobs/{id}": {},
        "/health": {},
        "/jobs/{id}": {},
        "/knowledge-spaces": {},
        "/knowledge-spaces/{id}": {},
        "/knowledge-spaces/{id}/documents": {},
        "/knowledge-spaces/{id}/documents/bulk": {},
        "/knowledge-spaces/{id}/documents/bulk/reindex": {},
        "/knowledge-spaces/{id}/documents/{documentId}": {},
        "/knowledge-spaces/{id}/documents/{documentId}/parse-artifacts/{version}": {},
        "/knowledge-spaces/{id}/fs/cat": {},
        "/knowledge-spaces/{id}/fs/diff": {},
        "/knowledge-spaces/{id}/fs/find": {},
        "/knowledge-spaces/{id}/fs/grep": {},
        "/knowledge-spaces/{id}/fs/ls": {},
        "/knowledge-spaces/{id}/fs/open_node": {},
        "/knowledge-spaces/{id}/fs/stat": {},
        "/knowledge-spaces/{id}/fs/tree": {},
        "/knowledge-spaces/{id}/golden-questions": {},
        "/knowledge-spaces/{id}/golden-questions/{questionId}/annotations": {},
        "/knowledge-spaces/{id}/golden-questions/{questionId}": {},
        "/knowledge-spaces/{id}/production-bad-cases": {},
        "/knowledge-spaces/{id}/retention-policy": {},
        "/queries": {},
        "/queries/{traceId}": {},
        "/ready": {},
        "/retention-policy": {},
      },
    });
  });

  it("streams generated query answers as tenant-scoped SSE", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9a01",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-11T14:10:00.000Z",
    });
    const space = await spaces.create({
      name: "Tenant docs",
      slug: "tenant-docs",
      tenantId: "tenant-1",
    });
    const calls: unknown[] = [];
    const queryGenerator = {
      stream: async function* (input: unknown): AsyncGenerator<QueryGenerationEvent> {
        calls.push(input);
        yield { delta: "First chunk", type: "delta" };
        yield { delta: " second chunk", type: "delta" };
        yield {
          finishReason: "stop",
          metadata: {
            model: "fast-model",
            templateId: "knowledge-answer-fast",
            templateVersion: "prompt-v1",
          },
          type: "done",
        };
      },
    };
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
      queryGenerator,
    });

    const response = await app.request("/queries", {
      body: JSON.stringify({
        knowledgeSpaceId: space.id,
        mode: "fast",
        query: "What does the evidence say?",
      }),
      headers: {
        ...bearer(readToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    const correlationTraceId = response.headers.get("x-trace-id");
    const queryRunId = response.headers.get("x-query-run-id");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(correlationTraceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(queryRunId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(queryRunId).not.toBe(correlationTraceId);
    expect(calls).toEqual([
      expect.objectContaining({
        knowledgeSpaceId: space.id,
        mode: "fast",
        permissionScope: ownerCandidateScopes(space.id),
        query: "What does the evidence say?",
        subject: readSubject,
        traceId: queryRunId,
      }),
    ]);
    await expect(response.text()).resolves.toBe(
      [
        `event: answer.delta\ndata: {"delta":"First chunk","traceId":"${queryRunId}"}`,
        `event: answer.delta\ndata: {"delta":" second chunk","traceId":"${queryRunId}"}`,
        `event: answer.done\ndata: {"finishReason":"stop","metadata":{"model":"fast-model","templateId":"knowledge-answer-fast","templateVersion":"prompt-v1"},"traceId":"${queryRunId}"}`,
        "",
      ].join("\n\n"),
    );
  });

  it("answers local queries from persisted knowledge nodes when no generator is configured", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-21T12:00:00.000Z",
    });
    const space = await spaces.create({
      name: "Local docs",
      slug: "local-docs",
      tenantId: "tenant-1",
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    await nodes.createMany([
      knowledgeNode({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b11",
        sectionPath: ["Roadmap"],
        startOffset: 0,
        text: "The roadmap added queryable ingestion for uploaded Markdown documents.",
      }),
      knowledgeNode({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b12",
        sectionPath: ["Operations"],
        startOffset: 80,
        text: "Parser readiness is reported after document ingestion completes.",
      }),
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      allowLocalQueryFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeNodes: nodes,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
      maxLocalQueryNodes: 10,
    });

    const response = await app.request("/queries", {
      body: JSON.stringify({
        knowledgeSpaceId: space.id,
        mode: "fast",
        query: "What changed in the roadmap?",
      }),
      headers: {
        ...bearer(readToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    const traceId = response.headers.get("x-trace-id");
    const sse = await response.text();
    expect(response.status).toBe(200);
    expect(sse).toContain("The roadmap added queryable ingestion for uploaded Markdown documents.");
    expect(sse).toContain("answer.done");
    expect(sse).toContain("018f0d60-7a49-7cc2-9c1b-5b36f18f9b11");
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("tracks query session context with TTL, active resources, and permission invalidation", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9a03",
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const space = await spaces.create({
      name: "Session docs",
      slug: "session-docs",
      tenantId: "tenant-1",
    });
    const cache = createRecordingCache();
    let nowMs = Date.parse("2026-05-11T16:00:00.000Z");
    const calls: unknown[] = [];
    const access = await createGatewayTestSpaceAccess(space.id);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
      queryGenerator: {
        stream: async function* (input: unknown): AsyncGenerator<QueryGenerationEvent> {
          calls.push(input);
          yield { finishReason: "stop", type: "done" };
        },
      },
      sessions: createCacheSessionContextRepository({
        cache,
        maxActiveDocumentIds: 4,
        maxActiveEntityIds: 4,
        maxPreviousQueries: 2,
        now: () => nowMs,
        ttlMs: 60_000,
      }),
    });
    const sessionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f9b01";

    const first = await app.request("/queries", {
      body: JSON.stringify({
        activeDocumentIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f9c01"],
        activeEntityIds: ["vendor:acme"],
        knowledgeSpaceId: space.id,
        mode: "fast",
        query: "first question",
        sessionId,
      }),
      headers: {
        ...bearer(readToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    await first.text();

    nowMs += 1000;
    const second = await app.request("/queries", {
      body: JSON.stringify({
        activeDocumentIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f9c02"],
        activeEntityIds: ["policy:renewal"],
        knowledgeSpaceId: space.id,
        mode: "deep",
        query: "second question",
        sessionId,
      }),
      headers: {
        ...bearer(readToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    await second.text();

    expect(first.headers.get("x-session-id")).toBe(sessionId);
    expect(second.headers.get("x-session-id")).toBe(sessionId);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        sessionContext: expect.objectContaining({
          activeDocumentIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f9c01"],
          activeEntityIds: ["vendor:acme"],
          permissionInvalidated: false,
          previousQueries: [],
          sessionId,
        }),
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        sessionContext: expect.objectContaining({
          activeDocumentIds: [
            "018f0d60-7a49-7cc2-9c1b-5b36f18f9c01",
            "018f0d60-7a49-7cc2-9c1b-5b36f18f9c02",
          ],
          activeEntityIds: ["vendor:acme", "policy:renewal"],
          permissionInvalidated: false,
          previousQueries: [
            expect.objectContaining({
              query: "first question",
              traceId: first.headers.get("x-query-run-id"),
            }),
          ],
          sessionId,
        }),
      }),
    );
    expect(cache.setCalls.at(-1)?.options).toEqual({ ttlMs: 60_000 });

    nowMs += 1000;
    await access.updatePolicy({
      actorSubjectId: readSubject.subjectId,
      expectedRevision: 1,
      knowledgeSpaceId: space.id,
      partialMemberSubjectIds: [],
      tenantId: readSubject.tenantId,
      visibility: "all_members",
    });
    const permissionChanged = await app.request("/queries", {
      body: JSON.stringify({
        knowledgeSpaceId: space.id,
        mode: "fast",
        query: "third question",
        sessionId,
      }),
      headers: {
        ...bearer(writeToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    await permissionChanged.text();

    expect(calls[2]).toEqual(
      expect.objectContaining({
        sessionContext: expect.objectContaining({
          activeDocumentIds: [],
          activeEntityIds: [],
          permissionInvalidated: true,
          previousQueries: [],
          sessionId,
        }),
      }),
    );
  });

  it("bounds and expires cache-backed session context records", async () => {
    const cache = createRecordingCache();
    let nowMs = Date.parse("2026-05-11T16:30:00.000Z");
    const sessions = createCacheSessionContextRepository({
      cache,
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9d01",
      maxActiveDocumentIds: 1,
      maxActiveEntityIds: 1,
      maxPreviousQueries: 1,
      now: () => nowMs,
      ttlMs: 1_000,
    });
    const baseInput = {
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d02",
      permissionSnapshot: ["knowledge-spaces:read"],
      subjectId: "user-1",
      tenantId: "tenant-1",
    };

    const first = await sessions.recordQuery({
      ...baseInput,
      activeDocumentIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f9d03"],
      activeEntityIds: ["entity:first"],
      query: "first",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d04",
    });
    nowMs += 100;
    const second = await sessions.recordQuery({
      ...baseInput,
      activeDocumentIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f9d05"],
      activeEntityIds: ["entity:second"],
      query: "second",
      sessionId: first.context.sessionId,
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d06",
    });

    expect(second.context.previousQueries).toEqual([
      expect.objectContaining({
        query: "first",
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d04",
      }),
    ]);
    expect(second.stored.previousQueries).toEqual([
      expect.objectContaining({
        query: "second",
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d06",
      }),
    ]);
    expect(second.context.activeDocumentIds).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f9d05"]);
    expect(second.context.activeEntityIds).toEqual(["entity:second"]);
    const stored = await sessions.get({
      knowledgeSpaceId: baseInput.knowledgeSpaceId,
      sessionId: first.context.sessionId,
      subjectId: baseInput.subjectId,
      tenantId: baseInput.tenantId,
    });

    expect(stored?.previousQueries).toEqual(second.stored.previousQueries);
    if (!stored?.previousQueries[0]) {
      throw new Error("Expected stored previous query");
    }
    const mutableStored = stored as unknown as { previousQueries: Array<{ query: string }> };
    const mutablePreviousQuery = mutableStored.previousQueries[0];
    if (!mutablePreviousQuery) {
      throw new Error("Expected mutable previous query");
    }
    mutablePreviousQuery.query = "mutated";
    await expect(
      sessions.get({
        knowledgeSpaceId: baseInput.knowledgeSpaceId,
        sessionId: first.context.sessionId,
        subjectId: baseInput.subjectId,
        tenantId: baseInput.tenantId,
      }),
    ).resolves.toEqual(second.stored);

    const key = cache.setCalls.at(-1)?.key;
    if (!key) {
      throw new Error("Expected session cache key");
    }

    cache.values.set(key, new TextEncoder().encode("{"));
    await expect(
      sessions.get({
        knowledgeSpaceId: baseInput.knowledgeSpaceId,
        sessionId: first.context.sessionId,
        subjectId: baseInput.subjectId,
        tenantId: baseInput.tenantId,
      }),
    ).resolves.toBeNull();

    nowMs += 2_000;
    await expect(
      sessions.get({
        knowledgeSpaceId: baseInput.knowledgeSpaceId,
        sessionId: first.context.sessionId,
        subjectId: baseInput.subjectId,
        tenantId: baseInput.tenantId,
      }),
    ).resolves.toBeNull();
  });

  it("rejects unsafe session context bounds and inputs", async () => {
    const cache = createRecordingCache();

    expect(() =>
      createCacheSessionContextRepository({
        cache,
        cacheVersion: " ",
      }),
    ).toThrow("Session context cacheVersion is required");
    expect(() =>
      createCacheSessionContextRepository({
        cache,
        maxPreviousQueries: 0,
      }),
    ).toThrow("Session context maxPreviousQueries must be at least 1");
    expect(() =>
      createCacheSessionContextRepository({
        cache,
        maxActiveDocumentIds: 0,
      }),
    ).toThrow("Session context maxActiveDocumentIds must be at least 1");
    expect(() =>
      createCacheSessionContextRepository({
        cache,
        maxActiveEntityIds: 0,
      }),
    ).toThrow("Session context maxActiveEntityIds must be at least 1");
    expect(() =>
      createCacheSessionContextRepository({
        cache,
        maxEntryBytes: 0,
      }),
    ).toThrow("Session context maxEntryBytes must be at least 1");
    expect(() =>
      createCacheSessionContextRepository({
        cache,
        maxQueryBytes: 0,
      }),
    ).toThrow("Session context maxQueryBytes must be at least 1");
    expect(() =>
      createCacheSessionContextRepository({
        cache,
        ttlMs: 0,
      }),
    ).toThrow("Session context ttlMs must be at least 1");

    const sessions = createCacheSessionContextRepository({
      cache,
      maxQueryBytes: 4,
    });

    await expect(
      sessions.recordQuery({
        knowledgeSpaceId: "space",
        permissionSnapshot: ["knowledge-spaces:read"],
        query: "abcde",
        subjectId: "subject",
        tenantId: "tenant",
        traceId: "trace",
      }),
    ).rejects.toThrow("Session context query exceeds maxQueryBytes=4");
    await expect(
      sessions.recordQuery({
        knowledgeSpaceId: "space",
        permissionSnapshot: [],
        query: " ",
        subjectId: "subject",
        tenantId: "tenant",
        traceId: "trace",
      }),
    ).rejects.toThrow("Session context query is required");
    await expect(
      sessions.get({
        knowledgeSpaceId: " ",
        sessionId: "session",
        subjectId: "subject",
        tenantId: "tenant",
      }),
    ).rejects.toThrow("Session context knowledgeSpaceId is required");
  });

  it("protects query streaming with read scope and tenant-scoped spaces", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9a02",
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const space = await spaces.create({
      name: "Tenant docs",
      slug: "tenant-docs",
      tenantId: "tenant-1",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      queryGenerator: {
        stream: async function* (): AsyncGenerator<QueryGenerationEvent> {
          yield { delta: "should not stream", type: "delta" };
        },
      },
    });
    const body = JSON.stringify({
      knowledgeSpaceId: space.id,
      query: "Can I read this?",
    });

    const unauthorized = await app.request("/queries", {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const forbidden = await app.request("/queries", {
      body,
      headers: {
        ...bearer(writeOnlyToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    const crossTenant = await app.request("/queries", {
      body,
      headers: {
        ...bearer(otherTenantToken),
        "content-type": "application/json",
      },
      method: "POST",
    });
    const invalid = await app.request("/queries", {
      body: JSON.stringify({ knowledgeSpaceId: space.id, query: " " }),
      headers: {
        ...bearer(readToken),
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(unauthorized.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(crossTenant.status).toBe(404);
    expect(await crossTenant.json()).toEqual({ error: "Knowledge space not found" });
    expect(invalid.status).toBe(400);
  });

  it("returns tenant-scoped AnswerTrace records from the trace API", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-11T13:50:00.000Z",
    });
    const answerTraces = createInMemoryAnswerTraceRepository({
      maxSteps: 10,
      maxTraces: 10,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    const access = await createGatewayTestSpaceAccess(space.id);
    const tracePermission = await access.createPermissionSnapshot({
      accessChannel: "interactive",
      expiresAt: "2099-01-01T00:00:00.000Z",
      knowledgeSpaceId: space.id,
      subjectId: readSubject.subjectId,
      tenantId: readSubject.tenantId,
    });
    await answerTraces.create({
      createdAt: "2026-05-11T13:51:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      knowledgeSpaceId: space.id,
      mode: "research",
      permissionSnapshot: {
        accessChannel: tracePermission.accessChannel,
        id: tracePermission.id,
        revision: tracePermission.revision,
      },
      query: "How was this answer produced?",
      subjectId: readSubject.subjectId,
      steps: [
        {
          endedAt: "2026-05-11T13:51:01.000Z",
          metadata: { denseCandidates: 4 },
          name: "recall",
          startedAt: "2026-05-11T13:51:00.000Z",
          status: "ok",
        },
      ],
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      answerTraces,
      auth: createTestAuthVerifier(),
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
    });

    const unauthorized = await app.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01");
    expect(unauthorized.status).toBe(401);

    const forbiddenApp = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      answerTraces,
      auth: createStaticAuthVerifier({
        subject: { scopes: [], subjectId: "user-3", tenantId: "tenant-1" },
        token: "no-read-token",
      }),
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
    });
    const forbidden = await forbiddenApp.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01", {
      headers: bearer("no-read-token"),
    });
    expect(forbidden.status).toBe(403);

    const response = await app.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01", {
      headers: bearer(readToken),
    });
    expect(response.status).toBe(200);
    const publicTrace = (await response.json()) as Record<string, unknown>;
    expect(publicTrace).toMatchObject({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      knowledgeSpaceId: space.id,
      steps: [
        {
          metadata: { denseCandidates: 4 },
          name: "recall",
          status: "ok",
        },
      ],
    });
    expect(publicTrace).not.toHaveProperty("permissionSnapshot");
    expect(publicTrace).not.toHaveProperty("subjectId");

    const crossTenant = await app.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01", {
      headers: bearer(otherTenantToken),
    });
    expect(crossTenant.status).toBe(404);
    await expect(crossTenant.json()).resolves.toEqual({ error: "Answer trace not found" });

    await answerTraces.create({
      createdAt: "2026-05-11T13:52:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02",
      knowledgeSpaceId: space.id,
      mode: "fast",
      query: "legacy unowned trace",
      steps: [],
    });

    const missing = await app.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a02", {
      headers: bearer(readToken),
    });
    expect(missing.status).toBe(404);

    await answerTraces.create({
      createdAt: "2026-05-11T13:53:00.000Z",
      evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a03",
      knowledgeSpaceId: space.id,
      mode: "research",
      permissionSnapshot: {
        accessChannel: tracePermission.accessChannel,
        id: tracePermission.id,
        revision: tracePermission.revision,
      },
      query: "Trace whose bundle is not loaded inline",
      subjectId: readSubject.subjectId,
      steps: [],
    });
    const unresolvedBundle = await app.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a03", {
      headers: bearer(readToken),
    });
    const unresolvedBundleEvidence = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a03/evidence?limit=1",
      { headers: bearer(readToken) },
    );
    expect(unresolvedBundle.status).toBe(404);
    expect(unresolvedBundleEvidence.status).toBe(404);

    await access.updatePolicy({
      actorSubjectId: readSubject.subjectId,
      expectedRevision: 1,
      knowledgeSpaceId: space.id,
      partialMemberSubjectIds: [],
      tenantId: readSubject.tenantId,
      visibility: "all_members",
    });
    const staleGrant = await app.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01", {
      headers: bearer(readToken),
    });
    expect(staleGrant.status).toBe(403);
  });

  it("serves query-dependent virtual evidence, conflict, and missing trees", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const answerTraces = createInMemoryAnswerTraceRepository({
      maxSteps: 4,
      maxTraces: 4,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    const access = await createGatewayTestSpaceAccess(space.id);
    const tracePermission = await access.createPermissionSnapshot({
      accessChannel: "interactive",
      expiresAt: "2099-01-01T00:00:00.000Z",
      knowledgeSpaceId: space.id,
      subjectId: readSubject.subjectId,
      tenantId: readSubject.tenantId,
    });
    const evidenceBundle = EvidenceBundleSchema.parse({
      createdAt: "2026-05-11T13:51:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
      items: [
        {
          citations: [
            {
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
              documentVersion: 1,
              sectionPath: ["Policy"],
            },
          ],
          conflicts: [
            {
              reason: "The policy conflicts with the renewal memo.",
              severity: "blocking",
              withNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d02",
            },
          ],
          freshness: { status: "fresh" },
          metadata: { source: "policy" },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
          score: 0.92,
          scores: { final: 0.92, retrieval: 0.87 },
          text: "Renewals require approval.",
        },
        {
          citations: [
            {
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
              documentVersion: 1,
              sectionPath: ["Fallback"],
            },
          ],
          conflicts: [
            {
              reason: "The fallback source only partially supports the answer.",
              severity: "warning",
            },
          ],
          freshness: { status: "stale", staleReason: "document-superseded" },
          metadata: { source: "fallback" },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d03",
          score: 0.41,
          scores: { final: 0.41, retrieval: 0.4 },
          text: "Fallback renewal note.",
        },
      ],
      missingEvidence: [
        {
          expectedEvidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8e01",
          metadata: { owner: "legal" },
          reason: "not-retrieved",
          text: "Need the latest vendor amendment.",
        },
        {
          metadata: { owner: "finance" },
          reason: "unknown",
          text: "Need the latest renewal invoice.",
        },
      ],
      query: "What renewal approvals are needed?",
      state: "partial",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
    });
    await answerTraces.create({
      createdAt: "2026-05-11T13:51:00.000Z",
      evidenceBundleId: evidenceBundle.id,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      knowledgeSpaceId: space.id,
      mode: "research",
      permissionSnapshot: {
        accessChannel: tracePermission.accessChannel,
        id: tracePermission.id,
        revision: tracePermission.revision,
      },
      query: evidenceBundle.query,
      subjectId: readSubject.subjectId,
      steps: [
        {
          endedAt: "2026-05-11T13:51:01.000Z",
          metadata: { evidenceBundle },
          name: "evidence",
          startedAt: "2026-05-11T13:51:00.000Z",
          status: "ok",
        },
      ],
    });
    await answerTraces.create({
      createdAt: "2026-05-11T13:52:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02",
      knowledgeSpaceId: space.id,
      mode: "research",
      permissionSnapshot: {
        accessChannel: tracePermission.accessChannel,
        id: tracePermission.id,
        revision: tracePermission.revision,
      },
      query: "Which evidence is missing?",
      subjectId: readSubject.subjectId,
      steps: [
        {
          endedAt: "2026-05-11T13:52:01.000Z",
          metadata: { note: "no bundle yet" },
          name: "evidence",
          startedAt: "2026-05-11T13:52:00.000Z",
          status: "ok",
        },
      ],
    });
    const queryEvidenceAssets = await createInitializedTestDocumentAssets(space.id, [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    ]);
    const queryEvidenceNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    await queryEvidenceNodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "1".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 26,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
        kind: "chunk",
        knowledgeSpaceId: space.id,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c01",
        permissionScope: [],
        sourceLocation: { endOffset: 26, sectionPath: ["Policy"], startOffset: 0 },
        startOffset: 0,
        text: "Renewals require approval.",
      }),
      KnowledgeNodeSchema.parse({
        artifactHash: "2".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        endOffset: 23,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d03",
        kind: "chunk",
        knowledgeSpaceId: space.id,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c02",
        permissionScope: [],
        sourceLocation: { endOffset: 23, sectionPath: ["Fallback"], startOffset: 0 },
        startOffset: 0,
        text: "Fallback renewal note.",
      }),
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      answerTraces,
      auth: createTestAuthVerifier(),
      documentAssets: queryEvidenceAssets,
      knowledgeNodes: queryEvidenceNodes,
      knowledgeSpaceAccess: access,
      knowledgeSpaces: spaces,
    });

    const evidence = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/evidence?limit=1",
      { headers: bearer(readToken) },
    );
    const conflicts = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/conflicts?limit=1",
      { headers: bearer(readToken) },
    );
    const missing = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/missing?limit=1",
      { headers: bearer(readToken) },
    );
    const crossTenant = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/evidence?limit=1",
      { headers: bearer(otherTenantToken) },
    );
    const secondEvidencePage = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/evidence?limit=1&cursor=1",
      { headers: bearer(readToken) },
    );
    const fallbackConflict = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/conflicts?limit=2&cursor=1",
      { headers: bearer(readToken) },
    );
    const fallbackMissing = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/missing?limit=2&cursor=1",
      { headers: bearer(readToken) },
    );
    const emptyEvidence = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a02/evidence?limit=1",
      { headers: bearer(readToken) },
    );
    const emptyConflicts = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a02/conflicts?limit=1",
      { headers: bearer(readToken) },
    );
    const emptyMissing = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a02/missing?limit=1",
      { headers: bearer(readToken) },
    );
    const invalidCursor = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/evidence?limit=1&cursor=not-a-cursor",
      { headers: bearer(readToken) },
    );
    const invalidConflictCursor = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/conflicts?limit=1&cursor=not-a-cursor",
      { headers: bearer(readToken) },
    );
    const invalidMissingCursor = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/missing?limit=1&cursor=not-a-cursor",
      { headers: bearer(readToken) },
    );

    expect(evidence.status).toBe(200);
    await expect(evidence.json()).resolves.toMatchObject({
      items: [
        {
          kind: "resource",
          metadata: {
            citationCount: 1,
            conflictCount: 1,
            freshness: { status: "fresh" },
            score: 0.92,
          },
          name: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
          path: "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/evidence/018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
          resourceType: "node",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
        },
      ],
      nextCursor: "1",
      path: "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/evidence",
      truncated: true,
    });
    expect(secondEvidencePage.status).toBe(200);
    await expect(secondEvidencePage.json()).resolves.toMatchObject({
      items: [
        {
          metadata: {
            citationCount: 1,
            conflictCount: 1,
            freshness: { status: "stale" },
            score: 0.41,
          },
          name: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d03",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d03",
        },
      ],
      truncated: false,
    });
    expect(conflicts.status).toBe(200);
    await expect(conflicts.json()).resolves.toMatchObject({
      items: [
        {
          metadata: {
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
            reason: "The policy conflicts with the renewal memo.",
            severity: "blocking",
          },
          name: "conflict-1",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d02",
        },
      ],
      path: "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/conflicts",
    });
    expect(fallbackConflict.status).toBe(200);
    await expect(fallbackConflict.json()).resolves.toMatchObject({
      items: [
        {
          metadata: {
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d03",
            reason: "The fallback source only partially supports the answer.",
            severity: "warning",
          },
          name: "conflict-1",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d03",
        },
      ],
      truncated: false,
    });
    expect(missing.status).toBe(200);
    await expect(missing.json()).resolves.toMatchObject({
      items: [
        {
          metadata: { owner: "legal", reason: "not-retrieved" },
          name: "missing-1",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8e01",
        },
      ],
      path: "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/missing",
    });
    expect(fallbackMissing.status).toBe(200);
    await expect(fallbackMissing.json()).resolves.toMatchObject({
      items: [
        {
          metadata: { owner: "finance", reason: "unknown" },
          name: "missing-2",
          targetId: "missing-2",
        },
      ],
      truncated: false,
    });
    expect(emptyEvidence.status).toBe(200);
    await expect(emptyEvidence.json()).resolves.toEqual({
      items: [],
      path: "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a02/evidence",
      truncated: false,
    });
    expect(emptyConflicts.status).toBe(200);
    await expect(emptyConflicts.json()).resolves.toEqual({
      items: [],
      path: "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a02/conflicts",
      truncated: false,
    });
    expect(emptyMissing.status).toBe(200);
    await expect(emptyMissing.json()).resolves.toEqual({
      items: [],
      path: "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a02/missing",
      truncated: false,
    });
    expect(invalidCursor.status).toBe(400);
    await expect(invalidCursor.json()).resolves.toEqual({
      error: "Query virtual tree cursor is invalid",
    });
    expect(invalidConflictCursor.status).toBe(400);
    await expect(invalidConflictCursor.json()).resolves.toEqual({
      error: "Query virtual tree cursor is invalid",
    });
    expect(invalidMissingCursor.status).toBe(400);
    await expect(invalidMissingCursor.json()).resolves.toEqual({
      error: "Query virtual tree cursor is invalid",
    });
    expect(crossTenant.status).toBe(404);

    await expect(
      rollbackInitializedTestDocumentAsset(
        queryEvidenceAssets,
        space.id,
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      ),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43" });

    const hiddenTrace = await app.request("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01", {
      headers: bearer(readToken),
    });
    const hiddenEvidence = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/evidence?limit=1",
      { headers: bearer(readToken) },
    );
    const hiddenConflicts = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/conflicts?limit=1",
      { headers: bearer(readToken) },
    );
    const hiddenMissing = await app.request(
      "/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01/missing?limit=1",
      { headers: bearer(readToken) },
    );

    expect(hiddenTrace.status).toBe(404);
    expect(hiddenEvidence.status).toBe(404);
    expect(hiddenConflicts.status).toBe(404);
    expect(hiddenMissing.status).toBe(404);
  });

  it("rejects duplicate tenant slugs and unbounded knowledge-space lists", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: (() => {
          let nextId = 0;
          const ids = [
            "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          ];

          return () => ids[nextId++] ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
        })(),
        maxListLimit: 2,
        maxSpaces: 1,
        now: () => "2026-05-08T10:00:00.000Z",
      }),
    });

    const first = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Engineering", slug: "engineering" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(first.status).toBe(201);

    const duplicate = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Engineering 2", slug: "engineering" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({
      error: "Knowledge space slug already exists for tenant",
    });

    const overCapacity = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Legal", slug: "legal" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(overCapacity.status).toBe(429);

    const unbounded = await app.request("/knowledge-spaces?limit=0", {
      headers: bearer(readToken),
    });
    expect(unbounded.status).toBe(400);

    const oversized = await app.request("/knowledge-spaces?limit=3", {
      headers: bearer(readToken),
    });
    expect(oversized.status).toBe(400);

    const callerSuppliedTenant = await app.request(
      "/knowledge-spaces?tenantId=tenant-evil&limit=1",
      { headers: bearer(readToken) },
    );
    expect(callerSuppliedTenant.status).toBe(400);
  });

  it("paginates spaces with stable cursors and clones repository records", async () => {
    const repository = createInMemoryKnowledgeSpaceRepository({
      generateId: (() => {
        let nextId = 0;
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        ];

        return () => ids[nextId++] ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
      })(),
      maxListLimit: 2,
      maxSpaces: 10,
      now: () => "2026-05-08T10:00:00.000Z",
    });

    await repository.create({ name: "Gamma", slug: "gamma", tenantId: "tenant-1" });
    await repository.create({ name: "Alpha", slug: "alpha", tenantId: "tenant-1" });
    await repository.create({ name: "Other", slug: "alpha", tenantId: "tenant-2" });

    const firstPage = await repository.list({ limit: 1, tenantId: "tenant-1" });
    expect(firstPage).toMatchObject({
      items: [{ slug: "alpha" }],
      nextCursor: "alpha",
    });

    const firstItem = firstPage.items[0];

    if (!firstItem) {
      throw new Error("Expected first page to include a knowledge space");
    }

    firstItem.name = "Caller Mutation";

    const secondPage = await repository.list({
      cursor: firstPage.nextCursor,
      limit: 2,
      tenantId: "tenant-1",
    });

    expect(secondPage.items.map((space) => space.slug)).toEqual(["gamma"]);
    await expect(
      repository.get({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43", tenantId: "tenant-1" }),
    ).resolves.toMatchObject({ name: "Alpha" });
    await expect(repository.list({ limit: 0, tenantId: "tenant-1" })).rejects.toThrow(
      "Knowledge space list limit must be at least 1",
    );
  });

  it("backs knowledge-space CRUD with a parameterized database repository", async () => {
    const fake = createFakeKnowledgeSpaceExecutor();
    const repository = createDatabaseKnowledgeSpaceRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      generateId: (() => {
        let nextId = 0;
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        ];

        return () => ids[nextId++] ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
      })(),
      maxListLimit: 2,
      now: () => "2026-05-09T10:00:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaces: repository,
    });

    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        description: "Database-backed space",
        name: "Database Space",
        slug: "database-space",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      description: "Database-backed space",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      slug: "database-space",
      tenantId: "tenant-1",
    });

    const duplicate = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Duplicate", slug: "database-space" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(duplicate.status).toBe(409);

    expect(fake.calls.some((call) => call.operation === "insert")).toBe(true);
    expect(fake.calls.every((call) => !call.sql.includes("Database Space"))).toBe(true);
    expect(fake.calls.some((call) => call.params.includes("Database Space"))).toBe(true);
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: ["tenant-1", "database-space"],
        tableName: "knowledge_spaces",
      }),
    );
  });

  it("lists, updates, deletes, and clones rows through the database repository", async () => {
    const fake = createFakeKnowledgeSpaceExecutor([
      {
        created_at: "2026-05-09T09:00:00.000Z",
        description: null,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        name: "Alpha",
        revision: 1,
        slug: "alpha",
        tenant_id: "tenant-1",
        updated_at: "2026-05-09T09:00:00.000Z",
      },
      {
        created_at: "2026-05-09T09:00:00.000Z",
        description: null,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        name: "Gamma",
        revision: 1,
        slug: "gamma",
        tenant_id: "tenant-1",
        updated_at: "2026-05-09T09:00:00.000Z",
      },
      {
        created_at: "2026-05-09T09:00:00.000Z",
        description: null,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        name: "Other",
        revision: 1,
        slug: "alpha",
        tenant_id: "tenant-2",
        updated_at: "2026-05-09T09:00:00.000Z",
      },
    ]);
    const repository = createDatabaseKnowledgeSpaceRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      maxListLimit: 2,
      now: () => "2026-05-09T10:00:00.000Z",
    });

    const firstPage = await repository.list({ limit: 1, tenantId: "tenant-1" });
    expect(firstPage).toMatchObject({
      items: [{ slug: "alpha", tenantId: "tenant-1" }],
      nextCursor: "alpha",
    });
    const secondPage = await repository.list({
      cursor: firstPage.nextCursor,
      limit: 2,
      tenantId: "tenant-1",
    });
    expect(secondPage).toMatchObject({
      items: [{ slug: "gamma", tenantId: "tenant-1" }],
    });
    expect(secondPage.nextCursor).toBeUndefined();
    const firstItem = firstPage.items[0];

    if (!firstItem) {
      throw new Error("Expected database repository to return a first item");
    }

    firstItem.name = "Caller Mutation";

    await expect(
      repository.get({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42", tenantId: "tenant-1" }),
    ).resolves.toMatchObject({ name: "Alpha" });
    await expect(
      repository.get({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42", tenantId: "tenant-2" }),
    ).resolves.toBeNull();

    const updated = await repository.update({
      expectedRevision: 1,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      name: "Gamma Updated",
      permission: testKnowledgeSpaceUpdatePermission("018f0d60-7a49-7cc2-9c1b-5b36f18f2c43"),
      slug: "gamma-updated",
      tenantId: "tenant-1",
    });
    expect(updated).toMatchObject({
      name: "Gamma Updated",
      slug: "gamma-updated",
      updatedAt: "2026-05-09T10:00:00.000Z",
    });

    await expect(
      repository.update({
        expectedRevision: 1,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        name: "Wrong Tenant",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.update({
        expectedRevision: 2,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        permission: testKnowledgeSpaceUpdatePermission("018f0d60-7a49-7cc2-9c1b-5b36f18f2c43"),
        slug: "alpha",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Knowledge space slug already exists for tenant");
    await expect(repository.list({ limit: 3, tenantId: "tenant-1" })).rejects.toThrow(
      "Knowledge space list limit exceeds maxListLimit=2",
    );

    await expect(
      repository.rollbackCreate({
        expectedRevision: 1,
        expectedSlug: "alpha",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-2",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.rollbackCreate({
        expectedRevision: 1,
        expectedSlug: "alpha",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).resolves.toBe(true);
  });

  it("supports non-returning database executors and dialect-specific SQL", async () => {
    const fake = createFakeKnowledgeSpaceExecutor([], { returnRowsForWrites: false });
    const repository = createDatabaseKnowledgeSpaceRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 5,
      now: () => "2026-05-09T10:00:00.000Z",
    });

    await expect(
      repository.create({ name: "TiDB Space", slug: "tidb-space", tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      slug: "tidb-space",
    });
    await expect(
      repository.update({
        expectedRevision: 1,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        name: "TiDB Space Updated",
        permission: testKnowledgeSpaceUpdatePermission("018f0d60-7a49-7cc2-9c1b-5b36f18f2c42"),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ name: "TiDB Space Updated" });

    const insertCall = fake.calls.find((call) => call.operation === "insert");

    expect(insertCall?.sql).toContain("INSERT INTO `knowledge_spaces`");
    expect(insertCall?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    expect(insertCall?.sql).not.toContain("RETURNING");
  });

  it("backs golden question CRUD with parameterized bounded database access", async () => {
    const fake = createFakeGoldenQuestionExecutor();
    const repository = createDatabaseGoldenQuestionRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      maxListLimit: 2,
      now: (() => {
        let minute = 0;
        return () => `2026-05-11T10:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });

    const created = await repository.create({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d10"],
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { owner: "eval" },
      permission: testGoldenQuestionPermission(),
      question: "What changed in the roadmap?",
      requiredPermissionScope: [],
      tags: ["phase-1"],
    });
    expect(created).toEqual({
      createdAt: "2026-05-11T10:00:00.000Z",
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d10"],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { owner: "eval" },
      question: "What changed in the roadmap?",
      tags: ["phase-1"],
      updatedAt: "2026-05-11T10:00:00.000Z",
    });
    const postgresInsert = fake.calls.find((call) => call.operation === "insert");
    expect(postgresInsert).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "golden_questions",
      }),
    );
    expect(postgresInsert?.sql).not.toContain("What changed");
    expect(postgresInsert?.params).toContain("What changed in the roadmap?");
    expect(postgresInsert?.params).toContain(
      JSON.stringify(["018f0d60-7a49-7cc2-9c1b-5b36f18f2d10"]),
    );

    await expect(
      repository.list({
        candidateGrants: testGoldenQuestionPermission().candidateGrants,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 1,
        tenantId: testGoldenQuestionPermission().tenantId,
      }),
    ).resolves.toEqual({
      items: [created],
    });
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        tableName: "golden_questions",
      }),
    );
    await expect(
      repository.list({
        candidateGrants: testGoldenQuestionPermission().candidateGrants,
        cursor: { createdAt: created.createdAt, id: created.id },
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 1,
        tenantId: testGoldenQuestionPermission().tenantId,
      }),
    ).resolves.toEqual({ items: [] });

    const updated = await repository.update({
      expectedEvidenceIds: [],
      id: created.id,
      knowledgeSpaceId: created.knowledgeSpaceId,
      metadata: {},
      permission: testGoldenQuestionPermission(),
      question: "What changed in Phase 1?",
      tags: ["phase-1", "roadmap"],
    });
    expect(updated).toMatchObject({
      expectedEvidenceIds: [],
      question: "What changed in Phase 1?",
      tags: ["phase-1", "roadmap"],
      updatedAt: "2026-05-11T10:01:00.000Z",
    });
    await expect(
      repository.update({
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
        permission: testGoldenQuestionPermission(),
        question: "What changed in Phase 1 after review?",
      }),
    ).resolves.toMatchObject({
      expectedEvidenceIds: [],
      metadata: {},
      question: "What changed in Phase 1 after review?",
      tags: ["phase-1", "roadmap"],
      updatedAt: "2026-05-11T10:02:00.000Z",
    });
    await expect(
      repository.get({
        candidateGrants: testGoldenQuestionPermission().candidateGrants,
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
        tenantId: testGoldenQuestionPermission().tenantId,
      }),
    ).resolves.toMatchObject({ question: "What changed in Phase 1 after review?" });
    await expect(
      repository.get({
        candidateGrants: testGoldenQuestionPermission().candidateGrants,
        id: created.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        tenantId: testGoldenQuestionPermission().tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.update({
        id: created.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        permission: testGoldenQuestionPermission(),
        question: "Wrong space",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.listTrusted({ knowledgeSpaceId: created.knowledgeSpaceId, limit: 3 }),
    ).rejects.toThrow("Golden question list limit exceeds maxListLimit=2");
    await expect(
      repository.delete({
        id: created.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        permission: testGoldenQuestionPermission(),
      }),
    ).resolves.toBe(false);
    await expect(
      repository.delete({
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
        permission: testGoldenQuestionPermission(),
      }),
    ).resolves.toBe(true);

    const tidbFake = createFakeGoldenQuestionExecutor([], { returnRowsForWrites: false });
    const tidbRepository = createDatabaseGoldenQuestionRepository({
      database: createSchemaDatabaseAdapter({
        executor: tidbFake.executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: tidbFake.executor }),
      }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02",
      maxListLimit: 2,
      now: () => "2026-05-11T11:00:00.000Z",
    });
    await expect(
      tidbRepository.create({
        expectedEvidenceIds: [],
        knowledgeSpaceId: created.knowledgeSpaceId,
        permission: testGoldenQuestionPermission(),
        question: "TiDB golden question?",
        requiredPermissionScope: [],
      }),
    ).resolves.toMatchObject({ question: "TiDB golden question?" });
    const tidbInsert = tidbFake.calls.find((call) => call.operation === "insert");
    expect(tidbInsert?.sql).toContain("INSERT INTO `golden_questions`");
    expect(tidbInsert?.sql).not.toContain("RETURNING");
  });

  it("rejects invalid repository bounds", () => {
    expect(() => createInMemoryKnowledgeSpaceRepository({ maxListLimit: 1, maxSpaces: 0 })).toThrow(
      "Knowledge space repository maxSpaces must be at least 1",
    );
    expect(() => createInMemoryKnowledgeSpaceRepository({ maxListLimit: 0, maxSpaces: 1 })).toThrow(
      "Knowledge space repository maxListLimit must be at least 1",
    );
    expect(() =>
      createDatabaseKnowledgeSpaceRepository({
        database: createSchemaDatabaseAdapter({ kind: "postgres" }),
        maxListLimit: 0,
      }),
    ).toThrow("Knowledge space repository maxListLimit must be at least 1");
    expect(() =>
      createInMemoryGoldenQuestionRepository({
        maxListLimit: 1,
        maxQuestions: 0,
      }),
    ).toThrow("Golden question repository maxQuestions must be at least 1");
    expect(() =>
      createInMemoryGoldenQuestionRepository({
        maxListLimit: 0,
        maxQuestions: 1,
      }),
    ).toThrow("Golden question repository maxListLimit must be at least 1");
    expect(() =>
      createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({ kind: "postgres" }),
        maxListLimit: 0,
      }),
    ).toThrow("Golden question repository maxListLimit must be at least 1");
    expect(() => createInMemoryDocumentAssetRepository({ maxAssets: 0 })).toThrow(
      "Document asset repository maxAssets must be at least 1",
    );
    expect(() => createInMemoryParseArtifactRepository({ maxArtifacts: 0 })).toThrow(
      "Parse artifact repository maxArtifacts must be at least 1",
    );
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxKnowledgeFsTreeDepth: 0,
      }),
    ).toThrow("KnowledgeFS tree max depth must be at least 1");
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        maxUploadBytes: 0,
      }),
    ).toThrow("Document upload maxUploadBytes must be between 1 and 52428800");
  });

  it("fails closed when durable deletion is configured without both write safety ports", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const durableDeletions = createAcceptingDurableDeletionService();
    const safety = createAllowingDurableDeletionSafetyOptions();

    expect(() => createKnowledgeGateway({ adapter, durableDeletions })).toThrow(
      "Durable deletion requires a deletion lifecycle fence",
    );
    expect(() =>
      createKnowledgeGateway({
        adapter,
        deletionObjectWriteAdmission: safety.deletionObjectWriteAdmission,
        durableDeletions,
      }),
    ).toThrow("Durable deletion requires a deletion lifecycle fence");
    expect(() =>
      createKnowledgeGateway({
        adapter,
        deletionLifecycleFence: safety.deletionLifecycleFence,
        durableDeletions,
      }),
    ).toThrow("Durable deletion requires object-write admission");

    const durableDeletionRepository = createDatabaseDurableDeletionRepository({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      fingerprinter: () => "a".repeat(64),
    });
    expect(() => createKnowledgeGateway({ adapter, durableDeletionRepository })).toThrow(
      "Durable deletion repository requires the logical document repository",
    );
  });

  it("returns not found and update-conflict responses for knowledge-space mutations", async () => {
    const app = createKnowledgeGateway({
      ...createAllowingDurableDeletionSafetyOptions(),
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      durableDeletions: createNotFoundDurableDeletionService(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: (() => {
          let nextId = 0;
          const ids = [
            "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          ];

          return () => ids[nextId++] ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
        })(),
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-08T10:00:00.000Z",
      }),
    });
    const missingId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99";

    const missingUpdate = await app.request(`/knowledge-spaces/${missingId}`, {
      body: JSON.stringify({ expectedRevision: 1, name: "Missing" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PATCH",
    });
    expect(missingUpdate.status).toBe(404);

    const missingDelete = await app.request(`/knowledge-spaces/${missingId}`, {
      body: JSON.stringify({ challenge: "Missing", expectedRevision: 1 }),
      headers: {
        ...bearer(writeToken),
        "content-type": "application/json",
        "idempotency-key": "delete-missing-space",
      },
      method: "DELETE",
    });
    expect(missingDelete.status).toBe(404);

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Alpha", slug: "alpha" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Gamma", slug: "gamma" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const conflict = await app.request("/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43", {
      body: JSON.stringify({ expectedRevision: 1, slug: "alpha" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PATCH",
    });

    expect(conflict.status).toBe(409);
  });

  it("creates knowledge spaces with the default bounded repository", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
    });
    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Default", slug: "default" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      name: "Default",
      slug: "default",
      tenantId: "tenant-1",
    });
  });

  it("manages tenant-scoped golden question CRUD with expected evidence ids", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const evidence = await createGoldenEvidenceFixtures(knowledgeSpaceId, [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12",
    ]);
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02",
        ];

        return () => ids.shift() ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f3a03";
      })(),
      maxListLimit: 2,
      maxQuestions: 3,
      now: (() => {
        let minute = 0;
        return () => `2026-05-11T10:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: evidence.assets,
      goldenQuestions,
      knowledgeNodes: evidence.nodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-11T09:00:00.000Z",
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Evaluation", slug: "evaluation" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const created = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions",
      {
        body: JSON.stringify({
          expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d10"],
          metadata: { owner: "eval" },
          question: "What changed in the roadmap?",
          tags: ["phase-1"],
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({
      createdAt: "2026-05-11T10:00:00.000Z",
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d10"],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { owner: "eval" },
      question: "What changed in the roadmap?",
      tags: ["phase-1"],
      updatedAt: "2026-05-11T10:00:00.000Z",
    });

    const read = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      { headers: bearer(readToken) },
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      question: "What changed in the roadmap?",
    });

    const secondCreated = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions",
      {
        body: JSON.stringify({
          expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d12"],
          question: "Which evidence mentions the roadmap?",
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(secondCreated.status).toBe(201);

    const listed = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions?limit=1",
      { headers: bearer(readToken) },
    );
    expect(listed.status).toBe(200);
    const firstListPage = await listed.json();
    expect(firstListPage).toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01" }],
    });
    expect(firstListPage.nextCursor).toBeTruthy();

    const secondListPage = await app.request(
      `/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions?limit=1&cursor=${encodeURIComponent(
        String(firstListPage.nextCursor),
      )}`,
      { headers: bearer(readToken) },
    );
    expect(secondListPage.status).toBe(200);
    await expect(secondListPage.json()).resolves.toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02" }],
    });

    const updated = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      {
        body: JSON.stringify({
          expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d11"],
          metadata: { owner: "qa" },
          question: "What changed in the Phase 1 roadmap?",
          tags: ["phase-1", "roadmap"],
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d11"],
      metadata: { owner: "qa" },
      question: "What changed in the Phase 1 roadmap?",
      tags: ["phase-1", "roadmap"],
      updatedAt: "2026-05-11T10:02:00.000Z",
    });

    const deleted = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      {
        headers: bearer(writeToken),
        method: "DELETE",
      },
    );
    expect(deleted.status).toBe(204);

    const missing = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      { headers: bearer(readToken) },
    );
    expect(missing.status).toBe(404);
    await expect(
      goldenQuestions.updateTrusted({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        question: "Wrong space update",
      }),
    ).resolves.toBeNull();
    await expect(
      goldenQuestions.updateTrusted({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a99",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        question: "Missing question update",
      }),
    ).resolves.toBeNull();
    await expect(
      goldenQuestions.updateTrusted({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        question: "Which evidence still mentions the roadmap?",
      }),
    ).resolves.toMatchObject({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2d12"],
      metadata: {},
      question: "Which evidence still mentions the roadmap?",
      tags: [],
    });
    await expect(
      goldenQuestions.deleteTrusted({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a99",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toBe(false);
  });

  it("protects golden questions and rejects unbounded golden-question reads", async () => {
    const goldenQuestionsRepository = createInMemoryGoldenQuestionRepository({
      maxListLimit: 2,
      maxQuestions: 2,
      now: () => "2026-05-11T10:00:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      goldenQuestions: goldenQuestionsRepository,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-11T09:00:00.000Z",
      }),
    });
    const basePath = "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions";

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Evaluation", slug: "evaluation" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect((await app.request(`${basePath}?limit=1`)).status).toBe(401);
    expect(
      (
        await app.request(basePath, {
          body: JSON.stringify({ question: "Read only?", expectedEvidenceIds: [] }),
          headers: { ...bearer(readToken), "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect((await app.request(`${basePath}?limit=0`, { headers: bearer(readToken) })).status).toBe(
      400,
    );
    expect((await app.request(`${basePath}?limit=3`, { headers: bearer(readToken) })).status).toBe(
      400,
    );
    expect(
      (await app.request(`${basePath}?limit=1&cursor=bad`, { headers: bearer(readToken) })).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/golden-questions?limit=1",
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`${basePath}?limit=1`, { headers: bearer(otherTenantToken) })).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a99",
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`${basePath}/018f0d60-7a49-7cc2-9c1b-5b36f18f3a99`, {
          body: JSON.stringify({ question: "Missing update" }),
          headers: { ...bearer(writeToken), "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a99",
          {
            body: JSON.stringify({ question: "Missing space update" }),
            headers: { ...bearer(writeToken), "content-type": "application/json" },
            method: "PATCH",
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`${basePath}/018f0d60-7a49-7cc2-9c1b-5b36f18f3a99`, {
          headers: bearer(writeToken),
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a99",
          { headers: bearer(writeToken), method: "DELETE" },
        )
      ).status,
    ).toBe(404);

    await goldenQuestionsRepository.createTrusted({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      question: "First same-time question?",
    });
    await goldenQuestionsRepository.createTrusted({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      question: "Second same-time question?",
    });
    const firstPage = await goldenQuestionsRepository.listTrusted({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
    });
    const secondPage = await goldenQuestionsRepository.listTrusted({
      cursor: firstPage.nextCursor,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
    });
    expect(secondPage.items).toHaveLength(1);
  });

  it("records tenant-scoped human annotations on golden questions", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const questionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3a21";
    const relevantEvidenceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a21";
    const irrelevantEvidenceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a22";
    const evidence = await createGoldenEvidenceFixtures(knowledgeSpaceId, [
      relevantEvidenceId,
      irrelevantEvidenceId,
    ]);
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => questionId,
      maxListLimit: 10,
      maxQuestions: 10,
      now: (() => {
        const times = ["2026-05-13T15:00:00.000Z", "2026-05-13T15:01:00.000Z"];

        return () => times.shift() ?? "2026-05-13T15:02:00.000Z";
      })(),
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: evidence.assets,
      goldenQuestions,
      knowledgeNodes: evidence.nodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-13T14:59:00.000Z",
      }),
      now: () => "2026-05-13T15:01:00.000Z",
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Evaluation", slug: "evaluation" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await app.request(`/knowledge-spaces/${knowledgeSpaceId}/golden-questions`, {
      body: JSON.stringify({
        expectedEvidenceIds: [relevantEvidenceId, irrelevantEvidenceId],
        metadata: { owner: "eval" },
        question: "Did the answer cite the right evidence?",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const unauthorized = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/${questionId}/annotations`,
      {
        body: JSON.stringify({ answerCorrectness: "incorrect", evidenceRelevance: [] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(unauthorized.status).toBe(401);

    const forbidden = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/${questionId}/annotations`,
      {
        body: JSON.stringify({ answerCorrectness: "incorrect", evidenceRelevance: [] }),
        headers: { ...bearer(readToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(forbidden.status).toBe(403);

    const annotated = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/${questionId}/annotations`,
      {
        body: JSON.stringify({
          answerCorrectness: "incorrect",
          evidenceRelevance: [
            { evidenceId: relevantEvidenceId, relevant: true },
            {
              evidenceId: irrelevantEvidenceId,
              note: "This node is stale.",
              relevant: false,
            },
          ],
          note: "Answer missed the policy exception.",
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(annotated.status).toBe(200);
    await expect(annotated.json()).resolves.toMatchObject({
      id: questionId,
      metadata: {
        annotationSummary: {
          latestAnswerCorrectness: "incorrect",
          irrelevantEvidenceCount: 1,
          relevantEvidenceCount: 1,
          totalAnnotations: 1,
        },
        annotations: [
          {
            annotatedAt: "2026-05-13T15:01:00.000Z",
            annotatedBy: "user-1",
            answerCorrectness: "incorrect",
            evidenceRelevance: [
              { evidenceId: relevantEvidenceId, relevant: true },
              {
                evidenceId: irrelevantEvidenceId,
                note: "This node is stale.",
                relevant: false,
              },
            ],
            note: "Answer missed the policy exception.",
          },
        ],
        owner: "eval",
      },
      tags: ["annotated"],
      updatedAt: "2026-05-13T15:01:00.000Z",
    });

    const crossTenant = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/${questionId}/annotations`,
      {
        body: JSON.stringify({ answerCorrectness: "correct", evidenceRelevance: [] }),
        headers: { ...bearer(otherTenantToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(crossTenant.status).toBe(404);

    const missingQuestion = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a99/annotations`,
      {
        body: JSON.stringify({ answerCorrectness: "correct", evidenceRelevance: [] }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(missingQuestion.status).toBe(404);

    const tooManyEvidenceLabels = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/${questionId}/annotations`,
      {
        body: JSON.stringify({
          answerCorrectness: "correct",
          evidenceRelevance: Array.from({ length: 51 }, (_, index) => ({
            evidenceId: `018f0d60-7a49-7cc2-9c1b-5b36f18f${String(index).padStart(4, "0")}`,
            relevant: true,
          })),
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(tooManyEvidenceLabels.status).toBe(400);
  });

  it("captures production bad cases from tenant-scoped answer traces into the evaluation queue", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
    const expectedNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01";
    const missingNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8d02";
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3a10",
      maxListLimit: 10,
      maxQuestions: 10,
      now: () => "2026-05-13T14:00:00.000Z",
    });
    const answerTraces = createInMemoryAnswerTraceRepository({
      maxSteps: 10,
      maxTraces: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const access = await createInitializedTestKnowledgeSpaceAccess([]);
    const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8c01";
    await assets.create({
      filename: "incident.md",
      id: documentAssetId,
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/production/incident.md",
      sha256: "a".repeat(64),
      sizeBytes: 128,
    });
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "b".repeat(64),
        documentAssetId,
        endOffset: 62,
        id: expectedNodeId,
        kind: "chunk",
        knowledgeSpaceId,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c02",
        permissionScope: [],
        sourceLocation: { endOffset: 62, sectionPath: ["Release notes"], startOffset: 0 },
        startOffset: 0,
        text: "The answer missed the production incident rollback note.",
      }),
    ]);
    const evidenceBundle = EvidenceBundleSchema.parse({
      createdAt: "2026-05-13T13:59:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
      items: [
        {
          citations: [
            {
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c01",
              documentVersion: 2,
              sectionPath: ["Release notes"],
              startOffset: 10,
            },
          ],
          conflicts: [{ reason: "Stale answer", severity: "warning" }],
          freshness: { status: "stale" },
          metadata: { source: "retrieval" },
          nodeId: expectedNodeId,
          score: 0.42,
          scores: { final: 0.42, retrieval: 0.62 },
          text: "The answer missed the production incident rollback note.",
        },
      ],
      missingEvidence: [
        {
          expectedEvidenceId: missingNodeId,
          metadata: { source: "operator" },
          reason: "not-retrieved",
          text: "Rollback note was absent from top evidence.",
        },
      ],
      query: "What changed after the production incident?",
      state: "partial",
      traceId,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      answerTraces,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      goldenQuestions,
      knowledgeNodes: nodes,
      knowledgeSpaceAccess: access,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-13T13:58:00.000Z",
      }),
    });

    const createdSpace = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Production", slug: "production" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(createdSpace.status).toBe(201);
    const tracePermission = await access.createPermissionSnapshot({
      accessChannel: "interactive",
      expiresAt: "2099-01-01T00:00:00.000Z",
      knowledgeSpaceId,
      subjectId: writeSubject.subjectId,
      tenantId: writeSubject.tenantId,
    });
    await answerTraces.create(
      AnswerTraceSchema.parse({
        createdAt: "2026-05-13T13:59:30.000Z",
        evidenceBundleId: evidenceBundle.id,
        id: traceId,
        knowledgeSpaceId,
        mode: "deep",
        permissionSnapshot: {
          accessChannel: tracePermission.accessChannel,
          id: tracePermission.id,
          revision: tracePermission.revision,
        },
        query: "What changed after the production incident?",
        subjectId: writeSubject.subjectId,
        steps: [
          {
            metadata: { evidenceBundle },
            name: "evidence.bundle",
            startedAt: "2026-05-13T13:59:31.000Z",
            status: "ok",
          },
        ],
      }),
    );

    const unauthorized = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/production-bad-cases`,
      {
        body: JSON.stringify({ traceId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(unauthorized.status).toBe(401);

    const forbidden = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/production-bad-cases`,
      {
        body: JSON.stringify({ traceId }),
        headers: { ...bearer(readToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(forbidden.status).toBe(403);

    const captured = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/production-bad-cases`,
      {
        body: JSON.stringify({
          reason: "Missed rollback evidence",
          tags: ["incident-review"],
          traceId,
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(captured.status).toBe(201);
    await expect(captured.json()).resolves.toEqual({
      createdAt: "2026-05-13T14:00:00.000Z",
      expectedEvidenceIds: [expectedNodeId, missingNodeId],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a10",
      knowledgeSpaceId,
      metadata: {
        evidenceContext: {
          itemCount: 1,
          items: [
            {
              citationCount: 1,
              conflictCount: 1,
              freshnessStatus: "stale",
              nodeId: expectedNodeId,
              score: 0.42,
            },
          ],
          missingEvidence: [
            {
              expectedEvidenceId: missingNodeId,
              reason: "not-retrieved",
              text: "Rollback note was absent from top evidence.",
            },
          ],
          missingEvidenceCount: 1,
          state: "partial",
          truncated: false,
        },
        reason: "Missed rollback evidence",
        source: "production-bad-case",
        traceId,
      },
      question: "What changed after the production incident?",
      tags: ["production-bad-case", "needs-review", "incident-review"],
      updatedAt: "2026-05-13T14:00:00.000Z",
    });

    const queued = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions?limit=10`,
      { headers: bearer(readToken) },
    );
    expect(queued.status).toBe(200);
    await expect(queued.json()).resolves.toMatchObject({
      items: [
        {
          metadata: {
            source: "production-bad-case",
            traceId,
          },
          question: "What changed after the production incident?",
          tags: ["production-bad-case", "needs-review", "incident-review"],
        },
      ],
    });

    const hiddenAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8c03";
    await assets.create({
      filename: "restricted.md",
      id: hiddenAssetId,
      knowledgeSpaceId,
      metadata: { permissionScope: ["classification:restricted"] },
      mimeType: "text/markdown",
      objectKey: "tenant-1/production/restricted.md",
      sha256: "c".repeat(64),
      sizeBytes: 64,
    });
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "d".repeat(64),
        documentAssetId: hiddenAssetId,
        endOffset: 50,
        id: missingNodeId,
        kind: "chunk",
        knowledgeSpaceId,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c04",
        permissionScope: ["classification:restricted"],
        sourceLocation: { endOffset: 50, sectionPath: ["Restricted"], startOffset: 0 },
        startOffset: 0,
        text: "Restricted evidence must not enter a golden question.",
      }),
    ]);
    const hiddenEvidence = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/production-bad-cases`,
      {
        body: JSON.stringify({ traceId }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(hiddenEvidence.status).toBe(404);

    const crossTenant = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/production-bad-cases`,
      {
        body: JSON.stringify({ traceId }),
        headers: { ...bearer(otherTenantToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(crossTenant.status).toBe(404);

    const missingTrace = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/production-bad-cases`,
      {
        body: JSON.stringify({ traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02" }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(missingTrace.status).toBe(404);
  });

  it("captures no-evidence production bad cases with bounded empty context", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a03";
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3a11",
      maxListLimit: 10,
      maxQuestions: 10,
      now: () => "2026-05-13T14:05:00.000Z",
    });
    const answerTraces = createInMemoryAnswerTraceRepository({
      maxSteps: 10,
      maxTraces: 10,
    });
    const access = await createInitializedTestKnowledgeSpaceAccess([]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      answerTraces,
      auth: createTestAuthVerifier(),
      goldenQuestions,
      knowledgeSpaceAccess: access,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-13T14:04:00.000Z",
      }),
    });

    const createdSpace = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Production", slug: "production" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(createdSpace.status).toBe(201);
    const tracePermission = await access.createPermissionSnapshot({
      accessChannel: "interactive",
      expiresAt: "2099-01-01T00:00:00.000Z",
      knowledgeSpaceId,
      subjectId: writeSubject.subjectId,
      tenantId: writeSubject.tenantId,
    });
    await answerTraces.create(
      AnswerTraceSchema.parse({
        createdAt: "2026-05-13T14:04:30.000Z",
        id: traceId,
        knowledgeSpaceId,
        mode: "fast",
        permissionSnapshot: {
          accessChannel: tracePermission.accessChannel,
          id: tracePermission.id,
          revision: tracePermission.revision,
        },
        query: "Why did the answer say there was no evidence?",
        subjectId: writeSubject.subjectId,
        steps: [
          {
            metadata: { evidenceBundle: { invalid: true } },
            name: "evidence.bundle",
            startedAt: "2026-05-13T14:04:31.000Z",
            status: "skipped",
          },
        ],
      }),
    );
    const captured = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/production-bad-cases`,
      {
        body: JSON.stringify({ tags: ["needs-review", "no-answer"], traceId }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(captured.status).toBe(201);
    await expect(captured.json()).resolves.toMatchObject({
      expectedEvidenceIds: [],
      metadata: {
        evidenceContext: {
          itemCount: 0,
          items: [],
          missingEvidence: [],
          missingEvidenceCount: 0,
          state: "unknown",
          truncated: false,
        },
        source: "production-bad-case",
        traceId,
      },
      question: "Why did the answer say there was no evidence?",
      tags: ["production-bad-case", "needs-review", "no-answer"],
    });
  });

  it("serves tenant and knowledge-space retention policy configuration", async () => {
    const retentionPolicies = createInMemoryRetentionPolicyRepository({
      maxPolicies: 10,
      now: () => "2026-05-12T19:00:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      retentionPolicies,
    });

    const defaultTenant = await app.request("/retention-policy", {
      headers: bearer(readToken),
    });
    expect(defaultTenant.status).toBe(200);
    await expect(defaultTenant.json()).resolves.toMatchObject({
      answerTraceRetentionDays: 90,
      evidenceCacheRetentionDays: 7,
      inactiveProjectionRetentionDays: 30,
      knowledgeSpaceId: null,
      parseArtifactVersions: 3,
      rawDocumentRetentionDays: null,
      scope: "tenant",
      sessionInactivityMinutes: 30,
      tenantId: "tenant-1",
    });

    const writeOnlyRead = await app.request("/retention-policy", {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnlyRead.status).toBe(403);

    const updatedTenant = await app.request("/retention-policy", {
      body: JSON.stringify({
        answerTraceRetentionDays: 45,
        sessionInactivityMinutes: 60,
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updatedTenant.status).toBe(200);
    await expect(updatedTenant.json()).resolves.toMatchObject({
      answerTraceRetentionDays: 45,
      scope: "tenant",
      sessionInactivityMinutes: 60,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Retention", slug: "retention" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const updatedSpace = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/retention-policy",
      {
        body: JSON.stringify({
          parseArtifactVersions: 5,
          rawDocumentRetentionDays: 365,
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(updatedSpace.status).toBe(200);
    await expect(updatedSpace.json()).resolves.toMatchObject({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      parseArtifactVersions: 5,
      rawDocumentRetentionDays: 365,
      scope: "knowledge_space",
      tenantId: "tenant-1",
    });

    const crossTenantSpace = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/retention-policy",
      {
        headers: bearer(otherTenantToken),
      },
    );
    expect(crossTenantSpace.status).toBe(404);

    await expect(
      retentionPolicies.update({
        patch: { parseArtifactVersions: 0 },
        scope: { tenantId: "tenant-1" },
      }),
    ).rejects.toThrow("Retention policy parseArtifactVersions must be at least 1");
  });

  it("enqueues and processes bounded knowledge-space retention cleanup jobs", async () => {
    const queue = new RecordingUpgradeQueue();
    const retentionPolicies = createInMemoryRetentionPolicyRepository({
      maxPolicies: 10,
      now: () => "2026-05-12T19:00:00.000Z",
    });
    const answerTraces = createInMemoryAnswerTraceRepository({ maxSteps: 4, maxTraces: 4 });
    const indexProjections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 4,
    });
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const worker = createKnowledgeSpaceRetentionCleanupWorker({
      answerTraces,
      indexProjections,
      jobs: queue,
      maxProjectionDeletes: 4,
      maxTraceDeletes: 4,
      now: () => "2026-05-12T19:00:00.000Z",
      projectionRetainVersions: 1,
      retentionPolicies,
    });

    await retentionPolicies.update({
      patch: { answerTraceRetentionDays: 2 },
      scope: { knowledgeSpaceId, tenantId: "tenant-1" },
    });
    await answerTraces.create({
      createdAt: "2026-05-09T23:59:59.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e01",
      knowledgeSpaceId,
      mode: "auto",
      query: "old trace",
      steps: [],
    });
    await answerTraces.create({
      createdAt: "2026-05-11T00:00:01.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e02",
      knowledgeSpaceId,
      mode: "auto",
      query: "recent trace",
      steps: [],
    });
    const readyProjection = IndexProjectionSchema.parse({
      denseVector: [0.1, 0.2],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8e01",
      knowledgeSpaceId,
      metadata: {},
      model: "static@1",
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6e01",
      projectionVersion: 3,
      status: "ready",
      type: "dense-vector",
    });
    const staleProjection = IndexProjectionSchema.parse({
      ...readyProjection,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8e02",
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6e02",
      projectionVersion: 2,
      status: "stale",
    });
    await indexProjections.createMany([readyProjection, staleProjection]);

    await expect(worker.enqueue({ knowledgeSpaceId, tenantId: "tenant-1" })).resolves.toMatchObject(
      { id: "upgrade-queue-1" },
    );
    expect(queue.enqueued).toEqual([
      {
        idempotencyKey: `retention.cleanup.knowledge-space:tenant-1:${knowledgeSpaceId}`,
        payload: {
          knowledgeSpaceId,
          maxProjectionDeletes: 4,
          maxTraceDeletes: 4,
          projectionRetainVersions: 1,
          requestedAt: "2026-05-12T19:00:00.000Z",
          tenantId: "tenant-1",
        },
        type: "retention.cleanup.knowledge-space",
      },
    ]);

    await expect(
      worker.process({
        knowledgeSpaceId,
        maxProjectionDeletes: 4,
        maxTraceDeletes: 4,
        projectionRetainVersions: 1,
        requestedAt: "2026-05-12T00:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      answerTraceOlderThan: "2026-05-10T00:00:00.000Z",
      answerTracesDeleted: 1,
      denseVectorProjectionsDeleted: 1,
      ftsProjectionsDeleted: 0,
      knowledgeSpaceId,
      sessionTtlMinutes: 30,
      tenantId: "tenant-1",
    });
    await expect(answerTraces.getById("018f0d60-7a49-7cc2-9c1b-5b36f18f7e01")).resolves.toBeNull();
    await expect(
      answerTraces.getById("018f0d60-7a49-7cc2-9c1b-5b36f18f7e02"),
    ).resolves.toMatchObject({ query: "recent trace" });
    await expect(
      indexProjections.listReadyBySpace({
        knowledgeSpaceId,
        limit: 10,
        type: "dense-vector",
      }),
    ).resolves.toEqual({ items: [readyProjection] });
    await expect(
      worker.process({
        knowledgeSpaceId,
        maxProjectionDeletes: 5,
        maxTraceDeletes: 4,
        projectionRetainVersions: 1,
        requestedAt: "2026-05-12T00:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Retention cleanup maxProjectionDeletes exceeds maxProjectionDeletes=4");
    await expect(
      worker.process({
        knowledgeSpaceId,
        maxProjectionDeletes: 4,
        maxTraceDeletes: 5,
        projectionRetainVersions: 1,
        requestedAt: "2026-05-12T00:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Retention cleanup maxTraceDeletes exceeds maxTraceDeletes=4");
    await expect(
      worker.process({
        knowledgeSpaceId,
        maxProjectionDeletes: 4,
        maxTraceDeletes: 4,
        projectionRetainVersions: 2,
        requestedAt: "2026-05-12T00:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow(
      "Retention cleanup projectionRetainVersions exceeds projectionRetainVersions=1",
    );
    await expect(
      worker.process({
        knowledgeSpaceId,
        maxProjectionDeletes: 4,
        maxTraceDeletes: 4,
        projectionRetainVersions: 1,
        requestedAt: "not-a-date",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Retention cleanup requestedAt must be a valid timestamp");
    await expect(worker.process(null as never)).rejects.toThrow(
      "Retention cleanup payload is invalid",
    );
    await expect(
      worker.process({
        knowledgeSpaceId,
        maxProjectionDeletes: 4,
        maxTraceDeletes: 0,
        projectionRetainVersions: 1,
        requestedAt: "2026-05-12T00:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Retention cleanup maxTraceDeletes must be at least 1");
    await expect(worker.enqueue({ knowledgeSpaceId, tenantId: " " })).rejects.toThrow(
      "Retention cleanup tenantId is required",
    );
    await expect(worker.enqueue({ knowledgeSpaceId: " ", tenantId: "tenant-1" })).rejects.toThrow(
      "Retention cleanup knowledgeSpaceId is required",
    );
    expect(() =>
      createKnowledgeSpaceRetentionCleanupWorker({
        answerTraces,
        indexProjections,
        jobs: queue,
        maxProjectionDeletes: 4,
        maxTraceDeletes: 0,
        retentionPolicies,
      }),
    ).toThrow("Retention cleanup maxTraceDeletes must be at least 1");
    expect(() =>
      createKnowledgeSpaceRetentionCleanupWorker({
        answerTraces,
        indexProjections,
        jobs: queue,
        maxProjectionDeletes: 0,
        maxTraceDeletes: 4,
        retentionPolicies,
      }),
    ).toThrow("Retention cleanup maxProjectionDeletes must be at least 1");
    expect(() =>
      createKnowledgeSpaceRetentionCleanupWorker({
        answerTraces,
        indexProjections,
        jobs: queue,
        maxProjectionDeletes: 4,
        maxTraceDeletes: 4,
        projectionRetainVersions: 0,
        retentionPolicies,
      }),
    ).toThrow("Retention cleanup projectionRetainVersions must be at least 1");
  });

  it("creates, reads, and cancels tenant-scoped research tasks", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T14:00:00.000Z",
    });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: adapter.jobs,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      researchTasks,
    });

    const unauthorized = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Research semantic retrieval regressions",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Research", slug: "research" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const readOnlyCreate = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Research semantic retrieval regressions",
      }),
      headers: { ...bearer(readToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(readOnlyCreate.status).toBe(403);

    const created = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        metadata: { mode: "deep" },
        budgetUsd: 0.5,
        query: "Research semantic retrieval regressions",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const createdResearchTask = (await created.json()) as Record<string, unknown>;
    expect(createdResearchTask).toMatchObject({
      id: "research-task-job-1",
      budgetUsd: 0.5,
      cost: { budgetUsd: 0.5, entries: [], totalUsd: 0 },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { mode: "deep" },
      query: "Research semantic retrieval regressions",
      stage: "queued",
    });
    expect(createdResearchTask).not.toHaveProperty("permissionSnapshot");
    expect(createdResearchTask).not.toHaveProperty("subjectId");
    expect(createdResearchTask).not.toHaveProperty("tenantId");

    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      payload: { researchTaskJobId: "research-task-job-1" },
      status: "queued",
      type: "research.task",
    });

    const status = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(readToken),
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      id: "research-task-job-1",
      stage: "queued",
    });

    const writeOnlyStatus = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnlyStatus.status).toBe(403);

    const crossTenantStatus = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(otherTenantToken),
    });
    expect(crossTenantStatus.status).toBe(404);

    const readOnlyCancel = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(readToken),
      method: "DELETE",
    });
    expect(readOnlyCancel.status).toBe(403);

    const cancel = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(writeToken),
      method: "DELETE",
    });
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toMatchObject({
      id: "research-task-job-1",
      stage: "canceled",
    });
    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      status: "canceled",
    });

    const cancelAgain = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(writeToken),
      method: "DELETE",
    });
    expect(cancelAgain.status).toBe(409);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths["/research-tasks"]?.post).toBeDefined();
    expect(spec.paths["/research-tasks/{id}"]?.get).toBeDefined();
    expect(spec.paths["/research-tasks/{id}"]?.delete).toBeDefined();
  });

  it("enforces research task launch limits before queue enqueue", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T15:15:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      researchTaskPlanner: createResearchTaskDryRunPlanner({
        retrievalPlanner: createRetrievalPlanner({ maxTopK: 100 }),
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Research limits", slug: "research-limits" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const rejected = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limits: {
          maxRetrievalSteps: 1,
          maxScannedResources: 1,
          maxToolCalls: 1,
          timeoutMs: 1,
        },
        mode: "research",
        query: "Research semantic retrieval regressions",
        topK: 5,
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: "Research task limits exceeded",
      violations: [
        { limit: "timeoutMs" },
        { limit: "maxRetrievalSteps" },
        { limit: "maxScannedResources" },
        { limit: "maxToolCalls" },
      ],
    });
    await expect(adapter.jobs.stats()).resolves.toMatchObject({ queued: 0 });

    const accepted = await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limits: {
          maxRetrievalSteps: 10,
          maxScannedResources: 100,
          maxToolCalls: 10,
          timeoutMs: 10_000,
        },
        mode: "research",
        query: "Research semantic retrieval regressions",
        topK: 5,
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(accepted.status).toBe(201);
    await expect(accepted.json()).resolves.toMatchObject({
      limits: {
        maxRetrievalSteps: 10,
        maxScannedResources: 100,
        maxToolCalls: 10,
        timeoutMs: 10_000,
      },
      stage: "queued",
    });
  });

  it("plans research tasks without enqueueing durable work", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T15:00:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      researchTaskPlanner: createResearchTaskDryRunPlanner({
        retrievalPlanner: createRetrievalPlanner({ maxTopK: 100 }),
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Research planning", slug: "research-planning" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const unauthorized = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Plan a research comparison",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const writeOnly = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Plan a research comparison",
      }),
      headers: { ...bearer(writeOnlyToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(writeOnly.status).toBe(403);

    const planned = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        budgetUsd: 0.25,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mode: "research",
        query: "Plan a research comparison",
        topK: 5,
      }),
      headers: { ...bearer(readToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(planned.status).toBe(200);
    await expect(planned.json()).resolves.toMatchObject({
      budget: { budgetUsd: 0.25, exceedsBudget: false },
      estimates: {
        cacheHitProbability: expect.any(Number),
        scannedResources: expect.any(Number),
        toolCalls: expect.any(Number),
      },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      retrievalPlan: {
        requestedMode: "research",
        resolvedMode: "research",
        topK: 5,
      },
      strategyVersion: "research-dry-run-planner-v1",
    });
    await expect(adapter.jobs.stats()).resolves.toMatchObject({ queued: 0 });

    const crossTenant = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Plan a research comparison",
      }),
      headers: { ...bearer(otherTenantToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(crossTenant.status).toBe(404);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths["/research-tasks/plan"]?.post).toBeDefined();
  });

  it("serves research task partial evidence during and after cancellation", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T14:30:00.000Z",
    });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: adapter.jobs,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const researchTaskPartials = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 2,
      maxResults: 10,
    });
    const evidenceAssets = await createInitializedTestDocumentAssets(
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f6b01"],
    );
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      documentAssets: evidenceAssets,
      knowledgeSpaces: spaces,
      researchTaskPartials,
      researchTasks,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Research partials", slug: "research-partials" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Collect partial evidence",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await researchTaskPartials.append({
      evidenceBundle: gatewayEvidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a01", "first"),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });
    await researchTaskPartials.append({
      evidenceBundle: gatewayEvidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a02", "second"),
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });

    const firstPage = await app.request("/research-tasks/research-task-job-1/partials?limit=1", {
      headers: bearer(readToken),
    });
    expect(firstPage.status).toBe(200);
    await expect(firstPage.json()).resolves.toMatchObject({
      items: [
        {
          evidenceBundle: {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a01",
            items: [{ text: "first" }],
          },
          sequence: 1,
        },
      ],
      nextCursor: "1",
    });

    const cancel = await app.request("/research-tasks/research-task-job-1", {
      headers: bearer(writeToken),
      method: "DELETE",
    });
    expect(cancel.status).toBe(200);

    const afterCancel = await app.request(
      "/research-tasks/research-task-job-1/partials?limit=2&cursor=1",
      {
        headers: bearer(readToken),
      },
    );
    expect(afterCancel.status).toBe(200);
    await expect(afterCancel.json()).resolves.toMatchObject({
      items: [
        {
          evidenceBundle: {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a02",
            items: [{ text: "second" }],
          },
          sequence: 2,
        },
      ],
    });

    await expect(
      rollbackInitializedTestDocumentAsset(
        evidenceAssets,
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
      ),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01" });
    const hiddenPartials = await app.request(
      "/research-tasks/research-task-job-1/partials?limit=2",
      { headers: bearer(readToken) },
    );
    expect(hiddenPartials.status).toBe(200);
    await expect(hiddenPartials.json()).resolves.toMatchObject({ items: [] });

    const writeOnly = await app.request("/research-tasks/research-task-job-1/partials?limit=1", {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnly.status).toBe(403);

    const crossTenant = await app.request("/research-tasks/research-task-job-1/partials?limit=1", {
      headers: bearer(otherTenantToken),
    });
    expect(crossTenant.status).toBe(404);

    const missing = await app.request("/research-tasks/missing/partials?limit=1", {
      headers: bearer(readToken),
    });
    expect(missing.status).toBe(404);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths["/research-tasks/{id}/partials"]?.get).toBeDefined();
  });

  it("streams tenant-scoped research task progress events", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T14:45:00.000Z",
    });
    const researchTaskProgress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 2,
      maxSubscribers: 2,
      now: () => "2026-05-12T14:45:01.000Z",
    });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: adapter.jobs,
      now: () => 2_000,
      progress: createResearchTaskProgressPublisher({ repository: researchTaskProgress }),
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const app = createKnowledgeGateway({
      adapter,
      allowLegacyResearchTaskProfileFallback: true,
      auth: createTestAuthVerifier(),
      knowledgeSpaces: spaces,
      researchTaskProgress,
      researchTasks,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Research progress", slug: "research-progress" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await app.request("/research-tasks", {
      body: JSON.stringify({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "Stream progress events",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const unauthorized = await app.request("/research-tasks/research-task-job-1/events?limit=1");
    expect(unauthorized.status).toBe(401);

    const writeOnly = await app.request("/research-tasks/research-task-job-1/events?limit=1", {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnly.status).toBe(403);

    const crossTenant = await app.request("/research-tasks/research-task-job-1/events?limit=1", {
      headers: bearer(otherTenantToken),
    });
    expect(crossTenant.status).toBe(404);

    const stream = await app.request("/research-tasks/research-task-job-1/events?limit=1", {
      headers: bearer(readToken),
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    const reader = stream.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunk = await reader?.read();
    await reader?.cancel();

    const text = new TextDecoder().decode(firstChunk?.value);
    expect(text).toContain("event: research_task.progress");
    expect(text).toContain('"researchTaskJobId":"research-task-job-1"');
    expect(text).toContain('"sequence":1');
    expect(text).toContain('"type":"research_task.started"');
    expect(text).not.toContain("tenant-1");

    const liveStreamPromise = app.request("/research-tasks/research-task-job-1/events?limit=2", {
      headers: bearer(readToken),
    });
    setTimeout(() => {
      void researchTaskProgress.append({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        payload: { previousStage: "queued" },
        researchTaskJobId: "research-task-job-1",
        stage: "planning",
        tenantId: "tenant-1",
        type: "research_task.stage_changed",
      });
    }, 10);
    const liveStream = await liveStreamPromise;
    expect(liveStream.status).toBe(200);
    const liveText = await liveStream.text();
    expect(liveText).toContain('"type":"research_task.started"');
    expect(liveText).toContain('"type":"research_task.stage_changed"');
    expect(liveText).toContain('"sequence":2');

    const missing = await app.request("/research-tasks/missing/events?limit=1", {
      headers: bearer(readToken),
    });
    expect(missing.status).toBe(404);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths["/research-tasks/{id}/events"]?.get).toBeDefined();
  });

  it("creates and reads tenant-scoped agent workspace snapshots", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T16:20:00.000Z",
    });
    const evidenceAssets = await createInitializedTestDocumentAssets(
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f6b01"],
    );
    const app = createKnowledgeGateway({
      adapter,
      agentWorkspaceSnapshots: createInMemoryAgentWorkspaceSnapshotRepository({
        maxCommandLogEntries: 4,
        maxEvidenceBundles: 2,
        maxMounts: 2,
        maxSnapshots: 4,
        maxSourceVersions: 2,
        now: () => "2026-05-12T16:21:00.000Z",
      }),
      auth: createTestAuthVerifier(),
      documentAssets: evidenceAssets,
      generateAgentWorkspaceSnapshotId: () => "agent-workspace-snapshot-1",
      knowledgeSpaces: spaces,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Workspace Snapshots", slug: "workspace-snapshots" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const unauthorized = await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify(workspaceSnapshotRequestBody()),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const readOnlyCreate = await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify(workspaceSnapshotRequestBody()),
      headers: { ...bearer(readToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(readOnlyCreate.status).toBe(403);

    const created = await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify(workspaceSnapshotRequestBody()),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const createdSnapshot = (await created.json()) as Record<string, unknown>;
    expect(createdSnapshot).toMatchObject({
      createdAt: "2026-05-12T16:21:00.000Z",
      id: "agent-workspace-snapshot-1",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    });
    expect(createdSnapshot).not.toHaveProperty("permissionSnapshot");
    expect(createdSnapshot).not.toHaveProperty("tenantId");

    const rejectedTenantOverride = await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify({
        ...workspaceSnapshotRequestBody(),
        permissionSnapshot: { scopes: ["malicious"], subjectId: "evil", tenantId: "evil" },
        tenantId: "malicious-tenant",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(rejectedTenantOverride.status).toBe(400);

    const fetched = await app.request("/agent-workspace-snapshots/agent-workspace-snapshot-1", {
      headers: bearer(readToken),
    });
    expect(fetched.status).toBe(200);
    const fetchedSnapshot = (await fetched.json()) as Record<string, unknown>;
    expect(fetchedSnapshot).toMatchObject({
      commandLog: [{ command: "ls /knowledge/docs --limit 2" }],
      id: "agent-workspace-snapshot-1",
      mounts: [{ mountPath: "/sources/uploads" }],
      sourceVersions: [{ providerResourceKey: "tenant-1/uploads/a.md" }],
    });
    expect(fetchedSnapshot).not.toHaveProperty("permissionSnapshot");

    const writeOnlyRead = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1",
      {
        headers: bearer(writeOnlyToken),
      },
    );
    expect(writeOnlyRead.status).toBe(403);

    const crossTenantRead = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1",
      {
        headers: bearer(otherTenantToken),
      },
    );
    expect(crossTenantRead.status).toBe(404);

    await expect(
      rollbackInitializedTestDocumentAsset(
        evidenceAssets,
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
      ),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01" });

    const hiddenSnapshot = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1",
      { headers: bearer(readToken) },
    );
    expect(hiddenSnapshot.status).toBe(404);

    const inactiveEvidenceCreate = await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify(workspaceSnapshotRequestBody()),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(inactiveEvidenceCreate.status).toBe(409);

    const missingSpace = await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify({
        ...workspaceSnapshotRequestBody(),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(missingSpace.status).toBe(404);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths["/agent-workspace-snapshots"]?.post).toBeDefined();
    expect(spec.paths["/agent-workspace-snapshots/{id}"]?.get).toBeDefined();
  });

  it("replays tenant-scoped agent workspace snapshots and compares command output", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const snapshots = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 4,
      maxEvidenceBundles: 2,
      maxMounts: 2,
      maxSnapshots: 4,
      maxSourceVersions: 2,
      now: () => "2026-05-12T16:21:00.000Z",
    });
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T16:20:00.000Z",
    });
    const evidenceAssets = await createInitializedTestDocumentAssets(
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f6b01"],
    );
    const app = createKnowledgeGateway({
      adapter,
      agentWorkspaceReplay: createAgentWorkspaceReplayService({
        generateId: () => "agent-workspace-replay-1",
        maxCommands: 4,
        maxOutputSummaryBytes: 128,
        now: () => "2026-05-12T16:22:00.000Z",
        runner: {
          run: async ({ command, commandIndex, traceId }) => ({
            outputSummary:
              commandIndex === 0
                ? command.outputSummary
                : `changed:${command.command}:${traceId ?? "no-trace"}`,
          }),
        },
        snapshots,
      }),
      agentWorkspaceSnapshots: snapshots,
      auth: createTestAuthVerifier(),
      documentAssets: evidenceAssets,
      generateAgentWorkspaceSnapshotId: () => "agent-workspace-snapshot-1",
      knowledgeSpaces: spaces,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Workspace Replay", slug: "workspace-replay" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify({
        ...workspaceSnapshotRequestBody(),
        commandLog: [
          ...workspaceSnapshotRequestBody().commandLog,
          {
            command: "cat /knowledge/docs/a.md",
            input: { path: "/knowledge/docs/a.md" },
            outputSummary: "old body",
            startedAt: "2026-05-12T16:19:03.000Z",
          },
        ],
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const unauthorized = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1/replay",
      { method: "POST" },
    );
    expect(unauthorized.status).toBe(401);

    const writeOnly = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1/replay",
      { headers: bearer(writeOnlyToken), method: "POST" },
    );
    expect(writeOnly.status).toBe(403);

    const replayed = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1/replay",
      {
        headers: { ...bearer(readToken), "x-trace-id": "018f0d60-7a49-7cc2-9c1b-5b36f18f6e22" },
        method: "POST",
      },
    );
    expect(replayed.status).toBe(200);
    expect(replayed.headers.get("x-trace-id")).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f6e22");
    await expect(replayed.json()).resolves.toMatchObject({
      commands: [
        { command: "ls /knowledge/docs --limit 2", status: "matched" },
        {
          originalOutputSummary: "old body",
          replayedOutputSummary:
            "changed:cat /knowledge/docs/a.md:018f0d60-7a49-7cc2-9c1b-5b36f18f6e22",
          status: "changed",
        },
      ],
      id: "agent-workspace-replay-1",
      snapshotId: "agent-workspace-snapshot-1",
      summary: { changed: 1, failed: 0, matched: 1, total: 2 },
    });

    const crossTenant = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1/replay",
      { headers: bearer(otherTenantToken), method: "POST" },
    );
    expect(crossTenant.status).toBe(404);

    await expect(
      rollbackInitializedTestDocumentAsset(
        evidenceAssets,
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
      ),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01" });
    const hiddenReplay = await app.request(
      "/agent-workspace-snapshots/agent-workspace-snapshot-1/replay",
      { headers: bearer(readToken), method: "POST" },
    );
    expect(hiddenReplay.status).toBe(404);

    const openapi = await app.request("/openapi.json");
    const spec = (await openapi.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths["/agent-workspace-snapshots/{id}/replay"]?.post).toBeDefined();
  });

  it("processes durable document compilation jobs through parse and incremental reindex", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-12T13:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Worker.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Worker.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Worker"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `document-compilation-job-${next++}`;
      })(),
      jobs: adapter.jobs,
      now: (() => {
        let tick = 1_000;
        return () => {
          tick += 1_000;
          return tick;
        };
      })(),
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 4 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const reindexCalls: unknown[] = [];
    const parser = createRecordingParser();
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 4,
      }),
      objectStorage: adapter.objectStorage,
      parser: parser.parser,
      reindexer: {
        reindex: async (input) => {
          reindexCalls.push(input);
          return {
            artifact: input.parseArtifact,
            nodesCreated: 1,
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).resolves.toMatchObject({
      id: compilationJob.id,
      stage: "published",
    });
    expect(parser.calls).toHaveLength(1);
    expect(parser.calls[0]).toMatchObject({
      documentAssetId: asset.id,
      filename: "Worker.md",
      mimeType: "text/markdown",
      version: 1,
    });
    expect(reindexCalls).toEqual([
      expect.objectContaining({
        knowledgeSpaceId: asset.knowledgeSpaceId,
        parseArtifact: expect.objectContaining({ documentAssetId: asset.id }),
        projectionStatus: "ready",
        projectionVersion: 1,
      }),
    ]);
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({
      parserStatus: "parsed",
    });

    const failingAsset = await assets.create({
      filename: "Broken.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      knowledgeSpaceId: asset.knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Broken.md",
      sha256: "b".repeat(64),
      sizeBytes: 6,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("broken"),
      contentType: failingAsset.mimeType,
      key: failingAsset.objectKey,
      metadata: {},
    });
    const failingJob = await compilationJobs.start({
      documentAssetId: failingAsset.id,
      knowledgeSpaceId: failingAsset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: failingAsset.version,
    });
    const failingWorker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 4,
      }),
      objectStorage: adapter.objectStorage,
      parser: createRecordingParser({ fail: true }).parser,
      reindexer: {
        reindex: async () => {
          throw new Error("should not reindex failed parser output");
        },
      },
    });

    await expect(
      failingWorker.process({
        documentAssetId: failingAsset.id,
        documentCompilationJobId: failingJob.id,
        knowledgeSpaceId: failingAsset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: failingAsset.version,
      }),
    ).rejects.toThrow("parser failed");
    await expect(
      assets.get({ id: failingAsset.id, knowledgeSpaceId: failingAsset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "failed" });
    await expect(compilationJobs.get(failingJob.id)).resolves.toMatchObject({
      error: "parser failed",
      stage: "failed",
    });
  });

  it("blocks durable document compilation publication when smoke evaluation fails", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-12T14:00:00.000Z",
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `document-compilation-job-${next++}`;
      })(),
      jobs: adapter.jobs,
      now: (() => {
        let tick = 1_000;
        return () => {
          tick += 1_000;
          return tick;
        };
      })(),
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 4 }),
    });
    const createAsset = async (id: string, filename: string) => {
      const asset = await assets.create({
        filename,
        id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mimeType: "text/markdown",
        objectKey: `tenant-1/spaces/space/documents/${id}/${filename}`,
        sha256: "d".repeat(64),
        sizeBytes: 12,
      });
      await adapter.objectStorage.putObject({
        body: new TextEncoder().encode("# Smoke"),
        contentType: asset.mimeType,
        key: asset.objectKey,
        metadata: {},
      });
      return asset;
    };
    const passingAsset = await createAsset("018f0d60-7a49-7cc2-9c1b-5b36f18f2d01", "Passing.md");
    const passingJob = await compilationJobs.start({
      documentAssetId: passingAsset.id,
      knowledgeSpaceId: passingAsset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: passingAsset.version,
    });
    const evaluationCalls: unknown[] = [];
    const smokeEvaluation = createIngestionSmokeEvaluationGate({
      evaluation: {
        run: async (input) => {
          evaluationCalls.push(input);
          return retrievalEvaluationReport({
            citationHitRate: 0.95,
            noAnswerRate: 0.05,
            recallAtK: 0.9,
            totalQuestions: 10,
          });
        },
      },
      limit: 5,
      thresholds: {
        maxNoAnswerRate: 0.1,
        minCitationHitRate: 0.8,
        minRecallAtK: 0.8,
      },
      topK: 3,
    });
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 4,
      }),
      objectStorage: adapter.objectStorage,
      parser: createRecordingParser().parser,
      reindexer: {
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 1,
          projectionsCreated: 1,
          status: "rebuilt",
        }),
      },
      smokeEvaluation,
    });

    await expect(
      worker.process({
        documentAssetId: passingAsset.id,
        documentCompilationJobId: passingJob.id,
        knowledgeSpaceId: passingAsset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: passingAsset.version,
      }),
    ).resolves.toMatchObject({
      id: passingJob.id,
      stage: "published",
    });
    expect(evaluationCalls).toEqual([
      {
        knowledgeSpaceId: passingAsset.knowledgeSpaceId,
        limit: 5,
        topK: 3,
      },
    ]);

    const failingAsset = await createAsset("018f0d60-7a49-7cc2-9c1b-5b36f18f2d02", "Failing.md");
    const failingJob = await compilationJobs.start({
      documentAssetId: failingAsset.id,
      knowledgeSpaceId: failingAsset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: failingAsset.version,
    });
    const failingWorker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 4,
      }),
      objectStorage: adapter.objectStorage,
      parser: createRecordingParser().parser,
      reindexer: {
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 1,
          projectionsCreated: 1,
          status: "rebuilt",
        }),
      },
      smokeEvaluation: createIngestionSmokeEvaluationGate({
        evaluation: {
          run: async () =>
            retrievalEvaluationReport({
              citationHitRate: 0.7,
              noAnswerRate: 0.2,
              recallAtK: 0.6,
              totalQuestions: 10,
            }),
        },
        limit: 5,
        thresholds: {
          maxNoAnswerRate: 0.1,
          minCitationHitRate: 0.8,
          minRecallAtK: 0.8,
        },
        topK: 3,
      }),
    });

    await expect(
      failingWorker.process({
        documentAssetId: failingAsset.id,
        documentCompilationJobId: failingJob.id,
        knowledgeSpaceId: failingAsset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: failingAsset.version,
      }),
    ).rejects.toThrow(
      "Document compilation smoke evaluation failed: recallAtK 0.6 < 0.8; citationHitRate 0.7 < 0.8; noAnswerRate 0.2 > 0.1",
    );
    await expect(
      assets.get({ id: failingAsset.id, knowledgeSpaceId: failingAsset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "failed" });
    await expect(compilationJobs.get(failingJob.id)).resolves.toMatchObject({
      error:
        "Document compilation smoke evaluation failed: recallAtK 0.6 < 0.8; citationHitRate 0.7 < 0.8; noAnswerRate 0.2 > 0.1",
      stage: "failed",
    });

    expect(() =>
      createIngestionSmokeEvaluationGate({
        evaluation: { run: async () => retrievalEvaluationReport() },
        limit: 0,
        thresholds: {
          maxNoAnswerRate: 0.1,
          minCitationHitRate: 0.8,
          minRecallAtK: 0.8,
        },
        topK: 3,
      }),
    ).toThrow("Ingestion smoke evaluation limit must be at least 1");
    expect(() =>
      createIngestionSmokeEvaluationGate({
        evaluation: { run: async () => retrievalEvaluationReport() },
        limit: 1,
        thresholds: {
          maxNoAnswerRate: 0.1,
          minCitationHitRate: 0.8,
          minRecallAtK: 0.8,
        },
        topK: 0,
      }),
    ).toThrow("Ingestion smoke evaluation topK must be at least 1");
    expect(() =>
      createIngestionSmokeEvaluationGate({
        evaluation: { run: async () => retrievalEvaluationReport() },
        limit: 1,
        thresholds: {
          maxNoAnswerRate: 1.1,
          minCitationHitRate: 0.8,
          minRecallAtK: 0.8,
        },
        topK: 1,
      }),
    ).toThrow("Ingestion smoke evaluation threshold maxNoAnswerRate must be between 0 and 1");
    await expect(
      smokeEvaluation.evaluate({
        knowledgeSpaceId: " ",
      }),
    ).rejects.toThrow("Ingestion smoke evaluation knowledgeSpaceId is required");
  });

  it("protects and tenant-scopes document asset and parse artifact reads", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
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
      parser: createRecordingParser().parser,
    });
    const documentPath =
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
    const artifactPath = `${documentPath}/parse-artifacts/1`;

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "Read.md", { type: "text/markdown" }));
    expect(
      (
        await app.request("/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents", {
          body: form,
          headers: bearer(writeToken),
          method: "POST",
        })
      ).status,
    ).toBe(201);

    expect((await app.request(documentPath)).status).toBe(401);
    expect((await app.request(artifactPath)).status).toBe(401);
    expect((await app.request(documentPath, { headers: bearer(otherTenantToken) })).status).toBe(
      404,
    );
    expect((await app.request(artifactPath, { headers: bearer(otherTenantToken) })).status).toBe(
      404,
    );
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/parse-artifacts/1",
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/parse-artifacts/2",
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(404);

    const forbiddenApp = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        token: "write-only-token",
        subject: {
          scopes: ["knowledge-spaces:write"],
          subjectId: "user-1",
          tenantId: "tenant-1",
        },
      }),
    });
    expect(
      (await forbiddenApp.request(documentPath, { headers: bearer("write-only-token") })).status,
    ).toBe(403);
  });

  it("rejects unauthorized, invalid, oversized, and cross-tenant document uploads", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: createInMemoryDocumentAssetRepository({
        maxAssets: 10,
      }),
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      maxUploadBytes: 3,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const missingToken = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      { method: "POST" },
    );
    expect(missingToken.status).toBe(401);

    const missingScope = new FormData();
    missingScope.set("file", new File([new Uint8Array([1])], "note.txt"));
    const forbidden = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: missingScope,
        headers: bearer(readToken),
        method: "POST",
      },
    );
    expect(forbidden.status).toBe(403);

    const emptyForm = new FormData();
    const invalid = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: emptyForm,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(invalid.status).toBe(400);

    const invalidMultipart = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: "not multipart",
        headers: { ...bearer(writeToken), "content-type": "multipart/form-data; boundary=bad" },
        method: "POST",
      },
    );
    expect(invalidMultipart.status).toBe(400);

    const invalidSource = new FormData();
    invalidSource.set("sourceId", "not-a-uuid");
    invalidSource.set("file", new File([new Uint8Array([1])], "note.txt"));
    const invalidSourceId = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: invalidSource,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(invalidSourceId.status).toBe(400);

    const tooLarge = new FormData();
    tooLarge.set("file", new File([new Uint8Array([1, 2, 3, 4])], "large.txt"));
    const oversized = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: tooLarge,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(oversized.status).toBe(413);
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/",
      }),
    ).resolves.toEqual({ objects: [] });

    const otherTenantForm = new FormData();
    otherTenantForm.set("file", new File([new Uint8Array([1])], "note.txt"));
    const crossTenant = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: otherTenantForm,
        headers: bearer(otherTenantToken),
        method: "POST",
      },
    );
    expect(crossTenant.status).toBe(404);
  });

  it("rejects document uploads that would exceed a configured storage quota", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    await assets.create({
      filename: "Existing.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey:
        "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/existing/existing.md",
      sha256: "e".repeat(64),
      sizeBytes: 2,
    });
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
      storageQuotas: createStaticStorageQuotaRepository({ maxRawDocumentBytes: 3 }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "quota.md", { type: "text/markdown" }));
    const response = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Storage quota exceeded" });
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/",
      }),
    ).resolves.toEqual({ objects: [] });
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toBeNull();
  });

  it("bounds the default document asset repository capacity", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: createInMemoryDocumentAssetRepository({
        maxAssets: 1,
        now: () => "2026-05-09T11:00:00.000Z",
      }),
      generateDocumentAssetId: (() => {
        let nextId = 0;
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        ];

        return () => ids[nextId++] ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
      })(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const firstForm = new FormData();
    firstForm.set("file", new File([new Uint8Array([1])], "one.md", { type: "text/markdown" }));
    const first = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: firstForm,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(first.status).toBe(201);

    const secondForm = new FormData();
    secondForm.set("file", new File([new Uint8Array([2])], "two.md", { type: "text/markdown" }));
    const second = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: secondForm,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(second.status).toBe(429);
  });

  it("cleans up uploaded objects when document asset persistence fails", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const traces = createInMemoryTraceRecorder();
    const deletedKeys: string[] = [];
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        deleteObject: async (key: string) => {
          deletedKeys.push(key);
          await baseAdapter.objectStorage.deleteObject(key);
        },
      },
    };
    const fake = createFakeDocumentAssetExecutor({ failInsert: true });
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: createDatabaseDocumentAssetRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
        now: () => "2026-05-09T11:00:00.000Z",
      }),
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
      traces,
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "Cleanup.txt", { type: "text/plain" }));
    const response = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );

    expect(response.status).toBe(500);
    expect(traces.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: expect.objectContaining({
            traceId: response.headers.get("x-trace-id"),
          }),
          name: "ingestion.cleanup_object",
          status: "ok",
        }),
        expect.objectContaining({
          name: "ingestion.asset_create",
          status: "error",
        }),
      ]),
    );
    expect(deletedKeys).toEqual([
      "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/cleanup.txt",
    ]);
    await expect(baseAdapter.objectStorage.getObject(deletedKeys[0] ?? "")).resolves.toBeNull();
  });

  it("marks document assets failed and keeps raw objects when synchronous parsing fails", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const traces = createInMemoryTraceRecorder();
    const deletedKeys: string[] = [];
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        deleteObject: async (key: string) => {
          deletedKeys.push(key);
          await baseAdapter.objectStorage.deleteObject(key);
        },
      },
    };
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const parser = createRecordingParser({ fail: true });
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
      parseArtifacts,
      parser: parser.parser,
      traces,
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
    expect(traces.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ingestion.parser_parse",
          status: "error",
        }),
        expect.objectContaining({
          name: "ingestion.status_update",
          status: "ok",
        }),
      ]),
    );
    await expect(response.json()).resolves.toEqual({ error: "Document parsing failed" });
    expect(deletedKeys).toEqual([]);
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({ parserStatus: "failed" });
    await expect(
      parseArtifacts.getByDocumentVersion({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        version: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      baseAdapter.objectStorage.headObject(
        "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/failure.md",
      ),
    ).resolves.toMatchObject({ sizeBytes: 2 });
  });

  it("fails closed for complex uploads when no Unstructured parser is configured", async () => {
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "Report.pdf", { type: "application/pdf" }));
    const response = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Document parsing failed" });
    await expect(
      assets.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({ parserStatus: "failed" });
  });

  it("returns upload failure when document status cannot be finalized after parsing", async () => {
    const baseAssets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const parser = createRecordingParser();
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: {
        create: baseAssets.create,
        get: baseAssets.get,
        getForDeletion: baseAssets.getForDeletion,
        getStorageUsage: baseAssets.getStorageUsage,
        list: baseAssets.list,
        listBySource: baseAssets.listBySource,
        rollbackStaleWrite: baseAssets.rollbackStaleWrite,
        updateParserStatus: async (input) =>
          input.parserStatus === "parsed" ? null : baseAssets.updateParserStatus(input),
      },
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
    form.set("file", new File([new Uint8Array([1])], "Finalize.md", { type: "text/markdown" }));
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
  });

  it("backs document asset creation with a parameterized database repository", async () => {
    const fake = createFakeDocumentAssetExecutor();
    const repository = createDatabaseDocumentAssetRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      now: () => "2026-05-09T11:00:00.000Z",
    });

    const asset = await repository.create({
      filename: "Report.pdf",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { tenantId: "tenant-1", uploadedBy: "user-1" },
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/doc/report.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 12,
      sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    });

    expect(asset).toEqual({
      createdAt: "2026-05-09T11:00:00.000Z",
      filename: "Report.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { tenantId: "tenant-1", uploadedBy: "user-1" },
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/doc/report.pdf",
      parserStatus: "pending",
      sha256: "a".repeat(64),
      sizeBytes: 12,
      sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      version: 1,
    });
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "document_assets",
      }),
    );
    expect(fake.calls[0]?.sql).not.toContain("Report.pdf");
    expect(fake.calls[0]?.params).toContain("Report.pdf");
    await expect(
      repository.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({
      filename: "Report.pdf",
      parserStatus: "pending",
    });
    await repository.create({
      filename: "Second.txt",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/plain",
      objectKey: "tenant-1/spaces/space/documents/doc/second.txt",
      sha256: "c".repeat(64),
      sizeBytes: 6,
    });
    const firstPage = await repository.list({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
    });
    expect(firstPage).toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43" }],
      nextCursor: { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43" },
    });
    const secondPage = await repository.list({
      cursor: firstPage.nextCursor,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 2,
    });
    expect(secondPage).toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46" }],
    });
    expect(secondPage.nextCursor).toBeUndefined();
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c43", "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42"],
        tableName: "document_assets",
      }),
    );
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c42", 2],
        tableName: "document_assets",
      }),
    );
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 3,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c42", "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43", 3],
        tableName: "document_assets",
      }),
    );
    await expect(
      repository.getStorageUsage({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toEqual({
      documentCount: 2,
      rawDocumentBytes: 18,
    });
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c42"],
        tableName: "document_assets",
      }),
    );

    const tidbFake = createFakeDocumentAssetExecutor();
    const tidbRepository = createDatabaseDocumentAssetRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      now: () => "2026-05-09T11:00:00.000Z",
    });

    await expect(
      tidbRepository.create({
        filename: "TiDB.txt",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mimeType: "text/plain",
        objectKey: "tenant-1/spaces/space/documents/doc/tidb.txt",
        sha256: "b".repeat(64),
        sizeBytes: 5,
      }),
    ).resolves.toMatchObject({ filename: "TiDB.txt" });
    expect(tidbFake.calls[0]?.sql).toContain("INSERT INTO `document_assets`");
    expect(tidbFake.calls[0]?.sql).toContain("CAST(? AS JSON)");
    expect(tidbFake.calls[0]?.sql).not.toContain("RETURNING");

    await expect(
      repository.updateParserStatus({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        parserStatus: "parsed",
      }),
    ).resolves.toMatchObject({ parserStatus: "parsed" });
    await expect(
      repository.updateParserStatus({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        parserStatus: "failed",
      }),
    ).resolves.toBeNull();
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "update",
        params: [
          "parsed",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        ],
        tableName: "document_assets",
      }),
    );
  });

  it("persists parse artifacts with bounded memory and parameterized database repositories", async () => {
    const artifact = ParseArtifactSchema.parse({
      artifactHash: "d".repeat(64),
      contentType: "text",
      createdAt: "2026-05-09T11:00:01.000Z",
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      elements: [
        {
          id: "element-1",
          metadata: { level: 1 },
          sectionPath: ["Intro"],
          text: "Hello",
          type: "paragraph",
        },
      ],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      metadata: { filename: "hello.md" },
      parser: "native-markdown",
      version: 1,
    }) satisfies ParseArtifact;
    const memoryRepository = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });

    await expect(memoryRepository.create(artifact)).resolves.toEqual(artifact);
    const stored = await memoryRepository.getByDocumentVersion({
      documentAssetId: artifact.documentAssetId,
      version: artifact.version,
    });

    if (!stored) {
      throw new Error("Expected stored parse artifact");
    }

    const storedElement = stored.elements[0];

    if (!storedElement) {
      throw new Error("Expected stored parse artifact element");
    }

    stored.metadata.filename = "mutated.md";
    storedElement.sectionPath.push("Mutation");
    await expect(
      memoryRepository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: artifact.version,
      }),
    ).resolves.toMatchObject({
      elements: [{ sectionPath: ["Intro"] }],
      metadata: { filename: "hello.md" },
    });
    await expect(
      memoryRepository.create({
        ...artifact,
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      }),
    ).rejects.toThrow("Parse artifact repository maxArtifacts=1 exceeded");

    const fake = createFakeParseArtifactExecutor();
    const databaseRepository = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
    });

    await expect(databaseRepository.create(artifact)).resolves.toEqual(artifact);
    await expect(
      databaseRepository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: artifact.version,
      }),
    ).resolves.toEqual(artifact);
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "parse_artifacts",
      }),
    );
    expect(fake.calls[0]?.sql).not.toContain("hello.md");
    expect(fake.calls[0]?.params).toContain(JSON.stringify(artifact.elements));
    expect(fake.calls[0]?.params).toContain(JSON.stringify(artifact.metadata));
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [artifact.documentAssetId, artifact.version],
        tableName: "parse_artifacts",
      }),
    );

    const tidbFake = createFakeParseArtifactExecutor();
    const tidbRepository = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
    });
    await expect(tidbRepository.create(artifact)).resolves.toEqual(artifact);
    expect(tidbFake.calls[0]?.sql).toContain("INSERT INTO `parse_artifacts`");
    expect(tidbFake.calls[0]?.sql).toContain("CAST(? AS JSON)");
    expect(tidbFake.calls[0]?.sql).not.toContain("RETURNING");

    const cleanupRepository = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    await cleanupRepository.create({
      ...artifact,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
      version: 1,
    });
    await cleanupRepository.create({
      ...artifact,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
      version: 2,
    });
    await cleanupRepository.create({
      ...artifact,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03",
      version: 3,
    });
    await expect(
      cleanupRepository.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 2,
        maxArtifacts: 2,
      }),
    ).resolves.toBe(1);
    await expect(
      cleanupRepository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      cleanupRepository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: 3,
      }),
    ).resolves.toMatchObject({ version: 3 });

    await expect(
      cleanupRepository.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 0,
        maxArtifacts: 2,
      }),
    ).rejects.toThrow("Parse artifact prune keepVersions must be at least 1");

    const cleanupFake = createFakeParseArtifactExecutor();
    const cleanupDatabaseRepository = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({ executor: cleanupFake.executor, kind: "postgres" }),
    });
    await expect(
      cleanupDatabaseRepository.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 2,
        maxArtifacts: 10,
      }),
    ).resolves.toBe(0);
    expect(cleanupFake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 10,
        operation: "delete",
        params: [artifact.documentAssetId, 2],
        tableName: "parse_artifacts",
      }),
    );
    expect(cleanupFake.calls[0]?.sql).not.toContain(artifact.documentAssetId);
  });

  it("enqueues and processes bounded parse artifact retention cleanup jobs", async () => {
    const queue = new RecordingUpgradeQueue();
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-09T11:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 8 });
    const retentionPolicies = createInMemoryRetentionPolicyRepository({
      maxPolicies: 4,
      now: () => "2026-05-12T19:00:00.000Z",
    });
    const worker = createParseArtifactRetentionCleanupWorker({
      assets,
      jobs: queue,
      maxArtifactsPerDocument: 3,
      maxDocuments: 1,
      now: () => "2026-05-12T19:00:00.000Z",
      parseArtifacts,
      retentionPolicies,
    });
    const firstAsset = await assets.create({
      filename: "First.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9e01",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/first.md",
      sha256: "1".repeat(64),
      sizeBytes: 1,
    });
    const secondAsset = await assets.create({
      filename: "Second.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9e02",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/second.md",
      sha256: "2".repeat(64),
      sizeBytes: 1,
    });
    const baseArtifact = ParseArtifactSchema.parse({
      artifactHash: "e".repeat(64),
      contentType: "text",
      createdAt: "2026-05-09T11:00:01.000Z",
      documentAssetId: firstAsset.id,
      elements: [],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9e10",
      metadata: {},
      parser: "native-markdown",
      version: 1,
    });

    await retentionPolicies.update({
      patch: { parseArtifactVersions: 2 },
      scope: { knowledgeSpaceId, tenantId: "tenant-1" },
    });
    for (const version of [1, 2, 3]) {
      await parseArtifacts.create({
        ...baseArtifact,
        documentAssetId: firstAsset.id,
        id: `018f0d60-7a49-7cc2-9c1b-5b36f18f9e1${version}`,
        version,
      });
    }
    for (const version of [1, 2]) {
      await parseArtifacts.create({
        ...baseArtifact,
        documentAssetId: secondAsset.id,
        id: `018f0d60-7a49-7cc2-9c1b-5b36f18f9e2${version}`,
        version,
      });
    }

    await expect(worker.enqueue({ knowledgeSpaceId, tenantId: "tenant-1" })).resolves.toMatchObject(
      { id: "upgrade-queue-1" },
    );
    expect(queue.enqueued).toEqual([
      {
        idempotencyKey: `retention.cleanup.parse-artifacts:tenant-1:${knowledgeSpaceId}:`,
        payload: {
          cursorId: "",
          knowledgeSpaceId,
          maxArtifactsPerDocument: 3,
          maxDocuments: 1,
          requestedAt: "2026-05-12T19:00:00.000Z",
          tenantId: "tenant-1",
        },
        type: "retention.cleanup.parse-artifacts",
      },
    ]);

    await expect(
      worker.process({
        cursorId: "",
        knowledgeSpaceId,
        maxArtifactsPerDocument: 3,
        maxDocuments: 1,
        requestedAt: "2026-05-12T19:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      artifactsDeleted: 1,
      documentsScanned: 1,
      keepVersions: 2,
      knowledgeSpaceId,
      nextCursorId: firstAsset.id,
      tenantId: "tenant-1",
    });
    await expect(
      parseArtifacts.getByDocumentVersion({ documentAssetId: firstAsset.id, version: 1 }),
    ).resolves.toBeNull();
    await expect(
      parseArtifacts.getByDocumentVersion({ documentAssetId: firstAsset.id, version: 3 }),
    ).resolves.toMatchObject({ version: 3 });
    await expect(
      worker.process({
        cursorId: firstAsset.id,
        knowledgeSpaceId,
        maxArtifactsPerDocument: 3,
        maxDocuments: 1,
        requestedAt: "2026-05-12T19:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      artifactsDeleted: 0,
      documentsScanned: 1,
      keepVersions: 2,
      knowledgeSpaceId,
      tenantId: "tenant-1",
    });
    await expect(
      parseArtifacts.getByDocumentVersion({ documentAssetId: secondAsset.id, version: 1 }),
    ).resolves.toMatchObject({ version: 1 });
    await expect(
      worker.process({
        cursorId: "",
        knowledgeSpaceId,
        maxArtifactsPerDocument: 3,
        maxDocuments: 2,
        requestedAt: "2026-05-12T19:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Parse artifact retention cleanup maxDocuments exceeds maxDocuments=1");
    await expect(
      worker.process({
        cursorId: "",
        knowledgeSpaceId,
        maxArtifactsPerDocument: 4,
        maxDocuments: 1,
        requestedAt: "2026-05-12T19:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow(
      "Parse artifact retention cleanup maxArtifactsPerDocument exceeds maxArtifactsPerDocument=3",
    );
    await expect(
      worker.process({
        cursorId: "",
        knowledgeSpaceId,
        maxArtifactsPerDocument: 3,
        maxDocuments: 1,
        requestedAt: "bad-date",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Parse artifact retention cleanup requestedAt must be a valid timestamp");
    await expect(
      worker.process({
        cursorId: 42,
        knowledgeSpaceId,
        maxArtifactsPerDocument: 3,
        maxDocuments: 1,
        requestedAt: "2026-05-12T19:00:00.000Z",
        tenantId: "tenant-1",
      } as never),
    ).rejects.toThrow("Parse artifact retention cleanup cursorId must be a string");
    await expect(worker.process(null as never)).rejects.toThrow(
      "Parse artifact retention cleanup payload is invalid",
    );
    await expect(worker.enqueue({ knowledgeSpaceId, tenantId: " " })).rejects.toThrow(
      "Parse artifact retention cleanup tenantId is required",
    );
    await expect(worker.enqueue({ knowledgeSpaceId: " ", tenantId: "tenant-1" })).rejects.toThrow(
      "Parse artifact retention cleanup knowledgeSpaceId is required",
    );
    expect(() =>
      createParseArtifactRetentionCleanupWorker({
        assets,
        jobs: queue,
        maxArtifactsPerDocument: 3,
        maxDocuments: 0,
        parseArtifacts,
        retentionPolicies,
      }),
    ).toThrow("Parse artifact retention cleanup maxDocuments must be at least 1");
    expect(() =>
      createParseArtifactRetentionCleanupWorker({
        assets,
        jobs: queue,
        maxArtifactsPerDocument: 0,
        maxDocuments: 1,
        parseArtifacts,
        retentionPolicies,
      }),
    ).toThrow("Parse artifact retention cleanup maxArtifactsPerDocument must be at least 1");
  });

  it("persists KnowledgeFS physical view paths with bounded indexed listing", async () => {
    const path = KnowledgePathSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { filename: "vendor-contract.pdf", physicalView: "by-type" },
      resourceType: "document",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      version: 1,
      viewName: "by-type",
      viewType: "physical",
      virtualPath: "/knowledge/by-type/contract/vendor-contract.pdf",
    }) satisfies KnowledgePath;
    const secondPath = KnowledgePathSchema.parse({
      ...path,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      virtualPath: "/knowledge/by-type/policy/renewal-policy.pdf",
    }) satisfies KnowledgePath;
    const memoryRepository = createInMemoryKnowledgePathRepository({
      maxListLimit: 1,
      maxPaths: 2,
    });

    await expect(memoryRepository.create(path)).resolves.toEqual(path);
    await expect(memoryRepository.create(secondPath)).resolves.toEqual(secondPath);
    await expect(
      memoryRepository.get({
        knowledgeSpaceId: path.knowledgeSpaceId,
        virtualPath: path.virtualPath,
      }),
    ).resolves.toEqual(path);
    await expect(
      memoryRepository.get({
        knowledgeSpaceId: path.knowledgeSpaceId,
        virtualPath: "/knowledge/missing",
      }),
    ).resolves.toBeNull();
    const firstPage = await memoryRepository.listPhysicalView({
      knowledgeSpaceId: path.knowledgeSpaceId,
      limit: 1,
      viewName: "by-type",
    });
    expect(firstPage).toEqual({
      items: [path],
      nextCursor: { id: path.id, virtualPath: path.virtualPath },
    });
    await expect(
      memoryRepository.listPhysicalView({
        cursor: firstPage.nextCursor,
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 1,
        viewName: "by-type",
      }),
    ).resolves.toEqual({ items: [secondPath] });
    await expect(
      memoryRepository.listPhysicalDescendants({
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 1,
        parentPath: "/knowledge/by-type",
        viewName: "by-type",
      }),
    ).resolves.toEqual({
      items: [path],
      nextCursor: { id: path.id, virtualPath: path.virtualPath },
    });
    const cloned = await memoryRepository.get({
      knowledgeSpaceId: path.knowledgeSpaceId,
      virtualPath: path.virtualPath,
    });
    if (!cloned) {
      throw new Error("Expected cloned knowledge path");
    }
    cloned.metadata.filename = "mutated.pdf";
    await expect(
      memoryRepository.get({
        knowledgeSpaceId: path.knowledgeSpaceId,
        virtualPath: path.virtualPath,
      }),
    ).resolves.toEqual(path);
    await expect(
      memoryRepository.listPhysicalView({
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 2,
        viewName: "by-type",
      }),
    ).rejects.toThrow("Knowledge path list limit exceeds maxListLimit=1");
    await expect(
      memoryRepository.listPhysicalView({
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 0,
        viewName: "by-type",
      }),
    ).rejects.toThrow("Knowledge path list limit must be at least 1");
    await expect(memoryRepository.create(path)).rejects.toThrow(
      "Knowledge path already exists for virtual path",
    );
    const capacityRepository = createInMemoryKnowledgePathRepository({
      maxListLimit: 1,
      maxPaths: 1,
    });
    await capacityRepository.create(path);
    await expect(capacityRepository.create(secondPath)).rejects.toThrow(
      "Knowledge path repository maxPaths=1 exceeded",
    );
    expect(() => createInMemoryKnowledgePathRepository({ maxListLimit: 0, maxPaths: 1 })).toThrow(
      "Knowledge path repository maxListLimit must be at least 1",
    );
    expect(() => createInMemoryKnowledgePathRepository({ maxListLimit: 1, maxPaths: 0 })).toThrow(
      "Knowledge path repository maxPaths must be at least 1",
    );

    const fake = createFakeKnowledgePathExecutor();
    const databaseRepository = createDatabaseKnowledgePathRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxListLimit: 2,
    });
    await expect(databaseRepository.create(path)).resolves.toEqual(path);
    await expect(databaseRepository.create(secondPath)).resolves.toEqual(secondPath);
    await expect(
      databaseRepository.get({
        knowledgeSpaceId: path.knowledgeSpaceId,
        virtualPath: path.virtualPath,
      }),
    ).resolves.toEqual(path);
    const databaseFirstPage = await databaseRepository.listPhysicalView({
      knowledgeSpaceId: path.knowledgeSpaceId,
      limit: 1,
      viewName: "by-type",
    });
    expect(databaseFirstPage).toEqual({
      items: [path],
      nextCursor: { id: path.id, virtualPath: path.virtualPath },
    });
    await expect(
      databaseRepository.listPhysicalView({
        cursor: databaseFirstPage.nextCursor,
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 1,
        viewName: "by-type",
      }),
    ).resolves.toEqual({ items: [secondPath] });
    await expect(
      databaseRepository.listPhysicalDescendants({
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 1,
        parentPath: "/knowledge/by-type",
        viewName: "by-type",
      }),
    ).resolves.toEqual({
      items: [path],
      nextCursor: { id: path.id, virtualPath: path.virtualPath },
    });
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "knowledge_paths",
      }),
    );
    expect(fake.calls[0]?.sql).not.toContain(path.virtualPath);
    expect(fake.calls[0]?.params).toContain(JSON.stringify(path.metadata));
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: [path.knowledgeSpaceId, "physical", "by-type", 2],
        tableName: "knowledge_paths",
      }),
    );
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: [path.knowledgeSpaceId, "physical", "by-type", "/knowledge/by-type/%", 2],
        tableName: "knowledge_paths",
      }),
    );
    const semanticPath = KnowledgePathSchema.parse({
      ...path,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
      metadata: { topicName: "Renewal Risk", topicSlug: "renewal-risk" },
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/renewal-risk/vendor-contract.pdf",
    }) satisfies KnowledgePath;
    const semanticMemoryRepository = createInMemoryKnowledgePathRepository({
      maxListLimit: 2,
      maxPaths: 2,
    });
    await semanticMemoryRepository.create(path);
    await semanticMemoryRepository.create(semanticPath);
    await expect(
      semanticMemoryRepository.listSemanticDescendants({
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 2,
        parentPath: "/knowledge/by-topic",
        viewName: "by-topic",
      }),
    ).resolves.toEqual({ items: [semanticPath] });
    const semanticFake = createFakeKnowledgePathExecutor();
    const semanticDatabaseRepository = createDatabaseKnowledgePathRepository({
      database: createSchemaDatabaseAdapter({ executor: semanticFake.executor, kind: "postgres" }),
      maxListLimit: 2,
    });
    await semanticDatabaseRepository.create(path);
    await semanticDatabaseRepository.create(semanticPath);
    await expect(
      semanticDatabaseRepository.listSemanticDescendants({
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 2,
        parentPath: "/knowledge/by-topic",
        viewName: "by-topic",
      }),
    ).resolves.toEqual({ items: [semanticPath] });
    expect(semanticFake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 3,
        operation: "select",
        params: [path.knowledgeSpaceId, "semantic", "by-topic", "/knowledge/by-topic/%", 3],
        tableName: "knowledge_paths",
      }),
    );

    const tidbFake = createFakeKnowledgePathExecutor();
    const tidbRepository = createDatabaseKnowledgePathRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
      maxListLimit: 2,
    });
    await expect(tidbRepository.create(path)).resolves.toEqual(path);
    expect(tidbFake.calls[0]?.sql).toContain("INSERT INTO `knowledge_paths`");
    expect(tidbFake.calls[0]?.sql).toContain("CAST(? AS JSON)");
  });

  it("serves authenticated KnowledgeFS ls and tree endpoints from tenant-scoped paths", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 2,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 3,
      maxPaths: 6,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    const documentPath = KnowledgePathSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
      knowledgeSpaceId: space.id,
      metadata: { filename: "vendor-contract.pdf" },
      resourceType: "document",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      version: 1,
      viewName: "by-type",
      viewType: "physical",
      virtualPath: "/knowledge/by-type/vendor-contract.pdf",
    }) satisfies KnowledgePath;
    const nestedPath = KnowledgePathSchema.parse({
      ...documentPath,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
      metadata: { filename: "renewal-policy.pdf" },
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      virtualPath: "/knowledge/by-type/policies/renewal-policy.pdf",
    }) satisfies KnowledgePath;
    const secondNestedPath = KnowledgePathSchema.parse({
      ...documentPath,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
      metadata: { filename: "security-policy.pdf" },
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      virtualPath: "/knowledge/by-type/policies/security-policy.pdf",
    }) satisfies KnowledgePath;
    await paths.create(documentPath);
    await paths.create(nestedPath);
    await paths.create(secondNestedPath);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      documentAssets: await createInitializedTestDocumentAssets(space.id, [
        documentPath.targetId,
        nestedPath.targetId,
        secondNestedPath.targetId,
      ]),
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });

    const firstPageResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=1`,
      {
        headers: bearer(readToken),
      },
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage = await firstPageResponse.json();
    expect(firstPage).toMatchObject({
      items: [
        {
          kind: "directory",
          name: "policies",
          path: "/knowledge/by-type/policies",
        },
      ],
      path: "/knowledge/by-type",
      truncated: true,
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPageResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=1&cursor=${firstPage.nextCursor}`,
      {
        headers: bearer(readToken),
      },
    );
    expect(secondPageResponse.status).toBe(200);
    await expect(secondPageResponse.json()).resolves.toMatchObject({
      items: [
        {
          kind: "directory",
          name: "policies",
          path: "/knowledge/by-type/policies",
        },
      ],
      truncated: true,
    });

    const listResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=3`,
      {
        headers: bearer(readToken),
      },
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      items: [
        {
          kind: "directory",
          metadata: {},
          name: "policies",
          path: "/knowledge/by-type/policies",
        },
        {
          kind: "resource",
          metadata: { filename: "vendor-contract.pdf" },
          name: "vendor-contract.pdf",
          path: "/knowledge/by-type/vendor-contract.pdf",
          resourceType: "document",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          version: 1,
        },
      ],
      path: "/knowledge/by-type",
      truncated: false,
    });

    const treeResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/tree?path=/knowledge/by-type&limit=3&depth=3`,
      {
        headers: bearer(readToken),
      },
    );
    expect(treeResponse.status).toBe(200);
    await expect(treeResponse.json()).resolves.toMatchObject({
      path: "/knowledge/by-type",
      root: {
        children: [
          {
            children: [
              {
                kind: "resource",
                name: "renewal-policy.pdf",
                path: "/knowledge/by-type/policies/renewal-policy.pdf",
              },
              {
                kind: "resource",
                name: "security-policy.pdf",
                path: "/knowledge/by-type/policies/security-policy.pdf",
              },
            ],
            kind: "directory",
            name: "policies",
            path: "/knowledge/by-type/policies",
          },
          {
            kind: "resource",
            name: "vendor-contract.pdf",
            path: "/knowledge/by-type/vendor-contract.pdf",
          },
        ],
        kind: "directory",
        name: "by-type",
        path: "/knowledge/by-type",
      },
      truncated: false,
    });
    const shallowTreeResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/tree?path=/knowledge/by-type&limit=3`,
      {
        headers: bearer(readToken),
      },
    );
    expect(shallowTreeResponse.status).toBe(200);
    await expect(shallowTreeResponse.json()).resolves.toMatchObject({
      root: {
        children: [
          {
            kind: "directory",
            name: "policies",
            path: "/knowledge/by-type/policies",
          },
          {
            kind: "resource",
            name: "vendor-contract.pdf",
            path: "/knowledge/by-type/vendor-contract.pdf",
          },
        ],
      },
    });
  });

  it("serves materialized KnowledgeFS by-topic semantic directories", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 2,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 2,
      maxPaths: 4,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f11",
        knowledgeSpaceId: space.id,
        metadata: {
          semanticView: {
            buildStatus: "ready",
            generatedVersion: "topic-view-v1",
            staleStatus: "fresh",
          },
          topicName: "Renewal Risk",
          topicSlug: "renewal-risk",
        },
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        version: 1,
        viewName: "by-topic",
        viewType: "semantic",
        virtualPath: "/knowledge/by-topic/renewal-risk/vendor-contract.pdf",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f12",
        knowledgeSpaceId: space.id,
        metadata: {
          semanticView: {
            buildStatus: "building",
            generatedVersion: "topic-view-v1",
            staleStatus: "stale",
          },
          topicName: "Security",
          topicSlug: "security",
        },
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        version: 1,
        viewName: "by-topic",
        viewType: "semantic",
        virtualPath: "/knowledge/by-topic/security/security-policy.pdf",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f13",
        knowledgeSpaceId: space.id,
        metadata: { filename: "physical.pdf" },
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        version: 1,
        viewName: "by-topic",
        viewType: "physical",
        virtualPath: "/knowledge/by-topic/physical.pdf",
      }),
    );
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      documentAssets: await createInitializedTestDocumentAssets(space.id, [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      ]),
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });

    const root = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-topic",
      )}&limit=2`,
      { headers: bearer(readToken) },
    );
    const topic = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-topic/renewal-risk",
      )}&limit=2`,
      { headers: bearer(readToken) },
    );
    const pagedRoot = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-topic",
      )}&limit=1`,
      { headers: bearer(readToken) },
    );
    const invalid = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-topic/renewal-risk/vendor-contract.pdf/extra",
      )}&limit=2`,
      { headers: bearer(readToken) },
    );

    expect(root.status).toBe(200);
    await expect(root.json()).resolves.toEqual({
      items: [
        {
          kind: "directory",
          metadata: {
            semanticView: {
              buildStatus: "ready",
              generatedVersion: "topic-view-v1",
              staleStatus: "fresh",
            },
            topicName: "Renewal Risk",
            topicSlug: "renewal-risk",
          },
          name: "renewal-risk",
          path: "/knowledge/by-topic/renewal-risk",
        },
        {
          kind: "directory",
          metadata: {
            semanticView: {
              buildStatus: "building",
              generatedVersion: "topic-view-v1",
              staleStatus: "stale",
            },
            topicName: "Security",
            topicSlug: "security",
          },
          name: "security",
          path: "/knowledge/by-topic/security",
        },
      ],
      path: "/knowledge/by-topic",
      truncated: false,
    });
    expect(topic.status).toBe(200);
    await expect(topic.json()).resolves.toEqual({
      items: [
        {
          kind: "resource",
          metadata: {
            semanticView: {
              buildStatus: "ready",
              generatedVersion: "topic-view-v1",
              staleStatus: "fresh",
            },
            topicName: "Renewal Risk",
            topicSlug: "renewal-risk",
          },
          name: "vendor-contract.pdf",
          path: "/knowledge/by-topic/renewal-risk/vendor-contract.pdf",
          resourceType: "document",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          version: 1,
        },
      ],
      path: "/knowledge/by-topic/renewal-risk",
      truncated: false,
    });
    expect(pagedRoot.status).toBe(200);
    await expect(pagedRoot.json()).resolves.toMatchObject({
      items: [{ name: "renewal-risk" }],
      path: "/knowledge/by-topic",
      truncated: true,
    });
    expect(invalid.status).toBe(400);
  });

  it("guards KnowledgeFS endpoints with auth, tenant scope, and explicit bounded limits", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 1,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 1,
      maxPaths: 1,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });

    expect(
      (await app.request(`/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=1`))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request(`/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=1`, {
          headers: bearer(writeToken),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=1`, {
          headers: bearer(otherTenantToken),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/knowledge-spaces/${space.id}/fs/tree?path=/knowledge/by-type&limit=1`, {
          headers: bearer(otherTenantToken),
        })
      ).status,
    ).toBe(404);
    const unboundedResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=2`,
      {
        headers: bearer(readToken),
      },
    );
    expect(unboundedResponse.status).toBe(400);
    await expect(unboundedResponse.json()).resolves.toEqual({
      error: "Knowledge path list limit exceeds maxListLimit=1",
    });
    const unboundedTreeResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/tree?path=/knowledge/by-type&limit=2`,
      {
        headers: bearer(readToken),
      },
    );
    expect(unboundedTreeResponse.status).toBe(400);
    await expect(unboundedTreeResponse.json()).resolves.toEqual({
      error: "Knowledge path list limit exceeds maxListLimit=1",
    });
    const invalidPathResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge&limit=1`,
      {
        headers: bearer(readToken),
      },
    );
    expect(invalidPathResponse.status).toBe(400);
    await expect(invalidPathResponse.json()).resolves.toEqual({
      error: "KnowledgeFS path must include a physical view name",
    });
    const invalidCursorResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=/knowledge/by-type&limit=1&cursor=broken`,
      {
        headers: bearer(readToken),
      },
    );
    expect(invalidCursorResponse.status).toBe(400);
    await expect(invalidCursorResponse.json()).resolves.toEqual({
      error: "KnowledgeFS cursor is invalid",
    });
    const invalidTreeCursorResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/tree?path=/knowledge/by-type&limit=1&cursor=broken`,
      {
        headers: bearer(readToken),
      },
    );
    expect(invalidTreeCursorResponse.status).toBe(400);
    await expect(invalidTreeCursorResponse.json()).resolves.toEqual({
      error: "KnowledgeFS cursor is invalid",
    });
  });

  it("serves authenticated KnowledgeFS grep with scoped, paginated node matches", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 1,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 4,
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 4,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    const firstNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7001",
      startOffset: 0,
      text: "The renewal policy allows cancellation within thirty days.",
    });
    const secondNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7002",
      startOffset: 40,
      text: "Security controls do not mention renewals.",
    });
    const thirdNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7003",
      startOffset: 80,
      text: "Incident response procedures are documented.",
    });
    await nodes.createMany([firstNode, secondNode, thirdNode]);
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7101",
        knowledgeSpaceId: space.id,
        metadata: { title: "Renewal policy" },
        resourceType: "node",
        targetId: firstNode.id,
        version: 1,
        viewName: "by-type",
        viewType: "physical",
        virtualPath: "/knowledge/by-type/policies/renewal.md",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7102",
        knowledgeSpaceId: space.id,
        metadata: { title: "Security controls" },
        resourceType: "node",
        targetId: secondNode.id,
        version: 1,
        viewName: "by-type",
        viewType: "physical",
        virtualPath: "/knowledge/by-type/security/controls.md",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7103",
        knowledgeSpaceId: space.id,
        metadata: { title: "Incident response" },
        resourceType: "node",
        targetId: thirdNode.id,
        version: 1,
        viewName: "by-type",
        viewType: "physical",
        virtualPath: "/knowledge/by-type/security/incident-response.md",
      }),
    );
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      documentAssets: await createInitializedTestDocumentAssets(space.id, [
        firstNode.documentAssetId,
      ]),
      knowledgeNodes: nodes,
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });

    const response = await app.request(
      `/knowledge-spaces/${space.id}/fs/grep?path=/knowledge/by-type&limit=1&q=renewal`,
      {
        headers: bearer(readToken),
      },
    );
    expect(response.status).toBe(200);
    const firstPage = await response.json();
    expect(firstPage).toMatchObject({
      matches: [
        {
          endOffset: 11,
          kind: "node",
          nodeId: firstNode.id,
          path: "/knowledge/by-type/policies/renewal.md",
          snippet: "The renewal policy allows cancellation within thirty days.",
          startOffset: 4,
        },
      ],
      path: "/knowledge/by-type",
      truncated: true,
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await app.request(
      `/knowledge-spaces/${space.id}/fs/grep?path=/knowledge/by-type&limit=1&q=renewal&cursor=${firstPage.nextCursor}`,
      {
        headers: bearer(readToken),
      },
    );
    expect(secondPage.status).toBe(200);
    await expect(secondPage.json()).resolves.toMatchObject({
      matches: [
        {
          nodeId: secondNode.id,
          path: "/knowledge/by-type/security/controls.md",
        },
      ],
      truncated: false,
    });

    const noMatchFirstPage = await app.request(
      `/knowledge-spaces/${space.id}/fs/grep?path=/knowledge/by-type&limit=1&q=not-present`,
      {
        headers: bearer(readToken),
      },
    );
    expect(noMatchFirstPage.status).toBe(200);
    await expect(noMatchFirstPage.json()).resolves.toMatchObject({
      matches: [],
      path: "/knowledge/by-type",
      truncated: false,
    });
  });

  it("serves authenticated KnowledgeFS find with scoped metadata filters", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 1,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 3,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7201",
        knowledgeSpaceId: space.id,
        metadata: { language: "en", owner: "legal", sourceId: "source-a" },
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7301",
        version: 1,
        viewName: "by-type",
        viewType: "physical",
        virtualPath: "/knowledge/by-type/contracts/vendor-contract.pdf",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7202",
        knowledgeSpaceId: space.id,
        metadata: { language: "zh", owner: "security", sourceId: "source-b" },
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7302",
        version: 1,
        viewName: "by-type",
        viewType: "physical",
        virtualPath: "/knowledge/by-type/policies/security-policy.pdf",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7203",
        knowledgeSpaceId: space.id,
        metadata: { language: "en", owner: "security", sourceId: "source-c" },
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7303",
        version: 1,
        viewName: "by-type",
        viewType: "physical",
        virtualPath: "/knowledge/by-type/policies/access-policy.pdf",
      }),
    );
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      documentAssets: await createInitializedTestDocumentAssets(space.id, [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f7301",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f7302",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f7303",
      ]),
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });

    const response = await app.request(
      `/knowledge-spaces/${space.id}/fs/find?path=/knowledge/by-type&limit=1&resourceType=document&metadataKey=owner&metadataValue=legal&nameContains=contract`,
      {
        headers: bearer(readToken),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          kind: "resource",
          metadata: { language: "en", owner: "legal", sourceId: "source-a" },
          name: "vendor-contract.pdf",
          path: "/knowledge/by-type/contracts/vendor-contract.pdf",
          resourceType: "document",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7301",
          version: 1,
        },
      ],
      path: "/knowledge/by-type",
      truncated: false,
    });
    const paged = await app.request(
      `/knowledge-spaces/${space.id}/fs/find?path=/knowledge/by-type&limit=1`,
      {
        headers: bearer(readToken),
      },
    );
    expect(paged.status).toBe(200);
    const pagedBody = await paged.json();
    expect(pagedBody.items).toHaveLength(1);
    expect(pagedBody.nextCursor).toEqual(expect.any(String));
    expect(pagedBody.truncated).toBe(true);

    const fullFind = await app.request(
      `/knowledge-spaces/${space.id}/fs/find?path=/knowledge/by-type&limit=9`,
      {
        headers: bearer(readToken),
      },
    );
    expect(fullFind.status).toBe(200);
    await expect(fullFind.json()).resolves.toMatchObject({
      path: "/knowledge/by-type",
      truncated: false,
    });

    for (const query of [
      "resourceType=node",
      "nameContains=missing",
      "metadataKey=owner&metadataValue=finance",
    ]) {
      const empty = await app.request(
        `/knowledge-spaces/${space.id}/fs/find?path=/knowledge/by-type&limit=1&${query}`,
        {
          headers: bearer(readToken),
        },
      );
      expect(empty.status).toBe(200);
      await expect(empty.json()).resolves.toMatchObject({
        items: [],
        path: "/knowledge/by-type",
      });
    }
    const invalidMetadata = await app.request(
      `/knowledge-spaces/${space.id}/fs/find?path=/knowledge/by-type&limit=1&metadataKey=owner`,
      {
        headers: bearer(readToken),
      },
    );
    expect(invalidMetadata.status).toBe(400);
    await expect(invalidMetadata.json()).resolves.toEqual({
      error: "KnowledgeFS find metadataKey and metadataValue must be provided together",
    });
  });

  it("serves KnowledgeFS cat and stat for document objects and knowledge nodes", async () => {
    const adapter = createNodePlatformAdapter();
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 1,
    });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 3 });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 3 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 6,
      maxListLimit: 1,
      maxNodes: 6,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 3,
      maxPaths: 13,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    const objectBytes = new TextEncoder().encode("Document body");
    await adapter.objectStorage.putObject({
      body: objectBytes,
      contentType: "text/plain",
      key: "tenant-1/spaces/space/documents/doc/readme.txt",
      metadata: { source: "test" },
    });
    await assets.create({
      filename: "readme.txt",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId: space.id,
      metadata: { title: "Readme" },
      mimeType: "text/plain",
      objectKey: "tenant-1/spaces/space/documents/doc/readme.txt",
      sha256: await sha256Hex(objectBytes),
      sizeBytes: objectBytes.byteLength,
    });
    await assets.create({
      filename: "missing-object.txt",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      knowledgeSpaceId: space.id,
      mimeType: "text/plain",
      objectKey: "tenant-1/spaces/space/documents/doc/missing-object.txt",
      sha256: "0".repeat(64),
      sizeBytes: 12,
    });
    await parseArtifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: await sha256Hex(new TextEncoder().encode("Recovered body")),
        contentType: "text",
        createdAt: "2026-05-21T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        elements: [
          { id: "title-1", metadata: {}, sectionPath: [], text: "Recovered title", type: "title" },
          {
            id: "paragraph-1",
            metadata: {},
            sectionPath: ["Recovered"],
            text: "Recovered body",
            type: "paragraph",
          },
        ],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
        metadata: {},
        parser: "native-markdown",
        version: 1,
      }),
    );
    await nodes.createMany([
      knowledgeNode({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        startOffset: 0,
        text: "Node body",
      }),
      KnowledgeNodeSchema.parse({
        artifactHash: "d".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 78,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        kind: "table",
        knowledgeSpaceId: space.id,
        metadata: {
          caption: "Vendor renewal amounts",
          columns: ["Vendor", "Amount"],
          rowCount: 1,
        },
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        permissionScope: ["tenant:tenant-1"],
        sourceLocation: {
          endOffset: 78,
          pageNumber: 2,
          sectionPath: ["Renewals"],
          startOffset: 20,
        },
        startOffset: 20,
        text: JSON.stringify({
          columns: ["Vendor", "Amount"],
          rows: [{ Amount: "$120", Vendor: "Acme" }],
        }),
      }),
      KnowledgeNodeSchema.parse({
        artifactHash: "d".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 120,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
        kind: "table",
        knowledgeSpaceId: space.id,
        metadata: { columns: ["Vendor", "Amount"], rowCount: 2 },
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        permissionScope: ["tenant:tenant-1"],
        sourceLocation: {
          endOffset: 120,
          pageNumber: 3,
          sectionPath: ["Renewals"],
          startOffset: 80,
        },
        startOffset: 80,
        text: JSON.stringify([{ Amount: "$90", Vendor: "Globex" }]),
      }),
      KnowledgeNodeSchema.parse({
        artifactHash: "d".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 160,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
        kind: "table",
        knowledgeSpaceId: space.id,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        permissionScope: ["tenant:tenant-1"],
        sourceLocation: {
          endOffset: 160,
          pageNumber: 4,
          sectionPath: ["Renewals"],
          startOffset: 121,
        },
        startOffset: 121,
        text: "not json <unsafe>",
      }),
      KnowledgeNodeSchema.parse({
        artifactHash: "d".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 220,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c55",
        kind: "image",
        knowledgeSpaceId: space.id,
        metadata: {
          boundingBox: { height: 120, width: 240, x: 10, y: 20 },
          caption: "Renewal trend chart",
          ocrText: "Q1 renewals increased 12%",
        },
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        permissionScope: ["tenant:tenant-1"],
        sourceLocation: {
          endOffset: 220,
          pageNumber: 5,
          sectionPath: ["Charts"],
          startOffset: 180,
        },
        startOffset: 180,
        text: "Q1 renewals increased 12%",
      }),
      KnowledgeNodeSchema.parse({
        artifactHash: "d".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 260,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c56",
        kind: "image",
        knowledgeSpaceId: space.id,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        permissionScope: ["tenant:tenant-1"],
        sourceLocation: {
          endOffset: 260,
          sectionPath: [],
          startOffset: 221,
        },
        startOffset: 221,
        text: "Fallback OCR text",
      }),
    ]);
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f11",
        knowledgeSpaceId: space.id,
        metadata: { title: "Readme" },
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        version: 1,
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/readme.txt",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f16",
        knowledgeSpaceId: space.id,
        metadata: {},
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/missing-object.txt",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f14",
        knowledgeSpaceId: space.id,
        metadata: {},
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        viewName: "nodes",
        viewType: "physical",
        virtualPath: "/knowledge/nodes/missing-node.md",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f15",
        knowledgeSpaceId: space.id,
        metadata: {},
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/missing-asset.txt",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f13",
        knowledgeSpaceId: space.id,
        metadata: { format: "json" },
        resourceType: "artifact",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        viewName: "artifacts",
        viewType: "physical",
        virtualPath: "/knowledge/artifacts/artifact.json",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f12",
        knowledgeSpaceId: space.id,
        metadata: { chunkIndex: 1 },
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        viewName: "nodes",
        viewType: "physical",
        virtualPath: "/knowledge/nodes/node-1.md",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f17",
        knowledgeSpaceId: space.id,
        metadata: { format: "json", tableId: "table-1" },
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/readme/tables/table-1.json",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f18",
        knowledgeSpaceId: space.id,
        metadata: { format: "html", tableId: "table-1" },
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/readme/tables/table-1.html",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f19",
        knowledgeSpaceId: space.id,
        metadata: { format: "html", tableId: "table-2" },
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/readme/tables/table-2",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f1a",
        knowledgeSpaceId: space.id,
        metadata: { format: "html", tableId: "table-3" },
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/readme/tables/table-3.html",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f1b",
        knowledgeSpaceId: space.id,
        metadata: { figureId: "figure-1" },
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c55",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/readme/figures/figure-1.md",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f1c",
        knowledgeSpaceId: space.id,
        metadata: { figureId: "figure-2" },
        resourceType: "node",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c56",
        viewName: "docs",
        viewType: "physical",
        virtualPath: "/knowledge/docs/readme/figures/figure-2.md",
      }),
    );
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentAssets: assets,
      knowledgeNodes: nodes,
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
      parseArtifacts,
    });

    const statResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/stat?path=/knowledge/docs/readme.txt`,
      { headers: bearer(readToken) },
    );
    expect(statResponse.status).toBe(200);
    await expect(statResponse.json()).resolves.toMatchObject({
      metadata: { title: "Readme" },
      path: "/knowledge/docs/readme.txt",
      resourceType: "document",
      sizeBytes: objectBytes.byteLength,
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      version: 1,
    });

    const documentCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/readme.txt`,
      { headers: bearer(readToken) },
    );
    expect(documentCatResponse.status).toBe(200);
    await expect(documentCatResponse.json()).resolves.toEqual({
      contentType: "text/plain",
      path: "/knowledge/docs/readme.txt",
      text: "Document body",
      truncated: false,
    });

    const nodeCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/nodes/node-1.md`,
      { headers: bearer(readToken) },
    );
    expect(nodeCatResponse.status).toBe(200);
    await expect(nodeCatResponse.json()).resolves.toEqual({
      contentType: "text/markdown",
      path: "/knowledge/nodes/node-1.md",
      text: "Node body",
      truncated: false,
    });
    const tableJsonResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/readme/tables/table-1.json`,
      { headers: bearer(readToken) },
    );
    expect(tableJsonResponse.status).toBe(200);
    await expect(tableJsonResponse.json()).resolves.toEqual({
      contentType: "application/json",
      path: "/knowledge/docs/readme/tables/table-1.json",
      text: JSON.stringify({
        columns: ["Vendor", "Amount"],
        rows: [{ Amount: "$120", Vendor: "Acme" }],
      }),
      truncated: false,
    });

    const tableHtmlResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/readme/tables/table-1.html`,
      { headers: bearer(readToken) },
    );
    expect(tableHtmlResponse.status).toBe(200);
    await expect(tableHtmlResponse.json()).resolves.toEqual({
      contentType: "text/html",
      path: "/knowledge/docs/readme/tables/table-1.html",
      text: "<table><caption>Vendor renewal amounts</caption><thead><tr><th>Vendor</th><th>Amount</th></tr></thead><tbody><tr><td>Acme</td><td>$120</td></tr></tbody></table>",
      truncated: false,
    });
    const metadataFormatHtmlResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/readme/tables/table-2`,
      { headers: bearer(readToken) },
    );
    expect(metadataFormatHtmlResponse.status).toBe(200);
    await expect(metadataFormatHtmlResponse.json()).resolves.toEqual({
      contentType: "text/html",
      path: "/knowledge/docs/readme/tables/table-2",
      text: "<table><thead><tr><th>Amount</th><th>Vendor</th></tr></thead><tbody><tr><td>$90</td><td>Globex</td></tr></tbody></table>",
      truncated: false,
    });

    const invalidTableHtmlResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/readme/tables/table-3.html`,
      { headers: bearer(readToken) },
    );
    expect(invalidTableHtmlResponse.status).toBe(200);
    await expect(invalidTableHtmlResponse.json()).resolves.toEqual({
      contentType: "text/html",
      path: "/knowledge/docs/readme/tables/table-3.html",
      text: "<pre>not json &lt;unsafe&gt;</pre>",
      truncated: false,
    });
    const figureCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/readme/figures/figure-1.md`,
      { headers: bearer(readToken) },
    );
    expect(figureCatResponse.status).toBe(200);
    await expect(figureCatResponse.json()).resolves.toEqual({
      contentType: "text/markdown",
      path: "/knowledge/docs/readme/figures/figure-1.md",
      text: [
        "# Figure",
        "",
        "Caption: Renewal trend chart",
        "",
        "## OCR Text",
        "",
        "Q1 renewals increased 12%",
        "",
        "## Source Location",
        "",
        "- Page: 5",
        "- Section: Charts",
        "- Offsets: 180-220",
        "",
        "## Metadata",
        "",
        '```json\n{"boundingBox":{"height":120,"width":240,"x":10,"y":20},"caption":"Renewal trend chart","ocrText":"Q1 renewals increased 12%"}\n```',
      ].join("\n"),
      truncated: false,
    });
    const fallbackFigureCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/readme/figures/figure-2.md`,
      { headers: bearer(readToken) },
    );
    expect(fallbackFigureCatResponse.status).toBe(200);
    await expect(fallbackFigureCatResponse.json()).resolves.toEqual({
      contentType: "text/markdown",
      path: "/knowledge/docs/readme/figures/figure-2.md",
      text: [
        "# Figure",
        "",
        "## OCR Text",
        "",
        "Fallback OCR text",
        "",
        "## Source Location",
        "",
        "- Section: Document",
        "- Offsets: 221-260",
        "",
        "## Metadata",
        "",
        "```json\n{}\n```",
      ].join("\n"),
      truncated: false,
    });

    const nodeStatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/stat?path=/knowledge/nodes/node-1.md`,
      { headers: bearer(readToken) },
    );
    expect(nodeStatResponse.status).toBe(200);
    await expect(nodeStatResponse.json()).resolves.toEqual({
      metadata: { chunkIndex: 1 },
      path: "/knowledge/nodes/node-1.md",
      resourceType: "node",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
    });

    const unsupportedCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/artifacts/artifact.json`,
      { headers: bearer(readToken) },
    );
    expect(unsupportedCatResponse.status).toBe(404);
    const missingNodeCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/nodes/missing-node.md`,
      { headers: bearer(readToken) },
    );
    expect(missingNodeCatResponse.status).toBe(404);
    const missingAssetCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/missing-asset.txt`,
      { headers: bearer(readToken) },
    );
    expect(missingAssetCatResponse.status).toBe(404);
    const missingObjectCatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/cat?path=/knowledge/docs/missing-object.txt`,
      { headers: bearer(readToken) },
    );
    expect(missingObjectCatResponse.status).toBe(200);
    await expect(missingObjectCatResponse.json()).resolves.toEqual({
      contentType: "text/markdown",
      path: "/knowledge/docs/missing-object.txt",
      text: ["# Recovered title", "Recovered body"].join("\n\n"),
      truncated: false,
    });
    const missingAssetStatResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/stat?path=/knowledge/docs/missing-asset.txt`,
      { headers: bearer(readToken) },
    );
    expect(missingAssetStatResponse.status).toBe(404);

    const missingResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/stat?path=/knowledge/docs/missing.txt`,
      { headers: bearer(readToken) },
    );
    expect(missingResponse.status).toBe(404);
    const missingSpaceCatResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/fs/cat?path=/knowledge/docs/readme.txt",
      { headers: bearer(readToken) },
    );
    expect(missingSpaceCatResponse.status).toBe(404);
    const missingSpaceStatResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c99/fs/stat?path=/knowledge/docs/readme.txt",
      { headers: bearer(readToken) },
    );
    expect(missingSpaceStatResponse.status).toBe(404);
  });

  it("persists knowledge nodes in bounded batches and lists them by artifact offset", async () => {
    const laterNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      startOffset: 20,
      text: "Second chunk",
    });
    const earlierNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      startOffset: 0,
      text: "First chunk",
    });
    const memoryRepository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });

    await expect(memoryRepository.createMany([laterNode, earlierNode])).resolves.toEqual([
      laterNode,
      earlierNode,
    ]);
    const page = await memoryRepository.listByArtifact({
      knowledgeSpaceId: laterNode.knowledgeSpaceId,
      limit: 1,
      parseArtifactId: laterNode.parseArtifactId,
    });
    expect(page).toEqual({
      items: [earlierNode],
      nextCursor: { id: earlierNode.id, startOffset: earlierNode.startOffset },
    });
    await expect(
      memoryRepository.listByArtifact({
        cursor: page.nextCursor,
        knowledgeSpaceId: laterNode.knowledgeSpaceId,
        limit: 1,
        parseArtifactId: laterNode.parseArtifactId,
      }),
    ).resolves.toEqual({ items: [laterNode] });
    await expect(
      memoryRepository.get({
        id: earlierNode.id,
        knowledgeSpaceId: earlierNode.knowledgeSpaceId,
      }),
    ).resolves.toEqual(earlierNode);

    const stored = await memoryRepository.listByArtifact({
      knowledgeSpaceId: laterNode.knowledgeSpaceId,
      limit: 2,
      parseArtifactId: laterNode.parseArtifactId,
    });
    const storedNode = stored.items[0];
    if (!storedNode) {
      throw new Error("Expected stored knowledge node");
    }
    storedNode.metadata.changed = true;
    const storedAgain = await memoryRepository.listByArtifact({
      knowledgeSpaceId: laterNode.knowledgeSpaceId,
      limit: 2,
      parseArtifactId: laterNode.parseArtifactId,
    });
    expect(storedAgain.items[0]?.metadata).toEqual({ chunkIndex: 1 });

    await expect(memoryRepository.createMany([])).rejects.toThrow(
      "Knowledge node batch must contain at least 1 node",
    );
    await expect(
      memoryRepository.listByArtifact({
        knowledgeSpaceId: laterNode.knowledgeSpaceId,
        limit: 3,
        parseArtifactId: laterNode.parseArtifactId,
      }),
    ).rejects.toThrow("Knowledge node list limit exceeds maxListLimit=2");
    await expect(memoryRepository.createMany([laterNode, earlierNode, laterNode])).rejects.toThrow(
      "Knowledge node batch size exceeds maxBatchSize=2",
    );
    await expect(
      memoryRepository.createMany([
        knowledgeNode({
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
          startOffset: 40,
          text: "Third chunk",
        }),
      ]),
    ).rejects.toThrow("Knowledge node repository maxNodes=2 exceeded");
    const fake = createFakeKnowledgeNodeExecutor();
    const databaseRepository = createDatabaseKnowledgeNodeRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });

    await expect(databaseRepository.createMany([laterNode, earlierNode])).resolves.toEqual([
      laterNode,
      earlierNode,
    ]);
    await expect(
      databaseRepository.listByArtifact({
        knowledgeSpaceId: laterNode.knowledgeSpaceId,
        limit: 1,
        parseArtifactId: laterNode.parseArtifactId,
      }),
    ).resolves.toEqual({
      items: [earlierNode],
      nextCursor: { id: earlierNode.id, startOffset: earlierNode.startOffset },
    });
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "insert",
        tableName: "knowledge_nodes",
      }),
    );
    expect(fake.calls[1]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: [laterNode.knowledgeSpaceId, laterNode.parseArtifactId, 2],
        tableName: "knowledge_nodes",
      }),
    );
    await expect(
      databaseRepository.listByArtifact({
        cursor: { id: earlierNode.id, startOffset: earlierNode.startOffset },
        knowledgeSpaceId: laterNode.knowledgeSpaceId,
        limit: 1,
        parseArtifactId: laterNode.parseArtifactId,
      }),
    ).resolves.toEqual({ items: [laterNode] });
    expect(fake.calls[2]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: [
          laterNode.knowledgeSpaceId,
          laterNode.parseArtifactId,
          earlierNode.startOffset,
          earlierNode.id,
          2,
        ],
        tableName: "knowledge_nodes",
      }),
    );
    await expect(
      databaseRepository.get({
        id: earlierNode.id,
        knowledgeSpaceId: earlierNode.knowledgeSpaceId,
      }),
    ).resolves.toEqual(earlierNode);
    expect(fake.calls[3]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [earlierNode.knowledgeSpaceId, earlierNode.id],
        tableName: "knowledge_nodes",
      }),
    );

    const tidbFake = createFakeKnowledgeNodeExecutor();
    const tidbRepository = createDatabaseKnowledgeNodeRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await expect(tidbRepository.createMany([earlierNode])).resolves.toEqual([earlierNode]);
    expect(tidbFake.calls[0]?.sql).toContain("INSERT INTO `knowledge_nodes`");
    expect(tidbFake.calls[0]?.sql).toContain("CAST(? AS JSON)");
    expect(tidbFake.calls[0]?.sql).not.toContain("RETURNING");
  });

  it("stores embedding model registry entries with bounded indexed repositories", async () => {
    const model: EmbeddingModel = EmbeddingModelSchema.parse({
      createdAt: "2026-05-12T08:00:00.000Z",
      dimension: 1536,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
      maxTokens: 8192,
      metadata: { release: "stable" },
      metric: "cosine",
      modelId: "text-embedding-3-small",
      provider: "openai",
      status: "active",
      tokenizer: "cl100k_base",
      updatedAt: "2026-05-12T08:00:00.000Z",
      version: "2026-05-01",
    });
    const secondModel = EmbeddingModelSchema.parse({
      ...model,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
      modelId: "text-embedding-3-large",
      status: "candidate",
      version: "2026-05-02",
    });
    const memoryRegistry = createInMemoryEmbeddingModelRegistry({
      maxListLimit: 1,
      maxModels: 2,
    });

    await expect(memoryRegistry.register(model)).resolves.toEqual(model);
    await expect(memoryRegistry.register(secondModel)).resolves.toEqual(secondModel);
    await expect(
      memoryRegistry.register(
        EmbeddingModelSchema.parse({ ...model, metadata: { release: "v2" } }),
      ),
    ).resolves.toMatchObject({ metadata: { release: "v2" } });
    await expect(
      memoryRegistry.get({ modelId: model.modelId, version: model.version }),
    ).resolves.toMatchObject({ metadata: { release: "v2" } });
    await expect(
      memoryRegistry.register(
        EmbeddingModelSchema.parse({ ...model, metadata: { release: "stable" } }),
      ),
    ).resolves.toEqual(model);
    await expect(memoryRegistry.list({ limit: 1, status: "active" })).resolves.toEqual({
      items: [model],
    });
    const loaded = await memoryRegistry.get({
      modelId: "text-embedding-3-small",
      version: "2026-05-01",
    });

    if (!loaded) {
      throw new Error("Expected embedding model");
    }

    loaded.metadata.release = "mutated";
    await expect(
      memoryRegistry.get({ modelId: "text-embedding-3-small", version: "2026-05-01" }),
    ).resolves.toMatchObject({ metadata: { release: "stable" } });
    await expect(memoryRegistry.list({ limit: 2, status: "active" })).rejects.toThrow(
      "Embedding model registry list limit exceeds maxListLimit=1",
    );
    await expect(memoryRegistry.list({ limit: 0, status: "active" })).rejects.toThrow(
      "Embedding model registry list limit must be at least 1",
    );
    await expect(memoryRegistry.get({ modelId: " ", version: model.version })).rejects.toThrow(
      "Embedding model modelId is required",
    );
    await expect(memoryRegistry.get({ modelId: model.modelId, version: " " })).rejects.toThrow(
      "Embedding model version is required",
    );
    await expect(
      memoryRegistry.register(
        EmbeddingModelSchema.parse({
          ...model,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
          modelId: "voyage-3",
        }),
      ),
    ).rejects.toThrow("Embedding model registry maxModels=2 exceeded");
    expect(() => createInMemoryEmbeddingModelRegistry({ maxListLimit: 1, maxModels: 0 })).toThrow(
      "Embedding model registry maxModels must be at least 1",
    );
    expect(() => createInMemoryEmbeddingModelRegistry({ maxListLimit: 0, maxModels: 1 })).toThrow(
      "Embedding model registry maxListLimit must be at least 1",
    );

    const pagedRegistry = createInMemoryEmbeddingModelRegistry({
      maxListLimit: 2,
      maxModels: 2,
    });
    await pagedRegistry.register(model);
    await pagedRegistry.register(
      EmbeddingModelSchema.parse({
        ...model,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f04",
        modelId: "text-embedding-3-tiny",
      }),
    );
    const firstPage = await pagedRegistry.list({ limit: 1, provider: "openai", status: "active" });

    expect(firstPage.nextCursor).toEqual({
      id: model.id,
      modelId: model.modelId,
    });
    await expect(
      pagedRegistry.list({
        cursor: firstPage.nextCursor,
        limit: 1,
        status: "active",
      }),
    ).resolves.toMatchObject({ items: [{ modelId: "text-embedding-3-tiny" }] });
    await expect(
      pagedRegistry.get({ modelId: "missing-model", version: "2026-05-01" }),
    ).resolves.toBeNull();

    const fake = createFakeEmbeddingModelExecutor();
    const databaseRegistry = createDatabaseEmbeddingModelRegistry({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxListLimit: 10,
    });
    const databaseSecondModel = EmbeddingModelSchema.parse({
      ...model,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f05",
      modelId: "text-embedding-3-tiny",
    });
    const promotedModel = EmbeddingModelSchema.parse({
      ...model,
      metadata: { promotedBy: "review" },
      status: "active",
      updatedAt: "2026-05-12T10:00:00.000Z",
    });

    await expect(databaseRegistry.register(model)).resolves.toEqual(model);
    await expect(databaseRegistry.register(promotedModel)).resolves.toMatchObject({
      metadata: { promotedBy: "review" },
      status: "active",
      updatedAt: "2026-05-12T10:00:00.000Z",
    });
    expect(fake.calls.at(-1)?.sql).toContain('ON CONFLICT ("model_id", "version") DO UPDATE');
    await expect(
      databaseRegistry.get({ modelId: model.modelId, version: model.version }),
    ).resolves.toMatchObject({
      metadata: { promotedBy: "review" },
      status: "active",
      updatedAt: "2026-05-12T10:00:00.000Z",
    });
    await expect(databaseRegistry.register(databaseSecondModel)).resolves.toEqual(
      databaseSecondModel,
    );
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "embedding_models",
      }),
    );
    expect(fake.calls[0]?.sql).toContain('"embedding_models"');
    expect(fake.calls[0]?.sql).not.toContain("text-embedding-3-small");
    expect(fake.calls[0]?.params).toEqual([
      model.id,
      model.provider,
      model.modelId,
      model.version,
      model.dimension,
      model.metric,
      model.tokenizer,
      model.maxTokens,
      model.status,
      JSON.stringify(model.metadata),
      model.createdAt,
      model.updatedAt,
    ]);
    await expect(
      databaseRegistry.get({ modelId: model.modelId, version: model.version }),
    ).resolves.toEqual(promotedModel);
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [model.modelId, model.version],
        tableName: "embedding_models",
      }),
    );
    await expect(
      databaseRegistry.get({ modelId: "missing-model", version: model.version }),
    ).resolves.toBeNull();
    const databaseFirstPage = await databaseRegistry.list({
      limit: 1,
      provider: "openai",
      status: "active",
    });

    expect(databaseFirstPage).toEqual({
      items: [promotedModel],
      nextCursor: { id: model.id, modelId: model.modelId },
    });
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: ["active", "openai", 2],
        tableName: "embedding_models",
      }),
    );
    await expect(
      databaseRegistry.list({
        cursor: databaseFirstPage.nextCursor,
        limit: 1,
        status: "active",
      }),
    ).resolves.toEqual({ items: [databaseSecondModel] });
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: ["active", model.modelId, model.id, 2],
        tableName: "embedding_models",
      }),
    );
    expect(fake.calls.at(-1)?.sql).not.toContain("IS NULL OR");
    await expect(databaseRegistry.list({ limit: 11, status: "active" })).rejects.toThrow(
      "Embedding model registry list limit exceeds maxListLimit=10",
    );

    const tidbRegistry = createDatabaseEmbeddingModelRegistry({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          fake.calls.push({ ...input, params: [...input.params] });

          return { rows: [], rowsAffected: 1 };
        },
        kind: "tidb",
      }),
      maxListLimit: 10,
    });
    await expect(tidbRegistry.register(model)).resolves.toEqual(model);
    expect(fake.calls.at(-1)?.sql).toContain("INSERT INTO `embedding_models`");
    expect(fake.calls.at(-1)?.sql).toContain("CAST(? AS JSON)");
    expect(fake.calls.at(-1)?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(fake.calls.at(-1)?.sql).not.toContain("RETURNING");
  });

  it("queues and runs embedding model upgrades through evaluation-gated publication", async () => {
    const firstNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
      startOffset: 0,
      text: "First chunk",
    });
    const secondNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
      startOffset: 20,
      text: "Second chunk",
    });
    const candidate = EmbeddingModelSchema.parse({
      createdAt: "2026-05-12T08:00:00.000Z",
      dimension: 2,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f10",
      maxTokens: 8192,
      metadata: {},
      metric: "cosine",
      modelId: "static-upgrade",
      provider: "static",
      status: "candidate",
      tokenizer: "static-tokenizer",
      updatedAt: "2026-05-12T08:00:00.000Z",
      version: "2026-05-01",
    });
    const rejectedCandidate = EmbeddingModelSchema.parse({
      ...candidate,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f11",
      status: "candidate",
      version: "2026-06-01",
    });
    const queue = new RecordingUpgradeQueue();
    const models = createInMemoryEmbeddingModelRegistry({ maxListLimit: 10, maxModels: 4 });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 2,
      maxListLimit: 10,
      maxProjections: 10,
    });
    const embedding = createRecordingEmbeddingProvider();
    const denseBuilder = createDenseVectorProjectionBuilder({
      embeddings: embedding.provider,
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d30",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated id available");
          }
          return id;
        };
      })(),
      maxBatchSize: 2,
      projections,
    });
    const evaluationCalls: unknown[] = [];
    const reports = [
      {
        items: [],
        metrics: {
          citationHitRate: 1,
          noAnswerRate: 0,
          recallAtK: 1,
          totalQuestions: 3,
        },
      },
      {
        items: [],
        metrics: {
          citationHitRate: 0.4,
          noAnswerRate: 0.2,
          recallAtK: 0.5,
          totalQuestions: 3,
        },
      },
    ];
    const workflow = createEmbeddingModelUpgradeWorkflow({
      denseBuilder,
      evaluation: {
        run: async (input) => {
          evaluationCalls.push({ ...input });
          const report = reports.shift();
          if (!report) {
            throw new Error("No evaluation report available");
          }
          return report;
        },
      },
      jobs: queue,
      maxNodes: 2,
      models,
      now: () => "2026-05-12T09:00:00.000Z",
      projections,
    });

    expect(() =>
      createEmbeddingModelUpgradeWorkflow({
        denseBuilder,
        evaluation: {
          run: async () => ({
            items: [],
            metrics: {
              citationHitRate: 1,
              noAnswerRate: 0,
              recallAtK: 1,
              totalQuestions: 1,
            },
          }),
        },
        jobs: queue,
        maxNodes: 0,
        models,
        projections,
      }),
    ).toThrow("Embedding model upgrade maxNodes must be at least 1");
    await expect(
      workflow.start({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        model: candidate,
        projectionVersion: 2,
      }),
    ).resolves.toEqual({
      model: candidate,
      queueJobId: "upgrade-queue-1",
    });
    expect(queue.enqueued).toEqual([
      {
        idempotencyKey: `${firstNode.knowledgeSpaceId}:static-upgrade:2026-05-01:2`,
        payload: {
          knowledgeSpaceId: firstNode.knowledgeSpaceId,
          modelId: "static-upgrade",
          modelVersion: "2026-05-01",
          projectionVersion: 2,
        },
        type: "embedding-model.upgrade",
      },
    ]);
    await expect(
      workflow.start({
        knowledgeSpaceId: " ",
        model: candidate,
        projectionVersion: 2,
      }),
    ).rejects.toThrow("Embedding model upgrade knowledgeSpaceId is required");
    await expect(
      workflow.start({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        model: candidate,
        projectionVersion: 0,
      }),
    ).rejects.toThrow("Embedding model upgrade projectionVersion must be a positive integer");

    const published = await workflow.run({
      evaluation: {
        limit: 3,
        thresholds: {
          maxNoAnswerRate: 0.1,
          minCitationHitRate: 0.9,
          minRecallAtK: 0.9,
        },
        topK: 5,
      },
      knowledgeSpaceId: firstNode.knowledgeSpaceId,
      modelId: candidate.modelId,
      modelVersion: candidate.version,
      nodes: [firstNode, secondNode],
      projectionVersion: 2,
    });

    expect(embedding.calls[0]).toEqual({
      inputType: "search_document",
      model: "static-upgrade@2026-05-01",
      texts: ["First chunk", "Second chunk"],
    });
    expect(evaluationCalls[0]).toEqual({
      denseProjectionModel: "static-upgrade@2026-05-01",
      denseProjectionStatuses: ["building"],
      denseProjectionVersion: 2,
      embeddingModel: "static-upgrade@2026-05-01",
      knowledgeSpaceId: firstNode.knowledgeSpaceId,
      limit: 3,
      topK: 5,
    });
    expect(published).toEqual({
      decision: "published",
      evaluation: {
        items: [],
        metrics: {
          citationHitRate: 1,
          noAnswerRate: 0,
          recallAtK: 1,
          totalQuestions: 3,
        },
      },
      model: expect.objectContaining({
        metadata: { upgradedFromStatus: "candidate" },
        status: "active",
        updatedAt: "2026-05-12T09:00:00.000Z",
      }),
      published: { published: 2, staled: 0 },
      projectionsBuilt: 2,
    });
    await expect(
      projections.listReadyBySpace({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        limit: 10,
        type: "dense-vector",
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({ projectionVersion: 2, status: "ready" }),
        expect.objectContaining({ projectionVersion: 2, status: "ready" }),
      ],
    });

    await models.register(rejectedCandidate);
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: rejectedCandidate.modelId,
        modelVersion: rejectedCandidate.version,
        nodes: [firstNode],
        projectionVersion: 3,
      }),
    ).resolves.toEqual({
      decision: "rejected",
      evaluation: {
        items: [],
        metrics: {
          citationHitRate: 0.4,
          noAnswerRate: 0.2,
          recallAtK: 0.5,
          totalQuestions: 3,
        },
      },
      model: expect.objectContaining({
        metadata: {
          upgradeRejectedReason:
            "recallAtK 0.5 < 0.9; citationHitRate 0.4 < 0.9; noAnswerRate 0.2 > 0.1",
          upgradedFromStatus: "candidate",
        },
        status: "disabled",
        updatedAt: "2026-05-12T09:00:00.000Z",
      }),
      projectionsBuilt: 1,
      rejectedReason: "recallAtK 0.5 < 0.9; citationHitRate 0.4 < 0.9; noAnswerRate 0.2 > 0.1",
      rollback: { failed: 1 },
    });
    await expect(
      models.get({ modelId: rejectedCandidate.modelId, version: rejectedCandidate.version }),
    ).resolves.toMatchObject({ status: "disabled" });
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 2,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: candidate.modelId,
        modelVersion: candidate.version,
        nodes: [firstNode],
        projectionVersion: 4,
      }),
    ).rejects.toThrow("Embedding model upgrade threshold minRecallAtK must be between 0 and 1");
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: candidate.modelId,
        modelVersion: candidate.version,
        nodes: [],
        projectionVersion: 4,
      }),
    ).rejects.toThrow("Embedding model upgrade node batch must contain at least 1 node");
    await expect(
      workflow.run({
        evaluation: {
          limit: 0,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: candidate.modelId,
        modelVersion: candidate.version,
        nodes: [firstNode],
        projectionVersion: 4,
      }),
    ).rejects.toThrow("Embedding model upgrade evaluation limit must be at least 1");
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 0,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: candidate.modelId,
        modelVersion: candidate.version,
        nodes: [firstNode],
        projectionVersion: 4,
      }),
    ).rejects.toThrow("Embedding model upgrade evaluation topK must be at least 1");
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: candidate.modelId,
        modelVersion: candidate.version,
        nodes: [
          KnowledgeNodeSchema.parse({
            ...firstNode,
            knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          }),
        ],
        projectionVersion: 4,
      }),
    ).rejects.toThrow(
      "Embedding model upgrade nodes must belong to the requested knowledgeSpaceId",
    );
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: candidate.modelId,
        modelVersion: candidate.version,
        nodes: [firstNode],
        projectionVersion: 4,
      }),
    ).rejects.toThrow("Embedding model upgrade requires a candidate model");
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: "missing-model",
        modelVersion: "2026-01-01",
        nodes: [firstNode],
        projectionVersion: 4,
      }),
    ).rejects.toThrow("Embedding model missing-model@2026-01-01 not found");
    await expect(
      workflow.run({
        evaluation: {
          limit: 3,
          thresholds: {
            maxNoAnswerRate: 0.1,
            minCitationHitRate: 0.9,
            minRecallAtK: 0.9,
          },
          topK: 5,
        },
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        modelId: candidate.modelId,
        modelVersion: candidate.version,
        nodes: [firstNode, secondNode, firstNode],
        projectionVersion: 4,
      }),
    ).rejects.toThrow("Embedding model upgrade node batch exceeds maxNodes=2");
  });

  it("builds and persists dense vector projections in bounded batches", async () => {
    const firstNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60",
      startOffset: 0,
      text: "First chunk",
    });
    const secondNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
      startOffset: 20,
      text: "Second chunk",
    });
    const embedding = createRecordingEmbeddingProvider();
    const memoryRepository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxProjections: 2,
    });
    const builder = createDenseVectorProjectionBuilder({
      embeddings: embedding.provider,
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated id available");
          }
          return id;
        };
      })(),
      maxBatchSize: 2,
      projections: memoryRepository,
    });

    const projections = await builder.build({
      model: "static-dense",
      nodes: [firstNode, secondNode],
      projectionVersion: 1,
    });

    expect(embedding.calls).toEqual([
      {
        inputType: "search_document",
        model: "static-dense",
        texts: ["First chunk", "Second chunk"],
      },
    ]);
    expect(projections).toEqual([
      expect.objectContaining({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        metadata: expect.objectContaining({
          artifactHash: firstNode.artifactHash,
          denseVector: [0.1, 11],
          dimension: 2,
          embeddingProvider: "static",
          modelVersion: "static-dense",
        }),
        model: "static-dense",
        nodeId: firstNode.id,
        projectionVersion: 1,
        status: "ready",
        type: "dense-vector",
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({ denseVector: [1.1, 12] }),
        nodeId: secondNode.id,
      }),
    ]);
    const firstProjection = projections[0];
    if (!firstProjection) {
      throw new Error("Expected first projection");
    }
    const secondProjection = projections[1];
    if (!secondProjection) {
      throw new Error("Expected second projection");
    }
    const listed = await memoryRepository.listReadyBySpace({
      knowledgeSpaceId: firstNode.knowledgeSpaceId,
      limit: 1,
      type: "dense-vector",
    });
    expect(listed).toEqual({
      items: [firstProjection],
      nextCursor: { id: firstProjection.id, nodeId: firstNode.id },
    });
    const listedProjection = listed.items[0];
    if (!listedProjection) {
      throw new Error("Expected listed projection");
    }
    listedProjection.metadata.denseVector = [99];
    expect(
      (
        await memoryRepository.listReadyBySpace({
          knowledgeSpaceId: firstNode.knowledgeSpaceId,
          limit: 2,
          type: "dense-vector",
        })
      ).items[0]?.metadata,
    ).toEqual(expect.objectContaining({ denseVector: [0.1, 11] }));
    await expect(
      memoryRepository.listReadyBySpace({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        limit: 3,
        type: "dense-vector",
      }),
    ).rejects.toThrow("Index projection list limit exceeds maxListLimit=2");
    await expect(memoryRepository.createMany([])).rejects.toThrow(
      "Index projection batch must contain at least 1 projection",
    );
    await expect(
      memoryRepository.createMany([firstProjection, firstProjection, firstProjection]),
    ).rejects.toThrow("Index projection batch size exceeds maxBatchSize=2");
    await expect(
      memoryRepository.createMany([
        IndexProjectionSchema.parse({
          ...firstProjection,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03",
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
        }),
      ]),
    ).rejects.toThrow("Index projection repository maxProjections=2 exceeded");
    expect(() =>
      createInMemoryIndexProjectionRepository({
        maxBatchSize: 0,
        maxListLimit: 1,
        maxProjections: 1,
      }),
    ).toThrow("Index projection repository maxBatchSize must be at least 1");
    expect(() =>
      createInMemoryIndexProjectionRepository({
        maxBatchSize: 1,
        maxListLimit: 0,
        maxProjections: 1,
      }),
    ).toThrow("Index projection repository maxListLimit must be at least 1");
    expect(() =>
      createInMemoryIndexProjectionRepository({
        maxBatchSize: 1,
        maxListLimit: 1,
        maxProjections: 0,
      }),
    ).toThrow("Index projection repository maxProjections must be at least 1");

    const versionedRepository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 1,
      maxListLimit: 10,
      maxProjections: 4,
    });
    const versionedBuilder = createDenseVectorProjectionBuilder({
      embeddings: createRecordingEmbeddingProvider().provider,
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated id available");
          }
          return id;
        };
      })(),
      maxBatchSize: 1,
      projections: versionedRepository,
    });
    const [activeProjection] = await versionedBuilder.build({
      model: "static-dense",
      nodes: [firstNode],
      projectionVersion: 1,
    });
    const [candidateProjection] = await versionedBuilder.build({
      model: "static-dense",
      nodes: [firstNode],
      projectionVersion: 2,
      status: "building",
    });

    expect(candidateProjection).toEqual(
      expect.objectContaining({
        nodeId: firstNode.id,
        projectionVersion: 2,
        status: "building",
      }),
    );
    await expect(
      versionedRepository.listReadyBySpace({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        limit: 10,
        type: "dense-vector",
      }),
    ).resolves.toEqual({ items: [activeProjection] });
    await expect(
      versionedRepository.summarizeVersion({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).resolves.toEqual({
      building: 1,
      failed: 0,
      ready: 0,
      stale: 0,
      total: 1,
    });
    await expect(
      versionedRepository.publishVersion({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).resolves.toEqual({ published: 1, staled: 1 });
    await expect(
      versionedRepository.listReadyBySpace({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        limit: 10,
        type: "dense-vector",
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: candidateProjection?.id,
          projectionVersion: 2,
          status: "ready",
        }),
      ],
    });
    const [rollbackCandidate] = await versionedBuilder.build({
      model: "static-dense",
      nodes: [firstNode],
      projectionVersion: 3,
      status: "building",
    });
    await expect(
      versionedRepository.rollbackVersion({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        projectionVersion: 3,
        type: "dense-vector",
      }),
    ).resolves.toEqual({ failed: 1 });
    await expect(
      versionedRepository.summarizeVersion({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        projectionVersion: 3,
        type: "dense-vector",
      }),
    ).resolves.toEqual({
      building: 0,
      failed: 1,
      ready: 0,
      stale: 0,
      total: 1,
    });
    expect(rollbackCandidate?.status).toBe("building");

    await expect(
      builder.build({ model: "static-dense", nodes: [], projectionVersion: 1 }),
    ).rejects.toThrow("Dense vector projection batch must contain at least 1 node");
    await expect(
      builder.build({
        model: "static-dense",
        nodes: [firstNode, secondNode, firstNode],
        projectionVersion: 1,
      }),
    ).rejects.toThrow("Dense vector projection batch size exceeds maxBatchSize=2");
    await expect(
      builder.build({ model: "static-dense", nodes: [firstNode], projectionVersion: 0 }),
    ).rejects.toThrow("Dense vector projection version must be a positive integer");
    const mismatch = createDenseVectorProjectionBuilder({
      embeddings: createRecordingEmbeddingProvider({ mismatch: true }).provider,
      maxBatchSize: 2,
      projections: memoryRepository,
    });
    await expect(
      mismatch.build({
        model: "static-dense",
        nodes: [firstNode, secondNode],
        projectionVersion: 1,
      }),
    ).rejects.toThrow("Embedding provider returned 1 vectors for 2 nodes");

    const fake = createFakeIndexProjectionExecutor();
    const databaseRepository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await expect(databaseRepository.createMany(projections)).resolves.toEqual(projections);
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "insert",
        tableName: "index_projections",
      }),
    );
    expect(fake.calls[0]?.sql).toContain("dense_vector");
    expect(fake.calls[0]?.sql).not.toContain("First chunk");
    expect(fake.calls[0]?.params).toContain("[0.1,11]");
    expect(fake.calls[0]?.params).toContain(JSON.stringify(firstProjection.metadata));
    await expect(
      databaseRepository.listReadyBySpace({
        limit: 1,
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        type: "dense-vector",
      }),
    ).resolves.toEqual({
      items: [firstProjection],
      nextCursor: { id: firstProjection.id, nodeId: firstNode.id },
    });
    expect(fake.calls[1]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: [firstNode.knowledgeSpaceId, "dense-vector", "ready", 2],
        tableName: "index_projections",
      }),
    );
    await expect(
      databaseRepository.listReadyBySpace({
        cursor: { id: firstProjection.id, nodeId: firstNode.id },
        limit: 1,
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        type: "dense-vector",
      }),
    ).resolves.toEqual({ items: [secondProjection] });
    await expect(
      databaseRepository.createMany([
        IndexProjectionSchema.parse({
          ...firstProjection,
          metadata: { ...firstProjection.metadata, denseVector: "bad" },
        }),
      ]),
    ).rejects.toThrow("Dense vector projection metadata must include denseVector");
    const ftsProjection = IndexProjectionSchema.parse({
      ...firstProjection,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04",
      metadata: {},
      type: "metadata",
    });
    const ftsFake = createFakeIndexProjectionExecutor();
    const ftsRepository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({ executor: ftsFake.executor, kind: "postgres" }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await expect(ftsRepository.createMany([ftsProjection])).resolves.toEqual([ftsProjection]);
    expect(ftsFake.calls[0]?.params).toContain(null);

    const tidbFake = createFakeIndexProjectionExecutor();
    const tidbRepository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await expect(tidbRepository.createMany([firstProjection])).resolves.toEqual([firstProjection]);
    expect(tidbFake.calls[0]?.sql).toContain("INSERT INTO `index_projections`");
    expect(tidbFake.calls[0]?.sql).toContain("CAST(? AS VECTOR)");
    expect(tidbFake.calls[0]?.sql).not.toContain("RETURNING");

    const publicationFake = createFakeIndexProjectionExecutor();
    const publicationRepository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({
        executor: publicationFake.executor,
        kind: "postgres",
      }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await publicationRepository.createMany([
      firstProjection,
      IndexProjectionSchema.parse({
        ...firstProjection,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d20",
        projectionVersion: 2,
        status: "building",
      }),
    ]);
    await expect(
      publicationRepository.publishVersion({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).resolves.toEqual({ published: 1, staled: 1 });
    expect(publicationFake.calls.at(-2)).toEqual(
      expect.objectContaining({
        operation: "update",
        params: ["ready", firstNode.knowledgeSpaceId, "dense-vector", 2, "building"],
        tableName: "index_projections",
      }),
    );
    expect(publicationFake.calls.at(-1)).toEqual(
      expect.objectContaining({
        operation: "update",
        params: ["stale", firstNode.knowledgeSpaceId, "dense-vector", "ready", 2],
        tableName: "index_projections",
      }),
    );

    const cleanupRepository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 3,
    });
    const cleanupReady = IndexProjectionSchema.parse({
      ...firstProjection,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d30",
      projectionVersion: 3,
      status: "ready",
    });
    const cleanupStale = IndexProjectionSchema.parse({
      ...firstProjection,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
      projectionVersion: 2,
      status: "stale",
    });
    const cleanupFailed = IndexProjectionSchema.parse({
      ...firstProjection,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
      projectionVersion: 1,
      status: "failed",
    });
    await cleanupRepository.createMany([cleanupReady, cleanupStale, cleanupFailed]);
    await expect(
      cleanupRepository.pruneInactiveVersions({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        maxProjections: 1,
        retainVersions: 1,
        type: "dense-vector",
      }),
    ).rejects.toThrow("Index projection prune maxProjections=1 exceeded");
    await expect(
      cleanupRepository.pruneInactiveVersions({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        maxProjections: 3,
        retainVersions: 1,
        type: "dense-vector",
      }),
    ).resolves.toBe(2);
    await expect(
      cleanupRepository.listReadyBySpace({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        limit: 10,
        type: "dense-vector",
      }),
    ).resolves.toEqual({ items: [cleanupReady] });
    await expect(
      cleanupRepository.pruneInactiveVersions({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        maxProjections: 1,
        retainVersions: 0,
        type: "dense-vector",
      }),
    ).rejects.toThrow("Index projection prune retainVersions must be at least 1");

    const cleanupFake = createFakeIndexProjectionExecutor();
    const cleanupDatabaseRepository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({ executor: cleanupFake.executor, kind: "postgres" }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await expect(
      cleanupDatabaseRepository.pruneInactiveVersions({
        knowledgeSpaceId: firstNode.knowledgeSpaceId,
        maxProjections: 10,
        retainVersions: 2,
        type: "dense-vector",
      }),
    ).resolves.toBe(0);
    expect(cleanupFake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 10,
        operation: "delete",
        params: [firstNode.knowledgeSpaceId, "dense-vector", 2, 10],
        tableName: "index_projections",
      }),
    );
    expect(cleanupFake.calls[0]?.sql).not.toContain(firstNode.knowledgeSpaceId);
  });

  it("builds and persists FTS projections in bounded batches", async () => {
    const firstNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c70",
      startOffset: 0,
      text: "Contract ABC-123 renewal terms",
    });
    const secondNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c71",
      startOffset: 40,
      text: "Error code E-42 remediation",
    });
    const memoryRepository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxProjections: 2,
    });
    const builder = createFtsProjectionBuilder({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated id available");
          }
          return id;
        };
      })(),
      maxBatchSize: 2,
      projections: memoryRepository,
    });

    const projections = await builder.build({
      nodes: [firstNode, secondNode],
      projectionVersion: 1,
    });
    const firstProjection = projections[0];
    if (!firstProjection) {
      throw new Error("Expected first FTS projection");
    }

    expect(projections).toEqual([
      expect.objectContaining({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01",
        metadata: expect.objectContaining({
          artifactHash: firstNode.artifactHash,
          ftsLanguageStrategy: "mixed-cjk-latin-v1",
          ftsText: "contract abc 123 renewal terms",
          parser: "database-fts",
        }),
        model: "database-fts@1",
        nodeId: firstNode.id,
        projectionVersion: 1,
        status: "ready",
        type: "fts",
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({ ftsText: "error code e 42 remediation" }),
        nodeId: secondNode.id,
      }),
    ]);
    await expect(builder.build({ nodes: [], projectionVersion: 1 })).rejects.toThrow(
      "FTS projection batch must contain at least 1 node",
    );
    await expect(
      builder.build({ nodes: [firstNode, secondNode, firstNode], projectionVersion: 1 }),
    ).rejects.toThrow("FTS projection batch size exceeds maxBatchSize=2");

    const fake = createFakeIndexProjectionExecutor();
    const databaseRepository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await expect(databaseRepository.createMany(projections)).resolves.toEqual(projections);
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "insert",
        tableName: "index_projections",
      }),
    );
    expect(fake.calls[0]?.sql).toContain("to_tsvector('simple'");
    expect(fake.calls[0]?.sql).not.toContain("Contract ABC-123");
    expect(fake.calls[0]?.params).toContain("contract abc 123 renewal terms");
    expect(fake.calls[0]?.params).toContain(JSON.stringify(firstProjection.metadata));
    const tidbFake = createFakeIndexProjectionExecutor();
    const tidbRepository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({
        executor: tidbFake.executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: tidbFake.executor }),
      }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await expect(tidbRepository.createMany([firstProjection])).resolves.toEqual([firstProjection]);
    expect(tidbFake.calls[0]?.sql).toContain("INSERT INTO `index_projections`");
    expect(tidbFake.calls[0]?.sql).not.toContain("to_tsvector");
    expect(tidbFake.calls[0]?.params).toContain("contract abc 123 renewal terms");
  });

  it("idempotently reindexes parse artifacts so interrupted projection builds can be repaired", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
    const parseArtifact = (id: string, artifactHash: string) =>
      ParseArtifactSchema.parse({
        artifactHash,
        contentType: "text",
        createdAt: "2026-05-12T12:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: `${id}:element-1`,
            metadata: {},
            sectionPath: ["Policy"],
            text: "Changed policy chunk",
            type: "paragraph",
          },
        ],
        id,
        metadata: { filename: "policy.md" },
        parser: "native-markdown",
        version: 1,
      });
    const existingArtifact = parseArtifact("018f0d60-7a49-7cc2-9c1b-5b36f18f2e10", "a".repeat(64));
    const changedArtifact = parseArtifact("018f0d60-7a49-7cc2-9c1b-5b36f18f2e11", "b".repeat(64));
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxProjections: 4,
    });
    await artifacts.create(existingArtifact);
    const chunkCalls: unknown[] = [];
    const compute: ComputeRuntime = {
      chunkParseArtifact(input) {
        chunkCalls.push(input);
        return [
          KnowledgeNodeSchema.parse({
            ...knowledgeNode({
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e20",
              startOffset: 0,
              text: "Changed policy chunk",
            }),
            artifactHash: input.parseArtifact.artifactHash,
            parseArtifactId: input.parseArtifact.id,
            permissionScope: [...(input.permissionScope ?? [])],
          }),
        ];
      },
      countApproxTokens: () => 1,
      countTokens: () => 1,
      diffText: () => ({ operations: [], stats: { delete: 0, equal: 0, insert: 0 } }),
      packEvidence: () => ({
        context: "",
        items: [],
        omitted: [],
        tokenBudget: 1,
        usedTokens: 0,
      }),
      rrfFuse: () => [],
    };
    const ftsBuilder = createFtsProjectionBuilder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2e30",
      maxBatchSize: 4,
      projections,
    });
    const reindexer = createIncrementalReindexer({
      artifacts,
      compute,
      ftsBuilder,
      maxNodes: 4,
      nodes,
    });

    await expect(
      reindexer.reindex({
        knowledgeSpaceId,
        parseArtifact: existingArtifact,
        projectionStatus: "ready",
        projectionVersion: 2,
      }),
    ).resolves.toEqual({
      artifact: existingArtifact,
      nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2e20"],
      nodesCreated: 1,
      projectionIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2e30"],
      projectionsCreated: 1,
      status: "rebuilt",
    });
    expect(chunkCalls).toHaveLength(1);

    await expect(
      reindexer.reindex({
        knowledgeSpaceId,
        parseArtifact: changedArtifact,
        permissionScope: ["tenant:tenant-1"],
        projectionStatus: "ready",
        projectionVersion: 2,
      }),
    ).resolves.toMatchObject({
      artifact: expect.objectContaining({
        artifactHash: changedArtifact.artifactHash,
        id: existingArtifact.id,
      }),
      nodesCreated: 1,
      projectionsCreated: 1,
      status: "rebuilt",
    });
    expect(chunkCalls).toHaveLength(2);
    expect(chunkCalls[1]).toMatchObject({
      knowledgeSpaceId,
      parseArtifact: expect.objectContaining({
        artifactHash: changedArtifact.artifactHash,
        id: existingArtifact.id,
      }),
      permissionScope: ["tenant:tenant-1"],
    });
    await expect(
      nodes.listByArtifact({
        knowledgeSpaceId,
        limit: 4,
        parseArtifactId: existingArtifact.id,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          artifactHash: changedArtifact.artifactHash,
          parseArtifactId: existingArtifact.id,
          text: "Changed policy chunk",
        },
      ],
    });
    await expect(
      projections.listReadyBySpace({
        knowledgeSpaceId,
        limit: 4,
        type: "fts",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          metadata: {
            artifactHash: changedArtifact.artifactHash,
            parseArtifactId: existingArtifact.id,
          },
          projectionVersion: 2,
          status: "ready",
          type: "fts",
        },
      ],
    });

    expect(() =>
      createIncrementalReindexer({
        artifacts,
        compute,
        maxNodes: 0,
        nodes,
      }),
    ).toThrow("Incremental reindexer maxNodes must be at least 1");
    await expect(
      createIncrementalReindexer({
        artifacts,
        compute,
        denseBuilder: {
          build: async () => [],
        },
        maxNodes: 4,
        nodes,
      }).reindex({
        knowledgeSpaceId,
        parseArtifact: ParseArtifactSchema.parse({
          ...changedArtifact,
          artifactHash: "c".repeat(64),
        }),
        projectionVersion: 2,
      }),
    ).rejects.toThrow(
      "Incremental reindexer denseModel is required when denseBuilder is configured",
    );

    await nodes.deleteByDocumentAsset({ documentAssetId, knowledgeSpaceId, maxNodes: 4 });
    const denseBuilds: unknown[] = [];
    await expect(
      createIncrementalReindexer({
        artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
        compute,
        denseBuilder: {
          build: async (input) => {
            denseBuilds.push(input);
            return [
              IndexProjectionSchema.parse({
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e31",
                knowledgeSpaceId,
                metadata: { model: input.model },
                model: input.model,
                nodeId: input.nodes[0]?.id,
                projectionVersion: input.projectionVersion,
                status: input.status ?? "building",
                type: "dense-vector",
              }),
            ];
          },
        },
        maxNodes: 4,
        nodes,
      }).reindex({
        denseModel: "static-embedding@1",
        knowledgeSpaceId,
        parseArtifact: ParseArtifactSchema.parse({
          ...changedArtifact,
          artifactHash: "d".repeat(64),
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e12",
        }),
        projectionVersion: 3,
      }),
    ).resolves.toMatchObject({ nodesCreated: 1, projectionsCreated: 1, status: "rebuilt" });
    expect(denseBuilds).toEqual([
      expect.objectContaining({
        model: "static-embedding@1",
        projectionVersion: 3,
      }),
    ]);

    await expect(
      createIncrementalReindexer({
        artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
        compute: {
          ...compute,
          chunkParseArtifact: (input) => [
            ...compute.chunkParseArtifact(input),
            KnowledgeNodeSchema.parse({
              ...knowledgeNode({
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e21",
                startOffset: 30,
                text: "Second changed policy chunk",
              }),
              artifactHash: input.parseArtifact.artifactHash,
              parseArtifactId: input.parseArtifact.id,
            }),
          ],
        },
        maxNodes: 1,
        nodes,
      }).reindex({
        knowledgeSpaceId,
        parseArtifact: ParseArtifactSchema.parse({
          ...changedArtifact,
          artifactHash: "e".repeat(64),
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e13",
        }),
        projectionVersion: 3,
      }),
    ).rejects.toThrow("Incremental reindexer node count exceeds maxNodes=1");
  });

  it("normalizes mixed CJK and English text for database-native FTS", async () => {
    expect(normalizeMixedLanguageFtsText("合同ABC-123续约 terms")).toBe(
      "合 同 abc 123 续 约 terms",
    );
    expect(normalizeMixedLanguageFtsText("  Policy   renewal  ")).toBe("policy renewal");
    expect(normalizeMixedLanguageFtsText("！？")).toBe("");

    const node = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c72",
      startOffset: 0,
      text: "合同ABC-123续约 terms",
    });
    const memoryRepository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxProjections: 1,
    });
    const projections = await createFtsProjectionBuilder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03",
      maxBatchSize: 1,
      projections: memoryRepository,
    }).build({
      nodes: [node],
      projectionVersion: 1,
    });

    expect(projections[0]?.metadata).toEqual(
      expect.objectContaining({
        ftsLanguageStrategy: "mixed-cjk-latin-v1",
        ftsText: "合 同 abc 123 续 约 terms",
      }),
    );
  });

  it("runs bounded dense and FTS retrieval then fuses candidates with RRF", async () => {
    const fake = createFakeRetrievalExecutor();
    const repository = createDatabaseHybridRetrievalRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxTopK: 10,
    });
    const retriever = createBasicHybridRetriever({ repository, rrfK: 60 });

    const result = await retriever.retrieve({
      denseProjectionModel: "dense-model",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      limit: 2,
      query: "Contract ABC-123",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(result).toMatchObject({
      items: [
        expect.objectContaining({
          citation: {
            artifactHash: "e".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            documentVersion: 1,
            endOffset: 84,
            pageNumber: 2,
            sectionPath: ["Contracts", "Renewal"],
            startOffset: 40,
          },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
          sources: ["dense", "fts"],
        }),
        expect.objectContaining({
          citation: expect.objectContaining({
            artifactHash: "d".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
            startOffset: 0,
          }),
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
          sources: ["dense"],
        }),
      ],
    });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: expect.arrayContaining(["dense-model"]),
        tableName: "index_projections",
      }),
    );
    expect(fake.calls[0]?.sql).toContain("<=>");
    expect(fake.calls[0]?.sql).toContain("knowledge_nodes");
    expect(fake.calls[0]?.sql).toContain("parse_artifacts");
    expect(fake.calls[0]?.sql).toContain('pa."artifact_hash" = n."artifact_hash"');
    expect(fake.calls[0]?.sql).toContain("permission_scope");
    expect(fake.calls[0]?.sql).not.toContain("0.1,0.2");
    expect(fake.calls[1]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c40", "contract abc 123", 2],
        tableName: "index_projections",
      }),
    );
    expect(fake.calls[1]?.sql).toContain("plainto_tsquery");
    expect(fake.calls[1]?.sql).toContain("knowledge_nodes");
    expect(fake.calls[1]?.sql).toContain("parse_artifacts");
    expect(fake.calls[1]?.sql).toContain("permission_scope");
    expect(fake.calls[1]?.sql).not.toContain("Contract ABC-123");

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        limit: 0,
        query: "Contract ABC-123",
        queryVector: [0.1, 0.2],
        topK: 2,
      }),
    ).rejects.toThrow("Hybrid retrieval limit must be at least 1");
    await expect(
      retriever.retrieve({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        limit: 1,
        query: "Contract ABC-123",
        queryVector: [],
        topK: 2,
      }),
    ).rejects.toThrow("Hybrid retrieval queryVector must contain at least 1 number");
    await expect(
      createBasicHybridRetriever({ repository, rrfK: 0 }).retrieve({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        limit: 1,
        query: "Contract ABC-123",
        queryVector: [0.1, 0.2],
        topK: 2,
      }),
    ).rejects.toThrow("Hybrid retrieval rrfK must be at least 1");

    const tidbFake = createFakeRetrievalExecutor();
    const tidbRepository = createDatabaseHybridRetrievalRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
      maxTopK: 10,
    });
    await tidbRepository.searchDense({
      denseProjectionModel: "dense-model",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      queryVector: [0.1, 0.2],
      topK: 1,
    });
    await tidbRepository.searchFts({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      query: "合同",
      topK: 1,
    });
    expect(tidbFake.calls[0]?.sql).toContain("VEC_COSINE_DISTANCE");
    expect(tidbFake.calls[0]?.params).toEqual(expect.arrayContaining([2, "dense-model"]));
    expect(tidbFake.calls[1]?.sql).toContain("index_projection_fts_postings");
    expect(tidbFake.calls[1]?.sql).not.toContain("INSTR(");
    expect(tidbFake.calls[1]?.sql).not.toContain("LIKE");
    expect(tidbFake.calls[1]?.sql).not.toContain("FTS_MATCH_WORD");
    expect(tidbFake.calls[1]?.params).toEqual([
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      "mixed-nfkc-v1",
      "3f4af7b018ed1963d10e2a63351a50bd049d1750d8590934679e40da10514ea9",
      "167b35ae8ac696b694e5b38e110339116c50f645241a280e20a6a901689853ed",
      1,
    ]);
    await expect(
      tidbRepository.searchDense({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        queryVector: [0.1],
        topK: 11,
      }),
    ).rejects.toThrow("Hybrid retrieval topK exceeds maxTopK=10");
    await expect(
      tidbRepository.searchDense({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        queryVector: [Number.NaN],
        topK: 1,
      }),
    ).rejects.toThrow("Hybrid retrieval queryVector must contain only finite numbers");
    await expect(
      tidbRepository.searchFts({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        query: " ",
        topK: 1,
      }),
    ).rejects.toThrow("Hybrid retrieval query must not be empty");
  });

  it("filters retrieval candidates by permission scope before fusion and reranking", async () => {
    const candidate = (
      nodeId: string,
      projectionId: string,
      source: "dense" | "fts",
      permissionScope: readonly string[],
      score: number,
    ): RetrievalCandidate => ({
      citation: {
        artifactHash: source.repeat(32).slice(0, 64),
        documentAssetId: `${nodeId}-doc`,
        documentVersion: 1,
        sectionPath: [source],
      },
      metadata: { text: nodeId },
      nodeId,
      permissionScope,
      projectionId,
      score,
      source,
    });
    const repository: HybridRetrievalRepository = {
      searchDense: async () => [
        candidate("node-allowed", "dense-allowed", "dense", ["tenant:tenant-1"], 0.9),
        candidate("node-blocked", "dense-blocked", "dense", ["tenant:tenant-2"], 0.8),
      ],
      searchFts: async () => [
        candidate("node-blocked", "fts-blocked", "fts", ["tenant:tenant-2"], 0.95),
        candidate("node-public", "fts-public", "fts", [], 0.7),
      ],
    };
    const rrfInputs: unknown[] = [];
    const rerankCalls: RerankDocumentsInput[] = [];
    const retriever = createBasicHybridRetriever({
      fusion: {
        rrfFuse(input) {
          rrfInputs.push(JSON.parse(JSON.stringify(input)));
          return [
            {
              id: "node-allowed",
              ranks: [{ listIndex: 0, rank: 1, weight: 1 }],
              score: 0.9,
            },
            {
              id: "node-public",
              ranks: [{ listIndex: 1, rank: 1, weight: 1 }],
              score: 0.7,
            },
          ];
        },
      },
      planner: createRetrievalPlanner({ maxTopK: 2 }),
      repository,
      reranker: {
        kind: "static",
        models: async () => [],
        rerank: async (input) => {
          rerankCalls.push(input);
          return {
            items: input.documents.map((document, index) => ({
              document: {
                ...document,
                metadata: { ...(document.metadata ?? {}) },
              },
              index,
              score: 1 - index / 10,
            })),
            metadata: { model: input.model, provider: "static" },
            model: input.model,
          };
        },
      },
      rerankerModel: "static-rerank",
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      limit: 2,
      mode: "deep",
      permissionScope: ["tenant:tenant-1"],
      query: "permission-aware evidence",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(rrfInputs).toEqual([
      expect.objectContaining({
        rankedLists: [
          { items: [{ id: "node-allowed" }], weight: 1 },
          { items: [{ id: "node-public" }], weight: 1 },
        ],
      }),
    ]);
    expect(rerankCalls[0]?.documents.map((document) => document.id)).toEqual([
      "node-allowed",
      "node-public",
    ]);
    expect(result.items.map((item) => item.nodeId)).toEqual(["node-allowed", "node-public"]);
    expect(result.items.map((item) => item.permissionScope)).toEqual([["tenant:tenant-1"], []]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        denseCandidates: 2,
        ftsCandidates: 2,
        permissionFilteredCandidates: 2,
      }),
    );

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        limit: 1,
        mode: "research",
        permissionScope: [" "],
        query: "permission-aware evidence",
        queryVector: [0.1, 0.2],
        topK: 2,
      }),
    ).rejects.toThrow("Hybrid retrieval permissionScope entries must be non-empty strings");
  });

  it("applies metadata filters before fusion and pushes indexed filters into retrieval SQL", async () => {
    const candidate = (
      nodeId: string,
      source: "dense" | "fts",
      metadata: Record<string, unknown>,
    ): RetrievalCandidate => ({
      citation: {
        artifactHash: source.repeat(32).slice(0, 64),
        documentAssetId: `${nodeId}-doc`,
        documentVersion: 1,
        sectionPath: [source],
      },
      metadata,
      nodeId,
      permissionScope: [],
      projectionId: `${source}-${nodeId}`,
      score: 0.9,
      source,
    });
    const repository: HybridRetrievalRepository = {
      searchDense: async () => [
        candidate("node-match", "dense", {
          documentCreatedAt: "2026-05-01T00:00:00.000Z",
          documentType: "text/markdown",
          entities: ["contract"],
          freshnessStatus: "fresh",
          language: "en",
          nodeKind: "chunk",
          sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
          tags: ["renewal"],
          text: "matching filtered evidence",
        }),
        candidate("node-wrong-tag", "dense", {
          documentCreatedAt: "2026-05-01T00:00:00.000Z",
          documentType: "text/markdown",
          entities: ["contract"],
          freshnessStatus: "fresh",
          language: "en",
          nodeKind: "chunk",
          sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
          tags: ["archived"],
        }),
      ],
      searchFts: async () => [
        candidate("node-wrong-kind", "fts", {
          documentCreatedAt: "2026-05-01T00:00:00.000Z",
          documentType: "text/markdown",
          entities: ["contract"],
          freshnessStatus: "fresh",
          language: "en",
          nodeKind: "table",
          sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
          tags: ["renewal"],
        }),
      ],
    };
    const rrfInputs: unknown[] = [];
    const retriever = createBasicHybridRetriever({
      fusion: {
        rrfFuse(input) {
          rrfInputs.push(JSON.parse(JSON.stringify(input)));
          return [
            {
              id: "node-match",
              ranks: [{ listIndex: 0, rank: 1, weight: 1 }],
              score: 1,
            },
          ];
        },
      },
      repository,
    });

    const filters = {
      createdAfter: "2026-04-01T00:00:00.000Z",
      createdBefore: "2026-06-01T00:00:00.000Z",
      documentTypes: ["text/markdown"],
      entities: ["contract"],
      freshnessStatuses: ["fresh"],
      languages: ["en"],
      nodeKinds: ["chunk"],
      sourceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4c01"],
      tags: ["renewal"],
    } as const;
    const result = await retriever.retrieve({
      denseProjectionModel: "dense-model",
      filters,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      limit: 1,
      query: "filtered evidence",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(rrfInputs).toEqual([
      expect.objectContaining({
        rankedLists: [
          { items: [{ id: "node-match" }], weight: 1 },
          { items: [], weight: 1 },
        ],
      }),
    ]);
    expect(result.items.map((item) => item.nodeId)).toEqual(["node-match"]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        metadataFilteredCandidates: 2,
      }),
    );

    const fake = createFakeRetrievalExecutor();
    const databaseRepository = createDatabaseHybridRetrievalRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxTopK: 10,
    });
    await databaseRepository.searchDense({
      denseProjectionModel: "dense-model",
      filters,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(fake.calls[0]?.sql).toContain("document_assets");
    expect(fake.calls[0]?.sql).toContain("mime_type");
    expect(fake.calls[0]?.sql).toContain("source_id");
    expect(fake.calls[0]?.sql).toContain("created_at");
    expect(fake.calls[0]?.sql).toContain("kind");
    expect(fake.calls[0]?.sql).not.toContain("text/markdown");
    expect(fake.calls[0]?.params).toEqual([
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      "[0.1,0.2]",
      2,
      "dense-model",
      "chunk",
      "text/markdown",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
      "2026-04-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      '["contract"]',
      '["renewal"]',
      '["en"]',
      '["fresh"]',
      2,
    ]);

    await expect(
      retriever.retrieve({
        denseProjectionModel: "dense-model",
        filters: { tags: [" "] },
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        limit: 1,
        query: "filtered evidence",
        queryVector: [0.1, 0.2],
        topK: 2,
      }),
    ).rejects.toThrow("Retrieval metadata filter tags entries must be non-empty strings");
  });

  it("uses retrieval plans and injected RRF fusion for optimized hybrid recall metrics", async () => {
    const fake = createFakeRetrievalExecutor();
    const repository = createDatabaseHybridRetrievalRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxTopK: 10,
    });
    const rrfInputs: unknown[] = [];
    const retriever = createBasicHybridRetriever({
      fusion: {
        rrfFuse(input) {
          rrfInputs.push(JSON.parse(JSON.stringify(input)));
          return [
            {
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
              ranks: [
                { listIndex: 0, rank: 2, weight: 1 },
                { listIndex: 1, rank: 1, weight: 1 },
              ],
              score: 1 / 62 + 1 / 61,
            },
            {
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
              ranks: [{ listIndex: 0, rank: 1, weight: 1 }],
              score: 1 / 61,
            },
          ];
        },
      },
      now: (() => {
        const values = [0, 1, 2, 6, 7, 11, 12, 14, 15];
        return () => values.shift() ?? 15;
      })(),
      planner: createRetrievalPlanner({ maxTopK: 10 }),
      repository,
      rrfK: 60,
    });

    const result = await retriever.retrieve({
      denseProjectionModel: "dense-model",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      limit: 2,
      mode: "deep",
      query: "compare contract renewal evidence",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(fake.calls.map((call) => call.maxRows)).toEqual([10, 10]);
    expect(fake.calls[0]?.params.at(-1)).toBe(10);
    expect(fake.calls[1]?.params.at(-1)).toBe(10);
    expect(rrfInputs).toEqual([
      {
        config: {
          k: 60,
          limit: 6,
          maxInputBytes: 1048576,
          maxItemsPerList: 10,
          maxLists: 2,
          maxOutputItems: 6,
        },
        rankedLists: [
          {
            items: [
              { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80" },
              { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81" },
            ],
            weight: 1,
          },
          {
            items: [
              { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81" },
              { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82" },
            ],
            weight: 1,
          },
        ],
      },
    ]);
    expect(result.items.map((item) => item.nodeId)).toEqual([
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
    ]);
    expect(result.items[0]).toMatchObject({
      projectionIds: ["dense-2", "fts-1"],
      sources: ["dense", "fts"],
    });
    expect(result.metrics).toMatchObject({
      denseCandidates: 2,
      ftsCandidates: 2,
      fusedCandidates: 2,
    });
    expect(result.metrics?.denseMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics?.ftsMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics?.fusionMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics?.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.plan).toEqual(
      expect.objectContaining({
        denseTopK: 10,
        ftsTopK: 10,
        fusionLimit: 6,
        resolvedMode: "deep",
      }),
    );
  });

  it("reranks planned hybrid recall candidates before returning final evidence", async () => {
    const fake = createFakeRetrievalExecutor();
    const repository = createDatabaseHybridRetrievalRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxTopK: 10,
    });
    const rerankCalls: RerankDocumentsInput[] = [];
    const reranker: RerankerProvider = {
      kind: "static",
      models: async () => [
        {
          id: "static-rerank",
          maxDocuments: 2,
          maxInputTokens: 8191,
          provider: "static",
          version: "static@1",
        },
      ],
      rerank: async (input) => {
        rerankCalls.push({
          ...input,
          documents: input.documents.map((document) => ({
            ...document,
            metadata: { ...(document.metadata ?? {}) },
          })),
        });
        return {
          items: [
            {
              document: {
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
                metadata: {},
                text: "Policy renewal",
              },
              index: 1,
              score: 0.99,
            },
            {
              document: {
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
                metadata: {},
                text: "Contracts Renewal",
              },
              index: 0,
              score: 0.5,
            },
          ],
          metadata: { model: "static-rerank", provider: "static" },
          model: "static-rerank",
        };
      },
    };
    const retriever = createBasicHybridRetriever({
      fusion: {
        rrfFuse: () => [
          {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
            ranks: [{ listIndex: 0, rank: 2, weight: 1 }],
            score: 0.7,
          },
          {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
            ranks: [{ listIndex: 1, rank: 2, weight: 1 }],
            score: 0.6,
          },
          {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80",
            ranks: [{ listIndex: 0, rank: 1, weight: 1 }],
            score: 0.4,
          },
        ],
      },
      maxRerankCandidates: 2,
      planner: createRetrievalPlanner({ maxTopK: 10 }),
      repository,
      reranker,
      rerankerModel: "static-rerank",
    });

    const result = await retriever.retrieve({
      denseProjectionModel: "dense-model",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      limit: 1,
      mode: "deep",
      query: "compare renewal evidence",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(rerankCalls).toHaveLength(1);
    expect(rerankCalls[0]).toEqual({
      documents: [
        {
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
          metadata: {
            projectionIds: ["dense-2", "fts-1"],
            sources: ["dense", "fts"],
          },
          text: "Contract ABC-123",
        },
        {
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
          metadata: {
            projectionIds: ["fts-2"],
            sources: ["fts"],
          },
          text: "Policy renewal",
        },
      ],
      model: "static-rerank",
      query: "compare renewal evidence",
      topN: 1,
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          rerankModel: "static-rerank",
          rerankScore: 0.99,
          retrievalScore: 0.6,
        }),
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
        score: 0.99,
      }),
    ]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        rerankCandidates: 2,
      }),
    );
    expect(result.metrics?.rerankMs).toBeGreaterThanOrEqual(0);

    expect(() =>
      createBasicHybridRetriever({
        repository,
        reranker,
        rerankerModel: " ",
        maxRerankCandidates: 2,
      }),
    ).toThrow("Hybrid retrieval rerankerModel is required when reranker is configured");
    expect(() =>
      createBasicHybridRetriever({
        maxRerankCandidates: 0,
        repository,
        reranker,
        rerankerModel: "static-rerank",
      }),
    ).toThrow("Hybrid retrieval maxRerankCandidates must be at least 1");
  });

  it("degrades hybrid retrieval when configured providers fail", async () => {
    const ftsCandidate: RetrievalCandidate = {
      citation: {
        artifactHash: "f".repeat(64),
        documentAssetId: "fts-doc",
        documentVersion: 1,
        sectionPath: ["FTS"],
      },
      metadata: { text: "FTS fallback evidence" },
      nodeId: "node-fts",
      permissionScope: [],
      projectionId: "fts-node-fts",
      score: 0.8,
      source: "fts",
    };
    const repository: HybridRetrievalRepository = {
      searchDense: async () => {
        throw new Error("dense provider unhealthy");
      },
      searchFts: async () => [ftsCandidate],
    };
    const retriever = createBasicHybridRetriever({
      degradation: {
        denseFailure: "fts-only",
        rerankFailure: "skip-rerank",
      },
      planner: createRetrievalPlanner({ maxTopK: 2 }),
      repository,
      reranker: {
        kind: "static",
        models: async () => [],
        rerank: async () => {
          throw new Error("reranker unavailable");
        },
      },
      rerankerModel: "static-rerank",
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      limit: 1,
      mode: "deep",
      query: "fallback evidence",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        nodeId: "node-fts",
        projectionIds: ["fts-node-fts"],
        sources: ["fts"],
      }),
    ]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        degradationFlags: ["dense-failed:fts-only", "rerank-failed:skipped"],
        denseCandidates: 0,
        ftsCandidates: 1,
      }),
    );

    await expect(
      createBasicHybridRetriever({ repository }).retrieve({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        limit: 1,
        query: "fallback evidence",
        queryVector: [0.1],
        topK: 1,
      }),
    ).rejects.toThrow("dense provider unhealthy");
  });

  it("caches query normalization by strategy version without raw query keys", async () => {
    const cache = createRecordingCache();
    const normalizer = createQueryNormalizationCache({
      cache,
      strategyVersion: "mixed-cjk-latin-v1",
      ttlMs: 60_000,
    });

    const first = await normalizer.normalize({ query: "合同 ABC-123 续约" });
    const second = await normalizer.normalize({ query: "合同 ABC-123 续约" });
    const newerStrategy = await createQueryNormalizationCache({
      cache,
      strategyVersion: "mixed-cjk-latin-v2",
      ttlMs: 60_000,
    }).normalize({ query: "合同 ABC-123 续约" });

    expect(first).toEqual({
      cacheHit: false,
      normalizedQuery: "合 同 abc 123 续 约",
      queryLanguage: "mixed-cjk-latin",
      strategyVersion: "mixed-cjk-latin-v1",
    });
    expect(second).toEqual({ ...first, cacheHit: true });
    expect(newerStrategy).toEqual({
      ...first,
      cacheHit: false,
      strategyVersion: "mixed-cjk-latin-v2",
    });
    expect(cache.setCalls).toHaveLength(2);
    expect(cache.setCalls[0]?.options).toEqual({ ttlMs: 60_000 });
    expect(cache.getCalls[0]).toContain("mixed-cjk-latin-v1");
    expect(cache.getCalls[0]).not.toContain("合同");
    expect(cache.getCalls[0]).not.toContain("ABC-123");

    await expect(normalizer.normalize({ query: " " })).rejects.toThrow(
      "Query normalization query is required",
    );
    await expect(
      createQueryNormalizationCache({ cache, maxQueryBytes: 4 }).normalize({ query: "abcde" }),
    ).rejects.toThrow("Query normalization query exceeds maxQueryBytes=4");
    expect(() => createQueryNormalizationCache({ cache, ttlMs: 0 })).toThrow(
      "Query normalization ttlMs must be at least 1",
    );
    expect(() => createQueryNormalizationCache({ cache, maxQueryBytes: 0 })).toThrow(
      "Query normalization maxQueryBytes must be at least 1",
    );
    expect(() => createQueryNormalizationCache({ cache, strategyVersion: " " })).toThrow(
      "Query normalization strategyVersion is required",
    );

    const cachedKey = cache.getCalls[0];
    if (!cachedKey) {
      throw new Error("Expected cache key");
    }
    await cache.set(cachedKey, new TextEncoder().encode('{"normalizedQuery":42}'));
    await expect(normalizer.normalize({ query: "合同 ABC-123 续约" })).rejects.toThrow(
      "Query normalization cache entry is invalid",
    );
  });

  it("evaluates retrieval against golden questions with bounded batched embeddings", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3b01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3b02",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3b03",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated golden question id available");
          }
          return id;
        };
      })(),
      maxListLimit: 10,
      maxQuestions: 10,
      now: (() => {
        let minute = 0;
        return () => `2026-05-11T12:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3c01",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3d01",
      ],
      knowledgeSpaceId,
      question: "Which roadmap evidence is relevant?",
      tags: ["roadmap"],
    });
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3c99"],
      knowledgeSpaceId,
      question: "Which result should miss?",
      tags: ["miss"],
    });
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3c98"],
      knowledgeSpaceId,
      question: "Which query has no answer?",
      tags: ["no-answer"],
    });

    const embeddingCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      kind: "static",
      embed: async (input) => {
        embeddingCalls.push({ ...input, texts: [...input.texts] });
        return {
          dense: input.texts.map((text, index) => [index + 0.1, text.length]),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
      models: async () => [],
    };
    const retrievalCalls: RetrieveHybridInput[] = [];
    const retriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        retrievalCalls.push({ ...input, queryVector: [...input.queryVector] });
        if (input.query.includes("roadmap")) {
          return {
            items: [
              {
                citation: {
                  artifactHash: "f".repeat(64),
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3d01",
                  documentVersion: 1,
                  sectionPath: ["Roadmap"],
                },
                metadata: {},
                nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3c01",
                projectionIds: ["dense-1"],
                score: 0.9,
                sources: ["dense"],
              },
            ],
          };
        }
        if (input.query.includes("miss")) {
          return {
            items: [
              {
                citation: {
                  artifactHash: "e".repeat(64),
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3d02",
                  documentVersion: 1,
                  sectionPath: ["Other"],
                },
                metadata: {},
                nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3c02",
                projectionIds: ["fts-1"],
                score: 0.7,
                sources: ["fts"],
              },
            ],
          };
        }
        return { items: [] };
      },
    };
    const runner = createRetrievalEvaluationRunner({
      embeddingModel: "static-dense",
      embeddings,
      goldenQuestions,
      maxQuestions: 5,
      maxTopK: 4,
      retriever,
    });

    const report = await runner.run({
      knowledgeSpaceId,
      limit: 3,
      topK: 2,
    });

    expect(report.metrics).toEqual({
      citationHitRate: 1 / 3,
      noAnswerRate: 1 / 3,
      recallAtK: 1 / 3,
      totalQuestions: 3,
    });
    expect(report.items.map((item) => item.status)).toEqual(["hit", "miss", "no-answer"]);
    expect(report.items[0]).toMatchObject({
      expectedEvidenceIds: [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3c01",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3d01",
      ],
      matchedCitationIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3d01"],
      matchedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3c01"],
      retrievedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3c01"],
    });
    expect(embeddingCalls).toEqual([
      {
        inputType: "search_query",
        model: "static-dense",
        texts: [
          "Which roadmap evidence is relevant?",
          "Which result should miss?",
          "Which query has no answer?",
        ],
      },
    ]);
    expect(retrievalCalls).toHaveLength(3);
    expect(retrievalCalls[0]).toMatchObject({
      knowledgeSpaceId,
      limit: 2,
      query: "Which roadmap evidence is relevant?",
      queryVector: [0.1, 35],
      topK: 2,
    });
    await expect(runner.run({ knowledgeSpaceId, limit: 6, topK: 2 })).rejects.toThrow(
      "Retrieval evaluation question limit exceeds maxQuestions=5",
    );
    await expect(runner.run({ knowledgeSpaceId, limit: 1, topK: 5 })).rejects.toThrow(
      "Retrieval evaluation topK exceeds maxTopK=4",
    );
    await expect(
      runner.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        limit: 1,
        topK: 1,
      }),
    ).resolves.toEqual({
      items: [],
      metrics: {
        citationHitRate: 0,
        noAnswerRate: 0,
        recallAtK: 0,
        totalQuestions: 0,
      },
    });
    await expect(
      createRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings: {
          ...embeddings,
          embed: async () => ({
            dense: [[0.1, 0.2]],
            metadata: { model: "static-dense", provider: "static" },
            model: "static-dense",
          }),
        },
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        retriever,
      }).run({ knowledgeSpaceId, limit: 2, topK: 1 }),
    ).rejects.toThrow("Retrieval evaluation embedding provider returned 1 vectors for 2 questions");
    expect(() =>
      createRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        maxQuestions: 0,
        maxTopK: 4,
        retriever,
      }),
    ).toThrow("Retrieval evaluation maxQuestions must be at least 1");
    expect(() =>
      createRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 0,
        retriever,
      }),
    ).toThrow("Retrieval evaluation maxTopK must be at least 1");
    expect(() =>
      createRetrievalEvaluationRunner({
        embeddingModel: " ",
        embeddings,
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        retriever,
      }),
    ).toThrow("Retrieval evaluation embeddingModel must not be empty");
  });

  it("evaluates advanced retrieval metrics with a bounded batched judge", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3e01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3e02",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated golden question id available");
          }
          return id;
        };
      })(),
      maxListLimit: 10,
      maxQuestions: 10,
      now: (() => {
        let minute = 10;
        return () => `2026-05-13T13:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3e11",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3e21",
      ],
      knowledgeSpaceId,
      question: "Which evidence proves the retention policy?",
      tags: ["retention"],
    });
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3e99"],
      knowledgeSpaceId,
      question: "Which evidence should be missing?",
      tags: ["miss"],
    });

    const embeddings: EmbeddingProvider = {
      kind: "static",
      embed: async (input) => ({
        dense: input.texts.map((text, index) => [index + 0.75, text.length]),
        metadata: { model: input.model, provider: "static" },
        model: input.model,
      }),
      models: async () => [],
    };
    const item = ({
      documentAssetId,
      nodeId,
      text,
    }: {
      readonly documentAssetId: string;
      readonly nodeId: string;
      readonly text: string;
    }): HybridRetrievalItem => ({
      citation: {
        artifactHash: "c".repeat(64),
        documentAssetId,
        documentVersion: 1,
        sectionPath: ["Evidence"],
      },
      metadata: { text },
      nodeId,
      projectionIds: [`projection-${nodeId}`],
      score: 0.9,
      sources: ["dense"],
    });
    const retriever: BasicHybridRetriever = {
      retrieve: async (input) =>
        input.query.includes("retention")
          ? {
              items: [
                item({
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e21",
                  nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e11",
                  text: "Retention policy evidence.",
                }),
                item({
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e22",
                  nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e12",
                  text: "Distracting context.",
                }),
              ],
            }
          : {
              items: [
                item({
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e23",
                  nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e13",
                  text: "Unrelated context.",
                }),
              ],
            },
    };
    const judgeCalls: Parameters<AdvancedRetrievalMetricJudge["evaluateBatch"]>[0][] = [];
    const judge: AdvancedRetrievalMetricJudge = {
      evaluateBatch: async (input) => {
        judgeCalls.push(JSON.parse(JSON.stringify(input)) as typeof input);
        return {
          items: [
            {
              citationAccuracyScore: 0.75,
              faithfulnessScore: 0.9,
              goldenQuestionId: input.items[0]?.goldenQuestionId ?? "",
              relevanceScore: 0.8,
              relevantEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3e11"],
            },
            {
              citationAccuracyScore: 0.1,
              faithfulnessScore: 0.4,
              goldenQuestionId: input.items[1]?.goldenQuestionId ?? "",
              relevanceScore: 0.2,
              relevantEvidenceIds: [],
            },
          ],
        };
      },
    };
    const runner = createAdvancedRetrievalEvaluationRunner({
      embeddingModel: "static-dense",
      embeddings,
      goldenQuestions,
      judge,
      maxJudgeContextBytes: 4096,
      maxQuestions: 5,
      maxTopK: 4,
      retriever,
    });

    const report = await runner.run({ knowledgeSpaceId, limit: 2, topK: 2 });

    expect(report.metrics).toEqual({
      citationAccuracy: 0.425,
      citationHitRate: 0.5,
      contextPrecision: 0.25,
      faithfulnessScore: 0.65,
      noAnswerRate: 0,
      recallAtK: 0.5,
      relevanceScore: 0.5,
      totalQuestions: 2,
    });
    expect(report.items.map((entry) => entry.contextPrecision)).toEqual([0.5, 0]);
    expect(report.items[0]).toMatchObject({
      citationAccuracy: 0.75,
      faithfulnessScore: 0.9,
      judgedRelevantEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3e11"],
      relevanceScore: 0.8,
      status: "hit",
    });
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]?.items).toHaveLength(2);
    expect(judgeCalls[0]?.items[0]).toMatchObject({
      expectedEvidenceIds: [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3e11",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3e21",
      ],
      question: "Which evidence proves the retention policy?",
      retrievedContext: [
        {
          citationEvidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e21",
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e11",
          text: "Retention policy evidence.",
        },
        {
          citationEvidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e22",
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3e12",
          text: "Distracting context.",
        },
      ],
    });
  });

  it("rejects unbounded advanced retrieval metric inputs and invalid judge output", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3f01",
      maxListLimit: 10,
      maxQuestions: 10,
      now: () => "2026-05-13T13:20:00.000Z",
    });
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3f11"],
      knowledgeSpaceId,
      question: "Which context is too large?",
      tags: ["bounds"],
    });
    const embeddings: EmbeddingProvider = {
      kind: "static",
      embed: async (input) => ({
        dense: input.texts.map(() => [1]),
        metadata: { model: input.model, provider: "static" },
        model: input.model,
      }),
      models: async () => [],
    };
    const longContextRetriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          {
            citation: {
              artifactHash: "d".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3f21",
              documentVersion: 1,
              sectionPath: ["Large"],
            },
            metadata: { text: "large context text" },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3f11",
            projectionIds: ["projection-large"],
            score: 1,
            sources: ["dense"],
          },
        ],
      }),
    };
    const judge: AdvancedRetrievalMetricJudge = {
      evaluateBatch: async (input) => ({
        items: input.items.map((entry) => ({
          citationAccuracyScore: 1.25,
          faithfulnessScore: 1,
          goldenQuestionId: entry.goldenQuestionId,
          relevanceScore: 1,
          relevantEvidenceIds: [entry.retrievedContext[0]?.nodeId ?? ""],
        })),
      }),
    };

    expect(() =>
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge,
        maxJudgeContextBytes: 0,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }),
    ).toThrow("Advanced retrieval evaluation maxJudgeContextBytes must be at least 1");

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge,
        maxJudgeContextBytes: 10,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow(
      "Advanced retrieval evaluation judge context exceeds maxJudgeContextBytes=10",
    );

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge: {
          evaluateBatch: async () => {
            throw new Error("judge should not run for an empty page");
          },
        },
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
        limit: 1,
        topK: 1,
      }),
    ).resolves.toEqual({
      items: [],
      metrics: {
        citationAccuracy: 0,
        citationHitRate: 0,
        contextPrecision: 0,
        faithfulnessScore: 0,
        noAnswerRate: 0,
        recallAtK: 0,
        relevanceScore: 0,
        totalQuestions: 0,
      },
    });

    const pagedGoldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3f51",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3f52",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No paged test golden question id available");
          }
          return id;
        };
      })(),
      maxListLimit: 10,
      maxQuestions: 10,
      now: (() => {
        let minute = 30;
        return () => `2026-05-13T13:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });
    await pagedGoldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3f61"],
      knowledgeSpaceId,
      question: "First paged question?",
      tags: ["bounds"],
    });
    await pagedGoldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3f62"],
      knowledgeSpaceId,
      question: "Second paged question?",
      tags: ["bounds"],
    });
    const pagedRunner = createAdvancedRetrievalEvaluationRunner({
      embeddingModel: "static-dense",
      embeddings,
      goldenQuestions: pagedGoldenQuestions,
      judge: {
        evaluateBatch: async (input) => ({
          items: input.items.map((entry) => ({
            citationAccuracyScore: 1,
            faithfulnessScore: 1,
            goldenQuestionId: entry.goldenQuestionId,
            relevanceScore: 1,
            relevantEvidenceIds: [],
          })),
        }),
      },
      maxJudgeContextBytes: 4096,
      maxQuestions: 5,
      maxTopK: 4,
      retriever: { retrieve: async () => ({ items: [] }) },
    });
    const firstPage = await pagedRunner.run({ knowledgeSpaceId, limit: 1, topK: 1 });
    expect(firstPage.nextCursor).toEqual({
      createdAt: "2026-05-13T13:30:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3f51",
    });
    await expect(
      pagedRunner.run({ cursor: firstPage.nextCursor, knowledgeSpaceId, limit: 1, topK: 1 }),
    ).resolves.toMatchObject({
      items: [{ question: "Second paged question?" }],
    });

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings: {
          ...embeddings,
          embed: async (input) => ({
            dense: [],
            metadata: { model: input.model, provider: "static" },
            model: input.model,
          }),
        },
        goldenQuestions,
        judge,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow(
      "Advanced retrieval evaluation embedding provider returned 0 vectors for 1 questions",
    );

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge: {
          evaluateBatch: async () => ({ items: [] }),
        },
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow("Advanced retrieval evaluation judge returned 0 results for 1 questions");

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge: {
          evaluateBatch: async () => ({
            items: [
              {
                citationAccuracyScore: 1,
                faithfulnessScore: 1,
                goldenQuestionId: "018f0d60-7a49-7cc2-9c1b-5b36f18fffff",
                relevanceScore: 1,
                relevantEvidenceIds: [],
              },
            ],
          }),
        },
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow("Advanced retrieval evaluation judge returned an unknown goldenQuestionId");

    const duplicateGoldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3f31",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f3f32",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No duplicate test golden question id available");
          }
          return id;
        };
      })(),
      maxListLimit: 10,
      maxQuestions: 10,
      now: () => "2026-05-13T13:25:00.000Z",
    });
    await duplicateGoldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3f41"],
      knowledgeSpaceId,
      question: "Duplicate judge id one?",
      tags: ["bounds"],
    });
    await duplicateGoldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3f42"],
      knowledgeSpaceId,
      question: "Duplicate judge id two?",
      tags: ["bounds"],
    });
    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions: duplicateGoldenQuestions,
        judge: {
          evaluateBatch: async (input) => ({
            items: input.items.map(() => ({
              citationAccuracyScore: 1,
              faithfulnessScore: 1,
              goldenQuestionId: input.items[0]?.goldenQuestionId ?? "",
              relevanceScore: 1,
              relevantEvidenceIds: [],
            })),
          }),
        },
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: { retrieve: async () => ({ items: [] }) },
      }).run({ knowledgeSpaceId, limit: 2, topK: 1 }),
    ).rejects.toThrow("Advanced retrieval evaluation judge returned duplicate goldenQuestionId");

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge: {
          evaluateBatch: async (input) => ({
            items: input.items.map((entry) => ({
              citationAccuracyScore: 1,
              faithfulnessScore: 1,
              goldenQuestionId: entry.goldenQuestionId,
              relevanceScore: 1,
              relevantEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f3fff"],
            })),
          }),
        },
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow(
      "Advanced retrieval evaluation judge relevantEvidenceIds must reference retrieved context",
    );

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge: {
          evaluateBatch: async (input) => ({
            items: input.items.map((entry) => ({
              citationAccuracyScore: 1,
              faithfulnessScore: -0.1,
              goldenQuestionId: entry.goldenQuestionId,
              relevanceScore: 1,
              relevantEvidenceIds: [],
            })),
          }),
        },
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow(
      "Advanced retrieval evaluation judge faithfulnessScore must be between 0 and 1",
    );

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge: {
          evaluateBatch: async (input) => ({
            items: input.items.map((entry) => ({
              citationAccuracyScore: 1,
              faithfulnessScore: 1,
              goldenQuestionId: entry.goldenQuestionId,
              relevanceScore: Number.NaN,
              relevantEvidenceIds: [],
            })),
          }),
        },
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow("Advanced retrieval evaluation judge relevanceScore must be between 0 and 1");

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge: {
          evaluateBatch: async (input) => ({
            items: input.items.map((entry) => ({
              citationAccuracyScore: 1,
              faithfulnessScore: 1,
              goldenQuestionId: entry.goldenQuestionId,
              relevanceScore: 1,
              relevantEvidenceIds: [],
            })),
          }),
        },
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: { retrieve: async () => ({ items: [] }) },
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).resolves.toMatchObject({
      items: [{ contextPrecision: 0, status: "no-answer" }],
      metrics: {
        contextPrecision: 0,
        noAnswerRate: 1,
        recallAtK: 0,
      },
    });

    await expect(
      createAdvancedRetrievalEvaluationRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        judge,
        maxJudgeContextBytes: 4096,
        maxQuestions: 5,
        maxTopK: 4,
        retriever: longContextRetriever,
      }).run({ knowledgeSpaceId, limit: 1, topK: 1 }),
    ).rejects.toThrow(
      "Advanced retrieval evaluation judge citationAccuracyScore must be between 0 and 1",
    );
  });

  it("compares dense-only, FTS-only, and hybrid retrieval evaluation impact", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f4a02",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated golden question id available");
          }
          return id;
        };
      })(),
      maxListLimit: 10,
      maxQuestions: 10,
      now: (() => {
        let minute = 30;
        return () => `2026-05-11T12:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4b01"],
      knowledgeSpaceId,
      question: "dense evidence",
      tags: ["dense"],
    });
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4b02"],
      knowledgeSpaceId,
      question: "fts evidence",
      tags: ["fts"],
    });

    const embeddingCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      kind: "static",
      embed: async (input) => {
        embeddingCalls.push({ ...input, texts: [...input.texts] });
        return {
          dense: input.texts.map((text, index) => [index + 0.25, text.length]),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
      models: async () => [],
    };
    const repositoryCalls: Array<{ readonly strategy: "dense" | "fts"; readonly topK: number }> =
      [];
    const candidate = (
      nodeId: string,
      source: "dense" | "fts",
      score: number,
    ): RetrievalCandidate => ({
      citation: {
        artifactHash: source.repeat(32).slice(0, 64),
        documentAssetId: `${nodeId}-doc`,
        documentVersion: 1,
        sectionPath: [source],
      },
      metadata: { text: nodeId },
      nodeId,
      permissionScope: [],
      projectionId: `${source}-${nodeId}`,
      score,
      source,
    });
    const repository: HybridRetrievalRepository = {
      searchDense: async ({ queryVector, topK }) => {
        repositoryCalls.push({ strategy: "dense", topK });
        return queryVector[0] === 0.25
          ? [candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f4b01", "dense", 0.9)]
          : [];
      },
      searchFts: async ({ query, topK }) => {
        repositoryCalls.push({ strategy: "fts", topK });
        return query.includes("fts")
          ? [candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f4b02", "fts", 0.8)]
          : [];
      },
    };
    const hybridCalls: RetrieveHybridInput[] = [];
    const hybridRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        hybridCalls.push({ ...input, queryVector: [...input.queryVector] });
        return {
          items: [
            {
              citation: {
                artifactHash: "h".repeat(64),
                documentAssetId: input.query.includes("dense")
                  ? "018f0d60-7a49-7cc2-9c1b-5b36f18f4b01"
                  : "018f0d60-7a49-7cc2-9c1b-5b36f18f4b02",
                documentVersion: 1,
                sectionPath: ["hybrid"],
              },
              metadata: {},
              nodeId: input.query.includes("dense")
                ? "018f0d60-7a49-7cc2-9c1b-5b36f18f4b01"
                : "018f0d60-7a49-7cc2-9c1b-5b36f18f4b02",
              projectionIds: ["hybrid-1"],
              score: 1,
              sources: ["dense", "fts"],
            },
          ],
        };
      },
    };
    const runner = createRetrievalStrategyComparisonRunner({
      embeddingModel: "static-dense",
      embeddings,
      goldenQuestions,
      hybridRetriever,
      maxQuestions: 5,
      maxTopK: 4,
      repository,
    });

    const report = await runner.run({
      knowledgeSpaceId,
      limit: 2,
      topK: 2,
    });

    expect(embeddingCalls).toEqual([
      {
        inputType: "search_query",
        model: "static-dense",
        texts: ["dense evidence", "fts evidence"],
      },
    ]);
    expect(repositoryCalls).toEqual([
      { strategy: "dense", topK: 2 },
      { strategy: "fts", topK: 2 },
      { strategy: "dense", topK: 2 },
      { strategy: "fts", topK: 2 },
    ]);
    expect(hybridCalls).toHaveLength(2);
    expect(hybridCalls[0]).toMatchObject({
      knowledgeSpaceId,
      limit: 2,
      query: "dense evidence",
      queryVector: [0.25, 14],
      topK: 2,
    });
    expect(report.strategies["dense-only"].metrics.recallAtK).toBe(0.5);
    expect(report.strategies["fts-only"].metrics.recallAtK).toBe(0.5);
    expect(report.strategies.hybrid.metrics.recallAtK).toBe(1);
    expect(report.impact.hybridVsDense).toEqual({
      citationHitRate: 1,
      noAnswerRate: -0.5,
      recallAtK: 0.5,
    });
    expect(report.impact.hybridVsFts).toEqual({
      citationHitRate: 1,
      noAnswerRate: -0.5,
      recallAtK: 0.5,
    });
    await expect(
      runner.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        limit: 1,
        topK: 1,
      }),
    ).resolves.toMatchObject({
      impact: {
        hybridVsDense: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0 },
        hybridVsFts: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0 },
      },
      strategies: {
        "dense-only": {
          items: [],
          metrics: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0, totalQuestions: 0 },
        },
        "fts-only": {
          items: [],
          metrics: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0, totalQuestions: 0 },
        },
        hybrid: {
          items: [],
          metrics: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0, totalQuestions: 0 },
        },
      },
    });
    await expect(
      createRetrievalStrategyComparisonRunner({
        embeddingModel: "static-dense",
        embeddings: {
          ...embeddings,
          embed: async () => ({
            dense: [[0.1, 0.2]],
            metadata: { model: "static-dense", provider: "static" },
            model: "static-dense",
          }),
        },
        goldenQuestions,
        hybridRetriever,
        maxQuestions: 5,
        maxTopK: 4,
        repository,
      }).run({ knowledgeSpaceId, limit: 2, topK: 1 }),
    ).rejects.toThrow(
      "Retrieval strategy comparison embedding provider returned 1 vectors for 2 questions",
    );
    await expect(runner.run({ knowledgeSpaceId, limit: 6, topK: 2 })).rejects.toThrow(
      "Retrieval evaluation question limit exceeds maxQuestions=5",
    );
  });

  it("runs A/B retrieval strategy comparison against the same bounded golden set", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f4e01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f4e02",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated A/B golden question id available");
          }
          return id;
        };
      })(),
      maxListLimit: 10,
      maxQuestions: 10,
      now: (() => {
        let minute = 50;
        return () => `2026-05-13T12:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4f01"],
      knowledgeSpaceId,
      question: "baseline question",
      tags: ["ab"],
    });
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4f02"],
      knowledgeSpaceId,
      question: "challenger question",
      tags: ["ab"],
    });
    const embeddingCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      kind: "static",
      embed: async (input) => {
        embeddingCalls.push({ ...input, texts: [...input.texts] });
        return {
          dense: input.texts.map((text, index) => [index + 0.75, text.length]),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
      models: async () => [],
    };
    const strategyCalls: Array<{ readonly name: string; readonly query: string }> = [];
    const item = (nodeId: string): HybridRetrievalItem => ({
      citation: {
        artifactHash: "b".repeat(64),
        documentAssetId: nodeId,
        documentVersion: 1,
        sectionPath: ["A/B"],
      },
      metadata: {},
      nodeId,
      projectionIds: [`projection-${nodeId}`],
      score: 1,
      sources: ["dense"],
    });
    const createStrategy = (
      name: string,
      byQuery: Record<string, readonly HybridRetrievalItem[]>,
    ): BasicHybridRetriever => ({
      retrieve: async (input) => {
        strategyCalls.push({ name, query: input.query });
        return { items: [...(byQuery[input.query] ?? [])] };
      },
    });
    const runner = createAbRetrievalStrategyComparisonRunner({
      embeddingModel: "static-dense",
      embeddings,
      goldenQuestions,
      maxQuestions: 5,
      maxTopK: 4,
      strategies: [
        {
          name: "baseline",
          retriever: createStrategy("baseline", {
            "baseline question": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4f01")],
          }),
        },
        {
          name: "challenger",
          retriever: createStrategy("challenger", {
            "baseline question": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4f01")],
            "challenger question": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4f02")],
          }),
        },
      ],
    });

    const report = await runner.run({ knowledgeSpaceId, limit: 2, topK: 2 });

    expect(embeddingCalls).toEqual([
      {
        inputType: "search_query",
        model: "static-dense",
        texts: ["baseline question", "challenger question"],
      },
    ]);
    expect(strategyCalls).toEqual([
      { name: "baseline", query: "baseline question" },
      { name: "challenger", query: "baseline question" },
      { name: "baseline", query: "challenger question" },
      { name: "challenger", query: "challenger question" },
    ]);
    expect(report.baselineStrategy).toBe("baseline");
    expect(report.challengerStrategy).toBe("challenger");
    expect(report.delta).toEqual({
      citationHitRate: 0.5,
      noAnswerRate: -0.5,
      recallAtK: 0.5,
    });
    expect(report.winner).toBe("challenger");
    expect(report.strategies.baseline?.metrics.recallAtK).toBe(0.5);
    expect(report.strategies.challenger?.metrics.recallAtK).toBe(1);

    const pagedReport = await runner.run({ knowledgeSpaceId, limit: 1, topK: 1 });
    expect(pagedReport.nextCursor).toEqual({
      createdAt: "2026-05-13T12:50:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4e01",
    });
    expect(pagedReport.delta).toEqual({
      citationHitRate: 0,
      noAnswerRate: 0,
      recallAtK: 0,
    });

    await expect(
      runner.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
        limit: 1,
        topK: 1,
      }),
    ).resolves.toMatchObject({
      delta: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0 },
      strategies: {
        baseline: { items: [] },
        challenger: { items: [] },
      },
      winner: "tie",
    });

    expect(() =>
      createAbRetrievalStrategyComparisonRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        strategies: [{ name: "only-one", retriever: createStrategy("only-one", {}) }],
      }),
    ).toThrow("A/B retrieval strategy comparison requires exactly two strategies");
    expect(() =>
      createAbRetrievalStrategyComparisonRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        strategies: [
          { name: "same", retriever: createStrategy("same-a", {}) },
          { name: "same", retriever: createStrategy("same-b", {}) },
        ],
      }),
    ).toThrow("A/B retrieval strategy comparison strategy names must be unique");
    expect(() =>
      createAbRetrievalStrategyComparisonRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        strategies: [
          { name: " ", retriever: createStrategy("empty-name", {}) },
          { name: "challenger", retriever: createStrategy("challenger-empty-name", {}) },
        ],
      }),
    ).toThrow("A/B retrieval strategy comparison strategy name is required");
    expect(() =>
      createAbRetrievalStrategyComparisonRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        strategies: [
          { name: "b".repeat(81), retriever: createStrategy("long-name", {}) },
          { name: "challenger", retriever: createStrategy("challenger-long-name", {}) },
        ],
      }),
    ).toThrow("A/B retrieval strategy comparison strategy name must be at most 80 chars");
    await expect(
      createAbRetrievalStrategyComparisonRunner({
        embeddingModel: "static-dense",
        embeddings,
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        strategies: [
          {
            name: "baseline-wins",
            retriever: createStrategy("baseline-wins", {
              "baseline question": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4f01")],
              "challenger question": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4f02")],
            }),
          },
          {
            name: "challenger-loses",
            retriever: createStrategy("challenger-loses", {
              "baseline question": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4f01")],
            }),
          },
        ],
      }).run({ knowledgeSpaceId, limit: 2, topK: 1 }),
    ).resolves.toMatchObject({
      delta: { citationHitRate: -0.5, noAnswerRate: 0.5, recallAtK: -0.5 },
      winner: "baseline",
    });
    await expect(
      createAbRetrievalStrategyComparisonRunner({
        embeddingModel: "static-dense",
        embeddings: {
          ...embeddings,
          embed: async () => ({
            dense: [[0.1, 0.2]],
            metadata: { model: "static-dense", provider: "static" },
            model: "static-dense",
          }),
        },
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        strategies: [
          { name: "baseline", retriever: createStrategy("baseline-mismatch", {}) },
          { name: "challenger", retriever: createStrategy("challenger-mismatch", {}) },
        ],
      }).run({ knowledgeSpaceId, limit: 2, topK: 1 }),
    ).rejects.toThrow(
      "A/B retrieval strategy comparison embedding provider returned 1 vectors for 2 questions",
    );
  });

  it("compares enriched and summary-tree retrieval impact against baseline", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: (() => {
        const ids = [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f4c01",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f4c02",
        ];
        return () => {
          const id = ids.shift();
          if (!id) {
            throw new Error("No generated golden question id available");
          }
          return id;
        };
      })(),
      maxListLimit: 10,
      maxQuestions: 10,
      now: (() => {
        let minute = 40;
        return () => `2026-05-11T12:${String(minute++).padStart(2, "0")}:00.000Z`;
      })(),
    });
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4d01"],
      knowledgeSpaceId,
      question: "baseline finds the overview",
      tags: ["overview"],
    });
    await goldenQuestions.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4d02"],
      knowledgeSpaceId,
      question: "enrichment finds the narrow policy",
      tags: ["policy"],
    });

    const embeddingCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      kind: "static",
      embed: async (input) => {
        embeddingCalls.push({ ...input, texts: [...input.texts] });
        return {
          dense: input.texts.map((text, index) => [index + 0.5, text.length]),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
      models: async () => [],
    };
    const retrievalCalls: Array<{ readonly name: string; readonly input: RetrieveHybridInput }> =
      [];
    const item = (nodeId: string): HybridRetrievalItem => ({
      citation: {
        artifactHash: "a".repeat(64),
        documentAssetId: nodeId,
        documentVersion: 1,
        sectionPath: ["Policies"],
      },
      metadata: {},
      nodeId,
      projectionIds: [`projection-${nodeId}`],
      score: 1,
      sources: ["dense"],
    });
    const createNamedRetriever = (
      name: string,
      byQuery: Record<string, readonly HybridRetrievalItem[]>,
    ): BasicHybridRetriever => ({
      retrieve: async (input) => {
        retrievalCalls.push({ name, input: { ...input, queryVector: [...input.queryVector] } });
        return { items: [...(byQuery[input.query] ?? [])] };
      },
    });
    const runner = createRetrievalImpactEvaluationRunner({
      baselineRetriever: createNamedRetriever("baseline", {
        "baseline finds the overview": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4d01")],
      }),
      embeddingModel: "static-dense",
      embeddings,
      enrichedRetriever: createNamedRetriever("enriched", {
        "baseline finds the overview": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4d01")],
        "enrichment finds the narrow policy": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4d02")],
      }),
      goldenQuestions,
      maxQuestions: 5,
      maxTopK: 4,
      summaryTreeRetriever: createNamedRetriever("summary-tree", {
        "baseline finds the overview": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4d01")],
        "enrichment finds the narrow policy": [item("018f0d60-7a49-7cc2-9c1b-5b36f18f4d02")],
      }),
    });

    const report = await runner.run({ knowledgeSpaceId, limit: 2, topK: 2 });

    expect(embeddingCalls).toEqual([
      {
        inputType: "search_query",
        model: "static-dense",
        texts: ["baseline finds the overview", "enrichment finds the narrow policy"],
      },
    ]);
    expect(retrievalCalls.map((call) => call.name)).toEqual([
      "baseline",
      "enriched",
      "summary-tree",
      "baseline",
      "enriched",
      "summary-tree",
    ]);
    expect(retrievalCalls.every((call) => call.input.limit === 2 && call.input.topK === 2)).toBe(
      true,
    );
    expect(report.variants.baseline.metrics).toEqual({
      citationHitRate: 0.5,
      noAnswerRate: 0.5,
      recallAtK: 0.5,
      totalQuestions: 2,
    });
    expect(report.variants.enriched.metrics.recallAtK).toBe(1);
    expect(report.variants["summary-tree"].metrics.recallAtK).toBe(1);
    expect(report.impact.enrichedVsBaseline).toEqual({
      citationHitRate: 0.5,
      noAnswerRate: -0.5,
      recallAtK: 0.5,
    });
    expect(report.impact.summaryTreeVsBaseline).toEqual({
      citationHitRate: 0.5,
      noAnswerRate: -0.5,
      recallAtK: 0.5,
    });
    expect(report.impact.summaryTreeVsEnriched).toEqual({
      citationHitRate: 0,
      noAnswerRate: 0,
      recallAtK: 0,
    });
    await expect(
      runner.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
        limit: 1,
        topK: 1,
      }),
    ).resolves.toMatchObject({
      impact: {
        enrichedVsBaseline: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0 },
        summaryTreeVsBaseline: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0 },
        summaryTreeVsEnriched: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0 },
      },
      variants: {
        baseline: {
          items: [],
          metrics: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0, totalQuestions: 0 },
        },
        enriched: {
          items: [],
          metrics: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0, totalQuestions: 0 },
        },
        "summary-tree": {
          items: [],
          metrics: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0, totalQuestions: 0 },
        },
      },
    });
    await expect(
      createRetrievalImpactEvaluationRunner({
        baselineRetriever: createNamedRetriever("baseline", {}),
        embeddingModel: "static-dense",
        embeddings: {
          ...embeddings,
          embed: async () => ({
            dense: [[0.1, 0.2]],
            metadata: { model: "static-dense", provider: "static" },
            model: "static-dense",
          }),
        },
        enrichedRetriever: createNamedRetriever("enriched", {}),
        goldenQuestions,
        maxQuestions: 5,
        maxTopK: 4,
        summaryTreeRetriever: createNamedRetriever("summary-tree", {}),
      }).run({ knowledgeSpaceId, limit: 2, topK: 1 }),
    ).rejects.toThrow(
      "Retrieval impact evaluation embedding provider returned 1 vectors for 2 questions",
    );
    await expect(runner.run({ knowledgeSpaceId, limit: 6, topK: 2 })).rejects.toThrow(
      "Retrieval evaluation question limit exceeds maxQuestions=5",
    );
  });

  it("assembles reranked retrieval candidates into structured EvidenceBundles", () => {
    const assembler = createEvidenceBundleAssembler({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f5a01",
      maxItems: 2,
      maxMissingEvidence: 2,
      now: () => "2026-05-11T13:00:00.000Z",
    });
    const result = assembler.assemble({
      expectedEvidenceIds: [
        "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f5b03",
      ],
      query: "What evidence supports the roadmap?",
      retrieval: {
        items: [
          {
            citation: {
              artifactHash: "b".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5c01",
              documentVersion: 2,
              endOffset: 140,
              pageNumber: 3,
              sectionPath: ["Roadmap"],
              startOffset: 40,
            },
            metadata: {
              conflicts: [
                {
                  reason: "A previous plan lists a different milestone date.",
                  severity: "warning",
                  withNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b02",
                },
              ],
              freshnessStatus: "fresh",
              observedAt: "2026-05-11T12:59:00.000Z",
              rerankScore: 0.94,
              retrievalScore: 0.72,
              sourceUpdatedAt: "2026-05-10T12:00:00.000Z",
              text: "The roadmap milestone is supported by release notes.",
            },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
            projectionIds: ["dense-1", "fts-1"],
            score: 0.91,
            sources: ["dense", "fts"],
          },
        ],
      },
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5d01",
    });

    expect(result).toMatchObject({
      createdAt: "2026-05-11T13:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5a01",
      missingEvidence: [
        {
          expectedEvidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b03",
          reason: "not-retrieved",
          text: "Expected evidence was not retrieved.",
        },
      ],
      query: "What evidence supports the roadmap?",
      state: "partial",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5d01",
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        citations: [
          expect.objectContaining({
            artifactHash: "b".repeat(64),
            startOffset: 40,
          }),
        ],
        conflicts: [
          {
            reason: "A previous plan lists a different milestone date.",
            severity: "warning",
            withNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b02",
          },
        ],
        freshness: {
          observedAt: "2026-05-11T12:59:00.000Z",
          sourceUpdatedAt: "2026-05-10T12:00:00.000Z",
          status: "fresh",
        },
        metadata: {
          projectionIds: ["dense-1", "fts-1"],
          sources: ["dense", "fts"],
        },
        score: 0.91,
        scores: {
          final: 0.91,
          rerank: 0.94,
          retrieval: 0.72,
        },
      }),
    ]);

    result.items[0]?.metadata.projectionIds;
    (result.items[0]?.metadata.projectionIds as string[] | undefined)?.push("mutated");
    const second = assembler.assemble({
      query: "What evidence supports the roadmap?",
      retrieval: {
        items: [],
      },
    });

    expect(second.items).toEqual([]);
    expect(second.state).toBe("not-enough-evidence");
    const answerable = assembler.assemble({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f5b01"],
      query: "Answerable",
      retrieval: {
        items: [
          {
            citation: {
              artifactHash: "f".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5c04",
              documentVersion: 1,
              sectionPath: [],
            },
            metadata: {},
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
            projectionIds: ["dense-only"],
            score: 0.8,
            sources: ["dense"],
          },
        ],
      },
    });

    expect(answerable.state).toBe("answerable");
    expect(answerable.items[0]).toMatchObject({
      freshness: { status: "unknown" },
      scores: { final: 0.8, retrieval: 0.8 },
      text: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
    });
    expect(
      assembler.assemble({
        query: "Conflict",
        retrieval: {
          items: [
            {
              citation: {
                artifactHash: "a".repeat(64),
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5c05",
                documentVersion: 1,
                sectionPath: [],
              },
              metadata: {
                conflicts: [
                  {
                    reason: "Blocking contradiction.",
                    severity: "blocking",
                  },
                  {
                    reason: "Ignored malformed conflict.",
                    severity: "invalid",
                  },
                ],
              },
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b04",
              projectionIds: ["fts-only"],
              score: 0.7,
              sources: ["fts"],
            },
          ],
        },
      }).state,
    ).toBe("conflict");
    expect(() => createEvidenceBundleAssembler({ maxItems: 0, maxMissingEvidence: 1 })).toThrow(
      "EvidenceBundle assembler maxItems must be at least 1",
    );
    expect(() => createEvidenceBundleAssembler({ maxItems: 1, maxMissingEvidence: -1 })).toThrow(
      "EvidenceBundle assembler maxMissingEvidence must be non-negative",
    );
    expect(() =>
      assembler.assemble({
        query: "too many",
        retrieval: {
          items: [
            {
              citation: {
                artifactHash: "c".repeat(64),
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5c01",
                documentVersion: 1,
                sectionPath: [],
              },
              metadata: {},
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b01",
              projectionIds: ["a"],
              score: 0.9,
              sources: ["dense"],
            },
            {
              citation: {
                artifactHash: "d".repeat(64),
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5c02",
                documentVersion: 1,
                sectionPath: [],
              },
              metadata: {},
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b02",
              projectionIds: ["b"],
              score: 0.8,
              sources: ["fts"],
            },
            {
              citation: {
                artifactHash: "e".repeat(64),
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5c03",
                documentVersion: 1,
                sectionPath: [],
              },
              metadata: {},
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5b03",
              projectionIds: ["c"],
              score: 0.7,
              sources: ["dense"],
            },
          ],
        },
      }),
    ).toThrow("EvidenceBundle assembler item count exceeds maxItems=2");
    expect(() =>
      createEvidenceBundleAssembler({ maxMissingEvidence: 0 }).assemble({
        expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f5b99"],
        query: "Missing",
        retrieval: { items: [] },
      }),
    ).toThrow("EvidenceBundle assembler missing evidence count exceeds maxMissingEvidence=0");
    expect(() => assembler.assemble({ query: " ", retrieval: { items: [] } })).toThrow(
      "EvidenceBundle assembler query is required",
    );
  });

  it("caches EvidenceBundles by query digest, permission snapshot, strategy, and index projection", async () => {
    const cache = createRecordingCache();
    const evidenceCache = createEvidenceBundleCache({
      cache,
      maxQueryBytes: 1024,
      strategyVersion: "hybrid-rerank-v1",
      ttlMs: 60_000,
    });
    const bundle = createEvidenceBundleAssembler({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f6a01",
      now: () => "2026-05-11T13:20:00.000Z",
    }).assemble({
      query: "What evidence supports the cache?",
      retrieval: {
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
              documentVersion: 1,
              sectionPath: ["Cache"],
            },
            metadata: { text: "Cache evidence" },
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c01",
            projectionIds: ["dense-1"],
            score: 0.9,
            sources: ["dense"],
          },
        ],
      },
    });
    const keyInput = {
      filters: {
        documentTypes: ["text/markdown"],
        tags: ["cache"],
      },
      indexProjectionFingerprint: "dense@12+fts@9",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      permissionSnapshot: ["tenant:tenant-1", "project:alpha"],
      query: "What evidence supports the cache?",
      retrievalStrategy: "hybrid-rerank",
      snapshotFingerprint:
        "snapshot-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    } as const;

    await expect(evidenceCache.get(keyInput)).resolves.toBeNull();
    await evidenceCache.set(keyInput, bundle);
    const cached = await evidenceCache.get({
      ...keyInput,
      permissionSnapshot: ["project:alpha", "tenant:tenant-1"],
    });

    expect(cached).toEqual(bundle);
    cached?.items.push({
      citations: [],
      conflicts: [],
      freshness: { status: "unknown" },
      metadata: {},
      nodeId: "mutated",
      score: 1,
      scores: { final: 1, retrieval: 1 },
      text: "mutated",
    });
    await expect(evidenceCache.get(keyInput)).resolves.toEqual(bundle);
    expect(cache.setCalls).toHaveLength(1);
    expect(cache.setCalls[0]?.options).toEqual({ ttlMs: 60_000 });
    expect(cache.setCalls[0]?.key).toContain(
      `space-cache:v2:evidence-bundle:space:${keyInput.knowledgeSpaceId}:version:hybrid-rerank-v1:`,
    );
    expect(cache.setCalls[0]?.key).not.toContain("What evidence supports the cache?");
    await expect(
      evidenceCache.get({
        ...keyInput,
        indexProjectionFingerprint: "dense@13+fts@9",
      }),
    ).resolves.toBeNull();
    await expect(
      evidenceCache.get({
        ...keyInput,
        snapshotFingerprint:
          "snapshot-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).resolves.toBeNull();
    await expect(
      evidenceCache.get({
        ...keyInput,
        retrievalStrategy: "dense-only",
      }),
    ).resolves.toBeNull();
    await evidenceCache.set({ ...keyInput, filters: undefined }, bundle);
    await expect(evidenceCache.get({ ...keyInput, filters: undefined })).resolves.toEqual(bundle);

    await cache.set(cache.setCalls[0]?.key ?? "", new TextEncoder().encode("{"));
    await expect(evidenceCache.get(keyInput)).resolves.toBeNull();
    await expect(evidenceCache.get({ ...keyInput, query: " " })).rejects.toThrow(
      "EvidenceBundle cache query is required",
    );
    await expect(evidenceCache.get({ ...keyInput, retrievalStrategy: " " })).rejects.toThrow(
      "EvidenceBundle cache retrievalStrategy is required",
    );
    await expect(
      evidenceCache.get({ ...keyInput, indexProjectionFingerprint: " " }),
    ).rejects.toThrow("EvidenceBundle cache indexProjectionFingerprint is required");
    await expect(evidenceCache.get({ ...keyInput, snapshotFingerprint: " " })).rejects.toThrow(
      "EvidenceBundle cache snapshotFingerprint is required",
    );
    await expect(evidenceCache.get({ ...keyInput, knowledgeSpaceId: " " })).rejects.toThrow(
      "EvidenceBundle cache knowledgeSpaceId is required",
    );
    expect(() =>
      createEvidenceBundleCache({
        cache,
        strategyVersion: "hybrid-rerank-v1",
        ttlMs: 0,
      }),
    ).toThrow("EvidenceBundle cache ttlMs must be at least 1");
    expect(() =>
      createEvidenceBundleCache({
        cache,
        maxQueryBytes: 0,
        strategyVersion: "hybrid-rerank-v1",
        ttlMs: 60_000,
      }),
    ).toThrow("EvidenceBundle cache maxQueryBytes must be at least 1");
    expect(() =>
      createEvidenceBundleCache({
        cache,
        strategyVersion: " ",
        ttlMs: 60_000,
      }),
    ).toThrow("EvidenceBundle cache strategyVersion is required");
    await expect(
      createEvidenceBundleCache({
        cache,
        maxQueryBytes: 4,
        strategyVersion: "hybrid-rerank-v1",
        ttlMs: 60_000,
      }).get(keyInput),
    ).rejects.toThrow("EvidenceBundle cache query exceeds maxQueryBytes=4");
  });

  it("records AnswerTrace steps with bounded in-memory and database repositories", async () => {
    const repository = createInMemoryAnswerTraceRepository({
      maxSteps: 8,
      maxTraces: 2,
    });
    const recorder = createAnswerTraceRecorder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      maxSteps: 8,
      now: () => "2026-05-11T13:40:00.000Z",
      repository,
    });
    const trace = await recorder.record({
      evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "research",
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        revision: 1,
      },
      query: "How was the answer produced?",
      subjectId: "user-1",
      steps: [
        { metadata: { cacheHit: false }, name: "normalize", status: "ok" },
        { metadata: { resolvedMode: "research" }, name: "route", status: "ok" },
        { metadata: { denseCandidates: 4, ftsCandidates: 3 }, name: "recall", status: "ok" },
        { metadata: { permissionFilteredCandidates: 1 }, name: "filter", status: "ok" },
        { metadata: { rerankCandidates: 5 }, name: "rerank", status: "ok" },
        { metadata: { state: "answerable" }, name: "evidence", status: "ok" },
      ],
    });

    expect(trace).toEqual({
      createdAt: "2026-05-11T13:40:00.000Z",
      evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "research",
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        revision: 1,
      },
      query: "How was the answer produced?",
      subjectId: "user-1",
      steps: [
        expect.objectContaining({ metadata: { cacheHit: false }, name: "normalize", status: "ok" }),
        expect.objectContaining({ metadata: { resolvedMode: "research" }, name: "route" }),
        expect.objectContaining({
          metadata: { denseCandidates: 4, ftsCandidates: 3 },
          name: "recall",
        }),
        expect.objectContaining({ metadata: { permissionFilteredCandidates: 1 }, name: "filter" }),
        expect.objectContaining({ metadata: { rerankCandidates: 5 }, name: "rerank" }),
        expect.objectContaining({ metadata: { state: "answerable" }, name: "evidence" }),
      ],
    });
    const firstTraceStep = trace.steps[0];
    expect(firstTraceStep).toBeDefined();
    if (firstTraceStep) {
      firstTraceStep.metadata.cacheHit = true;
    }
    await expect(
      repository.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        steps: expect.arrayContaining([
          expect.objectContaining({ metadata: { cacheHit: false }, name: "normalize" }),
        ]),
      }),
    );
    await expect(
      repository.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
      }),
    ).resolves.toBeNull();
    await expect(
      recorder.record({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        mode: "fast",
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          revision: 1,
        },
        query: "too many",
        subjectId: "user-1",
        steps: Array.from({ length: 9 }, (_, index) => ({
          metadata: {},
          name: `step-${index}`,
          status: "ok" as const,
        })),
      }),
    ).rejects.toThrow("AnswerTrace recorder step count exceeds maxSteps=8");

    const fake = createFakeAnswerTraceExecutor();
    const databaseRepository = createDatabaseAnswerTraceRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
    });
    const persistedTrace = await repository.get({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
    });
    expect(persistedTrace).not.toBeNull();
    if (!persistedTrace) {
      throw new Error("Expected persisted trace");
    }
    await databaseRepository.create(persistedTrace);

    let persistedWrites = fake.calls.filter((call) => call.operation === "insert");
    expect(persistedWrites).toHaveLength(2);
    expect(persistedWrites[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        params: [
          trace.id,
          null,
          trace.knowledgeSpaceId,
          null,
          trace.evidenceBundleId,
          trace.query,
          trace.mode,
          trace.subjectId,
          trace.permissionSnapshot?.id,
          trace.permissionSnapshot?.revision,
          trace.permissionSnapshot?.accessChannel,
          true,
          trace.createdAt,
        ],
        tableName: "answer_traces",
      }),
    );
    expect(persistedWrites[0]?.sql).toContain("answer_traces");
    expect(persistedWrites[1]).toEqual(
      expect.objectContaining({
        maxRows: trace.steps.length,
        operation: "insert",
        tableName: "answer_trace_steps",
      }),
    );
    expect(persistedWrites[1]?.params).not.toContain(trace.query);
    expect(persistedWrites[1]?.params).toContain("normalize");
    expect(persistedWrites[1]?.params).toContain(JSON.stringify({ cacheHit: false }));

    const errorTrace = {
      createdAt: "2026-05-11T13:41:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "fast" as const,
      query: "failed answer",
      steps: [
        {
          metadata: { errorClass: "ProviderError" },
          name: "recall",
          startedAt: "2026-05-11T13:41:00.000Z",
          status: "error" as const,
        },
      ],
    };
    await databaseRepository.create(errorTrace);
    persistedWrites = fake.calls.filter((call) => call.operation === "insert");
    expect(persistedWrites[2]?.params).toContain(null);
    expect(persistedWrites[2]?.params).toContain(false);
    expect(persistedWrites[3]?.params).toContain("2026-05-11T13:41:00.000Z");

    await databaseRepository.create({
      ...errorTrace,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a03",
      steps: [],
    });
    persistedWrites = fake.calls.filter((call) => call.operation === "insert");
    expect(persistedWrites).toHaveLength(5);
    await expect(
      databaseRepository.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a03",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      }),
    ).resolves.toBeNull();

    expect(() => createInMemoryAnswerTraceRepository({ maxSteps: 0, maxTraces: 1 })).toThrow(
      "AnswerTrace repository maxSteps must be at least 1",
    );
    expect(() => createInMemoryAnswerTraceRepository({ maxSteps: 1, maxTraces: 0 })).toThrow(
      "AnswerTrace repository maxTraces must be at least 1",
    );
    expect(() =>
      createAnswerTraceRecorder({
        maxSteps: 0,
        repository,
      }),
    ).toThrow("AnswerTrace recorder maxSteps must be at least 1");
    const smallRepository = createInMemoryAnswerTraceRepository({ maxSteps: 1, maxTraces: 1 });
    await smallRepository.create({
      createdAt: "2026-05-11T13:42:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a04",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "auto",
      query: "first",
      steps: [],
    });
    await expect(
      smallRepository.create({
        createdAt: "2026-05-11T13:42:01.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a05",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
        mode: "auto",
        query: "second",
        steps: [],
      }),
    ).rejects.toThrow("AnswerTrace repository maxTraces=1 exceeded");

    const readCalls: DatabaseExecuteInput[] = [];
    const readRepository = createDatabaseAnswerTraceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          readCalls.push({
            ...input,
            params: [...input.params],
          });

          if (input.tableName === "answer_traces") {
            return {
              rows: [
                {
                  completed: true,
                  created_at: "2026-05-11T13:43:00.000Z",
                  evidence_bundle_id: null,
                  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a06",
                  knowledge_space_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
                  mode: "deep",
                  query: "read trace",
                },
              ],
              rowsAffected: 1,
            };
          }

          return {
            rows: [
              {
                ended_at: "2026-05-11T13:43:01.000Z",
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7d01",
                metadata: { skippedReason: "cache-hit" },
                name: "rerank",
                started_at: "2026-05-11T13:43:00.000Z",
                status: "skipped",
                trace_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a06",
              },
            ],
            rowsAffected: 1,
          };
        },
        kind: "postgres",
      }),
    });
    await expect(
      readRepository.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a06",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      }),
    ).resolves.toMatchObject({
      mode: "deep",
      steps: [
        {
          metadata: { skippedReason: "cache-hit" },
          name: "rerank",
          status: "skipped",
        },
      ],
    });
    expect(readCalls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c40", "018f0d60-7a49-7cc2-9c1b-5b36f18f7a06"],
        tableName: "answer_traces",
      }),
    );
    expect(readCalls[1]).toEqual(
      expect.objectContaining({
        maxRows: 1000,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7a06"],
        tableName: "answer_trace_steps",
      }),
    );
    await expect(
      readRepository.getById("018f0d60-7a49-7cc2-9c1b-5b36f18f7a06"),
    ).resolves.toMatchObject({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "deep",
    });
    expect(readCalls[2]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7a06"],
        tableName: "answer_traces",
      }),
    );
    expect(readCalls[2]?.sql).not.toContain("018f0d60-7a49-7cc2-9c1b-5b36f18f7a06");

    const cleanupRepository = createInMemoryAnswerTraceRepository({
      maxSteps: 4,
      maxTraces: 4,
    });
    const oldTrace = AnswerTraceSchema.parse({
      createdAt: "2026-05-11T12:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a07",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
      mode: "auto",
      query: "old trace",
      steps: [],
    });
    const secondOldTrace = AnswerTraceSchema.parse({
      ...oldTrace,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a08",
      query: "second old trace",
    });
    const recentTrace = AnswerTraceSchema.parse({
      ...oldTrace,
      createdAt: "2026-05-11T13:30:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a09",
      query: "recent trace",
    });
    const otherSpaceTrace = AnswerTraceSchema.parse({
      ...oldTrace,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
      query: "other space trace",
    });
    await cleanupRepository.create(oldTrace);
    await cleanupRepository.create(secondOldTrace);
    await cleanupRepository.create(recentTrace);
    await cleanupRepository.create(otherSpaceTrace);
    await expect(
      cleanupRepository.deleteOlderThan({
        knowledgeSpaceId: oldTrace.knowledgeSpaceId,
        maxTraces: 1,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).rejects.toThrow("AnswerTrace cleanup maxTraces=1 exceeded");
    await expect(
      cleanupRepository.deleteOlderThan({
        knowledgeSpaceId: oldTrace.knowledgeSpaceId,
        maxTraces: 2,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).resolves.toBe(2);
    await expect(cleanupRepository.getById(oldTrace.id)).resolves.toBeNull();
    await expect(cleanupRepository.getById(secondOldTrace.id)).resolves.toBeNull();
    await expect(cleanupRepository.getById(recentTrace.id)).resolves.toEqual(recentTrace);
    await expect(cleanupRepository.getById(otherSpaceTrace.id)).resolves.toEqual(otherSpaceTrace);
    await expect(
      cleanupRepository.deleteOlderThan({
        knowledgeSpaceId: oldTrace.knowledgeSpaceId,
        maxTraces: 0,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).rejects.toThrow("AnswerTrace cleanup maxTraces must be at least 1");

    const cleanupFake = createFakeAnswerTraceExecutor();
    const cleanupDatabaseRepository = createDatabaseAnswerTraceRepository({
      database: createSchemaDatabaseAdapter({ executor: cleanupFake.executor, kind: "postgres" }),
    });
    await expect(
      cleanupDatabaseRepository.deleteOlderThan({
        knowledgeSpaceId: oldTrace.knowledgeSpaceId,
        maxTraces: 25,
        olderThan: "2026-05-11T13:00:00.000Z",
      }),
    ).resolves.toBe(0);
    expect(cleanupFake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 25,
        operation: "delete",
        params: [oldTrace.knowledgeSpaceId, "2026-05-11T13:00:00.000Z", 25],
        tableName: "answer_trace_steps",
      }),
    );
    expect(cleanupFake.calls[1]).toEqual(
      expect.objectContaining({
        maxRows: 25,
        operation: "delete",
        params: [oldTrace.knowledgeSpaceId, "2026-05-11T13:00:00.000Z", 25],
        tableName: "answer_traces",
      }),
    );
    expect(cleanupFake.calls[1]?.sql).not.toContain(oldTrace.knowledgeSpaceId);
  });

  it("evaluates rule-based EvidenceBundle answerability states", () => {
    const evaluator = createAnswerabilityEvaluator({
      minFinalScore: 0.6,
      minItems: 1,
    });
    const evidenceItem = {
      citations: [
        {
          artifactHash: "a".repeat(64),
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c01",
          documentVersion: 1,
          sectionPath: ["Answerability"],
        },
      ],
      conflicts: [],
      freshness: { status: "fresh" as const },
      metadata: {},
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
      score: 0.8,
      scores: { final: 0.8, retrieval: 0.8 },
      text: "Strong answer evidence.",
    };

    expect(evaluator.evaluate({ items: [evidenceItem], missingEvidence: [] })).toBe("answerable");
    expect(
      evaluator.evaluate({
        items: [{ ...evidenceItem, freshness: { status: "stale" as const } }],
        missingEvidence: [],
      }),
    ).toBe("partial");
    expect(
      evaluator.evaluate({
        items: [evidenceItem],
        missingEvidence: [
          {
            metadata: {},
            reason: "not-retrieved",
            text: "Need another source.",
          },
        ],
      }),
    ).toBe("partial");
    expect(
      evaluator.evaluate({
        items: [
          {
            ...evidenceItem,
            conflicts: [{ reason: "Contradiction.", severity: "blocking" as const }],
          },
        ],
        missingEvidence: [],
      }),
    ).toBe("conflict");
    expect(
      evaluator.evaluate({
        items: [evidenceItem],
        missingEvidence: [
          {
            metadata: {},
            reason: "permission-filtered",
            text: "Hidden ACL source.",
          },
        ],
      }),
    ).toBe("permission-limited");
    expect(evaluator.evaluate({ items: [], missingEvidence: [] })).toBe("not-enough-evidence");
    expect(
      evaluator.evaluate({
        items: [{ ...evidenceItem, score: 0.4, scores: { final: 0.4, retrieval: 0.4 } }],
        missingEvidence: [],
      }),
    ).toBe("not-enough-evidence");
    expect(
      evaluator.evaluate({ items: [evidenceItem], missingEvidence: [], permissionLimited: true }),
    ).toBe("permission-limited");
    expect(() => createAnswerabilityEvaluator({ minFinalScore: 1.2 })).toThrow(
      "Answerability minFinalScore must be between 0 and 1",
    );
    expect(() => createAnswerabilityEvaluator({ minItems: 0 })).toThrow(
      "Answerability minItems must be at least 1",
    );
  });

  it("keeps health and OpenAPI public while requiring auth for knowledge-space routes", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
    });

    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/openapi.json")).status).toBe(200);

    const missingToken = await app.request("/knowledge-spaces?limit=1");
    expect(missingToken.status).toBe(401);
    await expect(missingToken.json()).resolves.toEqual({ error: "Unauthorized" });

    const badToken = await app.request("/knowledge-spaces?limit=1", {
      headers: bearer("bad-token"),
    });
    expect(badToken.status).toBe(401);

    const missingScope = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "No Write", slug: "no-write" }),
      headers: { ...bearer(readToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(missingScope.status).toBe(403);
    await expect(missingScope.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns unauthorized for protected routes when no auth verifier is configured", async () => {
    const app = createKnowledgeGateway({ adapter: createNodePlatformAdapter({ env: {} }) });

    const response = await app.request("/knowledge-spaces?limit=1", {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns structured not-found and unexpected-error responses", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaces: {
        create: async () => {
          throw new Error("database password leaked here");
        },
        get: async () => null,
        getForDeletion: async () => null,
        list: async () => ({ items: [] }),
        rollbackCreate: async () => false,
        update: async () => null,
      },
    });

    const notFound = await app.request("/not-a-route");
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({ error: "Not found" });

    const unexpected = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Broken", slug: "broken" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({ error: "Internal server error" });
  });

  it("rate limits protected routes by tenant, agent, and tool with structured metadata", async () => {
    let now = 0;
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: (() => {
          let counter = 0;
          return () => `018f0d60-7a49-7cc2-9c1b-5b36f18f2d0${++counter}`;
        })(),
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      rateLimiter: createInMemoryRateLimiter({
        defaultLimit: 1,
        maxKeys: 100,
        now: () => now,
        windowMs: 1_000,
      }),
    });

    const firstList = await app.request("/knowledge-spaces?limit=1", {
      headers: bearer(readToken),
    });
    const secondList = await app.request("/knowledge-spaces?limit=1", {
      headers: bearer(readToken),
    });
    const writeOnDifferentTool = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "One", slug: "one" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    const sameAgentOtherTenant = await app.request("/knowledge-spaces?limit=1", {
      headers: bearer(otherTenantToken),
    });

    expect(firstList.status).toBe(200);
    expect(secondList.status).toBe(429);
    expect(secondList.headers.get("retry-after")).toBe("1");
    await expect(secondList.json()).resolves.toEqual({
      error: "Rate limit exceeded",
      limit: 1,
      remaining: 0,
      resetAt: "1970-01-01T00:00:01.000Z",
      retryAfterSeconds: 1,
      tool: "knowledge-spaces.list",
      windowMs: 1000,
    });
    expect(writeOnDifferentTool.status).toBe(201);
    expect(sameAgentOtherTenant.status).toBe(200);

    now = 1_000;
    const resetList = await app.request("/knowledge-spaces?limit=1", {
      headers: bearer(readToken),
    });
    expect(resetList.status).toBe(200);
  });

  it("keeps public routes outside rate limits and bounds in-memory limiter keys", async () => {
    const rateLimiter = createInMemoryRateLimiter({
      defaultLimit: 1,
      maxKeys: 1,
      now: () => 0,
      windowMs: 1_000,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      rateLimiter,
    });

    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/openapi.json")).status).toBe(200);
    expect(
      (await app.request("/knowledge-spaces?limit=1", { headers: bearer(readToken) })).status,
    ).toBe(200);
    await expect(
      rateLimiter.check({
        subjectId: "another-agent",
        tenantId: "tenant-1",
        tool: "knowledge-spaces.list",
      }),
    ).rejects.toThrow(InMemoryRateLimitCapacityExceededError);

    expect(() =>
      createInMemoryRateLimiter({ defaultLimit: 0, maxKeys: 1, windowMs: 1_000 }),
    ).toThrow("Rate limiter defaultLimit must be at least 1");
    expect(() =>
      createInMemoryRateLimiter({ defaultLimit: 1, maxKeys: 0, windowMs: 1_000 }),
    ).toThrow("Rate limiter maxKeys must be at least 1");
    expect(() => createInMemoryRateLimiter({ defaultLimit: 1, maxKeys: 1, windowMs: 0 })).toThrow(
      "Rate limiter windowMs must be at least 1",
    );
  });

  it("isolates knowledge spaces by authenticated tenant for all id-based mutations", async () => {
    const app = createKnowledgeGateway({
      ...createAllowingDurableDeletionSafetyOptions(),
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      durableDeletions: createNotFoundDurableDeletionService(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-08T10:00:00.000Z",
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Tenant One", slug: "tenant-one" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const crossTenantRead = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      { headers: bearer(otherTenantToken) },
    );
    expect(crossTenantRead.status).toBe(404);

    const crossTenantUpdate = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      {
        body: JSON.stringify({ expectedRevision: 1, name: "Leaked" }),
        headers: { ...bearer(otherTenantToken), "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(crossTenantUpdate.status).toBe(404);

    const crossTenantDelete = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      {
        body: JSON.stringify({ challenge: "Tenant One", expectedRevision: 1 }),
        headers: {
          ...bearer(otherTenantToken),
          "content-type": "application/json",
          "idempotency-key": "cross-tenant-space-delete",
        },
        method: "DELETE",
      },
    );
    expect(crossTenantDelete.status).toBe(404);

    const ownerRead = await app.request("/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42", {
      headers: bearer(readToken),
    });
    expect(ownerRead.status).toBe(200);
    await expect(ownerRead.json()).resolves.toMatchObject({ name: "Tenant One" });
  });
});
