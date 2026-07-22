import type {
  AuthSubject,
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { DeletionLifecycleFenceGuard } from "./deletion-lifecycle-fence";
import type {
  IssueKnowledgeSpacePermissionSnapshotInput,
  KnowledgeSpaceAccessService,
  KnowledgeSpaceApiKeyPermissionBinding,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import {
  KnowledgeSpaceProfileMigrationConflictError,
  type KnowledgeSpaceProfileMigrationRepository,
  type KnowledgeSpaceProfileMigrationRun,
  createInMemoryKnowledgeSpaceProfileMigrationRepository,
} from "./knowledge-space-profile-migration";
import {
  KnowledgeSpaceProfileMigrationServiceError,
  type RequestKnowledgeSpaceProfileMigrationInput,
  createKnowledgeSpaceProfileMigrationService,
  isKnowledgeSpaceProfileMigrationConflict,
  toPublicKnowledgeSpaceProfileMigration,
} from "./knowledge-space-profile-migration-service";
import type {
  KnowledgeSpaceProfileHead,
  KnowledgeSpaceProfileRepository,
  KnowledgeSpaceProfileRevision,
} from "./knowledge-space-profile-repository";
import type { PublishedProjectionSetPublication } from "./projection-publication-repository";

const tenantId = "tenant-1";
const otherTenantId = "tenant-2";
const spaceId = "10000000-0000-4000-8000-000000000001";
const otherSpaceId = "10000000-0000-4000-8000-000000000002";
const runId = "20000000-0000-4000-8000-000000000001";
const leaseToken = "20000000-0000-4000-8000-000000000002";
const publicationId = "30000000-0000-4000-8000-000000000001";
const capabilityGrantId = "70000000-0000-4000-8000-000000000001";
const fingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const digestA = "b".repeat(64);
const digestB = "c".repeat(64);
const now = "2026-07-14T00:00:00.000Z";
const later = "2026-07-14T00:01:00.000Z";

const subject: AuthSubject = {
  scopes: [],
  subjectId: "owner-1",
  tenantId,
};

describe("knowledge-space profile migration service behavior", () => {
  it("validates service limits and reports whether a published projection requires migration", async () => {
    expect(() => serviceFixture({ maxExecutionAttempts: 0 })).toThrow(
      "Profile migration maxExecutionAttempts must be positive",
    );
    expect(() => serviceFixture({ permissionSnapshotTtlMs: 0 })).toThrow(
      "Profile migration permissionSnapshotTtlMs must be positive",
    );

    const published = serviceFixture();
    await expect(
      published.service.requiresMigration({ knowledgeSpaceId: spaceId, tenantId }),
    ).resolves.toBe(true);
    const unpublished = serviceFixture({ publication: null });
    await expect(
      unpublished.service.requiresMigration({ knowledgeSpaceId: spaceId, tenantId }),
    ).resolves.toBe(false);
  });

  it("maps authorization denials while preserving unexpected authorization failures", async () => {
    const denied = serviceFixture({
      authorizationError: new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ROLE_DENIED",
        "owner required",
      ),
    });
    await expect(denied.service.request(interactiveRequest())).rejects.toMatchObject({
      code: "PROFILE_MIGRATION_FORBIDDEN",
      message: "Knowledge-space admin access is required",
    });

    const outage = new Error("authorization backend unavailable");
    const failed = serviceFixture({ authorizationError: outage });
    await expect(failed.service.request(interactiveRequest())).rejects.toBe(outage);
  });

  it("starts and replays a capability-authorized embedding migration with full vector rebuild", async () => {
    const fixture = serviceFixture();
    const input = capabilityRequest();
    const first = await fixture.service.request(input);

    expect(first).toMatchObject({
      baseEmbeddingProfile: { revision: 1 },
      capabilityGrantId,
      candidateProfile: { revision: 2 },
      rebuildScope: "full-vector-space",
      runState: "queued",
    });
    await expect(fixture.service.request(input)).resolves.toEqual(first);
    expect(fixture.authorization.authorize).not.toHaveBeenCalled();
    expect(fixture.access.createPermissionSnapshot).not.toHaveBeenCalled();
    expect(fixture.deletionFence.captureDeletionFence).toHaveBeenCalledOnce();

    await expect(fixture.service.request({ ...input, candidateRevision: 3 })).rejects.toMatchObject(
      { code: "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT" },
    );
  });

  it("classifies retrieval migrations from reasoning-model compatibility", async () => {
    const compatibleCandidate = profileRevision(
      "retrieval",
      "candidate",
      2,
      retrievalProfile("reasoning"),
    );
    const compatible = serviceFixture({ candidate: compatibleCandidate });
    await expect(
      compatible.service.request(capabilityRequest({ changedKind: "retrieval" })),
    ).resolves.toMatchObject({ rebuildScope: "clone-publication" });

    const changedCandidate = profileRevision(
      "retrieval",
      "candidate",
      2,
      retrievalProfile("reasoning-v2"),
    );
    const changed = serviceFixture({ candidate: changedCandidate });
    await expect(
      changed.service.request(capabilityRequest({ changedKind: "retrieval" })),
    ).resolves.toMatchObject({ rebuildScope: "full-page-index-summary-outline" });
  });

  it("rejects missing candidate and unpublished base prerequisites after taking the deletion fence", async () => {
    const cases = [
      {
        code: "PROFILE_MIGRATION_CANDIDATE_NOT_FOUND",
        fixture: serviceFixture({ candidate: null }),
      },
      {
        code: "PROFILE_MIGRATION_CANDIDATE_NOT_FOUND",
        fixture: serviceFixture({
          candidate: profileRevision("embedding", "active", 2, embeddingProfile(2)),
        }),
      },
      {
        code: "PROFILE_MIGRATION_BASE_NOT_PUBLISHED",
        fixture: serviceFixture({ retrievalHead: null }),
      },
      {
        code: "PROFILE_MIGRATION_BASE_NOT_PUBLISHED",
        fixture: serviceFixture({ publication: null }),
      },
    ];

    for (const testCase of cases) {
      await expect(testCase.fixture.service.request(capabilityRequest())).rejects.toMatchObject({
        code: testCase.code,
      });
      expect(testCase.fixture.deletionFence.captureDeletionFence).toHaveBeenCalledOnce();
    }
  });

  it("binds API-key provenance and caps the durable permission at key expiry", async () => {
    const apiKey: KnowledgeSpaceApiKeyPermissionBinding = {
      expiresAt: "2026-07-14T00:10:00.000Z",
      id: "api-key-1",
      revision: 7,
    };
    const fixture = serviceFixture({ permissionSnapshotTtlMs: 60 * 60_000 });
    const created = await fixture.service.request(
      interactiveRequest({ apiKey, callerKind: "api_key" }),
    );

    expect(created).toMatchObject({
      accessChannel: "service_api",
      permissionSnapshotId: "permission-1",
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "owner-1",
    });
    expect(fixture.access.createPermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        accessChannel: "service_api",
        apiKey,
        expiresAt: apiKey.expiresAt,
      }),
    );
    expect(fixture.authorization.authorize).toHaveBeenCalledTimes(2);
  });

  it("hides cross-tenant and cross-space runs before authorizing their identifiers", async () => {
    const fixture = serviceFixture();
    const run = await fixture.service.request(capabilityRequest());

    await expect(
      fixture.service.get({
        callerKind: "agent",
        capabilityGrantId,
        knowledgeSpaceId: otherSpaceId,
        runId: run.id,
        subject,
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.service.get({
        callerKind: "agent",
        capabilityGrantId,
        knowledgeSpaceId: spaceId,
        runId: run.id,
        subject: { ...subject, tenantId: otherTenantId },
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.service.get({
        callerKind: "agent",
        capabilityGrantId,
        knowledgeSpaceId: spaceId,
        runId: run.id,
        subject,
      }),
    ).resolves.toEqual(run);
    await expect(
      fixture.service.get({
        callerKind: "agent",
        capabilityGrantId,
        knowledgeSpaceId: spaceId,
        runId: "20000000-0000-4000-8000-000000000099",
        subject,
      }),
    ).resolves.toBeNull();
  });

  it("cancels a capability run and fails only its matching immutable candidate", async () => {
    const fixture = serviceFixture();
    const run = await fixture.service.request(capabilityRequest());
    const cancel = vi.spyOn(fixture.repository, "cancel");

    await expect(
      fixture.service.cancel({
        callerKind: "agent",
        capabilityGrantId,
        knowledgeSpaceId: spaceId,
        runId: run.id,
        subject,
      }),
    ).resolves.toMatchObject({ runState: "canceled" });
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityGrantId,
        reason: "Canceled by knowledge-space administrator",
      }),
    );
    expect(fixture.profiles.failCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "PROFILE_MIGRATION_CANCELED",
        revision: 2,
      }),
    );

    const mismatch = serviceFixture();
    const mismatchRun = await mismatch.service.request(capabilityRequest());
    vi.mocked(mismatch.profiles.getRevision).mockResolvedValue(
      profileRevision("embedding", "candidate", 2, embeddingProfile(2), {
        snapshotDigest: digestA,
      }),
    );
    await mismatch.service.cancel({
      callerKind: "agent",
      capabilityGrantId,
      knowledgeSpaceId: spaceId,
      reason: "operator canceled",
      runId: mismatchRun.id,
      subject,
    });
    expect(mismatch.profiles.failCandidate).not.toHaveBeenCalled();
  });

  it("requires the original capability grant before retrying a failed run", async () => {
    const fixture = serviceFixture();
    const run = await fixture.service.request(capabilityRequest());
    await failRun(fixture.repository, run.id);

    await expect(
      fixture.service.retry({
        callerKind: "interactive",
        knowledgeSpaceId: spaceId,
        runId: run.id,
        subject,
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.service.retry({
        callerKind: "agent",
        capabilityGrantId,
        knowledgeSpaceId: spaceId,
        runId: run.id,
        subject,
      }),
    ).resolves.toMatchObject({ runState: "queued" });
    expect(fixture.deletionFence.captureDeletionFence).toHaveBeenCalledTimes(2);
  });

  it("rejects API-key retry drift and renews an exact-provenance permission", async () => {
    const apiKey: KnowledgeSpaceApiKeyPermissionBinding = {
      id: "api-key-1",
      revision: 7,
    };
    const fixture = serviceFixture();
    const run = await fixture.service.request(
      interactiveRequest({ apiKey, callerKind: "api_key" }),
    );
    await failRun(fixture.repository, run.id);

    await expect(
      fixture.service.retry({
        apiKey: { ...apiKey, revision: 8 },
        callerKind: "api_key",
        knowledgeSpaceId: spaceId,
        runId: run.id,
        subject,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_PERMISSION_PROVENANCE_MISMATCH" });

    await expect(
      fixture.service.retry({
        apiKey,
        callerKind: "api_key",
        knowledgeSpaceId: spaceId,
        runId: run.id,
        subject,
      }),
    ).resolves.toMatchObject({
      permissionSnapshotId: "permission-2",
      runState: "queued",
    });
    expect(fixture.access.createPermissionSnapshot).toHaveBeenCalledTimes(2);
  });

  it("exposes only public migration fields and scalar evaluation diagnostics", async () => {
    const fixture = serviceFixture();
    const run = await fixture.service.request(capabilityRequest());
    const minimal = toPublicKnowledgeSpaceProfileMigration(run);
    const response = toPublicKnowledgeSpaceProfileMigration({
      ...run,
      candidatePublicationFingerprint: fingerprint,
      completedAt: later,
      evaluationSummary: {
        nested: { hidden: true },
        passed: true,
        recall: 0.91,
        verdict: "accepted",
      },
      lastErrorCode: "PROFILE_WARNING",
    });

    expect(response).toEqual(
      expect.objectContaining({
        candidatePublicationFingerprint: fingerprint,
        completedAt: later,
        errorCode: "PROFILE_WARNING",
        evaluationSummary: { passed: true, recall: 0.91, verdict: "accepted" },
      }),
    );
    expect(response).not.toHaveProperty("tenantId");
    expect(response.evaluationSummary).not.toHaveProperty("nested");
    expect(minimal).not.toHaveProperty("candidatePublicationFingerprint");
    expect(minimal).not.toHaveProperty("completedAt");
    expect(minimal).not.toHaveProperty("evaluationSummary");
    expect(minimal).not.toHaveProperty("errorCode");
    expect(
      isKnowledgeSpaceProfileMigrationConflict(
        new KnowledgeSpaceProfileMigrationConflictError("CONFLICT", "conflict"),
      ),
    ).toBe(true);
    expect(isKnowledgeSpaceProfileMigrationConflict(new Error("conflict"))).toBe(false);
    expect(
      new KnowledgeSpaceProfileMigrationServiceError("SERVICE_ERROR", "service error"),
    ).toMatchObject({ code: "SERVICE_ERROR", name: "KnowledgeSpaceProfileMigrationServiceError" });
  });
});

interface ServiceFixtureOptions {
  readonly authorizationError?: Error | undefined;
  readonly candidate?: KnowledgeSpaceProfileRevision | null | undefined;
  readonly maxExecutionAttempts?: number | undefined;
  readonly permissionSnapshotTtlMs?: number | undefined;
  readonly publication?: PublishedProjectionSetPublication | null | undefined;
  readonly retrievalHead?: KnowledgeSpaceProfileHead | null | undefined;
}

function serviceFixture(options: ServiceFixtureOptions = {}) {
  const embeddingCandidate = profileRevision("embedding", "candidate", 2, embeddingProfile(2));
  const candidate = options.candidate === undefined ? embeddingCandidate : options.candidate;
  const activeEmbedding = profileRevision("embedding", "active", 1, embeddingProfile(1));
  const activeRetrieval = profileRevision("retrieval", "active", 1, retrievalProfile("reasoning"));
  const embeddingHead = profileHead(activeEmbedding);
  const retrievalHead =
    options.retrievalHead === undefined ? profileHead(activeRetrieval) : options.retrievalHead;

  const profiles: KnowledgeSpaceProfileRepository = {
    activateCandidate: vi.fn(async () => {
      throw new Error("activateCandidate was not expected");
    }),
    createCandidate: vi.fn(async () => {
      throw new Error("createCandidate was not expected");
    }),
    failCandidate: vi.fn(async (input) =>
      profileRevision(input.kind, "failed", input.revision, candidateSnapshot(input.kind)),
    ),
    getHead: vi.fn(async (input) => (input.kind === "embedding" ? embeddingHead : retrievalHead)),
    getRevision: vi.fn(async () => candidate),
    listRevisions: vi.fn(async () => ({ items: [] })),
  };

  let permissionSequence = 0;
  const createPermissionSnapshot = vi.fn(
    async (
      input: IssueKnowledgeSpacePermissionSnapshotInput,
    ): Promise<KnowledgeSpacePermissionSnapshot> => {
      permissionSequence += 1;
      return permissionSnapshot(input, `permission-${permissionSequence}`);
    },
  );
  const getPermissionSnapshot = vi.fn(async () =>
    permissionSnapshot(
      {
        accessChannel: "service_api",
        apiKey: { id: "api-key-1", revision: 7 },
        expiresAt: later,
        knowledgeSpaceId: spaceId,
        subjectId: subject.subjectId,
        tenantId,
      },
      "permission-1",
    ),
  );
  const access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "getPermissionSnapshot"
  > = { createPermissionSnapshot, getPermissionSnapshot };

  const authorize = vi.fn<KnowledgeSpaceAuthorizationGuard["authorize"]>(async () => {
    if (options.authorizationError) throw options.authorizationError;
    return authorizationDecision();
  });
  const authorization: KnowledgeSpaceAuthorizationGuard = { authorize };
  const publication =
    options.publication === undefined ? publishedProjection() : options.publication;
  const publications = { getPublished: vi.fn(async () => publication) };
  const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
    generateLeaseToken: () => leaseToken,
    generateRunId: () => runId,
    maxRuns: 10,
  });
  const deletionFence: DeletionLifecycleFenceGuard = {
    assertDeletionFenceUnchanged: vi.fn(async () => undefined),
    captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
  };
  const service = createKnowledgeSpaceProfileMigrationService({
    access,
    authorization,
    deletionFence,
    ...(options.maxExecutionAttempts === undefined
      ? {}
      : { maxExecutionAttempts: options.maxExecutionAttempts }),
    now: () => Date.parse(now),
    ...(options.permissionSnapshotTtlMs === undefined
      ? {}
      : { permissionSnapshotTtlMs: options.permissionSnapshotTtlMs }),
    profiles,
    publications,
    repository,
  });
  return { access, authorization, deletionFence, profiles, publications, repository, service };
}

function interactiveRequest(
  overrides: Partial<RequestKnowledgeSpaceProfileMigrationInput> = {},
): RequestKnowledgeSpaceProfileMigrationInput {
  return {
    callerKind: "interactive",
    candidateRevision: 2,
    changedKind: "embedding",
    idempotencyKey: "settings-request-1",
    knowledgeSpaceId: spaceId,
    subject,
    ...overrides,
  };
}

function capabilityRequest(
  overrides: Partial<RequestKnowledgeSpaceProfileMigrationInput> = {},
): RequestKnowledgeSpaceProfileMigrationInput {
  return {
    callerKind: "agent" as const,
    candidateRevision: 2,
    capabilityGrantId,
    changedKind: "embedding" as const,
    idempotencyKey: "settings-request-1",
    knowledgeSpaceId: spaceId,
    subject,
    ...overrides,
  };
}

async function failRun(repository: KnowledgeSpaceProfileMigrationRepository, id: string) {
  const [claimed] = await repository.claim({
    leaseExpiresAt: later,
    limit: 1,
    now,
    workerId: "migration-worker",
  });
  if (!claimed?.leaseToken) throw new Error("Expected claimed migration run");
  await repository.fail({
    errorCode: "PROFILE_MIGRATION_TRANSIENT",
    errorMessage: "temporary outage",
    expectedRowVersion: claimed.rowVersion,
    leaseToken: claimed.leaseToken,
    now: "2026-07-14T00:00:30.000Z",
    runId: id,
    terminal: false,
  });
}

function profileRevision(
  kind: "embedding" | "retrieval",
  state: "active" | "candidate" | "failed",
  revision: number,
  snapshot: KnowledgeSpaceEmbeddingProfile | KnowledgeSpaceRetrievalProfile,
  overrides: Partial<KnowledgeSpaceProfileRevision> = {},
): KnowledgeSpaceProfileRevision {
  const selection =
    kind === "embedding"
      ? (snapshot as KnowledgeSpaceEmbeddingProfile)
      : (snapshot as KnowledgeSpaceRetrievalProfile).reasoningModel;
  return {
    capabilitySnapshot: { model: selection.model },
    capabilitySnapshotDigest: digestA,
    createdAt: now,
    createdBySubjectId: subject.subjectId,
    id:
      kind === "embedding"
        ? `40000000-0000-4000-8000-${String(revision).padStart(12, "0")}`
        : `50000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
    kind,
    knowledgeSpaceId: spaceId,
    model: selection.model,
    pluginId: selection.pluginId,
    provider: selection.provider,
    revision,
    snapshot,
    snapshotDigest: revision === 1 ? digestA : digestB,
    state,
    tenantId,
    updatedAt: now,
    ...(kind === "embedding"
      ? {
          dimension: (snapshot as KnowledgeSpaceEmbeddingProfile).dimension,
          vectorSpaceId: (snapshot as KnowledgeSpaceEmbeddingProfile).vectorSpaceId,
        }
      : {}),
    ...overrides,
  };
}

function profileHead(profile: KnowledgeSpaceProfileRevision): KnowledgeSpaceProfileHead {
  return {
    activeRevision: profile.revision,
    createdAt: now,
    id: `60000000-0000-4000-8000-${String(profile.revision).padStart(12, "0")}`,
    kind: profile.kind,
    knowledgeSpaceId: profile.knowledgeSpaceId,
    profile,
    profileRevisionId: profile.id,
    rowVersion: profile.revision,
    tenantId: profile.tenantId,
    updatedAt: now,
  };
}

function embeddingProfile(revision: number): KnowledgeSpaceEmbeddingProfile {
  return {
    dimension: revision === 1 ? 768 : 1_536,
    model: `embedding-v${revision}`,
    pluginId: "embedding-plugin",
    provider: "embedding-provider",
    revision,
    vectorSpaceId: `embedding-space-sha256:${String(revision).repeat(64)}`,
  };
}

function retrievalProfile(model: string): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "research",
    reasoningModel: { model, pluginId: "reasoning-plugin", provider: "reasoning-provider" },
    rerank: { enabled: false },
    revision: model === "reasoning" ? 1 : 2,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 12,
  };
}

function candidateSnapshot(
  kind: "embedding" | "retrieval",
): KnowledgeSpaceEmbeddingProfile | KnowledgeSpaceRetrievalProfile {
  return kind === "embedding" ? embeddingProfile(2) : retrievalProfile("reasoning-v2");
}

function publishedProjection(): PublishedProjectionSetPublication {
  return {
    createdAt: now,
    fingerprint,
    headRevision: 7,
    id: publicationId,
    knowledgeSpaceId: spaceId,
    metadata: {},
    projectionVersion: 1,
    status: "published",
    tenantId,
    updatedAt: now,
  };
}

function permissionSnapshot(
  input: IssueKnowledgeSpacePermissionSnapshotInput,
  id: string,
): KnowledgeSpacePermissionSnapshot {
  return {
    accessChannel: input.accessChannel,
    accessPolicyRevision: 1,
    apiAccessRevision: 1,
    ...(input.apiKey
      ? {
          ...(input.apiKey.expiresAt ? { apiKeyExpiresAt: input.apiKey.expiresAt } : {}),
          apiKeyId: input.apiKey.id,
          apiKeyRevision: input.apiKey.revision,
        }
      : {}),
    createdAt: now,
    expiresAt: input.expiresAt,
    id,
    knowledgeSpaceId: input.knowledgeSpaceId,
    memberRevision: 1,
    permissionScopes: [],
    revision: 1,
    role: "owner",
    status: "active",
    subjectId: input.subjectId,
    tenantId: input.tenantId,
    updatedAt: now,
    visibility: "only_me",
  };
}

function authorizationDecision(): Awaited<
  ReturnType<KnowledgeSpaceAuthorizationGuard["authorize"]>
> {
  return {
    accessContext: {
      apiAccess: { enabled: true, id: "api-access-1", revision: 1 },
      member: { id: "member-1", revision: 1, role: "owner", subjectId: subject.subjectId },
      partialMemberSubjectIds: [],
      policy: {
        id: "policy-1",
        ownerSubjectId: subject.subjectId,
        revision: 1,
        visibility: "only_me",
      },
    },
    permissionSnapshot: {
      apiAccessRevision: 1,
      callerKind: "interactive",
      candidateGrants: [],
      issuedAt: now,
      knowledgeSpaceId: spaceId,
      memberRevision: 1,
      memberRole: "owner",
      policyRevision: 1,
      subjectId: subject.subjectId,
      tenantId,
    },
  };
}
