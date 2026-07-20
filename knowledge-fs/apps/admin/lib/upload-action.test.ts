import { describe, expect, it } from "vitest";

import { createUploadDocumentRedirectHandler } from "./upload-action";

describe("createUploadDocumentRedirectHandler", () => {
  it("redirects successful uploads back to the Admin page with bounded result details", async () => {
    const upstreamRequests: Request[] = [];
    const handler = createUploadDocumentRedirectHandler({
      apiBaseUrl: "http://api.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        upstreamRequests.push(request.clone());
        expect(request.url).toBe("http://api.test/knowledge-spaces/space-1/documents");
        expect(request.headers.get("authorization")).toBe("Bearer dev-token");

        const body = await request.formData();
        expect(body.get("sourceId")).toBe("manual-upload");
        expect(body.get("knowledgeSpaceId")).toBeNull();
        expect(body.get("file")).toBeInstanceOf(File);

        return Response.json(
          {
            createdAt: "2026-05-21T00:00:00.000Z",
            filename: "roadmap.md",
            id: "asset-1",
            knowledgeSpaceId: "space-1",
            metadata: { traceId: "trace-1" },
            mimeType: "text/markdown",
            objectKey: "tenant/spaces/space-1/documents/asset-1/roadmap.md",
            parserStatus: "parsed",
            sha256: "a".repeat(64),
            sizeBytes: 12345,
            version: 1,
          },
          { status: 201 },
        );
      },
    });
    const formData = new FormData();
    formData.set("knowledgeSpaceId", "space-1");
    formData.set("sourceId", "manual-upload");
    formData.set("file", new File(["# Roadmap"], "roadmap.md", { type: "text/markdown" }));

    const response = await handler.handle(
      new Request("http://admin.test/api/admin-upload", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("http://admin.test");
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("uploadStatus")).toBe("success");
    expect(location.searchParams.get("documentId")).toBe("asset-1");
    expect(location.searchParams.get("parserStatus")).toBe("parsed");
    expect(location.searchParams.get("filename")).toBe("roadmap.md");
    expect(location.searchParams.get("sizeBytes")).toBe("12345");
    expect(location.searchParams.get("sha256")).toBe("a".repeat(64));
    expect(upstreamRequests).toHaveLength(1);
  });

  it("redirects failed uploads back to the Admin page instead of exposing raw JSON", async () => {
    const handler = createUploadDocumentRedirectHandler({
      apiBaseUrl: "http://api.test",
      fetch: async () => Response.json({ error: "Document parsing failed" }, { status: 500 }),
    });
    const formData = new FormData();
    formData.set("knowledgeSpaceId", "space-1");
    formData.set("file", new File(["%PDF"], "contract.pdf", { type: "application/pdf" }));

    const response = await handler.handle(
      new Request("http://admin.test/api/admin-upload", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("uploadStatus")).toBe("error");
    expect(location.searchParams.get("uploadError")).toBe("Document parsing failed");
  });

  it("reports upstream 404s as API base or route configuration failures", async () => {
    const handler = createUploadDocumentRedirectHandler({
      apiBaseUrl: "http://api.test",
      fetch: async () => new Response("not found", { status: 404 }),
    });
    const formData = new FormData();
    formData.set("knowledgeSpaceId", "space-1");
    formData.set("file", new File(["# Roadmap"], "roadmap.md", { type: "text/markdown" }));

    const response = await handler.handle(
      new Request("http://admin.test/api/admin-upload", {
        body: formData,
        method: "POST",
      }),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("uploadStatus")).toBe("error");
    expect(location.searchParams.get("uploadError")).toBe(
      "Knowledge API upload route was not found; check KNOWLEDGE_API_BASE_URL/NEXT_PUBLIC_API_BASE_URL and API startup",
    );
  });

  it("rejects missing file input without calling the API", async () => {
    let called = false;
    const handler = createUploadDocumentRedirectHandler({
      apiBaseUrl: "http://api.test",
      fetch: async () => {
        called = true;
        return Response.json({});
      },
    });
    const formData = new FormData();
    formData.set("knowledgeSpaceId", "space-1");

    const response = await handler.handle(
      new Request("http://admin.test/api/admin-upload", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("uploadStatus")).toBe("error");
    expect(location.searchParams.get("uploadError")).toBe("Document file is required");
    expect(called).toBe(false);
  });
});
