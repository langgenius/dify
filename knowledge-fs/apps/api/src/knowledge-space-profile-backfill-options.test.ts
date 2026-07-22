import type { KnowledgeSpaceProfileBackfillRepository } from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import { createApiKnowledgeSpaceProfileBackfillAssembly } from "./knowledge-space-profile-backfill-options";

describe("createApiKnowledgeSpaceProfileBackfillAssembly", () => {
  it("is disabled without the durable repository and validates bounds", () => {
    expect(createApiKnowledgeSpaceProfileBackfillAssembly({})).toBeUndefined();
    expect(() =>
      createApiKnowledgeSpaceProfileBackfillAssembly({ repository: repository() }),
    ).toThrow("requires model preflight");
    expect(() =>
      createApiKnowledgeSpaceProfileBackfillAssembly({
        env: { KNOWLEDGE_PROFILE_BACKFILL_INTERVAL_MS: "0" },
        ...dependencies(),
        repository: repository(),
      }),
    ).toThrow("KNOWLEDGE_PROFILE_BACKFILL_INTERVAL_MS");
  });

  it("runs one immediate bounded tick and can be stopped", async () => {
    vi.useFakeTimers();
    const discover = vi.fn(async () => ({ bindingCandidates: [], created: 0, scanned: 0 }));
    const claim = vi.fn(async () => []);
    const assembly = createApiKnowledgeSpaceProfileBackfillAssembly({
      env: { KNOWLEDGE_PROFILE_BACKFILL_INTERVAL_MS: "1000" },
      ...dependencies(),
      repository: repository({ claim, discover }),
    });
    assembly?.start();
    await vi.runOnlyPendingTimersAsync();
    expect(discover).toHaveBeenCalled();
    expect(claim).toHaveBeenCalled();
    assembly?.stop();
    vi.useRealTimers();
  });
});

function dependencies() {
  return {
    preflight: { verify: vi.fn() } as never,
    publicationBindings: { bindCurrentPublished: vi.fn() } as never,
  };
}

function repository(
  overrides: Partial<KnowledgeSpaceProfileBackfillRepository> = {},
): KnowledgeSpaceProfileBackfillRepository {
  return {
    claim: async () => [],
    discover: async () => ({ bindingCandidates: [], created: 0, scanned: 0 }),
    fail: async () => null,
    get: async () => null,
    heartbeat: async () => null,
    process: async () => {
      throw new Error("not used");
    },
    release: async () => null,
    retry: async () => null,
    ...overrides,
  };
}
