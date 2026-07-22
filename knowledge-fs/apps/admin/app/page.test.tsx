import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminRowKey, graphEntityRowKey, graphRelationRowKey } from "../lib/graph-row-keys";
import AdminHome, { dynamic } from "./page";

describe("AdminHome", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps graph browser row keys unique when traversal returns duplicate ids", () => {
    const entity = {
      aliases: ["Acme"],
      canonicalKey: "organization:acme",
      confidence: 0.94,
      createdAt: "2026-05-12T00:00:00.000Z",
      depth: 0,
      extractionVersion: 1,
      id: "2aacb597-9256-42e3-a0ca-aec3bf4122f3",
      knowledgeSpaceId: "space-1",
      metadata: {},
      name: "Acme",
      permissionScope: ["tenant:tenant-1"],
      sourceNodeIds: ["node-1"],
      type: "organization",
      updatedAt: "2026-05-12T00:00:00.000Z",
    } as const;
    const relation = {
      confidence: 0.9,
      createdAt: "2026-05-12T00:00:00.000Z",
      depth: 1,
      extractionVersion: 1,
      id: "2aacb597-9256-42e3-a0ca-aec3bf4122f3",
      knowledgeSpaceId: "space-1",
      metadata: {},
      objectEntityId: "entity-b",
      permissionScope: ["tenant:tenant-1"],
      sourceNodeIds: ["node-1"],
      subjectEntityId: "entity-a",
      type: "mentions",
      updatedAt: "2026-05-12T00:00:00.000Z",
    } as const;

    expect(graphEntityRowKey(entity, 0)).not.toBe(graphEntityRowKey(entity, 1));
    expect(graphRelationRowKey(relation, 0)).not.toBe(graphRelationRowKey(relation, 1));
    expect(adminRowKey("failed-commit", entity.id, 0)).not.toBe(
      adminRowKey("failed-commit", entity.id, 1),
    );
  });

  it("renders the operational Admin Console shell", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("API unavailable in shell render test");
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("KnowledgeFS Admin");
    expect(html).toContain("System health");
    expect(html).toContain("Control plane");
    expect(html).toContain("Manifest version");
    expect(html).toContain("Operations diagnostics");
    expect(html).toContain("Failed commits");
    expect(html).toContain("FSCK dry run");
    expect(html).toContain("Raw object consistency check");
    expect(html).toContain("Staged object GC");
    expect(html).toContain("Dry-run candidates");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Upload intake");
    expect(html).toContain("Parser status");
    expect(html).toContain("Node count");
    expect(html).toContain("Quality risks");
    expect(html).toContain("Retrieval workspace");
    expect(html).toContain("Streaming answer");
    expect(html).toContain("Inline citations");
    expect(html).toContain("Confidence");
    expect(html).toContain("Freshness");
    expect(html).toContain("KnowledgeFS");
    expect(html).toContain("Documents");
    expect(html).toContain("Run command");
    expect(html).toContain("Run write/append");
    expect(html).toContain("ls, tree, cat, stat, grep, find, diff, open_node, write, append");
    expect(html).toContain("Entity browser");
    expect(html).toContain("Traverse graph");
    expect(html).toContain("/knowledge/by-entity");
    expect(html).toContain("Semantic views");
    expect(html).toContain("Topic browser");
    expect(html).toContain("Readable entities");
    expect(html).toContain('action="/api/admin-semantic-views"');
    expect(html).toContain("Materialize topic view");
    expect(html).toContain("Extract entities");
    expect(html).toContain("Document diff");
    expect(html).toContain("Run diff");
    expect(html).toContain("Golden questions");
    expect(html).toContain("Evaluation dashboard");
    expect(html).toContain("Retrieval Studio");
    expect(html).toContain("Live evidence from the latest query trace");
    expect(html).toContain("Production bad-case capture");
    expect(html).toContain("Add to eval queue");
    expect(html).toContain("Trace ID");
    expect(html).toContain("Total questions");
    expect(html).toContain("Annotated");
    expect(html).toContain("Bad cases");
    expect(html).toContain("Pending");
    expect(html).toContain("Expected evidence");
    expect(html).toContain("Create question");
    expect(html).toContain("Update selected");
    expect(html).toContain("Delete selected");
    expect(html).toContain("Human annotation");
    expect(html).toContain("Answer correctness");
    expect(html).toContain("Evidence relevance");
    expect(html).toContain("Submit annotation");
    expect(html).toContain("Trace review");
    expect(html).toContain("Trace comparison");
    expect(html).toContain("Compare traces");
    expect(html).toContain("Failed query diagnostics");
    expect(html).toContain("Run a query to inspect live diagnostics");
    expect(html).toContain("API base");
    expect(html).toContain('name="sourceId"');
    expect(html).not.toContain('value="manual-upload"');
    expect(html).toContain('action="/api/admin-upload"');
    expect(html).toContain('href="/api/bff/health"');
    expect(html).toContain('action="/api/admin-query"');
    expect(html).toContain('formAction="/api/admin-knowledge-fs-write"');
    expect(html).toContain('name="knowledgeSpaceId"');
    expect(html).toContain('action="/api/admin-golden-question"');
    expect(html).toContain('action="/api/admin-golden-annotation"');
    expect(html).toContain('action="/api/admin-bad-case"');
    expect(html).toContain('action="/api/admin-semantic-views"');
    expect(html).not.toContain("http://localhost:8788/knowledge-spaces");
    expect(html).not.toContain("placeholder");
  });

  it("displays the public API base while fetching through the private server upstream", async () => {
    const originalPrivateBase = process.env.KNOWLEDGE_API_BASE_URL;
    const originalPublicBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.KNOWLEDGE_API_BASE_URL = "http://api:8787";
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8788";
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.url === "http://api:8787/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: false },
          ok: true,
          runtime: "node-docker",
        });
      }
      if (request.url === "http://api:8787/knowledge-spaces?limit=100") {
        return Response.json({ items: [] });
      }
      if (request.url.includes("/fs/ls")) {
        return Response.json({ items: [], path: "/knowledge", truncated: false });
      }
      if (request.url.includes("/golden-questions?limit=12")) {
        return Response.json({ items: [] });
      }
      if (request.url.endsWith("/manifest")) {
        return Response.json(adminManifest());
      }
      if (request.url.endsWith("/status")) {
        return Response.json(adminStatus());
      }
      if (request.url.endsWith("/staged-commits?limit=5")) {
        return Response.json(adminStagedCommits());
      }
      if (request.url.endsWith("/leases/active?limit=5")) {
        return Response.json(adminActiveLeases());
      }
      if (request.url.endsWith("/fsck?check=raw-objects")) {
        return Response.json(adminFsck());
      }
      if (request.url.endsWith("/gc/staged-objects")) {
        return Response.json(adminGcDryRun());
      }
      if (request.url === "http://api:8787/knowledge-spaces/workspace/documents?limit=1") {
        return Response.json({ items: [] });
      }
      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    try {
      const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

      expect(html).toContain("<code>http://localhost:8788</code>");
      expect(html.match(/Raw object is missing\./g)?.length).toBe(2);
      expect(requests.map((request) => request.url).sort()).toEqual([
        "http://api:8787/health",
        "http://api:8787/knowledge-spaces/workspace/documents?limit=1",
        "http://api:8787/knowledge-spaces/workspace/fs/ls?path=%2Fknowledge%2Fby-community&limit=8",
        "http://api:8787/knowledge-spaces/workspace/fs/ls?path=%2Fknowledge%2Fby-entity&limit=8",
        "http://api:8787/knowledge-spaces/workspace/fs/ls?path=%2Fknowledge%2Fby-topic&limit=8",
        "http://api:8787/knowledge-spaces/workspace/fs/ls?path=%2Fknowledge%2Fdocs&limit=12",
        "http://api:8787/knowledge-spaces/workspace/fsck?check=raw-objects",
        "http://api:8787/knowledge-spaces/workspace/gc/staged-objects",
        "http://api:8787/knowledge-spaces/workspace/golden-questions?limit=12",
        "http://api:8787/knowledge-spaces/workspace/leases/active?limit=5",
        "http://api:8787/knowledge-spaces/workspace/manifest",
        "http://api:8787/knowledge-spaces/workspace/staged-commits?limit=5",
        "http://api:8787/knowledge-spaces/workspace/status",
        "http://api:8787/knowledge-spaces?limit=100",
      ]);
    } finally {
      restoreEnv("KNOWLEDGE_API_BASE_URL", originalPrivateBase);
      restoreEnv("NEXT_PUBLIC_API_BASE_URL", originalPublicBase);
    }
  });

  it("does not promote optional trace and KnowledgeFS browser failures to the global warning", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: true },
          ok: true,
          runtime: "node-docker",
        });
      }
      if (request.url === "http://localhost:8788/knowledge-spaces?limit=100") {
        return Response.json({ items: [] });
      }
      if (request.url.includes("/fs/ls")) {
        return new Response("bad path", { status: 400 });
      }
      if (
        request.url.includes("/queries/missing-trace") ||
        request.url.includes("/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01")
      ) {
        return Response.json({ error: "Answer trace not found" }, { status: 404 });
      }
      if (request.url.includes("/golden-questions?limit=12")) {
        return Response.json({ items: [] });
      }
      if (request.url.endsWith("/manifest")) {
        return Response.json(adminManifest());
      }
      if (request.url.endsWith("/status")) {
        return Response.json(adminStatus());
      }
      if (request.url.endsWith("/staged-commits?limit=5")) {
        return Response.json(adminStagedCommits());
      }
      if (request.url.endsWith("/leases/active?limit=5")) {
        return Response.json(adminActiveLeases());
      }
      if (request.url.endsWith("/fsck?check=raw-objects")) {
        return Response.json(adminFsck());
      }
      if (request.url.endsWith("/gc/staged-objects")) {
        return Response.json(adminGcDryRun());
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(
      await AdminHome({
        searchParams: Promise.resolve({
          fsPath: "/bad",
          traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
        }),
      }),
    );

    expect(html).not.toContain("Some live Admin data could not be loaded");
    expect(html).not.toContain("Admin API request failed with status 404");
    expect(html).not.toContain("Answer trace not found");
    expect(html).toContain("KnowledgeFS: Admin API request failed with status 400: bad path");
    expect(html).toContain("Run a query to inspect live retrieval evidence");
  });

  it("renders dynamically so workspace selection is loaded at request time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("marks secondary panels as live data instead of preview data", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("API unavailable in shell render test");
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("<h2>Entity browser</h2><small>Live graph traversal");
    expect(html).toContain("<h2>Semantic views</h2>");
    expect(html).toContain("Semantic views could not be loaded from KnowledgeFS");
    expect(html).toContain("<h2>Document diff</h2><small>Live KnowledgeFS");
    expect(html).toContain("<h2>Golden questions</h2><small>Live expected evidence");
    expect(html).toContain("<h2>Evaluation dashboard</h2><small>Live queue summary");
    expect(html).toContain("<h2>Retrieval Studio</h2><small>Live evidence");
    expect(html).toContain("<h2>Trace review</h2><small>Live recall");
    expect(html).toContain("<h2>Trace comparison</h2><small>Live side-by-side");
    expect(html).toContain("<h2>Failed query diagnostics</h2><small>Live evidence");
    expect(html).not.toContain(">Preview<");
  });

  it("explains empty semantic views as not-yet-materialized data", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: true },
          ok: true,
          runtime: "node-docker",
        });
      }
      if (request.url === "http://localhost:8788/knowledge-spaces?limit=100") {
        return Response.json({ items: [] });
      }
      if (request.url.includes("/fs/ls")) {
        const url = new URL(request.url);
        return Response.json({ items: [], path: url.searchParams.get("path"), truncated: false });
      }
      if (request.url.includes("/golden-questions?limit=12")) {
        return Response.json({ items: [] });
      }
      if (request.url.endsWith("/manifest")) {
        return Response.json(adminManifest());
      }
      if (request.url.endsWith("/status")) {
        return Response.json(adminStatus());
      }
      if (request.url.endsWith("/staged-commits?limit=5")) {
        return Response.json(adminStagedCommits());
      }
      if (request.url.endsWith("/leases/active?limit=5")) {
        return Response.json(adminActiveLeases());
      }
      if (request.url.endsWith("/fsck?check=raw-objects")) {
        return Response.json(adminFsck());
      }
      if (request.url.endsWith("/gc/staged-objects")) {
        return Response.json(adminGcDryRun());
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Not materialized");
    expect(html).toContain(
      "KnowledgeFS is reachable, but semantic materialization has no entries yet",
    );
    expect(html).toContain(
      "No topic entries yet; run topic-view materialization or inspect Documents",
    );
    expect(html).toContain("No entity entries yet; run entity extraction and graph indexing first");
    expect(html).toContain(
      "No communities yet; run entity extraction and community materialization first",
    );
  });

  it("uses real workspace ids in primary Admin form actions when loaded", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: true },
          ok: true,
          runtime: "node-docker",
        });
      }

      if (request.url === "http://localhost:8788/knowledge-spaces?limit=100") {
        return Response.json({
          items: [
            {
              createdAt: "2026-05-21T00:00:00.000Z",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
              name: "Workspace",
              slug: "workspace",
              tenantId: "tenant-dev",
              updatedAt: "2026-05-21T00:00:00.000Z",
            },
            {
              createdAt: "2026-05-21T00:00:00.000Z",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
              name: "Support KB",
              slug: "support",
              tenantId: "tenant-dev",
              updatedAt: "2026-05-21T00:00:00.000Z",
            },
          ],
        });
      }

      if (request.url.includes("/fs/ls")) {
        return Response.json({ items: [], path: "/knowledge", truncated: false });
      }

      if (request.url.includes("/golden-questions?limit=12")) {
        return Response.json({ items: [] });
      }
      if (request.url.endsWith("/manifest")) {
        return Response.json(adminManifest());
      }
      if (request.url.endsWith("/status")) {
        return Response.json(adminStatus());
      }
      if (request.url.endsWith("/staged-commits?limit=5")) {
        return Response.json(adminStagedCommits());
      }
      if (request.url.endsWith("/leases/active?limit=5")) {
        return Response.json(adminActiveLeases());
      }
      if (request.url.endsWith("/fsck?check=raw-objects")) {
        return Response.json(adminFsck());
      }
      if (request.url.endsWith("/gc/staged-objects")) {
        return Response.json(adminGcDryRun());
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Support KB");
    expect(requests.map((request) => request.url).sort()).toEqual([
      "http://localhost:8788/health",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents?limit=1",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/ls?path=%2Fknowledge%2Fby-community&limit=8",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/ls?path=%2Fknowledge%2Fby-entity&limit=8",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/ls?path=%2Fknowledge%2Fby-topic&limit=8",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/ls?path=%2Fknowledge%2Fdocs&limit=12",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fsck?check=raw-objects",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/gc/staged-objects",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions?limit=12",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/leases/active?limit=5",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/manifest",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/staged-commits?limit=5",
      "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/status",
      "http://localhost:8788/knowledge-spaces?limit=100",
    ]);
    const listRequest = requests.find((request) =>
      request.url.endsWith("/knowledge-spaces?limit=100"),
    );
    expect(listRequest?.headers.get("authorization")).toBe("Bearer dev-token");
    expect(html).toContain('action="/api/admin-upload"');
    expect(html).toContain(
      '<option value="018f0d60-7a49-7cc2-9c1b-5b36f18f2c42" selected="">Workspace</option>',
    );
    expect(html).toContain('action="/api/admin-golden-question"');
    expect(html).toContain('action="/api/admin-bad-case"');
    expect(html).toContain(
      '<input type="hidden" name="knowledgeSpaceId" value="018f0d60-7a49-7cc2-9c1b-5b36f18f2c42"',
    );
    expect(html).not.toContain('action="/api/bff/knowledge-spaces/workspace/documents"');
  });

  it("renders reasoning tree-search traces from answer trace metadata", async () => {
    const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: true },
          ok: true,
          runtime: "node-docker",
        });
      }

      if (request.url === "http://localhost:8788/knowledge-spaces?limit=100") {
        return Response.json({
          items: [
            {
              createdAt: "2026-05-21T00:00:00.000Z",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
              name: "Workspace",
              slug: "workspace",
              tenantId: "tenant-dev",
              updatedAt: "2026-05-21T00:00:00.000Z",
            },
          ],
        });
      }

      if (request.url === `http://localhost:8788/queries/${traceId}`) {
        return Response.json({
          createdAt: "2026-06-22T00:00:00.000Z",
          id: traceId,
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          mode: "research",
          query: "research refund approvals",
          steps: [
            {
              metadata: {
                evidenceBundle: {
                  items: [
                    {
                      metadata: {
                        reasoningTreeSearch: {
                          fallbackHybridCandidateNodeIds: ["leaf-refunds"],
                          finalEvidenceNodeIds: ["leaf-refunds"],
                          inspectedNodeIds: ["outline-guide", "outline-guide-refunds"],
                          openedRanges: [
                            {
                              endOffset: 180,
                              outlineNodeId: "outline-guide-refunds",
                              sectionPath: ["Guide", "Refunds"],
                              startOffset: 20,
                              startPage: 2,
                            },
                          ],
                          reasoning: "Selected the deepest document outline node.",
                          selectedNodeId: "outline-guide-refunds",
                          selectedSectionPath: ["Guide", "Refunds"],
                          strategy: "document-outline-guided-v1",
                        },
                      },
                    },
                  ],
                },
                metrics: { fusedCandidates: 3 },
                mode: "research",
              },
              name: "query.generate",
              startedAt: "2026-06-22T00:00:00.000Z",
              status: "ok",
            },
          ],
        });
      }

      if (
        request.url === `http://localhost:8788/queries/${traceId}/evidence?limit=12` ||
        request.url === `http://localhost:8788/queries/${traceId}/missing?limit=12` ||
        request.url === `http://localhost:8788/queries/${traceId}/conflicts?limit=12`
      ) {
        return Response.json({ items: [], path: `/queries/${traceId}`, truncated: false });
      }

      if (request.url.includes("/fs/ls")) {
        const url = new URL(request.url);
        return Response.json({ items: [], path: url.searchParams.get("path"), truncated: false });
      }
      if (request.url.endsWith("/documents?limit=1")) {
        return Response.json({ items: [] });
      }
      if (request.url.includes("/golden-questions?limit=12")) {
        return Response.json({ items: [] });
      }
      if (request.url.endsWith("/manifest")) {
        return Response.json(adminManifest());
      }
      if (request.url.endsWith("/status")) {
        return Response.json(adminStatus());
      }
      if (request.url.endsWith("/staged-commits?limit=5")) {
        return Response.json(adminStagedCommits());
      }
      if (request.url.endsWith("/leases/active?limit=5")) {
        return Response.json(adminActiveLeases());
      }
      if (request.url.endsWith("/fsck?check=raw-objects")) {
        return Response.json(adminFsck());
      }
      if (request.url.endsWith("/gc/staged-objects")) {
        return Response.json(adminGcDryRun());
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(
      await AdminHome({ searchParams: Promise.resolve({ traceId }) }),
    );

    expect(html).toContain("Reasoning tree search trace");
    expect(html).toContain("document-outline-guided-v1");
    expect(html).toContain("Guide / Refunds");
    expect(html).toContain("outline-guide / outline-guide-refunds");
    expect(html).toContain("Guide / Refunds (page 2 offset 20-180)");
    expect(html).toContain("Selected the deepest document outline node.");
    expect(html).toContain("leaf-refunds");
  });

  it("renders semantic views as readable topic and entity summaries", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: true },
          ok: true,
          runtime: "node-docker",
        });
      }

      if (request.url === "http://localhost:8788/knowledge-spaces?limit=100") {
        return Response.json({
          items: [
            {
              createdAt: "2026-05-21T00:00:00.000Z",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
              name: "Workspace",
              slug: "workspace",
              tenantId: "tenant-dev",
              updatedAt: "2026-05-21T00:00:00.000Z",
            },
          ],
        });
      }

      if (request.url.includes("path=%2Fknowledge%2Fby-topic")) {
        return Response.json({
          items: [
            {
              kind: "directory",
              metadata: {
                topicName: "Uploaded Documents",
                topicSlug: "uploaded-documents",
              },
              name: "uploaded-documents",
              path: "/knowledge/by-topic/uploaded-documents",
            },
          ],
          path: "/knowledge/by-topic",
          truncated: true,
        });
      }

      if (request.url.includes("path=%2Fknowledge%2Fby-entity")) {
        return Response.json({
          items: [
            {
              kind: "directory",
              metadata: {
                entityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
                sourceNodeCount: 2,
                type: "organization",
              },
              name: "Acme",
              path: "/knowledge/by-entity/018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
              targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
            },
            {
              kind: "directory",
              metadata: {
                entityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
                sourceNodeCount: 1,
                type: "metric",
              },
              name: "04",
              path: "/knowledge/by-entity/018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
              targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
            },
          ],
          path: "/knowledge/by-entity",
          truncated: false,
        });
      }

      if (request.url.includes("path=%2Fknowledge%2Fby-community")) {
        return Response.json({
          items: [
            {
              kind: "directory",
              metadata: {
                documentCount: 2,
                entityCount: 3,
                summary: "Acme and Atlas Search are discussed together for renewal risk.",
                title: "Acme renewal risk",
              },
              name: "acme-renewal-risk",
              path: "/knowledge/by-community/acme-renewal-risk",
            },
          ],
          path: "/knowledge/by-community",
          truncated: false,
        });
      }

      if (request.url.includes("/fs/ls")) {
        return Response.json({ items: [], path: "/knowledge", truncated: false });
      }
      if (request.url.includes("/golden-questions?limit=12")) {
        return Response.json({ items: [] });
      }
      if (request.url.endsWith("/manifest")) {
        return Response.json(adminManifest());
      }
      if (request.url.endsWith("/status")) {
        return Response.json(adminStatus());
      }
      if (request.url.endsWith("/staged-commits?limit=5")) {
        return Response.json(adminStagedCommits());
      }
      if (request.url.endsWith("/leases/active?limit=5")) {
        return Response.json(adminActiveLeases());
      }
      if (request.url.endsWith("/fsck?check=raw-objects")) {
        return Response.json(adminFsck());
      }
      if (request.url.endsWith("/gc/staged-objects")) {
        return Response.json(adminGcDryRun());
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Topic groups");
    expect(html).toContain("Uploaded Documents");
    expect(html).toContain("Document collection");
    expect(html).toContain("Knowledge communities");
    expect(html).toContain("Acme renewal risk");
    expect(html).toContain("Acme and Atlas Search are discussed together for renewal risk.");
    expect(html).toContain("Readable entities");
    expect(html).toContain("Acme");
    expect(html).toContain("Organization - seen in 2 nodes");
    expect(html).toContain("Hidden numeric noise");
    expect(html).not.toContain(">04</strong>");
  });

  it("renders live workspace data when available", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: true },
          ok: true,
          runtime: "node-docker",
        });
      }

      return Response.json({
        items: [
          {
            createdAt: "2026-05-21T00:00:00.000Z",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            name: "Workspace",
            slug: "workspace",
            tenantId: "tenant-dev",
            updatedAt: "2026-05-21T00:00:00.000Z",
          },
          {
            createdAt: "2026-05-21T00:00:00.000Z",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
            name: "Support KB",
            slug: "support",
            tenantId: "tenant-dev",
            updatedAt: "2026-05-21T00:00:00.000Z",
          },
        ],
      });
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Support KB");
  });

  it("renders live component health when available", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: {
            database: false,
            objectStorage: true,
            parser: true,
            reranker: false,
          },
          ok: false,
          runtime: "node-docker",
        });
      }

      if (request.url === "http://localhost:8788/knowledge-spaces?limit=100") {
        return Response.json({ items: [] });
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Degraded");
    expect(html).toContain("Node Docker");
    expect(html).toContain("Database");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Object store");
    expect(html).toContain("Writable");
    expect(html).toContain("Parser");
    expect(html).toContain("Ready");
    expect(html).toContain("Reranker");
    expect(html).toContain("Fallback");
  });

  it("renders upload success details from redirect search params", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("API unavailable in shell render test");
    });

    const html = renderToStaticMarkup(
      await AdminHome({
        searchParams: Promise.resolve({
          documentId: "asset-1",
          filename: "roadmap.md",
          parserStatus: "parsed",
          sha256: "a".repeat(64),
          sizeBytes: "12345",
          spaceId: "space-1",
          uploadStatus: "success",
          version: "1",
        }),
      }),
    );

    expect(html).toContain("Upload result");
    expect(html).toContain("roadmap.md");
    expect(html).toContain("parsed");
    expect(html).toContain("12.1 KiB");
    expect(html).toContain("asset-1");
    expect(html).toContain("aaaaaaaaaaaa");
    expect(html).toContain("/documents/space-1/asset-1");
    expect(html).toContain("/documents/space-1/asset-1/parse-artifacts/1");
    expect(html).toContain("Latest upload");
  });

  it("loads publish readiness from the latest live document when no upload redirect is present", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);

      if (request.url === "http://localhost:8788/health") {
        return Response.json({
          components: { database: true, objectStorage: true, parser: true, reranker: true },
          ok: true,
          runtime: "node-docker",
        });
      }
      if (request.url === "http://localhost:8788/knowledge-spaces?limit=100") {
        return Response.json({ items: [] });
      }
      if (request.url === "http://localhost:8788/knowledge-spaces/workspace/documents?limit=1") {
        return Response.json({
          items: [
            {
              createdAt: "2026-05-29T00:00:00.000Z",
              filename: "roadmap.md",
              id: "asset-1",
              knowledgeSpaceId: "workspace",
              metadata: {},
              mimeType: "text/markdown",
              objectKey: "tenant/spaces/workspace/documents/asset-1/roadmap.md",
              parserStatus: "parsed",
              sha256: "a".repeat(64),
              sizeBytes: 2048,
              version: 1,
            },
          ],
        });
      }
      if (
        request.url ===
        "http://localhost:8788/knowledge-spaces/workspace/documents/asset-1/parse-artifacts/1"
      ) {
        return Response.json({
          artifactHash: "b".repeat(64),
          contentType: "text",
          createdAt: "2026-05-29T00:00:00.000Z",
          documentAssetId: "asset-1",
          elements: [
            { id: "el-1", metadata: {}, sectionPath: [], text: "Intro", type: "paragraph" },
            { id: "el-2", metadata: {}, sectionPath: ["Plan"], text: "Plan", type: "paragraph" },
          ],
          id: "artifact-1",
          metadata: {},
          parser: "native-markdown",
          version: 1,
        });
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const html = renderToStaticMarkup(await AdminHome({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Latest document: roadmap.md");
    expect(html).toContain("2.0 KiB");
    expect(html).toContain("<strong>Parse elements</strong><span>2</span>");
    expect(html).toContain("<strong>Node count</strong><span>2</span>");
    expect(html).toContain("<strong>Quality risks</strong><span>None</span>");
  });

  it("renders upload errors from redirect search params", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("API unavailable in shell render test");
    });

    const html = renderToStaticMarkup(
      await AdminHome({
        searchParams: Promise.resolve({
          uploadError: "Document parsing failed",
          uploadStatus: "error",
        }),
      }),
    );

    expect(html).toContain("Upload failed");
    expect(html).toContain("Document parsing failed");
  });

  it("renders query results from redirect search params", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("API unavailable in shell render test");
    });

    const html = renderToStaticMarkup(
      await AdminHome({
        searchParams: Promise.resolve({
          answer: "The roadmap moved ingestion into the local happy path.",
          citations: "trace-1,session-1",
          confidence: "Generated",
          freshness: "Live query",
          query: "What changed?",
          queryStatus: "success",
          traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
        }),
      }),
    );

    expect(html).toContain("The roadmap moved ingestion into the local happy path.");
    expect(html).toContain("trace-1, session-1");
    expect(html).toContain("Generated");
    expect(html).toContain("Live query");
    expect(html).toContain("018f0d60-7a49-7cc2-9c1b-5b36f18f8a01");
    expect(html).toContain("/api/bff/queries/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01");
    expect(html).not.toContain("/api/bff/traces/018f0d60-7a49-7cc2-9c1b-5b36f18f8a01");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    process.env[name] = "";
    return;
  }

  process.env[name] = value;
}

function adminManifest() {
  return {
    consistencyPolicy: { defaultClass: "path-consistent" },
    manifestVersion: 1,
    objectKeyPrefix: "tenant-dev/spaces/workspace",
    parserPolicyVersion: "default-v1",
    projectionSetVersion: "default-v1",
    quotaPolicy: { maxRawDocumentBytes: null },
    storageProvider: "memory-dev",
  };
}

function adminStatus() {
  return {
    runtime: { activeSessionCount: 0 },
    storage: { documentCount: 2, rawDocumentBytes: 42 },
  };
}

function adminStagedCommits() {
  return {
    items: [
      {
        errorCode: "parser_timeout",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fad10",
        idempotencyKey: "upload:doc-1",
        operationType: "document-upload",
        status: "failed-retryable",
        updatedAt: "2026-05-27T11:01:00.000Z",
      },
    ],
  };
}

function adminActiveLeases() {
  return {
    items: [
      {
        expiresAt: "2026-05-27T11:30:00.000Z",
        heartbeatAt: "2026-05-27T11:05:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fae10",
        leaseType: "publish",
        status: "active",
        targetId: "staged-commit-1",
        targetType: "staged-commit",
        virtualPath: "/sources/staged/doc-1",
      },
    ],
  };
}

function adminFsck() {
  return {
    issues: [
      {
        code: "missing_raw_object",
        message: "Raw object is missing.",
        repairability: "manual",
        severity: "error",
        target: {
          objectKey: "tenant-dev/spaces/workspace/documents/missing.md",
          type: "raw-object",
        },
        type: "missing-raw-object",
      },
      {
        code: "missing_raw_object",
        message: "Raw object is missing.",
        repairability: "manual",
        severity: "error",
        target: {
          objectKey: "tenant-dev/spaces/workspace/documents/also-missing.md",
          type: "raw-object",
        },
        type: "missing-raw-object",
      },
    ],
    knowledgeSpaceId: "workspace",
    scannedAt: "2026-05-27T11:05:00.000Z",
    summary: { critical: 0, error: 2, info: 0, repairable: 0, scanned: 2, warning: 0 },
    tenantId: "tenant-dev",
  };
}

function adminGcDryRun() {
  return {
    candidates: [
      {
        candidateType: "staged-object",
        count: 1,
        estimatedBytes: 12,
        idempotencyKey: "staged-object:doc-1",
        reason: "expired staged object",
        target: {
          objectKey: "tenant-dev/spaces/workspace/staging/doc-1.md",
          type: "staged-object",
        },
      },
    ],
    dryRunId: "gc-dry-run-1",
    generatedAt: "2026-05-27T11:05:00.000Z",
    knowledgeSpaceId: "workspace",
    summary: {
      candidateCount: 1,
      estimatedBytes: 12,
      failedCommitCount: 0,
      stagedObjectCount: 1,
    },
    tenantId: "tenant-dev",
  };
}
