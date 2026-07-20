import { describe, expect, it } from "vitest";

import { getRateLimitTool, getTraceRoute } from "./route-classification";

describe("route classification", () => {
  it("normalizes high-cardinality HTTP paths for tracing", () => {
    expect(getTraceRoute("/knowledge-spaces/ks-1/documents/doc-1/parse-artifacts/1")).toBe(
      "/knowledge-spaces/{id}/documents/{documentId}/parse-artifacts/{version}",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/embedding-profile")).toBe(
      "/knowledge-spaces/{id}/embedding-profile",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/retrieval-profile")).toBe(
      "/knowledge-spaces/{id}/retrieval-profile",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/profiles/embedding/revisions")).toBe(
      "/knowledge-spaces/{id}/profiles/{kind}/revisions",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/overview/activity")).toBe(
      "/knowledge-spaces/{id}/overview/activity",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/overview/attention/stale-source:source:s-1")).toBe(
      "/knowledge-spaces/{id}/overview/attention/{issueKey}",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/members/user-1")).toBe(
      "/knowledge-spaces/{id}/members/{subjectId}",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/api-keys/key-1")).toBe(
      "/knowledge-spaces/{id}/api-keys/{keyId}",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/semantic-views/topic/materialize")).toBe(
      "/knowledge-spaces/{id}/semantic-views/topic/materialize",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/semantic-views/communities/materialize")).toBe(
      "/knowledge-spaces/{id}/semantic-views/communities/materialize",
    );
    expect(getTraceRoute("/knowledge-spaces/ks-1/fs/tree")).toBe("/knowledge-spaces/{id}/fs/tree");
    expect(getTraceRoute("/queries/trace-1")).toBe("/queries/{traceId}");
    expect(getTraceRoute("/unknown/path")).toBe("unmatched");
  });

  it("maps protected routes to low-cardinality rate-limit tools", () => {
    expect(getRateLimitTool("GET", "/knowledge-spaces")).toBe("knowledge-spaces.list");
    expect(getRateLimitTool("POST", "/knowledge-spaces/ks-1/documents")).toBe("documents.upload");
    expect(getRateLimitTool("DELETE", "/knowledge-spaces/ks-1/documents/bulk")).toBe(
      "documents.bulk-delete",
    );
    expect(getRateLimitTool("POST", "/knowledge-spaces/ks-1/semantic-views/entities/extract")).toBe(
      "semantic-views.entities.extract",
    );
    expect(
      getRateLimitTool("POST", "/knowledge-spaces/ks-1/semantic-views/communities/materialize"),
    ).toBe("semantic-views.communities.materialize");
    expect(getRateLimitTool("POST", "/knowledge-spaces/ks-1/fs/grep")).toBe("knowledge.fs.grep");
    expect(getRateLimitTool("PATCH", "/knowledge-spaces/ks-1/access-policy")).toBe(
      "knowledge-spaces.access-policy",
    );
    expect(getRateLimitTool("GET", "/knowledge-spaces/ks-1/profiles/retrieval/revisions")).toBe(
      "knowledge-spaces.profiles.revisions.list",
    );
    expect(getRateLimitTool("GET", "/knowledge-spaces/ks-1/overview/stats")).toBe(
      "knowledge-spaces.overview.stats.read",
    );
    expect(
      getRateLimitTool(
        "PATCH",
        "/knowledge-spaces/ks-1/overview/attention/stale-source:source:s-1",
      ),
    ).toBe("knowledge-spaces.overview.attention.write");
    expect(getRateLimitTool("PATCH", "/unknown/path")).toBe("patch unmatched");
  });

  it("classifies every Source product route without leaking resource identifiers", () => {
    expect(getTraceRoute("/source-providers")).toBe("/source-providers");
    expect(getTraceRoute("/source-oauth/callback")).toBe("/source-oauth/callback");
    expect(getTraceRoute("/knowledge-spaces/space-a/source-connections")).toBe(
      "/knowledge-spaces/{id}/source-connections/product-resource",
    );
    expect(getTraceRoute("/knowledge-spaces/space-a/source-connections/connection-a/refresh")).toBe(
      "/knowledge-spaces/{id}/source-connections/product-resource",
    );
    expect(getTraceRoute("/knowledge-spaces/space-a/source-workflows/run-a/pages/page-a")).toBe(
      "/knowledge-spaces/{id}/source-workflows/product-resource",
    );
    expect(getTraceRoute("/knowledge-spaces/space-a/sources/source-a/sync-policy")).toBe(
      "/knowledge-spaces/{id}/sources/{sourceId}/sync-product-resource",
    );
    expect(getTraceRoute("/knowledge-spaces/space-a/sources/source-a/crawl-preview")).toBe(
      "/knowledge-spaces/{id}/sources/{sourceId}/sync-product-resource",
    );
    expect(getTraceRoute("/knowledge-spaces/space-a/sources/source-a/workflow-imports")).toBe(
      "/knowledge-spaces/{id}/sources/{sourceId}/sync-product-resource",
    );
    expect(getTraceRoute("/knowledge-spaces/space-a/sources/bulk")).toBe(
      "/knowledge-spaces/{id}/sources/bulk",
    );
    expect(getTraceRoute("/SOURCE-PROVIDERS")).toBe("unmatched");

    expect(getRateLimitTool("get", "/source-providers")).toBe("source-providers.list");
    expect(getRateLimitTool("POST", "/source-oauth/callback")).toBe(
      "source-connections.oauth.callback",
    );
    expect(getRateLimitTool("get", "/knowledge-spaces/s/source-connections/c/refresh")).toBe(
      "sources.product.read",
    );
    expect(getRateLimitTool("post", "/knowledge-spaces/s/source-connections/c/refresh")).toBe(
      "sources.product.write",
    );
    expect(getRateLimitTool("GET", "/knowledge-spaces/s/source-workflows/r/pages")).toBe(
      "sources.product.read",
    );
    expect(getRateLimitTool("PUT", "/knowledge-spaces/s/sources/src/sync-policy")).toBe(
      "sources.product.write",
    );
    expect(getRateLimitTool("POST", "/knowledge-spaces/s/sources/src/crawl-preview")).toBe(
      "sources.product.write",
    );
    expect(getRateLimitTool("POST", "/knowledge-spaces/s/sources/src/workflow-imports")).toBe(
      "sources.product.write",
    );
    expect(getRateLimitTool("POST", "/knowledge-spaces/s/sources/bulk")).toBe(
      "sources.product.write",
    );
  });
});
