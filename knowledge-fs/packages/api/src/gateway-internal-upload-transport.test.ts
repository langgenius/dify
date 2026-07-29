import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import { createKnowledgeGateway } from "./index";

describe("gateway upload-session internal transport", () => {
  it.each([
    "/knowledge-spaces/space-a/upload-sessions",
    "/upload-sessions/session-a/parts/1/presign",
    "/upload-sessions/session-a/complete",
    "/upload-sessions/session-a/abort",
  ])("rejects browser preflight before Capability authentication for %s", async (path) => {
    const authenticate = vi.fn(async () => {
      throw new Error("preflight must not authenticate");
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      capabilityGrantProvenance: {
        admit: vi.fn(),
        applyGrantRevoke: vi.fn(),
        applySpaceFence: vi.fn(),
        assertPublicationAllowed: vi.fn(),
        get: vi.fn(),
      },
      difyCapabilityV2Auth: { authenticate },
      uploadSessions: {} as never,
    });

    const response = await app.request(path, {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "POST",
        origin: "https://console.example.com",
      },
      method: "OPTIONS",
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects every browser upload-control origin before authentication", async () => {
    const authenticate = vi.fn();
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      capabilityGrantProvenance: {
        admit: vi.fn(),
        applyGrantRevoke: vi.fn(),
        applySpaceFence: vi.fn(),
        assertPublicationAllowed: vi.fn(),
        get: vi.fn(),
      },
      difyCapabilityV2Auth: { authenticate },
      uploadSessions: {} as never,
    });

    const response = await app.request("/upload-sessions/session-a/complete", {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "POST",
        origin: "https://evil.example",
      },
      method: "OPTIONS",
    });

    expect(response.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
