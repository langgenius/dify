import { describe, expect, it, vi } from "vitest";

import {
  DocumentCompilationProfileSnapshotError,
  loadDocumentCompilationFrozenProfiles,
} from "./document-compilation-profile-snapshot";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f1800101";
const retrievalRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f1800102";
const retrievalDigest = "b".repeat(64);

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
    ).resolves.toEqual({ retrievalProfile: retrievalSnapshot() });
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
});

function retrievalReference() {
  return {
    kind: "retrieval" as const,
    revision: 3,
    revisionId: retrievalRevisionId,
    snapshotDigest: retrievalDigest,
  };
}

function retrievalRevision(state: "active" | "candidate" | "failed" | "superseded") {
  return {
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
