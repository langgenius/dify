import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonArrayColumn, jsonObjectColumn } from "./json-utils";

export interface ParseArtifactLookupInput {
  readonly documentAssetId: string;
  readonly version: number;
}

export interface ParseArtifactIdLookupInput {
  readonly id: string;
}

export interface ParseArtifactRepository {
  checkpoint(
    input: MaterializeParseArtifactCheckpointInput,
  ): Promise<MaterializeParseArtifactResult>;
  create(input: ParseArtifact): Promise<ParseArtifact>;
  deleteByDocumentAsset(input: DeleteParseArtifactsByDocumentAssetInput): Promise<number>;
  deleteCheckpoint(input: DeleteParseArtifactCheckpointInput): Promise<number>;
  getCheckpoint(input: ParseArtifactLookupInput): Promise<ParseArtifactCheckpoint | null>;
  getById(input: ParseArtifactIdLookupInput): Promise<ParseArtifact | null>;
  getByDocumentVersion(input: ParseArtifactLookupInput): Promise<ParseArtifact | null>;
  materialize(input: ParseArtifact): Promise<MaterializeParseArtifactResult>;
  pruneDocumentVersions(input: PruneParseArtifactVersionsInput): Promise<number>;
}

export interface ParseArtifactCheckpoint {
  readonly artifact: ParseArtifact;
  readonly policyFingerprint: string;
}

export interface MaterializeParseArtifactCheckpointInput {
  readonly artifact: ParseArtifact;
  readonly policyFingerprint: string;
}

export interface DeleteParseArtifactCheckpointInput extends ParseArtifactLookupInput {
  readonly expectedPolicyFingerprint: string;
}

export type ParseArtifactMaterializationDisposition = "created" | "replaced" | "unchanged";

export interface MaterializeParseArtifactResult {
  readonly artifact: ParseArtifact;
  readonly disposition: ParseArtifactMaterializationDisposition;
}

export interface DeleteParseArtifactsByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly maxArtifacts: number;
}

export interface PruneParseArtifactVersionsInput {
  readonly documentAssetId: string;
  readonly keepVersions: number;
  readonly maxArtifacts: number;
}

export interface InMemoryParseArtifactRepositoryOptions {
  readonly maxArtifacts: number;
}

export interface DatabaseParseArtifactRepositoryOptions {
  readonly database: DatabaseAdapter;
}

export class ParseArtifactCapacityExceededError extends Error {
  constructor(maxArtifacts: number) {
    super(`Parse artifact repository maxArtifacts=${maxArtifacts} exceeded`);
  }
}

function parseArtifactKey(documentAssetId: string, version: number): string {
  return `${documentAssetId}:${version}`;
}

function assertParseArtifactCheckpointPolicyFingerprint(policyFingerprint: string): void {
  if (!/^[0-9a-f]{64}$/u.test(policyFingerprint)) {
    throw new Error("Parse artifact checkpoint policy fingerprint must be SHA-256");
  }
}

function parseArtifactCheckpointJsonPlaceholder(
  database: DatabaseAdapter,
  position: number,
): string {
  const placeholder = databasePlaceholder(database, position);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}

function validateParseArtifactPruneInput({
  documentAssetId,
  keepVersions,
  maxArtifacts,
}: PruneParseArtifactVersionsInput): void {
  if (!documentAssetId.trim()) {
    throw new Error("Parse artifact prune documentAssetId is required");
  }

  if (!Number.isInteger(keepVersions) || keepVersions < 1) {
    throw new Error("Parse artifact prune keepVersions must be at least 1");
  }

  if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1) {
    throw new Error("Parse artifact prune maxArtifacts must be at least 1");
  }
}

function mapParseArtifactRow(row: DatabaseRow): ParseArtifact {
  return ParseArtifactSchema.parse({
    artifactHash: stringColumn(row, "artifact_hash"),
    contentType: stringColumn(row, "content_type"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    elements: jsonArrayColumn(row, "elements"),
    id: stringColumn(row, "id"),
    metadata: jsonObjectColumn(row, "metadata"),
    parser: stringColumn(row, "parser"),
    version: numberColumn(row, "version"),
  });
}

function mapParseArtifactCheckpointRow(row: DatabaseRow): ParseArtifactCheckpoint {
  const policyFingerprint = stringColumn(row, "policy_fingerprint");
  assertParseArtifactCheckpointPolicyFingerprint(policyFingerprint);
  return {
    artifact: ParseArtifactSchema.parse(jsonObjectColumn(row, "artifact")),
    policyFingerprint,
  };
}

async function getDatabaseParseArtifactCheckpoint(
  database: DatabaseAdapter,
  { documentAssetId, version }: ParseArtifactLookupInput,
): Promise<ParseArtifactCheckpoint | null> {
  const tableName = "parse_artifact_checkpoints";
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [documentAssetId, version],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "version",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
    tableName,
  });

  return result.rows[0] ? mapParseArtifactCheckpointRow(result.rows[0]) : null;
}

async function materializeDatabaseParseArtifactCheckpoint(
  database: DatabaseAdapter,
  input: MaterializeParseArtifactCheckpointInput,
): Promise<MaterializeParseArtifactResult> {
  const tableName = "parse_artifact_checkpoints";
  const artifact = ParseArtifactSchema.parse(input.artifact);
  assertParseArtifactCheckpointPolicyFingerprint(input.policyFingerprint);

  return database.transaction(async (executor) => {
    await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [artifact.documentAssetId],
      sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
        database,
        "document_assets",
      )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
        database,
        1,
      )} LIMIT 1 FOR UPDATE;`,
      tableName: "document_assets",
    });
    const locked = await executor.execute({
      maxRows: 2,
      operation: "select",
      params: [artifact.documentAssetId, artifact.version],
      sql: `SELECT * FROM ${quoteDatabaseIdentifier(
        database,
        tableName,
      )} WHERE ${quoteDatabaseIdentifier(
        database,
        "document_asset_id",
      )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
        database,
        "version",
      )} = ${databasePlaceholder(database, 2)} LIMIT 2 FOR UPDATE;`,
      tableName,
    });
    const [row, duplicate] = locked.rows;
    if (duplicate) {
      throw new Error("Parse artifact checkpoint resolved multiple persisted logical rows");
    }
    if (row) {
      const persisted = mapParseArtifactCheckpointRow(row);
      if (
        persisted.artifact.documentAssetId !== artifact.documentAssetId ||
        persisted.artifact.version !== artifact.version
      ) {
        throw new Error("Parse artifact checkpoint resolved a mismatched persisted row");
      }
      if (
        persisted.policyFingerprint === input.policyFingerprint &&
        persisted.artifact.artifactHash === artifact.artifactHash
      ) {
        return { artifact: cloneParseArtifact(persisted.artifact), disposition: "unchanged" };
      }
      const updated = await executor.execute({
        maxRows: 1,
        operation: "update",
        params: [
          input.policyFingerprint,
          JSON.stringify(artifact),
          artifact.createdAt,
          artifact.documentAssetId,
          artifact.version,
        ],
        sql: `UPDATE ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} SET ${quoteDatabaseIdentifier(database, "policy_fingerprint")} = ${databasePlaceholder(
          database,
          1,
        )}, ${quoteDatabaseIdentifier(
          database,
          "artifact",
        )} = ${parseArtifactCheckpointJsonPlaceholder(
          database,
          2,
        )}, ${quoteDatabaseIdentifier(database, "updated_at")} = ${databasePlaceholder(
          database,
          3,
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 5)};`,
        tableName,
      });
      if (updated.rowsAffected !== 1) {
        throw new Error("Parse artifact checkpoint could not replace its logical row");
      }
      return { artifact: cloneParseArtifact(artifact), disposition: "replaced" };
    }

    const params = [
      artifact.documentAssetId,
      artifact.version,
      input.policyFingerprint,
      JSON.stringify(artifact),
      artifact.createdAt,
      artifact.createdAt,
    ] satisfies readonly DatabaseQueryValue[];
    const inserted = await executor.execute({
      maxRows: 1,
      operation: "insert",
      params,
      sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${[
        "document_asset_id",
        "version",
        "policy_fingerprint",
        "artifact",
        "created_at",
        "updated_at",
      ]
        .map((column) => quoteDatabaseIdentifier(database, column))
        .join(", ")}) VALUES (${params
        .map((_, index) =>
          index === 3
            ? parseArtifactCheckpointJsonPlaceholder(database, index + 1)
            : databasePlaceholder(database, index + 1),
        )
        .join(", ")});`,
      tableName,
    });
    if (inserted.rowsAffected !== 1) {
      throw new Error("Parse artifact checkpoint did not create its logical row");
    }
    return { artifact: cloneParseArtifact(artifact), disposition: "created" };
  });
}

export function cloneParseArtifact(artifact: ParseArtifact): ParseArtifact {
  return ParseArtifactSchema.parse(JSON.parse(JSON.stringify(artifact)) as unknown);
}

function bindGeneratedElementIdsToArtifact(
  artifact: ParseArtifact,
  canonicalArtifactId: string,
): ParseArtifact {
  const generatedElementIds = artifact.elements.every((element, index) => {
    const match = element.id.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:element-(\d+)$/iu,
    );

    return match?.[1] === String(index + 1);
  });

  return cloneParseArtifact({
    ...artifact,
    elements: generatedElementIds
      ? artifact.elements.map((element, index) => ({
          ...element,
          id: `${canonicalArtifactId}:element-${index + 1}`,
        }))
      : artifact.elements,
    id: canonicalArtifactId,
  });
}

export function createInMemoryParseArtifactRepository({
  maxArtifacts,
}: InMemoryParseArtifactRepositoryOptions): ParseArtifactRepository {
  if (maxArtifacts < 1) {
    throw new Error("Parse artifact repository maxArtifacts must be at least 1");
  }

  const artifacts = new Map<string, ParseArtifact>();
  const checkpoints = new Map<string, ParseArtifactCheckpoint>();

  const materialize = async (input: ParseArtifact): Promise<MaterializeParseArtifactResult> => {
    const artifact = cloneParseArtifact(ParseArtifactSchema.parse(input));
    const key = parseArtifactKey(artifact.documentAssetId, artifact.version);
    const existing = artifacts.get(key);

    if (existing?.artifactHash === artifact.artifactHash) {
      return { artifact: cloneParseArtifact(existing), disposition: "unchanged" };
    }

    if (existing) {
      const stored = bindGeneratedElementIdsToArtifact(
        { ...artifact, createdAt: existing.createdAt },
        existing.id,
      );
      artifacts.set(key, stored);

      return { artifact: cloneParseArtifact(stored), disposition: "replaced" };
    }

    if (artifacts.size >= maxArtifacts) {
      throw new ParseArtifactCapacityExceededError(maxArtifacts);
    }

    const stored = bindGeneratedElementIdsToArtifact(artifact, artifact.id);
    artifacts.set(key, stored);

    return {
      artifact: cloneParseArtifact(stored),
      disposition: "created",
    };
  };

  return {
    checkpoint: async ({ artifact: input, policyFingerprint }) => {
      const artifact = cloneParseArtifact(ParseArtifactSchema.parse(input));
      assertParseArtifactCheckpointPolicyFingerprint(policyFingerprint);
      const key = parseArtifactKey(artifact.documentAssetId, artifact.version);
      const existing = checkpoints.get(key);
      if (
        existing?.policyFingerprint === policyFingerprint &&
        existing.artifact.artifactHash === artifact.artifactHash
      ) {
        return { artifact: cloneParseArtifact(existing.artifact), disposition: "unchanged" };
      }
      if (!existing && checkpoints.size >= maxArtifacts) {
        throw new ParseArtifactCapacityExceededError(maxArtifacts);
      }
      checkpoints.set(key, { artifact, policyFingerprint });
      return {
        artifact: cloneParseArtifact(artifact),
        disposition: existing ? "replaced" : "created",
      };
    },
    create: async (input) => (await materialize(input)).artifact,
    deleteCheckpoint: async ({ documentAssetId, expectedPolicyFingerprint, version }) => {
      const key = parseArtifactKey(documentAssetId, version);
      if (checkpoints.get(key)?.policyFingerprint !== expectedPolicyFingerprint) return 0;
      return checkpoints.delete(key) ? 1 : 0;
    },
    getCheckpoint: async ({ documentAssetId, version }) => {
      const checkpoint = checkpoints.get(parseArtifactKey(documentAssetId, version));

      return checkpoint
        ? {
            artifact: cloneParseArtifact(checkpoint.artifact),
            policyFingerprint: checkpoint.policyFingerprint,
          }
        : null;
    },
    getByDocumentVersion: async ({ documentAssetId, version }) => {
      const artifact = artifacts.get(parseArtifactKey(documentAssetId, version));

      return artifact ? cloneParseArtifact(artifact) : null;
    },
    getById: async ({ id }) => {
      const artifact = Array.from(artifacts.values()).find((candidate) => candidate.id === id);

      return artifact ? cloneParseArtifact(artifact) : null;
    },
    materialize,
    deleteByDocumentAsset: async ({ documentAssetId, maxArtifacts }) => {
      if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1) {
        throw new Error("Parse artifact delete maxArtifacts must be at least 1");
      }

      const keys = Array.from(artifacts.values())
        .filter((artifact) => artifact.documentAssetId === documentAssetId)
        .slice(0, maxArtifacts + 1)
        .map((artifact) => parseArtifactKey(artifact.documentAssetId, artifact.version));

      if (keys.length > maxArtifacts) {
        throw new Error(`Parse artifact delete maxArtifacts=${maxArtifacts} exceeded`);
      }

      for (const key of keys) {
        artifacts.delete(key);
      }
      for (const [key, checkpoint] of checkpoints) {
        if (checkpoint.artifact.documentAssetId === documentAssetId) checkpoints.delete(key);
      }

      return keys.length;
    },
    pruneDocumentVersions: async ({ documentAssetId, keepVersions, maxArtifacts }) => {
      validateParseArtifactPruneInput({ documentAssetId, keepVersions, maxArtifacts });
      const canonicalVersions = Array.from(artifacts.values())
        .filter((artifact) => artifact.documentAssetId === documentAssetId)
        .map((artifact) => artifact.version)
        .sort((left, right) => right - left);
      const canonicalVersionsToDelete = canonicalVersions.slice(
        keepVersions,
        keepVersions + maxArtifacts + 1,
      );
      if (canonicalVersionsToDelete.length > maxArtifacts) {
        throw new Error(`Parse artifact prune maxArtifacts=${maxArtifacts} exceeded`);
      }

      const retainedCanonicalVersions = canonicalVersions.slice(0, keepVersions);
      const checkpointVersions = Array.from(checkpoints.values())
        .filter((checkpoint) => checkpoint.artifact.documentAssetId === documentAssetId)
        .map((checkpoint) => checkpoint.artifact.version);
      const retainedParseArtifactVersions = new Set(
        [...new Set([...retainedCanonicalVersions, ...checkpointVersions])]
          .sort((left, right) => right - left)
          .slice(0, keepVersions),
      );
      const checkpointVersionsToDelete = checkpointVersions.filter(
        (version) => !retainedParseArtifactVersions.has(version),
      );
      if (checkpointVersionsToDelete.length > maxArtifacts) {
        throw new Error(`Parse artifact prune maxArtifacts=${maxArtifacts} exceeded`);
      }

      let deletedArtifacts = 0;
      for (const version of canonicalVersionsToDelete) {
        if (artifacts.delete(parseArtifactKey(documentAssetId, version))) deletedArtifacts += 1;
      }
      for (const version of checkpointVersionsToDelete) {
        checkpoints.delete(parseArtifactKey(documentAssetId, version));
      }

      return deletedArtifacts;
    },
  };
}

export function createDatabaseParseArtifactRepository({
  database,
}: DatabaseParseArtifactRepositoryOptions): ParseArtifactRepository {
  const tableName = "parse_artifacts";
  const repairGeneratedElementIds = async (
    executor: DatabaseExecutor,
    persisted: ParseArtifact,
  ): Promise<ParseArtifact> => {
    const canonical = bindGeneratedElementIdsToArtifact(persisted, persisted.id);
    if (JSON.stringify(canonical.elements) === JSON.stringify(persisted.elements)) {
      return canonical;
    }

    const repaired = await executor.execute({
      maxRows: 1,
      operation: "update",
      params: [
        JSON.stringify(canonical.elements),
        canonical.id,
        canonical.documentAssetId,
        canonical.version,
      ],
      sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
        database,
        "elements",
      )} = ${jsonInsertPlaceholder(
        database,
        1,
        "elements",
      )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
        database,
        2,
      )} AND ${quoteDatabaseIdentifier(
        database,
        "document_asset_id",
      )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
        database,
        "version",
      )} = ${databasePlaceholder(database, 4)};`,
      tableName,
    });
    if (repaired.rowsAffected !== 1) {
      throw new Error("Parse artifact generated element ids could not be canonicalized");
    }

    return canonical;
  };

  const materialize = async (input: ParseArtifact): Promise<MaterializeParseArtifactResult> => {
    const artifact = ParseArtifactSchema.parse(input);

    return database.transaction(async (executor) => {
      await executor.execute({
        maxRows: 1,
        operation: "select",
        params: [artifact.documentAssetId],
        sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
          database,
          "document_assets",
        )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
          database,
          1,
        )} LIMIT 1 FOR UPDATE;`,
        tableName: "document_assets",
      });
      const locked = await executor.execute({
        maxRows: 2,
        operation: "select",
        params: [artifact.documentAssetId, artifact.version],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 2)} LIMIT 2 FOR UPDATE;`,
        tableName,
      });
      const [row, duplicate] = locked.rows;

      if (duplicate) {
        throw new Error("Parse artifact materialization resolved multiple persisted logical rows");
      }

      if (row) {
        const persisted = mapParseArtifactRow(row);

        if (
          persisted.documentAssetId !== artifact.documentAssetId ||
          persisted.version !== artifact.version
        ) {
          throw new Error("Parse artifact materialization resolved a mismatched persisted row");
        }

        if (persisted.artifactHash === artifact.artifactHash) {
          return {
            artifact: await repairGeneratedElementIds(executor, persisted),
            disposition: "unchanged" as const,
          };
        }

        const replaced = bindGeneratedElementIdsToArtifact(
          { ...artifact, createdAt: persisted.createdAt },
          persisted.id,
        );
        const updated = await executor.execute({
          maxRows: 1,
          operation: "update",
          params: [
            replaced.parser,
            replaced.contentType,
            replaced.artifactHash,
            JSON.stringify(replaced.elements),
            JSON.stringify(replaced.metadata),
            replaced.id,
            replaced.documentAssetId,
            replaced.version,
          ],
          sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
            database,
            "parser",
          )} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(
            database,
            "content_type",
          )} = ${databasePlaceholder(database, 2)}, ${quoteDatabaseIdentifier(
            database,
            "artifact_hash",
          )} = ${databasePlaceholder(database, 3)}, ${quoteDatabaseIdentifier(
            database,
            "elements",
          )} = ${jsonInsertPlaceholder(
            database,
            4,
            "elements",
          )}, ${quoteDatabaseIdentifier(database, "metadata")} = ${jsonInsertPlaceholder(
            database,
            5,
            "metadata",
          )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
            database,
            6,
          )} AND ${quoteDatabaseIdentifier(
            database,
            "document_asset_id",
          )} = ${databasePlaceholder(database, 7)} AND ${quoteDatabaseIdentifier(
            database,
            "version",
          )} = ${databasePlaceholder(database, 8)};`,
          tableName,
        });
        if (updated.rowsAffected !== 1) {
          throw new Error("Parse artifact materialization could not replace its logical row");
        }

        return { artifact: replaced, disposition: "replaced" as const };
      }

      const created = bindGeneratedElementIdsToArtifact(artifact, artifact.id);
      const columns = [
        "id",
        "document_asset_id",
        "version",
        "parser",
        "content_type",
        "artifact_hash",
        "elements",
        "metadata",
        "created_at",
      ];
      const params = [
        created.id,
        created.documentAssetId,
        created.version,
        created.parser,
        created.contentType,
        created.artifactHash,
        JSON.stringify(created.elements),
        JSON.stringify(created.metadata),
        created.createdAt,
      ] satisfies readonly DatabaseQueryValue[];
      const inserted = await executor.execute({
        maxRows: 1,
        operation: "insert",
        params,
        sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) VALUES (${params
          .map((_, index) => jsonInsertPlaceholder(database, index + 1, columns[index]))
          .join(", ")});`,
        tableName,
      });

      if (inserted.rowsAffected !== 1) {
        throw new Error("Parse artifact materialization did not create its logical row");
      }

      return { artifact: created, disposition: "created" as const };
    });
  };

  return {
    checkpoint: (input) => materializeDatabaseParseArtifactCheckpoint(database, input),
    create: async (input) => (await materialize(input)).artifact,
    deleteCheckpoint: async ({ documentAssetId, expectedPolicyFingerprint, version }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "delete",
        params: [documentAssetId, version, expectedPolicyFingerprint],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(
          database,
          "parse_artifact_checkpoints",
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "policy_fingerprint",
        )} = ${databasePlaceholder(database, 3)};`,
        tableName: "parse_artifact_checkpoints",
      });

      return result.rowsAffected;
    },
    getCheckpoint: async ({ documentAssetId, version }) => {
      return getDatabaseParseArtifactCheckpoint(database, { documentAssetId, version });
    },
    getByDocumentVersion: async ({ documentAssetId, version }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [documentAssetId, version],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
        tableName,
      });

      return result.rows[0] ? mapParseArtifactRow(result.rows[0]) : null;
    },
    getById: async ({ id }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [id],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 1)} LIMIT 1;`,
        tableName,
      });

      return result.rows[0] ? mapParseArtifactRow(result.rows[0]) : null;
    },
    materialize,
    deleteByDocumentAsset: async ({ documentAssetId, maxArtifacts }) => {
      if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1) {
        throw new Error("Parse artifact delete maxArtifacts must be at least 1");
      }

      const result = await database.execute({
        maxRows: maxArtifacts,
        operation: "delete",
        params: [documentAssetId],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)};`,
        tableName,
      });
      // Preserve the established canonical-delete result. The document asset owns an ON DELETE
      // CASCADE for raw checkpoints, so the enclosing asset deletion remains authoritative even if
      // this eager space-reclamation step is temporarily unavailable.
      await database
        .execute({
          maxRows: maxArtifacts,
          operation: "delete",
          params: [documentAssetId],
          sql: `DELETE FROM ${quoteDatabaseIdentifier(
            database,
            "parse_artifact_checkpoints",
          )} WHERE ${quoteDatabaseIdentifier(
            database,
            "document_asset_id",
          )} = ${databasePlaceholder(database, 1)};`,
          tableName: "parse_artifact_checkpoints",
        })
        .catch(() => undefined);

      return result.rowsAffected;
    },
    pruneDocumentVersions: async ({ documentAssetId, keepVersions, maxArtifacts }) => {
      validateParseArtifactPruneInput({ documentAssetId, keepVersions, maxArtifacts });
      const result = await database.execute({
        maxRows: maxArtifacts,
        operation: "delete",
        params: [documentAssetId, keepVersions],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} NOT IN (SELECT ${quoteDatabaseIdentifier(database, "version")} FROM (SELECT ${quoteDatabaseIdentifier(
          database,
          "version",
        )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "version",
        )} DESC LIMIT ${databasePlaceholder(database, 2)}) AS retained_parse_artifact_versions);`,
        tableName,
      });
      await database.execute({
        maxRows: maxArtifacts,
        operation: "delete",
        params: [documentAssetId, keepVersions],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(
          database,
          "parse_artifact_checkpoints",
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} NOT IN (SELECT ${quoteDatabaseIdentifier(
          database,
          "version",
        )} FROM (SELECT ${quoteDatabaseIdentifier(
          database,
          "version",
        )} FROM (SELECT ${quoteDatabaseIdentifier(
          database,
          "version",
        )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} UNION SELECT ${quoteDatabaseIdentifier(
          database,
          "version",
        )} FROM ${quoteDatabaseIdentifier(
          database,
          "parse_artifact_checkpoints",
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)}) AS all_parse_artifact_versions ORDER BY ${quoteDatabaseIdentifier(
          database,
          "version",
        )} DESC LIMIT ${databasePlaceholder(
          database,
          2,
        )}) AS retained_parse_artifact_checkpoint_versions);`,
        tableName: "parse_artifact_checkpoints",
      });

      return result.rowsAffected;
    },
  };
}
