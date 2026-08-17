import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  UuidSchema,
  stableJson,
} from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";

export interface DocumentSemanticWindowCheckpointScope {
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId: string;
  readonly tenantId: string;
}

export interface DocumentSemanticWindowCheckpointKey {
  readonly inputFingerprint: string;
  readonly windowId: string;
}

export interface DocumentSemanticWindowCheckpoint extends DocumentSemanticWindowCheckpointKey {
  readonly completion: Readonly<Record<string, unknown>>;
  readonly modelFingerprint: string;
  readonly responseText: string;
}

export interface DocumentSemanticWindowCheckpointRepository {
  get(input: {
    readonly key: DocumentSemanticWindowCheckpointKey;
    readonly scope: DocumentSemanticWindowCheckpointScope;
  }): Promise<DocumentSemanticWindowCheckpoint | null>;
  put(input: {
    readonly checkpoint: DocumentSemanticWindowCheckpoint;
    readonly scope: DocumentSemanticWindowCheckpointScope;
  }): Promise<DocumentSemanticWindowCheckpoint>;
}

export function createInMemoryDocumentSemanticWindowCheckpointRepository(): DocumentSemanticWindowCheckpointRepository {
  const records = new Map<string, DocumentSemanticWindowCheckpoint>();
  return {
    get: async ({ key, scope }) => {
      const stored = records.get(storageKey(normalizeScope(scope), normalizeKey(key)));
      return stored ? cloneCheckpoint(stored) : null;
    },
    put: async ({ checkpoint, scope }) => {
      const normalizedScope = normalizeScope(scope);
      const normalized = normalizeCheckpoint(checkpoint);
      const key = storageKey(normalizedScope, normalized);
      const existing = records.get(key);
      if (existing) {
        assertExactCheckpointReplay(existing, normalized);
        return cloneCheckpoint(existing);
      }
      records.set(key, cloneCheckpoint(normalized));
      return cloneCheckpoint(normalized);
    },
  };
}

export function createDatabaseDocumentSemanticWindowCheckpointRepository({
  database,
  now = () => new Date().toISOString(),
}: {
  readonly database: DatabaseAdapter;
  readonly now?: (() => string) | undefined;
}): DocumentSemanticWindowCheckpointRepository {
  return {
    get: async ({ key, scope }) =>
      selectCheckpoint(database, database, normalizeScope(scope), normalizeKey(key)),
    put: async ({ checkpoint, scope }) => {
      const normalizedScope = normalizeScope(scope);
      const normalized = normalizeCheckpoint(checkpoint);
      return database.transaction(async (transaction) => {
        await insertCheckpoint(database, transaction, normalizedScope, normalized, now());
        const stored = await selectCheckpoint(database, transaction, normalizedScope, normalized);
        if (!stored) throw new Error("Semantic window checkpoint was not persisted");
        assertExactCheckpointReplay(stored, normalized);
        return stored;
      });
    },
  };
}

function assertExactCheckpointReplay(
  stored: DocumentSemanticWindowCheckpoint,
  incoming: DocumentSemanticWindowCheckpoint,
): void {
  if (stableJson(stored) !== stableJson(incoming)) {
    throw new Error("Semantic window checkpoint already exists with different model output");
  }
}

const table = "document_semantic_window_checkpoints";

async function selectCheckpoint(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: DocumentSemanticWindowCheckpointScope,
  key: DocumentSemanticWindowCheckpointKey,
): Promise<DocumentSemanticWindowCheckpoint | null> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const p = (index: number) => databasePlaceholder(database, index);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      scope.tenantId,
      scope.knowledgeSpaceId,
      scope.publicationGenerationId,
      key.windowId,
      key.inputFingerprint,
    ],
    sql: `SELECT ${q("window_id")}, ${q("input_fingerprint")}, ${q("model_fingerprint")}, ${q("response_text")}, ${q("completion")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("publication_generation_id")} = ${p(3)} AND ${q("window_id")} = ${p(4)} AND ${q("input_fingerprint")} = ${p(5)} LIMIT 1;`,
    tableName: table,
  });
  const row = result.rows[0];
  return row
    ? normalizeCheckpoint({
        completion: jsonObjectColumn(row, "completion"),
        inputFingerprint: stringColumn(row, "input_fingerprint"),
        modelFingerprint: stringColumn(row, "model_fingerprint"),
        responseText: stringColumn(row, "response_text"),
        windowId: stringColumn(row, "window_id"),
      })
    : null;
}

async function insertCheckpoint(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: DocumentSemanticWindowCheckpointScope,
  checkpoint: DocumentSemanticWindowCheckpoint,
  createdAt: string,
): Promise<void> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const p = (index: number) => databasePlaceholder(database, index);
  const insert = database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT";
  const conflict =
    database.dialect === "postgres"
      ? ` ON CONFLICT (${["tenant_id", "knowledge_space_id", "publication_generation_id", "window_id", "input_fingerprint"].map(q).join(", ")}) DO NOTHING`
      : "";
  const params: DatabaseQueryValue[] = [
    scope.tenantId,
    scope.knowledgeSpaceId,
    scope.documentAssetId,
    scope.documentVersion,
    scope.publicationGenerationId,
    checkpoint.windowId,
    checkpoint.inputFingerprint,
    checkpoint.modelFingerprint,
    checkpoint.responseText,
    JSON.stringify(checkpoint.completion),
    createdAt,
  ];
  const completionPlaceholder =
    database.dialect === "postgres" ? `${p(10)}::jsonb` : `CAST(${p(10)} AS JSON)`;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${insert} INTO ${q(table)} (${["tenant_id", "knowledge_space_id", "document_asset_id", "document_version", "publication_generation_id", "window_id", "input_fingerprint", "model_fingerprint", "response_text", "completion", "created_at"].map(q).join(", ")}) VALUES (${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(p).join(", ")}, ${completionPlaceholder}, ${p(11)})${conflict};`,
    tableName: table,
  });
}

function normalizeScope(
  scope: DocumentSemanticWindowCheckpointScope,
): DocumentSemanticWindowCheckpointScope {
  return {
    documentAssetId: UuidSchema.parse(scope.documentAssetId),
    documentVersion: positiveInteger(scope.documentVersion, "documentVersion"),
    knowledgeSpaceId: UuidSchema.parse(scope.knowledgeSpaceId),
    publicationGenerationId: UuidSchema.parse(scope.publicationGenerationId),
    tenantId: requiredString(scope.tenantId, "tenantId", 255),
  };
}

function normalizeKey(
  key: DocumentSemanticWindowCheckpointKey,
): DocumentSemanticWindowCheckpointKey {
  return {
    inputFingerprint: fingerprint(key.inputFingerprint, "inputFingerprint"),
    windowId: requiredString(key.windowId, "windowId", 128),
  };
}

function normalizeCheckpoint(
  checkpoint: DocumentSemanticWindowCheckpoint,
): DocumentSemanticWindowCheckpoint {
  const key = normalizeKey(checkpoint);
  return {
    ...key,
    completion: structuredClone(checkpoint.completion),
    modelFingerprint: fingerprint(checkpoint.modelFingerprint, "modelFingerprint"),
    responseText: requiredString(checkpoint.responseText, "responseText", 1_000_000),
  };
}

function fingerprint(value: string, label: string): string {
  const normalized = requiredString(value, label, 71);
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`Semantic window checkpoint ${label} is invalid`);
  }
  return normalized;
}

function requiredString(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Semantic window checkpoint ${label} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Semantic window checkpoint ${label} must be a positive integer`);
  }
  return value;
}

function storageKey(
  scope: DocumentSemanticWindowCheckpointScope,
  key: DocumentSemanticWindowCheckpointKey,
): string {
  return `${scope.tenantId}\u001f${scope.knowledgeSpaceId}\u001f${scope.publicationGenerationId}\u001f${key.windowId}\u001f${key.inputFingerprint}`;
}

function cloneCheckpoint(
  checkpoint: DocumentSemanticWindowCheckpoint,
): DocumentSemanticWindowCheckpoint {
  return { ...checkpoint, completion: structuredClone(checkpoint.completion) };
}
