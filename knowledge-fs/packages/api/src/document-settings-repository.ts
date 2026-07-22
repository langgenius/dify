import { randomUUID } from "node:crypto";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import {
  DocumentCandidateAdmissionError,
  assertDatabaseDocumentCandidateAdmission,
} from "./document-candidate-admission";
import { cloneJsonObject, jsonObjectColumn } from "./json-utils";
import {
  LogicalDocumentConflictError,
  type LogicalDocumentLookup,
  LogicalDocumentNotFoundError,
  LogicalDocumentValidationError,
} from "./logical-document-repository";

import type { DatabaseAdapter, DatabaseExecutor, DatabaseRow } from "@knowledge/core";

export interface DocumentIndexSettings {
  readonly chunkOverlap: number;
  readonly chunkSize: number;
  readonly enableGraph: boolean;
  readonly enablePageIndex: boolean;
  readonly language?: string | undefined;
}

export interface DocumentSettingsRevision extends LogicalDocumentLookup {
  readonly activatedAt?: string | undefined;
  readonly createdAt: string;
  readonly createdBySubjectId: string;
  readonly revision: number;
  readonly settings: DocumentIndexSettings;
  readonly state: "candidate" | "active" | "superseded" | "failed";
}

export interface DocumentSettingsHead extends LogicalDocumentLookup {
  readonly activeRevision: number;
  readonly profile: DocumentSettingsRevision;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface DocumentReindexAttempt extends LogicalDocumentLookup {
  readonly candidateFingerprint?: string | undefined;
  readonly candidatePublicationId?: string | undefined;
  readonly compilationAttemptId?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly documentRevision: number;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly expectedSettingsHeadRevision: number;
  readonly id: string;
  readonly rowVersion: number;
  readonly settingsRevision: number;
  readonly state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  readonly updatedAt: string;
}

export interface RequestDocumentSettingsChangeInput extends LogicalDocumentLookup {
  readonly compilationAttemptId: string;
  readonly createdBySubjectId: string;
  readonly documentRevision: number;
  readonly expectedSettingsHeadRevision: number | null;
  readonly now: string;
  readonly settings: DocumentIndexSettings;
  /** Server-only admission for a compilation attempt intentionally created without caller ACLs. */
  readonly trustedInternal?: true | undefined;
}

export interface CompleteDocumentReindexInput extends LogicalDocumentLookup {
  readonly attemptId: string;
  readonly candidateFingerprint: string;
  readonly candidatePublicationId: string;
  readonly expectedAttemptRowVersion: number;
  readonly now: string;
}

export interface DocumentSettingsRepository {
  attachCompilationAttempt(
    input: LogicalDocumentLookup & {
      readonly attemptId: string;
      readonly compilationAttemptId: string;
      readonly expectedRowVersion: number;
      readonly now: string;
    },
  ): Promise<DocumentReindexAttempt>;
  cancel(
    input: LogicalDocumentLookup & {
      readonly attemptId: string;
      readonly expectedRowVersion: number;
      readonly now: string;
    },
  ): Promise<DocumentReindexAttempt>;
  complete(
    input: CompleteDocumentReindexInput,
  ): Promise<{ readonly attempt: DocumentReindexAttempt; readonly head: DocumentSettingsHead }>;
  fail(
    input: LogicalDocumentLookup & {
      readonly attemptId: string;
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly expectedRowVersion: number;
      readonly now: string;
    },
  ): Promise<DocumentReindexAttempt>;
  getAttempt(
    input: LogicalDocumentLookup & { readonly attemptId: string },
  ): Promise<DocumentReindexAttempt | null>;
  getHead(input: LogicalDocumentLookup): Promise<DocumentSettingsHead | null>;
  requestChange(input: RequestDocumentSettingsChangeInput): Promise<{
    readonly attempt: DocumentReindexAttempt;
    readonly candidate: DocumentSettingsRevision;
  }>;
  retry(
    input: LogicalDocumentLookup & {
      readonly attemptId: string;
      readonly expectedRowVersion: number;
      readonly now: string;
    },
  ): Promise<DocumentReindexAttempt>;
}

export function parseDocumentIndexSettings(value: unknown): DocumentIndexSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LogicalDocumentValidationError("Document settings must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "chunkOverlap",
    "chunkSize",
    "enableGraph",
    "enablePageIndex",
    "language",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      throw new LogicalDocumentValidationError(`Unknown document setting ${key}`);
  }
  const chunkSize = record.chunkSize;
  const chunkOverlap = record.chunkOverlap;
  if (
    !Number.isSafeInteger(chunkSize) ||
    (chunkSize as number) < 128 ||
    (chunkSize as number) > 8192
  ) {
    throw new LogicalDocumentValidationError("chunkSize must be between 128 and 8192");
  }
  if (
    !Number.isSafeInteger(chunkOverlap) ||
    (chunkOverlap as number) < 0 ||
    (chunkOverlap as number) >= (chunkSize as number)
  ) {
    throw new LogicalDocumentValidationError(
      "chunkOverlap must be non-negative and less than chunkSize",
    );
  }
  if (typeof record.enableGraph !== "boolean" || typeof record.enablePageIndex !== "boolean") {
    throw new LogicalDocumentValidationError("enableGraph and enablePageIndex must be booleans");
  }
  if (
    record.language !== undefined &&
    (typeof record.language !== "string" ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(record.language))
  ) {
    throw new LogicalDocumentValidationError("language must be a BCP-47-like tag");
  }
  return {
    chunkOverlap: chunkOverlap as number,
    chunkSize: chunkSize as number,
    enableGraph: record.enableGraph,
    enablePageIndex: record.enablePageIndex,
    ...(record.language ? { language: record.language as string } : {}),
  };
}

export function createInMemoryDocumentSettingsRepository({
  generateAttemptId = randomUUID,
  isActiveDocumentRevision = async () => true,
  maxAttempts,
}: {
  readonly generateAttemptId?: (() => string) | undefined;
  readonly isActiveDocumentRevision?:
    | ((input: LogicalDocumentLookup & { readonly revision: number }) => boolean | Promise<boolean>)
    | undefined;
  readonly maxAttempts: number;
}): DocumentSettingsRepository {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
    throw new Error("maxAttempts must be positive");
  const histories = new Map<string, DocumentSettingsRevision[]>();
  const heads = new Map<string, DocumentSettingsHead>();
  const attempts = new Map<string, DocumentReindexAttempt>();
  const key = (input: LogicalDocumentLookup) =>
    `${input.tenantId}\u0000${input.knowledgeSpaceId}\u0000${input.documentId}`;
  const requireAttempt = (
    input: LogicalDocumentLookup & { readonly attemptId: string },
  ): DocumentReindexAttempt => {
    const attempt = attempts.get(input.attemptId);
    if (!attempt || key(attempt) !== key(input)) {
      throw new LogicalDocumentNotFoundError("Document reindex attempt not found");
    }
    return attempt;
  };
  const transition = (
    input: LogicalDocumentLookup & {
      readonly attemptId: string;
      readonly expectedRowVersion: number;
    },
    allowed: readonly DocumentReindexAttempt["state"][],
    patch: Partial<DocumentReindexAttempt>,
  ): DocumentReindexAttempt => {
    const attempt = requireAttempt(input);
    if (attempt.rowVersion !== input.expectedRowVersion || !allowed.includes(attempt.state)) {
      throw new LogicalDocumentConflictError(
        null,
        null,
        input.expectedRowVersion,
        attempt.rowVersion,
      );
    }
    const updated = cloneAttempt({ ...attempt, ...patch, rowVersion: attempt.rowVersion + 1 });
    attempts.set(attempt.id, updated);
    return cloneAttempt(updated);
  };

  return {
    attachCompilationAttempt: async (input) =>
      transition(input, ["queued"], {
        compilationAttemptId: input.compilationAttemptId,
        state: "running",
        updatedAt: input.now,
      }),
    cancel: async (input) => {
      const attempt = transition(input, ["queued", "running"], {
        completedAt: input.now,
        state: "canceled",
        updatedAt: input.now,
      });
      const history = histories.get(key(input)) ?? [];
      histories.set(
        key(input),
        history.map((revision) =>
          revision.revision === attempt.settingsRevision && revision.state === "candidate"
            ? { ...revision, state: "failed" as const }
            : revision,
        ),
      );
      return attempt;
    },
    complete: async (input) => {
      const attempt = requireAttempt(input);
      if (attempt.rowVersion !== input.expectedAttemptRowVersion || attempt.state !== "running") {
        throw new LogicalDocumentConflictError(
          null,
          null,
          input.expectedAttemptRowVersion,
          attempt.rowVersion,
        );
      }
      const scopeKey = key(input);
      const head = heads.get(scopeKey);
      if ((head?.activeRevision ?? 0) !== attempt.expectedSettingsHeadRevision) {
        throw new LogicalDocumentConflictError(
          attempt.expectedSettingsHeadRevision || null,
          head?.activeRevision ?? null,
          attempt.expectedSettingsHeadRevision,
          head?.activeRevision ?? 0,
        );
      }
      const history = histories.get(scopeKey) ?? [];
      const candidate = history.find((revision) => revision.revision === attempt.settingsRevision);
      if (!candidate || candidate.state !== "candidate") {
        throw new LogicalDocumentValidationError("Settings candidate is not activatable");
      }
      const updatedHistory = history.map((revision) =>
        revision.revision === candidate.revision
          ? { ...revision, activatedAt: input.now, state: "active" as const }
          : revision.state === "active"
            ? { ...revision, state: "superseded" as const }
            : revision,
      );
      histories.set(scopeKey, updatedHistory.map(cloneSettingsRevision));
      const profile = updatedHistory.find((revision) => revision.revision === candidate.revision);
      if (!profile) throw new LogicalDocumentValidationError("Settings candidate disappeared");
      const nextHead: DocumentSettingsHead = {
        activeRevision: profile.revision,
        documentId: input.documentId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        profile: cloneSettingsRevision(profile),
        rowVersion: (head?.rowVersion ?? -1) + 1,
        tenantId: input.tenantId,
        updatedAt: input.now,
      };
      heads.set(scopeKey, cloneHead(nextHead));
      const completed = transition(
        { ...input, expectedRowVersion: input.expectedAttemptRowVersion },
        ["running"],
        {
          candidateFingerprint: input.candidateFingerprint,
          candidatePublicationId: input.candidatePublicationId,
          completedAt: input.now,
          state: "succeeded",
          updatedAt: input.now,
        },
      );
      return { attempt: completed, head: cloneHead(nextHead) };
    },
    fail: async (input) => {
      const attempt = transition(input, ["queued", "running"], {
        completedAt: input.now,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        state: "failed",
        updatedAt: input.now,
      });
      const history = histories.get(key(input)) ?? [];
      histories.set(
        key(input),
        history.map((revision) =>
          revision.revision === attempt.settingsRevision && revision.state === "candidate"
            ? { ...revision, state: "failed" as const }
            : revision,
        ),
      );
      return attempt;
    },
    getAttempt: async (input) => {
      const attempt = attempts.get(input.attemptId);
      return attempt && key(attempt) === key(input) ? cloneAttempt(attempt) : null;
    },
    getHead: async (input) => {
      const head = heads.get(key(input));
      return head ? cloneHead(head) : null;
    },
    requestChange: async (input) => {
      if (attempts.size >= maxAttempts) {
        throw new LogicalDocumentValidationError(
          `Document reindex maxAttempts=${maxAttempts} exceeded`,
        );
      }
      if (!(await isActiveDocumentRevision({ ...input, revision: input.documentRevision }))) {
        throw new LogicalDocumentValidationError("Document revision is not active");
      }
      const scopeKey = key(input);
      const head = heads.get(scopeKey);
      const actualHeadRevision = head?.activeRevision ?? null;
      if (actualHeadRevision !== input.expectedSettingsHeadRevision) {
        throw new LogicalDocumentConflictError(
          input.expectedSettingsHeadRevision,
          actualHeadRevision,
          input.expectedSettingsHeadRevision ?? 0,
          actualHeadRevision ?? 0,
        );
      }
      if (
        [...attempts.values()].some(
          (attempt) =>
            key(attempt) === scopeKey &&
            (attempt.state === "queued" || attempt.state === "running"),
        )
      ) {
        throw new LogicalDocumentValidationError("Document already has an active reindex attempt");
      }
      const history = histories.get(scopeKey) ?? [];
      const candidate: DocumentSettingsRevision = {
        createdAt: input.now,
        createdBySubjectId: input.createdBySubjectId,
        documentId: input.documentId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        revision: (history.at(-1)?.revision ?? 0) + 1,
        settings: parseDocumentIndexSettings(input.settings),
        state: "candidate",
        tenantId: input.tenantId,
      };
      histories.set(scopeKey, [...history, cloneSettingsRevision(candidate)]);
      const attempt: DocumentReindexAttempt = {
        compilationAttemptId: input.compilationAttemptId,
        createdAt: input.now,
        documentId: input.documentId,
        documentRevision: input.documentRevision,
        expectedSettingsHeadRevision: input.expectedSettingsHeadRevision ?? 0,
        id: generateAttemptId(),
        knowledgeSpaceId: input.knowledgeSpaceId,
        rowVersion: 0,
        settingsRevision: candidate.revision,
        state: "running",
        tenantId: input.tenantId,
        updatedAt: input.now,
      };
      attempts.set(attempt.id, cloneAttempt(attempt));
      return { attempt: cloneAttempt(attempt), candidate: cloneSettingsRevision(candidate) };
    },
    retry: async (input) => {
      const current = requireAttempt(input);
      const head = heads.get(key(input));
      if ((head?.activeRevision ?? 0) !== current.expectedSettingsHeadRevision) {
        throw new LogicalDocumentConflictError(
          current.expectedSettingsHeadRevision || null,
          head?.activeRevision ?? null,
          current.expectedSettingsHeadRevision,
          head?.activeRevision ?? 0,
        );
      }
      const history = histories.get(key(input)) ?? [];
      const candidate = history.find((revision) => revision.revision === current.settingsRevision);
      if (!candidate || candidate.state !== "failed") {
        throw new LogicalDocumentValidationError("Settings candidate is not retryable");
      }
      histories.set(
        key(input),
        history.map((revision) =>
          revision.revision === current.settingsRevision
            ? { ...revision, state: "candidate" as const }
            : revision,
        ),
      );
      return transition(input, ["failed", "canceled"], {
        completedAt: undefined,
        errorCode: undefined,
        errorMessage: undefined,
        state: "running",
        updatedAt: input.now,
      });
    },
  };
}

/**
 * Database settings repository. The request and completion paths lock the logical document and
 * settings head, so a successful publication can move the settings head exactly once. A failed
 * attempt marks only its candidate settings revision and leaves the previous head untouched.
 */
export function createDatabaseDocumentSettingsRepository({
  database,
  generateAttemptId = randomUUID,
}: {
  readonly database: DatabaseAdapter;
  readonly generateAttemptId?: (() => string) | undefined;
}): DocumentSettingsRepository {
  const readAttempt = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup & { readonly attemptId: string },
    forUpdate = false,
  ): Promise<DocumentReindexAttempt | null> => {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.documentId, input.attemptId],
      sql: `SELECT * FROM ${q(database, "document_reindex_attempts")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "id")} = ${p(database, 4)}${forUpdate ? " FOR UPDATE" : ""};`,
      tableName: "document_reindex_attempts",
    });
    return result.rows[0] ? mapAttempt(result.rows[0]) : null;
  };
  const readSettings = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup & { readonly revision: number },
  ): Promise<DocumentSettingsRevision | null> => {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.documentId, input.revision],
      sql: `SELECT * FROM ${q(database, "document_settings_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)};`,
      tableName: "document_settings_revisions",
    });
    return result.rows[0] ? mapSettingsRevision(result.rows[0]) : null;
  };
  const readHead = async (
    executor: DatabaseExecutor,
    input: LogicalDocumentLookup,
    forUpdate = false,
  ): Promise<DocumentSettingsHead | null> => {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.documentId],
      sql: `SELECT * FROM ${q(database, "document_settings_heads")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)}${forUpdate ? " FOR UPDATE" : ""};`,
      tableName: "document_settings_heads",
    });
    if (!result.rows[0]) return null;
    const revision = numberColumn(result.rows[0], "active_revision");
    const profile = await readSettings(executor, { ...input, revision });
    if (!profile || profile.state !== "active") {
      throw new LogicalDocumentValidationError("Document settings head is corrupt");
    }
    return {
      activeRevision: revision,
      documentId: input.documentId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      profile,
      rowVersion: numberColumn(result.rows[0], "row_version"),
      tenantId: input.tenantId,
      updatedAt: stringColumn(result.rows[0], "updated_at"),
    };
  };
  const transitionAttempt = async (
    input: LogicalDocumentLookup & {
      readonly attemptId: string;
      readonly expectedRowVersion: number;
      readonly now: string;
    },
    allowed: readonly DocumentReindexAttempt["state"][],
    next: DocumentReindexAttempt["state"],
    extras: {
      readonly compilationAttemptId?: string;
      readonly errorCode?: string;
      readonly errorMessage?: string;
    } = {},
    executor: DatabaseExecutor = database,
  ): Promise<DocumentReindexAttempt> => {
    const attempt = await readAttempt(executor, input);
    if (
      !attempt ||
      attempt.rowVersion !== input.expectedRowVersion ||
      !allowed.includes(attempt.state)
    ) {
      if (!attempt) throw new LogicalDocumentNotFoundError("Document reindex attempt not found");
      throw new LogicalDocumentConflictError(
        null,
        null,
        input.expectedRowVersion,
        attempt.rowVersion,
      );
    }
    const terminal = next === "succeeded" || next === "failed" || next === "canceled";
    const result = await executor.execute({
      maxRows: 0,
      operation: "update",
      params: [
        next,
        terminal ? null : 1,
        extras.compilationAttemptId ?? attempt.compilationAttemptId ?? null,
        extras.errorCode ?? null,
        extras.errorMessage ?? null,
        input.now,
        terminal ? input.now : null,
        input.tenantId,
        input.knowledgeSpaceId,
        input.documentId,
        input.attemptId,
        input.expectedRowVersion,
      ],
      sql: `UPDATE ${q(database, "document_reindex_attempts")} SET ${q(database, "state")} = ${p(database, 1)}, ${q(database, "active_slot")} = ${p(database, 2)}, ${q(database, "compilation_attempt_id")} = ${p(database, 3)}, ${q(database, "error_code")} = ${p(database, 4)}, ${q(database, "error_message")} = ${p(database, 5)}, ${q(database, "updated_at")} = ${p(database, 6)}, ${q(database, "completed_at")} = ${p(database, 7)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "tenant_id")} = ${p(database, 8)} AND ${q(database, "knowledge_space_id")} = ${p(database, 9)} AND ${q(database, "document_id")} = ${p(database, 10)} AND ${q(database, "id")} = ${p(database, 11)} AND ${q(database, "row_version")} = ${p(database, 12)} AND ${q(database, "state")} IN (${allowed.map((_, index) => `'${allowed[index]}'`).join(", ")});`,
      tableName: "document_reindex_attempts",
    });
    if (result.rowsAffected !== 1) {
      throw new LogicalDocumentConflictError(
        null,
        null,
        input.expectedRowVersion,
        attempt.rowVersion,
      );
    }
    const updated = await readAttempt(executor, input);
    if (!updated) throw new LogicalDocumentNotFoundError("Document reindex attempt not found");
    return updated;
  };

  return {
    attachCompilationAttempt: (input) =>
      transitionAttempt(input, ["queued"], "running", {
        compilationAttemptId: input.compilationAttemptId,
      }),
    cancel: (input) =>
      database.transaction(async (transaction) => {
        const attempt = await transitionAttempt(
          input,
          ["queued", "running"],
          "canceled",
          {},
          transaction,
        );
        const failedCandidate = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            attempt.settingsRevision,
          ],
          sql: `UPDATE ${q(database, "document_settings_revisions")} SET ${q(database, "state")} = 'failed' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "state")} = 'candidate';`,
          tableName: "document_settings_revisions",
        });
        if (failedCandidate.rowsAffected !== 1) {
          throw new LogicalDocumentValidationError("Settings candidate is not cancelable");
        }
        return attempt;
      }),
    complete: (input) =>
      database.transaction(async (transaction) => {
        const attempt = await readAttempt(transaction, input, true);
        if (
          !attempt ||
          attempt.rowVersion !== input.expectedAttemptRowVersion ||
          attempt.state !== "running"
        ) {
          if (!attempt)
            throw new LogicalDocumentNotFoundError("Document reindex attempt not found");
          throw new LogicalDocumentConflictError(
            null,
            null,
            input.expectedAttemptRowVersion,
            attempt.rowVersion,
          );
        }
        const head = await readHead(transaction, input, true);
        if ((head?.activeRevision ?? 0) !== attempt.expectedSettingsHeadRevision) {
          throw new LogicalDocumentConflictError(
            attempt.expectedSettingsHeadRevision || null,
            head?.activeRevision ?? null,
            attempt.expectedSettingsHeadRevision,
            head?.activeRevision ?? 0,
          );
        }
        const candidate = await readSettings(transaction, {
          ...input,
          revision: attempt.settingsRevision,
        });
        if (!candidate || candidate.state !== "candidate") {
          throw new LogicalDocumentValidationError("Settings candidate is not activatable");
        }
        if (head) {
          const superseded = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [input.tenantId, input.knowledgeSpaceId, input.documentId, head.activeRevision],
            sql: `UPDATE ${q(database, "document_settings_revisions")} SET ${q(database, "state")} = 'superseded' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "state")} = 'active';`,
            tableName: "document_settings_revisions",
          });
          if (superseded.rowsAffected !== 1) {
            throw new LogicalDocumentValidationError("Settings active revision CAS failed");
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
            candidate.revision,
          ],
          sql: `UPDATE ${q(database, "document_settings_revisions")} SET ${q(database, "state")} = 'active', ${q(database, "activated_at")} = ${p(database, 1)} WHERE ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "document_id")} = ${p(database, 4)} AND ${q(database, "revision")} = ${p(database, 5)} AND ${q(database, "state")} = 'candidate';`,
          tableName: "document_settings_revisions",
        });
        if (activated.rowsAffected !== 1) {
          throw new LogicalDocumentValidationError("Settings candidate activation CAS failed");
        }
        if (head) {
          const advancedHead = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [
              candidate.revision,
              input.now,
              input.tenantId,
              input.knowledgeSpaceId,
              input.documentId,
              head.rowVersion,
            ],
            sql: `UPDATE ${q(database, "document_settings_heads")} SET ${q(database, "active_revision")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "tenant_id")} = ${p(database, 3)} AND ${q(database, "knowledge_space_id")} = ${p(database, 4)} AND ${q(database, "document_id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)};`,
            tableName: "document_settings_heads",
          });
          if (advancedHead.rowsAffected !== 1) {
            throw new LogicalDocumentValidationError("Settings head CAS failed");
          }
        } else {
          await transaction.execute({
            maxRows: 0,
            operation: "insert",
            params: [
              input.tenantId,
              input.knowledgeSpaceId,
              input.documentId,
              candidate.revision,
              input.now,
            ],
            sql: `INSERT INTO ${q(database, "document_settings_heads")} (${["tenant_id", "knowledge_space_id", "document_id", "active_revision", "row_version", "updated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, 0, ${p(database, 5)});`,
            tableName: "document_settings_heads",
          });
        }
        const completed = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.candidatePublicationId,
            input.candidateFingerprint,
            input.now,
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            input.attemptId,
            input.expectedAttemptRowVersion,
          ],
          sql: `UPDATE ${q(database, "document_reindex_attempts")} SET ${q(database, "state")} = 'succeeded', ${q(database, "active_slot")} = NULL, ${q(database, "candidate_publication_id")} = ${p(database, 1)}, ${q(database, "candidate_fingerprint")} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "completed_at")} = ${p(database, 3)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(database, "knowledge_space_id")} = ${p(database, 5)} AND ${q(database, "document_id")} = ${p(database, 6)} AND ${q(database, "id")} = ${p(database, 7)} AND ${q(database, "row_version")} = ${p(database, 8)} AND ${q(database, "state")} = 'running';`,
          tableName: "document_reindex_attempts",
        });
        if (completed.rowsAffected !== 1)
          throw new LogicalDocumentValidationError("Reindex completion CAS failed");
        const [updatedAttempt, updatedHead] = await Promise.all([
          readAttempt(transaction, input),
          readHead(transaction, input),
        ]);
        if (!updatedAttempt || !updatedHead)
          throw new LogicalDocumentValidationError("Reindex completion disappeared");
        return { attempt: updatedAttempt, head: updatedHead };
      }),
    fail: (input) =>
      database.transaction(async (transaction) => {
        const attempt = await transitionAttempt(
          input,
          ["queued", "running"],
          "failed",
          { errorCode: input.errorCode, errorMessage: input.errorMessage },
          transaction,
        );
        const failedCandidate = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            attempt.settingsRevision,
          ],
          sql: `UPDATE ${q(database, "document_settings_revisions")} SET ${q(database, "state")} = 'failed' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "state")} = 'candidate';`,
          tableName: "document_settings_revisions",
        });
        if (failedCandidate.rowsAffected !== 1) {
          throw new LogicalDocumentValidationError("Settings candidate is not fail-able");
        }
        return attempt;
      }),
    getAttempt: (input) => readAttempt(database, input),
    getHead: (input) => readHead(database, input),
    requestChange: (input) =>
      database.transaction(async (transaction) => {
        try {
          await assertDatabaseDocumentCandidateAdmission({
            admission: {
              compilationAttemptId: input.compilationAttemptId,
              documentId: input.documentId,
              documentRevision: input.documentRevision,
              knowledgeSpaceId: input.knowledgeSpaceId,
              now: input.now,
              requestedBySubjectId: input.createdBySubjectId,
              tenantId: input.tenantId,
              ...(input.trustedInternal ? { trustedInternal: true } : {}),
            },
            database,
            executor: transaction,
          });
        } catch (error) {
          if (error instanceof DocumentCandidateAdmissionError) {
            throw new LogicalDocumentValidationError(
              "Document settings candidate admission denied",
            );
          }
          throw error;
        }
        const head = await readHead(transaction, input, true);
        if ((head?.activeRevision ?? null) !== input.expectedSettingsHeadRevision) {
          throw new LogicalDocumentConflictError(
            input.expectedSettingsHeadRevision,
            head?.activeRevision ?? null,
            input.expectedSettingsHeadRevision ?? 0,
            head?.activeRevision ?? 0,
          );
        }
        const maxRevision = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, input.documentId],
          sql: `SELECT COALESCE(MAX(${q(database, "revision")}), 0) AS ${q(database, "max_revision")} FROM ${q(database, "document_settings_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)};`,
          tableName: "document_settings_revisions",
        });
        const revision = numberColumn(maxRevision.rows[0] ?? {}, "max_revision") + 1;
        const settings = parseDocumentIndexSettings(input.settings);
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            revision,
            JSON.stringify(settings),
            input.createdBySubjectId,
            input.now,
          ],
          sql: `INSERT INTO ${q(database, "document_settings_revisions")} (${["tenant_id", "knowledge_space_id", "document_id", "revision", "settings", "state", "created_by_subject_id", "created_at", "activated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${jsonP(database, 5)}, 'candidate', ${p(database, 6)}, ${p(database, 7)}, NULL);`,
          tableName: "document_settings_revisions",
        });
        const attemptId = generateAttemptId();
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            attemptId,
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            input.documentRevision,
            revision,
            input.expectedSettingsHeadRevision ?? 0,
            input.compilationAttemptId,
            input.now,
            input.now,
          ],
          sql: `INSERT INTO ${q(database, "document_reindex_attempts")} (${["id", "tenant_id", "knowledge_space_id", "document_id", "document_revision", "settings_revision", "expected_settings_head_revision", "state", "active_slot", "compilation_attempt_id", "candidate_publication_id", "candidate_fingerprint", "row_version", "error_code", "error_message", "created_at", "updated_at", "completed_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, ${p(database, 7)}, 'running', 1, ${p(database, 8)}, NULL, NULL, 0, NULL, NULL, ${p(database, 9)}, ${p(database, 10)}, NULL);`,
          tableName: "document_reindex_attempts",
        });
        const [candidate, attempt] = await Promise.all([
          readSettings(transaction, { ...input, revision }),
          readAttempt(transaction, { ...input, attemptId }),
        ]);
        if (!candidate || !attempt)
          throw new LogicalDocumentValidationError("Settings change insert failed");
        return { attempt, candidate };
      }),
    retry: (input) =>
      database.transaction(async (transaction) => {
        const attempt = await readAttempt(transaction, input, true);
        if (
          !attempt ||
          attempt.rowVersion !== input.expectedRowVersion ||
          (attempt.state !== "failed" && attempt.state !== "canceled")
        ) {
          if (!attempt)
            throw new LogicalDocumentNotFoundError("Document reindex attempt not found");
          throw new LogicalDocumentConflictError(
            null,
            null,
            input.expectedRowVersion,
            attempt.rowVersion,
          );
        }
        const head = await readHead(transaction, input, true);
        if ((head?.activeRevision ?? 0) !== attempt.expectedSettingsHeadRevision) {
          throw new LogicalDocumentConflictError(
            attempt.expectedSettingsHeadRevision || null,
            head?.activeRevision ?? null,
            attempt.expectedSettingsHeadRevision,
            head?.activeRevision ?? 0,
          );
        }
        const restoredCandidate = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            attempt.settingsRevision,
          ],
          sql: `UPDATE ${q(database, "document_settings_revisions")} SET ${q(database, "state")} = 'candidate' WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "state")} = 'failed';`,
          tableName: "document_settings_revisions",
        });
        if (restoredCandidate.rowsAffected !== 1) {
          throw new LogicalDocumentValidationError("Settings candidate is not retryable");
        }
        return transitionAttempt(input, ["failed", "canceled"], "running", {}, transaction);
      }),
  };
}

function mapSettingsRevision(row: DatabaseRow): DocumentSettingsRevision {
  const state = stringColumn(row, "state");
  if (state !== "candidate" && state !== "active" && state !== "superseded" && state !== "failed") {
    throw new LogicalDocumentValidationError("Invalid document settings state");
  }
  return {
    ...(optionalStringColumn(row, "activated_at")
      ? { activatedAt: optionalStringColumn(row, "activated_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    createdBySubjectId: stringColumn(row, "created_by_subject_id"),
    documentId: stringColumn(row, "document_id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    revision: numberColumn(row, "revision"),
    settings: parseDocumentIndexSettings(jsonObjectColumn(row, "settings")),
    state,
    tenantId: stringColumn(row, "tenant_id"),
  };
}

function mapAttempt(row: DatabaseRow): DocumentReindexAttempt {
  const state = stringColumn(row, "state");
  if (
    state !== "queued" &&
    state !== "running" &&
    state !== "succeeded" &&
    state !== "failed" &&
    state !== "canceled"
  ) {
    throw new LogicalDocumentValidationError("Invalid document reindex state");
  }
  return {
    ...(optionalStringColumn(row, "candidate_fingerprint")
      ? { candidateFingerprint: optionalStringColumn(row, "candidate_fingerprint") }
      : {}),
    ...(optionalStringColumn(row, "candidate_publication_id")
      ? { candidatePublicationId: optionalStringColumn(row, "candidate_publication_id") }
      : {}),
    ...(optionalStringColumn(row, "compilation_attempt_id")
      ? { compilationAttemptId: optionalStringColumn(row, "compilation_attempt_id") }
      : {}),
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: optionalStringColumn(row, "completed_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    documentId: stringColumn(row, "document_id"),
    documentRevision: numberColumn(row, "document_revision"),
    ...(optionalStringColumn(row, "error_code")
      ? { errorCode: optionalStringColumn(row, "error_code") }
      : {}),
    ...(optionalStringColumn(row, "error_message")
      ? { errorMessage: optionalStringColumn(row, "error_message") }
      : {}),
    expectedSettingsHeadRevision: numberColumn(row, "expected_settings_head_revision"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    rowVersion: numberColumn(row, "row_version"),
    settingsRevision: numberColumn(row, "settings_revision"),
    state,
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function cloneSettingsRevision(revision: DocumentSettingsRevision): DocumentSettingsRevision {
  return { ...revision, settings: parseDocumentIndexSettings(structuredClone(revision.settings)) };
}

function cloneHead(head: DocumentSettingsHead): DocumentSettingsHead {
  return { ...head, profile: cloneSettingsRevision(head.profile) };
}

function cloneAttempt(attempt: DocumentReindexAttempt): DocumentReindexAttempt {
  return { ...attempt };
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
