import { describe, expect, it, vi } from "vitest";

import { createApiResearchTaskDirectStreamAssembly } from "./direct-stream-options";

describe("API Research stream options", () => {
  it("keeps the Dify API-to-KFS stream disabled unless rollout is explicit", () => {
    expect(createApiResearchTaskDirectStreamAssembly({ env: {} })).toBeUndefined();
    expect(
      createApiResearchTaskDirectStreamAssembly({
        env: { KNOWLEDGE_DIRECT_STREAM_ENABLED: "off" },
      }),
    ).toBeUndefined();
  });

  it("parses a bounded connection lifetime", () => {
    const assembly = createApiResearchTaskDirectStreamAssembly({
      env: {
        KNOWLEDGE_DIRECT_STREAM_ENABLED: "on",
        KNOWLEDGE_DIRECT_STREAM_MAX_CONNECTION_MS: "120000",
      },
    });

    expect(assembly?.options).toMatchObject({
      maxConnectionMs: 120_000,
    });
  });

  it("fails fast on invalid enablement or an unbounded lifetime", () => {
    expect(() =>
      createApiResearchTaskDirectStreamAssembly({
        env: { KNOWLEDGE_DIRECT_STREAM_ENABLED: "maybe" },
      }),
    ).toThrow("KNOWLEDGE_DIRECT_STREAM_ENABLED");
    expect(() =>
      createApiResearchTaskDirectStreamAssembly({
        env: {
          KNOWLEDGE_DIRECT_STREAM_ENABLED: "on",
          KNOWLEDGE_DIRECT_STREAM_MAX_CONNECTION_MS: "3600001",
        },
      }),
    ).toThrow("KNOWLEDGE_DIRECT_STREAM_MAX_CONNECTION_MS");
  });

  it("tracks bounded open/close counters and emits one lifecycle metric per callback", () => {
    const emit = vi.fn();
    const assembly = createApiResearchTaskDirectStreamAssembly({
      emit,
      env: {
        KNOWLEDGE_DIRECT_STREAM_ENABLED: "on",
      },
    });
    const scope = {
      reconnected: true,
      researchTaskJobId: "task-secret",
      tenantId: "tenant-secret",
    };

    assembly?.options.observer?.onOpen?.(scope);
    assembly?.options.observer?.onClose?.({ ...scope, reason: "terminal" });
    assembly?.options.observer?.onClose?.({ ...scope, reason: "disconnect" });

    expect(assembly?.snapshot()).toEqual({
      activeConnections: 0,
      closedTotal: 2,
      closeReasons: {
        disconnect: 1,
        error: 0,
        limit: 0,
        permission_revoked: 0,
        terminal: 1,
        timeout: 0,
      },
      openedTotal: 1,
      reconnectedTotal: 1,
    });
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        activeConnections: 0,
        event: "knowledge_fs.research_direct_stream.closed",
        reason: "terminal",
      }),
    );
    expect(emit).toHaveBeenNthCalledWith(1, {
      activeConnections: 1,
      connection: "reconnect",
      event: "knowledge_fs.research_direct_stream.opened",
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain("tenant-secret");
    expect(JSON.stringify(emit.mock.calls)).not.toContain("task-secret");
  });
});
