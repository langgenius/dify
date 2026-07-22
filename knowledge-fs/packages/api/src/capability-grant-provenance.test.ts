import { describe, expect, it } from "vitest";

import {
  CapabilityGrantConflictError,
  createInMemoryCapabilityGrantProvenanceRepository,
} from "./capability-grant-provenance";

const TENANT_ID = "tenant-a";
const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const GRANT_ID = "20000000-0000-4000-8000-000000000001";
const JTI_HASH = `sha256:${"a".repeat(64)}`;

describe("capability grant provenance", () => {
  it("persists only a claims summary and idempotently replays the same admission", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    const input = grantInput();

    const admitted = await repository.admit(input);
    const replayed = await repository.admit(input);

    expect(replayed).toEqual(admitted);
    expect(admitted).toMatchObject({
      grantId: GRANT_ID,
      highestRevokeSequence: 0,
      jtiHash: JTI_HASH,
      revision: 1,
      state: "active",
    });
    expect(JSON.stringify(admitted)).not.toContain("Bearer");
    expect(JSON.stringify(admitted)).not.toContain("token");
  });

  it("rejects reuse of a grant id with different immutable claims", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    await repository.admit(grantInput());

    await expect(
      repository.admit({ ...grantInput(), action: "documents.delete" }),
    ).rejects.toBeInstanceOf(CapabilityGrantConflictError);
  });

  it("keeps the highest grant revoke sequence across duplicate and out-of-order delivery", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    await repository.admit(grantInput());

    const first = await repository.applyGrantRevoke({
      eventId: "event-3",
      grantId: GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "permission_revoked",
      revokeSequence: 3,
      tenantId: TENANT_ID,
    });
    const stale = await repository.applyGrantRevoke({
      eventId: "event-2",
      grantId: GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "stale",
      revokeSequence: 2,
      tenantId: TENANT_ID,
    });
    const replay = await repository.applyGrantRevoke({
      eventId: "event-3",
      grantId: GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "permission_revoked",
      revokeSequence: 3,
      tenantId: TENANT_ID,
    });

    expect(first).toMatchObject({ applied: true, highestRevokeSequence: 3, state: "revoked" });
    expect(stale).toMatchObject({ applied: false, highestRevokeSequence: 3, state: "revoked" });
    expect(replay).toEqual(stale);
  });

  it("fails the final publication fence after either grant revoke or a space tombstone", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    await repository.admit(grantInput());

    await expect(repository.assertPublicationAllowed(scope())).resolves.toBeUndefined();

    await repository.applySpaceFence({
      eventId: "space-delete-5",
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "space_deleting",
      revokeSequence: 5,
      tenantId: TENANT_ID,
      tombstoned: true,
    });

    await expect(repository.assertPublicationAllowed(scope())).rejects.toThrow(
      "Capability publication is fenced",
    );
  });

  it("does not let a stale space event clear a tombstone", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    await repository.admit(grantInput());
    await repository.applySpaceFence({
      eventId: "space-delete-8",
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "space_deleting",
      revokeSequence: 8,
      tenantId: TENANT_ID,
      tombstoned: true,
    });

    const stale = await repository.applySpaceFence({
      eventId: "space-active-7",
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "stale_repair",
      revokeSequence: 7,
      tenantId: TENANT_ID,
      tombstoned: false,
    });

    expect(stale).toMatchObject({ applied: false, highestRevokeSequence: 8, tombstoned: true });
  });

  it("rejects reuse of an event id with a different revoke command", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    await repository.admit(grantInput());
    await repository.applyGrantRevoke({
      eventId: "event-reused",
      grantId: GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      reasonCode: "permission_revoked",
      revokeSequence: 3,
      tenantId: TENANT_ID,
    });

    await expect(
      repository.applyGrantRevoke({
        eventId: "event-reused",
        grantId: GRANT_ID,
        knowledgeSpaceId: SPACE_ID,
        reasonCode: "different_command",
        revokeSequence: 4,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("event id was reused");
  });
});

function grantInput() {
  return {
    action: "documents.create",
    actorId: "dify-account:actor-a",
    authzRevision: {
      credentialRevision: null,
      externalAccessEpoch: 4,
      membershipEpoch: 2,
      spaceAclEpoch: 3,
    },
    callerKind: "interactive" as const,
    contentPolicyRevision: 6,
    contentScopeIds: ["source-a"],
    expiresAt: "2026-07-21T12:01:00.000Z",
    grantId: GRANT_ID,
    issuedAt: "2026-07-21T12:00:00.000Z",
    jtiHash: JTI_HASH,
    knowledgeSpaceId: SPACE_ID,
    resource: { id: "document-a", parentId: SPACE_ID, type: "document" },
    subjectId: "dify-account:user-a",
    tenantId: TENANT_ID,
    traceId: "30000000-0000-4000-8000-000000000001",
  };
}

function scope() {
  return { grantId: GRANT_ID, knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID };
}
