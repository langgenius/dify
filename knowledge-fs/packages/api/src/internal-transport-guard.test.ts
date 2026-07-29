import { describe, expect, it } from "vitest";

import { createKnowledgeGatewayApp } from "./gateway-app";
import { createInternalTransportGuardMiddleware } from "./internal-transport-guard";

describe("internal transport guard", () => {
  it.each([
    ["origin", { origin: "https://console.example.com" }, "GET"],
    ["cookie", { cookie: "session=secret" }, "GET"],
    ["browser preflight", { origin: "https://console.example.com" }, "OPTIONS"],
  ])("rejects %s requests", async (_case, headers, method) => {
    const app = createKnowledgeGatewayApp();
    app.use("*", createInternalTransportGuardMiddleware());
    app.all("*", (context) => context.text("ok"));

    const response = await app.request("/internal", { headers, method });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows a server-to-server request without browser identity headers", async () => {
    const app = createKnowledgeGatewayApp();
    app.use("*", createInternalTransportGuardMiddleware());
    app.get("/internal", (context) => context.text("ok"));

    const response = await app.request("/internal");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });
});
