import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  ProjectionSetFingerprintSchema,
  PublicationGenerationIdSchema,
  UuidSchema,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import type {
  DocumentCompilationAttempt,
  DocumentCompilationAttemptRepository,
} from "./document-compilation-attempt-repository";
import {
  type ProjectionSetPublication,
  ProjectionSetPublicationHeadConflictError,
  ProjectionSetPublicationKnowledgeSpaceNotFoundError,
  type ProjectionSetPublicationLookupInput,
  ProjectionSetPublicationNotFoundError,
  type ProjectionSetPublicationRepository,
  ProjectionSetPublicationTransitionError,
  type PublishedProjectionSetPublication,
} from "./projection-publication-repository";

export const ProjectionSetPublicationComponentTypes = [
  "index-projection",
  "document-outline",
  "multimodal-manifest",
  "knowledge-path",
  "graph-entity",
  "graph-relation",
] as const;

export type ProjectionSetPublicationComponentType =
  (typeof ProjectionSetPublicationComponentTypes)[number];

export interface ProjectionSetPublicationMember {
  readonly componentKey: string;
  readonly componentType: ProjectionSetPublicationComponentType;
  readonly createdAt: string;
  readonly documentAssetId?: string | undefined;
  readonly generationId: string;
  readonly knowledgeSpaceId: string;
  readonly publicationId: string;
  readonly tenantId: string;
}

export interface ProjectionSetPublicationCandidateComponentInput {
  readonly componentKey: string;
  readonly documentAssetId?: string | undefined;
  readonly generationId: string;
}

export interface ProjectionSetPublicationDocumentComponentInput {
  readonly componentKey: string;
  readonly componentType: ProjectionSetPublicationComponentType;
  readonly generationId: string;
}

export interface ProjectionSetPublicationCandidateMutationInput {
  readonly candidateFingerprint: string;
  readonly createdAt: string;
  readonly expectedHeadRevision: number;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface InheritProjectionSetPublicationMembersInput
  extends ProjectionSetPublicationCandidateMutationInput {
  readonly excludedComponentKeys?: readonly string[] | undefined;
  readonly excludedDocumentAssetId?: string | undefined;
}

export interface ReplaceProjectionSetCandidateComponentsInput
  extends ProjectionSetPublicationCandidateMutationInput {
  readonly componentType: ProjectionSetPublicationComponentType;
  readonly components: readonly ProjectionSetPublicationCandidateComponentInput[];
}

export interface ReplaceProjectionSetDocumentComponentsInput
  extends ProjectionSetPublicationCandidateMutationInput {
  readonly components: readonly ProjectionSetPublicationDocumentComponentInput[];
  readonly documentAssetId: string;
}

export interface ProjectionSetPublicationAttemptFenceInput {
  readonly attemptId: string;
  readonly candidatePublicationId: string;
  readonly documentVersion: number;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly publicationGenerationId: string;
}

export interface FilterProjectionSetPublicationMemberKeysInput {
  readonly componentKeys: readonly string[];
  readonly componentType: ProjectionSetPublicationComponentType;
  readonly knowledgeSpaceId: string;
  readonly publicationId: string;
  readonly tenantId: string;
}

/**
 * Rebuilds an attempt-exclusive candidate from the current published snapshot and one document's
 * complete component set. Implementations must treat this as one logical mutation: inherited
 * members and every owner component either become visible together or remain unchanged.
 */
export interface ComposeProjectionSetDocumentCandidateInput
  extends ReplaceProjectionSetDocumentComponentsInput {
  readonly attemptFence: ProjectionSetPublicationAttemptFenceInput;
}

export interface ComposeProjectionSetDocumentCandidateResult {
  readonly inherited: number;
  readonly replaced: number;
}

export interface ProjectionSetPublicationMemberRepository {
  composeDocumentCandidate(
    input: ComposeProjectionSetDocumentCandidateInput,
  ): Promise<ComposeProjectionSetDocumentCandidateResult>;
  /**
   * Returns only requested keys that belong to the fixed publication. Unlike listByPublication,
   * this is bounded by the caller's candidate set and is safe on large knowledge spaces.
   */
  filterComponentKeys(
    input: FilterProjectionSetPublicationMemberKeysInput,
  ): Promise<readonly string[]>;
  inheritFromPublished(input: InheritProjectionSetPublicationMembersInput): Promise<number>;
  listByFingerprint(
    input: ProjectionSetPublicationLookupInput,
  ): Promise<readonly ProjectionSetPublicationMember[]>;
  listByPublication(
    input: ProjectionSetPublicationLookupInput,
  ): Promise<readonly ProjectionSetPublicationMember[]>;
  replaceCandidateComponents(input: ReplaceProjectionSetCandidateComponentsInput): Promise<number>;
  replaceDocumentComponents(input: ReplaceProjectionSetDocumentComponentsInput): Promise<number>;
}

export interface InMemoryProjectionSetPublicationMemberRepositoryOptions {
  readonly attempts?: Pick<DocumentCompilationAttemptRepository, "get"> | undefined;
  readonly maxListLimit: number;
  readonly maxMembers: number;
  readonly now?: (() => number) | undefined;
  readonly publications: ProjectionSetPublicationRepository;
}

export interface DatabaseProjectionSetPublicationMemberRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
}

export class ProjectionSetPublicationMemberCapacityExceededError extends Error {
  constructor(maxMembers: number) {
    super(`Projection set publication member capacity exceeds maxMembers=${maxMembers}`);
  }
}

export class ProjectionSetPublicationMemberListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`Projection set publication member list exceeds maxListLimit=${maxListLimit}`);
  }
}

export class ProjectionSetPublicationMemberBatchSizeExceededError extends Error {
  constructor(maxBatchSize: number) {
    super(`Projection set publication member batch exceeds maxBatchSize=${maxBatchSize}`);
  }
}

export class ProjectionSetPublicationMemberIdentityConflictError extends Error {
  constructor(componentKey: string, generationId: string) {
    super(
      `Projection set publication member component=${componentKey} generation=${generationId} has conflicting generation or document ownership`,
    );
  }
}

export class ProjectionSetPublicationMemberTransactionRequiredError extends Error {
  constructor(dialect: DatabaseAdapter["dialect"]) {
    super(
      `Projection set publication member mutations require a configured connection transaction; dialect=${dialect}`,
    );
  }
}

export class ProjectionSetPublicationMemberWriteConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Projection set publication member insert count mismatch: expected=${expected} actual=${actual}`,
    );
  }
}

export class ProjectionSetPublicationMemberAttemptFenceConflictError extends Error {
  constructor() {
    super("Projection set candidate composition lost its document compilation attempt fence");
    this.name = "ProjectionSetPublicationMemberAttemptFenceConflictError";
  }
}

interface NormalizedCandidateMutation {
  readonly candidateFingerprint: string;
  readonly createdAt: string;
  readonly expectedHeadRevision: number;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

interface NormalizedAttemptFence {
  readonly attemptId: string;
  readonly candidatePublicationId: string;
  readonly documentVersion: number;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly publicationGenerationId: string;
}

interface CandidateMutationContext {
  readonly candidate: ProjectionSetPublication;
  readonly published: PublishedProjectionSetPublication | null;
}

interface DatabasePublicationReference {
  readonly id: string;
  readonly status: string;
}

interface DatabasePublicationHeadReference {
  readonly headRevision: number;
  readonly publicationId: string;
}

const memberTableName = "projection_set_publication_members";
const publicationTableName = "projection_set_publications";
const headTableName = "projection_set_publication_heads";
const knowledgeSpaceTableName = "knowledge_spaces";
const attemptTableName = "document_compilation_attempts";
const memberIdentityColumns = ["publication_id", "component_type", "component_key"] as const;
const memberColumns = [
  "tenant_id",
  "knowledge_space_id",
  "publication_id",
  "component_type",
  "component_key",
  "generation_id",
  "document_asset_id",
  "created_at",
] as const;
const componentTypeSet = new Set<string>(ProjectionSetPublicationComponentTypes);

export function createInMemoryProjectionSetPublicationMemberRepository({
  attempts,
  maxListLimit,
  maxMembers,
  now = Date.now,
  publications,
}: InMemoryProjectionSetPublicationMemberRepositoryOptions): ProjectionSetPublicationMemberRepository {
  validatePositiveBound(maxMembers, "maxMembers");
  validatePositiveBound(maxListLimit, "maxListLimit");
  const members = new Map<string, ProjectionSetPublicationMember>();

  const listByFingerprint = async (
    input: ProjectionSetPublicationLookupInput,
  ): Promise<readonly ProjectionSetPublicationMember[]> => {
    const publication = await requireMemoryPublication(publications, input);
    const items = sortedMembers(members.values()).filter(
      (member) =>
        member.tenantId === publication.tenantId &&
        member.knowledgeSpaceId === publication.knowledgeSpaceId &&
        member.publicationId === publication.id,
    );
    if (items.length > maxListLimit) {
      throw new ProjectionSetPublicationMemberListLimitExceededError(maxListLimit);
    }

    return items.map(cloneMember);
  };

  return {
    composeDocumentCandidate: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const documentAssetId = UuidSchema.parse(input.documentAssetId);
      const attemptFence = normalizeAttemptFence(input.attemptFence);
      // This path intentionally has no per-call batch cap. The in-memory commit is copy-on-write,
      // while the database implementation chunks inserts inside one transaction.
      const components = normalizeDocumentComponents(
        input.components,
        documentAssetId,
        Number.MAX_SAFE_INTEGER,
      );
      assertDocumentComponentsGeneration(components, attemptFence.publicationGenerationId);
      const context = await requireMemoryCandidateContext(publications, normalized);
      assertFenceCandidate(context.candidate.id, attemptFence.candidatePublicationId);
      await requireMemoryAttemptFence(attempts, now, normalized, documentAssetId, attemptFence);
      const next = new Map(members);

      for (const [key, member] of next) {
        if (
          member.tenantId === normalized.tenantId &&
          member.knowledgeSpaceId === normalized.knowledgeSpaceId &&
          member.publicationId === context.candidate.id
        ) {
          next.delete(key);
        }
      }

      let inherited = 0;
      if (context.published) {
        for (const source of members.values()) {
          if (
            source.tenantId !== normalized.tenantId ||
            source.knowledgeSpaceId !== normalized.knowledgeSpaceId ||
            source.publicationId !== context.published.id ||
            source.documentAssetId === documentAssetId
          ) {
            continue;
          }

          const member = parseMember({
            ...source,
            createdAt: normalized.createdAt,
            publicationId: context.candidate.id,
          });
          setCompatibleMemoryMember(next, member);
          inherited += 1;
        }
      }

      const replacement = components.map((component) =>
        memberFromComponent(normalized, context.candidate.id, component),
      );
      for (const member of replacement) {
        setCompatibleMemoryMember(next, member);
      }

      commitMemoryMembers(members, next, maxMembers);
      return { inherited, replaced: replacement.length };
    },
    filterComponentKeys: async (input) => {
      const normalized = normalizeFilterMemberKeysInput(input, maxListLimit);
      const allowed = new Set<string>();
      const requested = new Set(normalized.componentKeys);

      for (const member of members.values()) {
        if (
          member.tenantId === normalized.tenantId &&
          member.knowledgeSpaceId === normalized.knowledgeSpaceId &&
          member.publicationId === normalized.publicationId &&
          member.componentType === normalized.componentType &&
          requested.has(member.componentKey)
        ) {
          allowed.add(member.componentKey);
        }
      }

      return normalized.componentKeys.filter((componentKey) => allowed.has(componentKey));
    },
    inheritFromPublished: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const excludedComponentKeys = new Set(
        normalizeExcludedComponentKeys(input.excludedComponentKeys ?? [], Number.MAX_SAFE_INTEGER),
      );
      const excludedDocumentAssetId = input.excludedDocumentAssetId
        ? UuidSchema.parse(input.excludedDocumentAssetId)
        : undefined;
      const context = await requireMemoryCandidateContext(publications, normalized);
      if (!context.published) {
        return 0;
      }

      const next = new Map(members);
      let inserted = 0;
      for (const source of members.values()) {
        if (
          source.tenantId !== normalized.tenantId ||
          source.knowledgeSpaceId !== normalized.knowledgeSpaceId ||
          source.publicationId !== context.published.id ||
          excludedComponentKeys.has(source.componentKey) ||
          (excludedDocumentAssetId !== undefined &&
            source.documentAssetId === excludedDocumentAssetId)
        ) {
          continue;
        }

        const inherited = parseMember({
          ...source,
          createdAt: normalized.createdAt,
          publicationId: context.candidate.id,
        });
        const key = memberIdentity(inherited);
        const existing = next.get(key);
        if (
          existing &&
          (existing.generationId !== inherited.generationId ||
            existing.documentAssetId !== inherited.documentAssetId)
        ) {
          throw new ProjectionSetPublicationMemberIdentityConflictError(
            inherited.componentKey,
            inherited.generationId,
          );
        }
        if (!existing) {
          next.set(key, inherited);
          inserted += 1;
        }
      }

      commitMemoryMembers(members, next, maxMembers);
      return inserted;
    },
    listByFingerprint,
    listByPublication: listByFingerprint,
    replaceCandidateComponents: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const componentType = parseComponentType(input.componentType);
      const components = normalizeCandidateComponents(
        componentType,
        input.components,
        Number.MAX_SAFE_INTEGER,
      );
      const { candidate } = await requireMemoryCandidateContext(publications, normalized);
      const replacement = components.map((component) =>
        memberFromComponent(normalized, candidate.id, component),
      );
      const next = new Map(members);

      for (const [key, member] of next) {
        if (
          member.tenantId === normalized.tenantId &&
          member.knowledgeSpaceId === normalized.knowledgeSpaceId &&
          member.publicationId === candidate.id &&
          member.componentType === componentType
        ) {
          next.delete(key);
        }
      }
      for (const member of replacement) {
        setCompatibleMemoryMember(next, member);
      }

      commitMemoryMembers(members, next, maxMembers);
      return replacement.length;
    },
    replaceDocumentComponents: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const documentAssetId = UuidSchema.parse(input.documentAssetId);
      const components = normalizeDocumentComponents(
        input.components,
        documentAssetId,
        Number.MAX_SAFE_INTEGER,
      );
      const { candidate } = await requireMemoryCandidateContext(publications, normalized);
      const replacement = components.map((component) =>
        memberFromComponent(normalized, candidate.id, component),
      );
      const next = new Map(members);

      for (const [key, member] of next) {
        if (
          member.tenantId === normalized.tenantId &&
          member.knowledgeSpaceId === normalized.knowledgeSpaceId &&
          member.publicationId === candidate.id &&
          member.documentAssetId === documentAssetId
        ) {
          next.delete(key);
        }
      }
      for (const member of replacement) {
        setCompatibleMemoryMember(next, member);
      }

      commitMemoryMembers(members, next, maxMembers);
      return replacement.length;
    },
  };
}

export function createDatabaseProjectionSetPublicationMemberRepository({
  database,
  maxBatchSize,
  maxListLimit,
}: DatabaseProjectionSetPublicationMemberRepositoryOptions): ProjectionSetPublicationMemberRepository {
  validatePositiveBound(maxBatchSize, "maxBatchSize");
  validatePositiveBound(maxListLimit, "maxListLimit");

  const listByFingerprint = async (
    input: ProjectionSetPublicationLookupInput,
  ): Promise<readonly ProjectionSetPublicationMember[]> => {
    const lookup = normalizePublicationLookup(input);
    const publication = await requireDatabasePublicationReference(
      database,
      database,
      lookup,
      false,
    );

    return databaseListMembers(database, database, publication.id, lookup, maxListLimit);
  };

  return {
    composeDocumentCandidate: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const documentAssetId = UuidSchema.parse(input.documentAssetId);
      const attemptFence = normalizeAttemptFence(input.attemptFence);
      // maxBatchSize is the transaction-local insert chunk size, not a total candidate limit.
      // Repeated calls to replaceDocumentComponents would erase earlier chunks.
      const components = normalizeDocumentComponents(
        input.components,
        documentAssetId,
        Number.MAX_SAFE_INTEGER,
      );
      assertDocumentComponentsGeneration(components, attemptFence.publicationGenerationId);

      return database.transaction(async (transaction) => {
        await databaseLockKnowledgeSpace(database, transaction, normalized);
        await databaseRequireAttemptFence(
          database,
          transaction,
          normalized,
          documentAssetId,
          attemptFence,
        );
        const context = await requireDatabaseCandidateContext(
          database,
          transaction,
          normalized,
          true,
        );
        assertFenceCandidate(context.candidate.id, attemptFence.candidatePublicationId);
        await databaseDeleteAllCandidateMembers(
          database,
          transaction,
          context.candidate.id,
          normalized,
        );
        const inherited = context.head
          ? await databaseInheritMembers(database, transaction, {
              candidatePublicationId: context.candidate.id,
              createdAt: normalized.createdAt,
              excludedComponentKeys: [],
              excludedDocumentAssetId: documentAssetId,
              knowledgeSpaceId: normalized.knowledgeSpaceId,
              publishedPublicationId: context.head.publicationId,
              tenantId: normalized.tenantId,
            })
          : 0;
        const replaced = await databaseInsertMembersInChunks(
          database,
          transaction,
          components.map((component) =>
            memberFromComponent(normalized, context.candidate.id, component),
          ),
          maxBatchSize,
        );
        // Recheck against the database wall clock after the potentially large copy/insert. The
        // first read holds the attempt row lock, so a lease that expires mid-transaction rolls
        // every member change back before a successor can claim the attempt.
        await databaseRequireAttemptFence(
          database,
          transaction,
          normalized,
          documentAssetId,
          attemptFence,
        );

        return { inherited, replaced };
      });
    },
    filterComponentKeys: async (input) => {
      const normalized = normalizeFilterMemberKeysInput(input, maxBatchSize);
      if (normalized.componentKeys.length === 0) {
        return [];
      }

      const params: DatabaseQueryValue[] = [
        normalized.tenantId,
        normalized.knowledgeSpaceId,
        normalized.publicationId,
        normalized.componentType,
      ];
      const componentKeyRef = quoteDatabaseIdentifier(database, "component_key");
      const keyPlaceholders = normalized.componentKeys.map((componentKey) => {
        params.push(componentKey);
        return databasePlaceholder(database, params.length);
      });
      const result = await database.execute({
        maxRows: normalized.componentKeys.length,
        operation: "select",
        params,
        sql: `SELECT ${componentKeyRef} FROM ${quoteDatabaseIdentifier(
          database,
          memberTableName,
        )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
          database,
          1,
        )} AND ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "publication_id",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "component_type",
        )} = ${databasePlaceholder(database, 4)} AND ${componentKeyRef} IN (${keyPlaceholders.join(
          ", ",
        )});`,
        tableName: memberTableName,
      });
      const allowed = new Set(
        result.rows.map((row) => UuidSchema.parse(stringColumn(row, "component_key"))),
      );

      return normalized.componentKeys.filter((componentKey) => allowed.has(componentKey));
    },
    inheritFromPublished: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const excludedComponentKeys = normalizeExcludedComponentKeys(
        input.excludedComponentKeys ?? [],
        maxBatchSize,
      );
      const excludedDocumentAssetId = input.excludedDocumentAssetId
        ? UuidSchema.parse(input.excludedDocumentAssetId)
        : undefined;

      return database.transaction(async (transaction) => {
        const context = await requireDatabaseCandidateContext(database, transaction, normalized);
        if (!context.head) {
          return 0;
        }

        return databaseInheritMembers(database, transaction, {
          candidatePublicationId: context.candidate.id,
          createdAt: normalized.createdAt,
          excludedComponentKeys,
          excludedDocumentAssetId,
          knowledgeSpaceId: normalized.knowledgeSpaceId,
          publishedPublicationId: context.head.publicationId,
          tenantId: normalized.tenantId,
        });
      });
    },
    listByFingerprint,
    listByPublication: listByFingerprint,
    replaceCandidateComponents: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const componentType = parseComponentType(input.componentType);
      const components = normalizeCandidateComponents(
        componentType,
        input.components,
        maxBatchSize,
      );

      return database.transaction(async (transaction) => {
        const context = await requireDatabaseCandidateContext(database, transaction, normalized);
        await databaseDeleteCandidateMembers(
          database,
          transaction,
          context.candidate.id,
          normalized,
          {
            componentType,
          },
        );

        return databaseInsertMembers(
          database,
          transaction,
          components.map((component) =>
            memberFromComponent(normalized, context.candidate.id, component),
          ),
        );
      });
    },
    replaceDocumentComponents: async (input) => {
      const normalized = normalizeCandidateMutation(input);
      const documentAssetId = UuidSchema.parse(input.documentAssetId);
      const components = normalizeDocumentComponents(
        input.components,
        documentAssetId,
        maxBatchSize,
      );

      return database.transaction(async (transaction) => {
        const context = await requireDatabaseCandidateContext(database, transaction, normalized);
        await databaseDeleteCandidateMembers(
          database,
          transaction,
          context.candidate.id,
          normalized,
          {
            documentAssetId,
          },
        );

        return databaseInsertMembers(
          database,
          transaction,
          components.map((component) =>
            memberFromComponent(normalized, context.candidate.id, component),
          ),
        );
      });
    },
  };
}

async function requireMemoryPublication(
  publications: ProjectionSetPublicationRepository,
  input: ProjectionSetPublicationLookupInput,
): Promise<ProjectionSetPublication> {
  const lookup = normalizePublicationLookup(input);
  const publication = await publications.getByFingerprint(lookup);
  if (!publication) {
    throw new ProjectionSetPublicationNotFoundError(lookup.fingerprint);
  }

  return publication;
}

async function requireMemoryCandidateContext(
  publications: ProjectionSetPublicationRepository,
  input: NormalizedCandidateMutation,
): Promise<CandidateMutationContext> {
  const published = await publications.getPublished(input);
  assertHeadRevision(published?.headRevision ?? 0, input.expectedHeadRevision);
  const candidate = await requireMemoryPublication(publications, candidateLookup(input));
  if (candidate.status !== "candidate") {
    throw new ProjectionSetPublicationTransitionError(
      `Projection set member mutations require candidate status; actual=${candidate.status}`,
    );
  }

  return { candidate, published };
}

async function requireDatabaseCandidateContext(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: NormalizedCandidateMutation,
  knowledgeSpaceAlreadyLocked = false,
): Promise<{
  readonly candidate: DatabasePublicationReference;
  readonly head: DatabasePublicationHeadReference | null;
}> {
  if (!knowledgeSpaceAlreadyLocked) {
    await databaseLockKnowledgeSpace(database, transaction, input);
  }
  let head = await databaseGetHeadReference(database, transaction, input, true);
  assertHeadRevision(head?.headRevision ?? 0, input.expectedHeadRevision);
  const candidate = await requireDatabasePublicationReference(
    database,
    transaction,
    candidateLookup(input),
    true,
  );

  if (!head) {
    head = await databaseGetHeadReference(database, transaction, input, true);
    assertHeadRevision(head?.headRevision ?? 0, input.expectedHeadRevision);
  }
  if (candidate.status !== "candidate") {
    throw new ProjectionSetPublicationTransitionError(
      `Projection set member mutations require candidate status; actual=${candidate.status}`,
    );
  }

  return { candidate, head };
}

async function databaseLockKnowledgeSpace(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: Pick<NormalizedCandidateMutation, "knowledgeSpaceId" | "tenantId">,
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
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
  if (!result.rows[0]) {
    throw new ProjectionSetPublicationKnowledgeSpaceNotFoundError(input.knowledgeSpaceId);
  }
}

async function databaseGetPublicationReference(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProjectionSetPublicationLookupInput,
  forUpdate: boolean,
): Promise<DatabasePublicationReference | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.fingerprint],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")}, ${quoteDatabaseIdentifier(
      database,
      "status",
    )} FROM ${quoteDatabaseIdentifier(database, publicationTableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "fingerprint",
    )} = ${databasePlaceholder(database, 3)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: publicationTableName,
  });
  const row = result.rows[0];

  return row
    ? {
        id: UuidSchema.parse(stringColumn(row, "id")),
        status: stringColumn(row, "status"),
      }
    : null;
}

async function requireDatabasePublicationReference(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProjectionSetPublicationLookupInput,
  forUpdate: boolean,
): Promise<DatabasePublicationReference> {
  const publication = await databaseGetPublicationReference(database, executor, input, forUpdate);
  if (!publication) {
    throw new ProjectionSetPublicationNotFoundError(input.fingerprint);
  }

  return publication;
}

async function databaseGetHeadReference(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: Pick<NormalizedCandidateMutation, "knowledgeSpaceId" | "tenantId">,
  forUpdate: boolean,
): Promise<DatabasePublicationHeadReference | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "publication_id")}, ${quoteDatabaseIdentifier(
      database,
      "head_revision",
    )} FROM ${quoteDatabaseIdentifier(database, headTableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: headTableName,
  });
  const row = result.rows[0];

  return row
    ? {
        headRevision: validateHeadRevision(numberColumn(row, "head_revision")),
        publicationId: UuidSchema.parse(stringColumn(row, "publication_id")),
      }
    : null;
}

async function databaseRequireAttemptFence(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: NormalizedCandidateMutation,
  documentAssetId: string,
  fence: NormalizedAttemptFence,
): Promise<void> {
  const databaseWallClock =
    database.dialect === "postgres" ? "clock_timestamp()" : "CURRENT_TIMESTAMP(3)";
  const params: DatabaseQueryValue[] = [
    fence.attemptId,
    input.tenantId,
    input.knowledgeSpaceId,
    documentAssetId,
    fence.documentVersion,
    fence.publicationGenerationId,
    input.expectedHeadRevision,
    fence.candidatePublicationId,
    input.candidateFingerprint,
    fence.expectedRowVersion,
    fence.leaseToken,
  ];
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
      database,
      attemptTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "document_version",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} = ${databasePlaceholder(database, 6)} AND ${quoteDatabaseIdentifier(
      database,
      "base_head_revision",
    )} = ${databasePlaceholder(database, 7)} AND ${quoteDatabaseIdentifier(
      database,
      "candidate_publication_id",
    )} = ${databasePlaceholder(database, 8)} AND ${quoteDatabaseIdentifier(
      database,
      "candidate_fingerprint",
    )} = ${databasePlaceholder(database, 9)} AND ${quoteDatabaseIdentifier(
      database,
      "row_version",
    )} = ${databasePlaceholder(database, 10)} AND ${quoteDatabaseIdentifier(
      database,
      "run_state",
    )} = 'running' AND ${quoteDatabaseIdentifier(database, "active_slot")} = 1 AND ${quoteDatabaseIdentifier(
      database,
      "checkpoint",
    )} IN ('nodes_generated', 'projection_built') AND ${quoteDatabaseIdentifier(
      database,
      "lease_token",
    )} = ${databasePlaceholder(database, 11)} AND ${quoteDatabaseIdentifier(
      database,
      "lease_expires_at",
    )} > ${databaseWallClock} LIMIT 1 FOR UPDATE;`,
    tableName: attemptTableName,
  });
  if (!result.rows[0]) {
    throw new ProjectionSetPublicationMemberAttemptFenceConflictError();
  }
}

async function requireMemoryAttemptFence(
  attempts: Pick<DocumentCompilationAttemptRepository, "get"> | undefined,
  now: () => number,
  input: NormalizedCandidateMutation,
  documentAssetId: string,
  fence: NormalizedAttemptFence,
): Promise<void> {
  if (!attempts) {
    throw new ProjectionSetPublicationMemberAttemptFenceConflictError();
  }
  const attempt = await attempts.get(fence.attemptId);
  const timestamp = now();
  if (
    !Number.isFinite(timestamp) ||
    !matchesMemoryAttemptFence(attempt, timestamp, input, documentAssetId, fence)
  ) {
    throw new ProjectionSetPublicationMemberAttemptFenceConflictError();
  }
}

function matchesMemoryAttemptFence(
  attempt: DocumentCompilationAttempt | null,
  timestamp: number,
  input: NormalizedCandidateMutation,
  documentAssetId: string,
  fence: NormalizedAttemptFence,
): boolean {
  return Boolean(
    attempt &&
      attempt.id === fence.attemptId &&
      attempt.tenantId === input.tenantId &&
      attempt.knowledgeSpaceId === input.knowledgeSpaceId &&
      attempt.documentAssetId === documentAssetId &&
      attempt.documentVersion === fence.documentVersion &&
      attempt.publicationGenerationId === fence.publicationGenerationId &&
      attempt.baseHeadRevision === input.expectedHeadRevision &&
      attempt.candidatePublicationId === fence.candidatePublicationId &&
      attempt.candidateFingerprint === input.candidateFingerprint &&
      attempt.rowVersion === fence.expectedRowVersion &&
      attempt.runState === "running" &&
      attempt.activeSlot === 1 &&
      (attempt.checkpoint === "nodes_generated" || attempt.checkpoint === "projection_built") &&
      attempt.leaseToken === fence.leaseToken &&
      attempt.leaseExpiresAt !== undefined &&
      Date.parse(attempt.leaseExpiresAt) > timestamp,
  );
}

async function databaseInheritMembers(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: {
    readonly candidatePublicationId: string;
    readonly createdAt: string;
    readonly excludedComponentKeys: readonly string[];
    readonly excludedDocumentAssetId?: string | undefined;
    readonly knowledgeSpaceId: string;
    readonly publishedPublicationId: string;
    readonly tenantId: string;
  },
): Promise<number> {
  const sourceAlias = "source_member";
  // TiDB uses positional `?` placeholders, so bind in exact textual SQL order. PostgreSQL also
  // uses this order even though its numbered placeholders could technically be reused.
  const params: DatabaseQueryValue[] = [];
  const bind = (value: DatabaseQueryValue): string => {
    params.push(value);
    return databasePlaceholder(database, params.length);
  };
  const selectedCandidatePublication = bind(input.candidatePublicationId);
  const selectedCreatedAt = bind(input.createdAt);
  const conditions = [
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "tenant_id")} = ${bind(input.tenantId)}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${bind(input.knowledgeSpaceId)}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${bind(input.publishedPublicationId)}`,
  ];
  if (input.excludedComponentKeys.length > 0) {
    const placeholders = input.excludedComponentKeys.map(bind);
    conditions.push(
      `${sourceAlias}.${quoteDatabaseIdentifier(database, "component_key")} NOT IN (${placeholders.join(", ")})`,
    );
  }
  if (input.excludedDocumentAssetId) {
    const placeholder = bind(input.excludedDocumentAssetId);
    conditions.push(
      `(${sourceAlias}.${quoteDatabaseIdentifier(database, "document_asset_id")} IS NULL OR ${sourceAlias}.${quoteDatabaseIdentifier(
        database,
        "document_asset_id",
      )} <> ${placeholder})`,
    );
  }

  const selectedColumns = [
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "tenant_id")}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "knowledge_space_id")}`,
    selectedCandidatePublication,
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "component_type")}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "component_key")}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "generation_id")}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "document_asset_id")}`,
    selectedCreatedAt,
  ];
  const candidateAlias = "candidate_member";
  const candidateDocumentAssetRef = `${candidateAlias}.${quoteDatabaseIdentifier(
    database,
    "document_asset_id",
  )}`;
  const sourceDocumentAssetRef = `${sourceAlias}.${quoteDatabaseIdentifier(
    database,
    "document_asset_id",
  )}`;
  const documentOwnerDiff =
    database.dialect === "postgres"
      ? `${candidateDocumentAssetRef} IS DISTINCT FROM ${sourceDocumentAssetRef}`
      : `NOT (${candidateDocumentAssetRef} <=> ${sourceDocumentAssetRef})`;
  const conflictParams: DatabaseQueryValue[] = [];
  const bindConflict = (value: DatabaseQueryValue): string => {
    conflictParams.push(value);
    return databasePlaceholder(database, conflictParams.length);
  };
  const conflictCandidatePublication = bindConflict(input.candidatePublicationId);
  const conflictConditions = [
    `${sourceAlias}.${quoteDatabaseIdentifier(database, "tenant_id")} = ${bindConflict(input.tenantId)}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${bindConflict(input.knowledgeSpaceId)}`,
    `${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${bindConflict(input.publishedPublicationId)}`,
  ];
  if (input.excludedComponentKeys.length > 0) {
    const placeholders = input.excludedComponentKeys.map(bindConflict);
    conflictConditions.push(
      `${sourceAlias}.${quoteDatabaseIdentifier(database, "component_key")} NOT IN (${placeholders.join(", ")})`,
    );
  }
  if (input.excludedDocumentAssetId) {
    const placeholder = bindConflict(input.excludedDocumentAssetId);
    conflictConditions.push(
      `(${sourceAlias}.${quoteDatabaseIdentifier(database, "document_asset_id")} IS NULL OR ${sourceAlias}.${quoteDatabaseIdentifier(
        database,
        "document_asset_id",
      )} <> ${placeholder})`,
    );
  }
  const conflict = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: conflictParams,
    sql: `SELECT ${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )}, ${sourceAlias}.${quoteDatabaseIdentifier(database, "generation_id")} FROM ${quoteDatabaseIdentifier(
      database,
      memberTableName,
    )} ${sourceAlias} INNER JOIN ${quoteDatabaseIdentifier(
      database,
      memberTableName,
    )} ${candidateAlias} ON ${candidateAlias}.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} AND ${candidateAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} AND ${candidateAlias}.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${conflictCandidatePublication} AND ${candidateAlias}.${quoteDatabaseIdentifier(
      database,
      "component_type",
    )} = ${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "component_type",
    )} AND ${candidateAlias}.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} = ${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "component_key",
    )} WHERE ${conflictConditions.join(" AND ")} AND (${candidateAlias}.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} <> ${sourceAlias}.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} OR ${documentOwnerDiff}) LIMIT 1 FOR UPDATE;`,
    tableName: memberTableName,
  });
  const conflictingMember = conflict.rows[0];
  if (conflictingMember) {
    throw new ProjectionSetPublicationMemberIdentityConflictError(
      stringColumn(conflictingMember, "component_key"),
      stringColumn(conflictingMember, "generation_id"),
    );
  }
  const insertConditions = [...conditions];
  if (database.dialect === "tidb") {
    const existingAlias = "existing_candidate_member";
    const existingCandidatePublicationPlaceholder = bind(input.candidatePublicationId);
    insertConditions.push(
      `NOT EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
        database,
        memberTableName,
      )} ${existingAlias} WHERE ${existingAlias}.${quoteDatabaseIdentifier(
        database,
        "tenant_id",
      )} = ${sourceAlias}.${quoteDatabaseIdentifier(
        database,
        "tenant_id",
      )} AND ${existingAlias}.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${sourceAlias}.${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} AND ${existingAlias}.${quoteDatabaseIdentifier(
        database,
        "publication_id",
      )} = ${existingCandidatePublicationPlaceholder} AND ${existingAlias}.${quoteDatabaseIdentifier(
        database,
        "component_type",
      )} = ${sourceAlias}.${quoteDatabaseIdentifier(
        database,
        "component_type",
      )} AND ${existingAlias}.${quoteDatabaseIdentifier(
        database,
        "component_key",
      )} = ${sourceAlias}.${quoteDatabaseIdentifier(database, "component_key")})`,
    );
  }
  const conflictClause =
    database.dialect === "postgres"
      ? ` ON CONFLICT (${memberIdentityColumns
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) DO NOTHING`
      : "";
  const result = await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, memberTableName)} (${memberColumns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) SELECT ${selectedColumns.join(", ")} FROM ${quoteDatabaseIdentifier(
      database,
      memberTableName,
    )} ${sourceAlias} WHERE ${insertConditions.join(" AND ")}${conflictClause};`,
    tableName: memberTableName,
  });

  return result.rowsAffected;
}

async function databaseDeleteCandidateMembers(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publicationId: string,
  input: NormalizedCandidateMutation,
  selector:
    | { readonly componentType: ProjectionSetPublicationComponentType }
    | { readonly documentAssetId: string },
): Promise<number> {
  const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId, publicationId];
  const selectorColumn = "componentType" in selector ? "component_type" : "document_asset_id";
  const selectorValue =
    "componentType" in selector ? selector.componentType : selector.documentAssetId;
  params.push(selectorValue);
  const result = await transaction.execute({
    maxRows: 0,
    operation: "delete",
    params,
    sql: `DELETE FROM ${quoteDatabaseIdentifier(
      database,
      memberTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      selectorColumn,
    )} = ${databasePlaceholder(database, 4)};`,
    tableName: memberTableName,
  });

  return result.rowsAffected;
}

async function databaseDeleteAllCandidateMembers(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publicationId: string,
  input: NormalizedCandidateMutation,
): Promise<number> {
  const result = await transaction.execute({
    maxRows: 0,
    operation: "delete",
    params: [input.tenantId, input.knowledgeSpaceId, publicationId],
    sql: `DELETE FROM ${quoteDatabaseIdentifier(
      database,
      memberTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)};`,
    tableName: memberTableName,
  });

  return result.rowsAffected;
}

async function databaseInsertMembers(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  members: readonly ProjectionSetPublicationMember[],
): Promise<number> {
  if (members.length === 0) {
    return 0;
  }

  const params = members.flatMap(memberColumnValues) satisfies readonly DatabaseQueryValue[];
  const values = members
    .map((_, rowIndex) => {
      const offset = rowIndex * memberColumns.length;
      return `(${memberColumns
        .map((__, columnIndex) => databasePlaceholder(database, offset + columnIndex + 1))
        .join(", ")})`;
    })
    .join(", ");
  const result = await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, memberTableName)} (${memberColumns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES ${values};`,
    tableName: memberTableName,
  });

  return result.rowsAffected;
}

async function databaseInsertMembersInChunks(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  members: readonly ProjectionSetPublicationMember[],
  chunkSize: number,
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < members.length; offset += chunkSize) {
    const chunk = members.slice(offset, offset + chunkSize);
    const chunkInserted = await databaseInsertMembers(database, transaction, chunk);
    if (chunkInserted !== chunk.length) {
      throw new ProjectionSetPublicationMemberWriteConflictError(chunk.length, chunkInserted);
    }
    inserted += chunkInserted;
  }

  return inserted;
}

async function databaseListMembers(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  publicationId: string,
  input: Pick<ProjectionSetPublicationLookupInput, "knowledgeSpaceId" | "tenantId">,
  maxListLimit: number,
): Promise<readonly ProjectionSetPublicationMember[]> {
  const readLimit = maxListLimit + 1;
  const result = await executor.execute({
    maxRows: readLimit,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, publicationId, readLimit],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      memberTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${databasePlaceholder(database, 3)} ORDER BY ${[
      "component_type",
      "component_key",
      "generation_id",
    ]
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")} ASC LIMIT ${databasePlaceholder(database, 4)};`,
    tableName: memberTableName,
  });
  if (result.rows.length > maxListLimit) {
    throw new ProjectionSetPublicationMemberListLimitExceededError(maxListLimit);
  }

  return result.rows.map(mapMemberRow);
}

function normalizeCandidateMutation(
  input: ProjectionSetPublicationCandidateMutationInput,
): NormalizedCandidateMutation {
  return {
    candidateFingerprint: ProjectionSetFingerprintSchema.parse(input.candidateFingerprint),
    createdAt: DateTimeSchema.parse(input.createdAt),
    expectedHeadRevision: validateHeadRevision(input.expectedHeadRevision),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: normalizeTenantId(input.tenantId),
  };
}

function normalizeAttemptFence(
  input: ProjectionSetPublicationAttemptFenceInput,
): NormalizedAttemptFence {
  return {
    attemptId: UuidSchema.parse(input.attemptId),
    candidatePublicationId: UuidSchema.parse(input.candidatePublicationId),
    documentVersion: positiveInteger(input.documentVersion, "documentVersion"),
    expectedRowVersion: nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion"),
    leaseToken: nonzeroUuid(input.leaseToken, "leaseToken"),
    publicationGenerationId: PublicationGenerationIdSchema.parse(input.publicationGenerationId),
  };
}

function assertFenceCandidate(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new ProjectionSetPublicationMemberAttemptFenceConflictError();
  }
}

function assertDocumentComponentsGeneration(
  components: readonly ProjectionSetPublicationMemberComponent[],
  publicationGenerationId: string,
): void {
  if (components.some((component) => component.generationId !== publicationGenerationId)) {
    throw new ProjectionSetPublicationMemberAttemptFenceConflictError();
  }
}

function normalizePublicationLookup(
  input: ProjectionSetPublicationLookupInput,
): ProjectionSetPublicationLookupInput {
  return {
    fingerprint: ProjectionSetFingerprintSchema.parse(input.fingerprint),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: normalizeTenantId(input.tenantId),
  };
}

function normalizeFilterMemberKeysInput(
  input: FilterProjectionSetPublicationMemberKeysInput,
  maxKeys: number,
): FilterProjectionSetPublicationMemberKeysInput {
  if (input.componentKeys.length > maxKeys) {
    throw new ProjectionSetPublicationMemberBatchSizeExceededError(maxKeys);
  }

  return {
    componentKeys: [...new Set(input.componentKeys.map(normalizeComponentKey))],
    componentType: parseComponentType(input.componentType),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    publicationId: UuidSchema.parse(input.publicationId),
    tenantId: normalizeTenantId(input.tenantId),
  };
}

function candidateLookup(input: NormalizedCandidateMutation): ProjectionSetPublicationLookupInput {
  return {
    fingerprint: input.candidateFingerprint,
    knowledgeSpaceId: input.knowledgeSpaceId,
    tenantId: input.tenantId,
  };
}

function normalizeCandidateComponents(
  componentType: ProjectionSetPublicationComponentType,
  components: readonly ProjectionSetPublicationCandidateComponentInput[],
  maxBatchSize: number,
): readonly ProjectionSetPublicationMemberComponent[] {
  validateBatchSize(components.length, maxBatchSize);

  return deduplicateComponents(
    components.map((component) => ({
      componentKey: normalizeComponentKey(component.componentKey),
      componentType,
      ...(component.documentAssetId
        ? { documentAssetId: UuidSchema.parse(component.documentAssetId) }
        : {}),
      generationId: PublicationGenerationIdSchema.parse(component.generationId),
    })),
  );
}

function normalizeDocumentComponents(
  components: readonly ProjectionSetPublicationDocumentComponentInput[],
  documentAssetId: string,
  maxBatchSize: number,
): readonly ProjectionSetPublicationMemberComponent[] {
  validateBatchSize(components.length, maxBatchSize);

  return deduplicateComponents(
    components.map((component) => ({
      componentKey: normalizeComponentKey(component.componentKey),
      componentType: parseComponentType(component.componentType),
      documentAssetId,
      generationId: PublicationGenerationIdSchema.parse(component.generationId),
    })),
  );
}

interface ProjectionSetPublicationMemberComponent {
  readonly componentKey: string;
  readonly componentType: ProjectionSetPublicationComponentType;
  readonly documentAssetId?: string | undefined;
  readonly generationId: string;
}

function deduplicateComponents(
  components: readonly ProjectionSetPublicationMemberComponent[],
): readonly ProjectionSetPublicationMemberComponent[] {
  const unique = new Map<string, ProjectionSetPublicationMemberComponent>();
  for (const component of components) {
    const key = componentIdentity(component);
    const existing = unique.get(key);
    if (
      existing &&
      (existing.generationId !== component.generationId ||
        existing.documentAssetId !== component.documentAssetId)
    ) {
      throw new ProjectionSetPublicationMemberIdentityConflictError(
        component.componentKey,
        component.generationId,
      );
    }
    unique.set(key, component);
  }

  return [...unique.values()];
}

function memberFromComponent(
  input: NormalizedCandidateMutation,
  publicationId: string,
  component: ProjectionSetPublicationMemberComponent,
): ProjectionSetPublicationMember {
  return parseMember({
    ...component,
    createdAt: input.createdAt,
    knowledgeSpaceId: input.knowledgeSpaceId,
    publicationId,
    tenantId: input.tenantId,
  });
}

function parseMember(member: ProjectionSetPublicationMember): ProjectionSetPublicationMember {
  return {
    componentKey: normalizeComponentKey(member.componentKey),
    componentType: parseComponentType(member.componentType),
    createdAt: DateTimeSchema.parse(member.createdAt),
    ...(member.documentAssetId
      ? { documentAssetId: UuidSchema.parse(member.documentAssetId) }
      : {}),
    generationId: PublicationGenerationIdSchema.parse(member.generationId),
    knowledgeSpaceId: UuidSchema.parse(member.knowledgeSpaceId),
    publicationId: UuidSchema.parse(member.publicationId),
    tenantId: normalizeTenantId(member.tenantId),
  };
}

function mapMemberRow(row: DatabaseRow): ProjectionSetPublicationMember {
  return parseMember({
    componentKey: stringColumn(row, "component_key"),
    componentType: parseComponentType(stringColumn(row, "component_type")),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: optionalStringColumn(row, "document_asset_id"),
    generationId: stringColumn(row, "generation_id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    publicationId: stringColumn(row, "publication_id"),
    tenantId: stringColumn(row, "tenant_id"),
  });
}

function memberColumnValues(member: ProjectionSetPublicationMember): readonly DatabaseQueryValue[] {
  return [
    member.tenantId,
    member.knowledgeSpaceId,
    member.publicationId,
    member.componentType,
    member.componentKey,
    member.generationId,
    member.documentAssetId ?? null,
    member.createdAt,
  ];
}

function commitMemoryMembers(
  target: Map<string, ProjectionSetPublicationMember>,
  next: ReadonlyMap<string, ProjectionSetPublicationMember>,
  maxMembers: number,
): void {
  if (next.size > maxMembers) {
    throw new ProjectionSetPublicationMemberCapacityExceededError(maxMembers);
  }
  target.clear();
  for (const [key, member] of next) {
    target.set(key, cloneMember(member));
  }
}

function sortedMembers(
  values: Iterable<ProjectionSetPublicationMember>,
): readonly ProjectionSetPublicationMember[] {
  return [...values].sort(
    (left, right) =>
      left.componentType.localeCompare(right.componentType) ||
      left.componentKey.localeCompare(right.componentKey) ||
      left.generationId.localeCompare(right.generationId),
  );
}

function cloneMember(member: ProjectionSetPublicationMember): ProjectionSetPublicationMember {
  return parseMember({ ...member });
}

function setCompatibleMemoryMember(
  members: Map<string, ProjectionSetPublicationMember>,
  member: ProjectionSetPublicationMember,
): void {
  const key = memberIdentity(member);
  const existing = members.get(key);
  if (
    existing &&
    (existing.generationId !== member.generationId ||
      existing.documentAssetId !== member.documentAssetId)
  ) {
    throw new ProjectionSetPublicationMemberIdentityConflictError(
      member.componentKey,
      member.generationId,
    );
  }
  members.set(key, member);
}

function memberIdentity(member: ProjectionSetPublicationMember): string {
  return JSON.stringify([
    member.tenantId,
    member.knowledgeSpaceId,
    member.publicationId,
    member.componentType,
    member.componentKey,
  ]);
}

function componentIdentity(component: ProjectionSetPublicationMemberComponent): string {
  return JSON.stringify([component.componentType, component.componentKey]);
}

function normalizeExcludedComponentKeys(
  componentKeys: readonly string[],
  maxBatchSize: number,
): readonly string[] {
  validateBatchSize(componentKeys.length, maxBatchSize);
  return [...new Set(componentKeys.map(normalizeComponentKey))];
}

function parseComponentType(value: string): ProjectionSetPublicationComponentType {
  if (!componentTypeSet.has(value)) {
    throw new Error(`Unsupported projection set publication component type=${value}`);
  }

  return value as ProjectionSetPublicationComponentType;
}

function normalizeComponentKey(value: string): string {
  return UuidSchema.parse(value);
}

function normalizeTenantId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Projection set publication member tenantId is required");
  }
  if (normalized.length > 255) {
    throw new Error("Projection set publication member tenantId must be at most 255 characters");
  }

  return normalized;
}

function validateHeadRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(
      "Projection set publication member expectedHeadRevision must be between 0 and 2147483647",
    );
  }

  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`Projection set publication member ${field} must be between 1 and 2147483647`);
  }
  return value;
}

function nonnegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(`Projection set publication member ${field} must be between 0 and 2147483647`);
  }
  return value;
}

function nonzeroUuid(value: string, field: string): string {
  const parsed = UuidSchema.parse(value);
  if (parsed === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`Projection set publication member ${field} must be a non-zero UUID`);
  }
  return parsed;
}

function assertHeadRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ProjectionSetPublicationHeadConflictError(expected, actual);
  }
}

function validateBatchSize(size: number, maxBatchSize: number): void {
  if (size > maxBatchSize) {
    throw new ProjectionSetPublicationMemberBatchSizeExceededError(maxBatchSize);
  }
}

function validatePositiveBound(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Projection set publication member ${label} must be at least 1`);
  }
}
