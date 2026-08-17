import { describe, expect, it } from "vitest";

import { createInMemoryDocumentSemanticWindowCheckpointRepository } from "./document-semantic-window-checkpoint-repository";

const scope = {
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  documentVersion: 1,
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
  publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  tenantId: "tenant-1",
};
const checkpoint = {
  completion: { actualModel: "reasoner-v1", finishReason: "stop" },
  inputFingerprint: `sha256:${"a".repeat(64)}`,
  modelFingerprint: `sha256:${"b".repeat(64)}`,
  responseText: '{"chunks":[]}',
  windowId: "window-000001",
};

describe("document semantic window checkpoint repository", () => {
  it("replays exact immutable model output and returns defensive copies", async () => {
    const repository = createInMemoryDocumentSemanticWindowCheckpointRepository();
    const stored = await repository.put({ checkpoint, scope });
    (stored.completion as { actualModel?: string }).actualModel = "mutated";

    await expect(
      repository.get({
        key: { inputFingerprint: checkpoint.inputFingerprint, windowId: checkpoint.windowId },
        scope,
      }),
    ).resolves.toEqual(checkpoint);
    await expect(repository.put({ checkpoint, scope })).resolves.toEqual(checkpoint);
  });

  it("rejects a different response for the same deterministic window key", async () => {
    const repository = createInMemoryDocumentSemanticWindowCheckpointRepository();
    await repository.put({ checkpoint, scope });

    await expect(
      repository.put({ checkpoint: { ...checkpoint, responseText: '{"chunks":[{}]}' }, scope }),
    ).rejects.toThrow("different model output");
  });
});
