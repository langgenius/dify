import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseAdapter } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type DocumentCompilationPublicationMemberSnapshot,
  ProjectionSetPublicationAttemptFenceConflictError,
  ProjectionSetPublicationCandidateSnapshotConflictError,
  ProjectionSetPublicationHeadConflictError,
  ProjectionSetPublicationTransitionError,
  createDatabaseProjectionSetPublicationRepository,
  createInMemoryProjectionSetPublicationRepository,
} from "./projection-publication-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const otherKnowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const fingerprintA = `projection-set-sha256:${"a".repeat(64)}`;
const fingerprintB = `projection-set-sha256:${"b".repeat(64)}`;
const fingerprintC = `projection-set-sha256:${"c".repeat(64)}`;
const setIdA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const setIdB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const setIdC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49";
const componentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4a";

describe("projection publication memory boundary branches", () => {
  it.each([Number.NaN, 1.5])(
    "rejects a non-integer publication capacity: %s",
    (maxPublications) => {
      expect(() => createInMemoryProjectionSetPublicationRepository({ maxPublications })).toThrow(
        "Projection set publication repository maxPublications must be at least 1",
      );
    },
  );

  it.each([0, Number.NaN, 1.5])("rejects an invalid database list bound: %s", (maxListLimit) => {
    expect(() =>
      createDatabaseProjectionSetPublicationRepository({
        database: {} as DatabaseAdapter,
        maxListLimit,
      }),
    ).toThrow("Projection set publication repository maxListLimit must be at least 1");
  });

  it("defaults metadata, trims tenant ids, and clones nested metadata", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 2 });
    const nested = { policy: { version: 1 } };

    await expect(
      repository.createCandidate(candidate({ metadata: undefined, tenantId: `  ${tenantId}  ` })),
    ).resolves.toMatchObject({ metadata: {}, tenantId });
    const created = await repository.createCandidate(
      candidate({ fingerprint: fingerprintB, id: setIdB, metadata: nested }),
    );
    nested.policy.version = 2;

    expect(created.metadata).toEqual({ policy: { version: 1 } });
  });

  it.each([
    [0, "metadata must be an object"],
    ["metadata", "metadata must be an object"],
  ] as const)("rejects non-object metadata %#", async (metadata, message) => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });

    await expect(
      repository.createCandidate(
        candidate({ metadata: metadata as unknown as Record<string, unknown> }),
      ),
    ).rejects.toThrow(message);
  });

  it.each([
    ["tenantId", "   ", "tenantId is required"],
    ["projectionVersion", 1.5, "projectionVersion must be between"],
    ["projectionVersion", Number.NaN, "projectionVersion must be between"],
  ] as const)("rejects invalid candidate field %s=%s", async (field, value, message) => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });

    await expect(repository.createCandidate(candidate({ [field]: value }))).rejects.toThrow(
      message,
    );
  });

  it("filters GC candidates by tenant, space, age, status, and cursor", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 8 });
    const otherTenant = "tenant-2";
    const inputs = [
      candidate(),
      candidate({ fingerprint: fingerprintB, id: setIdB }),
      candidate({
        fingerprint: fingerprintC,
        id: setIdC,
        knowledgeSpaceId: otherKnowledgeSpaceId,
      }),
      candidate({
        fingerprint: `projection-set-sha256:${"d".repeat(64)}`,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4b",
        tenantId: otherTenant,
      }),
    ];
    for (const input of inputs) await repository.createCandidate(input);
    await repository.deactivate(transition(fingerprintA, "2026-05-27T12:01:00.000Z"));
    await repository.deactivate(transition(fingerprintB, "2026-06-02T12:01:00.000Z"));
    await repository.deactivate({
      ...transition(fingerprintC, "2026-05-27T12:01:00.000Z"),
      knowledgeSpaceId: otherKnowledgeSpaceId,
    });
    await repository.deactivate({
      ...transition(`projection-set-sha256:${"d".repeat(64)}`, "2026-05-27T12:01:00.000Z"),
      tenantId: otherTenant,
    });

    await expect(
      repository.listGcCandidates({
        cursor: fingerprintA,
        knowledgeSpaceId,
        limit: 2,
        olderThan: "2026-06-01T00:00:00.000Z",
        tenantId,
      }),
    ).resolves.toEqual({ items: [] });
  });

  it.each([Number.NaN, 1.5])("rejects a non-integer GC limit: %s", async (limit) => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });

    await expect(
      repository.listGcCandidates({
        knowledgeSpaceId,
        limit,
        olderThan: "2026-06-01T00:00:00.000Z",
        tenantId,
      }),
    ).rejects.toThrow("GC candidate limit must be at least 1");
  });

  it("publishes a valid document compilation candidate without an asset-scoped member", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence(),
        expectedMembers: [member()],
      }),
    ).resolves.toMatchObject({
      headRevision: 1,
      published: { fingerprint: fingerprintA, status: "published" },
    });
  });

  it("accepts an asset-scoped member and sorts a multi-member snapshot", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence(),
        expectedMembers: [
          member({ componentType: "knowledge-path" }),
          member({
            componentKey: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4c",
            componentType: "document-outline",
            documentAssetId,
          }),
        ],
      }),
    ).resolves.toMatchObject({ headRevision: 1 });
  });

  it("fails closed when logical-document atomicity is requested", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence(),
        expectedMembers: [member()],
        logicalDocumentFence: {
          documentId: documentAssetId,
          expectedActiveRevision: null,
          expectedDocumentRowVersion: 0,
          revision: 1,
        },
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
  });

  it.each([
    [[], ProjectionSetPublicationCandidateSnapshotConflictError],
    [
      [member({ componentType: "unsupported" as "knowledge-path" })],
      ProjectionSetPublicationCandidateSnapshotConflictError,
    ],
    [[member(), member()], ProjectionSetPublicationCandidateSnapshotConflictError],
  ] as const)("rejects an invalid document member snapshot %#", async (expectedMembers, error) => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence(),
        expectedMembers,
      }),
    ).rejects.toBeInstanceOf(error);
  });

  it("rejects a non-array document member snapshot", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence(),
        expectedMembers: null as unknown as readonly DocumentCompilationPublicationMemberSnapshot[],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationCandidateSnapshotConflictError);
  });

  it("rejects a document candidate whose attempt owns a different publication", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence({ candidatePublicationId: setIdB }),
        expectedMembers: [member()],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationAttemptFenceConflictError);
  });

  it("rejects a stale document-candidate head without changing the candidate", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 2 });
    await repository.createCandidate(candidate());
    await repository.publish({ ...transition(fingerprintA), expectedHeadRevision: 0 });
    await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput({ expectedHeadRevision: 0, fingerprint: fingerprintB }),
        attemptFence: fence({ candidatePublicationId: setIdB }),
        expectedMembers: [member()],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);
    await expect(
      repository.getByFingerprint({ fingerprint: fingerprintB, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ status: "candidate" });
  });

  it("rejects document publication from a non-candidate status", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());
    await repository.validate(transition(fingerprintA));

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence(),
        expectedMembers: [member()],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
  });

  it.each([
    ["documentVersion", 0, "documentVersion must be between"],
    ["documentVersion", 1.5, "documentVersion must be between"],
    ["expectedRowVersion", -1, "headRevision must be between"],
    ["expectedRowVersion", 1.5, "headRevision must be between"],
    ["expectedRowVersion", 2_147_483_648, "headRevision must be between"],
  ] as const)("rejects invalid attempt fence field %s=%s", async (field, value, message) => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(
      repository.publishDocumentCompilationCandidate({
        ...publishInput(),
        attemptFence: fence({ [field]: value }),
        expectedMembers: [member()],
      }),
    ).rejects.toThrow(message);
  });

  it.each([
    [-1, "headRevision must be between"],
    [1.5, "headRevision must be between"],
    [2_147_483_647, "expectedHeadRevision must be below"],
  ] as const)(
    "rejects invalid expected head revision %s",
    async (expectedHeadRevision, message) => {
      const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
      await repository.createCandidate(candidate());

      await expect(
        repository.publish({ ...transition(fingerprintA), expectedHeadRevision }),
      ).rejects.toThrow(message);
    },
  );

  it("fails closed when a database head points at a non-published row", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [{ ...publicationRow("candidate"), head_revision: 1 }],
        rowsAffected: 1,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseProjectionSetPublicationRepository({
      database,
      maxListLimit: 1,
    });

    await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).rejects.toThrow(
      "head points to non-published status=candidate",
    );
  });

  it("rejects an unsupported publication status returned by the database", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [{ ...publicationRow("unknown"), head_revision: 1 }],
        rowsAffected: 1,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseProjectionSetPublicationRepository({
      database,
      maxListLimit: 1,
    });

    await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).rejects.toThrow(
      "Unsupported projection set publication status=unknown",
    );
  });
});

function candidate(
  overrides: Partial<
    Parameters<
      ReturnType<typeof createInMemoryProjectionSetPublicationRepository>["createCandidate"]
    >[0]
  > = {},
) {
  return {
    createdAt: "2026-05-27T12:00:00.000Z",
    fingerprint: fingerprintA,
    id: setIdA,
    knowledgeSpaceId,
    metadata: { parserPolicyVersion: "parser-v1" },
    projectionVersion: 1,
    tenantId,
    ...overrides,
  };
}

function transition(fingerprint: string, updatedAt = "2026-05-27T12:01:00.000Z") {
  return { fingerprint, knowledgeSpaceId, tenantId, updatedAt };
}

function publishInput(overrides: { expectedHeadRevision?: number; fingerprint?: string } = {}) {
  return {
    ...transition(overrides.fingerprint ?? fingerprintA),
    expectedHeadRevision: overrides.expectedHeadRevision ?? 0,
  };
}

function fence(
  overrides: Partial<
    Parameters<
      ReturnType<
        typeof createInMemoryProjectionSetPublicationRepository
      >["publishDocumentCompilationCandidate"]
    >[0]["attemptFence"]
  > = {},
) {
  return {
    attemptId,
    candidatePublicationId: setIdA,
    documentAssetId,
    documentVersion: 1,
    expectedRowVersion: 0,
    leaseToken,
    publicationGenerationId: generationId,
    ...overrides,
  };
}

function member(
  overrides: Partial<DocumentCompilationPublicationMemberSnapshot> = {},
): DocumentCompilationPublicationMemberSnapshot {
  return {
    componentKey: componentId,
    componentType: "index-projection",
    generationId,
    ...overrides,
  };
}

function publicationRow(status: string) {
  return {
    created_at: "2026-05-27T12:00:00.000Z",
    fingerprint: fingerprintA,
    id: setIdA,
    knowledge_space_id: knowledgeSpaceId,
    metadata: JSON.stringify({ parserPolicyVersion: "parser-v1" }),
    projection_version: 1,
    status,
    superseded_by_fingerprint: null,
    tenant_id: tenantId,
    updated_at: "2026-05-27T12:00:00.000Z",
  };
}
