import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleGatewayError } from "./gateway-error-handlers";

describe("handleGatewayError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs actionable error context without changing the public response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = new Hono<{ Variables: { traceId: string } }>();
    app.use(async (context, next) => {
      context.set("traceId", "trace-background-task");
      await next();
    });
    app.get("/knowledge-spaces/:id/background-tasks", () => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    app.onError(handleGatewayError);

    const response = await app.request("/knowledge-spaces/space-1/background-tasks?limit=100");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
    expect(log).toHaveBeenCalledWith("Unhandled gateway error", {
      code: "42P01",
      message: "relation does not exist",
      method: "GET",
      name: "Error",
      path: "/knowledge-spaces/space-1/background-tasks",
      stack: expect.stringContaining("relation does not exist"),
      traceId: "trace-background-task",
    });
  });
});
