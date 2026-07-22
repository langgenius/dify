import { describe, expect, it } from "vitest";

import { asLooseOpenApiContext, openApiHandler } from "./openapi-handler-utils";

describe("OpenAPI handler utilities", () => {
  it("casts OpenAPI contexts without changing the runtime object", () => {
    const context = {
      get: (name: "subject" | "traceId") => name,
      json: (body: unknown, status?: number) => new Response(JSON.stringify({ body, status })),
      req: {
        valid: (target: "json" | "param" | "query") => ({ target }),
      },
    };

    expect(asLooseOpenApiContext(context)).toBe(context);
  });

  it("casts handlers without wrapping them", () => {
    const handler = async () => new Response("ok");

    expect(openApiHandler(handler)).toBe(handler);
  });
});
