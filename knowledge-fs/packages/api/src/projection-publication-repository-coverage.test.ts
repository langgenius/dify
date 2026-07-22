import { describe, expect, it } from "vitest";

import {
  DuplicateProjectionSetPublicationError,
  ProjectionSetPublicationCapacityExceededError,
  ProjectionSetPublicationNotFoundError,
  ProjectionSetPublicationTransitionError,
  createInMemoryProjectionSetPublicationRepository,
} from "./projection-publication-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const fingerprintA = `projection-set-sha256:${"a".repeat(64)}`;
const fingerprintB = `projection-set-sha256:${"b".repeat(64)}`;
const fingerprintC = `projection-set-sha256:${"c".repeat(64)}`;
const setIdA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const setIdB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const setIdC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

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

describe("projection set publication repository coverage", () => {
  it("rejects non-positive capacity bounds", () => {
    expect(() => createInMemoryProjectionSetPublicationRepository({ maxPublications: 0 })).toThrow(
      "Projection set publication repository maxPublications must be at least 1",
    );
  });

  it("rejects duplicate candidates and enforces capacity", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 1 });
    await repository.createCandidate(candidate());

    await expect(repository.createCandidate(candidate())).rejects.toBeInstanceOf(
      DuplicateProjectionSetPublicationError,
    );
    await expect(
      repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB })),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationCapacityExceededError);
  });

  it("validates candidate inputs before storing", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 5 });

    await expect(repository.createCandidate(candidate({ createdAt: "  " }))).rejects.toThrow(
      "Projection set publication createdAt must be an ISO date-time",
    );
    await expect(repository.createCandidate(candidate({ projectionVersion: 0 }))).rejects.toThrow(
      "Projection set publication projectionVersion must be between 1 and 2147483647",
    );
    await expect(
      repository.createCandidate(candidate({ projectionVersion: 2_147_483_648 })),
    ).rejects.toThrow(
      "Projection set publication projectionVersion must be between 1 and 2147483647",
    );
    await expect(repository.createCandidate(candidate({ id: "not-a-uuid" }))).rejects.toThrow();
    await expect(
      repository.createCandidate(candidate({ tenantId: "x".repeat(256) })),
    ).rejects.toThrow("Projection set publication tenantId must be at most 255 characters");
    await expect(
      repository.createCandidate(candidate({ createdAt: "0000-01-01T00:00:00.000Z" })),
    ).rejects.toThrow("Projection set publication createdAt year must be between 1000 and 9999");
    await expect(
      repository.createCandidate(candidate({ metadata: [] as unknown as Record<string, unknown> })),
    ).rejects.toThrow("Projection set publication metadata must be an object");
  });

  it("canonicalizes timestamps and rejects a head revision that cannot advance", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 2 });
    await expect(
      repository.createCandidate(candidate({ createdAt: "2026-05-27T12:00:00Z" })),
    ).resolves.toMatchObject({
      createdAt: "2026-05-27T12:00:00.000Z",
      updatedAt: "2026-05-27T12:00:00.000Z",
    });
    await expect(
      repository.publish({
        expectedHeadRevision: 2_147_483_647,
        fingerprint: fingerprintA,
        knowledgeSpaceId,
        tenantId,
        updatedAt: "2026-05-27T12:01:00.000Z",
      }),
    ).rejects.toThrow("Projection set publication expectedHeadRevision must be below 2147483647");
  });

  it("refuses to deactivate, delete, or republish published sets", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 5 });
    await repository.createCandidate(candidate());
    await repository.validate({
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:01:00.000Z",
    });
    await repository.publish({
      expectedHeadRevision: 0,
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:02:00.000Z",
    });

    await expect(
      repository.deactivate({
        fingerprint: fingerprintA,
        knowledgeSpaceId,
        tenantId,
        updatedAt: "2026-05-27T12:03:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
    await expect(
      repository.delete({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
  });

  it("rejects publishing from inactive states and unknown fingerprints", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 5 });
    await repository.createCandidate(candidate());
    await repository.deactivate({
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:01:00.000Z",
    });

    await expect(
      repository.publish({
        expectedHeadRevision: 0,
        fingerprint: fingerprintA,
        knowledgeSpaceId,
        tenantId,
        updatedAt: "2026-05-27T12:02:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
    await expect(
      repository.validate({
        fingerprint: fingerprintB,
        knowledgeSpaceId,
        tenantId,
        updatedAt: "2026-05-27T12:03:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationNotFoundError);
  });

  it("returns nulls for missing lookups and deletes inactive sets", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 5 });

    await expect(
      repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();
    await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toBeNull();
    await expect(
      repository.delete({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();

    await repository.createCandidate(candidate());
    await expect(
      repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ fingerprint: fingerprintA, status: "candidate" });
    await repository.deactivate({
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:01:00.000Z",
    });
    await expect(
      repository.delete({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ fingerprint: fingerprintA, status: "inactive" });
    await expect(
      repository.getByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();
  });

  it("pages GC candidates with cursors and bounds the list limit", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 5 });

    await expect(
      repository.listGcCandidates({
        knowledgeSpaceId,
        limit: 0,
        olderThan: "2026-06-01T00:00:00.000Z",
        tenantId,
      }),
    ).rejects.toThrow("Projection set publication GC candidate limit must be at least 1");
    await expect(
      repository.listGcCandidates({
        cursor: "",
        knowledgeSpaceId,
        limit: 1,
        olderThan: "2026-06-01T00:00:00.000Z",
        tenantId,
      }),
    ).rejects.toThrow();

    for (const [fingerprint, id] of [
      [fingerprintA, setIdA],
      [fingerprintB, setIdB],
      [fingerprintC, setIdC],
    ] as const) {
      await repository.createCandidate(candidate({ fingerprint, id }));
      await repository.deactivate({
        fingerprint,
        knowledgeSpaceId,
        tenantId,
        updatedAt: "2026-05-27T12:05:00.000Z",
      });
    }

    const firstPage = await repository.listGcCandidates({
      knowledgeSpaceId,
      limit: 2,
      olderThan: "2026-06-01T00:00:00.000Z",
      tenantId,
    });
    expect(firstPage.items.map((item) => item.fingerprint)).toEqual([fingerprintA, fingerprintB]);
    expect(firstPage.nextCursor).toBe(fingerprintB);

    const secondPage = await repository.listGcCandidates({
      cursor: firstPage.nextCursor,
      knowledgeSpaceId,
      limit: 2,
      olderThan: "2026-06-01T00:00:00.000Z",
      tenantId,
    });
    expect(secondPage.items.map((item) => item.fingerprint)).toEqual([fingerprintC]);
    expect(secondPage.nextCursor).toBeUndefined();

    const fresh = await repository.listGcCandidates({
      knowledgeSpaceId,
      limit: 2,
      olderThan: "2026-05-27T12:05:00.000Z",
      tenantId,
    });
    expect(fresh.items).toEqual([]);
  });
});
