import { randomUUID } from "node:crypto";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { readableDocumentAssetPredicateSql } from "./document-asset-visibility-sql";
import {
  DocumentCandidateAdmissionError,
  assertDatabaseDocumentCandidateAdmission,
} from "./document-candidate-admission";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import { cloneJsonObject, jsonObjectColumn } from "./json-utils";
import type { KnowledgeSpaceDurablePermissionReference } from "./knowledge-space-authorization";
import {
  LogicalDocumentConflictError,
  type LogicalDocumentLookup,
  type LogicalDocumentRepository,
  LogicalDocumentValidationError,
} from "./logical-document-repository";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

export interface DocumentRevisionChunk {
  readonly createdAt: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly enabled: boolean;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly ordinal: number;
  readonly parentChunkId?: string | undefined;
  readonly systemMetadata: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
  readonly text: string;
  readonly tokenCount: number;
  readonly userMetadata: Readonly<Record<string, unknown>>;
}

export interface CreateDocumentRevisionChunkInput extends LogicalDocumentLookup {
  readonly createdAt: string;
  readonly documentRevision: number;
  readonly id?: string | undefined;
  readonly ordinal: number;
  readonly parentChunkId?: string | undefined;
  readonly systemMetadata: Readonly<Record<string, unknown>>;
  readonly text: string;
  readonly tokenCount: number;
  readonly userMetadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface DocumentChunkCursor {
  readonly id: string;
}

export interface ListDocumentChunksInput extends LogicalDocumentLookup {
  readonly candidateGrants: readonly string[];
  readonly cursor?: DocumentChunkCursor | undefined;
  readonly documentRevision: number;
  readonly limit: number;
  readonly query?: string | undefined;
}

export interface ListDocumentChunksResult {
  readonly items: DocumentRevisionChunk[];
  readonly nextCursor?: DocumentChunkCursor | undefined;
}

export interface DocumentChunkStateChange {
  readonly activatedAt?: string | undefined;
  readonly candidateFingerprint?: string | undefined;
  readonly candidatePublicationId?: string | undefined;
  readonly chunkId: string;
  readonly compilationAttemptId: string;
  readonly createdAt: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly enabled: boolean;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly state: "candidate" | "active" | "superseded" | "failed";
  readonly tenantId: string;
}

export interface DocumentChunkRepository {
  activateStateChange(
    input: LogicalDocumentLookup & {
      readonly candidateFingerprint: string;
      readonly candidatePublicationId: string;
      readonly changeId: string;
      readonly now: string;
    },
  ): Promise<DocumentChunkStateChange>;
  createMany(inputs: readonly CreateDocumentRevisionChunkInput[]): Promise<DocumentRevisionChunk[]>;
  failStateChange(
    input: LogicalDocumentLookup & { readonly changeId: string },
  ): Promise<DocumentChunkStateChange>;
  get(
    input: LogicalDocumentLookup & { readonly chunkId: string; readonly documentRevision: number },
  ): Promise<DocumentRevisionChunk | null>;
  list(input: ListDocumentChunksInput): Promise<ListDocumentChunksResult>;
  stageStateChange(
    input: LogicalDocumentLookup & {
      readonly candidateFingerprint?: string | undefined;
      readonly candidatePublicationId?: string | undefined;
      readonly changeId?: string | undefined;
      readonly chunkId: string;
      readonly compilationAttemptId: string;
      readonly documentRevision: number;
      readonly enabled: boolean;
      readonly now: string;
      readonly requestedBySubjectId?: string | undefined;
      readonly trustedInternal?: true | undefined;
    },
  ): Promise<DocumentChunkStateChange>;
}

export interface DocumentChunkStateService {
  request(
    input: LogicalDocumentLookup & {
      readonly chunkId: string;
      readonly documentRevision: number;
      readonly enabled: boolean;
      readonly now: string;
      readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
      readonly requestedBySubjectId?: string | undefined;
      readonly trustedInternal?: true | undefined;
    },
  ): Promise<DocumentChunkStateChange>;
}

export function createDocumentChunkStateService({
  chunks,
  compilationJobs,
  logicalDocuments,
}: {
  readonly chunks: DocumentChunkRepository;
  readonly compilationJobs: DocumentCompilationJobStateMachine;
  readonly logicalDocuments: LogicalDocumentRepository;
}): DocumentChunkStateService {
  return {
    request: async (input) => {
      const chunk = await chunks.get(input);
      if (!chunk) throw new LogicalDocumentValidationError("Document chunk not found");
      if (chunk.enabled === input.enabled) {
        throw new LogicalDocumentValidationError("Document chunk already has the requested state");
      }
      const document = await logicalDocuments.get(input);
      if (!document?.active || document.activeRevision !== input.documentRevision) {
        throw new LogicalDocumentConflictError(
          input.documentRevision,
          document?.activeRevision ?? null,
          document?.rowVersion ?? 0,
          document?.rowVersion ?? 0,
        );
      }
      const compilation = await compilationJobs.start({
        ...(compilationJobs.releaseDispatch ? { deferDispatch: true } : {}),
        documentAssetId: document.active.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
        ...(input.requestedBySubjectId ? { requestedBySubjectId: input.requestedBySubjectId } : {}),
        tenantId: input.tenantId,
        version: document.active.documentAssetVersion,
      });
      try {
        const change = await chunks.stageStateChange({
          ...input,
          compilationAttemptId: compilation.id,
          ...(input.requestedBySubjectId
            ? { requestedBySubjectId: input.requestedBySubjectId }
            : {}),
          ...(input.trustedInternal ? { trustedInternal: true } : {}),
        });
        await compilationJobs.releaseDispatch?.(compilation.id);
        return change;
      } catch (error) {
        await compilationJobs
          .cancel(compilation.id, "Chunk state candidate staging failed")
          .catch(() => undefined);
        throw error;
      }
    },
  };
}

export function createInMemoryDocumentChunkRepository({
  generateChangeId = randomUUID,
  generateChunkId = randomUUID,
  maxChunks,
}: {
  readonly generateChangeId?: (() => string) | undefined;
  readonly generateChunkId?: (() => string) | undefined;
  readonly maxChunks: number;
}): DocumentChunkRepository {
  if (!Number.isSafeInteger(maxChunks) || maxChunks < 1)
    throw new Error("maxChunks must be positive");
  const chunks = new Map<string, Omit<DocumentRevisionChunk, "enabled">>();
  const changes = new Map<string, DocumentChunkStateChange>();

  const effective = (chunk: Omit<DocumentRevisionChunk, "enabled">): DocumentRevisionChunk => {
    const active = [...changes.values()]
      .filter((change) => change.chunkId === chunk.id && change.state === "active")
      .sort(
        (left, right) =>
          (right.activatedAt ?? "").localeCompare(left.activatedAt ?? "") ||
          right.id.localeCompare(left.id),
      )[0];
    return cloneChunk({ ...chunk, enabled: active?.enabled ?? true });
  };

  const scopedChunk = (
    input: LogicalDocumentLookup & { readonly chunkId: string; readonly documentRevision: number },
  ): Omit<DocumentRevisionChunk, "enabled"> | null => {
    const chunk = chunks.get(input.chunkId);
    return chunk &&
      chunk.tenantId === input.tenantId &&
      chunk.knowledgeSpaceId === input.knowledgeSpaceId &&
      chunk.documentId === input.documentId &&
      chunk.documentRevision === input.documentRevision
      ? chunk
      : null;
  };

  return {
    activateStateChange: async (input) => {
      const change = changes.get(input.changeId);
      if (!change || !sameScope(change, input) || change.state !== "candidate") {
        throw new LogicalDocumentValidationError("Chunk state candidate not found");
      }
      for (const [id, existing] of changes) {
        if (existing.chunkId === change.chunkId && existing.state === "active") {
          changes.set(id, { ...existing, state: "superseded" });
        }
      }
      const activated: DocumentChunkStateChange = {
        ...change,
        activatedAt: input.now,
        candidateFingerprint: input.candidateFingerprint,
        candidatePublicationId: input.candidatePublicationId,
        state: "active",
      };
      changes.set(change.id, activated);
      return { ...activated };
    },
    createMany: async (inputs) => {
      if (chunks.size + inputs.length > maxChunks) {
        throw new LogicalDocumentValidationError(`Document chunks maxChunks=${maxChunks} exceeded`);
      }
      const prepared: Omit<DocumentRevisionChunk, "enabled">[] = inputs.map((input) => ({
        createdAt: input.createdAt,
        documentId: input.documentId,
        documentRevision: positiveInteger(input.documentRevision, "documentRevision"),
        id: input.id ?? generateChunkId(),
        knowledgeSpaceId: input.knowledgeSpaceId,
        ordinal: nonnegativeInteger(input.ordinal, "ordinal"),
        ...(input.parentChunkId ? { parentChunkId: input.parentChunkId } : {}),
        systemMetadata: cloneJsonObject(input.systemMetadata),
        tenantId: input.tenantId,
        text: input.text,
        tokenCount: nonnegativeInteger(input.tokenCount, "tokenCount"),
        userMetadata: cloneJsonObject(input.userMetadata ?? {}),
      }));
      const identities = new Set(prepared.map((chunk) => chunk.id));
      const ordinals = new Set(
        prepared.map(
          (chunk) =>
            `${chunk.tenantId}\u0000${chunk.knowledgeSpaceId}\u0000${chunk.documentId}\u0000${chunk.documentRevision}\u0000${chunk.ordinal}`,
        ),
      );
      if (identities.size !== prepared.length || ordinals.size !== prepared.length) {
        throw new LogicalDocumentValidationError(
          "Document chunk batch contains duplicate ids or ordinals",
        );
      }
      for (const chunk of prepared) {
        if (chunks.has(chunk.id))
          throw new LogicalDocumentValidationError("Document chunk already exists");
        if (
          chunk.parentChunkId &&
          !chunks.has(chunk.parentChunkId) &&
          !identities.has(chunk.parentChunkId)
        ) {
          throw new LogicalDocumentValidationError("Document chunk parent does not exist");
        }
      }
      for (const chunk of prepared) chunks.set(chunk.id, cloneChunkBase(chunk));
      return prepared.map(effective);
    },
    failStateChange: async (input) => {
      const change = changes.get(input.changeId);
      if (!change || !sameScope(change, input) || change.state !== "candidate") {
        throw new LogicalDocumentValidationError("Chunk state candidate not found");
      }
      const failed = { ...change, state: "failed" as const };
      changes.set(change.id, failed);
      return { ...failed };
    },
    get: async (input) => {
      const chunk = scopedChunk(input);
      return chunk ? effective(chunk) : null;
    },
    list: async (input) => {
      validateChunkList(input.limit, input.query);
      const query = input.query?.trim().toLocaleLowerCase();
      const matching = [...chunks.values()]
        .filter(
          (chunk) =>
            chunk.tenantId === input.tenantId &&
            chunk.knowledgeSpaceId === input.knowledgeSpaceId &&
            chunk.documentId === input.documentId &&
            chunk.documentRevision === input.documentRevision &&
            (!input.cursor || chunk.id > input.cursor.id) &&
            (!query || chunk.text.toLocaleLowerCase().includes(query)),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, input.limit + 1);
      const items = matching.slice(0, input.limit).map(effective);
      const last = items.at(-1);
      return {
        items,
        ...(matching.length > input.limit && last ? { nextCursor: { id: last.id } } : {}),
      };
    },
    stageStateChange: async (input) => {
      if (!scopedChunk(input)) throw new LogicalDocumentValidationError("Document chunk not found");
      const id = input.changeId ?? generateChangeId();
      const existing = changes.get(id);
      if (existing) {
        if (
          sameScope(existing, input) &&
          existing.chunkId === input.chunkId &&
          existing.enabled === input.enabled &&
          existing.compilationAttemptId === input.compilationAttemptId &&
          existing.candidatePublicationId === input.candidatePublicationId &&
          existing.candidateFingerprint === input.candidateFingerprint
        ) {
          return { ...existing };
        }
        throw new LogicalDocumentValidationError("Chunk state change idempotency conflict");
      }
      const change: DocumentChunkStateChange = {
        ...(input.candidateFingerprint ? { candidateFingerprint: input.candidateFingerprint } : {}),
        ...(input.candidatePublicationId
          ? { candidatePublicationId: input.candidatePublicationId }
          : {}),
        chunkId: input.chunkId,
        compilationAttemptId: input.compilationAttemptId,
        createdAt: input.now,
        documentId: input.documentId,
        documentRevision: input.documentRevision,
        enabled: input.enabled,
        id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        state: "candidate",
        tenantId: input.tenantId,
      };
      changes.set(id, change);
      return { ...change };
    },
  };
}

export function createDatabaseDocumentChunkRepository({
  database,
  generateChangeId = randomUUID,
  generateChunkId = randomUUID,
  maxBatchSize,
  maxListLimit,
}: {
  readonly database: DatabaseAdapter;
  readonly generateChangeId?: (() => string) | undefined;
  readonly generateChunkId?: (() => string) | undefined;
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
}): DocumentChunkRepository {
  positiveInteger(maxBatchSize, "maxBatchSize");
  positiveInteger(maxListLimit, "maxListLimit");

  const readChunk = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup & { readonly chunkId: string; readonly documentRevision: number },
  ): Promise<DocumentRevisionChunk | null> => {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [
        input.tenantId,
        input.knowledgeSpaceId,
        input.documentId,
        input.documentRevision,
        input.chunkId,
      ],
      sql: `${chunkSelectSql(database)} WHERE chunk.${q(database, "tenant_id")} = ${p(database, 1)} AND chunk.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND chunk.${q(database, "document_id")} = ${p(database, 3)} AND chunk.${q(database, "document_revision")} = ${p(database, 4)} AND chunk.${q(database, "id")} = ${p(database, 5)} LIMIT 1;`,
      tableName: "document_revision_chunks",
    });
    return result.rows[0] ? mapChunk(result.rows[0]) : null;
  };

  const readChange = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup & { readonly changeId: string },
    forUpdate = false,
  ): Promise<DocumentChunkStateChange | null> => {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.documentId, input.changeId],
      sql: `SELECT * FROM ${q(database, "document_chunk_state_changes")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "id")} = ${p(database, 4)}${forUpdate ? " FOR UPDATE" : ""};`,
      tableName: "document_chunk_state_changes",
    });
    return result.rows[0] ? mapChange(result.rows[0]) : null;
  };

  return {
    activateStateChange: (input) =>
      database.transaction(async (transaction) => {
        const change = await readChange(transaction, input, true);
        if (!change || change.state !== "candidate") {
          throw new LogicalDocumentValidationError("Chunk state candidate not found");
        }
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.tenantId, input.knowledgeSpaceId, input.documentId, change.chunkId],
          sql: `UPDATE ${q(database, "document_chunk_state_changes")} SET ${q(database, "state")} = 'superseded' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "chunk_id")} = ${p(database, 4)} AND ${q(database, "state")} = 'active';`,
          tableName: "document_chunk_state_changes",
        });
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.now,
            input.candidatePublicationId,
            input.candidateFingerprint,
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            input.changeId,
          ],
          sql: `UPDATE ${q(database, "document_chunk_state_changes")} SET ${q(database, "state")} = 'active', ${q(database, "activated_at")} = ${p(database, 1)}, ${q(database, "candidate_publication_id")} = ${p(database, 2)}, ${q(database, "candidate_fingerprint")} = ${p(database, 3)} WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(database, "knowledge_space_id")} = ${p(database, 5)} AND ${q(database, "document_id")} = ${p(database, 6)} AND ${q(database, "id")} = ${p(database, 7)} AND ${q(database, "state")} = 'candidate';`,
          tableName: "document_chunk_state_changes",
        });
        if (result.rowsAffected !== 1)
          throw new LogicalDocumentValidationError("Chunk state CAS conflict");
        const updated = await readChange(transaction, input);
        if (!updated) throw new LogicalDocumentValidationError("Chunk state change disappeared");
        return updated;
      }),
    createMany: async (inputs) => {
      if (inputs.length === 0) return [];
      if (inputs.length > maxBatchSize) {
        throw new LogicalDocumentValidationError(
          `Document chunk maxBatchSize=${maxBatchSize} exceeded`,
        );
      }
      return database.transaction(async (transaction) => {
        const created: DocumentRevisionChunk[] = [];
        for (const raw of inputs) {
          const input = {
            ...raw,
            documentRevision: positiveInteger(raw.documentRevision, "documentRevision"),
            id: raw.id ?? generateChunkId(),
            ordinal: nonnegativeInteger(raw.ordinal, "ordinal"),
            tokenCount: nonnegativeInteger(raw.tokenCount, "tokenCount"),
          };
          await transaction.execute({
            maxRows: 0,
            operation: "insert",
            params: [
              input.id,
              input.tenantId,
              input.knowledgeSpaceId,
              input.documentId,
              input.documentRevision,
              input.parentChunkId ?? null,
              input.ordinal,
              input.tokenCount,
              input.text,
              JSON.stringify(cloneJsonObject(input.systemMetadata)),
              JSON.stringify(cloneJsonObject(input.userMetadata ?? {})),
              input.createdAt,
            ],
            sql: `INSERT INTO ${q(database, "document_revision_chunks")} (${["id", "tenant_id", "knowledge_space_id", "document_id", "document_revision", "parent_chunk_id", "ordinal", "token_count", "text", "system_metadata", "user_metadata", "created_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, ${p(database, 7)}, ${p(database, 8)}, ${p(database, 9)}, ${jsonP(database, 10)}, ${jsonP(database, 11)}, ${p(database, 12)});`,
            tableName: "document_revision_chunks",
          });
          const chunk = await readChunk(transaction, { ...input, chunkId: input.id });
          if (!chunk) throw new LogicalDocumentValidationError("Document chunk insert failed");
          created.push(chunk);
        }
        return created;
      });
    },
    failStateChange: async (input) => {
      const result = await database.execute({
        maxRows: 0,
        operation: "update",
        params: [input.tenantId, input.knowledgeSpaceId, input.documentId, input.changeId],
        sql: `UPDATE ${q(database, "document_chunk_state_changes")} SET ${q(database, "state")} = 'failed' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "state")} = 'candidate';`,
        tableName: "document_chunk_state_changes",
      });
      if (result.rowsAffected !== 1)
        throw new LogicalDocumentValidationError("Chunk state candidate not found");
      const change = await readChange(database, input);
      if (!change) throw new LogicalDocumentValidationError("Chunk state change disappeared");
      return change;
    },
    get: (input) => readChunk(database, input),
    list: async (input) => {
      validateChunkList(input.limit, input.query, maxListLimit);
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.knowledgeSpaceId,
        input.documentId,
        input.documentRevision,
        JSON.stringify(input.candidateGrants),
      ];
      let filters = "";
      if (input.cursor) {
        params.push(input.cursor.id);
        filters += ` AND chunk.${q(database, "id")} > ${p(database, params.length)}`;
      }
      if (input.query?.trim()) {
        params.push(`%${escapeLike(input.query.trim().toLocaleLowerCase())}%`);
        filters += ` AND LOWER(chunk.${q(database, "text")}) LIKE ${p(database, params.length)} ESCAPE '\\\\'`;
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `${chunkSelectSql(database, true)} WHERE chunk.${q(database, "tenant_id")} = ${p(database, 1)} AND chunk.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND chunk.${q(database, "document_id")} = ${p(database, 3)} AND chunk.${q(database, "document_revision")} = ${p(database, 4)} AND ${readableDocumentAssetPredicateSql(database, "asset", "chunk_list_parent_source")} AND ${assetPermissionSql(database, "asset", p(database, 5))}${filters} ORDER BY chunk.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: "document_revision_chunks",
      });
      const items = result.rows.slice(0, input.limit).map(mapChunk);
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last ? { nextCursor: { id: last.id } } : {}),
      };
    },
    stageStateChange: async (input) => {
      return database.transaction(async (transaction) => {
        try {
          await assertDatabaseDocumentCandidateAdmission({
            admission: {
              compilationAttemptId: input.compilationAttemptId,
              documentId: input.documentId,
              documentRevision: input.documentRevision,
              knowledgeSpaceId: input.knowledgeSpaceId,
              now: input.now,
              ...(input.requestedBySubjectId
                ? { requestedBySubjectId: input.requestedBySubjectId }
                : {}),
              tenantId: input.tenantId,
              ...(input.trustedInternal ? { trustedInternal: true } : {}),
            },
            database,
            executor: transaction,
          });
        } catch (error) {
          if (error instanceof DocumentCandidateAdmissionError) {
            throw new LogicalDocumentValidationError("Document chunk candidate admission denied");
          }
          throw error;
        }
        const chunk = await readChunk(transaction, input);
        if (!chunk) throw new LogicalDocumentValidationError("Document chunk not found");
        if (chunk.enabled === input.enabled) {
          throw new LogicalDocumentValidationError(
            "Document chunk already has the requested state",
          );
        }
        const changeId = input.changeId ?? generateChangeId();
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            changeId,
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            input.documentRevision,
            input.chunkId,
            input.enabled,
            input.compilationAttemptId,
            input.candidatePublicationId ?? null,
            input.candidateFingerprint ?? null,
            input.now,
          ],
          sql: `INSERT INTO ${q(database, "document_chunk_state_changes")} (${["id", "tenant_id", "knowledge_space_id", "document_id", "document_revision", "chunk_id", "enabled", "state", "compilation_attempt_id", "candidate_publication_id", "candidate_fingerprint", "created_at", "activated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, ${p(database, 7)}, 'candidate', ${p(database, 8)}, ${p(database, 9)}, ${p(database, 10)}, ${p(database, 11)}, NULL);`,
          tableName: "document_chunk_state_changes",
        });
        const change = await readChange(transaction, { ...input, changeId });
        if (!change) throw new LogicalDocumentValidationError("Chunk state change insert failed");
        return change;
      });
    },
  };
}

function chunkSelectSql(database: DatabaseAdapter, includePermissionJoin = false): string {
  const base = `SELECT chunk.*, COALESCE((SELECT change.${q(database, "enabled")} FROM ${q(database, "document_chunk_state_changes")} change WHERE change.${q(database, "tenant_id")} = chunk.${q(database, "tenant_id")} AND change.${q(database, "knowledge_space_id")} = chunk.${q(database, "knowledge_space_id")} AND change.${q(database, "document_id")} = chunk.${q(database, "document_id")} AND change.${q(database, "document_revision")} = chunk.${q(database, "document_revision")} AND change.${q(database, "chunk_id")} = chunk.${q(database, "id")} AND change.${q(database, "state")} = 'active' ORDER BY change.${q(database, "activated_at")} DESC, change.${q(database, "id")} DESC LIMIT 1), ${database.dialect === "postgres" ? "TRUE" : "1"}) AS ${q(database, "effective_enabled")} FROM ${q(database, "document_revision_chunks")} chunk`;
  return includePermissionJoin
    ? `${base} JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = chunk.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = chunk.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = chunk.${q(database, "document_id")} AND revision.${q(database, "revision")} = chunk.${q(database, "document_revision")} JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")}`
    : base;
}

function assetPermissionSql(
  database: Pick<DatabaseAdapter, "dialect">,
  alias: string,
  grantsPlaceholder: string,
): string {
  const metadata = `${alias}.${q(database, "metadata")}`;
  return database.dialect === "postgres"
    ? `(NOT (${metadata} ? 'permissionScope') OR (jsonb_typeof(${metadata} -> 'permissionScope') = 'array' AND ${grantsPlaceholder}::jsonb @> (${metadata} -> 'permissionScope')))`
    : `(JSON_CONTAINS_PATH(${metadata}, 'one', '$.permissionScope') = 0 OR (JSON_TYPE(JSON_EXTRACT(${metadata}, '$.permissionScope')) = 'ARRAY' AND JSON_CONTAINS(CAST(${grantsPlaceholder} AS JSON), JSON_EXTRACT(${metadata}, '$.permissionScope'))))`;
}

function mapChunk(row: DatabaseRow): DocumentRevisionChunk {
  const enabled = row.effective_enabled;
  if (typeof enabled !== "boolean" && enabled !== 0 && enabled !== 1) {
    throw new LogicalDocumentValidationError("Invalid document chunk enabled state");
  }
  return {
    createdAt: stringColumn(row, "created_at"),
    documentId: stringColumn(row, "document_id"),
    documentRevision: numberColumn(row, "document_revision"),
    enabled: enabled === true || enabled === 1,
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ordinal: numberColumn(row, "ordinal"),
    ...(optionalStringColumn(row, "parent_chunk_id")
      ? { parentChunkId: optionalStringColumn(row, "parent_chunk_id") }
      : {}),
    systemMetadata: jsonObjectColumn(row, "system_metadata"),
    tenantId: stringColumn(row, "tenant_id"),
    text: stringColumn(row, "text"),
    tokenCount: numberColumn(row, "token_count"),
    userMetadata: jsonObjectColumn(row, "user_metadata"),
  };
}

function mapChange(row: DatabaseRow): DocumentChunkStateChange {
  const state = stringColumn(row, "state");
  if (state !== "candidate" && state !== "active" && state !== "superseded" && state !== "failed") {
    throw new LogicalDocumentValidationError("Invalid chunk state change state");
  }
  const enabled = row.enabled;
  if (typeof enabled !== "boolean" && enabled !== 0 && enabled !== 1) {
    throw new LogicalDocumentValidationError("Invalid chunk state change value");
  }
  return {
    ...(optionalStringColumn(row, "activated_at")
      ? { activatedAt: optionalStringColumn(row, "activated_at") }
      : {}),
    ...(optionalStringColumn(row, "candidate_fingerprint")
      ? { candidateFingerprint: optionalStringColumn(row, "candidate_fingerprint") }
      : {}),
    ...(optionalStringColumn(row, "candidate_publication_id")
      ? { candidatePublicationId: optionalStringColumn(row, "candidate_publication_id") }
      : {}),
    chunkId: stringColumn(row, "chunk_id"),
    compilationAttemptId: stringColumn(row, "compilation_attempt_id"),
    createdAt: stringColumn(row, "created_at"),
    documentId: stringColumn(row, "document_id"),
    documentRevision: numberColumn(row, "document_revision"),
    enabled: enabled === true || enabled === 1,
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    state,
    tenantId: stringColumn(row, "tenant_id"),
  };
}

function sameScope(
  value: Pick<DocumentChunkStateChange, "tenantId" | "knowledgeSpaceId" | "documentId">,
  input: LogicalDocumentLookup,
): boolean {
  return (
    value.tenantId === input.tenantId &&
    value.knowledgeSpaceId === input.knowledgeSpaceId &&
    value.documentId === input.documentId
  );
}

function cloneChunk(chunk: DocumentRevisionChunk): DocumentRevisionChunk {
  return {
    ...chunk,
    systemMetadata: cloneJsonObject(chunk.systemMetadata),
    userMetadata: cloneJsonObject(chunk.userMetadata),
  };
}

function cloneChunkBase(
  chunk: Omit<DocumentRevisionChunk, "enabled">,
): Omit<DocumentRevisionChunk, "enabled"> {
  const { enabled: _enabled, ...base } = cloneChunk({ ...chunk, enabled: true });
  return base;
}

function validateChunkList(limit: number, query?: string, max = 100): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) {
    throw new LogicalDocumentValidationError(`Chunk list limit must be between 1 and ${max}`);
  }
  if (query !== undefined && (query.trim().length < 1 || query.length > 512)) {
    throw new LogicalDocumentValidationError(
      "Chunk search query must be between 1 and 512 characters",
    );
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new LogicalDocumentValidationError(`${label} must be positive`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LogicalDocumentValidationError(`${label} must be non-negative`);
  }
  return value;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}

function jsonP(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return database.dialect === "postgres"
    ? `${p(database, position)}::jsonb`
    : `CAST(${p(database, position)} AS JSON)`;
}
