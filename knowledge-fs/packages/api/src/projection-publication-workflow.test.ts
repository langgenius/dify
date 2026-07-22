import { describe, expect, it } from "vitest";

import { createInMemoryProjectionSetPublicationRepository } from "./projection-publication-repository";
import { createProjectionPublicationWorkflow } from "./projection-publication-workflow";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const stableFingerprint =
  "projection-set-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const badUpgradeFingerprint =
  "projection-set-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const stableSetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const badUpgradeSetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("createProjectionPublicationWorkflow", () => {
  it("rolls back to the prior published fingerprint without rebuilding projections", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    await publish(publications, stableFingerprint, stableSetId, 7);
    await publish(publications, badUpgradeFingerprint, badUpgradeSetId, 8);
    const workflow = createProjectionPublicationWorkflow({ publications });

    const rollback = await workflow.rollback({
      fingerprint: stableFingerprint,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-05-27T13:00:00.000Z",
    });

    expect(rollback).toMatchObject({
      previousPublishedFingerprint: badUpgradeFingerprint,
      restored: {
        fingerprint: stableFingerprint,
        projectionVersion: 7,
        status: "published",
      },
      superseded: {
        fingerprint: badUpgradeFingerprint,
        projectionVersion: 8,
        status: "superseded",
        supersededByFingerprint: stableFingerprint,
      },
    });
    await expect(publications.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: stableFingerprint,
      projectionVersion: 7,
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
    createdAt: "2026-05-27T12:00:00.000Z",
    fingerprint,
    id,
    knowledgeSpaceId,
    metadata: {},
    projectionVersion,
    tenantId,
  });
  await publications.validate({
    fingerprint,
    knowledgeSpaceId,
    tenantId,
    updatedAt: "2026-05-27T12:01:00.000Z",
  });

  const current = await publications.getPublished({ knowledgeSpaceId, tenantId });

  return publications.publish({
    expectedHeadRevision: current?.headRevision ?? 0,
    fingerprint,
    knowledgeSpaceId,
    tenantId,
    updatedAt: "2026-05-27T12:02:00.000Z",
  });
}
