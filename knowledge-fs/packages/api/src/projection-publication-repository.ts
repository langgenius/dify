import {
  type DatabaseAdapter,
  type DatabaseExecuteInput,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  KnowledgeSpaceEmbeddingProfileSchema,
  ProjectionSetFingerprintSchema,
  PublicationGenerationIdSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import {
  type DatabaseKnowledgeSpacePermissionFence,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { PageIndexTokenizerVersion } from "./page-index-scoring";
import { TIDB_FTS_TOKENIZER_VERSION } from "./tidb-fts-postings";

export type ProjectionSetPublicationStatus =
  | "candidate"
  | "inactive"
  | "published"
  | "superseded"
  | "validating";

export interface ProjectionSetPublication {
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Record<string, unknown>;
  readonly projectionVersion: number;
  readonly status: ProjectionSetPublicationStatus;
  readonly supersededByFingerprint?: string | undefined;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface PublishedProjectionSetPublication extends ProjectionSetPublication {
  readonly headRevision: number;
  readonly status: "published";
}

export interface CreateProjectionSetCandidateInput {
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly projectionVersion: number;
  readonly tenantId: string;
}

export interface ProjectionSetPublicationLookupInput {
  readonly fingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ProjectionSetPublicationTransitionInput
  extends ProjectionSetPublicationLookupInput {
  readonly updatedAt: string;
}

export interface PublishProjectionSetInput extends ProjectionSetPublicationTransitionInput {
  readonly expectedHeadRevision: number;
}

/**
 * The durable compilation fence that must still own a candidate at the instant its publication
 * head is changed. The database implementation verifies this against the attempt row in the same
 * transaction that validates the candidate and advances the head.
 */
export interface DocumentCompilationPublicationFence {
  readonly attemptId: string;
  readonly candidatePublicationId: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly publicationGenerationId: string;
}

export interface PublishDocumentCompilationCandidateInput extends PublishProjectionSetInput {
  readonly attemptFence: DocumentCompilationPublicationFence;
  readonly expectedMembers: readonly DocumentCompilationPublicationMemberSnapshot[];
  /**
   * Optional I5 logical-document fence. When present the database implementation promotes this
   * immutable revision and advances the publication head in the same transaction. In-memory
   * publication repositories fail closed because they cannot provide cross-repository atomicity.
   */
  readonly logicalDocumentFence?: LogicalDocumentPublicationFence | undefined;
}

export interface LogicalDocumentPublicationFence {
  readonly documentId: string;
  readonly expectedActiveRevision: number | null;
  readonly expectedDocumentRowVersion: number;
  readonly revision: number;
}

export interface DocumentCompilationPublicationMemberSnapshot {
  readonly componentKey: string;
  readonly componentType:
    | "document-outline"
    | "graph-entity"
    | "graph-relation"
    | "index-projection"
    | "knowledge-path"
    | "multimodal-manifest";
  readonly documentAssetId?: string | undefined;
  readonly generationId: string;
}

export interface RollbackProjectionSetInput extends ProjectionSetPublicationTransitionInput {
  readonly expectedHeadRevision: number;
}

export interface PublishProjectionSetResult {
  readonly headRevision: number;
  readonly published: PublishedProjectionSetPublication;
  readonly superseded?: ProjectionSetPublication | undefined;
}

export interface ProjectionSetPublicationRepository {
  createCandidate(input: CreateProjectionSetCandidateInput): Promise<ProjectionSetPublication>;
  deactivate(input: ProjectionSetPublicationTransitionInput): Promise<ProjectionSetPublication>;
  delete(input: ProjectionSetPublicationLookupInput): Promise<ProjectionSetPublication | null>;
  getByFingerprint(
    input: ProjectionSetPublicationLookupInput,
  ): Promise<ProjectionSetPublication | null>;
  getPublished(input: {
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }): Promise<PublishedProjectionSetPublication | null>;
  listGcCandidates(input: ListProjectionSetPublicationGcCandidatesInput): Promise<{
    readonly items: readonly ProjectionSetPublication[];
    readonly nextCursor?: string | undefined;
  }>;
  publish(input: PublishProjectionSetInput): Promise<PublishProjectionSetResult>;
  publishDocumentCompilationCandidate(
    input: PublishDocumentCompilationCandidateInput,
  ): Promise<PublishProjectionSetResult>;
  rollback(input: RollbackProjectionSetInput): Promise<PublishProjectionSetResult>;
  validate(input: ProjectionSetPublicationTransitionInput): Promise<ProjectionSetPublication>;
}

export interface InMemoryProjectionSetPublicationRepositoryOptions {
  readonly maxPublications: number;
}

export interface DatabaseProjectionSetPublicationRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}

export interface ListProjectionSetPublicationGcCandidatesInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly olderThan: string;
  readonly tenantId: string;
}

export class DuplicateProjectionSetPublicationError extends Error {
  constructor(fingerprint: string) {
    super(`Projection set publication already exists for fingerprint=${fingerprint}`);
  }
}

export class ProjectionSetPublicationCapacityExceededError extends Error {
  constructor(maxPublications: number) {
    super(`Projection set publication repository maxPublications=${maxPublications} exceeded`);
  }
}

export class ProjectionSetPublicationListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`Projection set publication list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

export class ProjectionSetPublicationNotFoundError extends Error {
  constructor(fingerprint: string) {
    super(`Projection set publication ${fingerprint} not found`);
  }
}

export class ProjectionSetPublicationKnowledgeSpaceNotFoundError extends Error {
  constructor(knowledgeSpaceId: string) {
    super(`Knowledge space ${knowledgeSpaceId} was not found in the publication tenant scope`);
  }
}

export class ProjectionSetPublicationHeadConflictError extends Error {
  readonly actualHeadRevision: number;
  readonly expectedHeadRevision: number;

  constructor(expectedHeadRevision: number, actualHeadRevision: number) {
    super(
      `Projection set publication head revision conflict: expected=${expectedHeadRevision} actual=${actualHeadRevision}`,
    );
    this.expectedHeadRevision = expectedHeadRevision;
    this.actualHeadRevision = actualHeadRevision;
  }
}

export class ProjectionSetPublicationAttemptFenceConflictError extends Error {
  constructor() {
    super("Projection set publication lost its document compilation attempt fence");
    this.name = "ProjectionSetPublicationAttemptFenceConflictError";
  }
}

export class ProjectionSetPublicationProfileFenceConflictError extends Error {
  constructor() {
    super("Projection set publication lost its frozen knowledge-space profile fence");
    this.name = "ProjectionSetPublicationProfileFenceConflictError";
  }
}

export class ProjectionSetPublicationProfileBindingConflictError extends Error {
  constructor() {
    super("Projection set publication has a conflicting activated profile binding");
    this.name = "ProjectionSetPublicationProfileBindingConflictError";
  }
}

export class ProjectionSetPublicationDeletionFenceConflictError extends Error {
  constructor() {
    super("Projection set publication target entered durable deletion before head publication");
    this.name = "ProjectionSetPublicationDeletionFenceConflictError";
  }
}

export class ProjectionSetPublicationCandidateSnapshotConflictError extends Error {
  constructor() {
    super("Projection set publication candidate member snapshot changed before publication");
    this.name = "ProjectionSetPublicationCandidateSnapshotConflictError";
  }
}

export class ProjectionSetPublicationTransitionError extends Error {}

interface ProjectionSetPublicationHead {
  readonly headRevision: number;
  readonly publication: ProjectionSetPublication;
}

interface DocumentCompilationPublicationProfileReference {
  readonly revision: number;
  readonly revisionId: string;
  readonly snapshotDigest: string;
}

interface DocumentCompilationPublicationProfileSnapshot {
  readonly embedding?:
    | (DocumentCompilationPublicationProfileReference & { readonly vectorSpaceId: string })
    | undefined;
  readonly retrieval: DocumentCompilationPublicationProfileReference;
}

export function createInMemoryProjectionSetPublicationRepository({
  maxPublications,
}: InMemoryProjectionSetPublicationRepositoryOptions): ProjectionSetPublicationRepository {
  if (!Number.isSafeInteger(maxPublications) || maxPublications < 1) {
    throw new Error("Projection set publication repository maxPublications must be at least 1");
  }

  const publications = new Map<string, ProjectionSetPublication>();
  const heads = new Map<string, { readonly fingerprint: string; readonly revision: number }>();

  return {
    createCandidate: async (input) => {
      const publication = parseCandidate(input);
      const key = publicationKey(publication);

      if (publications.has(key)) {
        throw new DuplicateProjectionSetPublicationError(publication.fingerprint);
      }

      if (publications.size >= maxPublications) {
        throw new ProjectionSetPublicationCapacityExceededError(maxPublications);
      }

      publications.set(key, clonePublication(publication));

      return clonePublication(publication);
    },
    deactivate: async (input) => {
      const publication = requireMemoryPublication(publications, input);

      if (publication.status === "published") {
        throw new ProjectionSetPublicationTransitionError(
          "Published projection sets must be superseded or rolled back",
        );
      }

      return updateMemoryPublication(publications, {
        ...publication,
        status: "inactive",
        updatedAt: canonicalDateTime(input.updatedAt, "updatedAt"),
      });
    },
    delete: async (input) => {
      const publication = publications.get(publicationLookupKey(input));

      if (!publication) {
        return null;
      }

      const head = heads.get(publicationSpaceKey(publication));
      if (publication.status === "published" || head?.fingerprint === publication.fingerprint) {
        throw new ProjectionSetPublicationTransitionError(
          "Published projection sets cannot be deleted",
        );
      }

      publications.delete(publicationKey(publication));

      return clonePublication(publication);
    },
    getByFingerprint: async (input) => {
      const publication = publications.get(publicationLookupKey(input));

      return publication ? clonePublication(publication) : null;
    },
    getPublished: async ({ knowledgeSpaceId, tenantId }) => {
      const head = heads.get(publicationSpaceKey({ knowledgeSpaceId, tenantId }));
      if (!head) {
        return null;
      }

      const publication = publications.get(
        publicationLookupKey({ fingerprint: head.fingerprint, knowledgeSpaceId, tenantId }),
      );

      return publication ? toPublishedPublication(publication, head.revision) : null;
    },
    listGcCandidates: async ({ cursor, knowledgeSpaceId, limit, olderThan, tenantId }) => {
      validateGcListLimit(limit);
      const scopedTenantId = tenantIdValue(tenantId);
      const scopedKnowledgeSpaceId = UuidSchema.parse(knowledgeSpaceId);
      const canonicalOlderThan = canonicalDateTime(olderThan, "olderThan");
      const normalizedCursor =
        cursor === undefined ? undefined : ProjectionSetFingerprintSchema.parse(cursor);

      const page = Array.from(publications.values())
        .filter((publication) => publication.tenantId === scopedTenantId)
        .filter((publication) => publication.knowledgeSpaceId === scopedKnowledgeSpaceId)
        .filter(
          (publication) =>
            (publication.status === "inactive" || publication.status === "superseded") &&
            publication.updatedAt < canonicalOlderThan,
        )
        .filter((publication) =>
          normalizedCursor ? publication.fingerprint > normalizedCursor : true,
        )
        .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
        .slice(0, limit + 1);
      const items = page.slice(0, limit).map(clonePublication);
      const nextCursor = page.length > limit ? items.at(-1)?.fingerprint : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    publish: async (input) =>
      publishMemoryProjectionSet(publications, heads, input, ["candidate", "validating"]),
    publishDocumentCompilationCandidate: async (input) =>
      publishMemoryDocumentCompilationCandidate(publications, heads, input),
    rollback: async (input) =>
      publishMemoryProjectionSet(publications, heads, input, ["superseded"]),
    validate: async (input) => {
      const publication = requireMemoryPublication(publications, input);

      if (publication.status !== "candidate") {
        throw new ProjectionSetPublicationTransitionError(
          `Projection set cannot validate from ${publication.status}`,
        );
      }

      return updateMemoryPublication(publications, {
        ...publication,
        status: "validating",
        updatedAt: canonicalDateTime(input.updatedAt, "updatedAt"),
      });
    },
  };
}

export function createDatabaseProjectionSetPublicationRepository({
  database,
  maxListLimit,
}: DatabaseProjectionSetPublicationRepositoryOptions): ProjectionSetPublicationRepository {
  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("Projection set publication repository maxListLimit must be at least 1");
  }

  return {
    createCandidate: async (input) => databaseCreateCandidate(database, input),
    deactivate: async (input) =>
      databaseTransitionPublication(database, input, {
        allowedStatuses: ["candidate", "inactive", "superseded", "validating"],
        status: "inactive",
      }),
    delete: async (input) => databaseDeletePublication(database, input),
    getByFingerprint: async (input) => databaseGetPublication(database, database, input, false),
    getPublished: async (input) => {
      const head = await databaseGetHead(database, database, input, false);

      return head ? toPublishedPublication(head.publication, head.headRevision) : null;
    },
    listGcCandidates: async (input) => databaseListGcCandidates(database, maxListLimit, input),
    publish: async (input) =>
      databasePublishProjectionSet(database, input, ["candidate", "validating"]),
    publishDocumentCompilationCandidate: async (input) =>
      databasePublishDocumentCompilationCandidate(database, input),
    rollback: async (input) => databasePublishProjectionSet(database, input, ["superseded"], true),
    validate: async (input) =>
      databaseTransitionPublication(database, input, {
        allowedStatuses: ["candidate"],
        status: "validating",
      }),
  };
}

function publishMemoryProjectionSet(
  publications: Map<string, ProjectionSetPublication>,
  heads: Map<string, { readonly fingerprint: string; readonly revision: number }>,
  input: PublishProjectionSetInput,
  allowedStatuses: readonly ProjectionSetPublicationStatus[],
): PublishProjectionSetResult {
  const publication = requireMemoryPublication(publications, input);
  const spaceKey = publicationSpaceKey(publication);
  const head = heads.get(spaceKey);
  const actualHeadRevision = head?.revision ?? 0;
  const expectedHeadRevision = validateAdvancableHeadRevision(input.expectedHeadRevision);
  if (actualHeadRevision !== expectedHeadRevision) {
    throw new ProjectionSetPublicationHeadConflictError(expectedHeadRevision, actualHeadRevision);
  }
  if (!allowedStatuses.includes(publication.status)) {
    throw new ProjectionSetPublicationTransitionError(
      `Projection set cannot publish from ${publication.status}`,
    );
  }

  const updatedAt = canonicalDateTime(input.updatedAt, "updatedAt");
  const existingPublished = head
    ? publications.get(
        publicationLookupKey({
          fingerprint: head.fingerprint,
          knowledgeSpaceId: publication.knowledgeSpaceId,
          tenantId: publication.tenantId,
        }),
      )
    : undefined;
  const superseded =
    existingPublished && existingPublished.fingerprint !== publication.fingerprint
      ? updateMemoryPublication(publications, {
          ...existingPublished,
          status: "superseded",
          supersededByFingerprint: publication.fingerprint,
          updatedAt,
        })
      : undefined;
  const published = updateMemoryPublication(publications, {
    ...publication,
    status: "published",
    supersededByFingerprint: undefined,
    updatedAt,
  });
  const headRevision = actualHeadRevision + 1;
  heads.set(spaceKey, { fingerprint: publication.fingerprint, revision: headRevision });

  return {
    headRevision,
    published: toPublishedPublication(published, headRevision),
    ...(superseded ? { superseded } : {}),
  };
}

function publishMemoryDocumentCompilationCandidate(
  publications: Map<string, ProjectionSetPublication>,
  heads: Map<string, { readonly fingerprint: string; readonly revision: number }>,
  input: PublishDocumentCompilationCandidateInput,
): PublishProjectionSetResult {
  if (input.logicalDocumentFence) {
    throw new ProjectionSetPublicationTransitionError(
      "In-memory publication repository cannot atomically publish a logical document revision",
    );
  }
  const publication = requireMemoryPublication(publications, input);
  const fence = normalizeDocumentCompilationPublicationFence(input.attemptFence);
  normalizeDocumentCompilationMemberSnapshot(input.expectedMembers);
  const expectedHeadRevision = validateAdvancableHeadRevision(input.expectedHeadRevision);
  const head = heads.get(publicationSpaceKey(publication));
  const actualHeadRevision = head?.revision ?? 0;

  if (actualHeadRevision !== expectedHeadRevision) {
    throw new ProjectionSetPublicationHeadConflictError(expectedHeadRevision, actualHeadRevision);
  }
  if (publication.status !== "candidate") {
    throw new ProjectionSetPublicationTransitionError(
      `Document compilation candidate cannot publish from ${publication.status}`,
    );
  }
  if (publication.id !== fence.candidatePublicationId) {
    throw new ProjectionSetPublicationAttemptFenceConflictError();
  }

  // The in-memory repository is single-process. Validating and publishing contain no await points,
  // so this transition is atomic with respect to other in-memory repository operations.
  updateMemoryPublication(publications, {
    ...publication,
    status: "validating",
    updatedAt: canonicalDateTime(input.updatedAt, "updatedAt"),
  });
  return publishMemoryProjectionSet(publications, heads, input, ["validating"]);
}

async function databaseCreateCandidate(
  database: DatabaseAdapter,
  input: CreateProjectionSetCandidateInput,
): Promise<ProjectionSetPublication> {
  const publication = parseCandidate(input);
  await requireDatabaseKnowledgeSpaceOwnership(database, database, publication, false);
  const tableName = publicationTableName;
  const columns = publicationColumns;
  const params = publicationColumnValues(publication);
  const insertKeyword = database.dialect === "postgres" ? "INSERT" : "INSERT IGNORE";
  const conflictClause =
    database.dialect === "postgres"
      ? ` ON CONFLICT (${["tenant_id", "knowledge_space_id", "fingerprint"]
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) DO NOTHING RETURNING *`
      : "";
  const result = await database.execute({
    maxRows: 1,
    operation: "insert",
    params,
    sql: `${insertKeyword} INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES (${columns
      .map((column, index) => jsonInsertPlaceholder(database, index + 1, column))
      .join(", ")})${conflictClause};`,
    tableName,
  });

  if (result.rows[0]) {
    return mapPublicationRow(result.rows[0]);
  }
  if (result.rowsAffected !== 1) {
    throw new DuplicateProjectionSetPublicationError(publication.fingerprint);
  }

  return clonePublication(publication);
}

async function requireDatabaseKnowledgeSpaceOwnership(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  publication: Pick<ProjectionSetPublication, "knowledgeSpaceId" | "tenantId">,
  forUpdate: boolean,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [publication.tenantId, publication.knowledgeSpaceId],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
      database,
      knowledgeSpaceTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      2,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: knowledgeSpaceTableName,
  });

  if (!result.rows[0]) {
    throw new ProjectionSetPublicationKnowledgeSpaceNotFoundError(publication.knowledgeSpaceId);
  }
}

async function databaseTransitionPublication(
  database: DatabaseAdapter,
  input: ProjectionSetPublicationTransitionInput,
  transition: {
    readonly allowedStatuses: readonly ProjectionSetPublicationStatus[];
    readonly status: ProjectionSetPublicationStatus;
  },
): Promise<ProjectionSetPublication> {
  const updatedAt = canonicalDateTime(input.updatedAt, "updatedAt");

  return database.transaction(async (transaction) => {
    const publication = await requireDatabasePublication(database, transaction, input, true);
    if (!transition.allowedStatuses.includes(publication.status)) {
      throw new ProjectionSetPublicationTransitionError(
        `Projection set cannot transition from ${publication.status} to ${transition.status}`,
      );
    }

    return databaseUpdatePublication(database, transaction, publication, {
      status: transition.status,
      updatedAt,
    });
  });
}

async function databaseDeletePublication(
  database: DatabaseAdapter,
  input: ProjectionSetPublicationLookupInput,
): Promise<ProjectionSetPublication | null> {
  return database.transaction(async (transaction) => {
    const head = await databaseGetHead(database, transaction, input, true);
    const publication = await databaseGetPublication(database, transaction, input, true);
    if (!publication) {
      return null;
    }

    if (publication.status === "published" || head?.publication.id === publication.id) {
      throw new ProjectionSetPublicationTransitionError(
        "Published projection sets cannot be deleted",
      );
    }

    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [publication.id, publication.tenantId, publication.knowledgeSpaceId],
      sql: `DELETE FROM ${quoteDatabaseIdentifier(
        database,
        "knowledge_space_profile_publication_bindings",
      )} WHERE ${quoteDatabaseIdentifier(
        database,
        "publication_id",
      )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
        database,
        "tenant_id",
      )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${databasePlaceholder(database, 3)};`,
      tableName: "knowledge_space_profile_publication_bindings",
    });

    const result = await transaction.execute({
      maxRows: 1,
      operation: "delete",
      params: [publication.id, publication.tenantId, publication.knowledgeSpaceId],
      sql: `DELETE FROM ${quoteDatabaseIdentifier(
        database,
        publicationTableName,
      )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
        database,
        1,
      )} AND ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
        database,
        2,
      )} AND ${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${databasePlaceholder(database, 3)};`,
      tableName: publicationTableName,
    });

    if (result.rowsAffected !== 1) {
      throw new ProjectionSetPublicationTransitionError(
        "Projection set publication changed concurrently during delete",
      );
    }

    return publication;
  });
}

async function databasePublishProjectionSet(
  database: DatabaseAdapter,
  input: PublishProjectionSetInput,
  allowedStatuses: readonly ProjectionSetPublicationStatus[],
  requirePageIndexReady = false,
): Promise<PublishProjectionSetResult> {
  const expectedHeadRevision = validateAdvancableHeadRevision(input.expectedHeadRevision);
  const updatedAt = canonicalDateTime(input.updatedAt, "updatedAt");

  return database.transaction(async (transaction) => {
    await requireDatabaseKnowledgeSpaceOwnership(database, transaction, input, true);
    let head = await databaseGetHead(database, transaction, input, true);
    assertExpectedHeadRevision(head, expectedHeadRevision);

    const publication = await requireDatabasePublication(database, transaction, input, true);
    if (!head) {
      // A missing head row cannot be locked. Re-read after the candidate lock so a concurrent
      // first publisher of this same candidate is reported as a CAS conflict, not a transition
      // error observed from its newly-published candidate row.
      head = await databaseGetHead(database, transaction, input, true);
      assertExpectedHeadRevision(head, expectedHeadRevision);
    }
    if (!allowedStatuses.includes(publication.status)) {
      throw new ProjectionSetPublicationTransitionError(
        `Projection set cannot publish from ${publication.status}`,
      );
    }
    if (requirePageIndexReady) {
      const rollbackMembers = await requireDatabaseRollbackMemberSnapshot(
        database,
        transaction,
        publication,
      );
      await requireDatabaseDocumentCompilationTargetClosure(
        database,
        transaction,
        publication,
        rollbackMembers,
      );
      await requireDatabaseRollbackIndexProjectionsReady(database, transaction, publication);
      await requireDatabaseRollbackPageIndexReady(database, transaction, publication);
    }

    const superseded = head
      ? await databaseUpdatePublication(database, transaction, head.publication, {
          status: "superseded",
          supersededByFingerprint: publication.fingerprint,
          updatedAt,
        })
      : undefined;
    const published = await databaseUpdatePublication(database, transaction, publication, {
      status: "published",
      supersededByFingerprint: null,
      updatedAt,
    });
    const headRevision = await databaseAdvanceHead(
      database,
      transaction,
      publication,
      expectedHeadRevision,
      updatedAt,
    );
    return {
      headRevision,
      published: toPublishedPublication(published, headRevision),
      ...(superseded ? { superseded } : {}),
    };
  });
}

async function activateDatabaseLogicalDocumentRevision(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: PublishDocumentCompilationCandidateInput,
  fence: LogicalDocumentPublicationFence,
  updatedAt: string,
): Promise<void> {
  const target = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      fence.documentId,
      fence.revision,
      input.attemptFence.documentAssetId,
      input.attemptFence.documentVersion,
    ],
    sql: `SELECT ${[
      "state",
      "compilation_attempt_id",
      "expected_active_revision",
      "expected_document_row_version",
    ]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")} FROM ${quoteDatabaseIdentifier(
      database,
      "document_revisions",
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "document_id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "revision",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "document_asset_version",
    )} = ${databasePlaceholder(database, 6)} FOR UPDATE;`,
    tableName: "document_revisions",
  });
  const targetRow = target.rows[0];
  if (
    !targetRow ||
    stringColumn(targetRow, "state") !== "candidate" ||
    optionalStringColumn(targetRow, "compilation_attempt_id") !== input.attemptFence.attemptId ||
    (optionalNumberColumn(targetRow, "expected_active_revision") ?? null) !==
      fence.expectedActiveRevision ||
    numberColumn(targetRow, "expected_document_row_version") !== fence.expectedDocumentRowVersion
  ) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }

  const document = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, fence.documentId],
    sql: `SELECT ${quoteDatabaseIdentifier(
      database,
      "active_revision",
    )}, ${quoteDatabaseIdentifier(database, "row_version")} FROM ${quoteDatabaseIdentifier(
      database,
      "logical_documents",
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "status",
    )} <> 'deleting' AND ${quoteDatabaseIdentifier(
      database,
      "deletion_job_id",
    )} IS NULL FOR UPDATE;`,
    tableName: "logical_documents",
  });
  const documentRow = document.rows[0];
  if (
    !documentRow ||
    (optionalNumberColumn(documentRow, "active_revision") ?? null) !==
      fence.expectedActiveRevision ||
    numberColumn(documentRow, "row_version") !== fence.expectedDocumentRowVersion
  ) {
    throw new ProjectionSetPublicationHeadConflictError(
      input.expectedHeadRevision,
      input.expectedHeadRevision,
    );
  }

  if (fence.expectedActiveRevision !== null) {
    const superseded = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        input.tenantId,
        input.knowledgeSpaceId,
        fence.documentId,
        fence.expectedActiveRevision,
      ],
      sql: `UPDATE ${quoteDatabaseIdentifier(
        database,
        "document_revisions",
      )} SET ${quoteDatabaseIdentifier(
        database,
        "state",
      )} = 'superseded' WHERE ${quoteDatabaseIdentifier(
        database,
        "tenant_id",
      )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
        database,
        "document_id",
      )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
        database,
        "revision",
      )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
        database,
        "state",
      )} = 'active';`,
      tableName: "document_revisions",
    });
    if (superseded.rowsAffected !== 1) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
  }
  const activated = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [updatedAt, input.tenantId, input.knowledgeSpaceId, fence.documentId, fence.revision],
    sql: `UPDATE ${quoteDatabaseIdentifier(
      database,
      "document_revisions",
    )} SET ${quoteDatabaseIdentifier(database, "state")} = 'active', ${quoteDatabaseIdentifier(
      database,
      "activated_at",
    )} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "document_id",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "revision",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "state",
    )} = 'candidate';`,
    tableName: "document_revisions",
  });
  const advanced = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [
      fence.revision,
      updatedAt,
      input.tenantId,
      input.knowledgeSpaceId,
      fence.documentId,
      fence.expectedDocumentRowVersion,
    ],
    sql: `UPDATE ${quoteDatabaseIdentifier(
      database,
      "logical_documents",
    )} SET ${quoteDatabaseIdentifier(
      database,
      "active_revision",
    )} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(
      database,
      "status",
    )} = 'ready', ${quoteDatabaseIdentifier(database, "row_version")} = ${quoteDatabaseIdentifier(
      database,
      "row_version",
    )} + 1, ${quoteDatabaseIdentifier(
      database,
      "updated_at",
    )} = ${databasePlaceholder(database, 2)} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "row_version",
    )} = ${databasePlaceholder(database, 6)} AND ${quoteDatabaseIdentifier(
      database,
      "status",
    )} <> 'deleting' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL;`,
    tableName: "logical_documents",
  });
  if (activated.rowsAffected !== 1 || advanced.rowsAffected !== 1) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

const maximumLogicalDocumentChunks = 20_000;

interface LogicalDocumentChunkNode {
  readonly id: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly ordinal: number;
  readonly row: DatabaseRow;
}

async function materializeDatabaseLogicalDocumentChunks(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: PublishDocumentCompilationCandidateInput,
  fence: LogicalDocumentPublicationFence,
  createdAt: string,
): Promise<void> {
  const nodes = await transaction.execute({
    maxRows: maximumLogicalDocumentChunks + 1,
    operation: "select",
    params: [
      input.knowledgeSpaceId,
      input.attemptFence.documentAssetId,
      input.attemptFence.publicationGenerationId,
    ],
    sql: `SELECT ${[
      "id",
      "kind",
      "text",
      "start_offset",
      "end_offset",
      "source_location",
      "metadata",
    ]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(
        ", ",
      )} FROM ${quoteDatabaseIdentifier(database, "knowledge_nodes")} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "document_asset_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "publication_generation_id")} = ${databasePlaceholder(database, 3)} ORDER BY ${quoteDatabaseIdentifier(database, "start_offset")} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC;`,
    tableName: "knowledge_nodes",
  });
  if (nodes.rows.length > maximumLogicalDocumentChunks) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  const chunkNodes: LogicalDocumentChunkNode[] = nodes.rows.map((row, ordinal) => ({
    id: stringColumn(row, "id"),
    kind: stringColumn(row, "kind"),
    metadata: jsonObjectColumn(row, "metadata"),
    ordinal,
    row,
  }));
  const nodesById = new Map(chunkNodes.map((node) => [node.id, node]));
  if (nodesById.size !== chunkNodes.length) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }

  // KnowledgeNode has no separate parent column. Summary-tree nodes persist the canonical
  // relation as metadata.childNodeIds, so invert that edge into the public chunk parent pointer.
  // A child with multiple parents or a cycle is a corrupt candidate and must not be published.
  const parentByChildId = new Map<string, string>();
  for (const parent of chunkNodes) {
    if (parent.kind !== "summary" || parent.metadata.childNodeIds === undefined) continue;
    const childNodeIds = parent.metadata.childNodeIds;
    if (!Array.isArray(childNodeIds) || !childNodeIds.every((id) => typeof id === "string")) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
    for (const childId of new Set(childNodeIds)) {
      if (!nodesById.has(childId)) continue;
      const existingParentId = parentByChildId.get(childId);
      if (childId === parent.id || (existingParentId && existingParentId !== parent.id)) {
        throw new ProjectionSetPublicationCandidateSnapshotConflictError();
      }
      parentByChildId.set(childId, parent.id);
    }
  }

  const childrenByParentId = new Map<string, LogicalDocumentChunkNode[]>();
  for (const node of chunkNodes) {
    const parentId = parentByChildId.get(node.id);
    if (!parentId) continue;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(parentId, siblings);
  }
  const pending = chunkNodes.filter((node) => !parentByChildId.has(node.id));
  const parentFirstNodes: LogicalDocumentChunkNode[] = [];
  for (let index = 0; index < pending.length; index += 1) {
    const node = pending[index];
    if (!node) continue;
    parentFirstNodes.push(node);
    pending.push(...(childrenByParentId.get(node.id) ?? []));
  }
  if (parentFirstNodes.length !== chunkNodes.length) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }

  for (const node of parentFirstNodes) {
    const { row } = node;
    const text = stringColumn(row, "text");
    const systemMetadata = {
      endOffset: numberColumn(row, "end_offset"),
      kind: node.kind,
      nodeMetadata: node.metadata,
      sourceLocation: jsonObjectColumn(row, "source_location"),
      startOffset: numberColumn(row, "start_offset"),
    };
    await transaction.execute({
      maxRows: 0,
      operation: "insert",
      params: [
        stringColumn(row, "id"),
        input.tenantId,
        input.knowledgeSpaceId,
        fence.documentId,
        fence.revision,
        parentByChildId.get(node.id) ?? null,
        node.ordinal,
        approximateTokenCount(text),
        text,
        JSON.stringify(systemMetadata),
        JSON.stringify({}),
        createdAt,
      ],
      sql: `INSERT INTO ${quoteDatabaseIdentifier(database, "document_revision_chunks")} (${[
        "id",
        "tenant_id",
        "knowledge_space_id",
        "document_id",
        "document_revision",
        "parent_chunk_id",
        "ordinal",
        "token_count",
        "text",
        "system_metadata",
        "user_metadata",
        "created_at",
      ]
        .map((column) => quoteDatabaseIdentifier(database, column))
        .join(
          ", ",
        )}) VALUES (${databasePlaceholder(database, 1)}, ${databasePlaceholder(database, 2)}, ${databasePlaceholder(database, 3)}, ${databasePlaceholder(database, 4)}, ${databasePlaceholder(database, 5)}, ${databasePlaceholder(database, 6)}, ${databasePlaceholder(database, 7)}, ${databasePlaceholder(database, 8)}, ${databasePlaceholder(database, 9)}, ${jsonInsertPlaceholder(database, 10, undefined)}, ${jsonInsertPlaceholder(database, 11, undefined)}, ${databasePlaceholder(database, 12)});`,
      tableName: "document_revision_chunks",
    });
  }
}

async function activateDatabaseDocumentChunkMutation(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: PublishDocumentCompilationCandidateInput,
  publication: ProjectionSetPublication,
  updatedAt: string,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.attemptFence.attemptId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "document_chunk_state_changes")} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "compilation_attempt_id")} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(database, "state")} = 'candidate' LIMIT 1 FOR UPDATE;`,
    tableName: "document_chunk_state_changes",
  });
  const change = result.rows[0];
  if (!change) return;
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      stringColumn(change, "document_id"),
      numberColumn(change, "document_revision"),
      stringColumn(change, "chunk_id"),
    ],
    sql: `UPDATE ${quoteDatabaseIdentifier(database, "document_chunk_state_changes")} SET ${quoteDatabaseIdentifier(database, "state")} = 'superseded' WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "document_id")} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(database, "document_revision")} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(database, "chunk_id")} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(database, "state")} = 'active';`,
    tableName: "document_chunk_state_changes",
  });
  const activated = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [
      publication.id,
      publication.fingerprint,
      updatedAt,
      input.tenantId,
      input.knowledgeSpaceId,
      input.attemptFence.attemptId,
    ],
    sql: `UPDATE ${quoteDatabaseIdentifier(database, "document_chunk_state_changes")} SET ${quoteDatabaseIdentifier(database, "candidate_publication_id")} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(database, "candidate_fingerprint")} = ${databasePlaceholder(database, 2)}, ${quoteDatabaseIdentifier(database, "state")} = 'active', ${quoteDatabaseIdentifier(database, "activated_at")} = ${databasePlaceholder(database, 3)} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(database, "compilation_attempt_id")} = ${databasePlaceholder(database, 6)} AND ${quoteDatabaseIdentifier(database, "state")} = 'candidate';`,
    tableName: "document_chunk_state_changes",
  });
  if (activated.rowsAffected !== 1) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

async function activateDatabaseDocumentSettingsMutation(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: PublishDocumentCompilationCandidateInput,
  publication: ProjectionSetPublication,
  updatedAt: string,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.attemptFence.attemptId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "document_reindex_attempts")} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "compilation_attempt_id")} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(database, "state")} = 'running' LIMIT 1 FOR UPDATE;`,
    tableName: "document_reindex_attempts",
  });
  const attempt = result.rows[0];
  if (!attempt) return;
  const documentId = stringColumn(attempt, "document_id");
  const settingsRevision = numberColumn(attempt, "settings_revision");
  const expectedHeadRevision = numberColumn(attempt, "expected_settings_head_revision");
  const headResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, documentId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "document_settings_heads")} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "document_id")} = ${databasePlaceholder(database, 3)} FOR UPDATE;`,
    tableName: "document_settings_heads",
  });
  const head = headResult.rows[0];
  if ((head ? numberColumn(head, "active_revision") : 0) !== expectedHeadRevision) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  if (head) {
    const superseded = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [input.tenantId, input.knowledgeSpaceId, documentId, expectedHeadRevision],
      sql: `UPDATE ${quoteDatabaseIdentifier(database, "document_settings_revisions")} SET ${quoteDatabaseIdentifier(database, "state")} = 'superseded' WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "document_id")} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(database, "revision")} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(database, "state")} = 'active';`,
      tableName: "document_settings_revisions",
    });
    if (superseded.rowsAffected !== 1) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
  }
  const activated = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [updatedAt, input.tenantId, input.knowledgeSpaceId, documentId, settingsRevision],
    sql: `UPDATE ${quoteDatabaseIdentifier(database, "document_settings_revisions")} SET ${quoteDatabaseIdentifier(database, "state")} = 'active', ${quoteDatabaseIdentifier(database, "activated_at")} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(database, "document_id")} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(database, "revision")} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(database, "state")} = 'candidate';`,
    tableName: "document_settings_revisions",
  });
  if (activated.rowsAffected !== 1) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  if (head) {
    const advanced = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        settingsRevision,
        updatedAt,
        input.tenantId,
        input.knowledgeSpaceId,
        documentId,
        numberColumn(head, "row_version"),
      ],
      sql: `UPDATE ${quoteDatabaseIdentifier(database, "document_settings_heads")} SET ${quoteDatabaseIdentifier(database, "active_revision")} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(database, "row_version")} = ${quoteDatabaseIdentifier(database, "row_version")} + 1, ${quoteDatabaseIdentifier(database, "updated_at")} = ${databasePlaceholder(database, 2)} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(database, "document_id")} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(database, "row_version")} = ${databasePlaceholder(database, 6)};`,
      tableName: "document_settings_heads",
    });
    if (advanced.rowsAffected !== 1) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
  } else {
    await transaction.execute({
      maxRows: 0,
      operation: "insert",
      params: [input.tenantId, input.knowledgeSpaceId, documentId, settingsRevision, updatedAt],
      sql: `INSERT INTO ${quoteDatabaseIdentifier(database, "document_settings_heads")} (${["tenant_id", "knowledge_space_id", "document_id", "active_revision", "row_version", "updated_at"].map((column) => quoteDatabaseIdentifier(database, column)).join(", ")}) VALUES (${databasePlaceholder(database, 1)}, ${databasePlaceholder(database, 2)}, ${databasePlaceholder(database, 3)}, ${databasePlaceholder(database, 4)}, 0, ${databasePlaceholder(database, 5)});`,
      tableName: "document_settings_heads",
    });
  }
  const completed = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [
      publication.id,
      publication.fingerprint,
      updatedAt,
      input.tenantId,
      input.knowledgeSpaceId,
      input.attemptFence.attemptId,
      numberColumn(attempt, "row_version"),
    ],
    sql: `UPDATE ${quoteDatabaseIdentifier(database, "document_reindex_attempts")} SET ${quoteDatabaseIdentifier(database, "candidate_publication_id")} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(database, "candidate_fingerprint")} = ${databasePlaceholder(database, 2)}, ${quoteDatabaseIdentifier(database, "state")} = 'succeeded', ${quoteDatabaseIdentifier(database, "active_slot")} = NULL, ${quoteDatabaseIdentifier(database, "completed_at")} = ${databasePlaceholder(database, 3)}, ${quoteDatabaseIdentifier(database, "updated_at")} = ${databasePlaceholder(database, 3)}, ${quoteDatabaseIdentifier(database, "row_version")} = ${quoteDatabaseIdentifier(database, "row_version")} + 1 WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(database, "compilation_attempt_id")} = ${databasePlaceholder(database, 6)} AND ${quoteDatabaseIdentifier(database, "row_version")} = ${databasePlaceholder(database, 7)} AND ${quoteDatabaseIdentifier(database, "state")} = 'running';`,
    tableName: "document_reindex_attempts",
  });
  if (completed.rowsAffected !== 1) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

function approximateTokenCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0;
}

async function requireDatabaseRollbackMemberSnapshot(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publication: ProjectionSetPublication,
): Promise<readonly DocumentCompilationPublicationMemberSnapshot[]> {
  const result = await transaction.execute({
    maxRows: maximumDocumentCompilationGraphSourceNodes + 1,
    operation: "select",
    params: [publication.tenantId, publication.knowledgeSpaceId, publication.id],
    sql: `SELECT ${["component_key", "component_type", "document_asset_id", "generation_id"]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "publication_id")} = ${databasePlaceholder(
      database,
      3,
    )} ORDER BY ${quoteDatabaseIdentifier(database, "component_type")} ASC, ${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} ASC FOR UPDATE;`,
    tableName: publicationMemberTableName,
  });
  if (result.rows.length === 0 || result.rows.length > maximumDocumentCompilationGraphSourceNodes) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }

  return normalizeDocumentCompilationMemberSnapshot(
    result.rows.map((row) => ({
      componentKey: stringColumn(row, "component_key"),
      componentType: stringColumn(
        row,
        "component_type",
      ) as DocumentCompilationPublicationMemberSnapshot["componentType"],
      documentAssetId: optionalStringColumn(row, "document_asset_id"),
      generationId: stringColumn(row, "generation_id"),
    })),
  );
}

async function requireDatabaseRollbackIndexProjectionsReady(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publication: ProjectionSetPublication,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [publication.tenantId, publication.knowledgeSpaceId, publication.id],
    sql: `SELECT pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AS ${quoteDatabaseIdentifier(database, "component_key")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} pm LEFT JOIN ${quoteDatabaseIdentifier(
      database,
      "index_projections",
    )} ip ON ip.${quoteDatabaseIdentifier(database, "id")} = pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AND ip.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND ip.${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} AND ip.${quoteDatabaseIdentifier(database, "status")} = 'ready' WHERE pm.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
      database,
      "component_type",
    )} = 'index-projection' AND ip.${quoteDatabaseIdentifier(database, "id")} IS NULL LIMIT 1;`,
    tableName: "index_projections",
  });
  if (result.rows[0]) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

async function requireDatabaseRollbackPageIndexReady(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publication: ProjectionSetPublication,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [publication.tenantId, publication.knowledgeSpaceId, publication.id],
    sql: `SELECT pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AS ${quoteDatabaseIdentifier(database, "component_key")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} pm LEFT JOIN ${quoteDatabaseIdentifier(
      database,
      "page_index_manifests",
    )} pim ON pim.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND pim.${quoteDatabaseIdentifier(
      database,
      "document_outline_id",
    )} = pm.${quoteDatabaseIdentifier(database, "component_key")} AND pim.${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = pm.${quoteDatabaseIdentifier(database, "generation_id")} AND pim.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} AND pim.${quoteDatabaseIdentifier(
      database,
      "document_version",
    )} = (SELECT lineage_o.${quoteDatabaseIdentifier(
      database,
      "version",
    )} FROM ${quoteDatabaseIdentifier(
      database,
      "document_outlines",
    )} lineage_o WHERE lineage_o.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AND lineage_o.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND lineage_o.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} AND lineage_o.${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} LIMIT 1) AND pim.${quoteDatabaseIdentifier(database, "status")} = 'ready' AND pim.${quoteDatabaseIdentifier(
      database,
      "tokenizer_version",
    )} = '${PageIndexTokenizerVersion}' AND pim.${quoteDatabaseIdentifier(
      database,
      "checksum",
    )} IS NOT NULL AND CHAR_LENGTH(pim.${quoteDatabaseIdentifier(
      database,
      "checksum",
    )}) = 64 AND pim.${quoteDatabaseIdentifier(
      database,
      "node_count",
    )} > 0 AND pim.${quoteDatabaseIdentifier(
      database,
      "node_count",
    )} = (SELECT COUNT(*) FROM ${quoteDatabaseIdentifier(
      database,
      "page_index_nodes",
    )} pin WHERE pin.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} = pim.${quoteDatabaseIdentifier(database, "id")}) AND pim.${quoteDatabaseIdentifier(
      database,
      "term_count",
    )} > 0 AND pim.${quoteDatabaseIdentifier(
      database,
      "term_count",
    )} = (SELECT COUNT(*) FROM ${quoteDatabaseIdentifier(
      database,
      "page_index_terms",
    )} pit WHERE pit.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} = pim.${quoteDatabaseIdentifier(database, "id")} AND pit.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pim.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )}) AND NOT EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
      database,
      "page_index_terms",
    )} closure_t LEFT JOIN ${quoteDatabaseIdentifier(
      database,
      "page_index_nodes",
    )} closure_n ON closure_n.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = closure_t.${quoteDatabaseIdentifier(
      database,
      "page_index_node_id",
    )} WHERE closure_t.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} = pim.${quoteDatabaseIdentifier(database, "id")} AND (closure_n.${quoteDatabaseIdentifier(
      database,
      "id",
    )} IS NULL OR closure_t.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} <> pim.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} OR closure_n.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} <> pim.${quoteDatabaseIdentifier(
      database,
      "id",
    )})) WHERE pm.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
      database,
      "component_type",
    )} = 'document-outline' AND pim.${quoteDatabaseIdentifier(database, "id")} IS NULL LIMIT 1;`,
    tableName: "page_index_manifests",
  });
  if (result.rows[0]) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

async function databasePublishDocumentCompilationCandidate(
  database: DatabaseAdapter,
  input: PublishDocumentCompilationCandidateInput,
): Promise<PublishProjectionSetResult> {
  const expectedHeadRevision = validateAdvancableHeadRevision(input.expectedHeadRevision);
  const updatedAt = canonicalDateTime(input.updatedAt, "updatedAt");
  const fence = normalizeDocumentCompilationPublicationFence(input.attemptFence);

  return database.transaction(async (transaction) => {
    // Deletion requests acquire this exact tenant+space row lock before inserting a tombstone.
    // Taking it first establishes one lock order for both operations and closes the
    // tombstone-probe/head-CAS check-then-act window.
    await requireDatabaseActiveKnowledgeSpacePublicationFence(database, transaction, input);
    const permissionFence = await requireDatabaseDocumentCompilationPublicationFence(
      database,
      transaction,
      input,
      fence,
    );
    // A worker may keep a valid attempt lease after its initiating member, policy, API access, or
    // API key has been revoked. Revalidate the exact durable permission provenance while the space
    // and attempt rows are locked, before reading or mutating any publication-owned aggregate.
    await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: transaction,
      fence: permissionFence,
      now: updatedAt,
      requiredAccess: "write",
    });
    let head = await databaseGetHead(database, transaction, input, true);
    assertExpectedHeadRevision(head, expectedHeadRevision);

    const candidate = await requireDatabasePublication(database, transaction, input, true);
    if (!head) {
      head = await databaseGetHead(database, transaction, input, true);
      assertExpectedHeadRevision(head, expectedHeadRevision);
    }
    if (candidate.status !== "candidate") {
      throw new ProjectionSetPublicationTransitionError(
        `Document compilation candidate cannot publish from ${candidate.status}`,
      );
    }
    if (candidate.id !== fence.candidatePublicationId) {
      throw new ProjectionSetPublicationAttemptFenceConflictError();
    }

    const profiles = await requireDatabaseDocumentCompilationProfileFence(
      database,
      transaction,
      input,
      fence,
    );
    const candidateMembers = await requireDatabaseDocumentCompilationMemberSnapshot(
      database,
      transaction,
      candidate,
      input.expectedMembers,
    );
    await requireDatabaseDocumentCompilationTargetClosure(
      database,
      transaction,
      candidate,
      candidateMembers,
    );
    // Candidate projections remain invisible as `building` throughout shadow evaluation. Promote
    // exactly the fixed candidate membership inside this transaction, then prove every published
    // projection member is ready before any publication/head row becomes visible. A later CAS
    // conflict rolls this promotion back with the rest of the transaction.
    await promoteDatabaseDocumentCompilationProjections(
      database,
      transaction,
      candidate,
      updatedAt,
    );
    await promoteDatabaseDocumentCompilationPageIndexes(
      database,
      transaction,
      candidate,
      updatedAt,
    );
    // Research readers require the exact published asset revision to be parsed. Change the asset
    // state in the same transaction as projection promotion and the head CAS so no committed head
    // can temporarily point at a PageIndex corpus that is hidden by parser_status.
    await markDatabaseDocumentCompilationAssetParsed(
      database,
      transaction,
      candidate,
      fence,
      updatedAt,
    );
    // Deletion requests and publication both lock the stable knowledge-space row first. This
    // final in-transaction probe therefore linearizes tombstone insertion against the head CAS;
    // an application-level preflight alone would leave a check-then-publish race.
    await requireDatabaseNoDocumentCompilationDeletionFence(database, transaction, candidate);

    const validating = await databaseUpdatePublication(database, transaction, candidate, {
      status: "validating",
      updatedAt,
    });
    const superseded = head
      ? await databaseUpdatePublication(database, transaction, head.publication, {
          status: "superseded",
          supersededByFingerprint: validating.fingerprint,
          updatedAt,
        })
      : undefined;
    const published = await databaseUpdatePublication(database, transaction, validating, {
      status: "published",
      supersededByFingerprint: null,
      updatedAt,
    });
    // Runtime reads publication and profile identity as one activated tuple. Persist that tuple
    // after every fixed-snapshot/fence check, but before the publication-head CAS. The transaction
    // makes the binding and head visible together and rolls both back if the CAS loses.
    await bindDatabaseDocumentCompilationPublicationProfiles(
      database,
      transaction,
      published,
      profiles,
      updatedAt,
    );
    const headRevision = await databaseAdvanceHead(
      database,
      transaction,
      published,
      expectedHeadRevision,
      updatedAt,
    );
    const logicalDocumentFence =
      input.logicalDocumentFence ??
      (await resolveDatabaseLogicalDocumentFence(database, transaction, input));
    if (logicalDocumentFence) {
      await materializeDatabaseLogicalDocumentChunks(
        database,
        transaction,
        input,
        logicalDocumentFence,
        updatedAt,
      );
      await activateDatabaseLogicalDocumentRevision(
        database,
        transaction,
        input,
        logicalDocumentFence,
        updatedAt,
      );
    }
    await activateDatabaseDocumentSettingsMutation(
      database,
      transaction,
      input,
      published,
      updatedAt,
    );
    await activateDatabaseDocumentChunkMutation(database, transaction, input, published, updatedAt);

    return {
      headRevision,
      published: toPublishedPublication(published, headRevision),
      ...(superseded ? { superseded } : {}),
    };
  });
}

async function resolveDatabaseLogicalDocumentFence(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: PublishDocumentCompilationCandidateInput,
): Promise<LogicalDocumentPublicationFence | null> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.attemptFence.attemptId,
      input.attemptFence.documentAssetId,
      input.attemptFence.documentVersion,
    ],
    sql: `SELECT ${[
      "document_id",
      "revision",
      "expected_active_revision",
      "expected_document_row_version",
    ]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")} FROM ${quoteDatabaseIdentifier(
      database,
      "document_revisions",
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "compilation_attempt_id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "document_asset_version",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "state",
    )} = 'candidate' LIMIT 1 FOR UPDATE;`,
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
}

async function promoteDatabaseDocumentCompilationPageIndexes(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
  updatedAt: string,
): Promise<void> {
  const scopeParams = [
    candidate.tenantId,
    candidate.knowledgeSpaceId,
    candidate.id,
  ] satisfies readonly DatabaseQueryValue[];
  const update: DatabaseExecuteInput =
    database.dialect === "postgres"
      ? {
          maxRows: 0,
          operation: "update",
          params: [...scopeParams, updatedAt],
          sql: `UPDATE ${quoteDatabaseIdentifier(
            database,
            "page_index_manifests",
          )} pim SET ${quoteDatabaseIdentifier(database, "status")} = 'ready', ${quoteDatabaseIdentifier(
            database,
            "updated_at",
          )} = ${databasePlaceholder(database, 4)} FROM ${quoteDatabaseIdentifier(
            database,
            publicationMemberTableName,
          )} pm WHERE pm.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = ${databasePlaceholder(database, 1)} AND pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
            database,
            "publication_id",
          )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
            database,
            "component_type",
          )} = 'document-outline' AND pim.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} AND pim.${quoteDatabaseIdentifier(
            database,
            "document_outline_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "component_key",
          )} AND pim.${quoteDatabaseIdentifier(
            database,
            "publication_generation_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "generation_id",
          )}${pageIndexMemberManifestLineageSql(
            database,
            "pim",
            "pm",
          )} AND pim.${quoteDatabaseIdentifier(database, "status")} = 'building';`,
          tableName: "page_index_manifests",
        }
      : {
          maxRows: 0,
          operation: "update",
          params: [updatedAt, ...scopeParams],
          sql: `UPDATE ${quoteDatabaseIdentifier(
            database,
            "page_index_manifests",
          )} pim JOIN ${quoteDatabaseIdentifier(
            database,
            publicationMemberTableName,
          )} pm ON pim.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} AND pim.${quoteDatabaseIdentifier(
            database,
            "document_outline_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "component_key",
          )} AND pim.${quoteDatabaseIdentifier(
            database,
            "publication_generation_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "generation_id",
          )}${pageIndexMemberManifestLineageSql(
            database,
            "pim",
            "pm",
          )} SET pim.${quoteDatabaseIdentifier(database, "status")} = 'ready', pim.${quoteDatabaseIdentifier(
            database,
            "updated_at",
          )} = ${databasePlaceholder(database, 1)} WHERE pm.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
            database,
            "publication_id",
          )} = ${databasePlaceholder(database, 4)} AND pm.${quoteDatabaseIdentifier(
            database,
            "component_type",
          )} = 'document-outline' AND pim.${quoteDatabaseIdentifier(
            database,
            "status",
          )} = 'building';`,
          tableName: "page_index_manifests",
        };
  await transaction.execute(update);

  const invalid = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: scopeParams,
    sql: `SELECT pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AS ${quoteDatabaseIdentifier(database, "component_key")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} pm LEFT JOIN ${quoteDatabaseIdentifier(
      database,
      "page_index_manifests",
    )} pim ON pim.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND pim.${quoteDatabaseIdentifier(
      database,
      "document_outline_id",
    )} = pm.${quoteDatabaseIdentifier(database, "component_key")} AND pim.${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = pm.${quoteDatabaseIdentifier(database, "generation_id")} AND pim.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} AND pim.${quoteDatabaseIdentifier(
      database,
      "document_version",
    )} = (SELECT lineage_o.${quoteDatabaseIdentifier(
      database,
      "version",
    )} FROM ${quoteDatabaseIdentifier(
      database,
      "document_outlines",
    )} lineage_o WHERE lineage_o.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AND lineage_o.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND lineage_o.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} AND lineage_o.${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} LIMIT 1) AND pim.${quoteDatabaseIdentifier(database, "status")} = 'ready' AND pim.${quoteDatabaseIdentifier(
      database,
      "tokenizer_version",
    )} = '${PageIndexTokenizerVersion}' AND pim.${quoteDatabaseIdentifier(
      database,
      "checksum",
    )} IS NOT NULL AND CHAR_LENGTH(pim.${quoteDatabaseIdentifier(
      database,
      "checksum",
    )}) = 64 AND pim.${quoteDatabaseIdentifier(
      database,
      "node_count",
    )} > 0 AND pim.${quoteDatabaseIdentifier(
      database,
      "node_count",
    )} = (SELECT COUNT(*) FROM ${quoteDatabaseIdentifier(
      database,
      "page_index_nodes",
    )} pin WHERE pin.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} = pim.${quoteDatabaseIdentifier(database, "id")}) AND pim.${quoteDatabaseIdentifier(
      database,
      "term_count",
    )} > 0 AND pim.${quoteDatabaseIdentifier(
      database,
      "term_count",
    )} = (SELECT COUNT(*) FROM ${quoteDatabaseIdentifier(
      database,
      "page_index_terms",
    )} pit WHERE pit.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} = pim.${quoteDatabaseIdentifier(database, "id")} AND pit.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pim.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )}) AND NOT EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
      database,
      "page_index_terms",
    )} closure_t LEFT JOIN ${quoteDatabaseIdentifier(
      database,
      "page_index_nodes",
    )} closure_n ON closure_n.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = closure_t.${quoteDatabaseIdentifier(
      database,
      "page_index_node_id",
    )} WHERE closure_t.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} = pim.${quoteDatabaseIdentifier(database, "id")} AND (closure_n.${quoteDatabaseIdentifier(
      database,
      "id",
    )} IS NULL OR closure_t.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} <> pim.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} OR closure_n.${quoteDatabaseIdentifier(
      database,
      "manifest_id",
    )} <> pim.${quoteDatabaseIdentifier(
      database,
      "id",
    )})) WHERE pm.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
      database,
      "component_type",
    )} = 'document-outline' AND pim.${quoteDatabaseIdentifier(database, "id")} IS NULL LIMIT 1;`,
    tableName: "page_index_manifests",
  });
  if (invalid.rows[0]) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

function pageIndexMemberManifestLineageSql(
  database: DatabaseAdapter,
  manifestAlias: string,
  memberAlias: string,
): string {
  const manifest = (column: string) =>
    `${manifestAlias}.${quoteDatabaseIdentifier(database, column)}`;
  const member = (column: string) => `${memberAlias}.${quoteDatabaseIdentifier(database, column)}`;
  return ` AND ${manifest("document_asset_id")} = ${member(
    "document_asset_id",
  )} AND ${manifest("document_version")} = (SELECT lineage_o.${quoteDatabaseIdentifier(
    database,
    "version",
  )} FROM ${quoteDatabaseIdentifier(
    database,
    "document_outlines",
  )} lineage_o WHERE lineage_o.${quoteDatabaseIdentifier(database, "id")} = ${member(
    "component_key",
  )} AND lineage_o.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${member(
    "knowledge_space_id",
  )} AND lineage_o.${quoteDatabaseIdentifier(database, "document_asset_id")} = ${member(
    "document_asset_id",
  )} AND lineage_o.${quoteDatabaseIdentifier(database, "publication_generation_id")} = ${member(
    "generation_id",
  )} LIMIT 1)`;
}

async function markDatabaseDocumentCompilationAssetParsed(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
  fence: DocumentCompilationPublicationFence,
  updatedAt: string,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [updatedAt, fence.documentAssetId, candidate.knowledgeSpaceId, fence.documentVersion],
    sql: `UPDATE ${quoteDatabaseIdentifier(
      database,
      "document_assets",
    )} SET ${quoteDatabaseIdentifier(database, "parser_status")} = 'parsed', ${quoteDatabaseIdentifier(
      database,
      "updated_at",
    )} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "version",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "lifecycle_state",
    )} = 'active' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL;`,
    tableName: "document_assets",
  });
  if (result.rowsAffected !== 1) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

async function requireDatabaseNoDocumentCompilationDeletionFence(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [candidate.tenantId, candidate.knowledgeSpaceId, candidate.id],
    sql: `SELECT dt.${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
      database,
      "deletion_tombstones",
    )} dt WHERE dt.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND dt.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ((dt.${quoteDatabaseIdentifier(
      database,
      "target_type",
    )} = 'knowledge_space' AND dt.${quoteDatabaseIdentifier(
      database,
      "target_id",
    )} = ${databasePlaceholder(database, 2)}) OR (dt.${quoteDatabaseIdentifier(
      database,
      "target_type",
    )} = 'source' AND EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} pm INNER JOIN ${quoteDatabaseIdentifier(
      database,
      "document_assets",
    )} da ON da.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND da.${quoteDatabaseIdentifier(database, "id")} = pm.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} WHERE pm.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND da.${quoteDatabaseIdentifier(
      database,
      "source_id",
    )} = dt.${quoteDatabaseIdentifier(database, "target_id")})) OR (dt.${quoteDatabaseIdentifier(
      database,
      "target_type",
    )} = 'document_asset' AND EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} pm WHERE pm.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = dt.${quoteDatabaseIdentifier(database, "target_id")})) OR (dt.${quoteDatabaseIdentifier(
      database,
      "target_type",
    )} = 'logical_document' AND EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} pm INNER JOIN ${quoteDatabaseIdentifier(
      database,
      "document_revisions",
    )} revision ON revision.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = pm.${quoteDatabaseIdentifier(database, "tenant_id")} AND revision.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND revision.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = pm.${quoteDatabaseIdentifier(database, "document_asset_id")} WHERE pm.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND revision.${quoteDatabaseIdentifier(
      database,
      "document_id",
    )} = dt.${quoteDatabaseIdentifier(database, "target_id")}))) LIMIT 1;`,
    tableName: "deletion_tombstones",
  });
  if (result.rows[0]) {
    throw new ProjectionSetPublicationDeletionFenceConflictError();
  }
}

async function requireDatabaseActiveKnowledgeSpacePublicationFence(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publication: Pick<ProjectionSetPublication, "knowledgeSpaceId" | "tenantId">,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [publication.tenantId, publication.knowledgeSpaceId],
    sql: `SELECT ${["id", "lifecycle_state", "deletion_job_id"]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")} FROM ${quoteDatabaseIdentifier(
      database,
      knowledgeSpaceTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      2,
    )} LIMIT 1 FOR UPDATE;`,
    tableName: knowledgeSpaceTableName,
  });
  const row = result.rows[0];
  if (!row) {
    throw new ProjectionSetPublicationKnowledgeSpaceNotFoundError(publication.knowledgeSpaceId);
  }
  if (
    stringColumn(row, "lifecycle_state") !== "active" ||
    optionalStringColumn(row, "deletion_job_id")
  ) {
    throw new ProjectionSetPublicationDeletionFenceConflictError();
  }
}

async function promoteDatabaseDocumentCompilationProjections(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
  updatedAt: string,
): Promise<void> {
  const scopeParams = [
    candidate.tenantId,
    candidate.knowledgeSpaceId,
    candidate.id,
  ] satisfies readonly DatabaseQueryValue[];
  const updateInput: DatabaseExecuteInput =
    database.dialect === "postgres"
      ? {
          maxRows: 0,
          operation: "update",
          params: [...scopeParams, updatedAt],
          sql: `UPDATE ${quoteDatabaseIdentifier(
            database,
            "index_projections",
          )} ip SET ${quoteDatabaseIdentifier(database, "status")} = 'ready', ${quoteDatabaseIdentifier(
            database,
            "updated_at",
          )} = ${databasePlaceholder(database, 4)} FROM ${quoteDatabaseIdentifier(
            database,
            publicationMemberTableName,
          )} pm WHERE pm.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = ${databasePlaceholder(database, 1)} AND pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
            database,
            "publication_id",
          )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
            database,
            "component_type",
          )} = 'index-projection' AND ip.${quoteDatabaseIdentifier(
            database,
            "id",
          )} = pm.${quoteDatabaseIdentifier(database, "component_key")} AND ip.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} AND ip.${quoteDatabaseIdentifier(
            database,
            "publication_generation_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "generation_id",
          )} AND ip.${quoteDatabaseIdentifier(database, "status")} = 'building';`,
          tableName: "index_projections",
        }
      : {
          maxRows: 0,
          operation: "update",
          params: [updatedAt, ...scopeParams],
          sql: `UPDATE ${quoteDatabaseIdentifier(
            database,
            "index_projections",
          )} ip JOIN ${quoteDatabaseIdentifier(
            database,
            publicationMemberTableName,
          )} pm ON ip.${quoteDatabaseIdentifier(database, "id")} = pm.${quoteDatabaseIdentifier(
            database,
            "component_key",
          )} AND ip.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} AND ip.${quoteDatabaseIdentifier(
            database,
            "publication_generation_id",
          )} = pm.${quoteDatabaseIdentifier(
            database,
            "generation_id",
          )} SET ip.${quoteDatabaseIdentifier(database, "status")} = 'ready', ip.${quoteDatabaseIdentifier(
            database,
            "updated_at",
          )} = ${databasePlaceholder(database, 1)} WHERE pm.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
            database,
            "publication_id",
          )} = ${databasePlaceholder(database, 4)} AND pm.${quoteDatabaseIdentifier(
            database,
            "component_type",
          )} = 'index-projection' AND ip.${quoteDatabaseIdentifier(database, "status")} = 'building';`,
          tableName: "index_projections",
        };
  await transaction.execute(updateInput);

  const invalid = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: scopeParams,
    sql: `SELECT pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AS ${quoteDatabaseIdentifier(database, "component_key")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} pm LEFT JOIN ${quoteDatabaseIdentifier(
      database,
      "index_projections",
    )} ip ON ip.${quoteDatabaseIdentifier(database, "id")} = pm.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AND ip.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND ip.${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = pm.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} WHERE pm.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND pm.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND pm.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND pm.${quoteDatabaseIdentifier(
      database,
      "component_type",
    )} = 'index-projection' AND (ip.${quoteDatabaseIdentifier(
      database,
      "id",
    )} IS NULL OR ip.${quoteDatabaseIdentifier(database, "status")} <> 'ready') LIMIT 1;`,
    tableName: "index_projections",
  });
  if (invalid.rows[0]) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
}

async function requireDatabaseDocumentCompilationPublicationFence(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: PublishDocumentCompilationCandidateInput,
  fence: DocumentCompilationPublicationFence,
): Promise<DatabaseKnowledgeSpacePermissionFence> {
  const params: DatabaseQueryValue[] = [
    fence.attemptId,
    tenantIdValue(input.tenantId),
    UuidSchema.parse(input.knowledgeSpaceId),
    fence.documentAssetId,
    fence.documentVersion,
    fence.publicationGenerationId,
    validateAdvancableHeadRevision(input.expectedHeadRevision),
    fence.candidatePublicationId,
    ProjectionSetFingerprintSchema.parse(input.fingerprint),
    fence.expectedRowVersion,
    fence.leaseToken,
  ];
  const databaseNow =
    database.dialect === "postgres" ? "clock_timestamp()" : "CURRENT_TIMESTAMP(3)";
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${[
      "id",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "access_channel",
      "requested_by_subject_id",
    ]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")} FROM ${quoteDatabaseIdentifier(
      database,
      documentCompilationAttemptTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      3,
    )} AND ${quoteDatabaseIdentifier(database, "document_asset_id")} = ${databasePlaceholder(
      database,
      4,
    )} AND ${quoteDatabaseIdentifier(database, "document_version")} = ${databasePlaceholder(
      database,
      5,
    )} AND ${quoteDatabaseIdentifier(database, "publication_generation_id")} = ${databasePlaceholder(
      database,
      6,
    )} AND ${quoteDatabaseIdentifier(database, "base_head_revision")} = ${databasePlaceholder(
      database,
      7,
    )} AND ${quoteDatabaseIdentifier(database, "candidate_publication_id")} = ${databasePlaceholder(
      database,
      8,
    )} AND ${quoteDatabaseIdentifier(database, "candidate_fingerprint")} = ${databasePlaceholder(
      database,
      9,
    )} AND ${quoteDatabaseIdentifier(database, "row_version")} = ${databasePlaceholder(
      database,
      10,
    )} AND ${quoteDatabaseIdentifier(database, "lease_token")} = ${databasePlaceholder(
      database,
      11,
    )} AND ${quoteDatabaseIdentifier(database, "run_state")} = 'running' AND ${quoteDatabaseIdentifier(
      database,
      "active_slot",
    )} = 1 AND ${quoteDatabaseIdentifier(database, "checkpoint")} IN ('projection_built', 'smoke_eval_passed') AND ${quoteDatabaseIdentifier(
      database,
      "lease_expires_at",
    )} > ${databaseNow} LIMIT 1 FOR UPDATE;`,
    tableName: documentCompilationAttemptTableName,
  });
  if (!result.rows[0]) {
    throw new ProjectionSetPublicationAttemptFenceConflictError();
  }
  try {
    const permissionSnapshotId = UuidSchema.parse(
      stringColumn(result.rows[0], "permission_snapshot_id"),
    );
    const permissionSnapshotRevision = numberColumn(result.rows[0], "permission_snapshot_revision");
    const accessChannel = stringColumn(result.rows[0], "access_channel");
    const requestedBySubjectId = stringColumn(result.rows[0], "requested_by_subject_id");
    if (
      !Number.isInteger(permissionSnapshotRevision) ||
      permissionSnapshotRevision < 1 ||
      (accessChannel !== "interactive" &&
        accessChannel !== "service_api" &&
        accessChannel !== "mcp" &&
        accessChannel !== "agent") ||
      !requestedBySubjectId.trim() ||
      requestedBySubjectId.length > 255
    ) {
      throw new Error("Invalid document compilation permission provenance");
    }
    return {
      accessChannel,
      knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
      permissionSnapshotId,
      permissionSnapshotRevision,
      requestedBySubjectId,
      tenantId: tenantIdValue(input.tenantId),
    };
  } catch {
    // Legacy all-null provenance and partially persisted bindings are intentionally not trusted.
    // There is no durable trusted-internal marker on an attempt, so publication must fail closed.
    throw new ProjectionSetPublicationAttemptFenceConflictError();
  }
}

/**
 * Compares both mutable profile heads with the immutable refs on the attempt. Retrieval is
 * mandatory; embedding is either an exact match or absent on both the attempt and active heads for
 * a Research-only space. The transaction already owns the stable knowledge-space row lock, which
 * every profile activation also acquires, so this read is serialized without locking the nullable
 * side of a PostgreSQL outer join.
 */
async function requireDatabaseDocumentCompilationProfileFence(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: PublishDocumentCompilationCandidateInput,
  fence: DocumentCompilationPublicationFence,
): Promise<DocumentCompilationPublicationProfileSnapshot> {
  const params: DatabaseQueryValue[] = [
    fence.attemptId,
    tenantIdValue(input.tenantId),
    UuidSchema.parse(input.knowledgeSpaceId),
  ];
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT a.${quoteDatabaseIdentifier(database, "id")}, a.${quoteDatabaseIdentifier(
      database,
      "embedding_profile_kind",
    )}, a.${quoteDatabaseIdentifier(
      database,
      "embedding_profile_revision_id",
    )}, a.${quoteDatabaseIdentifier(
      database,
      "embedding_profile_revision",
    )}, a.${quoteDatabaseIdentifier(
      database,
      "embedding_profile_snapshot_digest",
    )}, a.${quoteDatabaseIdentifier(
      database,
      "retrieval_profile_revision_id",
    )}, a.${quoteDatabaseIdentifier(
      database,
      "retrieval_profile_revision",
    )}, a.${quoteDatabaseIdentifier(
      database,
      "retrieval_profile_snapshot_digest",
    )} FROM ${quoteDatabaseIdentifier(
      database,
      documentCompilationAttemptTableName,
    )} a INNER JOIN ${quoteDatabaseIdentifier(
      database,
      profileHeadTableName,
    )} rh ON rh.${quoteDatabaseIdentifier(database, "tenant_id")} = a.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} AND rh.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = a.${quoteDatabaseIdentifier(database, "knowledge_space_id")} AND rh.${quoteDatabaseIdentifier(
      database,
      "kind",
    )} = a.${quoteDatabaseIdentifier(database, "retrieval_profile_kind")} AND rh.${quoteDatabaseIdentifier(
      database,
      "profile_revision_id",
    )} = a.${quoteDatabaseIdentifier(database, "retrieval_profile_revision_id")} AND rh.${quoteDatabaseIdentifier(
      database,
      "active_revision",
    )} = a.${quoteDatabaseIdentifier(database, "retrieval_profile_revision")} INNER JOIN ${quoteDatabaseIdentifier(
      database,
      profileRevisionTableName,
    )} rr ON rr.${quoteDatabaseIdentifier(database, "tenant_id")} = a.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} AND rr.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = a.${quoteDatabaseIdentifier(database, "knowledge_space_id")} AND rr.${quoteDatabaseIdentifier(
      database,
      "kind",
    )} = a.${quoteDatabaseIdentifier(database, "retrieval_profile_kind")} AND rr.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = a.${quoteDatabaseIdentifier(database, "retrieval_profile_revision_id")} AND rr.${quoteDatabaseIdentifier(
      database,
      "revision",
    )} = a.${quoteDatabaseIdentifier(database, "retrieval_profile_revision")} AND rr.${quoteDatabaseIdentifier(
      database,
      "snapshot_digest",
    )} = a.${quoteDatabaseIdentifier(database, "retrieval_profile_snapshot_digest")} AND rr.${quoteDatabaseIdentifier(
      database,
      "state",
    )} = 'active' WHERE a.${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      1,
    )} AND a.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND a.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      3,
    )} AND a.${quoteDatabaseIdentifier(
      database,
      "retrieval_profile_kind",
    )} = 'retrieval' LIMIT 1 FOR UPDATE;`,
    tableName: profileHeadTableName,
  });
  const attemptRow = result.rows[0];
  if (!attemptRow) {
    throw new ProjectionSetPublicationProfileFenceConflictError();
  }

  const retrieval = documentCompilationPublicationProfileReference(attemptRow, "retrieval_profile");

  const embeddingKind = optionalStringColumn(attemptRow, "embedding_profile_kind");
  const embeddingRevisionId = optionalStringColumn(attemptRow, "embedding_profile_revision_id");
  const embeddingRevision = optionalNumberColumn(attemptRow, "embedding_profile_revision");
  const embeddingSnapshotDigest = optionalStringColumn(
    attemptRow,
    "embedding_profile_snapshot_digest",
  );
  const hasAnyEmbeddingReference =
    embeddingKind !== undefined ||
    embeddingRevisionId !== undefined ||
    embeddingRevision !== undefined ||
    embeddingSnapshotDigest !== undefined;
  if (!hasAnyEmbeddingReference) {
    const unexpectedEmbeddingHead = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [tenantIdValue(input.tenantId), UuidSchema.parse(input.knowledgeSpaceId)],
      sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
        database,
        profileHeadTableName,
      )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
        database,
        1,
      )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
        database,
        2,
      )} AND ${quoteDatabaseIdentifier(database, "kind")} = 'embedding' LIMIT 1 FOR UPDATE;`,
      tableName: profileHeadTableName,
    });
    if (unexpectedEmbeddingHead.rows[0]) {
      throw new ProjectionSetPublicationProfileFenceConflictError();
    }
    return { retrieval };
  }
  if (
    embeddingKind !== "embedding" ||
    !embeddingRevisionId ||
    embeddingRevision === undefined ||
    !embeddingSnapshotDigest
  ) {
    throw new ProjectionSetPublicationProfileFenceConflictError();
  }

  const embedding = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [
      tenantIdValue(input.tenantId),
      UuidSchema.parse(input.knowledgeSpaceId),
      UuidSchema.parse(embeddingRevisionId),
      validatePositiveInteger(embeddingRevision, "embeddingProfileRevision"),
      embeddingSnapshotDigest,
    ],
    sql: `SELECT eh.${quoteDatabaseIdentifier(database, "id")}, er.${quoteDatabaseIdentifier(
      database,
      "vector_space_id",
    )} FROM ${quoteDatabaseIdentifier(
      database,
      profileHeadTableName,
    )} eh INNER JOIN ${quoteDatabaseIdentifier(
      database,
      profileRevisionTableName,
    )} er ON er.${quoteDatabaseIdentifier(database, "tenant_id")} = eh.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} AND er.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = eh.${quoteDatabaseIdentifier(database, "knowledge_space_id")} AND er.${quoteDatabaseIdentifier(
      database,
      "kind",
    )} = eh.${quoteDatabaseIdentifier(database, "kind")} AND er.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = eh.${quoteDatabaseIdentifier(database, "profile_revision_id")} AND er.${quoteDatabaseIdentifier(
      database,
      "revision",
    )} = eh.${quoteDatabaseIdentifier(database, "active_revision")} WHERE eh.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND eh.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND eh.${quoteDatabaseIdentifier(
      database,
      "kind",
    )} = 'embedding' AND eh.${quoteDatabaseIdentifier(
      database,
      "profile_revision_id",
    )} = ${databasePlaceholder(database, 3)} AND eh.${quoteDatabaseIdentifier(
      database,
      "active_revision",
    )} = ${databasePlaceholder(database, 4)} AND er.${quoteDatabaseIdentifier(
      database,
      "snapshot_digest",
    )} = ${databasePlaceholder(database, 5)} AND er.${quoteDatabaseIdentifier(
      database,
      "state",
    )} = 'active' LIMIT 1 FOR UPDATE;`,
    tableName: profileHeadTableName,
  });
  if (!embedding.rows[0]) {
    throw new ProjectionSetPublicationProfileFenceConflictError();
  }
  const vectorSpaceId = optionalStringColumn(embedding.rows[0], "vector_space_id");
  if (!vectorSpaceId) {
    throw new ProjectionSetPublicationProfileFenceConflictError();
  }
  return {
    embedding: {
      revision: embeddingRevision,
      revisionId: UuidSchema.parse(embeddingRevisionId),
      snapshotDigest: documentCompilationProfileDigest(embeddingSnapshotDigest),
      vectorSpaceId,
    },
    retrieval,
  };
}

function documentCompilationPublicationProfileReference(
  row: DatabaseRow,
  prefix: "retrieval_profile",
): DocumentCompilationPublicationProfileReference {
  try {
    const revisionId = optionalStringColumn(row, `${prefix}_revision_id`);
    const revision = optionalNumberColumn(row, `${prefix}_revision`);
    const snapshotDigest = optionalStringColumn(row, `${prefix}_snapshot_digest`);
    if (!revisionId || revision === undefined || !snapshotDigest) {
      throw new ProjectionSetPublicationProfileFenceConflictError();
    }
    return {
      revision: validatePositiveInteger(revision, `${prefix}Revision`),
      revisionId: UuidSchema.parse(revisionId),
      snapshotDigest: documentCompilationProfileDigest(snapshotDigest),
    };
  } catch (error) {
    if (error instanceof ProjectionSetPublicationProfileFenceConflictError) throw error;
    throw new ProjectionSetPublicationProfileFenceConflictError();
  }
}

function documentCompilationProfileDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ProjectionSetPublicationProfileFenceConflictError();
  }
  return value;
}

async function bindDatabaseDocumentCompilationPublicationProfiles(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publication: ProjectionSetPublication,
  profiles: DocumentCompilationPublicationProfileSnapshot,
  activatedAt: string,
): Promise<void> {
  const existing = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [publication.tenantId, publication.knowledgeSpaceId, publication.id],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      profilePublicationBindingTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} LIMIT 1 FOR UPDATE;`,
    tableName: profilePublicationBindingTableName,
  });
  if (existing.rows[0]) {
    if (
      isSameDatabaseDocumentCompilationPublicationBinding(existing.rows[0], publication, profiles)
    ) {
      return;
    }
    throw new ProjectionSetPublicationProfileBindingConflictError();
  }

  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "changed_kind",
    "binding_reason",
    "embedding_profile_kind",
    "embedding_profile_revision_id",
    "embedding_profile_revision",
    "embedding_profile_snapshot_digest",
    "retrieval_profile_kind",
    "retrieval_profile_revision_id",
    "retrieval_profile_revision",
    "retrieval_profile_snapshot_digest",
    "vector_space_id",
    "publication_id",
    "publication_fingerprint",
    "created_at",
    "activated_at",
  ] as const;
  const params = [
    publication.id,
    publication.tenantId,
    publication.knowledgeSpaceId,
    "content",
    "content-publication",
    profiles.embedding ? "embedding" : null,
    profiles.embedding?.revisionId ?? null,
    profiles.embedding?.revision ?? null,
    profiles.embedding?.snapshotDigest ?? null,
    "retrieval",
    profiles.retrieval.revisionId,
    profiles.retrieval.revision,
    profiles.retrieval.snapshotDigest,
    profiles.embedding?.vectorSpaceId ?? null,
    publication.id,
    publication.fingerprint,
    activatedAt,
    activatedAt,
  ] satisfies readonly DatabaseQueryValue[];
  const inserted = await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(
      database,
      profilePublicationBindingTableName,
    )} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES (${params
      .map((_, index) => databasePlaceholder(database, index + 1))
      .join(", ")});`,
    tableName: profilePublicationBindingTableName,
  });
  if (inserted.rowsAffected !== 1) {
    throw new ProjectionSetPublicationProfileBindingConflictError();
  }
}

function isSameDatabaseDocumentCompilationPublicationBinding(
  row: DatabaseRow,
  publication: ProjectionSetPublication,
  profiles: DocumentCompilationPublicationProfileSnapshot,
): boolean {
  try {
    const embeddingKind = optionalStringColumn(row, "embedding_profile_kind");
    const embeddingRevisionId = optionalStringColumn(row, "embedding_profile_revision_id");
    const embeddingRevision = optionalNumberColumn(row, "embedding_profile_revision");
    const embeddingDigest = optionalStringColumn(row, "embedding_profile_snapshot_digest");
    const vectorSpaceId = optionalStringColumn(row, "vector_space_id");
    const sameEmbedding = profiles.embedding
      ? embeddingKind === "embedding" &&
        embeddingRevisionId === profiles.embedding.revisionId &&
        embeddingRevision === profiles.embedding.revision &&
        embeddingDigest === profiles.embedding.snapshotDigest &&
        vectorSpaceId === profiles.embedding.vectorSpaceId
      : embeddingKind === undefined &&
        embeddingRevisionId === undefined &&
        embeddingRevision === undefined &&
        embeddingDigest === undefined &&
        vectorSpaceId === undefined;
    return (
      sameEmbedding &&
      stringColumn(row, "tenant_id") === publication.tenantId &&
      stringColumn(row, "knowledge_space_id") === publication.knowledgeSpaceId &&
      stringColumn(row, "changed_kind") === "content" &&
      stringColumn(row, "binding_reason") === "content-publication" &&
      stringColumn(row, "retrieval_profile_kind") === "retrieval" &&
      stringColumn(row, "retrieval_profile_revision_id") === profiles.retrieval.revisionId &&
      numberColumn(row, "retrieval_profile_revision") === profiles.retrieval.revision &&
      stringColumn(row, "retrieval_profile_snapshot_digest") ===
        profiles.retrieval.snapshotDigest &&
      stringColumn(row, "publication_id") === publication.id &&
      stringColumn(row, "publication_fingerprint") === publication.fingerprint &&
      optionalStringColumn(row, "activated_at") !== undefined
    );
  } catch {
    return false;
  }
}

async function requireDatabaseDocumentCompilationMemberSnapshot(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
  rawExpectedMembers: readonly DocumentCompilationPublicationMemberSnapshot[],
): Promise<readonly DocumentCompilationPublicationMemberSnapshot[]> {
  const expectedMembers = normalizeDocumentCompilationMemberSnapshot(rawExpectedMembers);
  const result = await transaction.execute({
    maxRows: expectedMembers.length + 1,
    operation: "select",
    params: [candidate.tenantId, candidate.knowledgeSpaceId, candidate.id],
    sql: `SELECT ${["component_key", "component_type", "document_asset_id", "generation_id"]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "publication_id")} = ${databasePlaceholder(
      database,
      3,
    )} ORDER BY ${quoteDatabaseIdentifier(database, "component_type")} ASC, ${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} ASC FOR UPDATE;`,
    tableName: publicationMemberTableName,
  });
  const actualMembers = normalizeDocumentCompilationMemberSnapshot(
    result.rows.map((row) => ({
      componentKey: stringColumn(row, "component_key"),
      componentType: stringColumn(
        row,
        "component_type",
      ) as DocumentCompilationPublicationMemberSnapshot["componentType"],
      documentAssetId: optionalStringColumn(row, "document_asset_id"),
      generationId: stringColumn(row, "generation_id"),
    })),
  );
  const actualIdentities = actualMembers.map(memberSnapshotIdentity);
  const expectedIdentities = expectedMembers.map(memberSnapshotIdentity);
  if (
    actualIdentities.length !== expectedIdentities.length ||
    actualIdentities.some((identity, index) => identity !== expectedIdentities[index])
  ) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }

  return actualMembers;
}

interface DocumentCompilationTargetRow {
  readonly componentKey: string;
  readonly documentAssetId: string;
  readonly generationId: string;
  readonly row: DatabaseRow;
}

const maximumDocumentCompilationGraphSourceNodes = 200_000;
const documentCompilationClosureBatchSize = 500;

/**
 * Revalidates and locks every polymorphic target after the member ledger is locked and before the
 * head CAS. Publication members deliberately cannot have relational foreign keys to six target
 * tables, so compose-time validation alone would leave a target-delete/generation-swap TOCTOU.
 */
async function requireDatabaseDocumentCompilationTargetClosure(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
  members: readonly DocumentCompilationPublicationMemberSnapshot[],
): Promise<void> {
  const outlines = await lockDocumentCompilationTargetRows({
    candidate,
    componentType: "document-outline",
    database,
    members,
    ownerJoin: "document_asset_id",
    tableName: "document_outlines",
    transaction,
  });
  const manifests = await lockDocumentCompilationTargetRows({
    candidate,
    componentType: "multimodal-manifest",
    database,
    members,
    ownerJoin: "document_asset_id",
    tableName: "document_multimodal_manifests",
    transaction,
  });
  const paths = await lockDocumentCompilationTargetRows({
    additionalTargetPredicate: (alias) =>
      `${alias}.${quoteDatabaseIdentifier(database, "resource_type")} = 'document'`,
    candidate,
    componentType: "knowledge-path",
    database,
    members,
    ownerJoin: "target_id",
    tableName: "knowledge_paths",
    transaction,
  });
  const projections = await lockDocumentCompilationTargetRows({
    additionalJoins: (memberAlias, targetAlias) =>
      ` JOIN ${quoteDatabaseIdentifier(
        database,
        "knowledge_nodes",
      )} closure_node ON closure_node.${quoteDatabaseIdentifier(
        database,
        "id",
      )} = ${targetAlias}.${quoteDatabaseIdentifier(
        database,
        "node_id",
      )} AND closure_node.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${memberAlias}.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} AND closure_node.${quoteDatabaseIdentifier(
        database,
        "publication_generation_id",
      )} = ${memberAlias}.${quoteDatabaseIdentifier(
        database,
        "generation_id",
      )} AND closure_node.${quoteDatabaseIdentifier(
        database,
        "document_asset_id",
      )} = ${memberAlias}.${quoteDatabaseIdentifier(database, "document_asset_id")}`,
    candidate,
    componentType: "index-projection",
    database,
    members,
    selectedTargetColumns: ["node_id"],
    tableName: "index_projections",
    transaction,
  });
  await requireDatabaseDocumentCompilationNodeProjectionClosure(
    database,
    transaction,
    candidate,
    members,
  );
  const entities = await lockDocumentCompilationTargetRows({
    candidate,
    componentType: "graph-entity",
    database,
    members,
    selectedTargetColumns: ["source_node_ids"],
    tableName: "graph_entities",
    transaction,
  });
  const relations = await lockDocumentCompilationTargetRows({
    candidate,
    componentType: "graph-relation",
    database,
    members,
    selectedTargetColumns: ["object_entity_id", "source_node_ids", "subject_entity_id"],
    tableName: "graph_relations",
    transaction,
  });

  // Keep these variables intentionally live: awaiting every loader is what locks even the simple
  // target types until the transaction commits.
  void outlines;
  void manifests;
  void paths;

  const entitiesById = new Map(entities.map((item) => [item.componentKey, item]));
  for (const relation of relations) {
    const subject = entitiesById.get(stringColumn(relation.row, "subject_entity_id"));
    const object = entitiesById.get(stringColumn(relation.row, "object_entity_id"));
    // Relations may connect entities inherited from other documents and generations. The endpoint
    // requirement is membership in this exact publication; each entity's own source-node closure
    // is validated against its own member owner/generation below.
    if (!subject || !object) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
  }

  const indexedNodeIds = new Set(projections.map((item) => stringColumn(item.row, "node_id")));
  const sourceOwners = new Map<
    string,
    { readonly documentAssetId: string; readonly generationId: string }
  >();
  for (const target of [...entities, ...relations]) {
    const sourceNodeIds = jsonStringArrayColumn(target.row, "source_node_ids");
    if (sourceNodeIds.length === 0) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
    for (const sourceNodeId of sourceNodeIds) {
      const normalizedNodeId = UuidSchema.parse(sourceNodeId);
      const existing = sourceOwners.get(normalizedNodeId);
      if (
        existing &&
        (existing.documentAssetId !== target.documentAssetId ||
          existing.generationId !== target.generationId)
      ) {
        throw new ProjectionSetPublicationCandidateSnapshotConflictError();
      }
      sourceOwners.set(normalizedNodeId, {
        documentAssetId: target.documentAssetId,
        generationId: target.generationId,
      });
      if (sourceOwners.size > maximumDocumentCompilationGraphSourceNodes) {
        throw new ProjectionSetPublicationCandidateSnapshotConflictError();
      }
      if (!indexedNodeIds.has(normalizedNodeId)) {
        throw new ProjectionSetPublicationCandidateSnapshotConflictError();
      }
    }
  }

  for (const nodeIds of chunkDocumentCompilationClosureValues(
    [...sourceOwners.keys()],
    documentCompilationClosureBatchSize,
  )) {
    const params: DatabaseQueryValue[] = [candidate.knowledgeSpaceId, ...nodeIds];
    const result = await transaction.execute({
      maxRows: nodeIds.length + 1,
      operation: "select",
      params,
      sql: `SELECT ${["id", "document_asset_id", "publication_generation_id"]
        .map((column) => quoteDatabaseIdentifier(database, column))
        .join(", ")} FROM ${quoteDatabaseIdentifier(
        database,
        "knowledge_nodes",
      )} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
        database,
        1,
      )} AND ${quoteDatabaseIdentifier(database, "id")} IN (${nodeIds
        .map((_, index) => databasePlaceholder(database, index + 2))
        .join(", ")}) ORDER BY ${quoteDatabaseIdentifier(database, "id")} ASC FOR UPDATE;`,
      tableName: "knowledge_nodes",
    });
    if (result.rows.length !== nodeIds.length) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
    for (const row of result.rows) {
      const nodeId = stringColumn(row, "id");
      const expected = sourceOwners.get(nodeId);
      if (
        !expected ||
        stringColumn(row, "document_asset_id") !== expected.documentAssetId ||
        stringColumn(row, "publication_generation_id") !== expected.generationId
      ) {
        throw new ProjectionSetPublicationCandidateSnapshotConflictError();
      }
    }
  }
}

interface DocumentCompilationNodeOwner {
  readonly documentAssetId: string;
  readonly generationId: string;
}

/**
 * Proves the reverse half of the publication closure. Validating only member -> target permits a
 * truncated receipt to omit every projection for one or more nodes. Here every node owned by a
 * document/generation represented in the candidate must point back to an exact candidate member
 * for both FTS and the currently selected text vector space. The rows are locked until the head
 * CAS commits, while the projection targets themselves were locked by the caller above.
 */
async function requireDatabaseDocumentCompilationNodeProjectionClosure(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
  members: readonly DocumentCompilationPublicationMemberSnapshot[],
): Promise<void> {
  const owners = new Map<string, DocumentCompilationNodeOwner>();
  for (const member of members) {
    if (!member.documentAssetId) {
      continue;
    }
    const owner = {
      documentAssetId: UuidSchema.parse(member.documentAssetId),
      generationId: PublicationGenerationIdSchema.parse(member.generationId),
    };
    owners.set(`${owner.documentAssetId}:${owner.generationId}`, owner);
  }
  if (owners.size === 0) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }

  const vectorSpaceId = await lockDatabaseDocumentCompilationVectorSpace(
    database,
    transaction,
    candidate,
  );
  let totalNodes = 0;
  for (const owner of owners.values()) {
    const params: DatabaseQueryValue[] = [];
    const bind = (value: DatabaseQueryValue) => {
      params.push(value);
      return databasePlaceholder(database, params.length);
    };
    const exactMemberProjection = (type: "dense-vector" | "fts", extra = "") =>
      `SELECT 1 FROM ${quoteDatabaseIdentifier(
        database,
        publicationMemberTableName,
      )} completeness_member JOIN ${quoteDatabaseIdentifier(
        database,
        "index_projections",
      )} completeness_projection ON completeness_projection.${quoteDatabaseIdentifier(
        database,
        "id",
      )} = completeness_member.${quoteDatabaseIdentifier(
        database,
        "component_key",
      )} AND completeness_projection.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = completeness_member.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} AND completeness_projection.${quoteDatabaseIdentifier(
        database,
        "publication_generation_id",
      )} = completeness_member.${quoteDatabaseIdentifier(
        database,
        "generation_id",
      )} AND completeness_projection.${quoteDatabaseIdentifier(
        database,
        "node_id",
      )} = completeness_node.${quoteDatabaseIdentifier(
        database,
        "id",
      )} AND completeness_projection.${quoteDatabaseIdentifier(database, "type")} = '${type}' AND completeness_projection.${quoteDatabaseIdentifier(
        database,
        "status",
      )} IN ('building', 'ready')${extra} WHERE completeness_member.${quoteDatabaseIdentifier(
        database,
        "tenant_id",
      )} = ${bind(candidate.tenantId)} AND completeness_member.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${bind(candidate.knowledgeSpaceId)} AND completeness_member.${quoteDatabaseIdentifier(
        database,
        "publication_id",
      )} = ${bind(candidate.id)} AND completeness_member.${quoteDatabaseIdentifier(
        database,
        "component_type",
      )} = 'index-projection' AND completeness_member.${quoteDatabaseIdentifier(
        database,
        "document_asset_id",
      )} = ${bind(owner.documentAssetId)} AND completeness_member.${quoteDatabaseIdentifier(
        database,
        "generation_id",
      )} = ${bind(owner.generationId)}`;
    const hasFts = exactMemberProjection(
      "fts",
      ` AND completeness_projection.${quoteDatabaseIdentifier(database, "fts_document")} IS NOT NULL${
        database.dialect === "tidb"
          ? ` AND EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
              database,
              "index_projection_fts_postings",
            )} completeness_posting WHERE completeness_posting.${quoteDatabaseIdentifier(
              database,
              "knowledge_space_id",
            )} = completeness_projection.${quoteDatabaseIdentifier(
              database,
              "knowledge_space_id",
            )} AND completeness_posting.${quoteDatabaseIdentifier(
              database,
              "projection_id",
            )} = completeness_projection.${quoteDatabaseIdentifier(
              database,
              "id",
            )} AND completeness_posting.${quoteDatabaseIdentifier(
              database,
              "tokenizer_version",
            )} = '${TIDB_FTS_TOKENIZER_VERSION}')`
          : ""
      }`,
    );
    const hasDense = vectorSpaceId
      ? exactMemberProjection(
          "dense-vector",
          ` AND completeness_projection.${quoteDatabaseIdentifier(
            database,
            "model",
          )} = ${bind(vectorSpaceId)} AND completeness_projection.${quoteDatabaseIdentifier(
            database,
            "dense_vector",
          )} IS NOT NULL AND completeness_projection.${quoteDatabaseIdentifier(
            database,
            "visual_vector",
          )} IS NULL`,
        )
      : undefined;
    const result = await transaction.execute({
      maxRows: maximumDocumentCompilationGraphSourceNodes + 1,
      operation: "select",
      params,
      sql: `SELECT completeness_node.${quoteDatabaseIdentifier(
        database,
        "id",
      )}, CASE WHEN EXISTS (${hasFts}) THEN 1 ELSE 0 END AS ${quoteDatabaseIdentifier(
        database,
        "candidate_has_fts",
      )}, ${
        hasDense ? `CASE WHEN EXISTS (${hasDense}) THEN 1 ELSE 0 END` : "1"
      } AS ${quoteDatabaseIdentifier(database, "candidate_has_dense")} FROM ${quoteDatabaseIdentifier(
        database,
        "knowledge_nodes",
      )} completeness_node WHERE completeness_node.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${bind(candidate.knowledgeSpaceId)} AND completeness_node.${quoteDatabaseIdentifier(
        database,
        "document_asset_id",
      )} = ${bind(owner.documentAssetId)} AND completeness_node.${quoteDatabaseIdentifier(
        database,
        "publication_generation_id",
      )} = ${bind(owner.generationId)} ORDER BY completeness_node.${quoteDatabaseIdentifier(
        database,
        "id",
      )} ASC FOR UPDATE;`,
      tableName: "knowledge_nodes",
    });
    totalNodes += result.rows.length;
    if (
      result.rows.length === 0 ||
      totalNodes > maximumDocumentCompilationGraphSourceNodes ||
      result.rows.some(
        (row) =>
          numberColumn(row, "candidate_has_fts") !== 1 ||
          numberColumn(row, "candidate_has_dense") !== 1,
      )
    ) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
  }
}

async function lockDatabaseDocumentCompilationVectorSpace(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  candidate: ProjectionSetPublication,
): Promise<string | undefined> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [candidate.tenantId, candidate.knowledgeSpaceId],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "metadata")} FROM ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_manifests",
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1 FOR UPDATE;`,
    tableName: "knowledge_space_manifests",
  });
  const row = result.rows[0];
  if (!row) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  const rawProfile = jsonObjectColumn(row, "metadata").__knowledgeFsEmbeddingProfile;
  if (rawProfile === undefined) {
    return undefined;
  }
  const parsed = KnowledgeSpaceEmbeddingProfileSchema.safeParse(rawProfile);
  if (!parsed.success) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  return parsed.data.vectorSpaceId;
}

async function lockDocumentCompilationTargetRows({
  additionalJoins,
  additionalTargetPredicate,
  candidate,
  componentType,
  database,
  members,
  ownerJoin,
  selectedTargetColumns = [],
  tableName,
  transaction,
}: {
  readonly additionalJoins?: ((memberAlias: string, targetAlias: string) => string) | undefined;
  readonly additionalTargetPredicate?: ((targetAlias: string) => string) | undefined;
  readonly candidate: ProjectionSetPublication;
  readonly componentType: DocumentCompilationPublicationMemberSnapshot["componentType"];
  readonly database: DatabaseAdapter;
  readonly members: readonly DocumentCompilationPublicationMemberSnapshot[];
  readonly ownerJoin?: "document_asset_id" | "target_id" | undefined;
  readonly selectedTargetColumns?: readonly string[] | undefined;
  readonly tableName: string;
  readonly transaction: DatabaseExecutor;
}): Promise<readonly DocumentCompilationTargetRow[]> {
  const expected = members
    .filter((member) => member.componentType === componentType)
    .sort((left, right) => left.componentKey.localeCompare(right.componentKey));
  if (expected.length === 0) {
    return [];
  }
  if (expected.some((member) => !member.documentAssetId)) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }

  const memberAlias = "closure_member";
  const targetAlias = "closure_target";
  const ownerValue =
    ownerJoin === "target_id"
      ? database.dialect === "postgres"
        ? `CAST(${memberAlias}.${quoteDatabaseIdentifier(database, "document_asset_id")} AS TEXT)`
        : `CAST(${memberAlias}.${quoteDatabaseIdentifier(database, "document_asset_id")} AS CHAR)`
      : `${memberAlias}.${quoteDatabaseIdentifier(database, "document_asset_id")}`;
  const ownerPredicate = ownerJoin
    ? ` AND ${targetAlias}.${quoteDatabaseIdentifier(database, ownerJoin)} = ${ownerValue}`
    : "";
  const targetPredicate = additionalTargetPredicate
    ? ` AND ${additionalTargetPredicate(targetAlias)}`
    : "";
  const selectedColumns = selectedTargetColumns
    .map(
      (column) =>
        `${targetAlias}.${quoteDatabaseIdentifier(database, column)} AS ${quoteDatabaseIdentifier(
          database,
          column,
        )}`,
    )
    .join(", ");
  const result = await transaction.execute({
    maxRows: expected.length + 1,
    operation: "select",
    params: [candidate.tenantId, candidate.knowledgeSpaceId, candidate.id],
    sql: `SELECT ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AS ${quoteDatabaseIdentifier(
      database,
      "member_component_key",
    )}, ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} AS ${quoteDatabaseIdentifier(
      database,
      "member_document_asset_id",
    )}, ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} AS ${quoteDatabaseIdentifier(database, "member_generation_id")}${
      selectedColumns ? `, ${selectedColumns}` : ""
    } FROM ${quoteDatabaseIdentifier(
      database,
      publicationMemberTableName,
    )} ${memberAlias} JOIN ${quoteDatabaseIdentifier(
      database,
      tableName,
    )} ${targetAlias} ON ${targetAlias}.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} AND ${targetAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND ${targetAlias}.${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )}${ownerPredicate}${targetPredicate}${additionalJoins?.(memberAlias, targetAlias) ?? ""} WHERE ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "component_type",
    )} = '${componentType}' ORDER BY ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} ASC FOR UPDATE;`,
    tableName,
  });
  const actual = result.rows.map((row) => ({
    componentKey: stringColumn(row, "member_component_key"),
    documentAssetId: stringColumn(row, "member_document_asset_id"),
    generationId: stringColumn(row, "member_generation_id"),
    row,
  }));
  if (
    actual.length !== expected.length ||
    actual.some(
      (item, index) =>
        item.componentKey !== expected[index]?.componentKey ||
        item.documentAssetId !== expected[index]?.documentAssetId ||
        item.generationId !== expected[index]?.generationId,
    )
  ) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  return actual;
}

function chunkDocumentCompilationClosureValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function assertExpectedHeadRevision(
  head: ProjectionSetPublicationHead | null,
  expectedHeadRevision: number,
): void {
  const actualHeadRevision = head?.headRevision ?? 0;
  if (actualHeadRevision !== expectedHeadRevision) {
    throw new ProjectionSetPublicationHeadConflictError(expectedHeadRevision, actualHeadRevision);
  }
  if (head && head.publication.status !== "published") {
    throw new Error(
      `Projection set publication head points to non-published status=${head.publication.status}`,
    );
  }
}

async function databaseAdvanceHead(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publication: ProjectionSetPublication,
  expectedHeadRevision: number,
  updatedAt: string,
): Promise<number> {
  const nextRevision = expectedHeadRevision + 1;
  if (expectedHeadRevision === 0) {
    const params = [
      publication.knowledgeSpaceId,
      publication.tenantId,
      publication.knowledgeSpaceId,
      publication.id,
      nextRevision,
      updatedAt,
      updatedAt,
    ] satisfies readonly DatabaseQueryValue[];
    const insertKeyword = database.dialect === "postgres" ? "INSERT" : "INSERT IGNORE";
    const conflictClause =
      database.dialect === "postgres"
        ? ` ON CONFLICT (${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )}, ${quoteDatabaseIdentifier(database, "knowledge_space_id")}) DO NOTHING RETURNING ${quoteDatabaseIdentifier(
            database,
            "head_revision",
          )}`
        : "";
    const result = await transaction.execute({
      maxRows: 1,
      operation: "insert",
      params,
      sql: `${insertKeyword} INTO ${quoteDatabaseIdentifier(database, headTableName)} (${[
        "id",
        "tenant_id",
        "knowledge_space_id",
        "publication_id",
        "head_revision",
        "created_at",
        "updated_at",
      ]
        .map((column) => quoteDatabaseIdentifier(database, column))
        .join(", ")}) VALUES (${params
        .map((_, index) => databasePlaceholder(database, index + 1))
        .join(", ")})${conflictClause};`,
      tableName: headTableName,
    });

    if (result.rowsAffected !== 1) {
      const concurrentHead = await databaseGetHead(database, transaction, publication, true);
      if (!concurrentHead) {
        throw new Error("Projection set publication head insert did not persist a readable row");
      }

      throw new ProjectionSetPublicationHeadConflictError(
        expectedHeadRevision,
        concurrentHead.headRevision,
      );
    }

    return result.rows[0] ? numberColumn(result.rows[0], "head_revision") : nextRevision;
  }

  const result = await transaction.execute({
    maxRows: 1,
    operation: "update",
    params: [
      publication.id,
      nextRevision,
      updatedAt,
      publication.tenantId,
      publication.knowledgeSpaceId,
      expectedHeadRevision,
    ],
    sql: `UPDATE ${quoteDatabaseIdentifier(
      database,
      headTableName,
    )} SET ${quoteDatabaseIdentifier(database, "publication_id")} = ${databasePlaceholder(
      database,
      1,
    )}, ${quoteDatabaseIdentifier(database, "head_revision")} = ${databasePlaceholder(
      database,
      2,
    )}, ${quoteDatabaseIdentifier(database, "updated_at")} = ${databasePlaceholder(
      database,
      3,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      4,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "head_revision",
    )} = ${databasePlaceholder(database, 6)}${
      database.dialect === "postgres" ? " RETURNING head_revision" : ""
    };`,
    tableName: headTableName,
  });

  if (result.rowsAffected !== 1) {
    const head = await databaseGetHead(database, transaction, publication, true);
    throw new ProjectionSetPublicationHeadConflictError(
      expectedHeadRevision,
      head?.headRevision ?? 0,
    );
  }

  return result.rows[0] ? numberColumn(result.rows[0], "head_revision") : nextRevision;
}

async function databaseUpdatePublication(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publication: ProjectionSetPublication,
  patch: {
    readonly status: ProjectionSetPublicationStatus;
    readonly supersededByFingerprint?: null | string | undefined;
    readonly updatedAt: string;
  },
): Promise<ProjectionSetPublication> {
  const supersededByFingerprint =
    "supersededByFingerprint" in patch
      ? (patch.supersededByFingerprint ?? undefined)
      : publication.supersededByFingerprint;
  const params = [
    patch.status,
    supersededByFingerprint ?? null,
    patch.updatedAt,
    publication.id,
    publication.tenantId,
    publication.knowledgeSpaceId,
    publication.status,
  ] satisfies readonly DatabaseQueryValue[];
  const result = await transaction.execute({
    maxRows: 1,
    operation: "update",
    params,
    sql: `UPDATE ${quoteDatabaseIdentifier(
      database,
      publicationTableName,
    )} SET ${quoteDatabaseIdentifier(database, "status")} = ${databasePlaceholder(
      database,
      1,
    )}, ${quoteDatabaseIdentifier(
      database,
      "superseded_by_fingerprint",
    )} = ${databasePlaceholder(database, 2)}, ${quoteDatabaseIdentifier(
      database,
      "updated_at",
    )} = ${databasePlaceholder(database, 3)} WHERE ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 6)} AND ${quoteDatabaseIdentifier(
      database,
      "status",
    )} = ${databasePlaceholder(database, 7)}${
      database.dialect === "postgres" ? " RETURNING *" : ""
    };`,
    tableName: publicationTableName,
  });

  if (result.rowsAffected !== 1) {
    throw new ProjectionSetPublicationTransitionError(
      `Projection set changed concurrently from ${publication.status}`,
    );
  }

  return result.rows[0]
    ? mapPublicationRow(result.rows[0])
    : parsePublication({
        ...publication,
        status: patch.status,
        supersededByFingerprint,
        updatedAt: patch.updatedAt,
      });
}

async function databaseGetPublication(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProjectionSetPublicationLookupInput,
  forUpdate: boolean,
): Promise<ProjectionSetPublication | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      tenantIdValue(input.tenantId),
      UuidSchema.parse(input.knowledgeSpaceId),
      ProjectionSetFingerprintSchema.parse(input.fingerprint),
    ],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      publicationTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "fingerprint",
    )} = ${databasePlaceholder(database, 3)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: publicationTableName,
  });

  return result.rows[0] ? mapPublicationRow(result.rows[0]) : null;
}

async function requireDatabasePublication(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProjectionSetPublicationLookupInput,
  forUpdate: boolean,
): Promise<ProjectionSetPublication> {
  const publication = await databaseGetPublication(database, executor, input, forUpdate);
  if (!publication) {
    throw new ProjectionSetPublicationNotFoundError(input.fingerprint);
  }

  return publication;
}

async function databaseGetHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: { readonly knowledgeSpaceId: string; readonly tenantId: string },
  forUpdate: boolean,
): Promise<ProjectionSetPublicationHead | null> {
  const publicationColumnsSql = publicationColumns
    .map(
      (column) =>
        `p.${quoteDatabaseIdentifier(database, column)} AS ${quoteDatabaseIdentifier(database, column)}`,
    )
    .join(", ");
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantIdValue(input.tenantId), UuidSchema.parse(input.knowledgeSpaceId)],
    sql: `SELECT ${publicationColumnsSql}, h.${quoteDatabaseIdentifier(
      database,
      "head_revision",
    )} AS ${quoteDatabaseIdentifier(database, "head_revision")} FROM ${quoteDatabaseIdentifier(
      database,
      headTableName,
    )} h JOIN ${quoteDatabaseIdentifier(database, publicationTableName)} p ON p.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = h.${quoteDatabaseIdentifier(database, "publication_id")} AND p.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = h.${quoteDatabaseIdentifier(database, "tenant_id")} AND p.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = h.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} WHERE h.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND h.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: headTableName,
  });
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    headRevision: validatePositiveInteger(numberColumn(row, "head_revision"), "headRevision"),
    publication: mapPublicationRow(row),
  };
}

async function databaseListGcCandidates(
  database: DatabaseAdapter,
  maxListLimit: number,
  {
    cursor,
    knowledgeSpaceId,
    limit,
    olderThan,
    tenantId,
  }: ListProjectionSetPublicationGcCandidatesInput,
): Promise<{
  readonly items: readonly ProjectionSetPublication[];
  readonly nextCursor?: string | undefined;
}> {
  validateGcListLimit(limit);
  if (limit > maxListLimit) {
    throw new ProjectionSetPublicationListLimitExceededError(maxListLimit);
  }

  const readLimit = limit + 1;
  const params: DatabaseQueryValue[] = [
    tenantIdValue(tenantId),
    UuidSchema.parse(knowledgeSpaceId),
    canonicalDateTime(olderThan, "olderThan"),
  ];
  const conditions = [
    `${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)}`,
    `${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)}`,
    `${quoteDatabaseIdentifier(database, "status")} IN ('inactive', 'superseded')`,
    `${quoteDatabaseIdentifier(database, "updated_at")} < ${databasePlaceholder(database, 3)}`,
  ];
  if (cursor !== undefined) {
    params.push(ProjectionSetFingerprintSchema.parse(cursor));
    conditions.push(
      `${quoteDatabaseIdentifier(database, "fingerprint")} > ${databasePlaceholder(
        database,
        params.length,
      )}`,
    );
  }
  params.push(readLimit);
  const result = await database.execute({
    maxRows: readLimit,
    operation: "select",
    params,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      publicationTableName,
    )} WHERE ${conditions.join(" AND ")} ORDER BY ${quoteDatabaseIdentifier(
      database,
      "fingerprint",
    )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
    tableName: publicationTableName,
  });
  const page = result.rows.map(mapPublicationRow);
  const items = page.slice(0, limit);
  const nextCursor = page.length > limit ? items.at(-1)?.fingerprint : undefined;

  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

function requireMemoryPublication(
  publications: Map<string, ProjectionSetPublication>,
  input: ProjectionSetPublicationLookupInput,
): ProjectionSetPublication {
  const publication = publications.get(publicationLookupKey(input));
  if (!publication) {
    throw new ProjectionSetPublicationNotFoundError(input.fingerprint);
  }

  return clonePublication(publication);
}

function updateMemoryPublication(
  publications: Map<string, ProjectionSetPublication>,
  publication: ProjectionSetPublication,
): ProjectionSetPublication {
  const parsed = parsePublication(publication);
  publications.set(publicationKey(parsed), clonePublication(parsed));

  return clonePublication(parsed);
}

function parseCandidate(input: CreateProjectionSetCandidateInput): ProjectionSetPublication {
  return parsePublication({
    createdAt: canonicalDateTime(input.createdAt, "createdAt"),
    fingerprint: ProjectionSetFingerprintSchema.parse(input.fingerprint),
    id: UuidSchema.parse(input.id),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    metadata: cloneMetadata(input.metadata ?? {}),
    projectionVersion: validatePositiveInteger(input.projectionVersion, "projectionVersion"),
    status: "candidate",
    tenantId: tenantIdValue(input.tenantId),
    updatedAt: input.createdAt,
  });
}

function parsePublication(publication: ProjectionSetPublication): ProjectionSetPublication {
  if (!publicationStatuses.includes(publication.status)) {
    throw new Error(`Unsupported projection set publication status=${publication.status}`);
  }

  return {
    createdAt: canonicalDateTime(publication.createdAt, "createdAt"),
    fingerprint: ProjectionSetFingerprintSchema.parse(publication.fingerprint),
    id: UuidSchema.parse(publication.id),
    knowledgeSpaceId: UuidSchema.parse(publication.knowledgeSpaceId),
    metadata: cloneMetadata(publication.metadata),
    projectionVersion: validatePositiveInteger(publication.projectionVersion, "projectionVersion"),
    status: publication.status,
    ...(publication.supersededByFingerprint !== undefined
      ? {
          supersededByFingerprint: ProjectionSetFingerprintSchema.parse(
            publication.supersededByFingerprint,
          ),
        }
      : {}),
    tenantId: tenantIdValue(publication.tenantId),
    updatedAt: canonicalDateTime(publication.updatedAt, "updatedAt"),
  };
}

function mapPublicationRow(row: DatabaseRow): ProjectionSetPublication {
  return parsePublication({
    createdAt: stringColumn(row, "created_at"),
    fingerprint: stringColumn(row, "fingerprint"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    projectionVersion: numberColumn(row, "projection_version"),
    status: stringColumn(row, "status") as ProjectionSetPublicationStatus,
    supersededByFingerprint: optionalStringColumn(row, "superseded_by_fingerprint"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function publicationColumnValues(
  publication: ProjectionSetPublication,
): readonly DatabaseQueryValue[] {
  return [
    publication.id,
    publication.tenantId,
    publication.knowledgeSpaceId,
    publication.fingerprint,
    publication.projectionVersion,
    publication.status,
    publication.supersededByFingerprint ?? null,
    JSON.stringify(publication.metadata),
    publication.createdAt,
    publication.updatedAt,
  ];
}

function toPublishedPublication(
  publication: ProjectionSetPublication,
  headRevision: number,
): PublishedProjectionSetPublication {
  if (publication.status !== "published") {
    throw new Error(
      `Projection set publication head points to non-published status=${publication.status}`,
    );
  }

  return {
    ...clonePublication(publication),
    headRevision: validatePositiveInteger(headRevision, "headRevision"),
    status: "published",
  };
}

function publicationLookupKey({
  fingerprint,
  knowledgeSpaceId,
  tenantId,
}: ProjectionSetPublicationLookupInput): string {
  return `${tenantIdValue(tenantId)}:${UuidSchema.parse(
    knowledgeSpaceId,
  )}:${ProjectionSetFingerprintSchema.parse(fingerprint)}`;
}

function publicationKey(publication: ProjectionSetPublication): string {
  return publicationLookupKey(publication);
}

function publicationSpaceKey(input: {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}): string {
  return `${tenantIdValue(input.tenantId)}:${UuidSchema.parse(input.knowledgeSpaceId)}`;
}

function clonePublication(publication: ProjectionSetPublication): ProjectionSetPublication {
  return parsePublication(JSON.parse(JSON.stringify(publication)) as ProjectionSetPublication);
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Projection set publication metadata must be an object");
  }

  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function canonicalDateTime(value: string, label: string): string {
  const normalized = value.trim();
  let parsed: string;
  try {
    parsed = DateTimeSchema.parse(normalized);
  } catch {
    throw new Error(`Projection set publication ${label} must be an ISO date-time`);
  }

  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  if (year < minimumDatabaseYear || year > maximumDatabaseYear) {
    throw new Error(
      `Projection set publication ${label} year must be between ${minimumDatabaseYear} and ${maximumDatabaseYear}`,
    );
  }

  return date.toISOString();
}

function tenantIdValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Projection set publication tenantId is required");
  }
  if (normalized.length > maximumTenantIdLength) {
    throw new Error(
      `Projection set publication tenantId must be at most ${maximumTenantIdLength} characters`,
    );
  }

  return normalized;
}

function normalizeDocumentCompilationPublicationFence(
  fence: DocumentCompilationPublicationFence,
): DocumentCompilationPublicationFence {
  return {
    attemptId: UuidSchema.parse(fence.attemptId),
    candidatePublicationId: UuidSchema.parse(fence.candidatePublicationId),
    documentAssetId: UuidSchema.parse(fence.documentAssetId),
    documentVersion: validatePositiveInteger(fence.documentVersion, "documentVersion"),
    expectedRowVersion: validateStoredHeadRevision(fence.expectedRowVersion),
    leaseToken: UuidSchema.parse(fence.leaseToken),
    publicationGenerationId: PublicationGenerationIdSchema.parse(fence.publicationGenerationId),
  };
}

const documentCompilationMemberTypes = new Set<
  DocumentCompilationPublicationMemberSnapshot["componentType"]
>([
  "document-outline",
  "graph-entity",
  "graph-relation",
  "index-projection",
  "knowledge-path",
  "multimodal-manifest",
]);

function normalizeDocumentCompilationMemberSnapshot(
  members: readonly DocumentCompilationPublicationMemberSnapshot[],
): readonly DocumentCompilationPublicationMemberSnapshot[] {
  if (!Array.isArray(members) || members.length === 0) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  const normalized = members.map((member) => {
    if (!documentCompilationMemberTypes.has(member.componentType)) {
      throw new ProjectionSetPublicationCandidateSnapshotConflictError();
    }
    return {
      componentKey: UuidSchema.parse(member.componentKey),
      componentType: member.componentType,
      ...(member.documentAssetId
        ? { documentAssetId: UuidSchema.parse(member.documentAssetId) }
        : {}),
      generationId: PublicationGenerationIdSchema.parse(member.generationId),
    };
  });
  normalized.sort((left, right) =>
    memberSnapshotIdentity(left).localeCompare(memberSnapshotIdentity(right)),
  );
  const identities = normalized.map(memberSnapshotIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new ProjectionSetPublicationCandidateSnapshotConflictError();
  }
  return normalized;
}

function memberSnapshotIdentity(member: DocumentCompilationPublicationMemberSnapshot): string {
  return `${member.componentType}:${member.componentKey}:${member.generationId}:${member.documentAssetId ?? ""}`;
}

function validateAdvancableHeadRevision(value: number): number {
  const revision = validateStoredHeadRevision(value);
  if (revision >= maximumDatabaseInteger) {
    throw new Error(
      `Projection set publication expectedHeadRevision must be below ${maximumDatabaseInteger}`,
    );
  }

  return revision;
}

function validateStoredHeadRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumDatabaseInteger) {
    throw new Error(
      `Projection set publication headRevision must be between 0 and ${maximumDatabaseInteger}`,
    );
  }

  return value;
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumDatabaseInteger) {
    throw new Error(
      `Projection set publication ${label} must be between 1 and ${maximumDatabaseInteger}`,
    );
  }

  return value;
}

function validateGcListLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Projection set publication GC candidate limit must be at least 1");
  }
}

const maximumDatabaseInteger = 2_147_483_647;
const maximumDatabaseYear = 9_999;
const maximumTenantIdLength = 255;
const minimumDatabaseYear = 1_000;
const knowledgeSpaceTableName = "knowledge_spaces";
const publicationTableName = "projection_set_publications";
const headTableName = "projection_set_publication_heads";
const documentCompilationAttemptTableName = "document_compilation_attempts";
const profileHeadTableName = "knowledge_space_profile_heads";
const profileRevisionTableName = "knowledge_space_profile_revisions";
const profilePublicationBindingTableName = "knowledge_space_profile_publication_bindings";
const publicationMemberTableName = "projection_set_publication_members";
const publicationStatuses: readonly ProjectionSetPublicationStatus[] = [
  "candidate",
  "inactive",
  "published",
  "superseded",
  "validating",
];
const publicationColumns = [
  "id",
  "tenant_id",
  "knowledge_space_id",
  "fingerprint",
  "projection_version",
  "status",
  "superseded_by_fingerprint",
  "metadata",
  "created_at",
  "updated_at",
] as const;
