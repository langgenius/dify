import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { ParseArtifactSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createAdminBffProxy } from "../../../apps/admin/lib/bff";
import { createUploadDocumentRedirectHandler } from "../../../apps/admin/lib/upload-action";
import {
  type KnowledgeGatewayOptions,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

const devToken = "dev-token";
const devSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "dev-user",
  tenantId: "tenant-dev",
};

function createLocalGateway(options: Partial<KnowledgeGatewayOptions> = {}) {
  return createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subject: devSubject,
      token: devToken,
    }),
    ...options,
  });
}

function createGatewayFetch(app: ReturnType<typeof createLocalGateway>, requests: Request[]) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    requests.push(request.clone());

    return app.fetch(request);
  };
}

describe("Admin BFF to Knowledge API integration", () => {
  it("uploads a markdown document through the Admin redirect handler and reads the artifact", async () => {
    const app = createLocalGateway({
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9a01",
    });
    const requests: Request[] = [];
    const handler = createUploadDocumentRedirectHandler({
      apiBaseUrl: "http://api.test",
      fetch: createGatewayFetch(app, requests),
    });
    const formData = new FormData();
    formData.set("knowledgeSpaceId", "workspace");
    formData.set(
      "file",
      new File(["# Roadmap\n\nQueryable upload is live."], "roadmap.md", {
        type: "text/markdown",
      }),
    );

    const response = await handler.handle(
      new Request("http://admin.test/api/admin-upload", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.searchParams.get("uploadStatus")).toBe("success");
    expect(redirect.searchParams.get("documentId")).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f9a01");
    expect(redirect.searchParams.get("parserStatus")).toBe("parsed");

    const knowledgeSpaceId = redirect.searchParams.get("spaceId");
    const documentId = redirect.searchParams.get("documentId");
    expect(knowledgeSpaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(documentId).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f9a01");

    const artifactResponse = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/parse-artifacts/1`,
      {
        headers: { authorization: `Bearer ${devToken}` },
      },
    );
    expect(artifactResponse.status).toBe(200);
    const artifact = ParseArtifactSchema.parse(await artifactResponse.json());
    expect(artifact.documentAssetId).toBe(documentId);
    expect(artifact.elements.map((element) => element.text).filter(Boolean)).toContain(
      "Queryable upload is live.",
    );

    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["GET", "/knowledge-spaces"],
      ["POST", "/knowledge-spaces"],
      ["POST", `/knowledge-spaces/${knowledgeSpaceId}/documents`],
    ]);
  });

  it("proxies Admin live graph requests with the API-supported GET method", async () => {
    const app = createLocalGateway();
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test",
      fetch: createGatewayFetch(app, requests),
    });

    const spaceResponse = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Workspace", slug: "workspace" }),
      headers: {
        authorization: `Bearer ${devToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const space = (await spaceResponse.json()) as { readonly id: string };

    const response = await proxy.proxy(
      new Request(
        `http://admin.test/api/bff/knowledge-spaces/${space.id}/graph/traverse?entityId=018f0d60-7a49-7cc2-9c1b-5b36f18f2c81`,
        {
          method: "GET",
        },
      ),
      { path: ["knowledge-spaces", space.id, "graph", "traverse"] },
    );

    expect(response.status).toBe(503);
    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["GET", `/knowledge-spaces/${space.id}/graph/traverse`],
    ]);
  });
});
