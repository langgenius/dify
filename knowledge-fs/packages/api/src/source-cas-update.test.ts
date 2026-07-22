import { describe, expect, it } from "vitest";

import { updateSourceWithRetry } from "./source-cas-update";
import { SourceVersionConflictError, createInMemorySourceRepository } from "./source-repository";

const SPACE = "10000000-0000-4000-8000-000000000001";

describe("updateSourceWithRetry", () => {
  it("retries on a version conflict and preserves the concurrent writer's changes", async () => {
    const repository = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    const source = await repository.create({
      knowledgeSpaceId: SPACE,
      metadata: { keep: "original" },
      name: "a",
      type: "web",
      uri: "u",
    });

    // Simulate another replica writing between our read and our CAS write: the first merge
    // invocation sneaks in a concurrent update, so our first CAS attempt conflicts.
    let interfered = false;
    const result = await updateSourceWithRetry({
      id: source.id,
      knowledgeSpaceId: SPACE,
      merge: (fresh) => {
        if (!interfered) {
          interfered = true;
          void repository.update({
            id: source.id,
            knowledgeSpaceId: SPACE,
            metadata: { ...fresh.metadata, concurrent: "yes" },
          });
        }

        return { ...fresh.metadata, mine: "yes" };
      },
      sources: repository,
    });

    // The retry re-read fresh metadata, so BOTH writes survive.
    expect(result?.metadata).toMatchObject({ concurrent: "yes", keep: "original", mine: "yes" });
  });

  it("returns null for a missing source and surfaces persistent conflicts", async () => {
    const repository = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });

    await expect(
      updateSourceWithRetry({
        id: "00000000-0000-4000-8000-00000000dead",
        knowledgeSpaceId: SPACE,
        merge: (fresh) => fresh.metadata,
        sources: repository,
      }),
    ).resolves.toBeNull();

    const source = await repository.create({
      knowledgeSpaceId: SPACE,
      name: "a",
      type: "web",
      uri: "u",
    });
    // Every merge invocation triggers a fresh concurrent write -> conflicts never resolve.
    await expect(
      updateSourceWithRetry({
        id: source.id,
        knowledgeSpaceId: SPACE,
        maxAttempts: 2,
        merge: (fresh) => {
          void repository.update({
            id: source.id,
            knowledgeSpaceId: SPACE,
            metadata: { ...fresh.metadata },
          });

          return fresh.metadata;
        },
        sources: repository,
      }),
    ).rejects.toThrow(SourceVersionConflictError);
  });

  it("rethrows non-conflict errors immediately", async () => {
    const repository = createInMemorySourceRepository({
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    const source = await repository.create({
      knowledgeSpaceId: SPACE,
      name: "a",
      type: "web",
      uri: "u",
    });
    const failing = {
      ...repository,
      update: async () => {
        throw new Error("database down");
      },
    };

    await expect(
      updateSourceWithRetry({
        id: source.id,
        knowledgeSpaceId: SPACE,
        merge: (fresh) => fresh.metadata,
        sources: failing,
      }),
    ).rejects.toThrow("database down");
  });
});
