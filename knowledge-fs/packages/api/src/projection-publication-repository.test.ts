import { describe, expect, it } from "vitest";

import {
  ProjectionSetPublicationHeadConflictError,
  ProjectionSetPublicationTransitionError,
  createInMemoryProjectionSetPublicationRepository,
} from "./projection-publication-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const fingerprintA =
  "projection-set-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fingerprintB =
  "projection-set-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const fingerprintC =
  "projection-set-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const setIdA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const setIdB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const setIdC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

describe("ProjectionSet publication repositories", () => {
  it("publishes validated candidates, supersedes the prior set, and supports rollback", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    await repository.createCandidate(candidate({ fingerprint: fingerprintA, id: setIdA }));
    await repository.validate({
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:01:00.000Z",
    });
    const firstPublish = await repository.publish({
      expectedHeadRevision: 0,
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:02:00.000Z",
    });

    expect(firstPublish.published).toMatchObject({
      fingerprint: fingerprintA,
      status: "published",
    });
    await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: fingerprintA,
    });

    await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
    await repository.validate({
      fingerprint: fingerprintB,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:03:00.000Z",
    });
    const secondPublish = await repository.publish({
      expectedHeadRevision: 1,
      fingerprint: fingerprintB,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:04:00.000Z",
    });

    expect(secondPublish).toMatchObject({
      published: { fingerprint: fingerprintB, status: "published" },
      superseded: {
        fingerprint: fingerprintA,
        status: "superseded",
        supersededByFingerprint: fingerprintB,
      },
    });

    const rollback = await repository.rollback({
      expectedHeadRevision: 2,
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:05:00.000Z",
    });

    expect(rollback).toMatchObject({
      published: { fingerprint: fingerprintA, status: "published" },
      superseded: {
        fingerprint: fingerprintB,
        status: "superseded",
        supersededByFingerprint: fingerprintA,
      },
    });
  });

  it("deactivates candidates and rejects invalid publication transitions", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 2 });
    await repository.createCandidate(candidate({ fingerprint: fingerprintC, id: setIdC }));
    await expect(
      repository.deactivate({
        fingerprint: fingerprintC,
        knowledgeSpaceId,
        tenantId,
        updatedAt: "2026-05-27T12:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      fingerprint: fingerprintC,
      status: "inactive",
    });
    await expect(
      repository.validate({
        fingerprint: fingerprintC,
        knowledgeSpaceId,
        tenantId,
        updatedAt: "2026-05-27T12:02:00.000Z",
      }),
    ).rejects.toThrow(ProjectionSetPublicationTransitionError);
    await expect(
      repository.createCandidate(candidate({ fingerprint: "bad", id: setIdC })),
    ).rejects.toThrow();
  });

  it("rejects a stale head revision without mutating either candidate", async () => {
    const repository = createInMemoryProjectionSetPublicationRepository({ maxPublications: 3 });
    await repository.createCandidate(candidate({ fingerprint: fingerprintA, id: setIdA }));
    await repository.createCandidate(candidate({ fingerprint: fingerprintB, id: setIdB }));
    await repository.publish({
      expectedHeadRevision: 0,
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:01:00.000Z",
    });

    const stalePublish = repository.publish({
      expectedHeadRevision: 0,
      fingerprint: fingerprintB,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T12:02:00.000Z",
    });

    await expect(stalePublish).rejects.toMatchObject({
      actualHeadRevision: 1,
      expectedHeadRevision: 0,
    });
    await expect(stalePublish).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);
    await expect(repository.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: fingerprintA,
      headRevision: 1,
    });
    await expect(
      repository.getByFingerprint({ fingerprint: fingerprintB, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ status: "candidate" });
  });
});

function candidate({
  fingerprint,
  id,
}: {
  readonly fingerprint: string;
  readonly id: string;
}) {
  return {
    createdAt: "2026-05-27T12:00:00.000Z",
    fingerprint,
    id,
    knowledgeSpaceId,
    metadata: { parserPolicyVersion: "parser-v1" },
    projectionVersion: 1,
    tenantId,
  };
}
