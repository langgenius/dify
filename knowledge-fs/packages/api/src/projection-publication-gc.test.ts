import { KnowledgeFsSessionSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryKnowledgeFsSessionRepository } from "./knowledge-fs-session-repository";
import { createProjectionPublicationGc } from "./projection-publication-gc";
import { createInMemoryProjectionSetPublicationRepository } from "./projection-publication-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const supersededFingerprint =
  "projection-set-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const publishedFingerprint =
  "projection-set-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const inactiveFingerprint =
  "projection-set-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const stableSetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const currentSetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const inactiveSetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

describe("createProjectionPublicationGc", () => {
  it("previews and deletes retained projection publications while skipping active sessions", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const sessions = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 10,
      maxSessions: 10,
    });
    await publish(publications, supersededFingerprint, stableSetId, 1);
    await publish(publications, publishedFingerprint, currentSetId, 2);
    await publications.createCandidate({
      createdAt: "2026-05-27T11:00:00.000Z",
      fingerprint: inactiveFingerprint,
      id: inactiveSetId,
      knowledgeSpaceId,
      projectionVersion: 3,
      tenantId,
    });
    await publications.deactivate({
      fingerprint: inactiveFingerprint,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T11:10:00.000Z",
    });
    await sessions.create(
      KnowledgeFsSessionSchema.parse({
        clientKind: "api",
        clientVersion: "1.0.0",
        consistencyClass: "snapshot-consistent",
        createdAt: "2026-05-27T12:00:00.000Z",
        expiresAt: "2026-05-27T13:00:00.000Z",
        heartbeatAt: "2026-05-27T12:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
        knowledgeSpaceId,
        metadata: { projectionSetFingerprint: supersededFingerprint },
        permissionSnapshot: [],
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "subject-1",
          tenantId,
        },
        tenantId,
        updatedAt: "2026-05-27T12:00:00.000Z",
      }),
    );
    const gc = createProjectionPublicationGc({
      maxActiveSessions: 10,
      publications,
      sessions,
    });

    const preview = await gc.preview({
      knowledgeSpaceId,
      limit: 10,
      now: "2026-05-27T12:30:00.000Z",
      olderThan: "2026-05-27T12:00:00.000Z",
      tenantId,
    });

    expect(preview).toEqual({
      candidates: [
        {
          fingerprint: inactiveFingerprint,
          projectionVersion: 3,
          reason: "inactive-retention",
          status: "inactive",
        },
      ],
      skippedActiveSessionFingerprints: [supersededFingerprint],
    });

    await expect(
      gc.execute({
        knowledgeSpaceId,
        limit: 10,
        now: "2026-05-27T12:30:00.000Z",
        olderThan: "2026-05-27T12:00:00.000Z",
        tenantId,
      }),
    ).resolves.toMatchObject({ deleted: 1 });
    await expect(
      publications.getByFingerprint({
        fingerprint: inactiveFingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBeNull();
    await expect(publications.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: publishedFingerprint,
    });
  });
});

async function publish(
  publications: ReturnType<typeof createInMemoryProjectionSetPublicationRepository>,
  fingerprint: string,
  id: string,
  projectionVersion: number,
) {
  await publications.createCandidate({
    createdAt: "2026-05-27T11:00:00.000Z",
    fingerprint,
    id,
    knowledgeSpaceId,
    projectionVersion,
    tenantId,
  });
  await publications.validate({
    fingerprint,
    knowledgeSpaceId,
    tenantId,
    updatedAt: "2026-05-27T11:01:00.000Z",
  });
  const current = await publications.getPublished({ knowledgeSpaceId, tenantId });
  await publications.publish({
    expectedHeadRevision: current?.headRevision ?? 0,
    fingerprint,
    knowledgeSpaceId,
    tenantId,
    updatedAt: "2026-05-27T11:02:00.000Z",
  });
}
