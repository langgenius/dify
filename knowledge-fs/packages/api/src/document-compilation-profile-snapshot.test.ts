import { describe, expect, it, vi } from "vitest";

import {
  DocumentCompilationProfileSnapshotError,
  loadDocumentCompilationFrozenProfiles,
} from "./document-compilation-profile-snapshot";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f1800101";
const retrievalRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f1800102";
const embeddingRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f1800103";
const retrievalDigest = "b".repeat(64);
const embeddingDigest = "d".repeat(64);

describe("document compilation frozen profiles", () => {
  it("supports a Research-only attempt and loads its superseded immutable retrieval revision", async () => {
    const getRevision = vi.fn(async () => retrievalRevision("superseded"));

    await expect(
      loadDocumentCompilationFrozenProfiles(
        { getRevision: getRevision as never },
        {
          knowledgeSpaceId,
          retrievalProfile: retrievalReference(),
          tenantId,
        },
      ),
    ).resolves.toEqual({
      reasoningCapabilitySnapshot: reasoningCapabilitySnapshot(),
      retrievalProfile: retrievalSnapshot(),
    });
    expect(getRevision).toHaveBeenCalledTimes(1);
    expect(getRevision).toHaveBeenCalledWith({
      kind: "retrieval",
      knowledgeSpaceId,
      revision: 3,
      tenantId,
    });
  });

  it.each(["candidate", "failed"] as const)(
    "rejects a frozen revision in the %s state",
    async (state) => {
      await expect(
        loadDocumentCompilationFrozenProfiles(
          { getRevision: (async () => retrievalRevision(state)) as never },
          { knowledgeSpaceId, retrievalProfile: retrievalReference(), tenantId },
        ),
      ).rejects.toBeInstanceOf(DocumentCompilationProfileSnapshotError);
    },
  );

  it("keeps legacy embedding profiles usable while failing closed on an invalid image capability", async () => {
    const getRevision = vi.fn(async ({ kind }) =>
      kind === "embedding" ? embeddingRevision() : retrievalRevision("active"),
    );

    await expect(
      loadDocumentCompilationFrozenProfiles(
        { getRevision: getRevision as never },
        {
          embeddingProfile: {
            kind: "embedding",
            revision: 2,
            revisionId: embeddingRevisionId,
            snapshotDigest: embeddingDigest,
          },
          knowledgeSpaceId,
          retrievalProfile: retrievalReference(),
          tenantId,
        },
      ),
    ).resolves.toEqual({
      embeddingProfile: embeddingSnapshot(),
      reasoningCapabilitySnapshot: reasoningCapabilitySnapshot(),
      retrievalProfile: retrievalSnapshot(),
    });
  });
});

function retrievalReference() {
  return {
    kind: "retrieval" as const,
    revision: 3,
    revisionId: retrievalRevisionId,
    snapshotDigest: retrievalDigest,
  };
}

function reasoningCapabilitySnapshot() {
  return {
    capabilityDigest: `sha256:${"a".repeat(64)}`,
    checkedAt: "2026-09-01T00:00:00.000Z",
    inputModalities: ["text", "image"] as const,
    kind: "reasoning" as const,
    pluginUniqueIdentifier: "reasoning-plugin@1",
    schemaFingerprint: `sha256:${"c".repeat(64)}`,
    selection: retrievalSnapshot().reasoningModel,
  };
}

function retrievalRevision(state: "active" | "candidate" | "failed" | "superseded") {
  return {
    capabilitySnapshot: { reasoning: reasoningCapabilitySnapshot() },
    id: retrievalRevisionId,
    kind: "retrieval" as const,
    knowledgeSpaceId,
    revision: 3,
    snapshot: retrievalSnapshot(),
    snapshotDigest: retrievalDigest,
    state,
    tenantId,
  };
}

function embeddingRevision() {
  return {
    capabilitySnapshot: { source: "legacy-preflight" },
    id: embeddingRevisionId,
    kind: "embedding" as const,
    knowledgeSpaceId,
    revision: 2,
    snapshot: embeddingSnapshot(),
    snapshotDigest: embeddingDigest,
    state: "active" as const,
    tenantId,
  };
}

function embeddingSnapshot() {
  return {
    dimension: 768,
    model: "embedding-model",
    pluginId: "embedding-plugin",
    provider: "embedding-provider",
    revision: 2,
    vectorSpaceId: `embedding-space-sha256:${"e".repeat(64)}`,
  };
}

function retrievalSnapshot() {
  return {
    defaultMode: "research" as const,
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "reasoning-plugin",
      provider: "reasoning-provider",
    },
    rerank: { enabled: false },
    revision: 3,
    scoreThreshold: { enabled: false, stage: "mode-final" as const },
    topK: 8,
  };
}
