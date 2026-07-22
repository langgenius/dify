import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKnowledgeGateway } from "./index";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("gateway direct-upload CORS", () => {
  it.each([
    "/knowledge-spaces/space-a/upload-sessions",
    "/upload-sessions/session-a/parts/1/presign",
    "/upload-sessions/session-a/complete",
    "/upload-sessions/session-a/abort",
  ])(
    "answers exact-origin POST preflight before Capability authentication for %s",
    async (path) => {
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
        directUploadAllowedOrigins: ["https://console.example.com"],
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

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://console.example.com",
      );
      expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Authorization, Content-Type",
      );
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
      expect(authenticate).not.toHaveBeenCalled();
    },
  );

  it("rejects an unlisted upload-control origin before authentication", async () => {
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
      directUploadAllowedOrigins: ["https://console.example.com"],
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

  it("requires exact upload origins when direct upload is assembled in production", () => {
    process.env.NODE_ENV = "production";

    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        capabilityGrantProvenance: {
          admit: vi.fn(),
          applyGrantRevoke: vi.fn(),
          applySpaceFence: vi.fn(),
          assertPublicationAllowed: vi.fn(),
          get: vi.fn(),
        },
        difyCapabilityV2Auth: { authenticate: vi.fn() },
        difyIntegrationFreezes: { freeze: vi.fn(), get: vi.fn() },
        difyIntegrationStates: { activate: vi.fn(), get: vi.fn() },
        knowledgeSpaceProvisioning: { provision: vi.fn() },
        uploadSessions: {} as never,
      }),
    ).toThrow("exact browser CORS origins");
  });
});
