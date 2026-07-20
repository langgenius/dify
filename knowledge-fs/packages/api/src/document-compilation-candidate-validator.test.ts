import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecutor,
  DatabaseRow,
  ProjectionSetFingerprintMaterial,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import {
  DocumentCompilationCandidateValidationError,
  createDatabaseDocumentCompilationCandidateValidator,
} from "./document-compilation-candidate-validator";
import type { ProjectionSetPublicationDocumentComponentInput } from "./projection-publication-member-repository";

const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const nodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const outlineId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const manifestId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const documentPathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const sectionPathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4d";
const itemPathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4e";
const outlinePathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
const manifestPathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51";
const projectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49";
const entityA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4a";
const entityB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4b";
const relationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4c";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4f";
const outlineNodeId = "outline-node-1";
const multimodalItemId = "multimodal-item-1";
const assetSha256 = "a".repeat(64);
const artifactHash = "b".repeat(64);

describe("database document compilation candidate validator", () => {
  it("validates owner lineage, stored dimensions, permissions, and path closures", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const validator = validatorForRows(candidateRows(), { calls });

    await expect(validator.validate(validationInput())).resolves.toBeUndefined();
    expect(calls.find((call) => call.tableName === "index_projections")?.sql).toContain(
      'vector_dims("dense_vector")',
    );
  });

  it("uses TiDB VEC_DIMS for authoritative stored-vector dimensions", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const validator = validatorForRows(candidateRows(), { calls, dialect: "tidb" });

    await expect(validator.validate(validationInput())).resolves.toBeUndefined();
    expect(calls.find((call) => call.tableName === "index_projections")?.sql).toContain(
      "VEC_DIMS(`dense_vector`)",
    );
  });

  it("rejects fingerprint hashes that do not identify the asset and unique parse artifact", async () => {
    const validator = validatorForRows(candidateRows());
    const material = fingerprintMaterial();

    await expect(
      validator.validate({
        ...validationInput(),
        fingerprintMaterial: {
          ...material,
          sourceSnapshots: [
            {
              artifactHash,
              documentAssetId: documentId,
              sha256: "c".repeat(64),
              version: 1,
            },
          ],
        },
      }),
    ).rejects.toThrow("sha256 mismatches");

    await expect(
      validator.validate({
        ...validationInput(),
        fingerprintMaterial: {
          ...material,
          sourceSnapshots: [
            {
              artifactHash: "d".repeat(64),
              documentAssetId: documentId,
              sha256: assetSha256,
              version: 1,
            },
          ],
        },
      }),
    ).rejects.toThrow("artifactHash mismatches");
  });

  it("rejects missing or ambiguous parse lineage", async () => {
    const rows = candidateRows();
    rows.parse_artifacts?.push({
      artifact_hash: artifactHash,
      document_asset_id: documentId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
      version: 1,
    });

    await expect(validatorForRows(rows).validate(validationInput())).rejects.toThrow(
      "exactly one parse artifact",
    );
  });

  it("rejects projection or node lineage that escapes the owner parse artifact", async () => {
    const rows = candidateRows();
    const node = requiredRow(rows, "knowledge_nodes");
    rows.knowledge_nodes = [{ ...node, artifact_hash: "d".repeat(64) }];

    await expect(validatorForRows(rows).validate(validationInput())).rejects.toThrow(
      "knowledge node",
    );
  });

  it("rejects metadata, stored, and persisted dense dimension disagreement", async () => {
    const rows = candidateRows();
    const projection = requiredRow(rows, "index_projections");
    rows.index_projections = [{ ...projection, dense_vector_dimension: 4 }];

    await expect(validatorForRows(rows).validate(validationInput())).rejects.toThrow(
      "mismatches stored=4",
    );
    await expect(
      validatorForRows(candidateRows(), { profileDimension: undefined }).validate(
        validationInput(),
      ),
    ).rejects.toThrow("no persisted embedding dimension");
    await expect(
      validatorForRows(candidateRows()).validate(
        validationInput({ projectionModel: "another-vector-space" }),
      ),
    ).rejects.toThrow("fingerprint vector-space config");
  });

  it("validates independent visual vectors against their fingerprint model config", async () => {
    const rows = candidateRows();
    const projection = requiredRow(rows, "index_projections");
    rows.index_projections = [
      {
        ...projection,
        dense_vector_dimension: null,
        metadata: {
          artifactHash,
          dimension: 4,
          documentAssetId: documentId,
          multimodal: { vectorSpace: "visual" },
          parseArtifactId,
        },
        model: "visual-model",
        visual_vector_dimension: 4,
      },
    ];
    const input = validationInput({ projectionModel: "visual-model" });
    await expect(validatorForRows(rows).validate(input)).resolves.toBeUndefined();

    await expect(
      validatorForRows(rows).validate(validationInput({ projectionModel: "other-model" })),
    ).rejects.toThrow("fingerprint model config");
  });

  it("rejects asset, node, or graph permission widening", async () => {
    const nodeRows = candidateRows();
    const node = requiredRow(nodeRows, "knowledge_nodes");
    nodeRows.knowledge_nodes = [{ ...node, permission_scope: ["team:other"] }];
    await expect(validatorForRows(nodeRows).validate(validationInput())).rejects.toThrow(
      "permission scope mismatches its document asset",
    );

    const graphRows = candidateRows();
    const entity = requiredRow(graphRows, "graph_entities");
    graphRows.graph_entities = [
      { ...entity, permission_scope: ["team:docs", "team:other"] },
      graphRows.graph_entities?.[1] as DatabaseRow,
    ];
    await expect(validatorForRows(graphRows).validate(validationInput())).rejects.toThrow(
      "source-node union",
    );
  });

  it("requires explicit asset permissions and owner-scoped physical document paths", async () => {
    const permissionRows = candidateRows();
    const asset = requiredRow(permissionRows, "document_assets");
    permissionRows.document_assets = [{ ...asset, metadata: {} }];
    await expect(validatorForRows(permissionRows).validate(validationInput())).rejects.toThrow(
      "explicit permissionScope",
    );

    const pathRows = candidateRows();
    const knowledgePaths = pathRows.knowledge_paths;
    const sectionPath = knowledgePaths?.[1];
    if (!knowledgePaths || !sectionPath) {
      throw new Error("Expected section path fixture");
    }
    pathRows.knowledge_paths = knowledgePaths.map((row) =>
      row.id === sectionPathId
        ? {
            ...sectionPath,
            metadata: {
              contentKind: "document-section",
              outlineId,
              outlineNodeId: "ghost",
              tenantId: "tenant-1",
            },
          }
        : row,
    );
    await expect(validatorForRows(pathRows).validate(validationInput())).rejects.toThrow(
      "outline closure",
    );
  });

  it("rejects a graph relation whose endpoint is outside the receipt entity closure", async () => {
    const rows = candidateRows();
    const relation = requiredRow(rows, "graph_relations");
    rows.graph_relations = [
      { ...relation, object_entity_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff" },
    ];

    await expect(validatorForRows(rows).validate(validationInput())).rejects.toThrow(
      "escapes the owner entity closure",
    );
  });
});

function validationInput(overrides: { readonly projectionModel?: string } = {}) {
  return {
    attempt: attempt(),
    components: candidateComponents(),
    fingerprintMaterial: fingerprintMaterial(overrides),
  };
}

function validatorForRows(
  rows: Record<string, DatabaseRow[]>,
  options: {
    readonly calls?: DatabaseExecuteInput[];
    readonly dialect?: "postgres" | "tidb";
    readonly profileDimension?: number | undefined;
  } = {},
) {
  const profileDimension = Object.hasOwn(options, "profileDimension")
    ? options.profileDimension
    : 3;
  return createDatabaseDocumentCompilationCandidateValidator({
    database: fakeDatabase(rows, options.dialect ?? "postgres", options.calls),
    manifests: {
      get: async () =>
        ({
          embeddingProfile: {
            ...(profileDimension === undefined ? {} : { dimension: profileDimension }),
            model: "embedding-model",
            pluginId: "plugin-daemon",
            provider: "provider",
            revision: 1,
            vectorSpaceId: "vector-space-1",
          },
          metadata: {},
        }) as never,
    },
    maxBatchSize: 2,
  });
}

function fakeDatabase(
  rows: Record<string, DatabaseRow[]>,
  dialect: "postgres" | "tidb",
  calls: DatabaseExecuteInput[] = [],
): DatabaseAdapter {
  const execute = async (input: DatabaseExecuteInput) => {
    calls.push(input);
    const available = rows[input.tableName] ?? [];
    if (input.tableName === "knowledge_spaces" || input.tableName === "document_assets") {
      return { rows: available.slice(0, 1), rowsAffected: 0 };
    }
    if (input.tableName === "parse_artifacts") {
      return { rows: available.slice(0, input.maxRows), rowsAffected: 0 };
    }
    const requested = new Set(input.params.map(String));
    const selected = available.filter((row) => requested.has(String(row.id)));
    return { rows: selected, rowsAffected: 0 };
  };

  return {
    dialect,
    execute,
    kind: dialect,
    transaction: async <T>(callback: (executor: DatabaseExecutor) => Promise<T>) =>
      callback({ execute }),
  } as unknown as DatabaseAdapter;
}

function attempt(): DocumentCompilationAttempt {
  return {
    activeSlot: 1,
    baseHeadRevision: 0,
    checkpoint: "nodes_generated",
    createdAt: "2026-07-13T10:00:00.000Z",
    documentAssetId: documentId,
    documentVersion: 1,
    executionAttempts: 1,
    heartbeatAt: "2026-07-13T10:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40",
    knowledgeSpaceId: spaceId,
    leaseExpiresAt: "2026-07-13T10:01:00.000Z",
    leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
    maxExecutionAttempts: 3,
    publicationGenerationId: generationId,
    rowVersion: 2,
    runState: "running",
    startedAt: "2026-07-13T10:00:00.000Z",
    tenantId: "tenant-1",
    updatedAt: "2026-07-13T10:00:00.000Z",
    workerId: "worker-1",
  };
}

function fingerprintMaterial({
  projectionModel = "vector-space-1",
} = {}): ProjectionSetFingerprintMaterial {
  return {
    chunkerVersion: "chunker-v1",
    indexVersion: "index-v1",
    knowledgeSpaceId: spaceId,
    nodeSchemaVersion: 1,
    parserPolicyVersion: "parser-v1",
    projectionSetVersion: "projection-set-v1",
    projections: [
      {
        indexVersion: "dense-v1",
        model: projectionModel,
        projectionVersion: 1,
        strategy: "dense",
        type: "dense-vector",
      },
    ],
    sourceSnapshots: [
      { artifactHash, documentAssetId: documentId, sha256: assetSha256, version: 1 },
    ],
  };
}

function candidateComponents(): ProjectionSetPublicationDocumentComponentInput[] {
  return [
    component("document-outline", outlineId),
    component("multimodal-manifest", manifestId),
    component("knowledge-path", documentPathId),
    component("knowledge-path", sectionPathId),
    component("knowledge-path", itemPathId),
    component("knowledge-path", outlinePathId),
    component("knowledge-path", manifestPathId),
    component("index-projection", projectionId),
    component("graph-entity", entityA),
    component("graph-entity", entityB),
    component("graph-relation", relationId),
  ];
}

function component(
  componentType: ProjectionSetPublicationDocumentComponentInput["componentType"],
  componentKey: string,
): ProjectionSetPublicationDocumentComponentInput {
  return { componentKey, componentType, generationId };
}

function candidateRows(): Record<string, DatabaseRow[]> {
  const scope = { knowledge_space_id: spaceId, publication_generation_id: generationId };
  const ownerArtifact = {
    artifact_hash: artifactHash,
    document_asset_id: documentId,
    parse_artifact_id: parseArtifactId,
  };
  const permissionScope = ["team:docs"];
  const documentPrefix = "/knowledge/docs/Camera.pdf--018f0d60";
  return {
    document_assets: [
      {
        filename: "Camera.pdf",
        id: documentId,
        metadata: { permissionScope },
        sha256: assetSha256,
      },
    ],
    document_multimodal_manifests: [
      {
        ...scope,
        ...ownerArtifact,
        id: manifestId,
        items: [{ id: multimodalItemId }],
        version: 1,
      },
    ],
    document_outlines: [
      {
        ...scope,
        ...ownerArtifact,
        id: outlineId,
        nodes: [{ children: [], id: outlineNodeId }],
        version: 1,
      },
    ],
    graph_entities: [
      { ...scope, id: entityA, permission_scope: permissionScope, source_node_ids: [nodeId] },
      { ...scope, id: entityB, permission_scope: permissionScope, source_node_ids: [nodeId] },
    ],
    graph_relations: [
      {
        ...scope,
        id: relationId,
        object_entity_id: entityB,
        permission_scope: permissionScope,
        source_node_ids: [nodeId],
        subject_entity_id: entityA,
      },
    ],
    index_projections: [
      {
        ...scope,
        dense_vector_dimension: 3,
        id: projectionId,
        metadata: {
          artifactHash,
          dimension: 3,
          documentAssetId: documentId,
          embeddingModel: "embedding-model",
          embeddingProfile: { pluginId: "plugin-daemon", provider: "provider", revision: 1 },
          parseArtifactId,
          vectorSpaceId: "vector-space-1",
        },
        model: "vector-space-1",
        node_id: nodeId,
        projection_version: 1,
        status: "building",
        type: "dense-vector",
        visual_vector_dimension: null,
      },
    ],
    knowledge_nodes: [
      { ...scope, ...ownerArtifact, id: nodeId, permission_scope: permissionScope },
    ],
    knowledge_paths: [
      {
        ...scope,
        id: documentPathId,
        metadata: { tenantId: "tenant-1" },
        resource_type: "document",
        target_id: documentId,
        version: 1,
        view_name: "docs",
        view_type: "physical",
        virtual_path: documentPrefix,
      },
      {
        ...scope,
        id: sectionPathId,
        metadata: {
          contentKind: "document-section",
          outlineId,
          outlineNodeId,
          tenantId: "tenant-1",
        },
        resource_type: "document",
        target_id: documentId,
        version: 1,
        view_name: "docs",
        view_type: "physical",
        virtual_path: `${documentPrefix}/sections/camera.md`,
      },
      {
        ...scope,
        id: itemPathId,
        metadata: {
          contentKind: "document-multimodal-asset",
          itemId: multimodalItemId,
          tenantId: "tenant-1",
        },
        resource_type: "document",
        target_id: documentId,
        version: 1,
        view_name: "docs",
        view_type: "physical",
        virtual_path: `${documentPrefix}/assets/image.json`,
      },
      {
        ...scope,
        id: outlinePathId,
        metadata: { contentKind: "document-outline", tenantId: "tenant-1" },
        resource_type: "document",
        target_id: documentId,
        version: 1,
        view_name: "docs",
        view_type: "physical",
        virtual_path: `${documentPrefix}/outline.json`,
      },
      {
        ...scope,
        id: manifestPathId,
        metadata: { contentKind: "document-multimodal-manifest", tenantId: "tenant-1" },
        resource_type: "document",
        target_id: documentId,
        version: 1,
        view_name: "docs",
        view_type: "physical",
        virtual_path: `${documentPrefix}/multimodal.json`,
      },
    ],
    knowledge_spaces: [{ id: spaceId }],
    parse_artifacts: [
      {
        artifact_hash: artifactHash,
        document_asset_id: documentId,
        id: parseArtifactId,
        version: 1,
      },
    ],
  };
}

function requiredRow(rows: Record<string, DatabaseRow[]>, tableName: string): DatabaseRow {
  const row = rows[tableName]?.[0];
  if (!row) {
    throw new Error(`Expected ${tableName} fixture`);
  }
  return row;
}
