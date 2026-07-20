import { describe, expect, it } from "vitest";

import { createRunQueryRedirectHandler } from "./query-action";

describe("createRunQueryRedirectHandler", () => {
  it("redirects successful query streams back to the Admin page with bounded answer details", async () => {
    const upstreamRequests: Request[] = [];
    const handler = createRunQueryRedirectHandler({
      apiBaseUrl: "http://api.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        upstreamRequests.push(request.clone());
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://api.test/queries");
        expect(request.headers.get("authorization")).toBe("Bearer dev-token");
        await expect(request.json()).resolves.toEqual({
          knowledgeSpaceId: "space-1",
          mode: "fast",
          query: "What changed?",
        });

        return new Response(
          [
            'event: answer.delta\ndata: {"delta":"The roadmap changed","traceId":"trace-1"}',
            'event: answer.delta\ndata: {"delta":" for local ingestion.","traceId":"trace-1"}',
            'event: answer.done\ndata: {"finishReason":"stop","metadata":{"sessionId":"session-1"},"traceId":"trace-1"}',
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream", "x-trace-id": "trace-1" } },
        );
      },
    });
    const formData = new FormData();
    formData.set("knowledgeSpaceId", "space-1");
    formData.set("mode", "fast");
    formData.set("query", "What changed?");

    const response = await handler.handle(
      new Request("http://admin.test/api/admin-query", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("http://admin.test");
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("queryStatus")).toBe("success");
    expect(location.searchParams.get("answer")).toBe("The roadmap changed for local ingestion.");
    expect(location.searchParams.get("traceId")).toBe("trace-1");
    expect(location.searchParams.get("citations")).toBe("trace-1,session-1");
    expect(upstreamRequests).toHaveLength(1);
  });

  it("redirects invalid or failed query requests without calling unbounded APIs", async () => {
    let called = false;
    const handler = createRunQueryRedirectHandler({
      apiBaseUrl: "http://api.test",
      fetch: async () => {
        called = true;
        return Response.json({});
      },
    });
    const formData = new FormData();
    formData.set("knowledgeSpaceId", "space-1");
    formData.set("query", " ");

    const response = await handler.handle(
      new Request("http://admin.test/api/admin-query", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("queryStatus")).toBe("error");
    expect(location.searchParams.get("queryError")).toBe("Query is required");
    expect(called).toBe(false);
  });
});
