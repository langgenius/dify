import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createKnowledgeGateway } from "./index";

describe("query route OpenAPI contract", () => {
  it("documents durable query identity headers and deletion admission conflicts", async () => {
    const app = createKnowledgeGateway({ adapter: createNodePlatformAdapter({ env: {} }) });
    const response = await app.request("/openapi.json");
    const document = (await response.json()) as {
      readonly paths?: Record<
        string,
        {
          readonly post?: {
            readonly responses?: Record<string, { readonly headers?: Record<string, unknown> }>;
          };
        }
      >;
    };
    const responses = document.paths?.["/queries"]?.post?.responses;

    expect(responses?.["200"]).toMatchObject({
      headers: {
        "x-query-run-id": {},
        "x-session-id": {},
        "x-trace-id": {},
      },
    });
    expect(responses?.["409"]).toBeDefined();
  });
});
