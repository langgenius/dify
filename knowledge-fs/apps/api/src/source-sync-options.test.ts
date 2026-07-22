import { describe, expect, it } from "vitest";

import { createApiSourceSyncOptions } from "./source-sync-options";

describe("createApiSourceSyncOptions", () => {
  it("is on by default with built-in tick settings", () => {
    expect(createApiSourceSyncOptions({})).toEqual({
      sourceSync: { intervalMs: 60_000, maxSourcesPerTick: 200 },
    });
  });

  it("is disabled via off/false/0", () => {
    expect(createApiSourceSyncOptions({ KNOWLEDGE_SOURCE_SYNC: "off" })).toBeUndefined();
    expect(createApiSourceSyncOptions({ KNOWLEDGE_SOURCE_SYNC: "FALSE" })).toBeUndefined();
    expect(createApiSourceSyncOptions({ KNOWLEDGE_SOURCE_SYNC: "0" })).toBeUndefined();
  });

  it("parses overrides and fails fast on invalid values", () => {
    expect(
      createApiSourceSyncOptions({
        KNOWLEDGE_SOURCE_SYNC_MAX_SOURCES_PER_TICK: "50",
        KNOWLEDGE_SOURCE_SYNC_TICK_MS: "30000",
      }),
    ).toEqual({ sourceSync: { intervalMs: 30_000, maxSourcesPerTick: 50 } });
    expect(() => createApiSourceSyncOptions({ KNOWLEDGE_SOURCE_SYNC_TICK_MS: "500" })).toThrow(
      "KNOWLEDGE_SOURCE_SYNC_TICK_MS must be an integer of at least 1000",
    );
  });
});
