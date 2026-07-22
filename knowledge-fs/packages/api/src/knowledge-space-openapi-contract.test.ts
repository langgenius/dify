import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  completeKnowledgeGatewayOpenApiDocument,
  knowledgeGatewayOpenApiDocument,
} from "./gateway-openapi-document";
import { healthRoute, readinessRoute } from "./gateway-system-routes";
import { createKnowledgeGateway } from "./index";
import {
  batchKnowledgeSpaceProductSummariesRoute,
  createKnowledgeSpaceRoute,
  listKnowledgeSpacesRoute,
} from "./knowledge-space-routes";

describe("knowledge-space OpenAPI contract", () => {
  it("publishes stable operation ids for Dify product operations", () => {
    expect(createKnowledgeSpaceRoute.operationId).toBe("createKnowledgeSpace");
    expect(listKnowledgeSpacesRoute.operationId).toBe("listKnowledgeSpaces");
    expect(batchKnowledgeSpaceProductSummariesRoute.operationId).toBe(
      "batchKnowledgeSpaceProductSummaries",
    );
    expect(createKnowledgeSpaceRoute.tags).toEqual(["Knowledge Spaces"]);
    expect(listKnowledgeSpacesRoute.tags).toEqual(["Knowledge Spaces"]);
  });

  it("publishes the effective authentication and transport metadata", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
    });
    const response = await app.request("/openapi.json");
    const document = (await response.json()) as {
      components?: { securitySchemes?: Record<string, unknown> };
      paths?: Record<
        string,
        Record<
          string,
          {
            operationId?: string;
            parameters?: Array<{ in?: string; name?: string }>;
            responses?: Record<
              string,
              {
                content?: Record<string, { schema?: Record<string, unknown> }>;
                description?: string;
              }
            >;
            security?: Array<Record<string, unknown>>;
            "x-knowledge-fs-max-response-bytes"?: number;
            "x-knowledge-fs-required-scope"?: string;
          }
        >
      >;
      security?: Array<Record<string, unknown>>;
      servers?: Array<{ url?: string }>;
    };

    expect(response.status).toBe(200);
    expect(document.servers).toEqual([{ url: "/" }]);
    expect(document.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components?.securitySchemes).toEqual({
      bearerAuth: {
        bearerFormat: "JWT or API token",
        scheme: "bearer",
        type: "http",
      },
    });
    expect(healthRoute.security).toEqual([]);
    expect(document.paths?.["/health"]?.get).toMatchObject({
      operationId: "getHealth",
      security: [],
      "x-knowledge-fs-max-response-bytes": 1024 * 1024,
    });
    expect(readinessRoute.security).toEqual([]);
    expect(document.paths?.["/ready"]?.get).toMatchObject({
      operationId: "getReadiness",
      responses: {
        "200": {
          description: "Deployment is ready to receive traffic",
        },
        "503": {
          description: "Deployment is not ready to receive traffic",
        },
      },
      security: [],
      "x-knowledge-fs-max-response-bytes": 1024 * 1024,
    });
    expect(document.paths?.["/ready"]?.get?.responses?.["200"]?.content).toHaveProperty(
      "application/json",
    );
    expect(document.paths?.["/ready"]?.get?.responses?.["503"]?.content).toHaveProperty(
      "application/json",
    );
    expect(document.paths?.["/knowledge-spaces"]?.get).toMatchObject({
      operationId: "listKnowledgeSpaces",
      "x-knowledge-fs-max-response-bytes": 1024 * 1024,
      "x-knowledge-fs-required-scope": "knowledge-spaces:read",
    });
    expect(document.paths?.["/knowledge-spaces"]?.post).toMatchObject({
      operationId: "createKnowledgeSpace",
      "x-knowledge-fs-max-response-bytes": 1024 * 1024,
      "x-knowledge-fs-required-scope": "knowledge-spaces:write",
    });
    expect(document.paths?.["/knowledge-spaces"]?.get?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ in: "header", name: "x-trace-id" })]),
    );
    expect(
      document.paths?.["/internal/knowledge-spaces/product-summaries/batch"]?.post,
    ).toMatchObject({
      operationId: "batchKnowledgeSpaceProductSummaries",
      "x-knowledge-fs-max-response-bytes": 1024 * 1024,
      "x-knowledge-fs-required-scope": "knowledge-spaces:read",
    });
    expect(document.paths?.["/knowledge-spaces/{id}/product-settings"]?.get).toMatchObject({
      operationId: "getKnowledgeSpaceProductSettings",
      "x-knowledge-fs-required-scope": "knowledge-spaces:read",
    });
    expect(document.paths?.["/knowledge-spaces/{id}/product-settings"]?.patch).toMatchObject({
      operationId: "updateKnowledgeSpaceProductSettings",
      "x-knowledge-fs-required-scope": "knowledge-spaces:write",
    });
    expect(document.paths?.["/knowledge-spaces/{id}/sources"]?.get).toMatchObject({
      operationId: "listKnowledgeSpaceSources",
      "x-knowledge-fs-required-scope": "knowledge-spaces:read",
    });
    expect(document.paths?.["/knowledge-spaces/{id}/sources"]?.post).toMatchObject({
      operationId: "createKnowledgeSpaceSource",
      "x-knowledge-fs-required-scope": "knowledge-spaces:write",
    });
    expect(document.paths?.["/knowledge-spaces/{id}/research-tasks"]?.get).toMatchObject({
      operationId: "listKnowledgeSpaceResearchTasks",
      "x-knowledge-fs-required-scope": "knowledge-spaces:read",
    });
    expect(document.paths?.["/knowledge-spaces/{id}/quality/traces"]?.get).toMatchObject({
      operationId: "listKnowledgeSpaceQualityTraces",
      "x-knowledge-fs-required-scope": "knowledge-spaces:read",
    });
  });

  it("builds the same base document used by the exported route", () => {
    const document = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
    }).getOpenAPI31Document(knowledgeGatewayOpenApiDocument);

    expect(document.paths?.["/knowledge-spaces"]?.get?.operationId).toBe("listKnowledgeSpaces");
    expect(document.paths?.["/knowledge-spaces"]?.post?.operationId).toBe("createKnowledgeSpace");
  });

  it("completes sparse, public, and referenced-response documents deterministically", () => {
    const sparse = completeKnowledgeGatewayOpenApiDocument(
      openApiDocument({
        "/": {
          get: {
            responses: {},
            security: [],
          },
        },
        "/referenced": {
          get: {
            operationId: "getReferenced",
            responses: { "200": { $ref: "#/components/responses/Referenced" } },
          },
        },
      }),
    );

    expect(sparse.paths?.["/"]?.get).toMatchObject({
      operationId: "getRoot",
      security: [],
      "x-knowledge-fs-max-response-bytes": 1024 * 1024,
    });
    expect(sparse.paths?.["/referenced"]?.get).toMatchObject({
      operationId: "getReferenced",
      "x-knowledge-fs-required-scope": "knowledge-spaces:read",
    });
    expect(sparse.paths?.["/referenced"]?.get?.responses?.["200"]).toEqual({
      $ref: "#/components/responses/Referenced",
    });

    expect(
      completeKnowledgeGatewayOpenApiDocument(openApiDocument(undefined)).paths,
    ).toBeUndefined();
  });

  it("rejects duplicate generated operation ids", () => {
    expect(() =>
      completeKnowledgeGatewayOpenApiDocument(
        openApiDocument({
          "/first": {
            get: { operationId: "duplicate", responses: {} },
          },
          "/second": {
            get: { operationId: "duplicate", responses: {} },
          },
        }),
      ),
    ).toThrow("Duplicate OpenAPI operationId: duplicate");
  });
});

function openApiDocument(paths: Record<string, unknown> | undefined) {
  return {
    info: { title: "Synthetic", version: "1" },
    openapi: "3.1.0" as const,
    paths,
  } as unknown as Parameters<typeof completeKnowledgeGatewayOpenApiDocument>[0];
}
