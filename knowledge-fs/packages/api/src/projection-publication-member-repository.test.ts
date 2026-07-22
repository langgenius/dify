import { PUBLICATION_GENERATION_ID_SENTINEL } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import {
  ProjectionSetPublicationMemberAttemptFenceConflictError,
  ProjectionSetPublicationMemberCapacityExceededError,
  ProjectionSetPublicationMemberIdentityConflictError,
  createInMemoryProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import {
  ProjectionSetPublicationHeadConflictError,
  ProjectionSetPublicationNotFoundError,
  ProjectionSetPublicationTransitionError,
  createInMemoryProjectionSetPublicationRepository,
} from "./projection-publication-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const otherKnowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const fingerprintA = `projection-set-sha256:${"a".repeat(64)}`;
const fingerprintB = `projection-set-sha256:${"b".repeat(64)}`;
const fingerprintC = `projection-set-sha256:${"c".repeat(64)}`;
const publicationIdA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const publicationIdB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const publicationIdC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const documentIdA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const documentIdB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const generationA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const generationB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02";
const generationC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03";
const componentA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01";
const componentB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02";
const componentC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03";
const componentD = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f04";
const componentE = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f05";
const componentF = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f06";

describe("in-memory projection publication member repository", () => {
  it("checks a bounded set of component keys without loading the publication", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 2,
      maxMembers: 100,
      publications,
    });
    await publications.createCandidate(candidate(fingerprintA, publicationIdA));
    await members.replaceCandidateComponents({
      ...mutation(fingerprintA, 0),
      componentType: "index-projection",
      components: [{ componentKey: componentA, generationId: generationA }],
    });
    await members.replaceCandidateComponents({
      ...mutation(fingerprintA, 0),
      componentType: "knowledge-path",
      components: [{ componentKey: componentB, generationId: generationA }],
    });

    await expect(
      members.filterComponentKeys({
        componentKeys: [componentA, componentB],
        componentType: "index-projection",
        knowledgeSpaceId,
        publicationId: publicationIdA,
        tenantId,
      }),
    ).resolves.toEqual([componentA]);
    await expect(
      members.filterComponentKeys({
        componentKeys: [componentA, componentB, componentC],
        componentType: "index-projection",
        knowledgeSpaceId,
        publicationId: publicationIdA,
        tenantId,
      }),
    ).rejects.toThrow("batch exceeds maxBatchSize=2");
  });

  it("inherits the published set with exclusions and remains idempotent across redelivery", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 20,
      maxMembers: 100,
      publications,
    });
    await publications.createCandidate(candidate(fingerprintA, publicationIdA));
    await members.replaceCandidateComponents({
      ...mutation(fingerprintA, 0),
      componentType: "index-projection",
      components: [
        { componentKey: componentA, documentAssetId: documentIdA, generationId: generationA },
        {
          componentKey: componentB,
          documentAssetId: documentIdA,
          generationId: generationB,
        },
        {
          componentKey: componentC,
          documentAssetId: documentIdB,
          generationId: generationC,
        },
      ],
    });
    await members.replaceCandidateComponents({
      ...mutation(fingerprintA, 0),
      componentType: "knowledge-path",
      components: [{ componentKey: componentD, generationId: generationA }],
    });
    await publications.publish({
      ...transition(fingerprintA),
      expectedHeadRevision: 0,
    });
    await publications.createCandidate(candidate(fingerprintB, publicationIdB));

    await expect(
      members.inheritFromPublished({
        ...mutation(fingerprintB, 1),
        excludedComponentKeys: [componentB, componentB],
        excludedDocumentAssetId: documentIdB,
      }),
    ).resolves.toBe(2);
    await expect(
      members.inheritFromPublished({
        ...mutation(fingerprintB, 1),
        excludedComponentKeys: [componentB],
        excludedDocumentAssetId: documentIdB,
      }),
    ).resolves.toBe(0);

    const inherited = await members.listByFingerprint({
      fingerprint: fingerprintB,
      knowledgeSpaceId,
      tenantId,
    });
    expect(inherited).toEqual([
      expect.objectContaining({
        componentKey: componentA,
        componentType: "index-projection",
        generationId: generationA,
        publicationId: publicationIdB,
      }),
      expect.objectContaining({
        componentKey: componentD,
        componentType: "knowledge-path",
        generationId: generationA,
        publicationId: publicationIdB,
      }),
    ]);
    await expect(
      members.listByPublication({
        fingerprint: fingerprintB,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual(inherited);
  });

  it("atomically replaces candidate-wide and document-wide component memberships", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 20,
      maxMembers: 100,
      publications,
    });
    await publications.createCandidate(candidate(fingerprintA, publicationIdA));
    await members.replaceCandidateComponents({
      ...mutation(fingerprintA, 0),
      componentType: "index-projection",
      components: [
        { componentKey: componentA, documentAssetId: documentIdA, generationId: generationA },
        { componentKey: componentB, documentAssetId: documentIdB, generationId: generationA },
      ],
    });

    await expect(
      members.replaceDocumentComponents({
        ...mutation(fingerprintA, 0),
        components: [
          {
            componentKey: componentC,
            componentType: "document-outline",
            generationId: generationB,
          },
          {
            componentKey: componentD,
            componentType: "multimodal-manifest",
            generationId: generationB,
          },
          {
            componentKey: componentC,
            componentType: "document-outline",
            generationId: generationB,
          },
        ],
        documentAssetId: documentIdA,
      }),
    ).resolves.toBe(2);

    let current = await members.listByFingerprint({
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
    });
    expect(current.map((member) => member.componentKey)).toEqual([
      componentC,
      componentB,
      componentD,
    ]);

    await expect(
      members.replaceCandidateComponents({
        ...mutation(fingerprintA, 0),
        componentType: "index-projection",
        components: [{ componentKey: componentE, generationId: generationC }],
      }),
    ).resolves.toBe(1);
    current = await members.listByFingerprint({
      fingerprint: fingerprintA,
      knowledgeSpaceId,
      tenantId,
    });
    expect(current.map((member) => member.componentKey)).toEqual([
      componentC,
      componentE,
      componentD,
    ]);
  });

  it("atomically rebuilds an exclusive candidate from published members and a complete document", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const fence = attemptFence(publicationIdB, generationC);
    const attemptState = mutableAttempt(memoryAttempt(fence, fingerprintB, 1));
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      attempts: attemptState,
      maxListLimit: 20,
      maxMembers: 100,
      now: () => Date.parse("2026-07-13T12:01:00.000Z"),
      publications,
    });
    await publications.createCandidate(candidate(fingerprintA, publicationIdA));
    await members.replaceDocumentComponents({
      ...mutation(fingerprintA, 0),
      components: [
        {
          componentKey: componentA,
          componentType: "document-outline",
          generationId: generationA,
        },
      ],
      documentAssetId: documentIdA,
    });
    await members.replaceDocumentComponents({
      ...mutation(fingerprintA, 0),
      components: [
        {
          componentKey: componentB,
          componentType: "document-outline",
          generationId: generationB,
        },
      ],
      documentAssetId: documentIdB,
    });
    await publications.publish({ ...transition(fingerprintA), expectedHeadRevision: 0 });
    await publications.createCandidate(candidate(fingerprintB, publicationIdB));

    await expect(
      members.composeDocumentCandidate({
        ...mutation(fingerprintB, 1),
        attemptFence: fence,
        components: [
          {
            componentKey: componentC,
            componentType: "document-outline",
            generationId: generationC,
          },
          {
            componentKey: componentD,
            componentType: "multimodal-manifest",
            generationId: generationC,
          },
        ],
        documentAssetId: documentIdA,
      }),
    ).resolves.toEqual({ inherited: 1, replaced: 2 });

    await expect(
      members.listByFingerprint({ fingerprint: fingerprintB, knowledgeSpaceId, tenantId }),
    ).resolves.toEqual([
      expect.objectContaining({
        componentKey: componentB,
        documentAssetId: documentIdB,
        generationId: generationB,
      }),
      expect.objectContaining({
        componentKey: componentC,
        documentAssetId: documentIdA,
        generationId: generationC,
      }),
      expect.objectContaining({
        componentKey: componentD,
        documentAssetId: documentIdA,
        generationId: generationC,
      }),
    ]);

    await expect(
      members.composeDocumentCandidate({
        ...mutation(fingerprintB, 1),
        attemptFence: fence,
        components: [
          {
            componentKey: componentE,
            componentType: "knowledge-path",
            generationId: generationC,
          },
        ],
        documentAssetId: documentIdA,
      }),
    ).resolves.toEqual({ inherited: 1, replaced: 1 });
    await expect(
      members.listByFingerprint({ fingerprint: fingerprintB, knowledgeSpaceId, tenantId }),
    ).resolves.toEqual([
      expect.objectContaining({ componentKey: componentB, documentAssetId: documentIdB }),
      expect.objectContaining({ componentKey: componentE, documentAssetId: documentIdA }),
    ]);

    attemptState.current = {
      ...attemptState.current,
      activeSlot: undefined,
      leaseExpiresAt: undefined,
      leaseToken: undefined,
      runState: "retry_wait",
    };
    await expect(
      members.composeDocumentCandidate({
        ...mutation(fingerprintB, 1),
        attemptFence: fence,
        components: [],
        documentAssetId: documentIdA,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberAttemptFenceConflictError);
    await expect(
      members.listByFingerprint({ fingerprint: fingerprintB, knowledgeSpaceId, tenantId }),
    ).resolves.toEqual([
      expect.objectContaining({ componentKey: componentB, documentAssetId: documentIdB }),
      expect.objectContaining({ componentKey: componentE, documentAssetId: documentIdA }),
    ]);
  });

  it("enforces head CAS, candidate status, tenant-space scope, and identity ownership", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 20,
      maxMembers: 100,
      publications,
    });
    await publications.createCandidate(candidate(fingerprintA, publicationIdA));
    await publications.publish({ ...transition(fingerprintA), expectedHeadRevision: 0 });
    await publications.createCandidate(candidate(fingerprintB, publicationIdB));

    await expect(
      members.replaceCandidateComponents({
        ...mutation(fingerprintB, 0),
        componentType: "index-projection",
        components: [],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);
    await expect(
      members.replaceCandidateComponents({
        ...mutation(fingerprintA, 1),
        componentType: "index-projection",
        components: [],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);
    await expect(
      members.replaceCandidateComponents({
        ...mutation(fingerprintB, 0, otherKnowledgeSpaceId),
        componentType: "index-projection",
        components: [],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationNotFoundError);
    await expect(
      members.replaceCandidateComponents({
        ...mutation(fingerprintB, 1),
        componentType: "index-projection",
        components: [
          { componentKey: componentA, documentAssetId: documentIdA, generationId: generationA },
          { componentKey: componentA, documentAssetId: documentIdA, generationId: generationB },
        ],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberIdentityConflictError);
    await expect(
      members.replaceCandidateComponents({
        ...mutation(fingerprintB, 1),
        componentType: "index-projection",
        components: [
          {
            componentKey: componentA,
            generationId: PUBLICATION_GENERATION_ID_SENTINEL,
          },
        ],
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");
    await expect(
      members.replaceDocumentComponents({
        ...mutation(fingerprintB, 1),
        components: [
          {
            componentKey: componentA,
            componentType: "document-outline",
            generationId: PUBLICATION_GENERATION_ID_SENTINEL,
          },
        ],
        documentAssetId: documentIdA,
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");
  });

  it("does not reassign an inherited component key to another document generation", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      maxListLimit: 20,
      maxMembers: 100,
      publications,
    });
    await publications.createCandidate(candidate(fingerprintA, publicationIdA));
    await members.replaceCandidateComponents({
      ...mutation(fingerprintA, 0),
      componentType: "document-outline",
      components: [
        { componentKey: componentA, documentAssetId: documentIdB, generationId: generationA },
      ],
    });

    await expect(
      members.replaceDocumentComponents({
        ...mutation(fingerprintA, 0),
        components: [
          {
            componentKey: componentA,
            componentType: "document-outline",
            generationId: generationB,
          },
        ],
        documentAssetId: documentIdA,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberIdentityConflictError);
    await expect(
      members.listByFingerprint({ fingerprint: fingerprintA, knowledgeSpaceId, tenantId }),
    ).resolves.toEqual([
      expect.objectContaining({
        componentKey: componentA,
        documentAssetId: documentIdB,
        generationId: generationA,
      }),
    ]);
  });

  it("fails capacity replacement without partially deleting the previous generation", async () => {
    const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
    const fence = attemptFence(publicationIdC, generationB);
    const members = createInMemoryProjectionSetPublicationMemberRepository({
      attempts: mutableAttempt(memoryAttempt(fence, fingerprintC, 0)),
      maxListLimit: 10,
      maxMembers: 1,
      now: () => Date.parse("2026-07-13T12:01:00.000Z"),
      publications,
    });
    await publications.createCandidate(candidate(fingerprintC, publicationIdC));
    await members.replaceCandidateComponents({
      ...mutation(fingerprintC, 0),
      componentType: "index-projection",
      components: [{ componentKey: componentF, generationId: generationA }],
    });

    await expect(
      members.replaceDocumentComponents({
        ...mutation(fingerprintC, 0),
        components: [
          {
            componentKey: componentA,
            componentType: "document-outline",
            generationId: generationB,
          },
        ],
        documentAssetId: documentIdA,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberCapacityExceededError);
    await expect(
      members.listByFingerprint({
        fingerprint: fingerprintC,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual([expect.objectContaining({ componentKey: componentF })]);

    await expect(
      members.composeDocumentCandidate({
        ...mutation(fingerprintC, 0),
        attemptFence: fence,
        components: [
          {
            componentKey: componentA,
            componentType: "document-outline",
            generationId: generationB,
          },
          {
            componentKey: componentB,
            componentType: "multimodal-manifest",
            generationId: generationB,
          },
        ],
        documentAssetId: documentIdA,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberCapacityExceededError);
    await expect(
      members.listByFingerprint({
        fingerprint: fingerprintC,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual([expect.objectContaining({ componentKey: componentF })]);
  });
});

function candidate(fingerprint: string, id: string) {
  return {
    createdAt: "2026-07-13T12:00:00.000Z",
    fingerprint,
    id,
    knowledgeSpaceId,
    projectionVersion: 1,
    tenantId,
  };
}

function mutation(fingerprint: string, expectedHeadRevision: number, spaceId = knowledgeSpaceId) {
  return {
    candidateFingerprint: fingerprint,
    createdAt: "2026-07-13T12:01:00.000Z",
    expectedHeadRevision,
    knowledgeSpaceId: spaceId,
    tenantId,
  };
}

function transition(fingerprint: string) {
  return {
    fingerprint,
    knowledgeSpaceId,
    tenantId,
    updatedAt: "2026-07-13T12:02:00.000Z",
  };
}

function attemptFence(candidatePublicationId: string, publicationGenerationId: string) {
  return {
    attemptId,
    candidatePublicationId,
    documentVersion: 2,
    expectedRowVersion: 7,
    leaseToken,
    publicationGenerationId,
  };
}

function memoryAttempt(
  fence: ReturnType<typeof attemptFence>,
  candidateFingerprint: string,
  baseHeadRevision: number,
): DocumentCompilationAttempt {
  return {
    activeSlot: 1,
    baseHeadRevision,
    candidateFingerprint,
    candidatePublicationId: fence.candidatePublicationId,
    checkpoint: "nodes_generated",
    createdAt: "2026-07-13T11:55:00.000Z",
    documentAssetId: documentIdA,
    documentVersion: fence.documentVersion,
    executionAttempts: 1,
    heartbeatAt: "2026-07-13T12:00:00.000Z",
    id: fence.attemptId,
    knowledgeSpaceId,
    leaseExpiresAt: "2026-07-13T12:05:00.000Z",
    leaseToken: fence.leaseToken,
    maxExecutionAttempts: 3,
    publicationGenerationId: fence.publicationGenerationId,
    queueJobId: "queue-1",
    rowVersion: fence.expectedRowVersion,
    runState: "running",
    startedAt: "2026-07-13T12:00:00.000Z",
    tenantId,
    updatedAt: "2026-07-13T12:00:00.000Z",
    workerId: "worker-1",
  };
}

function mutableAttempt(initial: DocumentCompilationAttempt): {
  current: DocumentCompilationAttempt;
  get(id: string): Promise<DocumentCompilationAttempt | null>;
} {
  return {
    current: initial,
    async get(id) {
      return id === this.current.id ? { ...this.current } : null;
    },
  };
}
