import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createDirectStreamCorsMiddleware } from "./direct-stream-cors";

describe("direct stream CORS", () => {
  it("allows only exact configured origins without credential cookies", async () => {
    const app = new Hono();
    app.use(
      "/research-tasks/*",
      createDirectStreamCorsMiddleware({
        allowedOrigins: ["https://console.example.com"],
      }),
    );
    app.get("/research-tasks/:id/events", (context) => context.text("ok"));

    const allowed = await app.request("/research-tasks/task-1/events", {
      headers: { origin: "https://console.example.com" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://console.example.com");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const denied = await app.request("/research-tasks/task-1/events", {
      headers: { origin: "https://evil.example" },
    });
    expect(denied.status).toBe(403);
  });

  it("answers a bounded Authorization/Last-Event-ID preflight before authentication", async () => {
    const app = new Hono();
    app.use(
      "/research-tasks/*",
      createDirectStreamCorsMiddleware({
        allowedOrigins: ["https://console.example.com"],
      }),
    );

    const response = await app.request("/research-tasks/task-1/events", {
      headers: {
        "access-control-request-headers": "authorization,last-event-id",
        "access-control-request-method": "GET",
        origin: "https://console.example.com",
      },
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Last-Event-ID",
    );
  });

  it("supports a separate JSON POST profile and rejects credential cookies", async () => {
    const app = new Hono();
    app.use(
      "/queries",
      createDirectStreamCorsMiddleware({
        allowedHeaders: ["Authorization", "Content-Type"],
        allowedMethods: ["POST"],
        allowedOrigins: ["https://console.example.com"],
      }),
    );
    app.post("/queries", (context) => context.json({ ok: true }));

    const preflight = await app.request("/queries", {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "POST",
        origin: "https://console.example.com",
      },
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );

    const allowed = await app.request("/queries", {
      headers: {
        authorization: "Bearer capability",
        "content-type": "application/json",
        origin: "https://console.example.com",
      },
      body: JSON.stringify({}),
      method: "POST",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://console.example.com");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const credentialed = await app.request("/queries", {
      headers: {
        cookie: "session=forbidden",
        origin: "https://console.example.com",
      },
      body: JSON.stringify({}),
      method: "POST",
    });
    expect(credentialed.status).toBe(403);
  });
});
