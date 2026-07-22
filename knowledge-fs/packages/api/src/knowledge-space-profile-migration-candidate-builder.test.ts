import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseTransactionCallback,
  IndexProjection,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { deterministicChildId } from "./api-shared-utils";
import type { KnowledgeSpaceProfileMigrationRun } from "./knowledge-space-profile-migration";
import {
  type ReplaceKnowledgeSpaceProfileMigrationCandidateSnapshotInput,
  createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository,
  createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder,
  createRepositoryKnowledgeSpaceProfileMigrationEvaluator,
} from "./knowledge-space-profile-migration-candidate-builder";
import type { ProjectionSetPublicationMember } from "./projection-publication-member-repository";
import type {
  CreateProjectionSetCandidateInput,
  ProjectionSetPublication,
  PublishedProjectionSetPublication,
} from "./projection-publication-repository";

const tenantId = "tenant-migration-candidate";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a01";
const runId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a02";
const basePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a03";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a04";
const outlineId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a05";
const ftsId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a06";
const denseId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a07";
const pathId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a08";
const baseGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a09";
const baseFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const vectorSpaceId = `embedding-space-sha256:${"c".repeat(64)}`;
const now = "2026-07-14T12:00:00.000Z";
const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f5a0a";
const candidateFingerprint = `projection-set-sha256:${"b".repeat(64)}`;

describe.each(["postgres", "tidb"] as const)(
  "profile migration candidate snapshot repository (%s)",
  (dialect) => {
    it("atomically replaces a complete member snapshot in bounded batches", async () => {
      const fake = candidateSnapshotDatabase(dialect);
      const repository = createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository({
        database: fake.database,
        maxMembers: 5,
        writeBatchSize: 2,
      });

      await expect(repository.replace(candidateSnapshotInput())).resolves.toMatchObject([
        {
          componentKey: outlineId,
          documentAssetId,
          publicationId: candidatePublicationId,
        },
        { componentKey: ftsId, publicationId: candidatePublicationId },
        { componentKey: denseId, publicationId: candidatePublicationId },
      ]);
      expect(
        fake.calls.filter(
          (call) =>
            call.operation === "insert" && call.tableName === "projection_set_publication_members",
        ),
      ).toHaveLength(2);
      expect(
        fake.calls.find((call) => call.tableName === "projection_set_publication_heads")?.sql,
      ).toContain("FOR UPDATE");
      expect(
        fake.calls.every((call) =>
          dialect === "postgres"
            ? Math.max(
                0,
                ...[...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1])),
              ) === call.params.length
            : (call.sql.match(/\?/gu) ?? []).length === call.params.length,
        ),
      ).toBe(true);
    });

    it("rejects deletion, base-head, candidate, and short-insert races", async () => {
      for (const [options, code] of [
        [{ activeDeletion: true }, "PROFILE_MIGRATION_SPACE_NOT_WRITABLE"],
        [{ missingBase: true }, "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED"],
        [{ missingCandidate: true }, "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_CHANGED"],
        [{ shortInsert: true }, "PROFILE_MIGRATION_CANDIDATE_MEMBER_CONFLICT"],
      ] as const) {
        const fake = candidateSnapshotDatabase(dialect, options);
        const repository = createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository({
          database: fake.database,
          maxMembers: 5,
          writeBatchSize: 2,
        });
        await expect(repository.replace(candidateSnapshotInput())).rejects.toMatchObject({ code });
      }
    });

    it("normalizes and validates repository bounds before issuing SQL", async () => {
      const fake = candidateSnapshotDatabase(dialect);
      expect(() =>
        createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository({
          database: fake.database,
          maxMembers: 0,
          writeBatchSize: 1,
        }),
      ).toThrow("maxMembers must be positive");
      expect(() =>
        createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository({
          database: fake.database,
          maxMembers: 1,
          writeBatchSize: 0,
        }),
      ).toThrow("writeBatchSize must be positive");

      const repository = createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository({
        database: fake.database,
        maxMembers: 2,
        writeBatchSize: 1,
      });
      await expect(repository.replace(candidateSnapshotInput())).rejects.toThrow(
        "candidate members exceed 2",
      );
      const duplicate = candidateSnapshotInput();
      const firstMember = duplicate.members[0];
      if (!firstMember) throw new Error("candidate snapshot fixture requires a member");
      await expect(
        repository.replace({
          ...duplicate,
          members: [firstMember, firstMember],
        }),
      ).rejects.toThrow("Duplicate candidate member");
      await expect(
        repository.replace({
          ...duplicate,
          members: [{ ...firstMember, componentType: "invalid" as never }],
        }),
      ).rejects.toThrow("Unsupported publication component type");
      expect(fake.calls).toEqual([]);
    });
  },
);

function candidateSnapshotInput(): ReplaceKnowledgeSpaceProfileMigrationCandidateSnapshotInput {
  return {
    basePublication: {
      fingerprint: baseFingerprint,
      headRevision: 3,
      id: basePublicationId,
    },
    candidatePublicationFingerprint: candidateFingerprint,
    candidatePublicationId,
    createdAt: now,
    knowledgeSpaceId: spaceId,
    members: [
      {
        componentKey: outlineId,
        componentType: "document-outline",
        documentAssetId,
        generationId: baseGenerationId,
      },
      {
        componentKey: ftsId,
        componentType: "index-projection",
        generationId: baseGenerationId,
      },
      {
        componentKey: denseId,
        componentType: "index-projection",
        documentAssetId,
        generationId: baseGenerationId,
      },
    ],
    tenantId,
  };
}

function candidateSnapshotDatabase(
  dialect: "postgres" | "tidb",
  options: {
    readonly activeDeletion?: boolean | undefined;
    readonly missingBase?: boolean | undefined;
    readonly missingCandidate?: boolean | undefined;
    readonly shortInsert?: boolean | undefined;
  } = {},
) {
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "deletion_jobs") {
      return options.activeDeletion
        ? { rows: [{ id: "active-deletion" }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "projection_set_publication_heads") {
      return options.missingBase
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ id: basePublicationId }], rowsAffected: 1 };
    }
    if (input.tableName === "projection_set_publications") {
      return options.missingCandidate
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ id: candidatePublicationId }], rowsAffected: 1 };
    }
    if (input.operation === "insert" && input.tableName === "projection_set_publication_members") {
      const expected = input.params.length / 8;
      return { rows: [], rowsAffected: options.shortInsert ? expected - 1 : expected };
    }
    if (input.operation === "delete" && input.tableName === "projection_set_publication_members") {
      return { rows: [], rowsAffected: 1 };
    }
    throw new Error(`Unexpected ${input.operation} on ${input.tableName}`);
  };
  const database = {
    dialect,
    execute,
    kind: dialect,
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) => callback({ execute }),
  } as unknown as DatabaseAdapter;
  return { calls, database };
}

describe("profile migration candidate builder", () => {
  it("builds an empty exact successor with a deterministic non-colliding identity", async () => {
    const base: PublishedProjectionSetPublication = {
      createdAt: now,
      fingerprint: baseFingerprint,
      headRevision: 3,
      id: basePublicationId,
      knowledgeSpaceId: spaceId,
      metadata: {},
      projectionVersion: 1,
      status: "published",
      tenantId,
      updatedAt: now,
    };
    let candidate: ProjectionSetPublication | undefined;
    let candidateMembers: readonly ProjectionSetPublicationMember[] = [];
    const publications = {
      createCandidate: vi.fn(async (input: CreateProjectionSetCandidateInput) => {
        candidate = {
          ...(input as unknown as ProjectionSetPublication),
          metadata: (input.metadata as Record<string, unknown>) ?? {},
          status: "candidate",
          updatedAt: String(input.createdAt),
        };
        return candidate;
      }),
      getByFingerprint: async (input: { readonly fingerprint: string }) =>
        candidate?.fingerprint === input.fingerprint ? candidate : null,
      getPublished: async () => base,
      validate: async () => {
        if (!candidate) throw new Error("candidate missing");
        candidate = { ...candidate, status: "validating", updatedAt: now };
        return candidate;
      },
    };
    const builder = createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder({
      artifacts: {} as never,
      assets: {} as never,
      maxDocuments: 10,
      maxMembers: 10,
      maxProjectionBatchSize: 10,
      members: {
        listByFingerprint: async ({ fingerprint }) =>
          fingerprint === baseFingerprint ? [] : candidateMembers,
      },
      now: () => now,
      outlineBuilder: {} as never,
      outlineSummaryEnhancer: {} as never,
      outlines: {} as never,
      pageIndexBuild: {} as never,
      profiles: {} as never,
      projections: { getMany: async () => [] },
      publications,
      reindexer: {} as never,
      snapshots: {
        replace: async (input) => {
          candidateMembers = input.members.map((member) => ({
            ...member,
            createdAt: input.createdAt,
            knowledgeSpaceId: input.knowledgeSpaceId,
            publicationId: input.candidatePublicationId,
            tenantId: input.tenantId,
          }));
          return candidateMembers;
        },
      },
    });
    const input = {
      basePublication: {
        fingerprint: baseFingerprint,
        headRevision: 3,
        id: basePublicationId,
      },
      baseRetrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: digestA },
      candidateProfile: { id: "retrieval-2", revision: 2, snapshotDigest: digestB },
      changedKind: "retrieval" as const,
      knowledgeSpaceId: spaceId,
      rebuildScope: "clone-publication" as const,
      runId,
      tenantId,
    };

    const built = await builder.build(input);
    expect(built).toMatchObject({
      publicationStatus: "validating",
      successorMembersCloned: true,
    });
    expect(built.publicationFingerprint).not.toBe(baseFingerprint);
    await expect(
      builder.getBuiltCandidate({
        ...input,
        publicationFingerprint: built.publicationFingerprint,
        publicationId: built.publicationId,
      }),
    ).resolves.toEqual(built);
    expect(publications.createCandidate).toHaveBeenCalledOnce();
  });

  it("rebuilds every reasoning outline, Summary, and PageIndex while preserving non-target members", async () => {
    const fixture = builderFixture("full-page-index-summary-outline");
    const built = await fixture.builder.build(fixture.input);

    expect(built).toMatchObject({
      pageIndexSummaryOutlineRebuilt: true,
      publicationStatus: "validating",
    });
    expect(fixture.enhance).toHaveBeenCalledOnce();
    expect(fixture.materialize).toHaveBeenCalledOnce();
    expect(fixture.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(fixture.candidateMembers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentKey: pathId, componentType: "knowledge-path" }),
        expect.objectContaining({
          componentKey: fixture.rebuiltOutlineId,
          componentType: "document-outline",
          generationId: fixture.expectedGenerationId,
        }),
      ]),
    );
    await expect(
      fixture.builder.getBuiltCandidate({
        ...fixture.input,
        publicationFingerprint: built.publicationFingerprint,
        publicationId: built.publicationId,
      }),
    ).resolves.toEqual(built);
  });

  it("rejects a reasoning build whose PageIndex proof is incomplete before validation", async () => {
    const fixture = builderFixture("full-page-index-summary-outline", {
      completePageIndex: false,
    });
    await expect(fixture.builder.build(fixture.input)).rejects.toMatchObject({
      code: "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
    });
    expect(fixture.validate).not.toHaveBeenCalled();
    expect(fixture.published().fingerprint).toBe(baseFingerprint);
  });

  it("rebuilds the ordinary vector space from the exact receipt and preserves path/visual members", async () => {
    const fixture = builderFixture("full-vector-space");
    const built = await fixture.builder.build(fixture.input);

    expect(built).toMatchObject({
      fullVectorSpaceRebuilt: true,
      publicationStatus: "validating",
    });
    expect(fixture.reindex).toHaveBeenCalledOnce();
    expect(fixture.candidateMembers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentKey: pathId, componentType: "knowledge-path" }),
        expect.objectContaining({ componentKey: fixture.visualProjectionId }),
        expect.objectContaining({ componentKey: fixture.rebuiltFtsId }),
        expect.objectContaining({ componentKey: fixture.rebuiltDenseId }),
      ]),
    );
    expect(
      fixture.candidateMembers().some((member) => member.componentKey === fixture.baseDenseId),
    ).toBe(false);
    await expect(
      fixture.builder.getBuiltCandidate({
        ...fixture.input,
        publicationFingerprint: built.publicationFingerprint,
        publicationId: built.publicationId,
      }),
    ).resolves.toEqual(built);
  });

  it("rejects an incomplete vector reindex receipt without freezing a member snapshot", async () => {
    const fixture = builderFixture("full-vector-space", { incompleteReindexReceipt: true });
    await expect(fixture.builder.build(fixture.input)).rejects.toMatchObject({
      code: "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
    });
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(fixture.validate).not.toHaveBeenCalled();
  });

  it("fails closed when the frozen base head is lost during atomic snapshot replacement", async () => {
    const fixture = builderFixture("full-page-index-summary-outline", {
      staleSnapshotFence: true,
    });
    await expect(fixture.builder.build(fixture.input)).rejects.toMatchObject({
      code: "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
    });
    expect(fixture.validate).not.toHaveBeenCalled();
    expect(fixture.published().fingerprint).toBe(baseFingerprint);
  });

  it("keeps a validate-failed candidate unreachable and the old head published", async () => {
    const fixture = builderFixture("full-vector-space", { failValidation: true });
    await expect(fixture.builder.build(fixture.input)).rejects.toThrow("validation failed");
    expect(fixture.published().fingerprint).toBe(baseFingerprint);
    expect(fixture.candidateStatus()).toBe("candidate");
  });

  it("fails closed on malformed frozen-base ownership and source snapshots", async () => {
    const outlineMember = member("document-outline", outlineId, baseGenerationId);
    const otherOutline = {
      ...member("document-outline", ftsId, baseGenerationId),
      documentAssetId: candidatePublicationId,
    };
    const cases = [
      {
        code: "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
        fixture: guardBuilder({ missingPublication: true }),
      },
      {
        code: "PROFILE_MIGRATION_BASE_MEMBER_LIMIT",
        fixture: guardBuilder({ baseMembers: [outlineMember, otherOutline], maxMembers: 1 }),
      },
      {
        code: "PROFILE_MIGRATION_DOCUMENT_LIMIT",
        fixture: guardBuilder({
          baseMembers: [outlineMember, otherOutline],
          maxDocuments: 1,
        }),
      },
      {
        code: "PROFILE_MIGRATION_BASE_OUTLINE_INVALID",
        fixture: guardBuilder({
          baseMembers: [member("knowledge-path", pathId, baseGenerationId)],
        }),
      },
      {
        code: "PROFILE_MIGRATION_BASE_OUTLINE_INVALID",
        fixture: guardBuilder({
          baseMembers: [outlineMember, member("document-outline", ftsId, baseGenerationId)],
        }),
      },
      {
        code: "PROFILE_MIGRATION_BASE_OUTLINE_INVALID",
        fixture: guardBuilder({ baseMembers: [outlineMember], missingOutline: true }),
      },
      {
        code: "PROFILE_MIGRATION_SOURCE_SNAPSHOT_INVALID",
        fixture: guardBuilder({ baseMembers: [outlineMember], missingArtifact: true }),
      },
      {
        code: "PROFILE_MIGRATION_BASE_MEMBER_INVALID",
        fixture: guardBuilder({
          baseMembers: [
            outlineMember,
            {
              ...member("knowledge-path", pathId, baseGenerationId),
              documentAssetId: candidatePublicationId,
            },
          ],
        }),
      },
    ];

    for (const { code, fixture } of cases) {
      await expect(fixture.builder.build(fixture.input)).rejects.toMatchObject({ code });
    }
  });

  it.each([
    ["publication id", { publishedId: candidatePublicationId }],
    ["publication fingerprint", { publishedFingerprint: candidateFingerprint }],
    ["publication head revision", { publishedHeadRevision: 4 }],
    ["outline space", { outlineKnowledgeSpaceId: candidatePublicationId }],
    ["outline document", { outlineDocumentAssetId: candidatePublicationId }],
    ["outline generation", { outlineGenerationId: candidatePublicationId }],
    ["artifact document", { artifactDocumentAssetId: candidatePublicationId }],
    ["artifact version", { artifactVersion: 2 }],
    ["artifact hash", { artifactHash: digestB }],
    ["missing asset", { missingAsset: true }],
    ["asset version", { assetVersion: 2 }],
  ] as const)("rejects frozen-base drift in the %s", async (_name, drift) => {
    const fixture = guardBuilder({
      baseMembers: [member("document-outline", outlineId, baseGenerationId)],
      ...drift,
    });

    await expect(fixture.builder.build(fixture.input)).rejects.toMatchObject({
      code: expect.stringMatching(
        /PROFILE_MIGRATION_(BASE_PUBLICATION_CHANGED|BASE_OUTLINE_INVALID|SOURCE_SNAPSHOT_INVALID)/u,
      ),
    });
  });

  it.each([
    ["another id", { id: candidatePublicationId, status: "validating" as const }],
    ["a published lifecycle", { status: "published" as const }],
  ])("rejects a deterministic candidate owned by %s", async (_name, override) => {
    const fixture = guardBuilder({ candidate: migrationCandidate(override) });

    await expect(fixture.builder.build(fixture.input)).rejects.toMatchObject({
      code: "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_CONFLICT",
    });
  });

  it("reuses an already-validating deterministic candidate", async () => {
    const fixture = guardBuilder({ candidate: migrationCandidate() });

    await expect(fixture.builder.build(fixture.input)).resolves.toMatchObject({
      publicationStatus: "validating",
      successorMembersCloned: true,
    });
  });

  it.each([
    ["wrong id", migrationCandidate({ id: candidatePublicationId })],
    ["invalid state", migrationCandidate({ status: "published" })],
  ])("rejects candidate verification with %s", async (_name, candidate) => {
    const fixture = guardBuilder({ candidate });

    await expect(
      fixture.builder.getBuiltCandidate({
        ...fixture.input,
        publicationFingerprint: candidateFingerprint,
        publicationId: deterministicChildId(runId, "profile-migration-publication"),
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_INVALID" });
  });

  it("requires a verified candidate to have completed validation", async () => {
    const fixture = guardBuilder({ candidate: migrationCandidate({ status: "candidate" }) });

    await expect(
      fixture.builder.getBuiltCandidate({
        ...fixture.input,
        publicationFingerprint: candidateFingerprint,
        publicationId: deterministicChildId(runId, "profile-migration-publication"),
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CANDIDATE_NOT_VALIDATING" });
  });

  it("bounds the immutable candidate member snapshot during verification", async () => {
    const fixture = guardBuilder({
      candidate: migrationCandidate(),
      candidateMembers: [
        member("knowledge-path", pathId, baseGenerationId),
        member("graph-entity", ftsId, baseGenerationId),
      ],
      maxMembers: 1,
    });

    await expect(
      fixture.builder.getBuiltCandidate({
        ...fixture.input,
        publicationFingerprint: candidateFingerprint,
        publicationId: deterministicChildId(runId, "profile-migration-publication"),
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CANDIDATE_MEMBER_LIMIT" });
  });

  it("rejects a missing deterministic candidate during verification", async () => {
    const fixture = guardBuilder();
    await expect(
      fixture.builder.getBuiltCandidate({
        ...fixture.input,
        publicationFingerprint: candidateFingerprint,
        publicationId: candidatePublicationId,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_INVALID" });
  });
});

function guardBuilder(
  options: {
    readonly artifactDocumentAssetId?: string | undefined;
    readonly artifactHash?: string | undefined;
    readonly artifactVersion?: number | undefined;
    readonly assetVersion?: number | undefined;
    readonly baseMembers?: readonly ProjectionSetPublicationMember[] | undefined;
    readonly candidate?: ProjectionSetPublication | undefined;
    readonly candidateMembers?: readonly ProjectionSetPublicationMember[] | undefined;
    readonly maxDocuments?: number | undefined;
    readonly maxMembers?: number | undefined;
    readonly missingAsset?: boolean | undefined;
    readonly missingArtifact?: boolean | undefined;
    readonly missingOutline?: boolean | undefined;
    readonly missingPublication?: boolean | undefined;
    readonly outlineDocumentAssetId?: string | undefined;
    readonly outlineGenerationId?: string | undefined;
    readonly outlineKnowledgeSpaceId?: string | undefined;
    readonly publishedFingerprint?: string | undefined;
    readonly publishedHeadRevision?: number | undefined;
    readonly publishedId?: string | undefined;
  } = {},
) {
  const parseArtifactId = deterministicChildId(documentAssetId, "guard-parse-artifact");
  const basePublication: PublishedProjectionSetPublication = {
    createdAt: now,
    fingerprint: options.publishedFingerprint ?? baseFingerprint,
    headRevision: options.publishedHeadRevision ?? 3,
    id: options.publishedId ?? basePublicationId,
    knowledgeSpaceId: spaceId,
    metadata: {},
    projectionVersion: 1,
    status: "published",
    tenantId,
    updatedAt: now,
  };
  const baseOutline = {
    artifactHash: digestA,
    createdAt: now,
    documentAssetId: options.outlineDocumentAssetId ?? documentAssetId,
    id: outlineId,
    knowledgeSpaceId: options.outlineKnowledgeSpaceId ?? spaceId,
    metadata: {},
    nodes: [],
    outlineVersion: "outline-v1",
    parseArtifactId,
    publicationGenerationId: options.outlineGenerationId ?? baseGenerationId,
    version: 1,
  };
  const builder = createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder({
    artifacts: {
      getById: async () =>
        options.missingArtifact
          ? null
          : ({
              artifactHash: options.artifactHash ?? digestA,
              documentAssetId: options.artifactDocumentAssetId ?? documentAssetId,
              id: parseArtifactId,
              version: options.artifactVersion ?? 1,
            } as never),
    },
    assets: {
      get: async () =>
        options.missingAsset
          ? null
          : ({
              id: documentAssetId,
              metadata: {},
              version: options.assetVersion ?? 1,
            } as never),
    },
    maxDocuments: options.maxDocuments ?? 10,
    maxMembers: options.maxMembers ?? 10,
    maxProjectionBatchSize: 10,
    members: {
      listByFingerprint: async ({ fingerprint }) =>
        fingerprint === baseFingerprint
          ? (options.baseMembers ?? [])
          : (options.candidateMembers ?? []),
    },
    now: () => now,
    outlineBuilder: {} as never,
    outlineSummaryEnhancer: {} as never,
    outlines: {
      getById: async () => (options.missingOutline ? null : (baseOutline as never)),
      upsert: async () => {
        throw new Error("unexpected outline upsert");
      },
    },
    pageIndexBuild: {} as never,
    profiles: {} as never,
    projections: { getMany: async () => [] },
    publications: {
      createCandidate: async () => {
        throw new Error("unexpected candidate creation");
      },
      getByFingerprint: async () => options.candidate ?? null,
      getPublished: async () => (options.missingPublication ? null : basePublication),
      validate: async () => {
        throw new Error("unexpected validation");
      },
    },
    reindexer: {} as never,
    snapshots: {} as never,
  });
  return {
    builder,
    input: {
      basePublication: { fingerprint: baseFingerprint, headRevision: 3, id: basePublicationId },
      baseRetrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: digestA },
      candidateProfile: { id: "retrieval-2", revision: 2, snapshotDigest: digestB },
      changedKind: "retrieval" as const,
      knowledgeSpaceId: spaceId,
      rebuildScope: "clone-publication" as const,
      runId,
      tenantId,
    },
  };
}

function migrationCandidate(
  overrides: Partial<ProjectionSetPublication> = {},
): ProjectionSetPublication {
  return {
    createdAt: now,
    fingerprint: candidateFingerprint,
    id: deterministicChildId(runId, "profile-migration-publication"),
    knowledgeSpaceId: spaceId,
    metadata: {},
    projectionVersion: 1,
    status: "validating",
    tenantId,
    updatedAt: now,
    ...overrides,
  };
}

function builderFixture(
  scope: "full-page-index-summary-outline" | "full-vector-space",
  options: {
    readonly completePageIndex?: boolean;
    readonly failValidation?: boolean;
    readonly incompleteReindexReceipt?: boolean;
    readonly staleSnapshotFence?: boolean;
  } = {},
) {
  const parseArtifactId = deterministicChildId(documentAssetId, "parse-artifact");
  const rebuiltOutlineId = deterministicChildId(runId, "rebuilt-outline");
  const baseFtsId = deterministicChildId(documentAssetId, "base-fts");
  const baseDenseId = deterministicChildId(documentAssetId, "base-dense");
  const visualProjectionId = deterministicChildId(documentAssetId, "base-visual");
  const rebuiltFtsId = deterministicChildId(runId, "rebuilt-fts");
  const rebuiltDenseId = deterministicChildId(runId, "rebuilt-dense");
  const expectedGenerationId = deterministicChildId(
    runId,
    `profile-migration:${scope === "full-vector-space" ? "vector-space" : "page-index"}:${documentAssetId}`,
  );
  const oldVectorSpaceId = `embedding-space-sha256:${"d".repeat(64)}`;
  const newVectorSpaceId = `embedding-space-sha256:${"e".repeat(64)}`;
  const basePublication: PublishedProjectionSetPublication = {
    createdAt: now,
    fingerprint: baseFingerprint,
    headRevision: 3,
    id: basePublicationId,
    knowledgeSpaceId: spaceId,
    metadata: {},
    projectionVersion: 1,
    status: "published",
    tenantId,
    updatedAt: now,
  };
  const baseOutline = {
    artifactHash: digestA,
    createdAt: now,
    documentAssetId,
    id: outlineId,
    knowledgeSpaceId: spaceId,
    metadata: {},
    nodes: [],
    outlineVersion: "outline-v1",
    parseArtifactId,
    publicationGenerationId: baseGenerationId,
    version: 1,
  };
  let rebuiltOutline: typeof baseOutline | undefined;
  let candidate: ProjectionSetPublication | undefined;
  let candidateMembers: readonly ProjectionSetPublicationMember[] = [];
  const projections = new Map<string, IndexProjection>();
  const baseProjectionMembers: ProjectionSetPublicationMember[] = [];
  if (scope === "full-vector-space") {
    const baseProjections = [
      projection(baseFtsId, baseGenerationId, "fts"),
      projection(baseDenseId, baseGenerationId, "dense-vector", oldVectorSpaceId),
      {
        ...projection(visualProjectionId, baseGenerationId, "dense-vector", "visual-model"),
        metadata: {
          documentAssetId,
          multimodal: { vectorSpace: "visual" },
        },
      },
    ];
    for (const item of baseProjections) projections.set(item.id, item);
    baseProjectionMembers.push(
      member("index-projection", baseFtsId, baseGenerationId),
      member("index-projection", baseDenseId, baseGenerationId),
      member("index-projection", visualProjectionId, baseGenerationId),
    );
  }
  const baseMembers = [
    member("document-outline", outlineId, baseGenerationId),
    member("knowledge-path", pathId, baseGenerationId),
    ...baseProjectionMembers,
  ];
  const heartbeat = vi.fn(async () => undefined);
  const enhance = vi.fn(async ({ outline }: { readonly outline: typeof baseOutline }) => ({
    ...outline,
    metadata: { summary: { model: "reasoning-v2" } },
  }));
  const materialize = vi.fn(async () => ({ status: "building" }) as never);
  const reindex = vi.fn(
    async ({ publicationGenerationId }: { readonly publicationGenerationId?: string }) => {
      if (options.incompleteReindexReceipt) {
        return {
          artifact: {} as never,
          nodesCreated: 1,
          projectionIds: [rebuiltFtsId],
          projectionsCreated: 2,
          status: "rebuilt" as const,
        };
      }
      if (!publicationGenerationId) throw new Error("generation missing");
      projections.set(rebuiltFtsId, projection(rebuiltFtsId, publicationGenerationId, "fts"));
      projections.set(
        rebuiltDenseId,
        projection(rebuiltDenseId, publicationGenerationId, "dense-vector", newVectorSpaceId),
      );
      return {
        artifact: {} as never,
        nodesCreated: 1,
        projectionIds: [rebuiltFtsId, rebuiltDenseId],
        projectionsCreated: 2,
        status: "rebuilt" as const,
      };
    },
  );
  const replace = vi.fn(
    async (input: ReplaceKnowledgeSpaceProfileMigrationCandidateSnapshotInput) => {
      if (options.staleSnapshotFence) {
        throw Object.assign(new Error("base head changed"), {
          code: "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
        });
      }
      candidateMembers = input.members.map((item) => ({
        ...item,
        createdAt: input.createdAt,
        knowledgeSpaceId: input.knowledgeSpaceId,
        publicationId: input.candidatePublicationId,
        tenantId: input.tenantId,
      }));
      return candidateMembers;
    },
  );
  const validate = vi.fn(async () => {
    if (options.failValidation) throw new Error("validation failed");
    if (!candidate) throw new Error("candidate missing");
    candidate = { ...candidate, status: "validating", updatedAt: now };
    return candidate;
  });
  const publications = {
    createCandidate: async (input: CreateProjectionSetCandidateInput) => {
      candidate = {
        ...(input as unknown as ProjectionSetPublication),
        metadata: (input.metadata as Record<string, unknown>) ?? {},
        status: "candidate",
        updatedAt: String(input.createdAt),
      };
      return candidate;
    },
    getByFingerprint: async ({ fingerprint }: { readonly fingerprint: string }) =>
      candidate?.fingerprint === fingerprint ? candidate : null,
    getPublished: async () => basePublication,
    validate,
  };
  const builder = createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder({
    artifacts: {
      getById: async () =>
        ({
          artifactHash: digestA,
          documentAssetId,
          id: parseArtifactId,
          version: 1,
        }) as never,
    },
    assets: {
      get: async () =>
        ({ id: documentAssetId, metadata: { permissionScope: ["read"] }, version: 1 }) as never,
    },
    maxDocuments: 10,
    maxMembers: 100,
    maxProjectionBatchSize: 10,
    members: {
      listByFingerprint: async ({ fingerprint }) =>
        fingerprint === baseFingerprint ? baseMembers : candidateMembers,
    },
    now: () => now,
    outlineBuilder: {
      build: ({ publicationGenerationId }: { readonly publicationGenerationId?: string }) => {
        rebuiltOutline = {
          ...baseOutline,
          id: rebuiltOutlineId,
          metadata: {},
          publicationGenerationId: publicationGenerationId ?? baseGenerationId,
        };
        return rebuiltOutline as never;
      },
    } as never,
    outlineSummaryEnhancer: { enhance } as never,
    outlines: {
      getById: async ({ id }) => {
        if (id === outlineId) return baseOutline as never;
        if (id === rebuiltOutlineId) return rebuiltOutline as never;
        return null;
      },
      upsert: async (outline) => {
        rebuiltOutline = outline as typeof baseOutline;
        return outline;
      },
    },
    pageIndexBuild: {
      hasCompleteBuild: async () => options.completePageIndex !== false,
      materializeBuilding: materialize,
    },
    profiles: {
      getRevision: async ({ kind }) =>
        kind === "embedding"
          ? ({
              id: "embedding-2",
              revision: 2,
              snapshot: {
                dimension: 3072,
                model: "embedding-v2",
                pluginId: "plugin-embedding",
                provider: "plugin-daemon",
                revision: 2,
                vectorSpaceId: newVectorSpaceId,
              },
              snapshotDigest: digestB,
              state: "candidate",
            } as never)
          : ({
              id: "retrieval-2",
              revision: 2,
              snapshot: {
                defaultMode: "research",
                reasoningModel: {
                  model: "reasoning-v2",
                  pluginId: "plugin-reasoning",
                  provider: "plugin-daemon",
                },
                rerank: { enabled: false },
                revision: 2,
                scoreThreshold: { enabled: false, stage: "mode-final" },
                topK: 12,
              },
              snapshotDigest: digestB,
              state: "candidate",
            } as never),
    },
    projections: {
      getMany: async ({ ids }) => ids.flatMap((id) => projections.get(id) ?? []),
    },
    publications,
    reindexer: { reindex } as never,
    snapshots: { replace },
  });
  const input = {
    ...(scope === "full-vector-space"
      ? {
          baseEmbeddingProfile: {
            id: "embedding-1",
            revision: 1,
            snapshotDigest: digestA,
          },
        }
      : {}),
    basePublication: {
      fingerprint: baseFingerprint,
      headRevision: 3,
      id: basePublicationId,
    },
    baseRetrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: digestA },
    candidateProfile: {
      id: scope === "full-vector-space" ? "embedding-2" : "retrieval-2",
      revision: 2,
      snapshotDigest: digestB,
    },
    changedKind: scope === "full-vector-space" ? ("embedding" as const) : ("retrieval" as const),
    execution: { heartbeat },
    knowledgeSpaceId: spaceId,
    rebuildScope: scope,
    runId,
    tenantId,
  };
  return {
    baseDenseId,
    builder,
    candidateMembers: () => candidateMembers,
    candidateStatus: () => candidate?.status,
    enhance,
    expectedGenerationId,
    heartbeat,
    input,
    materialize,
    published: () => basePublication,
    rebuiltDenseId,
    rebuiltFtsId,
    rebuiltOutlineId,
    reindex,
    replace,
    validate,
    visualProjectionId,
  };
}

describe("profile migration structural evaluator", () => {
  it("accepts a Research-only Top-K/settings clone without inventing FTS or dense legs", async () => {
    const baseMembers = [member("document-outline", outlineId, baseGenerationId)];
    const result = await evaluator({ baseMembers, candidateMembers: baseMembers }).evaluate({
      candidate: candidateResult(),
      run: migrationRun("clone-publication", "retrieval"),
    });
    expect(result).toMatchObject({ passed: true });
  });

  it("accepts a Research-only reasoning Summary/Outline/PageIndex rebuild without Graph or FTS", async () => {
    const rebuiltGenerationId = deterministicChildId(
      runId,
      `profile-migration:page-index:${documentAssetId}`,
    );
    const result = await evaluator({
      baseMembers: [member("document-outline", outlineId, baseGenerationId)],
      candidateMembers: [member("document-outline", outlineId, rebuiltGenerationId)],
      outlineGenerationId: rebuiltGenerationId,
      summaryModel: "reasoning-v2",
    }).evaluate({
      candidate: candidateResult(),
      run: migrationRun("full-page-index-summary-outline", "retrieval"),
    });
    expect(result).toMatchObject({ passed: true });
  });

  it("accepts the first embedding rebuild from an outline-only Research publication", async () => {
    const generationId = deterministicChildId(
      runId,
      `profile-migration:vector-space:${documentAssetId}`,
    );
    const candidateMembers = [
      member("document-outline", outlineId, baseGenerationId),
      member("index-projection", ftsId, generationId),
      member("index-projection", denseId, generationId),
    ];
    const result = await evaluator({
      baseMembers: [member("document-outline", outlineId, baseGenerationId)],
      candidateMembers,
      projections: [
        projection(ftsId, generationId, "fts"),
        projection(denseId, generationId, "dense-vector", vectorSpaceId),
      ],
    }).evaluate({
      candidate: candidateResult(),
      run: migrationRun("full-vector-space", "embedding"),
    });
    expect(result).toMatchObject({ passed: true });
  });

  it("fails closed when a reasoning candidate drops a non-outline Graph/path member", async () => {
    const rebuiltGenerationId = deterministicChildId(
      runId,
      `profile-migration:page-index:${documentAssetId}`,
    );
    const result = await evaluator({
      baseMembers: [
        member("document-outline", outlineId, baseGenerationId),
        member("knowledge-path", pathId, baseGenerationId),
      ],
      candidateMembers: [member("document-outline", outlineId, rebuiltGenerationId)],
      outlineGenerationId: rebuiltGenerationId,
      summaryModel: "reasoning-v2",
    }).evaluate({
      candidate: candidateResult(),
      run: migrationRun("full-page-index-summary-outline", "retrieval"),
    });
    expect(result).toMatchObject({ passed: false });
  });
});

function evaluator(input: {
  readonly baseMembers: readonly ProjectionSetPublicationMember[];
  readonly candidateMembers: readonly ProjectionSetPublicationMember[];
  readonly outlineGenerationId?: string;
  readonly projections?: readonly IndexProjection[];
  readonly summaryModel?: string;
}) {
  const projectionById = new Map((input.projections ?? []).map((item) => [item.id, item]));
  return createRepositoryKnowledgeSpaceProfileMigrationEvaluator({
    maxProjectionBatchSize: 10,
    members: {
      listByFingerprint: async ({ fingerprint }) =>
        fingerprint === baseFingerprint ? input.baseMembers : input.candidateMembers,
    },
    outlines: {
      getById: async () =>
        ({
          documentAssetId,
          id: outlineId,
          metadata: input.summaryModel ? { summary: { model: input.summaryModel } } : {},
          publicationGenerationId: input.outlineGenerationId ?? baseGenerationId,
        }) as never,
    },
    pageIndexBuild: { hasCompleteBuild: async () => true },
    profiles: {
      getRevision: async ({ kind }) =>
        kind === "embedding"
          ? ({
              id: "embedding-2",
              revision: 1,
              snapshot: {
                dimension: 3072,
                model: "embedding-v2",
                pluginId: "plugin-embedding",
                provider: "plugin-daemon",
                revision: 1,
                vectorSpaceId,
              },
              snapshotDigest: digestB,
              state: "candidate",
            } as never)
          : ({
              id: "retrieval-2",
              revision: 2,
              snapshot: {
                defaultMode: "research",
                reasoningModel: {
                  model: "reasoning-v2",
                  pluginId: "plugin-reasoning",
                  provider: "plugin-daemon",
                },
                rerank: { enabled: false },
                revision: 2,
                scoreThreshold: { enabled: false, stage: "mode-final" },
                topK: 12,
              },
              snapshotDigest: digestB,
              state: "candidate",
            } as never),
    },
    projections: {
      getMany: async ({ ids }) => ids.flatMap((id) => projectionById.get(id) ?? []),
    },
  });
}

function migrationRun(
  rebuildScope: KnowledgeSpaceProfileMigrationRun["rebuildScope"],
  changedKind: KnowledgeSpaceProfileMigrationRun["changedKind"],
): KnowledgeSpaceProfileMigrationRun {
  return {
    accessChannel: "interactive",
    basePublication: { fingerprint: baseFingerprint, headRevision: 3, id: basePublicationId },
    baseRetrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: digestA },
    candidateProfile: {
      id: changedKind === "embedding" ? "embedding-2" : "retrieval-2",
      revision: changedKind === "embedding" ? 1 : 2,
      snapshotDigest: digestB,
    },
    candidatePublicationFingerprint: candidateResult().publicationFingerprint,
    candidatePublicationId: candidateResult().publicationId,
    changedKind,
    checkpoint: "candidate-built",
    createdAt: now,
    executionAttempts: 1,
    id: runId,
    idempotencyKey: "settings-profile",
    knowledgeSpaceId: spaceId,
    maxExecutionAttempts: 3,
    permissionSnapshotId: "permission-1",
    permissionSnapshotRevision: 1,
    rebuildScope,
    requestedBySubjectId: "owner-1",
    rowVersion: 2,
    runState: "running",
    tenantId,
    updatedAt: now,
  };
}

function candidateResult() {
  return {
    publicationFingerprint: `projection-set-sha256:${"b".repeat(64)}`,
    publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5a0a",
    publicationStatus: "validating" as const,
  };
}

function member(
  componentType: ProjectionSetPublicationMember["componentType"],
  componentKey: string,
  generationId: string,
): ProjectionSetPublicationMember {
  return {
    componentKey,
    componentType,
    createdAt: now,
    documentAssetId,
    generationId,
    knowledgeSpaceId: spaceId,
    publicationId: basePublicationId,
    tenantId,
  };
}

function projection(
  id: string,
  publicationGenerationId: string,
  type: IndexProjection["type"],
  model?: string,
): IndexProjection {
  return {
    id,
    knowledgeSpaceId: spaceId,
    metadata: { documentAssetId },
    ...(model ? { model } : {}),
    nodeId: deterministicChildId(id, "node"),
    projectionVersion: 1,
    publicationGenerationId,
    status: "ready",
    type,
  };
}
