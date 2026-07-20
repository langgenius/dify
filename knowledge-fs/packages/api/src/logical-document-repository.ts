import { createHash, randomUUID } from "node:crypto";

import {
  candidatePermissionScopeAllows,
  candidatePermissionScopeSnapshot,
} from "./candidate-content-authorization";
import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { readableDocumentAssetPredicateSql } from "./document-asset-visibility-sql";
import { cloneJsonObject, jsonObjectColumn } from "./json-utils";
import {
  KnowledgeSpaceAccessError,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import type { KnowledgeSpacePermissionSnapshot } from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { deterministicKnowledgeSpaceActivityId } from "./knowledge-space-overview";
import { appendKnowledgeSpaceActivityWithExecutor } from "./knowledge-space-overview-database-repository";
import {
  SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY,
  type SourceDocumentWorkflowOwnership,
  sourceWorkflowOwnershipMatches,
} from "./source-document-workflow-ownership";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

export type LogicalDocumentStatus = "pending" | "ready" | "failed" | "deleting";
export type DocumentRevisionState = "candidate" | "active" | "superseded" | "failed";

export interface LogicalDocument {
  readonly activeRevision?: number | undefined;
  readonly createdAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly providerItemId?: string | undefined;
  readonly rowVersion: number;
  readonly sourceId?: string | undefined;
  readonly status: LogicalDocumentStatus;
  readonly systemMetadata: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly userMetadata: Readonly<Record<string, unknown>>;
}

export interface DocumentRevision {
  readonly activatedAt?: string | undefined;
  readonly compilationAttemptId?: string | undefined;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly documentAssetVersion: number;
  readonly documentId: string;
  readonly expectedActiveRevision: number | null;
  readonly expectedDocumentRowVersion: number;
  readonly knowledgeSpaceId: string;
  readonly mimeType: string;
  readonly revision: number;
  readonly sizeBytes: number;
  readonly state: DocumentRevisionState;
  readonly systemMetadata: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
}

export interface LogicalDocumentWithActiveRevision extends LogicalDocument {
  readonly active: DocumentRevision | null;
}

export interface LogicalDocumentCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface DocumentRevisionCursor {
  readonly revision: number;
}

export interface LogicalDocumentScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface LogicalDocumentLookup extends LogicalDocumentScope {
  readonly documentId: string;
}

export interface CreateDocumentRevisionInput extends LogicalDocumentScope {
  readonly contentHash: string;
  readonly documentAssetId: string;
  readonly documentAssetVersion: number;
  readonly documentId?: string | undefined;
  readonly expectedActiveRevision?: number | null | undefined;
  readonly expectedDocumentRowVersion?: number | undefined;
  readonly mimeType: string;
  readonly now: string;
  /**
   * Fresh durable caller grant revalidated in the candidate-insert transaction. Explicit-target
   * appends additionally prove visibility of the current active document scope.
   */
  readonly permissionSnapshot?:
    | (Pick<KnowledgeSpacePermissionSnapshot, "accessChannel" | "id" | "revision"> & {
        readonly permissionScopes?: readonly string[] | undefined;
      })
    | undefined;
  readonly providerItemId?: string | undefined;
  /** Internal rollback path: append a new immutable revision that intentionally reuses an asset. */
  readonly rollbackOfRevision?: number | undefined;
  readonly requestedBySubjectId?: string | undefined;
  readonly sizeBytes: number;
  readonly sourceId?: string | undefined;
  readonly systemMetadata: Readonly<Record<string, unknown>>;
  readonly title: string;
  /** Explicit server-only path for a callerless Source/provider materialization. */
  readonly trustedInternalAdmission?: true | undefined;
}

export interface ActivateDocumentRevisionInput extends LogicalDocumentLookup {
  readonly expectedActiveRevision: number | null;
  readonly expectedRowVersion: number;
  readonly now: string;
  readonly revision: number;
}

export interface PatchDocumentUserMetadataInput extends LogicalDocumentLookup {
  readonly expectedRowVersion: number;
  readonly now: string;
  readonly patch: Readonly<Record<string, unknown>>;
  /** Fresh durable grant revalidated in the same transaction as the metadata CAS. */
  readonly permissionSnapshot: Pick<
    KnowledgeSpacePermissionSnapshot,
    "accessChannel" | "id" | "revision"
  >;
  readonly requestedBySubjectId: string;
}

export interface ListLogicalDocumentsInput extends LogicalDocumentScope {
  readonly candidateGrants: readonly string[];
  readonly cursor?: LogicalDocumentCursor | undefined;
  readonly limit: number;
}

export interface ListDocumentRevisionsInput extends LogicalDocumentLookup {
  readonly candidateGrants: readonly string[];
  readonly cursor?: DocumentRevisionCursor | undefined;
  readonly limit: number;
}

export interface ListLogicalDocumentsResult {
  readonly items: LogicalDocumentWithActiveRevision[];
  readonly nextCursor?: LogicalDocumentCursor | undefined;
}

export interface ListDocumentRevisionsResult {
  readonly items: DocumentRevision[];
  readonly nextCursor?: DocumentRevisionCursor | undefined;
}

export interface SourceActiveDocumentInventoryCursor {
  readonly documentId: string;
  readonly providerItemId: string;
}

export interface SourceActiveDocumentInventoryItem {
  readonly contentHash: string;
  readonly documentId: string;
  readonly etag?: string | undefined;
  readonly providerItemId: string;
  readonly revision: number;
  readonly rowVersion: number;
  readonly systemMetadata: Readonly<Record<string, unknown>>;
}

export interface LogicalDocumentRepository {
  /**
   * Creates immutable revision content. sourceId + providerItemId is the stable I4 injection
   * boundary: repeated imports append to the same logical document; the asset tuple remains the
   * idempotency key for retries.
   */
  createCandidateRevision(input: CreateDocumentRevisionInput): Promise<{
    readonly document: LogicalDocument;
    readonly revision: DocumentRevision;
  }>;
  bindCompilationAttempt(
    input: LogicalDocumentLookup & {
      readonly attemptId: string;
      readonly revision: number;
    },
  ): Promise<DocumentRevision>;
  activateRevision(
    input: ActivateDocumentRevisionInput,
  ): Promise<LogicalDocumentWithActiveRevision>;
  failCandidate(
    input: LogicalDocumentLookup & { readonly now: string; readonly revision: number },
  ): Promise<DocumentRevision>;
  /**
   * Removes an unpublished, unbound candidate created by a failed Source admission. This is an
   * internal compensation primitive: it never removes an active/superseded revision or a
   * candidate already handed to the compilation pipeline.
   */
  discardUnboundCandidate(
    input: LogicalDocumentLookup & {
      readonly documentAssetId: string;
      readonly documentAssetVersion: number;
      readonly revision: number;
    },
  ): Promise<boolean>;
  /** Internal ownership fence used before compensating a Source-owned document asset. */
  isAssetReferenced(input: {
    readonly documentAssetId: string;
    readonly documentAssetVersion: number;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }): Promise<boolean>;
  /**
   * Proves that an exact run-owned revision is failed, was never active, and is the asset's only
   * logical reference before a durable physical-deletion request is admitted.
   */
  isFailedSourceRevisionCleanupEligible(
    input: LogicalDocumentLookup & {
      readonly documentAssetId: string;
      readonly documentAssetVersion: number;
      readonly ownership: SourceDocumentWorkflowOwnership;
      readonly revision: number;
      readonly sourceId: string;
    },
  ): Promise<boolean>;
  get(input: LogicalDocumentLookup): Promise<LogicalDocumentWithActiveRevision | null>;
  getRevision(
    input: LogicalDocumentLookup & { readonly revision: number },
  ): Promise<DocumentRevision | null>;
  list(input: ListLogicalDocumentsInput): Promise<ListLogicalDocumentsResult>;
  listRevisions(input: ListDocumentRevisionsInput): Promise<ListDocumentRevisionsResult>;
  listActiveBySource(
    input: LogicalDocumentScope & {
      readonly cursor?: SourceActiveDocumentInventoryCursor | undefined;
      readonly limit: number;
      readonly sourceId: string;
    },
  ): Promise<{
    readonly items: SourceActiveDocumentInventoryItem[];
    readonly nextCursor?: SourceActiveDocumentInventoryCursor | undefined;
  }>;
  patchUserMetadata(input: PatchDocumentUserMetadataInput): Promise<LogicalDocument>;
}

export interface DocumentRevisionPublicationFenceResolver {
  resolve(
    input: LogicalDocumentScope & {
      readonly attemptId: string;
      readonly documentAssetId: string;
      readonly documentAssetVersion: number;
    },
  ): Promise<{
    readonly documentId: string;
    readonly expectedActiveRevision: number | null;
    readonly expectedDocumentRowVersion: number;
    readonly revision: number;
  } | null>;
}

export class LogicalDocumentConflictError extends Error {
  readonly code = "LOGICAL_DOCUMENT_CAS_CONFLICT";

  constructor(
    readonly expectedActiveRevision: number | null,
    readonly actualActiveRevision: number | null,
    readonly expectedRowVersion: number,
    readonly actualRowVersion: number,
  ) {
    super(
      `Logical document CAS conflict: expected active=${String(expectedActiveRevision)} rowVersion=${expectedRowVersion}; actual active=${String(actualActiveRevision)} rowVersion=${actualRowVersion}`,
    );
  }
}

export class LogicalDocumentNotFoundError extends Error {
  readonly code = "LOGICAL_DOCUMENT_NOT_FOUND";
}

export class LogicalDocumentValidationError extends Error {
  readonly code = "LOGICAL_DOCUMENT_VALIDATION_FAILED";
}

export interface InMemoryLogicalDocumentRepositoryOptions {
  readonly canReadDocument: (input: {
    readonly candidateGrants: readonly string[];
    readonly document: LogicalDocumentWithActiveRevision;
  }) => boolean | Promise<boolean>;
  readonly canReadRevision: (input: {
    readonly candidateGrants: readonly string[];
    readonly revision: DocumentRevision;
  }) => boolean | Promise<boolean>;
  readonly generateDocumentId?: (() => string) | undefined;
  readonly maxDocuments: number;
  readonly maxRevisionsPerDocument: number;
}

export function createInMemoryLogicalDocumentRepository({
  canReadDocument,
  canReadRevision,
  generateDocumentId = randomUUID,
  maxDocuments,
  maxRevisionsPerDocument,
}: InMemoryLogicalDocumentRepositoryOptions): LogicalDocumentRepository {
  positiveLimit(maxDocuments, "maxDocuments");
  positiveLimit(maxRevisionsPerDocument, "maxRevisionsPerDocument");

  const documents = new Map<string, LogicalDocument>();
  const revisions = new Map<string, DocumentRevision[]>();
  const assetKeys = new Map<string, { readonly documentId: string; readonly revision: number }>();
  const providerKeys = new Map<string, string>();

  const getScoped = (input: LogicalDocumentLookup): LogicalDocument => {
    const document = documents.get(input.documentId);
    if (
      !document ||
      document.tenantId !== input.tenantId ||
      document.knowledgeSpaceId !== input.knowledgeSpaceId
    ) {
      throw new LogicalDocumentNotFoundError("Logical document not found");
    }
    return document;
  };

  const activate = async (
    input: ActivateDocumentRevisionInput,
  ): Promise<LogicalDocumentWithActiveRevision> => {
    const document = getScoped(input);
    assertDocumentCas(document, input);
    const history = revisions.get(document.id) ?? [];
    const target = history.find((candidate) => candidate.revision === input.revision);
    if (!target || target.state !== "candidate") {
      throw new LogicalDocumentValidationError("Target document revision is not activatable");
    }

    const updatedHistory = history.map((revision) => {
      if (revision.revision === target.revision) {
        return { ...revision, activatedAt: input.now, state: "active" as const };
      }
      if (revision.state === "active") {
        return { ...revision, state: "superseded" as const };
      }
      return revision;
    });
    const updated: LogicalDocument = {
      ...document,
      activeRevision: target.revision,
      rowVersion: document.rowVersion + 1,
      status: "ready",
      updatedAt: input.now,
    };
    documents.set(document.id, cloneDocument(updated));
    revisions.set(document.id, updatedHistory.map(cloneRevision));
    return withActive(updated, updatedHistory);
  };

  return {
    bindCompilationAttempt: async (input) => {
      const document = getScoped(input);
      const history = revisions.get(document.id) ?? [];
      const target = history.find((candidate) => candidate.revision === input.revision);
      if (!target || target.state !== "candidate") {
        throw new LogicalDocumentValidationError("Target document revision is not a candidate");
      }
      if (
        target.compilationAttemptId !== undefined &&
        target.compilationAttemptId !== input.attemptId
      ) {
        throw new LogicalDocumentValidationError(
          "Document revision is bound to another compilation attempt",
        );
      }
      const bound = { ...target, compilationAttemptId: input.attemptId };
      revisions.set(
        document.id,
        history.map((revision) =>
          revision.revision === bound.revision ? cloneRevision(bound) : revision,
        ),
      );
      return cloneRevision(bound);
    },
    createCandidateRevision: async (rawInput) => {
      const input = normalizeCreateRevision(rawInput);
      const assetKey = scopedAssetKey(input);
      const idempotent =
        input.rollbackOfRevision === undefined ? assetKeys.get(assetKey) : undefined;
      if (idempotent) {
        const document = getScoped({ ...input, documentId: idempotent.documentId });
        const revision = revisions
          .get(document.id)
          ?.find((candidate) => candidate.revision === idempotent.revision);
        if (!revision || revision.contentHash !== input.contentHash) {
          throw new LogicalDocumentValidationError(
            "Document asset retry changed immutable content",
          );
        }
        return { document: cloneDocument(document), revision: cloneRevision(revision) };
      }

      const providerKey = sourceProviderKey(input);
      const existingProviderDocumentId = providerKey ? providerKeys.get(providerKey) : undefined;
      const documentId = input.documentId ?? existingProviderDocumentId ?? generateDocumentId();
      let document = documents.get(documentId);
      if (document) {
        if (
          document.tenantId !== input.tenantId ||
          document.knowledgeSpaceId !== input.knowledgeSpaceId
        ) {
          throw new LogicalDocumentValidationError("Logical document scope mismatch");
        }
        if (existingProviderDocumentId && existingProviderDocumentId !== document.id) {
          throw new LogicalDocumentValidationError("Provider item belongs to another document");
        }
        assertCreateRevisionCas(document, input);
      } else if (input.documentId) {
        throw new LogicalDocumentNotFoundError("Logical document not found");
      } else {
        if (documents.size >= maxDocuments) {
          throw new LogicalDocumentValidationError(
            `Logical document maxDocuments=${maxDocuments} exceeded`,
          );
        }
        document = {
          createdAt: input.now,
          id: documentId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          ...(input.providerItemId ? { providerItemId: input.providerItemId } : {}),
          rowVersion: 0,
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
          status: "pending",
          systemMetadata: cloneJsonObject(input.systemMetadata),
          tenantId: input.tenantId,
          title: input.title,
          updatedAt: input.now,
          userMetadata: {},
        };
        documents.set(document.id, cloneDocument(document));
        if (providerKey) providerKeys.set(providerKey, document.id);
      }

      const history = revisions.get(document.id) ?? [];
      if (history.length >= maxRevisionsPerDocument) {
        throw new LogicalDocumentValidationError(
          `Logical document maxRevisionsPerDocument=${maxRevisionsPerDocument} exceeded`,
        );
      }
      const revision: DocumentRevision = {
        contentHash: input.contentHash,
        createdAt: input.now,
        documentAssetId: input.documentAssetId,
        documentAssetVersion: input.documentAssetVersion,
        documentId: document.id,
        expectedActiveRevision: document.activeRevision ?? null,
        expectedDocumentRowVersion: document.rowVersion,
        knowledgeSpaceId: input.knowledgeSpaceId,
        mimeType: input.mimeType,
        revision: (history.at(-1)?.revision ?? 0) + 1,
        sizeBytes: input.sizeBytes,
        state: "candidate",
        systemMetadata: cloneJsonObject(input.systemMetadata),
        tenantId: input.tenantId,
      };
      revisions.set(document.id, [...history, cloneRevision(revision)]);
      if (input.rollbackOfRevision === undefined) {
        assetKeys.set(assetKey, { documentId: document.id, revision: revision.revision });
      }
      return { document: cloneDocument(document), revision: cloneRevision(revision) };
    },
    activateRevision: activate,
    failCandidate: async (input) => {
      const document = getScoped(input);
      const history = revisions.get(document.id) ?? [];
      const target = history.find((revision) => revision.revision === input.revision);
      if (!target || target.state !== "candidate") {
        throw new LogicalDocumentValidationError("Target document revision is not a candidate");
      }
      const failed = { ...target, state: "failed" as const };
      revisions.set(
        document.id,
        history.map((revision) =>
          revision.revision === failed.revision ? cloneRevision(failed) : revision,
        ),
      );
      if (document.activeRevision === undefined) {
        documents.set(
          document.id,
          cloneDocument({ ...document, status: "failed", updatedAt: input.now }),
        );
      }
      return cloneRevision(failed);
    },
    discardUnboundCandidate: async (input) => {
      const document = getScoped(input);
      const history = revisions.get(document.id) ?? [];
      const target = history.find((revision) => revision.revision === input.revision);
      if (
        !target ||
        target.documentAssetId !== input.documentAssetId ||
        target.documentAssetVersion !== input.documentAssetVersion ||
        target.compilationAttemptId !== undefined ||
        !["candidate", "failed"].includes(target.state) ||
        document.activeRevision === target.revision
      ) {
        return false;
      }
      const remaining = history.filter((revision) => revision.revision !== target.revision);
      assetKeys.delete(
        scopedAssetKey({
          documentAssetId: target.documentAssetId,
          documentAssetVersion: target.documentAssetVersion,
          knowledgeSpaceId: target.knowledgeSpaceId,
          tenantId: target.tenantId,
        }),
      );
      if (remaining.length === 0 && document.activeRevision === undefined) {
        documents.delete(document.id);
        revisions.delete(document.id);
        const providerKey = sourceProviderKey(document);
        if (providerKey && providerKeys.get(providerKey) === document.id) {
          providerKeys.delete(providerKey);
        }
      } else {
        revisions.set(document.id, remaining.map(cloneRevision));
      }
      return true;
    },
    get: async (input) => {
      try {
        const document = getScoped(input);
        return withActive(document, revisions.get(document.id) ?? []);
      } catch (error) {
        if (error instanceof LogicalDocumentNotFoundError) return null;
        throw error;
      }
    },
    getRevision: async (input) => {
      try {
        const document = getScoped(input);
        const revision = revisions
          .get(document.id)
          ?.find((candidate) => candidate.revision === input.revision);
        return revision ? cloneRevision(revision) : null;
      } catch (error) {
        if (error instanceof LogicalDocumentNotFoundError) return null;
        throw error;
      }
    },
    isAssetReferenced: async (input) => {
      for (const history of revisions.values()) {
        if (
          history.some(
            (revision) =>
              revision.tenantId === input.tenantId &&
              revision.knowledgeSpaceId === input.knowledgeSpaceId &&
              revision.documentAssetId === input.documentAssetId &&
              revision.documentAssetVersion === input.documentAssetVersion,
          )
        ) {
          return true;
        }
      }
      return false;
    },
    isFailedSourceRevisionCleanupEligible: async (input) => {
      const document = documents.get(input.documentId);
      if (
        !document ||
        document.tenantId !== input.tenantId ||
        document.knowledgeSpaceId !== input.knowledgeSpaceId ||
        document.sourceId !== input.sourceId ||
        document.activeRevision === input.revision
      ) {
        return false;
      }
      const references = [...revisions.values()]
        .flat()
        .filter(
          (revision) =>
            revision.tenantId === input.tenantId &&
            revision.knowledgeSpaceId === input.knowledgeSpaceId &&
            revision.documentAssetId === input.documentAssetId,
        );
      const target = references.find(
        (revision) =>
          revision.documentId === input.documentId && revision.revision === input.revision,
      );
      return Boolean(
        references.length === 1 &&
          target?.state === "failed" &&
          target.documentAssetVersion === input.documentAssetVersion &&
          target.compilationAttemptId &&
          sourceWorkflowOwnershipMatches(
            target.systemMetadata[SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY],
            input.ownership,
          ),
      );
    },
    list: async (input) => {
      validateListLimit(input.limit);
      const matching: LogicalDocument[] = [];
      for (const document of [...documents.values()]
        .filter(
          (document) =>
            document.tenantId === input.tenantId &&
            document.knowledgeSpaceId === input.knowledgeSpaceId &&
            (!input.cursor || compareDocumentCursor(document, input.cursor) > 0),
        )
        .sort(compareDocuments)) {
        if (
          await canReadDocument({
            candidateGrants: input.candidateGrants,
            document: withActive(document, revisions.get(document.id) ?? []),
          })
        ) {
          matching.push(document);
        }
        if (matching.length === input.limit + 1) break;
      }
      const items = matching
        .slice(0, input.limit)
        .map((document) => withActive(document, revisions.get(document.id) ?? []));
      const last = items.at(-1);
      return {
        items,
        ...(matching.length > input.limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
    listRevisions: async (input) => {
      validateListLimit(input.limit);
      const document = getScoped(input);
      const matching: DocumentRevision[] = [];
      for (const revision of (revisions.get(document.id) ?? [])
        .filter((revision) => !input.cursor || revision.revision < input.cursor.revision)
        .sort((left, right) => right.revision - left.revision)) {
        if (await canReadRevision({ candidateGrants: input.candidateGrants, revision })) {
          matching.push(revision);
        }
        if (matching.length === input.limit + 1) break;
      }
      const items = matching.slice(0, input.limit).map(cloneRevision);
      const last = items.at(-1);
      return {
        items,
        ...(matching.length > input.limit && last
          ? { nextCursor: { revision: last.revision } }
          : {}),
      };
    },
    listActiveBySource: async (input) => {
      validateListLimit(input.limit);
      const matching = [...documents.values()]
        .filter(
          (document) =>
            document.tenantId === input.tenantId &&
            document.knowledgeSpaceId === input.knowledgeSpaceId &&
            document.sourceId === input.sourceId &&
            document.providerItemId !== undefined &&
            document.activeRevision !== undefined &&
            (!input.cursor ||
              document.providerItemId > input.cursor.providerItemId ||
              (document.providerItemId === input.cursor.providerItemId &&
                document.id > input.cursor.documentId)),
        )
        .sort(
          (left, right) =>
            (left.providerItemId ?? "").localeCompare(right.providerItemId ?? "") ||
            left.id.localeCompare(right.id),
        )
        .slice(0, input.limit + 1);
      const items = matching.slice(0, input.limit).map((document) => {
        const active = (revisions.get(document.id) ?? []).find(
          (revision) =>
            revision.revision === document.activeRevision && revision.state === "active",
        );
        if (!active || !document.providerItemId) {
          throw new LogicalDocumentValidationError(
            "Source logical document active revision is corrupt",
          );
        }
        const etag =
          typeof active.systemMetadata.etag === "string" ? active.systemMetadata.etag : undefined;
        return {
          contentHash: active.contentHash,
          documentId: document.id,
          ...(etag ? { etag } : {}),
          providerItemId: document.providerItemId,
          revision: active.revision,
          rowVersion: document.rowVersion,
          systemMetadata: cloneJsonObject(active.systemMetadata),
        };
      });
      const last = items.at(-1);
      return {
        items,
        ...(matching.length > input.limit && last
          ? { nextCursor: { documentId: last.documentId, providerItemId: last.providerItemId } }
          : {}),
      };
    },
    patchUserMetadata: async (input) => {
      if (!input.permissionSnapshot || !input.requestedBySubjectId) {
        throw new LogicalDocumentNotFoundError("Logical document not found");
      }
      const document = getScoped(input);
      if (document.rowVersion !== input.expectedRowVersion) {
        throw new LogicalDocumentConflictError(
          document.activeRevision ?? null,
          document.activeRevision ?? null,
          input.expectedRowVersion,
          document.rowVersion,
        );
      }
      const updated: LogicalDocument = {
        ...document,
        rowVersion: document.rowVersion + 1,
        updatedAt: input.now,
        userMetadata: applyUserMetadataPatch(document.userMetadata, input.patch),
      };
      documents.set(document.id, cloneDocument(updated));
      return cloneDocument(updated);
    },
  };
}

export function createInMemoryDocumentRevisionPublicationFenceResolver(
  documents: LogicalDocumentRepository,
  lookup: (
    input: LogicalDocumentScope & {
      readonly attemptId: string;
      readonly documentAssetId: string;
      readonly documentAssetVersion: number;
    },
  ) => Promise<{ readonly documentId: string; readonly revision: number } | null>,
): DocumentRevisionPublicationFenceResolver {
  return {
    resolve: async (input) => {
      const identity = await lookup(input);
      if (!identity) return null;
      const revision = await documents.getRevision({ ...input, ...identity });
      if (
        !revision ||
        revision.state !== "candidate" ||
        revision.compilationAttemptId !== input.attemptId
      ) {
        return null;
      }
      return {
        documentId: revision.documentId,
        expectedActiveRevision: revision.expectedActiveRevision,
        expectedDocumentRowVersion: revision.expectedDocumentRowVersion,
        revision: revision.revision,
      };
    },
  };
}

export function createDatabaseDocumentRevisionPublicationFenceResolver(
  database: DatabaseAdapter,
): DocumentRevisionPublicationFenceResolver {
  return {
    resolve: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [
          input.tenantId,
          input.knowledgeSpaceId,
          input.attemptId,
          input.documentAssetId,
          input.documentAssetVersion,
        ],
        sql: `SELECT ${["document_id", "revision", "expected_active_revision", "expected_document_row_version"].map((column) => q(database, column)).join(", ")} FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "compilation_attempt_id")} = ${p(database, 3)} AND ${q(database, "document_asset_id")} = ${p(database, 4)} AND ${q(database, "document_asset_version")} = ${p(database, 5)} AND ${q(database, "state")} = 'candidate' LIMIT 1;`,
        tableName: "document_revisions",
      });
      const row = result.rows[0];
      return row
        ? {
            documentId: stringColumn(row, "document_id"),
            expectedActiveRevision: optionalNumberColumn(row, "expected_active_revision") ?? null,
            expectedDocumentRowVersion: numberColumn(row, "expected_document_row_version"),
            revision: numberColumn(row, "revision"),
          }
        : null;
    },
  };
}

export interface DatabaseLogicalDocumentRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateDocumentId?: (() => string) | undefined;
  readonly maxListLimit: number;
}

export function createDatabaseLogicalDocumentRepository({
  database,
  generateDocumentId = randomUUID,
  maxListLimit,
}: DatabaseLogicalDocumentRepositoryOptions): LogicalDocumentRepository {
  positiveLimit(maxListLimit, "maxListLimit");

  const readDocument = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup,
    forUpdate = false,
  ): Promise<LogicalDocument | null> => {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.documentId],
      sql: `SELECT * FROM ${q(database, "logical_documents")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)}${forUpdate ? " FOR UPDATE" : ""};`,
      tableName: "logical_documents",
    });
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  };

  const readRevision = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup & { readonly revision: number },
    forUpdate = false,
  ): Promise<DocumentRevision | null> => {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.documentId, input.revision],
      sql: `SELECT * FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)}${forUpdate ? " FOR UPDATE" : ""};`,
      tableName: "document_revisions",
    });
    return result.rows[0] ? mapRevision(result.rows[0]) : null;
  };

  const getWithActive = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup,
  ): Promise<LogicalDocumentWithActiveRevision | null> => {
    const document = await readDocument(executor, input);
    if (!document) return null;
    const active =
      document.activeRevision === undefined
        ? null
        : await readRevision(executor, { ...input, revision: document.activeRevision });
    if (document.activeRevision !== undefined && (!active || active.state !== "active")) {
      throw new LogicalDocumentValidationError("Logical document active revision is corrupt");
    }
    return { ...document, active };
  };

  const activate = (
    input: ActivateDocumentRevisionInput,
  ): Promise<LogicalDocumentWithActiveRevision> =>
    database.transaction(async (transaction) => {
      await requireWritableSpace(database, transaction, input);
      const document = await readDocument(transaction, input, true);
      if (!document) throw new LogicalDocumentNotFoundError("Logical document not found");
      assertDocumentCas(document, input);
      const target = await readRevision(transaction, input, true);
      if (!target || target.state !== "candidate") {
        throw new LogicalDocumentValidationError("Target document revision is not activatable");
      }

      if (document.activeRevision !== undefined) {
        const superseded = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            document.activeRevision,
          ],
          sql: `UPDATE ${q(database, "document_revisions")} SET ${q(database, "state")} = 'superseded' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "state")} = 'active';`,
          tableName: "document_revisions",
        });
        if (superseded.rowsAffected !== 1) {
          throw new LogicalDocumentValidationError("Active document revision is corrupt");
        }
      }

      const activated = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [
          input.now,
          input.tenantId,
          input.knowledgeSpaceId,
          input.documentId,
          input.revision,
          target.state,
        ],
        sql: `UPDATE ${q(database, "document_revisions")} SET ${q(database, "state")} = 'active', ${q(database, "activated_at")} = ${p(database, 1)} WHERE ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "document_id")} = ${p(database, 4)} AND ${q(database, "revision")} = ${p(database, 5)} AND ${q(database, "state")} = ${p(database, 6)};`,
        tableName: "document_revisions",
      });
      if (activated.rowsAffected !== 1) {
        throw new LogicalDocumentConflictError(
          input.expectedActiveRevision,
          document.activeRevision ?? null,
          input.expectedRowVersion,
          document.rowVersion,
        );
      }

      const moved = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [
          input.revision,
          input.now,
          input.tenantId,
          input.knowledgeSpaceId,
          input.documentId,
          input.expectedRowVersion,
        ],
        sql: `UPDATE ${q(database, "logical_documents")} SET ${q(database, "active_revision")} = ${p(database, 1)}, ${q(database, "status")} = 'ready', ${q(database, "row_version")} = ${q(database, "row_version")} + 1, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "tenant_id")} = ${p(database, 3)} AND ${q(database, "knowledge_space_id")} = ${p(database, 4)} AND ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)};`,
        tableName: "logical_documents",
      });
      if (moved.rowsAffected !== 1) {
        throw new LogicalDocumentConflictError(
          input.expectedActiveRevision,
          document.activeRevision ?? null,
          input.expectedRowVersion,
          document.rowVersion,
        );
      }
      const result = await getWithActive(transaction, input);
      if (!result) throw new LogicalDocumentNotFoundError("Logical document not found");
      await appendKnowledgeSpaceActivityWithExecutor({
        database,
        executor: transaction,
        input: {
          action: "document.published",
          actor: { type: "system" },
          details: { documentType: target.mimeType },
          id: deterministicKnowledgeSpaceActivityId(
            "document.published",
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            String(input.revision),
          ),
          knowledgeSpaceId: input.knowledgeSpaceId,
          occurredAt: input.now,
          requiredPermissionScope: await documentRevisionPermissionScope(
            database,
            transaction,
            target,
          ),
          resource: { id: input.documentId, type: "document" },
          result: "success",
          tenantId: input.tenantId,
        },
      });
      return result;
    });

  return {
    bindCompilationAttempt: (input) =>
      database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const target = await readRevision(transaction, input, true);
        if (!target || target.state !== "candidate") {
          throw new LogicalDocumentValidationError("Target document revision is not a candidate");
        }
        if (
          target.compilationAttemptId !== undefined &&
          target.compilationAttemptId !== input.attemptId
        ) {
          throw new LogicalDocumentValidationError(
            "Document revision is bound to another compilation attempt",
          );
        }
        const attempt = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [
            input.attemptId,
            input.tenantId,
            input.knowledgeSpaceId,
            target.documentAssetId,
            target.documentAssetVersion,
          ],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, "document_compilation_attempts")} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "document_asset_id")} = ${p(database, 4)} AND ${q(database, "document_version")} = ${p(database, 5)} AND ${q(database, "active_slot")} = 1 AND ${q(database, "run_state")} IN ('dispatch_pending', 'queued', 'running', 'retry_wait') FOR UPDATE;`,
          tableName: "document_compilation_attempts",
        });
        if (!attempt.rows[0]) {
          throw new LogicalDocumentValidationError(
            "Compilation attempt does not own the document revision asset",
          );
        }
        if (target.compilationAttemptId === input.attemptId) return target;
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.attemptId,
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            input.revision,
          ],
          sql: `UPDATE ${q(database, "document_revisions")} SET ${q(database, "compilation_attempt_id")} = ${p(database, 1)} WHERE ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "document_id")} = ${p(database, 4)} AND ${q(database, "revision")} = ${p(database, 5)} AND ${q(database, "state")} = 'candidate' AND ${q(database, "compilation_attempt_id")} IS NULL;`,
          tableName: "document_revisions",
        });
        if (updated.rowsAffected !== 1) {
          throw new LogicalDocumentValidationError(
            "Document revision compilation binding lost its compare-and-set",
          );
        }
        const bound = await readRevision(transaction, input, true);
        if (!bound) throw new LogicalDocumentValidationError("Document revision disappeared");
        return bound;
      }),
    createCandidateRevision: async (rawInput) => {
      const input = normalizeCreateRevision(rawInput);
      return database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const candidateAsset = await requireAsset(database, transaction, input);
        await requireCandidateAssetSource(database, transaction, input, candidateAsset);
        const unscopedPermission = input.documentId
          ? undefined
          : await authorizeUnscopedCandidateAdmission({
              candidateAsset,
              database,
              input,
              transaction,
            });
        const byAsset =
          input.rollbackOfRevision === undefined
            ? await transaction.execute({
                maxRows: 1,
                operation: "select",
                params: [
                  input.tenantId,
                  input.knowledgeSpaceId,
                  input.documentAssetId,
                  input.documentAssetVersion,
                ],
                sql: `SELECT * FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_asset_id")} = ${p(database, 3)} AND ${q(database, "document_asset_version")} = ${p(database, 4)} FOR UPDATE;`,
                tableName: "document_revisions",
              })
            : { rows: [] };
        if (byAsset.rows[0]) {
          const revision = mapRevision(byAsset.rows[0]);
          if (revision.contentHash !== input.contentHash) {
            throw new LogicalDocumentValidationError(
              "Document asset retry changed immutable content",
            );
          }
          const document = await readDocument(
            transaction,
            { ...input, documentId: revision.documentId },
            true,
          );
          if (!document) throw new LogicalDocumentValidationError("Revision parent is missing");
          if (input.documentId && input.documentId !== document.id) {
            throw new LogicalDocumentValidationError(
              "Document asset is already bound to another logical document",
            );
          }
          if (input.documentId) {
            await authorizeExplicitDocumentAppend({
              candidateAsset,
              database,
              document,
              inheritActivePermissionScope: input.rollbackOfRevision === undefined,
              input,
              transaction,
            });
            // Conceal an inaccessible target before comparing caller-supplied CAS values. Returning
            // the conflict first would disclose the target's active revision and row version.
            assertCreateRevisionCas(document, input);
          } else if (input.sourceId && input.providerItemId) {
            await authorizeProviderDocumentAppend({
              database,
              documentId: document.id,
              input,
              permission: unscopedPermission ?? null,
              transaction,
            });
          }
          return { document, revision };
        }

        let document = input.documentId
          ? await readDocument(transaction, { ...input, documentId: input.documentId }, true)
          : null;
        let existingProviderDocument = false;
        if (!document && input.documentId) {
          throw new LogicalDocumentNotFoundError("Logical document not found");
        }
        if (!document && input.sourceId && input.providerItemId) {
          const providerItemDigest = providerItemIdentityDigest({
            knowledgeSpaceId: input.knowledgeSpaceId,
            providerItemId: input.providerItemId,
            sourceId: input.sourceId,
            tenantId: input.tenantId,
          });
          const existing = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [providerItemDigest],
            sql: `SELECT * FROM ${q(database, "logical_documents")} WHERE ${q(database, "provider_item_digest")} = ${p(database, 1)} FOR UPDATE;`,
            tableName: "logical_documents",
          });
          if (existing.rows[0]) {
            const replay = mapDocument(existing.rows[0]);
            if (
              replay.tenantId !== input.tenantId ||
              replay.knowledgeSpaceId !== input.knowledgeSpaceId ||
              replay.sourceId !== input.sourceId ||
              replay.providerItemId !== input.providerItemId
            ) {
              throw new LogicalDocumentValidationError(
                "Provider item identity digest collided with another logical document",
              );
            }
            document = replay;
            existingProviderDocument = true;
          }
        }
        if (!document) {
          const id = input.documentId ?? generateDocumentId();
          const providerItemDigest =
            input.sourceId && input.providerItemId
              ? providerItemIdentityDigest({
                  knowledgeSpaceId: input.knowledgeSpaceId,
                  providerItemId: input.providerItemId,
                  sourceId: input.sourceId,
                  tenantId: input.tenantId,
                })
              : null;
          await transaction.execute({
            maxRows: 0,
            operation: "insert",
            params: [
              id,
              input.tenantId,
              input.knowledgeSpaceId,
              input.sourceId ?? null,
              input.providerItemId ?? null,
              providerItemDigest,
              input.title,
              JSON.stringify(cloneJsonObject(input.systemMetadata)),
              JSON.stringify({}),
              input.now,
              input.now,
            ],
            sql: `INSERT INTO ${q(database, "logical_documents")} (${["id", "tenant_id", "knowledge_space_id", "source_id", "provider_item_id", "provider_item_digest", "title", "status", "active_revision", "row_version", "system_metadata", "user_metadata", "created_at", "updated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, ${p(database, 7)}, 'pending', NULL, 0, ${jsonP(database, 8)}, ${jsonP(database, 9)}, ${p(database, 10)}, ${p(database, 11)});`,
            tableName: "logical_documents",
          });
          document = await readDocument(transaction, { ...input, documentId: id }, true);
          if (!document) throw new LogicalDocumentValidationError("Logical document insert failed");
        }
        if (
          document.tenantId !== input.tenantId ||
          document.knowledgeSpaceId !== input.knowledgeSpaceId
        ) {
          throw new LogicalDocumentValidationError("Logical document scope mismatch");
        }
        if (input.documentId) {
          await authorizeExplicitDocumentAppend({
            candidateAsset,
            database,
            document,
            inheritActivePermissionScope: input.rollbackOfRevision === undefined,
            input,
            transaction,
          });
        } else if (input.sourceId && input.providerItemId && existingProviderDocument) {
          await authorizeProviderDocumentAppend({
            database,
            documentId: document.id,
            input,
            permission: unscopedPermission ?? null,
            transaction,
          });
        }
        assertCreateRevisionCas(document, input);

        const maxRow = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, document.id],
          sql: `SELECT COALESCE(MAX(${q(database, "revision")}), 0) AS ${q(database, "max_revision")} FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)};`,
          tableName: "document_revisions",
        });
        const revisionNumber = numberColumn(maxRow.rows[0] ?? {}, "max_revision") + 1;
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            document.id,
            revisionNumber,
            input.documentAssetId,
            input.documentAssetVersion,
            document.activeRevision ?? null,
            document.rowVersion,
            input.contentHash,
            input.mimeType,
            input.sizeBytes,
            JSON.stringify(cloneJsonObject(input.systemMetadata)),
            input.now,
          ],
          sql: `INSERT INTO ${q(database, "document_revisions")} (${["tenant_id", "knowledge_space_id", "document_id", "revision", "document_asset_id", "document_asset_version", "expected_active_revision", "expected_document_row_version", "content_hash", "mime_type", "size_bytes", "state", "system_metadata", "created_at", "activated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, ${p(database, 7)}, ${p(database, 8)}, ${p(database, 9)}, ${p(database, 10)}, ${p(database, 11)}, 'candidate', ${jsonP(database, 12)}, ${p(database, 13)}, NULL);`,
          tableName: "document_revisions",
        });
        const revision = await readRevision(
          transaction,
          { ...input, documentId: document.id, revision: revisionNumber },
          true,
        );
        if (!revision) throw new LogicalDocumentValidationError("Document revision insert failed");
        return { document, revision };
      });
    },
    activateRevision: activate,
    failCandidate: (input) =>
      database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const document = await readDocument(transaction, input, true);
        if (!document) throw new LogicalDocumentNotFoundError("Logical document not found");
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.tenantId, input.knowledgeSpaceId, input.documentId, input.revision],
          sql: `UPDATE ${q(database, "document_revisions")} SET ${q(database, "state")} = 'failed' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "state")} = 'candidate';`,
          tableName: "document_revisions",
        });
        if (updated.rowsAffected !== 1) {
          throw new LogicalDocumentValidationError("Target document revision is not a candidate");
        }
        if (document.activeRevision === undefined) {
          await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [input.now, input.tenantId, input.knowledgeSpaceId, input.documentId],
            sql: `UPDATE ${q(database, "logical_documents")} SET ${q(database, "status")} = 'failed', ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "id")} = ${p(database, 4)};`,
            tableName: "logical_documents",
          });
        }
        const revision = await readRevision(transaction, input);
        if (!revision) throw new LogicalDocumentValidationError("Document revision disappeared");
        await appendKnowledgeSpaceActivityWithExecutor({
          database,
          executor: transaction,
          input: {
            action: "document.failed",
            actor: { type: "system" },
            details: { documentType: revision.mimeType },
            id: deterministicKnowledgeSpaceActivityId(
              "document.failed",
              input.tenantId,
              input.knowledgeSpaceId,
              input.documentId,
              String(input.revision),
            ),
            knowledgeSpaceId: input.knowledgeSpaceId,
            occurredAt: input.now,
            requiredPermissionScope: await documentRevisionPermissionScope(
              database,
              transaction,
              revision,
            ),
            resource: { id: input.documentId, type: "document" },
            result: "failure",
            tenantId: input.tenantId,
          },
        });
        return revision;
      }),
    discardUnboundCandidate: (input) =>
      database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const document = await readDocument(transaction, input, true);
        if (!document) return false;
        const revision = await readRevision(transaction, input, true);
        if (
          !revision ||
          revision.documentAssetId !== input.documentAssetId ||
          revision.documentAssetVersion !== input.documentAssetVersion ||
          revision.compilationAttemptId !== undefined ||
          !["candidate", "failed"].includes(revision.state) ||
          document.activeRevision === revision.revision
        ) {
          return false;
        }
        const removed = await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            input.revision,
            input.documentAssetId,
            input.documentAssetVersion,
          ],
          sql: `DELETE FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "document_asset_id")} = ${p(database, 5)} AND ${q(database, "document_asset_version")} = ${p(database, 6)} AND ${q(database, "state")} IN ('candidate', 'failed') AND ${q(database, "compilation_attempt_id")} IS NULL;`,
          tableName: "document_revisions",
        });
        if (removed.rowsAffected !== 1) return false;
        if (document.activeRevision === undefined) {
          const remaining = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [input.tenantId, input.knowledgeSpaceId, input.documentId],
            sql: `SELECT 1 AS ${q(database, "present")} FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} LIMIT 1;`,
            tableName: "document_revisions",
          });
          if (remaining.rows.length === 0) {
            await transaction.execute({
              maxRows: 0,
              operation: "delete",
              params: [input.tenantId, input.knowledgeSpaceId, input.documentId],
              sql: `DELETE FROM ${q(database, "logical_documents")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "active_revision")} IS NULL;`,
              tableName: "logical_documents",
            });
          }
        }
        return true;
      }),
    get: (input) => getWithActive(database, input),
    getRevision: (input) => readRevision(database, input),
    isAssetReferenced: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [
          input.tenantId,
          input.knowledgeSpaceId,
          input.documentAssetId,
          input.documentAssetVersion,
        ],
        sql: `SELECT 1 AS ${q(database, "present")} FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_asset_id")} = ${p(database, 3)} AND ${q(database, "document_asset_version")} = ${p(database, 4)} LIMIT 1;`,
        tableName: "document_revisions",
      });
      return result.rows.length > 0;
    },
    isFailedSourceRevisionCleanupEligible: (input) =>
      database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const document = await readDocument(transaction, input, true);
        if (
          !document ||
          document.sourceId !== input.sourceId ||
          document.activeRevision === input.revision
        ) {
          return false;
        }
        const target = await readRevision(transaction, input, true);
        if (
          !target ||
          target.state !== "failed" ||
          !target.compilationAttemptId ||
          target.documentAssetId !== input.documentAssetId ||
          target.documentAssetVersion !== input.documentAssetVersion ||
          !sourceWorkflowOwnershipMatches(
            target.systemMetadata[SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY],
            input.ownership,
          )
        ) {
          return false;
        }
        const references = await transaction.execute({
          maxRows: 2,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, input.documentAssetId],
          sql: `SELECT ${q(database, "document_id")}, ${q(database, "revision")}, ${q(database, "document_asset_version")} FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_asset_id")} = ${p(database, 3)} LIMIT 2 FOR UPDATE;`,
          tableName: "document_revisions",
        });
        return (
          references.rows.length === 1 &&
          stringColumn(references.rows[0] ?? {}, "document_id") === input.documentId &&
          numberColumn(references.rows[0] ?? {}, "revision") === input.revision &&
          numberColumn(references.rows[0] ?? {}, "document_asset_version") ===
            input.documentAssetVersion
        );
      }),
    list: async (input) => {
      validateListLimit(input.limit, maxListLimit);
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.knowledgeSpaceId,
        JSON.stringify(input.candidateGrants),
      ];
      let cursorSql = "";
      if (input.cursor) {
        params.push(input.cursor.createdAt, input.cursor.id);
        const createdAt = p(database, params.length - 1);
        const id = p(database, params.length);
        cursorSql = ` AND (document.${q(database, "created_at")} > ${createdAt} OR (document.${q(database, "created_at")} = ${createdAt} AND document.${q(database, "id")} > ${id}))`;
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT document.* FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND ((document.${q(database, "active_revision")} IS NOT NULL AND revision.${q(database, "revision")} = document.${q(database, "active_revision")} AND revision.${q(database, "state")} = 'active') OR (document.${q(database, "active_revision")} IS NULL AND revision.${q(database, "revision")} = (SELECT MAX(anchor_revision.${q(database, "revision")}) FROM ${q(database, "document_revisions")} anchor_revision WHERE anchor_revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND anchor_revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND anchor_revision.${q(database, "document_id")} = document.${q(database, "id")}) AND revision.${q(database, "state")} IN ('candidate', 'failed'))) JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE document.${q(database, "tenant_id")} = ${p(database, 1)} AND document.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${readableDocumentAssetPredicateSql(database, "asset", "document_list_parent_source")} AND ${assetPermissionSql(database, "asset", p(database, 3))}${cursorSql} ORDER BY document.${q(database, "created_at")} ASC, document.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: "logical_documents",
      });
      const documents = result.rows.slice(0, input.limit).map(mapDocument);
      const items = await Promise.all(
        documents.map(async (document) => {
          const active =
            document.activeRevision === undefined
              ? null
              : await readRevision(database, {
                  documentId: document.id,
                  knowledgeSpaceId: document.knowledgeSpaceId,
                  revision: document.activeRevision,
                  tenantId: document.tenantId,
                });
          if (document.activeRevision !== undefined && (!active || active.state !== "active")) {
            throw new LogicalDocumentValidationError("Logical document active revision is corrupt");
          }
          return { ...document, active };
        }),
      );
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
    listRevisions: async (input) => {
      validateListLimit(input.limit, maxListLimit);
      if (!(await readDocument(database, input)))
        throw new LogicalDocumentNotFoundError("Logical document not found");
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.knowledgeSpaceId,
        input.documentId,
        JSON.stringify(input.candidateGrants),
      ];
      const cursorSql = input.cursor
        ? ` AND revision.${q(database, "revision")} < ${p(database, 5)}`
        : "";
      if (input.cursor) params.push(input.cursor.revision);
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT revision.* FROM ${q(database, "document_revisions")} revision JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE revision.${q(database, "tenant_id")} = ${p(database, 1)} AND revision.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND revision.${q(database, "document_id")} = ${p(database, 3)} AND ${readableDocumentAssetPredicateSql(database, "asset", "revision_list_parent_source")} AND ${assetPermissionSql(database, "asset", p(database, 4))}${cursorSql} ORDER BY revision.${q(database, "revision")} DESC LIMIT ${p(database, params.length)};`,
        tableName: "document_revisions",
      });
      const items = result.rows.slice(0, input.limit).map(mapRevision);
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last
          ? { nextCursor: { revision: last.revision } }
          : {}),
      };
    },
    listActiveBySource: async (input) => {
      validateListLimit(input.limit, maxListLimit);
      const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId, input.sourceId];
      let cursorFilter = "";
      if (input.cursor) {
        params.push(input.cursor.providerItemId, input.cursor.documentId);
        cursorFilter = ` AND (document.${q(database, "provider_item_id")} > ${p(database, 4)} OR (document.${q(database, "provider_item_id")} = ${p(database, 4)} AND document.${q(database, "id")} > ${p(database, 5)}))`;
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT document.${q(database, "id")} AS ${q(database, "document_id")}, document.${q(database, "provider_item_id")}, document.${q(database, "row_version")}, revision.${q(database, "revision")}, revision.${q(database, "content_hash")}, revision.${q(database, "system_metadata")} FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND revision.${q(database, "revision")} = document.${q(database, "active_revision")} AND revision.${q(database, "state")} = 'active' WHERE document.${q(database, "tenant_id")} = ${p(database, 1)} AND document.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND document.${q(database, "source_id")} = ${p(database, 3)} AND document.${q(database, "status")} = 'ready'${cursorFilter} ORDER BY document.${q(database, "provider_item_id")} ASC, document.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: "logical_documents",
      });
      const items = result.rows.slice(0, input.limit).map((row) => {
        const systemMetadata = jsonObjectColumn(row, "system_metadata");
        const etag = typeof systemMetadata.etag === "string" ? systemMetadata.etag : undefined;
        return {
          contentHash: stringColumn(row, "content_hash"),
          documentId: stringColumn(row, "document_id"),
          ...(etag ? { etag } : {}),
          providerItemId: stringColumn(row, "provider_item_id"),
          revision: numberColumn(row, "revision"),
          rowVersion: numberColumn(row, "row_version"),
          systemMetadata,
        };
      });
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last
          ? { nextCursor: { documentId: last.documentId, providerItemId: last.providerItemId } }
          : {}),
      };
    },
    patchUserMetadata: (input) =>
      database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const document = await readDocument(transaction, input, true);
        if (!document) throw new LogicalDocumentNotFoundError("Logical document not found");
        await authorizeDocumentMetadataPatch({ database, document, input, transaction });
        if (document.rowVersion !== input.expectedRowVersion) {
          throw new LogicalDocumentConflictError(
            document.activeRevision ?? null,
            document.activeRevision ?? null,
            input.expectedRowVersion,
            document.rowVersion,
          );
        }
        const metadata = applyUserMetadataPatch(document.userMetadata, input.patch);
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            JSON.stringify(metadata),
            input.now,
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            input.expectedRowVersion,
          ],
          sql: `UPDATE ${q(database, "logical_documents")} SET ${q(database, "user_metadata")} = ${jsonP(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "tenant_id")} = ${p(database, 3)} AND ${q(database, "knowledge_space_id")} = ${p(database, 4)} AND ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)};`,
          tableName: "logical_documents",
        });
        if (result.rowsAffected !== 1) {
          throw new LogicalDocumentConflictError(
            document.activeRevision ?? null,
            document.activeRevision ?? null,
            input.expectedRowVersion,
            document.rowVersion,
          );
        }
        const updated = await readDocument(transaction, input);
        if (!updated) throw new LogicalDocumentNotFoundError("Logical document not found");
        return updated;
      }),
  };
}

async function authorizeDocumentMetadataPatch(input: {
  readonly database: DatabaseAdapter;
  readonly document: LogicalDocument;
  readonly input: PatchDocumentUserMetadataInput;
  readonly transaction: DatabaseExecutor;
}): Promise<void> {
  const { database, document, transaction } = input;
  const mutation = input.input;
  let permission: KnowledgeSpacePermissionSnapshot;
  try {
    permission = await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: transaction,
      fence: {
        accessChannel: mutation.permissionSnapshot.accessChannel,
        knowledgeSpaceId: mutation.knowledgeSpaceId,
        permissionSnapshotId: mutation.permissionSnapshot.id,
        permissionSnapshotRevision: mutation.permissionSnapshot.revision,
        requestedBySubjectId: mutation.requestedBySubjectId,
        tenantId: mutation.tenantId,
      },
      now: mutation.now,
      requiredAccess: "write",
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAccessError) {
      throw new LogicalDocumentNotFoundError("Logical document not found");
    }
    throw error;
  }

  const revisionParams: DatabaseQueryValue[] = [
    mutation.tenantId,
    mutation.knowledgeSpaceId,
    mutation.documentId,
  ];
  let revisionPredicate: string;
  let revisionOrder = "";
  if (document.activeRevision !== undefined) {
    revisionParams.push(document.activeRevision);
    revisionPredicate = `revision.${q(database, "revision")} = ${p(database, 4)} AND revision.${q(database, "state")} = 'active'`;
  } else {
    revisionPredicate = `revision.${q(database, "state")} IN ('candidate', 'failed')`;
    revisionOrder = ` ORDER BY revision.${q(database, "revision")} DESC`;
  }
  const anchor = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: revisionParams,
    sql: `SELECT asset.${q(database, "metadata")}, asset.${q(database, "source_id")} FROM ${q(database, "document_revisions")} revision JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE revision.${q(database, "tenant_id")} = ${p(database, 1)} AND revision.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND revision.${q(database, "document_id")} = ${p(database, 3)} AND ${revisionPredicate} AND asset.${q(database, "lifecycle_state")} = 'active' AND asset.${q(database, "deletion_job_id")} IS NULL${revisionOrder} LIMIT 1 FOR UPDATE;`,
    tableName: "document_revisions",
  });
  const asset = anchor.rows[0];
  if (!asset) throw new LogicalDocumentNotFoundError("Logical document not found");

  const sourceId = optionalStringColumn(asset, "source_id");
  if (sourceId) {
    const source = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [mutation.knowledgeSpaceId, sourceId],
      sql: `SELECT ${q(database, "id")} FROM ${q(database, "sources")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "status")} <> 'deleting' AND ${q(database, "deletion_job_id")} IS NULL FOR UPDATE;`,
      tableName: "sources",
    });
    if (!source.rows[0]) throw new LogicalDocumentNotFoundError("Logical document not found");
  }

  const scope = candidatePermissionScopeSnapshot(
    jsonObjectColumn(asset, "metadata").permissionScope,
  );
  if (!scope || !candidatePermissionScopeAllows(scope, permission.permissionScopes)) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
}

async function documentRevisionPermissionScope(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  revision: Pick<DocumentRevision, "documentAssetId" | "documentAssetVersion" | "knowledgeSpaceId">,
): Promise<readonly string[]> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [revision.knowledgeSpaceId, revision.documentAssetId, revision.documentAssetVersion],
    sql: `SELECT ${q(database, "metadata")} FROM ${q(database, "document_assets")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "version")} = ${p(database, 3)} LIMIT 1;`,
    tableName: "document_assets",
  });
  const row = result.rows[0];
  if (!row) throw new LogicalDocumentValidationError("Document revision asset disappeared");
  return (
    candidatePermissionScopeSnapshot(jsonObjectColumn(row, "metadata").permissionScope) ?? [
      "__deny__",
    ]
  );
}

const reservedMetadataKeys = new Set([
  "activeRevision",
  "contentHash",
  "documentAssetId",
  "documentAssetVersion",
  "mimeType",
  "provenance",
  "providerItemId",
  "sourceId",
  "systemMetadata",
  "tenantId",
]);

export function applyUserMetadataPatch(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const next = cloneJsonObject(current);
  for (const [key, value] of Object.entries(patch)) {
    if (
      reservedMetadataKeys.has(key) ||
      key === "__knowledgeFs" ||
      key.startsWith("__knowledgeFs.") ||
      key === "system" ||
      key.startsWith("system.") ||
      key === "provenance" ||
      key.startsWith("provenance.")
    ) {
      throw new LogicalDocumentValidationError(`User metadata key ${key} is reserved`);
    }
    if (value === undefined) {
      throw new LogicalDocumentValidationError(`User metadata key ${key} cannot be undefined`);
    }
    if (value === null) delete next[key];
    else next[key] = structuredClone(value);
  }
  return next;
}

function normalizeCreateRevision(input: CreateDocumentRevisionInput): CreateDocumentRevisionInput {
  if (!/^[0-9a-f]{64}$/u.test(input.contentHash)) {
    throw new LogicalDocumentValidationError("Document contentHash must be lowercase SHA-256");
  }
  if (!Number.isSafeInteger(input.documentAssetVersion) || input.documentAssetVersion < 1) {
    throw new LogicalDocumentValidationError("Document asset version must be positive");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new LogicalDocumentValidationError("Document sizeBytes must be non-negative");
  }
  if (Boolean(input.sourceId) !== Boolean(input.providerItemId)) {
    throw new LogicalDocumentValidationError(
      "sourceId and providerItemId must be provided together",
    );
  }
  if (Boolean(input.permissionSnapshot) !== Boolean(input.requestedBySubjectId)) {
    throw new LogicalDocumentValidationError(
      "Document mutation permission and requester must be provided together",
    );
  }
  if (input.trustedInternalAdmission && input.permissionSnapshot) {
    throw new LogicalDocumentValidationError(
      "Trusted internal document admission cannot carry caller permission",
    );
  }
  if (input.trustedInternalAdmission && (!input.sourceId || !input.providerItemId)) {
    throw new LogicalDocumentValidationError(
      "Trusted internal document admission requires an explicit Source identity",
    );
  }
  const permissionScopes = input.permissionSnapshot?.permissionScopes
    ? candidatePermissionScopeSnapshot(input.permissionSnapshot.permissionScopes)
    : undefined;
  if (input.permissionSnapshot?.permissionScopes && !permissionScopes) {
    throw new LogicalDocumentValidationError("Document mutation permission scopes are invalid");
  }
  if (
    input.requestedBySubjectId !== undefined &&
    (!input.requestedBySubjectId.trim() ||
      input.requestedBySubjectId !== input.requestedBySubjectId.trim())
  ) {
    throw new LogicalDocumentValidationError("Document mutation requester is invalid");
  }
  if (
    input.rollbackOfRevision !== undefined &&
    (!Number.isSafeInteger(input.rollbackOfRevision) || input.rollbackOfRevision < 1)
  ) {
    throw new LogicalDocumentValidationError("rollbackOfRevision must be positive");
  }
  if (input.rollbackOfRevision !== undefined && !input.documentId) {
    throw new LogicalDocumentValidationError("Rollback revision requires an explicit documentId");
  }
  if (
    (input.expectedActiveRevision !== undefined ||
      input.expectedDocumentRowVersion !== undefined) &&
    !input.documentId
  ) {
    throw new LogicalDocumentValidationError(
      "Document revision CAS requires an explicit documentId",
    );
  }
  if (
    (input.expectedActiveRevision === undefined) !==
    (input.expectedDocumentRowVersion === undefined)
  ) {
    throw new LogicalDocumentValidationError(
      "Document revision CAS requires active revision and row version together",
    );
  }
  if (
    input.expectedActiveRevision !== undefined &&
    input.expectedActiveRevision !== null &&
    (!Number.isSafeInteger(input.expectedActiveRevision) || input.expectedActiveRevision < 1)
  ) {
    throw new LogicalDocumentValidationError("Expected active revision must be positive or null");
  }
  if (
    input.expectedDocumentRowVersion !== undefined &&
    (!Number.isSafeInteger(input.expectedDocumentRowVersion) ||
      input.expectedDocumentRowVersion < 0)
  ) {
    throw new LogicalDocumentValidationError("Expected document row version must be non-negative");
  }
  if (!input.title.trim() || !input.mimeType.trim()) {
    throw new LogicalDocumentValidationError("Document title and MIME type are required");
  }
  return {
    ...input,
    ...(input.permissionSnapshot
      ? {
          permissionSnapshot: {
            accessChannel: input.permissionSnapshot.accessChannel,
            id: input.permissionSnapshot.id,
            ...(permissionScopes ? { permissionScopes: [...permissionScopes] } : {}),
            revision: input.permissionSnapshot.revision,
          },
        }
      : {}),
    title: input.title.trim(),
  };
}

function assertCreateRevisionCas(
  document: LogicalDocument,
  input: CreateDocumentRevisionInput,
): void {
  if (input.expectedDocumentRowVersion === undefined) return;
  const expectedActiveRevision = input.expectedActiveRevision ?? null;
  if (
    (document.activeRevision ?? null) !== expectedActiveRevision ||
    document.rowVersion !== input.expectedDocumentRowVersion
  ) {
    throw new LogicalDocumentConflictError(
      expectedActiveRevision,
      document.activeRevision ?? null,
      input.expectedDocumentRowVersion,
      document.rowVersion,
    );
  }
}

function assertDocumentCas(document: LogicalDocument, input: ActivateDocumentRevisionInput): void {
  const actualActiveRevision = document.activeRevision ?? null;
  if (
    actualActiveRevision !== input.expectedActiveRevision ||
    document.rowVersion !== input.expectedRowVersion
  ) {
    throw new LogicalDocumentConflictError(
      input.expectedActiveRevision,
      actualActiveRevision,
      input.expectedRowVersion,
      document.rowVersion,
    );
  }
}

async function requireWritableSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: LogicalDocumentScope,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, input))) {
    throw new LogicalDocumentNotFoundError("Knowledge space is missing or not writable");
  }
}

async function requireAsset(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: CreateDocumentRevisionInput,
): Promise<DatabaseRow> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.knowledgeSpaceId,
      input.documentAssetId,
      input.documentAssetVersion,
      input.contentHash,
    ],
    sql: `SELECT ${q(database, "id")}, ${q(database, "metadata")}, ${q(database, "source_id")} FROM ${q(database, "document_assets")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "version")} = ${p(database, 3)} AND ${q(database, "sha256")} = ${p(database, 4)} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(database, "deletion_job_id")} IS NULL FOR UPDATE;`,
    tableName: "document_assets",
  });
  const row = result.rows[0];
  if (!row) {
    throw new LogicalDocumentValidationError("Document asset tuple does not exist or hash changed");
  }
  return row;
}

async function requireCandidateAssetSource(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: CreateDocumentRevisionInput,
  candidateAsset: DatabaseRow,
): Promise<void> {
  const assetSourceId = optionalStringColumn(candidateAsset, "source_id");
  if (input.sourceId && input.sourceId !== assetSourceId) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  if (!assetSourceId) return;

  const source = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.knowledgeSpaceId, assetSourceId],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, "sources")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "status")} <> 'deleting' AND ${q(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "sources",
  });
  if (!source.rows[0]) throw new LogicalDocumentNotFoundError("Logical document not found");
}

async function authorizeExplicitDocumentAppend(input: {
  readonly candidateAsset: DatabaseRow;
  readonly database: DatabaseAdapter;
  readonly document: LogicalDocument;
  readonly inheritActivePermissionScope: boolean;
  readonly input: CreateDocumentRevisionInput;
  readonly transaction: DatabaseExecutor;
}): Promise<void> {
  const { candidateAsset, database, document, inheritActivePermissionScope, transaction } = input;
  const mutation = input.input;
  if (!mutation.permissionSnapshot || !mutation.requestedBySubjectId) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }

  let permission: KnowledgeSpacePermissionSnapshot;
  try {
    permission = await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: transaction,
      fence: {
        accessChannel: mutation.permissionSnapshot.accessChannel,
        knowledgeSpaceId: mutation.knowledgeSpaceId,
        permissionSnapshotId: mutation.permissionSnapshot.id,
        permissionSnapshotRevision: mutation.permissionSnapshot.revision,
        requestedBySubjectId: mutation.requestedBySubjectId,
        tenantId: mutation.tenantId,
      },
      now: mutation.now,
      requiredAccess: "write",
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAccessError) {
      throw new LogicalDocumentNotFoundError("Logical document not found");
    }
    throw error;
  }
  if (
    mutation.permissionSnapshot.permissionScopes &&
    !sameStringSet(permission.permissionScopes, mutation.permissionSnapshot.permissionScopes)
  ) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }

  if (document.activeRevision === undefined || document.status !== "ready") {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  const activeDocument = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [mutation.tenantId, mutation.knowledgeSpaceId, document.id, document.activeRevision],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, "logical_documents")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "active_revision")} = ${p(database, 4)} AND ${q(database, "status")} = 'ready' AND ${q(database, "deletion_job_id")} IS NULL FOR UPDATE;`,
    tableName: "logical_documents",
  });
  if (!activeDocument.rows[0]) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }

  const targetAsset = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [mutation.tenantId, mutation.knowledgeSpaceId, document.id, document.activeRevision],
    sql: `SELECT asset.${q(database, "metadata")}, asset.${q(database, "source_id")} FROM ${q(database, "document_revisions")} revision JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE revision.${q(database, "tenant_id")} = ${p(database, 1)} AND revision.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND revision.${q(database, "document_id")} = ${p(database, 3)} AND revision.${q(database, "revision")} = ${p(database, 4)} AND revision.${q(database, "state")} = 'active' AND asset.${q(database, "lifecycle_state")} = 'active' AND asset.${q(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "document_revisions",
  });
  const targetAssetRow = targetAsset.rows[0];
  if (!targetAssetRow) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  const targetSourceId = optionalStringColumn(targetAssetRow, "source_id");
  if (targetSourceId) {
    const source = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [mutation.knowledgeSpaceId, targetSourceId],
      sql: `SELECT ${q(database, "id")} FROM ${q(database, "sources")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "status")} <> 'deleting' AND ${q(database, "deletion_job_id")} IS NULL FOR UPDATE;`,
      tableName: "sources",
    });
    if (!source.rows[0]) {
      throw new LogicalDocumentNotFoundError("Logical document not found");
    }
  }

  const targetScope = candidatePermissionScopeSnapshot(
    jsonObjectColumn(targetAssetRow, "metadata").permissionScope,
  );
  if (!targetScope || !candidatePermissionScopeAllows(targetScope, permission.permissionScopes)) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }

  if (!inheritActivePermissionScope) {
    const rollbackScope = candidatePermissionScopeSnapshot(
      jsonObjectColumn(candidateAsset, "metadata").permissionScope,
    );
    if (
      !rollbackScope ||
      !candidatePermissionScopeAllows(rollbackScope, permission.permissionScopes)
    ) {
      throw new LogicalDocumentNotFoundError("Logical document not found");
    }
    return;
  }

  const metadata = cloneJsonObject(jsonObjectColumn(candidateAsset, "metadata"));
  metadata.permissionScope = [...targetScope];
  const inherited = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [
      JSON.stringify(metadata),
      mutation.knowledgeSpaceId,
      mutation.documentAssetId,
      mutation.documentAssetVersion,
      mutation.contentHash,
    ],
    sql: `UPDATE ${q(database, "document_assets")} SET ${q(database, "metadata")} = ${jsonP(database, 1)} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "version")} = ${p(database, 4)} AND ${q(database, "sha256")} = ${p(database, 5)} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(database, "deletion_job_id")} IS NULL;`,
    tableName: "document_assets",
  });
  if (inherited.rowsAffected !== 1) {
    throw new LogicalDocumentValidationError(
      "Document asset permission scope inheritance lost its fence",
    );
  }
}

async function authorizeUnscopedCandidateAdmission(input: {
  readonly candidateAsset: DatabaseRow;
  readonly database: DatabaseAdapter;
  readonly input: CreateDocumentRevisionInput;
  readonly transaction: DatabaseExecutor;
}): Promise<KnowledgeSpacePermissionSnapshot | null> {
  const { candidateAsset, database, transaction } = input;
  const mutation = input.input;
  if (mutation.trustedInternalAdmission === true) return null;
  if (!mutation.permissionSnapshot || !mutation.requestedBySubjectId) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  let permission: KnowledgeSpacePermissionSnapshot;
  try {
    permission = await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: transaction,
      fence: {
        accessChannel: mutation.permissionSnapshot.accessChannel,
        knowledgeSpaceId: mutation.knowledgeSpaceId,
        permissionSnapshotId: mutation.permissionSnapshot.id,
        permissionSnapshotRevision: mutation.permissionSnapshot.revision,
        requestedBySubjectId: mutation.requestedBySubjectId,
        tenantId: mutation.tenantId,
      },
      now: mutation.now,
      requiredAccess: "write",
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAccessError) {
      throw new LogicalDocumentNotFoundError("Logical document not found");
    }
    throw error;
  }
  if (
    mutation.permissionSnapshot.permissionScopes &&
    !sameStringSet(permission.permissionScopes, mutation.permissionSnapshot.permissionScopes)
  ) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  const requiredScope = candidatePermissionScopeSnapshot(
    jsonObjectColumn(candidateAsset, "metadata").permissionScope,
  );
  if (
    !requiredScope ||
    !candidatePermissionScopeAllows(requiredScope, permission.permissionScopes)
  ) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  return permission;
}

async function authorizeProviderDocumentAppend(input: {
  readonly database: DatabaseAdapter;
  readonly documentId: string;
  readonly input: CreateDocumentRevisionInput;
  readonly permission: KnowledgeSpacePermissionSnapshot | null;
  readonly transaction: DatabaseExecutor;
}): Promise<void> {
  const { database, transaction } = input;
  const mutation = input.input;
  if (!mutation.sourceId || !mutation.providerItemId) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }

  const documentResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [mutation.tenantId, mutation.knowledgeSpaceId, input.documentId],
    sql: `SELECT ${q(database, "active_revision")}, ${q(database, "provider_item_id")}, ${q(database, "source_id")}, ${q(database, "status")} FROM ${q(database, "logical_documents")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "status")} <> 'deleting' AND ${q(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "logical_documents",
  });
  const document = documentResult.rows[0];
  if (
    !document ||
    optionalStringColumn(document, "source_id") !== mutation.sourceId ||
    optionalStringColumn(document, "provider_item_id") !== mutation.providerItemId
  ) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  const activeRevision = optionalNumberColumn(document, "active_revision");
  const status = stringColumn(document, "status");
  if (
    (activeRevision !== undefined && status !== "ready") ||
    (activeRevision === undefined && status === "ready")
  ) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  const params: DatabaseQueryValue[] = [
    mutation.tenantId,
    mutation.knowledgeSpaceId,
    input.documentId,
  ];
  let revisionPredicate: string;
  let revisionOrder = "";
  if (activeRevision !== undefined) {
    params.push(activeRevision);
    revisionPredicate = `revision.${q(database, "revision")} = ${p(database, 4)} AND revision.${q(database, "state")} = 'active'`;
  } else {
    revisionPredicate = `revision.${q(database, "state")} IN ('candidate', 'failed')`;
    revisionOrder = ` ORDER BY revision.${q(database, "revision")} DESC`;
  }
  const anchorResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT asset.${q(database, "metadata")}, asset.${q(database, "source_id")} FROM ${q(database, "document_revisions")} revision JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")} WHERE revision.${q(database, "tenant_id")} = ${p(database, 1)} AND revision.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND revision.${q(database, "document_id")} = ${p(database, 3)} AND ${revisionPredicate} AND asset.${q(database, "lifecycle_state")} = 'active' AND asset.${q(database, "deletion_job_id")} IS NULL${revisionOrder} LIMIT 1 FOR UPDATE;`,
    tableName: "document_revisions",
  });
  const anchor = anchorResult.rows[0];
  if (!anchor || optionalStringColumn(anchor, "source_id") !== mutation.sourceId) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
  if (mutation.trustedInternalAdmission === true) return;
  if (!input.permission) throw new LogicalDocumentNotFoundError("Logical document not found");
  const currentScope = candidatePermissionScopeSnapshot(
    jsonObjectColumn(anchor, "metadata").permissionScope,
  );
  if (
    !currentScope ||
    !candidatePermissionScopeAllows(currentScope, input.permission.permissionScopes)
  ) {
    throw new LogicalDocumentNotFoundError("Logical document not found");
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function mapDocument(row: DatabaseRow): LogicalDocument {
  const status = stringColumn(row, "status");
  if (!isDocumentStatus(status))
    throw new LogicalDocumentValidationError("Invalid document status");
  return {
    ...(optionalNumberColumn(row, "active_revision") !== undefined
      ? { activeRevision: optionalNumberColumn(row, "active_revision") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(optionalStringColumn(row, "provider_item_id")
      ? { providerItemId: optionalStringColumn(row, "provider_item_id") }
      : {}),
    rowVersion: numberColumn(row, "row_version"),
    ...(optionalStringColumn(row, "source_id")
      ? { sourceId: optionalStringColumn(row, "source_id") }
      : {}),
    status,
    systemMetadata: jsonObjectColumn(row, "system_metadata"),
    tenantId: stringColumn(row, "tenant_id"),
    title: stringColumn(row, "title"),
    updatedAt: stringColumn(row, "updated_at"),
    userMetadata: jsonObjectColumn(row, "user_metadata"),
  };
}

function mapRevision(row: DatabaseRow): DocumentRevision {
  const state = stringColumn(row, "state");
  if (!isRevisionState(state)) throw new LogicalDocumentValidationError("Invalid revision state");
  return {
    ...(optionalStringColumn(row, "activated_at")
      ? { activatedAt: optionalStringColumn(row, "activated_at") }
      : {}),
    ...(optionalStringColumn(row, "compilation_attempt_id")
      ? { compilationAttemptId: optionalStringColumn(row, "compilation_attempt_id") }
      : {}),
    contentHash: stringColumn(row, "content_hash"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    documentAssetVersion: numberColumn(row, "document_asset_version"),
    documentId: stringColumn(row, "document_id"),
    expectedActiveRevision: optionalNumberColumn(row, "expected_active_revision") ?? null,
    expectedDocumentRowVersion: numberColumn(row, "expected_document_row_version"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    mimeType: stringColumn(row, "mime_type"),
    revision: numberColumn(row, "revision"),
    sizeBytes: numberColumn(row, "size_bytes"),
    state,
    systemMetadata: jsonObjectColumn(row, "system_metadata"),
    tenantId: stringColumn(row, "tenant_id"),
  };
}

function withActive(
  document: LogicalDocument,
  history: readonly DocumentRevision[],
): LogicalDocumentWithActiveRevision {
  const active =
    document.activeRevision === undefined
      ? null
      : (history.find((revision) => revision.revision === document.activeRevision) ?? null);
  if (document.activeRevision !== undefined && (!active || active.state !== "active")) {
    throw new LogicalDocumentValidationError("Logical document active revision is corrupt");
  }
  return { ...cloneDocument(document), active: active ? cloneRevision(active) : null };
}

function cloneDocument(document: LogicalDocument): LogicalDocument {
  return {
    ...document,
    systemMetadata: cloneJsonObject(document.systemMetadata),
    userMetadata: cloneJsonObject(document.userMetadata),
  };
}

function cloneRevision(revision: DocumentRevision): DocumentRevision {
  return { ...revision, systemMetadata: cloneJsonObject(revision.systemMetadata) };
}

function scopedAssetKey(
  input: LogicalDocumentScope & {
    readonly documentAssetId: string;
    readonly documentAssetVersion: number;
  },
): string {
  return `${input.tenantId}\u0000${input.knowledgeSpaceId}\u0000${input.documentAssetId}\u0000${input.documentAssetVersion}`;
}

function sourceProviderKey(
  input: LogicalDocumentScope & {
    readonly providerItemId?: string | undefined;
    readonly sourceId?: string | undefined;
  },
): string | undefined {
  return input.sourceId && input.providerItemId
    ? `${input.tenantId}\u0000${input.knowledgeSpaceId}\u0000${input.sourceId}\u0000${input.providerItemId}`
    : undefined;
}

function providerItemIdentityDigest(input: {
  readonly knowledgeSpaceId: string;
  readonly providerItemId: string;
  readonly sourceId: string;
  readonly tenantId: string;
}): string {
  const hash = createHash("sha256");
  hash.update("v1|");
  for (const value of [
    input.tenantId,
    input.knowledgeSpaceId,
    input.sourceId,
    input.providerItemId,
  ]) {
    hash.update(`${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value, "utf8");
    hash.update("|");
  }
  return hash.digest("hex");
}

function compareDocuments(left: LogicalDocument, right: LogicalDocument): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareDocumentCursor(document: LogicalDocument, cursor: LogicalDocumentCursor): number {
  return document.createdAt.localeCompare(cursor.createdAt) || document.id.localeCompare(cursor.id);
}

function validateListLimit(limit: number, max = 100): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) {
    throw new LogicalDocumentValidationError(`Document list limit must be between 1 and ${max}`);
  }
}

function positiveLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be at least 1`);
}

function isDocumentStatus(value: string): value is LogicalDocumentStatus {
  return value === "pending" || value === "ready" || value === "failed" || value === "deleting";
}

function isRevisionState(value: string): value is DocumentRevisionState {
  return (
    value === "candidate" || value === "active" || value === "superseded" || value === "failed"
  );
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
