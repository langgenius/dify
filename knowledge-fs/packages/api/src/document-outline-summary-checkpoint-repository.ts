import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  UuidSchema,
} from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";

export interface DocumentOutlineSummaryCheckpointScope {
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId: string;
  readonly tenantId: string;
}

export interface DocumentOutlineSummaryCheckpointKey {
  readonly inputFingerprint: string;
  readonly outlineNodeId: string;
}

export interface DocumentOutlineSummaryCheckpoint extends DocumentOutlineSummaryCheckpointKey {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly summary: string;
}

export interface DocumentOutlineSummaryCheckpointRepository {
  getMany(input: {
    readonly keys: readonly DocumentOutlineSummaryCheckpointKey[];
    readonly scope: DocumentOutlineSummaryCheckpointScope;
  }): Promise<readonly DocumentOutlineSummaryCheckpoint[]>;
  putMany(input: {
    readonly checkpoints: readonly DocumentOutlineSummaryCheckpoint[];
    readonly scope: DocumentOutlineSummaryCheckpointScope;
  }): Promise<readonly DocumentOutlineSummaryCheckpoint[]>;
}

export interface DatabaseDocumentOutlineSummaryCheckpointRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize: number;
  readonly now?: (() => string) | undefined;
}

export function createInMemoryDocumentOutlineSummaryCheckpointRepository(): DocumentOutlineSummaryCheckpointRepository {
  const records = new Map<string, DocumentOutlineSummaryCheckpoint>();
  return {
    getMany: async ({ keys, scope }) =>
      keys.flatMap((key) => {
        const record = records.get(checkpointStorageKey(scope, key));
        return record ? [cloneCheckpoint(record)] : [];
      }),
    putMany: async ({ checkpoints, scope }) =>
      checkpoints.map((checkpoint) => {
        const normalized = normalizeCheckpoint(checkpoint);
        const key = checkpointStorageKey(normalizeScope(scope), normalized);
        const existing = records.get(key);
        if (!existing) records.set(key, cloneCheckpoint(normalized));
        return cloneCheckpoint(existing ?? normalized);
      }),
  };
}

export function createDatabaseDocumentOutlineSummaryCheckpointRepository({
  database,
  maxBatchSize,
  now = () => new Date().toISOString(),
}: DatabaseDocumentOutlineSummaryCheckpointRepositoryOptions): DocumentOutlineSummaryCheckpointRepository {
  positiveInteger(maxBatchSize, "maxBatchSize");
  return {
    getMany: async ({ keys, scope }) => {
      assertBatch(keys.length, maxBatchSize);
      if (keys.length === 0) return [];
      return selectCheckpoints(database, database, normalizeScope(scope), normalizeKeys(keys));
    },
    putMany: async ({ checkpoints, scope }) => {
      assertBatch(checkpoints.length, maxBatchSize);
      if (checkpoints.length === 0) return [];
      const normalizedScope = normalizeScope(scope);
      const normalized = checkpoints.map(normalizeCheckpoint);
      return database.transaction(async (transaction) => {
        await insertCheckpoints(database, transaction, normalizedScope, normalized, now());
        const persisted = await selectCheckpoints(
          database,
          transaction,
          normalizedScope,
          normalized,
        );
        const byKey = new Map(
          persisted.map((checkpoint) => [checkpointKey(checkpoint), checkpoint] as const),
        );
        return normalized.map((checkpoint) => {
          const stored = byKey.get(checkpointKey(checkpoint));
          if (!stored) {
            throw new Error(
              `Document outline summary checkpoint was not persisted for node ${checkpoint.outlineNodeId}`,
            );
          }
          return stored;
        });
      });
    },
  };
}

const table = "document_outline_summary_checkpoints";

async function selectCheckpoints(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: DocumentOutlineSummaryCheckpointScope,
  keys: readonly DocumentOutlineSummaryCheckpointKey[],
): Promise<DocumentOutlineSummaryCheckpoint[]> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const p = (index: number) => databasePlaceholder(database, index);
  const params: DatabaseQueryValue[] = [
    scope.tenantId,
    scope.knowledgeSpaceId,
    scope.publicationGenerationId,
  ];
  const predicates = keys.map((key) => {
    params.push(key.outlineNodeId, key.inputFingerprint);
    return `(${q("outline_node_id")} = ${p(params.length - 1)} AND ${q("input_fingerprint")} = ${p(params.length)})`;
  });
  const result = await executor.execute({
    maxRows: keys.length,
    operation: "select",
    params,
    sql: `SELECT ${q("outline_node_id")}, ${q("input_fingerprint")}, ${q("summary")}, ${q("metadata")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("publication_generation_id")} = ${p(3)} AND (${predicates.join(" OR ")});`,
    tableName: table,
  });
  return result.rows.map((row) =>
    normalizeCheckpoint({
      inputFingerprint: stringColumn(row, "input_fingerprint"),
      metadata: jsonObjectColumn(row, "metadata"),
      outlineNodeId: stringColumn(row, "outline_node_id"),
      summary: stringColumn(row, "summary"),
    }),
  );
}

async function insertCheckpoints(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: DocumentOutlineSummaryCheckpointScope,
  checkpoints: readonly DocumentOutlineSummaryCheckpoint[],
  createdAt: string,
): Promise<void> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const params: DatabaseQueryValue[] = [];
  const values = checkpoints.map((checkpoint) => {
    const row: readonly DatabaseQueryValue[] = [
      scope.tenantId,
      scope.knowledgeSpaceId,
      scope.documentAssetId,
      scope.documentVersion,
      scope.publicationGenerationId,
      checkpoint.outlineNodeId,
      checkpoint.inputFingerprint,
      checkpoint.summary,
      JSON.stringify(checkpoint.metadata),
      createdAt,
    ];
    const offset = params.length;
    params.push(...row);
    return `(${row
      .map((_, index) =>
        index === 8
          ? jsonInsertPlaceholder(database, offset + index + 1, "metadata")
          : databasePlaceholder(database, offset + index + 1),
      )
      .join(", ")})`;
  });
  const columns = [
    "tenant_id",
    "knowledge_space_id",
    "document_asset_id",
    "document_version",
    "publication_generation_id",
    "outline_node_id",
    "input_fingerprint",
    "summary",
    "metadata",
    "created_at",
  ];
  const insertKeyword = database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT";
  const conflict =
    database.dialect === "postgres"
      ? ` ON CONFLICT (${[
          "tenant_id",
          "knowledge_space_id",
          "publication_generation_id",
          "outline_node_id",
          "input_fingerprint",
        ]
          .map(q)
          .join(", ")}) DO NOTHING`
      : "";
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${insertKeyword} INTO ${q(table)} (${columns.map(q).join(", ")}) VALUES ${values.join(", ")}${conflict};`,
    tableName: table,
  });
}

function normalizeScope(
  scope: DocumentOutlineSummaryCheckpointScope,
): DocumentOutlineSummaryCheckpointScope {
  return {
    documentAssetId: UuidSchema.parse(scope.documentAssetId),
    documentVersion: positiveInteger(scope.documentVersion, "documentVersion"),
    knowledgeSpaceId: UuidSchema.parse(scope.knowledgeSpaceId),
    publicationGenerationId: UuidSchema.parse(scope.publicationGenerationId),
    tenantId: requiredString(scope.tenantId, "tenantId", 255),
  };
}

function normalizeKeys(
  keys: readonly DocumentOutlineSummaryCheckpointKey[],
): DocumentOutlineSummaryCheckpointKey[] {
  const normalized = keys.map((key) => ({
    inputFingerprint: fingerprint(key.inputFingerprint),
    outlineNodeId: requiredString(key.outlineNodeId, "outlineNodeId", 255),
  }));
  if (new Set(normalized.map(checkpointKey)).size !== normalized.length) {
    throw new Error("Document outline summary checkpoint keys must be unique");
  }
  return normalized;
}

function normalizeCheckpoint(
  checkpoint: DocumentOutlineSummaryCheckpoint,
): DocumentOutlineSummaryCheckpoint {
  const [key] = normalizeKeys([checkpoint]);
  if (!key) throw new Error("Document outline summary checkpoint key is required");
  return {
    ...key,
    metadata: structuredClone(checkpoint.metadata),
    summary: requiredString(checkpoint.summary, "summary", 100_000),
  };
}

function checkpointStorageKey(
  scope: DocumentOutlineSummaryCheckpointScope,
  key: DocumentOutlineSummaryCheckpointKey,
): string {
  return `${scope.tenantId}\u001f${scope.knowledgeSpaceId}\u001f${scope.publicationGenerationId}\u001f${checkpointKey(key)}`;
}

function checkpointKey(key: DocumentOutlineSummaryCheckpointKey): string {
  return `${key.outlineNodeId}\u001f${key.inputFingerprint}`;
}

function fingerprint(value: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Document outline summary checkpoint inputFingerprint is invalid");
  }
  return value;
}

function requiredString(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Document outline summary checkpoint ${name} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Document outline summary checkpoint ${name} must be a positive integer`);
  }
  return value;
}

function assertBatch(length: number, maxBatchSize: number): void {
  if (length > maxBatchSize) {
    throw new Error(
      `Document outline summary checkpoint batch=${length} exceeds maxBatchSize=${maxBatchSize}`,
    );
  }
}

function cloneCheckpoint(
  checkpoint: DocumentOutlineSummaryCheckpoint,
): DocumentOutlineSummaryCheckpoint {
  return {
    ...checkpoint,
    metadata: structuredClone(checkpoint.metadata),
  };
}
