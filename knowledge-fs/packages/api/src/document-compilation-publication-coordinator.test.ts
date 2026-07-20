import { buildProjectionSetFingerprint } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  DeletionLifecycleFenceActiveError,
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";
import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import {
  DocumentCompilationCandidateComponentError,
  type DocumentCompilationCandidateComponentReceipt,
  DocumentCompilationCandidateEvaluationError,
  DocumentCompilationCandidateIdentityConflictError,
  DocumentCompilationCandidateLeaseLostError,
  DocumentCompilationCandidateMetadataKey,
  createDocumentCompilationPublicationCoordinator,
} from "./document-compilation-publication-coordinator";
import type { DocumentCompilationExecutionContext } from "./document-compilation-runtime";
import {
  type ProjectionSetPublicationDocumentComponentInput,
  ProjectionSetPublicationMemberAttemptFenceConflictError,
  createInMemoryProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import {
  ProjectionSetPublicationAttemptFenceConflictError,
  ProjectionSetPublicationHeadConflictError,
  createInMemoryProjectionSetPublicationRepository,
} from "./projection-publication-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3001";
const publishedPublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3002";
const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3003";
const conflictingPublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3004";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3010";
const inheritedDocumentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3011";
const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3020";
const oldGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3021";
const publishedFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const oldOwnerComponentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3030";
const inheritedComponentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3031";
const replacementOutlineId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3032";
const replacementProjectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3033";
const now = "2026-07-13T14:00:00.000Z";

describe("document compilation publication coordinator", () => {
  it("binds one exclusive candidate and atomically replaces only the owner document snapshot", async () => {
    const execution = fakeExecution(attempt());
    const { members, publications } = await publishedRepositories({
      get: async (id) => (id === execution.context.attempt.id ? execution.context.attempt : null),
    });
    const compose = vi.spyOn(members, "composeDocumentCandidate");
    const validator = allowingValidator();
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members,
      publications,
      validator,
    });
    const components = replacementComponents();

    const first = await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: replacementReceipt(),
      createdAt: now,
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      metadata: { requestedBy: "test" },
      projectionVersion: 3,
    });

    expect(first).toMatchObject({
      attempt: {
        candidatePublicationId,
        checkpoint: "projection_built",
      },
      candidate: {
        id: candidatePublicationId,
        projectionVersion: 3,
        status: "candidate",
      },
      inheritedMemberCount: 1,
      replacedMemberCount: 2,
    });
    expect(first.candidate.metadata).toMatchObject({
      [DocumentCompilationCandidateMetadataKey]: {
        attemptId,
        baseHeadRevision: 1,
        ownerDocumentAssetId: documentAssetId,
        ownerDocumentVersion: 2,
        publicationGenerationId,
        schemaVersion: 1,
      },
      requestedBy: "test",
    });
    expect(validator.validate).toHaveBeenCalledWith({
      attempt: expect.objectContaining({ id: attemptId, publicationGenerationId }),
      components,
      fingerprintMaterial: fingerprintMaterial(),
    });
    await expect(
      members.listByFingerprint({
        fingerprint: first.candidate.fingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        componentKey: replacementOutlineId,
        documentAssetId,
        generationId: publicationGenerationId,
      }),
      expect.objectContaining({
        componentKey: inheritedComponentId,
        documentAssetId: inheritedDocumentAssetId,
        generationId: oldGenerationId,
      }),
      expect.objectContaining({
        componentKey: replacementProjectionId,
        documentAssetId,
        generationId: publicationGenerationId,
      }),
    ]);
    expect(execution.advance).toHaveBeenNthCalledWith(1, {
      candidateFingerprint: first.candidate.fingerprint,
      candidatePublicationId,
      checkpoint: "nodes_generated",
    });
    expect(execution.advance).toHaveBeenNthCalledWith(2, {
      candidateFingerprint: first.candidate.fingerprint,
      candidatePublicationId,
      checkpoint: "projection_built",
    });
    expect(compose.mock.calls[0]?.[0].attemptFence).toMatchObject({
      attemptId,
      candidatePublicationId,
      leaseToken: attempt().leaseToken,
      publicationGenerationId,
    });
    expect(execution.withLeaseSnapshot).toHaveBeenCalledTimes(1);

    const retried = await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: replacementReceipt(),
      createdAt: "2026-07-13T14:01:00.000Z",
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      projectionVersion: 3,
    });
    expect(retried).toMatchObject({ inheritedMemberCount: 1, replacedMemberCount: 2 });
    expect(execution.advance).toHaveBeenCalledTimes(2);
    await expect(
      members.listByFingerprint({
        fingerprint: retried.candidate.fingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ componentKey: replacementOutlineId }),
      expect.objectContaining({ componentKey: inheritedComponentId }),
      expect.objectContaining({ componentKey: replacementProjectionId }),
    ]);
  });

  it("passes more than 1000 owner members through one logical compose call", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const execution = fakeExecution(attempt({ baseHeadRevision: 0 }));
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      attempts: {
        get: async (id) => (id === execution.context.attempt.id ? execution.context.attempt : null),
      },
      maxListLimit: 2_000,
      maxMembers: 2_000,
      now: () => Date.parse(now),
      publications,
    });
    const compose = vi.spyOn(members, "composeDocumentCandidate");
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 2_000,
      members,
      publications,
      validator: allowingValidator(),
    });
    const components = Array.from({ length: 1_001 }, (_, index) => ({
      componentKey: indexedUuid(index),
      generationId: publicationGenerationId,
    }));

    const result = await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: componentReceipt({ indexProjections: components }),
      createdAt: now,
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      projectionVersion: 3,
    });

    expect(result.replacedMemberCount).toBe(1_001);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose.mock.calls[0]?.[0].components).toHaveLength(1_001);
    await expect(
      members.listByFingerprint({
        fingerprint: result.candidate.fingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toHaveLength(1_001);
  });

  it("fails closed on a stale head before changing candidate members", async () => {
    const { members, publications } = await publishedRepositories();
    const compose = vi.spyOn(members, "composeDocumentCandidate");
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members,
      publications,
      validator: allowingValidator(),
    });
    const execution = fakeExecution(attempt({ baseHeadRevision: 0 }));
    const fingerprint = await buildProjectionSetFingerprint(fingerprintMaterial());

    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: replacementReceipt(),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: fingerprintMaterial(),
        projectionVersion: 3,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);

    expect(compose).toHaveBeenCalledTimes(1);
    expect(execution.context.attempt).toMatchObject({
      candidateFingerprint: fingerprint,
      candidatePublicationId,
      checkpoint: "nodes_generated",
    });
    await expect(
      members.listByFingerprint({ fingerprint, knowledgeSpaceId, tenantId }),
    ).resolves.toEqual([]);
  });

  it("rejects a fingerprint collision owned by another attempt before binding or composing", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 10,
      maxMembers: 10,
      publications,
    });
    const compose = vi.spyOn(members, "composeDocumentCandidate");
    const material = fingerprintMaterial();
    const fingerprint = await buildProjectionSetFingerprint(material);
    await publications.createCandidate({
      createdAt: now,
      fingerprint,
      id: conflictingPublicationId,
      knowledgeSpaceId,
      metadata: {
        [DocumentCompilationCandidateMetadataKey]: {
          attemptId: conflictingPublicationId,
        },
      },
      projectionVersion: 3,
      tenantId,
    });
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members,
      publications,
      validator: allowingValidator(),
    });
    const execution = fakeExecution(attempt({ baseHeadRevision: 0 }));

    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: replacementReceipt(),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: material,
        projectionVersion: 3,
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateIdentityConflictError);
    expect(execution.advance).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });

  it("requires server-side component validation before candidate creation or member mutation", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 10,
      maxMembers: 10,
      publications,
    });
    const compose = vi.spyOn(members, "composeDocumentCandidate");
    const validationError = new Error("graph relation endpoint is outside the candidate closure");
    const validator = { validate: vi.fn(async () => Promise.reject(validationError)) };
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members,
      publications,
      validator,
    });
    const execution = fakeExecution(attempt({ baseHeadRevision: 0 }));
    const material = fingerprintMaterial();
    const fingerprint = await buildProjectionSetFingerprint(material);

    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: replacementReceipt(),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: material,
        projectionVersion: 3,
      }),
    ).rejects.toBe(validationError);

    expect(validator.validate).toHaveBeenCalledOnce();
    expect(execution.advance).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
    await expect(
      publications.getByFingerprint({ fingerprint, knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();
  });

  it("turns an atomic member attempt-fence rejection into execution lease loss", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const composeDocumentCandidate = vi.fn(async () => {
      throw new ProjectionSetPublicationMemberAttemptFenceConflictError();
    });
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members: { composeDocumentCandidate, listByFingerprint: async () => [] },
      publications,
      validator: allowingValidator(),
    });
    const execution = fakeExecution(attempt({ baseHeadRevision: 0 }));
    execution.withLeaseSnapshot.mockImplementation(async (operation) =>
      operation({ ...execution.context.attempt, rowVersion: 99 }),
    );

    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: replacementReceipt(),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: fingerprintMaterial(),
        projectionVersion: 3,
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateLeaseLostError);
    expect(composeDocumentCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptFence: expect.objectContaining({
          attemptId,
          candidatePublicationId,
          expectedRowVersion: 99,
          leaseToken: attempt().leaseToken,
          publicationGenerationId,
        }),
      }),
    );
  });

  it("validates owner snapshot, generation, type, duplicates, and replacement counts", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const baseMembers = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 10,
      maxMembers: 10,
      publications,
    });
    const execution = fakeExecution(attempt({ baseHeadRevision: 0 }));
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members: baseMembers,
      publications,
      validator: allowingValidator(),
    });

    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: componentReceipt({
          documentOutlines: [{ componentKey: replacementOutlineId, generationId: oldGenerationId }],
        }),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: fingerprintMaterial(),
        projectionVersion: 3,
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateComponentError);
    const malformedReceipt = {
      ...replacementReceipt(),
      unsupportedComponents: [],
    } as unknown as DocumentCompilationCandidateComponentReceipt;
    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: malformedReceipt,
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: fingerprintMaterial(),
        projectionVersion: 3,
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateComponentError);
    const duplicate = {
      componentKey: replacementOutlineId,
      generationId: publicationGenerationId,
    };
    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: componentReceipt({ documentOutlines: [duplicate, duplicate] }),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: fingerprintMaterial(),
        projectionVersion: 3,
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateComponentError);
    await expect(
      coordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: replacementReceipt(),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: {
          ...fingerprintMaterial(),
          sourceSnapshots: [
            {
              documentAssetId,
              sha256: "1".repeat(64),
              version: 1,
            },
          ],
        },
        projectionVersion: 3,
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateIdentityConflictError);

    const boundedCoordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 1,
      members: baseMembers,
      publications,
      validator: allowingValidator(),
    });
    await expect(
      boundedCoordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: replacementReceipt(),
        createdAt: now,
        execution: execution.context,
        fingerprintMaterial: fingerprintMaterial(),
        projectionVersion: 3,
      }),
    ).rejects.toThrow("exceeds maxComponents=1");

    const mismatchedMembers = {
      composeDocumentCandidate: vi.fn(async () => ({ inherited: 0, replaced: 1 })),
      listByFingerprint: vi.fn(async () => []),
    };
    const countCoordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members: mismatchedMembers,
      publications,
      validator: allowingValidator(),
    });
    const countExecution = fakeExecution(attempt({ baseHeadRevision: 0 }));
    await expect(
      countCoordinator.composeCandidate({
        candidateId: candidatePublicationId,
        componentReceipt: replacementReceipt(),
        createdAt: now,
        execution: countExecution.context,
        fingerprintMaterial: fingerprintMaterial(),
        projectionVersion: 3,
      }),
    ).rejects.toThrow("replacement count mismatch");
  });

  it("evaluates only the exact candidate snapshot and publishes it with the attempt head CAS", async () => {
    const execution = fakeExecution(attempt());
    const { members, publications } = await publishedRepositories({
      get: async (id) => (id === execution.context.attempt.id ? execution.context.attempt : null),
    });
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members,
      publications,
      validator: allowingValidator(),
    });
    const composed = await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: replacementReceipt(),
      createdAt: now,
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      projectionVersion: 3,
    });
    const evaluate = vi.fn(async (snapshot) => {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.members)).toBe(true);
      expect(snapshot).toMatchObject({
        candidateFingerprint: composed.candidate.fingerprint,
        candidatePublicationId,
        expectedHeadRevision: 1,
        members: [
          expect.objectContaining({ componentKey: replacementOutlineId }),
          expect.objectContaining({ componentKey: inheritedComponentId }),
          expect.objectContaining({ componentKey: replacementProjectionId }),
        ],
      });
      return { decision: "passed" as const };
    });

    const result = await coordinator.evaluateAndPublishCandidate({
      evaluator: { evaluate },
      execution: execution.context,
      updatedAt: "2026-07-13T14:02:00.000Z",
    });

    expect(result).toMatchObject({
      attempt: { checkpoint: "smoke_eval_passed" },
      evaluation: "passed",
      publication: {
        headRevision: 2,
        published: { fingerprint: composed.candidate.fingerprint, status: "published" },
        superseded: { fingerprint: publishedFingerprint, status: "superseded" },
      },
    });
    expect(evaluate).toHaveBeenCalledOnce();
    await expect(publications.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: composed.candidate.fingerprint,
      headRevision: 2,
    });

    await expect(
      coordinator.evaluateAndPublishCandidate({
        evaluator: {
          evaluate: async () => {
            throw new Error("a committed publication retry must not evaluate again");
          },
        },
        execution: execution.context,
        updatedAt: "2026-07-13T14:03:00.000Z",
      }),
    ).resolves.toMatchObject({
      evaluation: "previously-passed",
      publication: { headRevision: 2 },
    });
  });

  it("deactivates a candidate instead of publishing after a deletion fence appears", async () => {
    const execution = fakeExecution(attempt());
    const { members, publications } = await publishedRepositories({
      get: async (id) => (id === execution.context.attempt.id ? execution.context.attempt : null),
    });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const coordinator = createDocumentCompilationPublicationCoordinator({
      deletionFence: createDeletionLifecycleFenceGuard(fences),
      maxComponents: 100,
      members,
      publications,
      validator: allowingValidator(),
    });
    const composed = await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: replacementReceipt(),
      createdAt: now,
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      projectionVersion: 3,
    });

    await expect(
      coordinator.evaluateAndPublishCandidate({
        evaluator: {
          evaluate: async () => {
            await fences.activateFence({
              id: "deletion-fence-1",
              knowledgeSpaceId,
              targetId: documentAssetId,
              targetType: "document",
              tenantId,
            });
            return { decision: "passed" };
          },
        },
        execution: execution.context,
        updatedAt: "2026-07-13T14:02:00.000Z",
      }),
    ).rejects.toBeInstanceOf(DeletionLifecycleFenceActiveError);
    await expect(publications.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: publishedFingerprint,
      headRevision: 1,
    });
    await expect(
      publications.getByFingerprint({
        fingerprint: composed.candidate.fingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ status: "inactive" });
  });

  it("deactivates a rejected candidate and leaves the old published head untouched", async () => {
    const execution = fakeExecution(attempt());
    const { members, publications } = await publishedRepositories({
      get: async (id) => (id === execution.context.attempt.id ? execution.context.attempt : null),
    });
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members,
      publications,
      validator: allowingValidator(),
    });
    const composed = await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: replacementReceipt(),
      createdAt: now,
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      projectionVersion: 3,
    });

    await expect(
      coordinator.evaluateAndPublishCandidate({
        evaluator: {
          evaluate: async () => ({ decision: "failed", reason: "candidate recall below gate" }),
        },
        execution: execution.context,
        updatedAt: "2026-07-13T14:02:00.000Z",
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateEvaluationError);

    await expect(
      publications.getByFingerprint({
        fingerprint: composed.candidate.fingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ status: "inactive" });
    await expect(publications.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: publishedFingerprint,
      headRevision: 1,
    });
    expect(execution.context.attempt.checkpoint).toBe("projection_built");
  });

  it("deactivates a stale candidate when another publisher wins the head CAS", async () => {
    const execution = fakeExecution(attempt());
    const { members, publications } = await publishedRepositories({
      get: async (id) => (id === execution.context.attempt.id ? execution.context.attempt : null),
    });
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members,
      publications,
      validator: allowingValidator(),
    });
    const composed = await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: replacementReceipt(),
      createdAt: now,
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      projectionVersion: 3,
    });
    const concurrentFingerprint = `projection-set-sha256:${"c".repeat(64)}`;
    await publications.createCandidate({
      createdAt: "2026-07-13T14:00:30.000Z",
      fingerprint: concurrentFingerprint,
      id: conflictingPublicationId,
      knowledgeSpaceId,
      projectionVersion: 4,
      tenantId,
    });
    await publications.validate({
      fingerprint: concurrentFingerprint,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-07-13T14:00:40.000Z",
    });
    await publications.publish({
      expectedHeadRevision: 1,
      fingerprint: concurrentFingerprint,
      knowledgeSpaceId,
      tenantId,
      updatedAt: "2026-07-13T14:00:50.000Z",
    });

    await expect(
      coordinator.evaluateAndPublishCandidate({
        evaluator: { evaluate: async () => ({ decision: "passed" }) },
        execution: execution.context,
        updatedAt: "2026-07-13T14:02:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);

    await expect(
      publications.getByFingerprint({
        fingerprint: composed.candidate.fingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ status: "inactive" });
    await expect(publications.getPublished({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      fingerprint: concurrentFingerprint,
      headRevision: 2,
    });
  });

  it("turns a final atomic attempt-fence rejection into lease loss without changing the head", async () => {
    const execution = fakeExecution(attempt());
    const repositories = await publishedRepositories({
      get: async (id) => (id === execution.context.attempt.id ? execution.context.attempt : null),
    });
    const coordinator = createDocumentCompilationPublicationCoordinator({
      maxComponents: 100,
      members: repositories.members,
      publications: {
        ...repositories.publications,
        publishDocumentCompilationCandidate: async () => {
          throw new ProjectionSetPublicationAttemptFenceConflictError();
        },
      },
      validator: allowingValidator(),
    });
    await coordinator.composeCandidate({
      candidateId: candidatePublicationId,
      componentReceipt: replacementReceipt(),
      createdAt: now,
      execution: execution.context,
      fingerprintMaterial: fingerprintMaterial(),
      projectionVersion: 3,
    });

    await expect(
      coordinator.evaluateAndPublishCandidate({
        evaluator: { evaluate: async () => ({ decision: "passed" }) },
        execution: execution.context,
        updatedAt: "2026-07-13T14:02:00.000Z",
      }),
    ).rejects.toBeInstanceOf(DocumentCompilationCandidateLeaseLostError);
    await expect(
      repositories.publications.getPublished({ knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ fingerprint: publishedFingerprint, headRevision: 1 });
  });
});

async function publishedRepositories(attempts?: {
  get(id: string): Promise<DocumentCompilationAttempt | null>;
}) {
  const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
  const members = createInMemoryProjectionSetPublicationMemberRepository({
    attempts,
    maxListLimit: 20,
    maxMembers: 100,
    now: () => Date.parse(now),
    publications,
  });
  await publications.createCandidate({
    createdAt: "2026-07-13T13:00:00.000Z",
    fingerprint: publishedFingerprint,
    id: publishedPublicationId,
    knowledgeSpaceId,
    projectionVersion: 2,
    tenantId,
  });
  const mutation = {
    candidateFingerprint: publishedFingerprint,
    createdAt: "2026-07-13T13:01:00.000Z",
    expectedHeadRevision: 0,
    knowledgeSpaceId,
    tenantId,
  };
  await members.replaceDocumentComponents({
    ...mutation,
    components: [
      {
        componentKey: oldOwnerComponentId,
        componentType: "document-outline",
        generationId: oldGenerationId,
      },
    ],
    documentAssetId,
  });
  await members.replaceDocumentComponents({
    ...mutation,
    components: [
      {
        componentKey: inheritedComponentId,
        componentType: "index-projection",
        generationId: oldGenerationId,
      },
    ],
    documentAssetId: inheritedDocumentAssetId,
  });
  await publications.publish({
    expectedHeadRevision: 0,
    fingerprint: publishedFingerprint,
    knowledgeSpaceId,
    tenantId,
    updatedAt: "2026-07-13T13:02:00.000Z",
  });
  return { members, publications };
}

function allowingValidator() {
  return { validate: vi.fn(async () => undefined) };
}

function replacementComponents(): readonly ProjectionSetPublicationDocumentComponentInput[] {
  return [
    {
      componentKey: replacementProjectionId,
      componentType: "index-projection",
      generationId: publicationGenerationId,
    },
    {
      componentKey: replacementOutlineId,
      componentType: "document-outline",
      generationId: publicationGenerationId,
    },
  ];
}

function replacementReceipt(): DocumentCompilationCandidateComponentReceipt {
  return componentReceipt({
    documentOutlines: [
      { componentKey: replacementOutlineId, generationId: publicationGenerationId },
    ],
    indexProjections: [
      { componentKey: replacementProjectionId, generationId: publicationGenerationId },
    ],
  });
}

function componentReceipt(
  overrides: Partial<DocumentCompilationCandidateComponentReceipt> = {},
): DocumentCompilationCandidateComponentReceipt {
  return {
    documentOutlines: [],
    graphEntities: [],
    graphRelations: [],
    indexProjections: [],
    knowledgePaths: [],
    multimodalManifests: [],
    schemaVersion: 1,
    ...overrides,
  };
}

function fingerprintMaterial() {
  return {
    chunkerVersion: "chunker-v2",
    indexVersion: "index-v3",
    knowledgeSpaceId,
    nodeSchemaVersion: 2,
    parserPolicyVersion: "parser-v2",
    projectionSetVersion: "projection-set-v3",
    projections: [
      {
        indexVersion: "dense-v3",
        model: "plugin-daemon/embedding-user-selected",
        projectionVersion: 3,
        strategy: "dense",
        type: "dense-vector" as const,
      },
    ],
    sourceSnapshots: [
      {
        documentAssetId,
        sha256: "1".repeat(64),
        version: 2,
      },
      {
        documentAssetId: inheritedDocumentAssetId,
        sha256: "2".repeat(64),
        version: 4,
      },
    ],
  };
}

function attempt(overrides: Partial<DocumentCompilationAttempt> = {}): DocumentCompilationAttempt {
  return {
    activeSlot: 1,
    baseHeadRevision: 1,
    checkpoint: "nodes_generated",
    createdAt: "2026-07-13T13:30:00.000Z",
    documentAssetId,
    documentVersion: 2,
    executionAttempts: 1,
    heartbeatAt: "2026-07-13T13:59:00.000Z",
    id: attemptId,
    knowledgeSpaceId,
    leaseExpiresAt: "2026-07-13T14:05:00.000Z",
    leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f3040",
    maxExecutionAttempts: 3,
    publicationGenerationId,
    queueJobId: "queue-1",
    rowVersion: 5,
    runState: "running",
    startedAt: "2026-07-13T13:59:00.000Z",
    tenantId,
    updatedAt: "2026-07-13T13:59:00.000Z",
    workerId: "worker-1",
    ...overrides,
  };
}

function fakeExecution(initial: DocumentCompilationAttempt): {
  readonly advance: ReturnType<typeof vi.fn>;
  readonly context: DocumentCompilationExecutionContext;
  readonly withLeaseSnapshot: ReturnType<typeof vi.fn>;
} {
  let current = initial;
  const controller = new AbortController();
  const heartbeat = vi.fn(async () => {
    current = { ...current, rowVersion: current.rowVersion + 1, updatedAt: now };
    return current;
  });
  const advance = vi.fn(async (input) => {
    current = {
      ...current,
      ...(input.candidateFingerprint ? { candidateFingerprint: input.candidateFingerprint } : {}),
      ...(input.candidatePublicationId
        ? { candidatePublicationId: input.candidatePublicationId }
        : {}),
      checkpoint: input.checkpoint,
      rowVersion: current.rowVersion + 1,
      updatedAt: now,
    };
    return current;
  });
  const withLeaseSnapshot = vi.fn(async (operation) => operation(current));
  const context: DocumentCompilationExecutionContext = {
    get attempt() {
      return current;
    },
    advance,
    bindInitialProfiles: vi.fn(async () => {
      throw new Error("Initial profile binding is not used by publication coordinator tests");
    }),
    heartbeat,
    signal: controller.signal,
    withLeaseSnapshot,
  };
  return { advance, context, withLeaseSnapshot };
}

function indexedUuid(index: number): string {
  return `018f0d60-7a49-7cc2-9c1b-${(0x1_000 + index).toString(16).padStart(12, "0")}`;
}
