import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseRow,
  type KnowledgeSpaceEmbeddingProfile,
  type ProjectionSetFingerprintMaterial,
  ProjectionSetFingerprintMaterialSchema,
  PublicationGenerationIdSchema,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import { KNOWLEDGE_FS_DOCS_ROOT, documentFilenamePathSegment } from "./document-knowledge-paths";
import { isPlainObject, jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import {
  ProjectionSetPublicationComponentTypes,
  type ProjectionSetPublicationDocumentComponentInput,
} from "./projection-publication-member-repository";

export interface ValidateDocumentCompilationCandidateInput {
  readonly attempt: DocumentCompilationAttempt;
  readonly components: readonly ProjectionSetPublicationDocumentComponentInput[];
  readonly fingerprintMaterial: ProjectionSetFingerprintMaterial;
}

export interface DocumentCompilationCandidateValidator {
  validate(input: ValidateDocumentCompilationCandidateInput): Promise<void>;
}

export interface DatabaseDocumentCompilationCandidateValidatorOptions {
  readonly database: DatabaseAdapter;
  readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get">;
  readonly maxBatchSize: number;
}

export class DocumentCompilationCandidateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentCompilationCandidateValidationError";
  }
}

interface CandidateValidationScope {
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly generationId: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

interface CandidateOwnerSnapshot {
  readonly artifactHash: string;
  readonly parseArtifactId: string;
  readonly permissionScope: readonly string[];
  readonly documentFilename: string;
}

const componentTypeSet = new Set<string>(ProjectionSetPublicationComponentTypes);

/**
 * Re-reads every polymorphic member target before candidate membership is composed. The derived
 * rows are treated as immutable within an attempt generation. This proves the replacement receipt
 * at validation time, but member composition is a separate transaction; 3C must revalidate the
 * complete inherited + replacement snapshot under the final publication lock before head CAS.
 */
export function createDatabaseDocumentCompilationCandidateValidator({
  database,
  manifests,
  maxBatchSize,
}: DatabaseDocumentCompilationCandidateValidatorOptions): DocumentCompilationCandidateValidator {
  if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Document compilation candidate validator maxBatchSize must be at least 1");
  }

  return {
    validate: async ({ attempt, components, fingerprintMaterial: rawFingerprintMaterial }) => {
      const scope = candidateValidationScope(attempt);
      const fingerprintMaterial =
        ProjectionSetFingerprintMaterialSchema.parse(rawFingerprintMaterial);
      const grouped = groupCandidateComponents(components, scope.generationId);
      requireCandidateCardinality(grouped);
      const manifest = await manifests.get({
        knowledgeSpaceId: scope.knowledgeSpaceId,
        tenantId: scope.tenantId,
      });
      if (!manifest) {
        throw validationError("Knowledge space manifest was not found");
      }

      await database.transaction(async (transaction) => {
        const owner = await validateAttemptOwnership(
          database,
          transaction,
          scope,
          fingerprintMaterial,
        );

        const outlines = await requireRowsByIds(
          database,
          transaction,
          "document_outlines",
          grouped.get("document-outline") ?? [],
          maxBatchSize,
        );
        const multimodalManifests = await requireRowsByIds(
          database,
          transaction,
          "document_multimodal_manifests",
          grouped.get("multimodal-manifest") ?? [],
          maxBatchSize,
        );
        const knowledgePaths = await requireRowsByIds(
          database,
          transaction,
          "knowledge_paths",
          grouped.get("knowledge-path") ?? [],
          maxBatchSize,
        );
        const projections = await requireProjectionRowsByIds(
          database,
          transaction,
          grouped.get("index-projection") ?? [],
          maxBatchSize,
        );
        const entities = await requireRowsByIds(
          database,
          transaction,
          "graph_entities",
          grouped.get("graph-entity") ?? [],
          maxBatchSize,
        );
        const relations = await requireRowsByIds(
          database,
          transaction,
          "graph_relations",
          grouped.get("graph-relation") ?? [],
          maxBatchSize,
        );

        for (const row of outlines) {
          validateOwnedDerivedRow(row, scope, "document outline");
          requireColumnEquals(row, "document_asset_id", scope.documentAssetId, "document outline");
          requireNumberEquals(row, "version", scope.documentVersion, "document outline");
          validateArtifactLineage(row, owner, "document outline");
        }
        for (const row of multimodalManifests) {
          validateOwnedDerivedRow(row, scope, "multimodal manifest");
          requireColumnEquals(
            row,
            "document_asset_id",
            scope.documentAssetId,
            "multimodal manifest",
          );
          requireNumberEquals(row, "version", scope.documentVersion, "multimodal manifest");
          validateArtifactLineage(row, owner, "multimodal manifest");
        }
        const outlineNodeIds = collectOutlineNodeIds(outlines[0]);
        const multimodalItemIds = collectMultimodalItemIds(multimodalManifests[0]);
        for (const row of knowledgePaths) {
          validateOwnedDerivedRow(row, scope, "knowledge path");
          requireColumnEquals(row, "target_id", scope.documentAssetId, "knowledge path");
          requireColumnEquals(row, "resource_type", "document", "knowledge path");
          requireNumberEquals(row, "version", scope.documentVersion, "knowledge path");
          validateKnowledgePath(row, scope, owner, {
            multimodalItemIds,
            outlineId: stringColumn(outlines[0] as DatabaseRow, "id"),
            outlineNodeIds,
          });
        }
        requireMandatoryDocumentPaths(knowledgePaths, scope, owner);

        const nodeIds = new Set<string>();
        for (const row of projections) {
          validateOwnedDerivedRow(row, scope, "index projection");
          requireColumnEquals(row, "status", "building", "index projection");
          requireNumberEquals(row, "projection_version", scope.documentVersion, "index projection");
          nodeIds.add(stringColumn(row, "node_id"));
          validateProjectionLineage(row, scope, owner, manifest.embeddingProfile);
          validateProjectionEmbedding(row, manifest.embeddingProfile, fingerprintMaterial);
        }

        for (const row of entities) {
          validateOwnedDerivedRow(row, scope, "graph entity");
          addSourceNodeIds(nodeIds, row, "graph entity");
        }
        const entityIds = new Set(entities.map((row) => stringColumn(row, "id")));
        for (const row of relations) {
          validateOwnedDerivedRow(row, scope, "graph relation");
          const subjectId = stringColumn(row, "subject_entity_id");
          const objectId = stringColumn(row, "object_entity_id");
          if (!entityIds.has(subjectId) || !entityIds.has(objectId)) {
            throw validationError(
              `Graph relation ${stringColumn(row, "id")} escapes the owner entity closure`,
            );
          }
          addSourceNodeIds(nodeIds, row, "graph relation");
        }

        const nodes = await requireRowsByIds(
          database,
          transaction,
          "knowledge_nodes",
          [...nodeIds],
          maxBatchSize,
        );
        const nodePermissionScopes = new Map<string, readonly string[]>();
        for (const row of nodes) {
          validateOwnedDerivedRow(row, scope, "knowledge node");
          requireColumnEquals(row, "document_asset_id", scope.documentAssetId, "knowledge node");
          validateArtifactLineage(row, owner, "knowledge node");
          const permissionScope = normalizedPermissionScope(row.permission_scope, "knowledge node");
          if (!sameStrings(permissionScope, owner.permissionScope)) {
            throw validationError(
              `Knowledge node ${stringColumn(row, "id")} permission scope mismatches its document asset`,
            );
          }
          nodePermissionScopes.set(stringColumn(row, "id"), permissionScope);
        }
        for (const row of entities) {
          validateGraphPermissionScope(row, nodePermissionScopes, "graph entity");
        }
        for (const row of relations) {
          validateGraphPermissionScope(row, nodePermissionScopes, "graph relation");
        }
      });
    },
  };
}

function candidateValidationScope(attempt: DocumentCompilationAttempt): CandidateValidationScope {
  if (attempt.runState !== "running") {
    throw validationError("Document compilation attempt is not running");
  }

  return {
    documentAssetId: UuidSchema.parse(attempt.documentAssetId),
    documentVersion: positiveInteger(attempt.documentVersion, "documentVersion"),
    generationId: PublicationGenerationIdSchema.parse(attempt.publicationGenerationId),
    knowledgeSpaceId: UuidSchema.parse(attempt.knowledgeSpaceId),
    tenantId: TenantIdSchema.parse(attempt.tenantId),
  };
}

function groupCandidateComponents(
  components: readonly ProjectionSetPublicationDocumentComponentInput[],
  generationId: string,
): Map<ProjectionSetPublicationDocumentComponentInput["componentType"], string[]> {
  const grouped = new Map<
    ProjectionSetPublicationDocumentComponentInput["componentType"],
    string[]
  >();
  const identities = new Set<string>();

  for (const component of components) {
    if (!componentTypeSet.has(component.componentType)) {
      throw validationError(`Unsupported component type=${component.componentType}`);
    }
    const componentKey = UuidSchema.parse(component.componentKey);
    const observedGeneration = PublicationGenerationIdSchema.parse(component.generationId);
    if (observedGeneration !== generationId) {
      throw validationError(`Component ${componentKey} belongs to another generation`);
    }
    const identity = `${component.componentType}:${componentKey}`;
    if (identities.has(identity)) {
      throw validationError(`Duplicate candidate component=${identity}`);
    }
    identities.add(identity);
    const type = component.componentType;
    grouped.set(type, [...(grouped.get(type) ?? []), componentKey]);
  }

  return grouped;
}

function requireCandidateCardinality(
  grouped: ReadonlyMap<ProjectionSetPublicationDocumentComponentInput["componentType"], string[]>,
): void {
  if ((grouped.get("document-outline")?.length ?? 0) !== 1) {
    throw validationError("Candidate must contain exactly one document outline");
  }
  if ((grouped.get("multimodal-manifest")?.length ?? 0) !== 1) {
    throw validationError("Candidate must contain exactly one multimodal manifest");
  }
  if ((grouped.get("knowledge-path")?.length ?? 0) < 1) {
    throw validationError("Candidate must contain at least one knowledge path");
  }
}

async function validateAttemptOwnership(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: CandidateValidationScope,
  fingerprintMaterial: ProjectionSetFingerprintMaterial,
): Promise<CandidateOwnerSnapshot> {
  if (fingerprintMaterial.knowledgeSpaceId !== scope.knowledgeSpaceId) {
    throw validationError("Projection fingerprint material belongs to another knowledge space");
  }
  const ownerSnapshots = fingerprintMaterial.sourceSnapshots.filter(
    (snapshot) => snapshot.documentAssetId === scope.documentAssetId,
  );
  const ownerSnapshot = ownerSnapshots[0];
  if (
    ownerSnapshots.length !== 1 ||
    !ownerSnapshot ||
    ownerSnapshot.version !== scope.documentVersion
  ) {
    throw validationError(
      "Projection fingerprint material must contain exactly the attempt owner document version",
    );
  }

  const space = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
      database,
      "knowledge_spaces",
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      2,
    )} LIMIT 1;`,
    tableName: "knowledge_spaces",
  });
  if (!space.rows[0]) {
    throw validationError("Knowledge space does not belong to the attempt tenant");
  }

  const asset = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.knowledgeSpaceId, scope.documentAssetId, scope.documentVersion],
    sql: `SELECT ${["id", "filename", "sha256", "metadata"]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(
        ", ",
      )} FROM ${quoteDatabaseIdentifier(database, "document_assets")} WHERE ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "version",
    )} = ${databasePlaceholder(database, 3)} LIMIT 1;`,
    tableName: "document_assets",
  });
  if (!asset.rows[0]) {
    throw validationError("Document asset version does not belong to the attempt space");
  }

  const assetRow = asset.rows[0];
  if (stringColumn(assetRow, "sha256") !== ownerSnapshot.sha256) {
    throw validationError("Projection fingerprint owner sha256 mismatches the document asset");
  }
  const assetMetadata = jsonObjectColumn(assetRow, "metadata");
  if (!("permissionScope" in assetMetadata)) {
    throw validationError("Document asset metadata must contain an explicit permissionScope array");
  }
  const permissionScope = normalizedPermissionScope(
    assetMetadata.permissionScope,
    "document asset metadata",
  );

  const parseArtifacts = await executor.execute({
    maxRows: 2,
    operation: "select",
    params: [scope.documentAssetId, scope.documentVersion],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")}, ${quoteDatabaseIdentifier(
      database,
      "artifact_hash",
    )} FROM ${quoteDatabaseIdentifier(database, "parse_artifacts")} WHERE ${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "version",
    )} = ${databasePlaceholder(database, 2)} LIMIT 2;`,
    tableName: "parse_artifacts",
  });
  if (parseArtifacts.rows.length !== 1) {
    throw validationError("Document version must have exactly one parse artifact");
  }
  const parseArtifact = parseArtifacts.rows[0] as DatabaseRow;
  const artifactHash = stringColumn(parseArtifact, "artifact_hash");
  if (!ownerSnapshot.artifactHash || ownerSnapshot.artifactHash !== artifactHash) {
    throw validationError(
      "Projection fingerprint owner artifactHash mismatches the unique parse artifact",
    );
  }

  return {
    artifactHash,
    documentFilename: stringColumn(assetRow, "filename"),
    parseArtifactId: stringColumn(parseArtifact, "id"),
    permissionScope,
  };
}

async function requireProjectionRowsByIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  ids: readonly string[],
  maxBatchSize: number,
): Promise<DatabaseRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows: DatabaseRow[] = [];
  const dimensionFunction = database.dialect === "postgres" ? "vector_dims" : "VEC_DIMS";
  for (let offset = 0; offset < ids.length; offset += maxBatchSize) {
    const batch = ids.slice(offset, offset + maxBatchSize).map((id) => UuidSchema.parse(id));
    const result = await executor.execute({
      maxRows: batch.length,
      operation: "select",
      params: batch,
      sql: `SELECT *, ${dimensionFunction}(${quoteDatabaseIdentifier(
        database,
        "dense_vector",
      )}) AS ${quoteDatabaseIdentifier(
        database,
        "dense_vector_dimension",
      )}, ${dimensionFunction}(${quoteDatabaseIdentifier(
        database,
        "visual_vector",
      )}) AS ${quoteDatabaseIdentifier(
        database,
        "visual_vector_dimension",
      )} FROM ${quoteDatabaseIdentifier(database, "index_projections")} WHERE ${quoteDatabaseIdentifier(
        database,
        "id",
      )} IN (${batch.map((_, index) => databasePlaceholder(database, index + 1)).join(", ")});`,
      tableName: "index_projections",
    });
    rows.push(...result.rows);
  }

  return orderRequiredRows(rows, ids, "index_projections");
}

async function requireRowsByIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tableName: string,
  ids: readonly string[],
  maxBatchSize: number,
): Promise<DatabaseRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows: DatabaseRow[] = [];
  for (let offset = 0; offset < ids.length; offset += maxBatchSize) {
    const batch = ids.slice(offset, offset + maxBatchSize).map((id) => UuidSchema.parse(id));
    const result = await executor.execute({
      maxRows: batch.length,
      operation: "select",
      params: batch,
      sql: `SELECT * FROM ${quoteDatabaseIdentifier(
        database,
        tableName,
      )} WHERE ${quoteDatabaseIdentifier(database, "id")} IN (${batch
        .map((_, index) => databasePlaceholder(database, index + 1))
        .join(", ")});`,
      tableName,
    });
    rows.push(...result.rows);
  }

  return orderRequiredRows(rows, ids, tableName);
}

function orderRequiredRows(
  rows: readonly DatabaseRow[],
  ids: readonly string[],
  tableName: string,
): DatabaseRow[] {
  const byId = new Map(rows.map((row) => [stringColumn(row, "id"), row]));
  if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
    throw validationError(`Candidate references missing ${tableName} rows`);
  }

  return ids.map((id) => byId.get(id) as DatabaseRow);
}

function validateOwnedDerivedRow(
  row: DatabaseRow,
  scope: CandidateValidationScope,
  label: string,
): void {
  requireColumnEquals(row, "knowledge_space_id", scope.knowledgeSpaceId, label);
  requireColumnEquals(row, "publication_generation_id", scope.generationId, label);
}

function requireColumnEquals(
  row: DatabaseRow,
  column: string,
  expected: string,
  label: string,
): void {
  if (stringColumn(row, column) !== expected) {
    throw validationError(`${label} ${stringColumn(row, "id")} has mismatched ${column}`);
  }
}

function requireNumberEquals(
  row: DatabaseRow,
  column: string,
  expected: number,
  label: string,
): void {
  if (numberColumn(row, column) !== expected) {
    throw validationError(`${label} ${stringColumn(row, "id")} has mismatched ${column}`);
  }
}

function addSourceNodeIds(target: Set<string>, row: DatabaseRow, label: string): void {
  const sourceNodeIds = jsonStringArrayColumn(row, "source_node_ids");
  if (sourceNodeIds.length === 0) {
    throw validationError(`${label} ${stringColumn(row, "id")} has no source node closure`);
  }
  for (const nodeId of sourceNodeIds) {
    target.add(UuidSchema.parse(nodeId));
  }
}

function validateArtifactLineage(
  row: DatabaseRow,
  owner: CandidateOwnerSnapshot,
  label: string,
): void {
  requireColumnEquals(row, "parse_artifact_id", owner.parseArtifactId, label);
  requireColumnEquals(row, "artifact_hash", owner.artifactHash, label);
}

function validateProjectionLineage(
  row: DatabaseRow,
  scope: CandidateValidationScope,
  owner: CandidateOwnerSnapshot,
  embeddingProfile: KnowledgeSpaceEmbeddingProfile | undefined,
): void {
  const metadata = jsonObjectColumn(row, "metadata");
  requireMetadataEquals(metadata, "documentAssetId", scope.documentAssetId, "index projection");
  requireMetadataEquals(metadata, "parseArtifactId", owner.parseArtifactId, "index projection");
  requireMetadataEquals(metadata, "artifactHash", owner.artifactHash, "index projection");
  const multimodal = isPlainObject(metadata.multimodal) ? metadata.multimodal : undefined;
  if (stringColumn(row, "type") === "dense-vector" && multimodal?.vectorSpace !== "visual") {
    if (!embeddingProfile) {
      throw validationError("Dense candidate projection has no persisted embedding profile");
    }
    requireMetadataEquals(
      metadata,
      "vectorSpaceId",
      embeddingProfile.vectorSpaceId,
      "index projection",
    );
    requireMetadataEquals(metadata, "embeddingModel", embeddingProfile.model, "index projection");
    if (!isPlainObject(metadata.embeddingProfile)) {
      throw validationError("Index projection has no frozen embedding profile metadata");
    }
    requireMetadataEquals(
      metadata.embeddingProfile,
      "revision",
      embeddingProfile.revision,
      "index projection embedding profile",
    );
    requireMetadataEquals(
      metadata.embeddingProfile,
      "pluginId",
      embeddingProfile.pluginId,
      "index projection embedding profile",
    );
    requireMetadataEquals(
      metadata.embeddingProfile,
      "provider",
      embeddingProfile.provider,
      "index projection embedding profile",
    );
  }
}

function validateProjectionEmbedding(
  row: DatabaseRow,
  embeddingProfile: KnowledgeSpaceEmbeddingProfile | undefined,
  fingerprintMaterial: ProjectionSetFingerprintMaterial,
): void {
  const type = stringColumn(row, "type");
  const projectionVersion = numberColumn(row, "projection_version");
  const matchingConfigs = fingerprintMaterial.projections.filter(
    (config) => config.type === type && config.projectionVersion === projectionVersion,
  );
  if (matchingConfigs.length === 0) {
    throw validationError(
      `Index projection ${stringColumn(row, "id")} is absent from fingerprint projection config`,
    );
  }
  if (type !== "dense-vector") {
    return;
  }

  const metadata = jsonObjectColumn(row, "metadata");
  const multimodal = isPlainObject(metadata.multimodal) ? metadata.multimodal : undefined;
  const isVisual = multimodal?.vectorSpace === "visual";
  const model = optionalStringColumn(row, "model");
  const metadataDimension = metadata.dimension;
  const denseDimension = optionalNumberColumn(row, "dense_vector_dimension");
  const visualDimension = optionalNumberColumn(row, "visual_vector_dimension");
  if (!Number.isSafeInteger(metadataDimension) || (metadataDimension as number) < 1) {
    throw validationError("Dense candidate projection has no valid observed dimension");
  }

  if (isVisual) {
    if (
      !Number.isSafeInteger(visualDimension) ||
      (visualDimension as number) < 1 ||
      denseDimension !== undefined
    ) {
      throw validationError(
        "Independent visual candidate projection must populate only visual_vector",
      );
    }
    if (metadataDimension !== visualDimension) {
      throw validationError(
        `Visual candidate projection dimension=${String(
          metadataDimension,
        )} mismatches stored vector dimension=${String(visualDimension)}`,
      );
    }
    if (!model || !matchingConfigs.some((config) => config.model === model)) {
      throw validationError(
        "Independent visual candidate projection does not match fingerprint model config",
      );
    }
    return;
  }

  if (
    !Number.isSafeInteger(denseDimension) ||
    (denseDimension as number) < 1 ||
    visualDimension !== undefined
  ) {
    throw validationError("Text dense candidate projection must populate only dense_vector");
  }
  if (!embeddingProfile || embeddingProfile.dimension === undefined) {
    throw validationError("Dense candidate projection has no persisted embedding dimension");
  }
  if (model !== embeddingProfile.vectorSpaceId) {
    throw validationError(
      `Dense candidate projection model=${model ?? "missing"} mismatches vector space`,
    );
  }
  if (!matchingConfigs.some((config) => config.model === model)) {
    throw validationError(
      "Text dense candidate projection does not match fingerprint vector-space config",
    );
  }
  if (metadataDimension !== denseDimension || metadataDimension !== embeddingProfile.dimension) {
    throw validationError(
      `Dense candidate projection dimension=${String(
        metadataDimension,
      )} mismatches stored=${String(denseDimension)} or persisted=${embeddingProfile.dimension}`,
    );
  }
}

function requireMetadataEquals(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
  expected: unknown,
  label: string,
): void {
  if (metadata[key] !== expected) {
    throw validationError(`${label} has mismatched metadata.${key}`);
  }
}

function collectOutlineNodeIds(row: DatabaseRow | undefined): ReadonlySet<string> {
  if (!row) {
    return new Set();
  }
  const ids = new Set<string>();
  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) {
      throw validationError("Document outline nodes must be an array");
    }
    for (const node of nodes) {
      if (!isPlainObject(node) || typeof node.id !== "string" || !node.id.trim()) {
        throw validationError("Document outline contains an invalid node id");
      }
      if (ids.has(node.id)) {
        throw validationError(`Document outline contains duplicate node id=${node.id}`);
      }
      ids.add(node.id);
      visit(node.children ?? []);
    }
  };
  visit(jsonArrayValue(row.nodes, "document outline nodes"));
  return ids;
}

function collectMultimodalItemIds(row: DatabaseRow | undefined): ReadonlySet<string> {
  if (!row) {
    return new Set();
  }
  const items = jsonArrayValue(row.items, "multimodal manifest items");
  const ids = new Set<string>();
  for (const item of items) {
    if (!isPlainObject(item) || typeof item.id !== "string" || !item.id.trim()) {
      throw validationError("Multimodal manifest contains an invalid item id");
    }
    if (ids.has(item.id)) {
      throw validationError(`Multimodal manifest contains duplicate item id=${item.id}`);
    }
    ids.add(item.id);
  }
  return ids;
}

function validateKnowledgePath(
  row: DatabaseRow,
  scope: CandidateValidationScope,
  owner: CandidateOwnerSnapshot,
  closure: {
    readonly multimodalItemIds: ReadonlySet<string>;
    readonly outlineId: string;
    readonly outlineNodeIds: ReadonlySet<string>;
  },
): void {
  requireColumnEquals(row, "view_type", "physical", "knowledge path");
  requireColumnEquals(row, "view_name", "docs", "knowledge path");
  const expectedPrefix = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(
    owner.documentFilename,
    scope.documentAssetId,
  )}`;
  const virtualPath = stringColumn(row, "virtual_path");
  if (virtualPath !== expectedPrefix && !virtualPath.startsWith(`${expectedPrefix}/`)) {
    throw validationError(
      `Knowledge path ${stringColumn(row, "id")} escapes the owner document prefix`,
    );
  }
  const metadata = jsonObjectColumn(row, "metadata");
  if (metadata.tenantId !== scope.tenantId) {
    throw validationError(`Knowledge path ${stringColumn(row, "id")} has mismatched tenantId`);
  }
  if (
    ![
      undefined,
      "document-outline",
      "document-multimodal-manifest",
      "document-multimodal-asset",
      "document-multimodal-figure",
      "document-multimodal-table",
      "document-multimodal-page-thumbnail",
      "document-section",
    ].includes(metadata.contentKind as string | undefined)
  ) {
    throw validationError(
      `Knowledge path ${stringColumn(row, "id")} has an unsupported contentKind`,
    );
  }
  if (metadata.contentKind === "document-section") {
    if (
      metadata.outlineId !== closure.outlineId ||
      typeof metadata.outlineNodeId !== "string" ||
      !closure.outlineNodeIds.has(metadata.outlineNodeId)
    ) {
      throw validationError(
        `Knowledge path ${stringColumn(row, "id")} escapes the document outline closure`,
      );
    }
  }
  if (
    metadata.contentKind === "document-multimodal-asset" ||
    metadata.contentKind === "document-multimodal-figure" ||
    metadata.contentKind === "document-multimodal-table" ||
    metadata.contentKind === "document-multimodal-page-thumbnail"
  ) {
    if (typeof metadata.itemId !== "string" || !closure.multimodalItemIds.has(metadata.itemId)) {
      throw validationError(
        `Knowledge path ${stringColumn(row, "id")} escapes the multimodal item closure`,
      );
    }
  }
}

function requireMandatoryDocumentPaths(
  rows: readonly DatabaseRow[],
  scope: CandidateValidationScope,
  owner: CandidateOwnerSnapshot,
): void {
  const prefix = `${KNOWLEDGE_FS_DOCS_ROOT}/${documentFilenamePathSegment(
    owner.documentFilename,
    scope.documentAssetId,
  )}`;
  const paths = new Map(rows.map((row) => [stringColumn(row, "virtual_path"), row] as const));
  for (const [requiredPath, contentKind] of [
    [prefix, undefined],
    [`${prefix}/outline.json`, "document-outline"],
    [`${prefix}/multimodal.json`, "document-multimodal-manifest"],
  ] as const) {
    const row = paths.get(requiredPath);
    if (!row) {
      throw validationError(
        `Candidate receipt is missing mandatory knowledge path=${requiredPath}`,
      );
    }
    if (jsonObjectColumn(row, "metadata").contentKind !== contentKind) {
      throw validationError(`Mandatory knowledge path=${requiredPath} has mismatched contentKind`);
    }
  }
}

function validateGraphPermissionScope(
  row: DatabaseRow,
  nodePermissionScopes: ReadonlyMap<string, readonly string[]>,
  label: string,
): void {
  const sourceNodeIds = jsonStringArrayColumn(row, "source_node_ids");
  const sourceScopes = sourceNodeIds.flatMap((nodeId) => {
    const permissionScope = nodePermissionScopes.get(nodeId);
    if (!permissionScope) {
      throw validationError(`${label} ${stringColumn(row, "id")} has a missing source node`);
    }
    return permissionScope;
  });
  const expected = [...new Set(sourceScopes)].sort();
  const actual = normalizedPermissionScope(row.permission_scope, label);
  if (!sameStrings(actual, expected)) {
    throw validationError(
      `${label} ${stringColumn(row, "id")} permission scope mismatches its source-node union`,
    );
  }
}

function normalizedPermissionScope(value: unknown, label: string): readonly string[] {
  const parsed = jsonArrayValue(value, `${label} permission scope`);
  if (
    !parsed.every(
      (item) => typeof item === "string" && item.trim().length > 0 && item === item.trim(),
    )
  ) {
    throw validationError(`${label} permission scope must be an array of non-empty strings`);
  }
  return [...new Set(parsed as string[])].sort();
}

function jsonArrayValue(value: unknown, label: string): unknown[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw validationError(`${label} must be valid JSON`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw validationError(`${label} must be an array`);
  }
  return parsed;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw validationError(`${field} must be a positive integer`);
  }
  return value;
}

function validationError(message: string): DocumentCompilationCandidateValidationError {
  return new DocumentCompilationCandidateValidationError(message);
}
