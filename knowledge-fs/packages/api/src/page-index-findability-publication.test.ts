import { DocumentOutlineSchema, GoldenQuestionSchema } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import type { PageIndexFindabilityEvaluationResult } from "./page-index-findability-evaluation";
import { createPageIndexFindabilityPublicationEvaluator } from "./page-index-findability-publication";
import { createInMemoryPageIndexFindabilityRepository } from "./page-index-findability-repository";

describe("PageIndex publication findability", () => {
  it("persists not-evaluated without creating questions or invoking a model when labels are absent", async () => {
    const evaluate = vi.fn(
      async (): Promise<PageIndexFindabilityEvaluationResult> => result("not-evaluated"),
    );
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 });
    const publication = createPageIndexFindabilityPublicationEvaluator({
      evaluator: { evaluate },
      findability: repository,
      goldenQuestions: { listTrusted: async () => ({ items: [] }) },
      maxEvidenceIds: 20,
      maxQuestions: 10,
      nodes: { getManyByIdsAcrossGenerations: vi.fn(async () => []) },
      outlines: { getByDocumentVersion: async () => outline() },
      profiles: { getRevision: async () => profileRevision() },
    });

    const persisted = await publication.evaluatePublished({
      attempt: attempt(),
      publicationFingerprint: fingerprint(),
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceRanges: [], questions: [], tenantId: "tenant-1" }),
    );
    expect(persisted.evaluation.status).toBe("not-evaluated");
    expect(persisted.summaryRepairState).toBe("not-requested");
  });

  it("loads only exact-generation evidence and durably requests one repair after a failed score", async () => {
    const getManyByIdsAcrossGenerations = vi.fn(async () => [
      node({ generationId: generation(), id: uuid(8) }),
      node({ generationId: uuid(99), id: uuid(9) }),
    ]);
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 });
    const publication = createPageIndexFindabilityPublicationEvaluator({
      evaluator: {
        evaluate: async (input) => {
          expect(input.evidenceRanges).toEqual([
            { documentAssetId: uuid(3), endOffset: 80, evidenceId: uuid(8), startOffset: 20 },
          ]);
          return result("failed");
        },
      },
      findability: repository,
      goldenQuestions: {
        listTrusted: async () => ({
          items: [
            GoldenQuestionSchema.parse({
              createdAt: "2026-08-06T00:00:00.000Z",
              expectedEvidenceIds: [uuid(8), uuid(9)],
              id: uuid(7),
              knowledgeSpaceId: uuid(2),
              metadata: {},
              question: "Where is the invoice total?",
              tags: ["manual"],
              updatedAt: "2026-08-06T00:00:00.000Z",
            }),
          ],
        }),
      },
      maxEvidenceIds: 20,
      maxQuestions: 10,
      nodes: { getManyByIdsAcrossGenerations },
      outlines: { getByDocumentVersion: async () => outline() },
      profiles: { getRevision: async () => profileRevision() },
    });

    const persisted = await publication.evaluatePublished({
      attempt: attempt(),
      publicationFingerprint: fingerprint(),
    });

    expect(getManyByIdsAcrossGenerations).toHaveBeenCalledWith({
      ids: [uuid(8), uuid(9)],
      knowledgeSpaceId: uuid(2),
    });
    expect(persisted.evaluation.summaryRepairRequested).toBe(true);
    expect(persisted.summaryRepairState).toBe("queued");
  });

  it("validates evaluator bounds and frozen publication inputs", async () => {
    const base = publicationOptions();
    expect(() =>
      createPageIndexFindabilityPublicationEvaluator({ ...base, maxEvidenceIds: 0 }),
    ).toThrow("maxEvidenceIds must be a positive integer");
    expect(() =>
      createPageIndexFindabilityPublicationEvaluator({ ...base, maxQuestions: 0 }),
    ).toThrow("maxQuestions must be a positive integer");

    await expect(
      createPageIndexFindabilityPublicationEvaluator(base).evaluatePublished({
        attempt: { ...attempt(), retrievalProfile: undefined },
        publicationFingerprint: fingerprint(),
      }),
    ).rejects.toThrow("requires a frozen retrieval profile");
    await expect(
      createPageIndexFindabilityPublicationEvaluator({
        ...base,
        outlines: { getByDocumentVersion: async () => null },
      }).evaluatePublished({ attempt: attempt(), publicationFingerprint: fingerprint() }),
    ).rejects.toThrow("exact outline generation is unavailable");
    await expect(
      createPageIndexFindabilityPublicationEvaluator({
        ...base,
        profiles: { getRevision: async () => null },
      }).evaluatePublished({ attempt: attempt(), publicationFingerprint: fingerprint() }),
    ).rejects.toThrow("frozen retrieval profile identity changed");
  });

  it("rejects unbounded human evidence labels before loading nodes", async () => {
    const getManyByIdsAcrossGenerations = vi.fn();
    const publication = createPageIndexFindabilityPublicationEvaluator({
      ...publicationOptions(),
      goldenQuestions: {
        listTrusted: async () => ({
          items: [
            GoldenQuestionSchema.parse({
              createdAt: "2026-08-06T00:00:00.000Z",
              expectedEvidenceIds: [uuid(8), uuid(9)],
              id: uuid(7),
              knowledgeSpaceId: uuid(2),
              metadata: {},
              question: "Where is the invoice total?",
              tags: ["manual"],
              updatedAt: "2026-08-06T00:00:00.000Z",
            }),
          ],
        }),
      },
      maxEvidenceIds: 1,
      nodes: { getManyByIdsAcrossGenerations },
    });

    await expect(
      publication.evaluatePublished({ attempt: attempt(), publicationFingerprint: fingerprint() }),
    ).rejects.toThrow("expected evidence exceeds maxEvidenceIds=1");
    expect(getManyByIdsAcrossGenerations).not.toHaveBeenCalled();
  });
});

function publicationOptions(): Parameters<
  typeof createPageIndexFindabilityPublicationEvaluator
>[0] {
  return {
    evaluator: { evaluate: async () => result("passed") },
    findability: createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 }),
    goldenQuestions: { listTrusted: async () => ({ items: [] }) },
    maxEvidenceIds: 20,
    maxQuestions: 10,
    nodes: { getManyByIdsAcrossGenerations: async () => [] },
    outlines: { getByDocumentVersion: async () => outline() },
    profiles: { getRevision: async () => profileRevision() },
  };
}

function result(
  status: "failed" | "not-evaluated" | "passed",
): PageIndexFindabilityEvaluationResult {
  return {
    abstentionRate: status === "failed" ? 1 : 0,
    evaluatorVersion: "findability-v1",
    meanReciprocalRank: status === "passed" ? 1 : 0,
    model: { model: "reasoner-v1", pluginId: "plugin-1", provider: "provider-1" },
    pathRecallAtK: status === "passed" ? 1 : 0,
    promptVersion: "pageindex-layered-tree-search-v1",
    recallAtK: status === "passed" ? 1 : 0,
    recommendedRoute:
      status === "passed" ? "layered" : status === "failed" ? "hybrid" : "unchanged",
    sampleCount: status === "not-evaluated" ? 0 : 1,
    status,
    summaryRepairRequested: false,
    topK: 3,
  };
}

function attempt(): DocumentCompilationAttempt {
  return {
    baseHeadRevision: 0,
    capabilityGrantId: uuid(10),
    candidateFingerprint: fingerprint(),
    candidatePublicationId: uuid(5),
    checkpoint: "smoke_eval_passed",
    createdAt: "2026-08-06T00:00:00.000Z",
    documentAssetId: uuid(3),
    documentVersion: 1,
    executionAttempts: 1,
    id: uuid(6),
    knowledgeSpaceId: uuid(2),
    maxExecutionAttempts: 3,
    publicationGenerationId: generation(),
    retrievalProfile: {
      kind: "retrieval",
      revision: 2,
      revisionId: uuid(11),
      snapshotDigest: `sha256:${"b".repeat(64)}`,
    },
    rowVersion: 4,
    runState: "running",
    tenantId: "tenant-1",
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

function outline() {
  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-06T00:00:00.000Z",
    documentAssetId: uuid(3),
    id: uuid(4),
    knowledgeSpaceId: uuid(2),
    metadata: {},
    nodes: [],
    outlineVersion: "outline-v1",
    parseArtifactId: uuid(12),
    publicationGenerationId: generation(),
    version: 1,
  });
}

function profileRevision() {
  return {
    capabilitySnapshot: {},
    capabilitySnapshotDigest: `sha256:${"c".repeat(64)}`,
    createdAt: "2026-08-06T00:00:00.000Z",
    createdBySubjectId: "user-1",
    id: uuid(11),
    kind: "retrieval" as const,
    knowledgeSpaceId: uuid(2),
    model: "reasoner-v1",
    pluginId: "plugin-1",
    provider: "provider-1",
    revision: 2,
    snapshot: {
      defaultMode: "research" as const,
      reasoningModel: { model: "reasoner-v1", pluginId: "plugin-1", provider: "provider-1" },
      rerank: { enabled: false },
      revision: 2,
      scoreThreshold: { enabled: false, stage: "mode-final" as const },
      topK: 10,
    },
    snapshotDigest: `sha256:${"b".repeat(64)}`,
    state: "active" as const,
    tenantId: "tenant-1",
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

function node(input: { readonly generationId: string; readonly id: string }) {
  return {
    artifactHash: "a".repeat(64),
    documentAssetId: uuid(3),
    endOffset: 80,
    id: input.id,
    kind: "chunk" as const,
    knowledgeSpaceId: uuid(2),
    metadata: {},
    parseArtifactId: uuid(12),
    permissionScope: [],
    publicationGenerationId: input.generationId,
    sourceLocation: { endOffset: 80, sectionPath: ["Invoice"], startOffset: 20 },
    startOffset: 20,
    text: "invoice total",
  };
}

function fingerprint(): string {
  return `projection-set-sha256:${"a".repeat(64)}`;
}

function generation(): string {
  return uuid(13);
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}
