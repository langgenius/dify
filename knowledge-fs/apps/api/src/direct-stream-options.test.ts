import { describe, expect, it, vi } from "vitest";

import { createApiResearchTaskDirectStreamAssembly } from "./direct-stream-options";

describe("API Research direct-stream options", () => {
  it("keeps browser-to-KFS streaming disabled unless rollout is explicit", () => {
    expect(createApiResearchTaskDirectStreamAssembly({ env: {} })).toBeUndefined();
    expect(
      createApiResearchTaskDirectStreamAssembly({
        env: { KNOWLEDGE_DIRECT_STREAM_ENABLED: "off" },
      }),
    ).toBeUndefined();
  });

  it("parses exact Dify origins and a bounded connection lifetime", () => {
    const assembly = createApiResearchTaskDirectStreamAssembly({
      env: {
        KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS:
          "https://console.example.com,http://localhost:3000,https://console.example.com",
        KNOWLEDGE_DIRECT_STREAM_ENABLED: "on",
        KNOWLEDGE_DIRECT_STREAM_MAX_CONNECTION_MS: "120000",
      },
    });

    expect(assembly?.options).toMatchObject({
      allowedOrigins: ["https://console.example.com", "http://localhost:3000"],
      maxConnectionMs: 120_000,
    });
  });

  it("rejects remote HTTP origins in production while allowing HTTPS and loopback", () => {
    expect(() =>
      createApiResearchTaskDirectStreamAssembly({
        env: {
          KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS: "http://console.example.com",
          KNOWLEDGE_DIRECT_STREAM_ENABLED: "on",
          NODE_ENV: "production",
        },
      }),
    ).toThrow("HTTPS");

    for (const origin of [
      "https://console.example.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(
        createApiResearchTaskDirectStreamAssembly({
          env: {
            KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS: origin,
            KNOWLEDGE_DIRECT_STREAM_ENABLED: "on",
            NODE_ENV: "production",
          },
        })?.options.allowedOrigins,
      ).toEqual([origin]);
    }
  });

  it("fails fast on missing, wildcard, path-bearing, or unbounded configuration", () => {
    expect(() =>
      createApiResearchTaskDirectStreamAssembly({
        env: { KNOWLEDGE_DIRECT_STREAM_ENABLED: "on" },
      }),
    ).toThrow("KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS");
    for (const origin of ["*", "https://dify.example.com/app", "https://user@dify.example.com"]) {
      expect(() =>
        createApiResearchTaskDirectStreamAssembly({
          env: {
            KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS: origin,
            KNOWLEDGE_DIRECT_STREAM_ENABLED: "on",
          },
        }),
      ).toThrow("absolute HTTP(S) origins");
    }
    expect(() =>
      createApiResearchTaskDirectStreamAssembly({
        env: {
          KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS: "https://dify.example.com",
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
        KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS: "https://dify.example.com",
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
