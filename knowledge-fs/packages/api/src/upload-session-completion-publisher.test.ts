import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryCapabilityGrantProvenanceRepository,
  createInMemoryDocumentAssetRepository,
  createInMemoryKnowledgePathRepository,
  createInMemoryLogicalDocumentRepository,
} from "./index";
import { createUploadSessionDocumentCompletionPublisher } from "./upload-session-completion-publisher";

const TENANT_ID = "tenant-1";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";
const SESSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const ATTEMPT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04";
const CHECKSUM = Buffer.alloc(32, 1).toString("base64");

describe("upload session document completion publisher", () => {
  it("materializes one deterministic asset/revision and releases durable compilation", async () => {
    const fixture = await publisherFixture();

    const published = await fixture.publisher.publish(publishInput());

    expect(published).toEqual({
      compilationJobId: ATTEMPT_ID,
      documentAssetId: SESSION_ID,
    });
    await expect(
      fixture.assets.get({ id: SESSION_ID, knowledgeSpaceId: SPACE_ID }),
    ).resolves.toMatchObject({
      filename: "report.pdf",
      id: SESSION_ID,
      metadata: expect.objectContaining({
        capabilityGrantId: GRANT_ID,
        uploadSessionId: SESSION_ID,
      }),
      objectKey: `namespaces/${TENANT_ID}/spaces/${SPACE_ID}/uploads/${SESSION_ID}/source`,
      sha256: "01".repeat(32),
      sizeBytes: 42,
    });
    expect(fixture.start).toHaveBeenCalledWith({
      capabilityGrantId: GRANT_ID,
      deferDispatch: true,
      documentAssetId: SESSION_ID,
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
      version: 1,
    });
    expect(fixture.releaseDispatch).toHaveBeenCalledWith(ATTEMPT_ID);
    await expect(
      fixture.paths.listPhysicalView({
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        viewName: "docs",
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ targetId: SESSION_ID })],
    });
  });

  it("replays after publication without creating another compilation attempt", async () => {
    const fixture = await publisherFixture();
    await fixture.publisher.publish(publishInput());
    fixture.start.mockResolvedValueOnce(compilationJob("queued"));

    await expect(fixture.publisher.publish(publishInput())).resolves.toEqual({
      compilationJobId: ATTEMPT_ID,
      documentAssetId: SESSION_ID,
    });

    expect(fixture.start).toHaveBeenCalledTimes(2);
    expect(fixture.releaseDispatch).toHaveBeenCalledOnce();
  });

  it("fails closed when the persisted grant has been revoked", async () => {
    const fixture = await publisherFixture();
    await fixture.grants.applyGrantRevoke({
      eventId: "revoke-upload-grant",
      grantId: GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "permission_removed",
      revokeSequence: 1,
      tenantId: TENANT_ID,
    });

    await expect(fixture.publisher.publish(publishInput())).rejects.toThrow(
      "Capability publication is fenced",
    );
    expect(fixture.start).not.toHaveBeenCalled();
  });
});

async function publisherFixture() {
  const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
  const paths = createInMemoryKnowledgePathRepository({
    maxListLimit: 20,
    maxPaths: 20,
  });
  const logicalDocuments = createInMemoryLogicalDocumentRepository({
    canReadDocument: () => true,
    canReadRevision: () => true,
    generateDocumentId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d05",
    maxDocuments: 10,
    maxRevisionsPerDocument: 10,
  });
  const grants = createInMemoryCapabilityGrantProvenanceRepository();
  await grants.admit({
    action: "upload_sessions.complete",
    actorId: "user-1",
    authzRevision: {
      credentialRevision: null,
      externalAccessEpoch: 1,
      membershipEpoch: 1,
      spaceAclEpoch: 1,
    },
    callerKind: "interactive",
    contentPolicyRevision: 1,
    contentScopeIds: ["document:write"],
    expiresAt: "2026-07-22T00:00:00.000Z",
    grantId: GRANT_ID,
    issuedAt: "2026-07-21T00:00:00.000Z",
    jtiHash: `sha256:${"a".repeat(64)}`,
    knowledgeSpaceId: SPACE_ID,
    resource: { id: SESSION_ID, parentId: SPACE_ID, type: "upload_session" },
    subjectId: "user-1",
    tenantId: TENANT_ID,
    traceId: "trace-upload-1",
  });
  const start = vi.fn(async () => compilationJob("dispatch_pending"));
  const releaseDispatch = vi.fn(async () => compilationJob("queued"));
  const publisher = createUploadSessionDocumentCompletionPublisher({
    assets,
    compilationJobs: { releaseDispatch, start },
    grants,
    logicalDocuments,
    now: () => "2026-07-21T01:00:00.000Z",
    paths,
  });
  return { assets, grants, paths, publisher, releaseDispatch, start };
}

function publishInput() {
  return {
    checksumSha256Base64: CHECKSUM,
    contentType: "application/pdf",
    expectedSizeBytes: 42,
    fileName: "report.pdf",
    grantId: GRANT_ID,
    idempotencyKey: `upload-session:${SESSION_ID}:publish`,
    knowledgeSpaceId: SPACE_ID,
    objectKey: `namespaces/${TENANT_ID}/spaces/${SPACE_ID}/uploads/${SESSION_ID}/source`,
    tenantId: TENANT_ID,
    uploadSessionId: SESSION_ID,
  };
}

function compilationJob(runState: "dispatch_pending" | "queued") {
  return {
    createdAt: Date.parse("2026-07-21T01:00:00.000Z"),
    documentAssetId: SESSION_ID,
    id: ATTEMPT_ID,
    knowledgeSpaceId: SPACE_ID,
    runState,
    stage: "queued" as const,
    tenantId: TENANT_ID,
    updatedAt: Date.parse("2026-07-21T01:00:00.000Z"),
    version: 1,
  };
}
