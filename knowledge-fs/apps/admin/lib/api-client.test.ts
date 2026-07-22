import { describe, expect, it } from "vitest";

import {
  createAdminApiClient,
  getAdminApiBase,
  getAdminPublicApiBase,
  parseSseEvents,
} from "./api-client";

describe("createAdminApiClient", () => {
  it("calls Hono health and knowledge-space APIs through a bounded shared client", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url === "http://api.test/health") {
          return Response.json({
            components: { database: true },
            ok: true,
            runtime: "node-docker",
          });
        }

        if (request.url === "http://api.test/knowledge-spaces?limit=2") {
          return Response.json({
            items: [
              {
                createdAt: "2026-05-11T00:00:00.000Z",
                id: "space-1",
                name: "Workspace",
                slug: "workspace",
                tenantId: "tenant-1",
                updatedAt: "2026-05-11T00:00:00.000Z",
              },
            ],
          });
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
    });

    await expect(client.health()).resolves.toMatchObject({
      ok: true,
      runtime: "node-docker",
    });
    await expect(client.listKnowledgeSpaces({ limit: 2, token: "secret-token" })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "space-1",
          slug: "workspace",
        }),
      ],
    });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/health"],
      ["GET", "http://api.test/knowledge-spaces?limit=2"],
    ]);
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer secret-token");
  });

  it("loads KnowledgeSpace manifest and status summaries", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url === "http://api.test/knowledge-spaces/space-1/manifest") {
          return Response.json({
            consistencyPolicy: { defaultClass: "path-consistent" },
            manifestVersion: 1,
            objectKeyPrefix: "tenant-1/spaces/space-1",
            parserPolicyVersion: "default-v1",
            projectionSetVersion: "projection-v1",
            quotaPolicy: { maxRawDocumentBytes: null },
            storageProvider: "memory-dev",
          });
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/status") {
          return Response.json({
            runtime: { activeSessionCount: 2 },
            storage: { documentCount: 3, rawDocumentBytes: 42 },
          });
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/staged-commits?limit=5") {
          return Response.json({
            items: [
              {
                errorCode: "parser_timeout",
                id: "commit-1",
                idempotencyKey: "upload:doc-1",
                operationType: "document-upload",
                status: "failed-retryable",
                updatedAt: "2026-05-27T11:01:00.000Z",
              },
            ],
          });
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/leases/active?limit=5") {
          return Response.json({
            items: [
              {
                expiresAt: "2026-05-27T11:30:00.000Z",
                heartbeatAt: "2026-05-27T11:05:00.000Z",
                id: "lease-1",
                leaseType: "publish",
                status: "active",
                targetId: "commit-1",
                targetType: "staged-commit",
                virtualPath: "/sources/staged/doc-1",
              },
            ],
          });
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/fsck?check=raw-objects") {
          return Response.json({
            issues: [
              {
                code: "missing_raw_object",
                message: "Raw object is missing.",
                repairability: "manual",
                severity: "error",
                target: {
                  objectKey: "tenant-1/spaces/space-1/documents/missing.md",
                  type: "raw-object",
                },
                type: "missing-raw-object",
              },
            ],
            knowledgeSpaceId: "space-1",
            scannedAt: "2026-05-27T11:05:00.000Z",
            summary: { critical: 0, error: 1, info: 0, repairable: 0, scanned: 1, warning: 0 },
            tenantId: "tenant-1",
          });
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/gc/staged-objects") {
          return Response.json(adminGcDryRun());
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/gc/staged-objects/execute") {
          await expect(request.json()).resolves.toEqual({
            candidates: [adminGcCandidate()],
          });
          return Response.json({
            deleted: 1,
            items: [
              {
                idempotencyKey: "staged-object:doc-1",
                objectKey: "tenant-1/spaces/space-1/staging/doc-1.md",
                status: "deleted",
              },
            ],
            skipped: 0,
            tenantId: "tenant-1",
          });
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
    });

    await expect(
      client.getKnowledgeSpaceManifest({ knowledgeSpaceId: "space-1", token: "secret-token" }),
    ).resolves.toMatchObject({
      manifestVersion: 1,
      projectionSetVersion: "projection-v1",
    });
    await expect(
      client.getKnowledgeSpaceStatus({ knowledgeSpaceId: "space-1", token: "secret-token" }),
    ).resolves.toMatchObject({
      runtime: { activeSessionCount: 2 },
      storage: { rawDocumentBytes: 42 },
    });
    await expect(
      client.listStagedCommits({ knowledgeSpaceId: "space-1", limit: 5, token: "secret-token" }),
    ).resolves.toMatchObject({
      items: [{ errorCode: "parser_timeout", id: "commit-1" }],
    });
    await expect(
      client.listActiveLeases({ knowledgeSpaceId: "space-1", limit: 5, token: "secret-token" }),
    ).resolves.toMatchObject({
      items: [{ id: "lease-1", leaseType: "publish", targetType: "staged-commit" }],
    });
    await expect(
      client.getKnowledgeFsck({
        check: "raw-objects",
        knowledgeSpaceId: "space-1",
        token: "secret-token",
      }),
    ).resolves.toMatchObject({
      issues: [{ code: "missing_raw_object", severity: "error" }],
      summary: { error: 1, scanned: 1 },
    });
    await expect(
      client.getStagedObjectGcDryRun({
        knowledgeSpaceId: "space-1",
        token: "secret-token",
      }),
    ).resolves.toMatchObject({
      candidates: [{ idempotencyKey: "staged-object:doc-1" }],
      dryRunId: "gc-dry-run-1",
    });
    await expect(
      client.executeStagedObjectGc({
        candidates: [adminGcCandidate()],
        dryRunId: "gc-dry-run-1",
        idempotencyKey: "staged-object:doc-1",
        knowledgeSpaceId: "space-1",
        token: "secret-token",
      }),
    ).resolves.toMatchObject({
      deleted: 1,
      items: [{ status: "deleted" }],
    });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces/space-1/manifest"],
      ["GET", "http://api.test/knowledge-spaces/space-1/status"],
      ["GET", "http://api.test/knowledge-spaces/space-1/staged-commits?limit=5"],
      ["GET", "http://api.test/knowledge-spaces/space-1/leases/active?limit=5"],
      ["GET", "http://api.test/knowledge-spaces/space-1/fsck?check=raw-objects"],
      ["GET", "http://api.test/knowledge-spaces/space-1/gc/staged-objects"],
      ["POST", "http://api.test/knowledge-spaces/space-1/gc/staged-objects/execute"],
    ]);
  });

  it("loads document outlines for the Admin outline browser", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        expect(request.url).toBe(
          "http://api.test/knowledge-spaces/space-1/documents/doc-1/outline",
        );
        expect(request.headers.get("authorization")).toBe("Bearer secret-token");

        return Response.json({
          artifactHash: "c".repeat(64),
          createdAt: "2026-06-22T00:00:00.000Z",
          documentAssetId: "doc-1",
          id: "outline-1",
          knowledgeSpaceId: "space-1",
          metadata: { builder: "deterministic-parse-artifact" },
          nodes: [
            {
              childNodeIds: ["outline-child"],
              children: [
                {
                  childNodeIds: [],
                  children: [],
                  id: "outline-child",
                  level: 2,
                  metadata: {},
                  sectionPath: ["Guide", "Refunds"],
                  sourceElementIds: ["element-2"],
                  sourceNodeIds: [],
                  startPage: 2,
                  summary: "Refund approval summary.",
                  title: "Refunds",
                  titleLocation: {
                    confidence: 1,
                    pageNumber: 2,
                    source: "parser-heading",
                    startOffset: 20,
                  },
                  tocSource: "parser-heading",
                },
              ],
              id: "outline-root",
              level: 1,
              metadata: {},
              sectionPath: ["Guide"],
              sourceElementIds: ["element-1"],
              sourceNodeIds: [],
              startPage: 1,
              summary: "Guide summary.",
              title: "Guide",
              tocSource: "parser-heading",
            },
          ],
          outlineVersion: "document-outline-v1",
          parseArtifactId: "artifact-1",
          version: 1,
        });
      },
    });

    await expect(
      client.getDocumentOutline({
        documentId: "doc-1",
        knowledgeSpaceId: "space-1",
        token: "secret-token",
      }),
    ).resolves.toMatchObject({
      documentAssetId: "doc-1",
      nodes: [
        {
          children: [
            {
              sectionPath: ["Guide", "Refunds"],
              startPage: 2,
              summary: "Refund approval summary.",
            },
          ],
          title: "Guide",
        },
      ],
    });
    expect(requests).toHaveLength(1);
  });

  it("loads document multimodal manifests for the Admin multimodal browser", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        expect(request.url).toBe(
          "http://api.test/knowledge-spaces/space-1/documents/doc-1/multimodal",
        );
        expect(request.headers.get("authorization")).toBe("Bearer secret-token");

        return Response.json({
          artifactHash: "c".repeat(64),
          createdAt: "2026-06-22T00:00:00.000Z",
          documentAssetId: "doc-1",
          id: "manifest-1",
          items: [
            {
              assetRef: {
                contentType: "image/png",
                objectKey: "tenant-1/spaces/space-1/documents/doc-1/assets/item-1.png",
                sha256: "a".repeat(64),
                variants: {
                  thumbnail: {
                    contentType: "image/png",
                    height: 90,
                    objectKey:
                      "tenant-1/spaces/space-1/documents/doc-1/assets/item-1-thumbnail.png",
                    sha256: "b".repeat(64),
                    width: 120,
                  },
                },
              },
              boundingBox: { height: 120, width: 240, x: 10, y: 20 },
              caption: "Renewal trend chart",
              endOffset: 420,
              enrichment: {
                asset: "provided",
                caption: "provided",
                ocr: "provided",
                tableStructure: "unsupported",
                visualEmbedding: "missing",
              },
              id: "item-1",
              modality: "image",
              ocrText: "Q1 renewals increased 12%",
              pageNumber: 3,
              parseElementId: "element-image-1",
              sectionPath: ["Metrics", "Charts"],
              sourceMetadata: {
                enrichment: {
                  error: "provider quota exceeded",
                  provider: "failing-understanding",
                  status: "failed",
                },
              },
              startOffset: 120,
              textPreview: "Q1 renewals increased 12%",
              title: "Renewal trend chart",
            },
          ],
          knowledgeSpaceId: "space-1",
          manifestVersion: "document-multimodal-manifest-v1",
          metadata: { modalityCounts: { image: 1 } },
          parseArtifactId: "artifact-1",
          version: 1,
        });
      },
    });

    await expect(
      client.getDocumentMultimodalManifest({
        documentId: "doc-1",
        knowledgeSpaceId: "space-1",
        token: "secret-token",
      }),
    ).resolves.toMatchObject({
      documentAssetId: "doc-1",
      items: [
        {
          assetRef: {
            contentType: "image/png",
            objectKey: "tenant-1/spaces/space-1/documents/doc-1/assets/item-1.png",
            sha256: "a".repeat(64),
            variants: {
              thumbnail: {
                height: 90,
                objectKey: "tenant-1/spaces/space-1/documents/doc-1/assets/item-1-thumbnail.png",
                width: 120,
              },
            },
          },
          boundingBox: { height: 120, width: 240, x: 10, y: 20 },
          caption: "Renewal trend chart",
          endOffset: 420,
          modality: "image",
          pageNumber: 3,
          sectionPath: ["Metrics", "Charts"],
          sourceMetadata: {
            enrichment: {
              error: "provider quota exceeded",
              provider: "failing-understanding",
              status: "failed",
            },
          },
          startOffset: 120,
        },
      ],
      manifestVersion: "document-multimodal-manifest-v1",
    });
    expect(requests).toHaveLength(1);
  });

  it("loads document multimodal assets for Admin previews", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        expect(request.url).toBe(
          requests.length === 1
            ? "http://api.test/knowledge-spaces/space-1/documents/doc-1/multimodal/artifact-1%3A0%3Afigure-1/asset"
            : "http://api.test/knowledge-spaces/space-1/documents/doc-1/multimodal/artifact-1%3A0%3Afigure-1/asset?variant=thumbnail",
        );
        expect(request.headers.get("authorization")).toBe("Bearer secret-token");

        return new Response(
          requests.length === 1 ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5, 6]),
          {
            headers: {
              "content-length": "3",
              "content-type": "image/png",
              "x-document-multimodal-item-id": "artifact-1:0:figure-1",
              ...(requests.length === 1
                ? {}
                : { "x-document-multimodal-asset-variant": "thumbnail" }),
            },
          },
        );
      },
      maxAssetBytes: 16,
    });

    const asset = await client.getDocumentMultimodalAsset({
      documentId: "doc-1",
      itemId: "artifact-1:0:figure-1",
      knowledgeSpaceId: "space-1",
      token: "secret-token",
    });
    const thumbnail = await client.getDocumentMultimodalAsset({
      documentId: "doc-1",
      itemId: "artifact-1:0:figure-1",
      knowledgeSpaceId: "space-1",
      token: "secret-token",
      variant: "thumbnail",
    });

    expect(asset.contentType).toBe("image/png");
    expect(asset.itemId).toBe("artifact-1:0:figure-1");
    expect([...new Uint8Array(asset.bytes)]).toEqual([1, 2, 3]);
    expect(thumbnail.contentType).toBe("image/png");
    expect(thumbnail.itemId).toBe("artifact-1:0:figure-1");
    expect([...new Uint8Array(thumbnail.bytes)]).toEqual([4, 5, 6]);
    expect(requests).toHaveLength(2);
  });

  it("rejects empty document multimodal asset variants", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async () =>
        new Response(new Uint8Array([1]), {
          headers: {
            "content-length": "1",
            "content-type": "image/png",
            "x-document-multimodal-item-id": "artifact-1:0:figure-1",
          },
        }),
      maxAssetBytes: 16,
    });

    await expect(
      client.getDocumentMultimodalAsset({
        documentId: "doc-1",
        itemId: "artifact-1:0:figure-1",
        knowledgeSpaceId: "space-1",
        token: "secret-token",
        variant: "",
      }),
    ).rejects.toThrow("Admin API document multimodal asset variant must not be empty");
  });

  it("rejects empty document multimodal asset item ids", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async () =>
        new Response(new Uint8Array([1]), {
          headers: {
            "content-length": "1",
            "content-type": "image/png",
            "x-document-multimodal-item-id": "artifact-1:0:figure-1",
          },
        }),
      maxAssetBytes: 16,
    });

    await expect(
      client.getDocumentMultimodalAsset({
        documentId: "doc-1",
        itemId: "",
        knowledgeSpaceId: "space-1",
        token: "secret-token",
      }),
    ).rejects.toThrow("Admin API document multimodal itemId must not be empty");
  });

  it("streams query SSE events and rejects unbounded inputs", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://api.test/queries");
        expect(request.headers.get("authorization")).toBe("Bearer read-token");
        await expect(request.json()).resolves.toEqual({
          knowledgeSpaceId: "space-1",
          mode: "fast",
          query: "What changed?",
        });

        return new Response(
          [
            'event: answer.delta\ndata: {"delta":"Hello"}',
            'event: answer.done\ndata: {"finishReason":"stop"}',
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    await expect(
      client.streamQuery({
        knowledgeSpaceId: "space-1",
        mode: "fast",
        query: "What changed?",
        token: "read-token",
      }),
    ).resolves.toEqual([
      { data: { delta: "Hello" }, event: "answer.delta" },
      { data: { finishReason: "stop" }, event: "answer.done" },
    ]);
    expect(() => createAdminApiClient({ baseUrl: " " })).toThrow("Admin API baseUrl is required");
    await expect(client.listKnowledgeSpaces({ limit: 101, token: "secret-token" })).rejects.toThrow(
      "Admin API listKnowledgeSpaces limit must be between 1 and 100",
    );
    await expect(
      client.streamQuery({
        knowledgeSpaceId: "space-1",
        query: "x".repeat(4_001),
        token: "read-token",
      }),
    ).rejects.toThrow("Admin API query exceeds maxQueryBytes=4000");
  });

  it("loads answer traces and query virtual evidence trees", async () => {
    const requests: Request[] = [];
    const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
    const client = createAdminApiClient({
      baseUrl: "http://api.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url === `http://api.test/queries/${traceId}`) {
          expect(request.headers.get("authorization")).toBe("Bearer read-token");
          return Response.json({
            createdAt: "2026-05-13T00:00:00.000Z",
            evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
            id: traceId,
            knowledgeSpaceId: "space-1",
            mode: "research",
            query: "What changed?",
            steps: [
              {
                metadata: { count: 4 },
                name: "recall.candidates",
                startedAt: "2026-05-13T00:00:00.000Z",
                status: "ok",
              },
            ],
          });
        }

        if (request.url === `http://api.test/queries/${traceId}/evidence?limit=2`) {
          return Response.json({
            items: [
              {
                kind: "resource",
                metadata: { score: 0.9 },
                name: "roadmap.md#L4",
                path: `/queries/${traceId}/evidence/roadmap.md`,
                resourceType: "evidence-bundle",
                targetId: "evidence-1",
              },
            ],
            path: `/queries/${traceId}/evidence`,
            truncated: false,
          });
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
    });

    await expect(client.getAnswerTrace({ token: "read-token", traceId })).resolves.toMatchObject({
      id: traceId,
      mode: "research",
      steps: [{ name: "recall.candidates", metadata: { count: 4 } }],
    });
    await expect(
      client.listQueryEvidence({ limit: 2, token: "read-token", traceId }),
    ).resolves.toMatchObject({
      items: [{ name: "roadmap.md#L4", resourceType: "evidence-bundle" }],
      truncated: false,
    });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", `http://api.test/queries/${traceId}`],
      ["GET", `http://api.test/queries/${traceId}/evidence?limit=2`],
    ]);
  });

  it("rejects oversized SSE responses while reading stream chunks", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("event: answer.delta\n"));
              controller.enqueue(
                new TextEncoder().encode('data: {"delta":"this is too large"}\n\n'),
              );
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      maxSseBytes: 16,
    });

    await expect(
      client.streamQuery({
        knowledgeSpaceId: "space-1",
        query: "What changed?",
        token: "read-token",
      }),
    ).rejects.toThrow("Admin API SSE response exceeds maxSseBytes=16");
  });

  it("rejects oversized JSON responses while reading stream chunks", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"items":['));
              controller.enqueue(new TextEncoder().encode('"too large"'));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      maxJsonBytes: 12,
    });

    await expect(client.listKnowledgeSpaces({ limit: 1, token: "secret-token" })).rejects.toThrow(
      "Admin API JSON response exceeds maxJsonBytes=12",
    );
  });

  it("uploads a single document and reads document ingestion state", async () => {
    const requests: Request[] = [];
    const asset = {
      createdAt: "2026-05-11T00:00:00.000Z",
      filename: "roadmap.md",
      id: "asset-1",
      knowledgeSpaceId: "space-1",
      metadata: { traceId: "trace-1" },
      mimeType: "text/markdown",
      objectKey: "tenant/spaces/space-1/documents/asset-1/roadmap.md",
      parserStatus: "parsed",
      sha256: "a".repeat(64),
      sizeBytes: 12,
      version: 1,
    };
    const artifact = {
      artifactHash: "b".repeat(64),
      contentType: "text",
      createdAt: "2026-05-11T00:00:00.000Z",
      documentAssetId: "asset-1",
      elements: [
        { id: "el-1", metadata: {}, sectionPath: ["Intro"], text: "Hello", type: "paragraph" },
      ],
      id: "artifact-1",
      metadata: { traceId: "trace-1" },
      parser: "native-markdown",
      version: 1,
    };
    const client = createAdminApiClient({
      baseUrl: "http://api.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (
          request.method === "POST" &&
          request.url === "http://api.test/knowledge-spaces/space-1/documents"
        ) {
          const body = await request.formData();
          expect(request.headers.get("authorization")).toBe("Bearer write-token");
          expect(body.get("sourceId")).toBe("source-1");
          expect(body.get("file")).toBeInstanceOf(File);
          return Response.json(asset, { status: 201 });
        }

        if (
          request.method === "GET" &&
          request.url ===
            "http://api.test/knowledge-spaces/space-1/documents?limit=5&cursor=asset-1"
        ) {
          expect(request.headers.get("authorization")).toBe("Bearer read-token");
          return Response.json({ items: [asset], nextCursor: "asset-2" });
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/documents/asset-1") {
          return Response.json(asset);
        }

        if (
          request.url ===
          "http://api.test/knowledge-spaces/space-1/documents/asset-1/parse-artifacts/1"
        ) {
          return Response.json(artifact);
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
      maxUploadBytes: 16,
    });

    await expect(
      client.uploadDocument({
        file: new File(["hello upload"], "roadmap.md", { type: "text/markdown" }),
        knowledgeSpaceId: "space-1",
        sourceId: "source-1",
        token: "write-token",
      }),
    ).resolves.toMatchObject({ filename: "roadmap.md", parserStatus: "parsed" });
    await expect(
      client.getDocument({
        documentId: "asset-1",
        knowledgeSpaceId: "space-1",
        token: "read-token",
      }),
    ).resolves.toMatchObject({ id: "asset-1" });
    await expect(
      client.listDocuments({
        cursor: "asset-1",
        knowledgeSpaceId: "space-1",
        limit: 5,
        token: "read-token",
      }),
    ).resolves.toMatchObject({ items: [{ id: "asset-1" }], nextCursor: "asset-2" });
    await expect(
      client.getParseArtifact({
        documentId: "asset-1",
        knowledgeSpaceId: "space-1",
        token: "read-token",
        version: 1,
      }),
    ).resolves.toMatchObject({ documentAssetId: "asset-1", elements: artifact.elements });
    await expect(
      client.uploadDocument({
        file: new File(["x".repeat(17)], "large.md", { type: "text/markdown" }),
        knowledgeSpaceId: "space-1",
        token: "write-token",
      }),
    ).rejects.toThrow("Admin API upload exceeds maxUploadBytes=16");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://api.test/knowledge-spaces/space-1/documents"],
      ["GET", "http://api.test/knowledge-spaces/space-1/documents/asset-1"],
      ["GET", "http://api.test/knowledge-spaces/space-1/documents?limit=5&cursor=asset-1"],
      ["GET", "http://api.test/knowledge-spaces/space-1/documents/asset-1/parse-artifacts/1"],
    ]);
  });

  it("manages golden questions with bounded CRUD requests", async () => {
    const requests: Request[] = [];
    const goldenQuestion = {
      createdAt: "2026-05-12T00:00:00.000Z",
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      knowledgeSpaceId: "space-1",
      metadata: { owner: "qa" },
      question: "What does the roadmap require?",
      tags: ["roadmap", "phase-6"],
      updatedAt: "2026-05-12T00:00:00.000Z",
    };
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url === "http://api.test/knowledge-spaces/space-1/golden-questions?limit=2") {
          expect(request.method).toBe("GET");
          expect(request.headers.get("authorization")).toBe("Bearer read-token");
          return Response.json({ items: [goldenQuestion], nextCursor: "cursor-1" });
        }

        if (request.url === "http://api.test/knowledge-spaces/space-1/golden-questions") {
          expect(request.method).toBe("POST");
          expect(request.headers.get("authorization")).toBe("Bearer write-token");
          await expect(request.json()).resolves.toEqual({
            expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
            metadata: { owner: "qa" },
            question: "What does the roadmap require?",
            tags: ["roadmap", "phase-6"],
          });
          return Response.json(goldenQuestion, { status: 201 });
        }

        if (
          request.url ===
          "http://api.test/knowledge-spaces/space-1/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01"
        ) {
          if (request.method === "GET") {
            expect(request.headers.get("authorization")).toBe("Bearer read-token");
            return Response.json(goldenQuestion);
          }

          if (request.method === "PATCH") {
            expect(request.headers.get("authorization")).toBe("Bearer write-token");
            await expect(request.json()).resolves.toEqual({
              expectedEvidenceIds: [],
              question: "Updated roadmap question",
              tags: ["updated"],
            });
            return Response.json({ ...goldenQuestion, question: "Updated roadmap question" });
          }

          if (request.method === "DELETE") {
            expect(request.headers.get("authorization")).toBe("Bearer write-token");
            return new Response(null, { status: 204 });
          }
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
      maxListLimit: 2,
    });

    await expect(
      client.listGoldenQuestions({
        knowledgeSpaceId: "space-1",
        limit: 2,
        token: "read-token",
      }),
    ).resolves.toMatchObject({
      items: [{ question: "What does the roadmap require?", tags: ["roadmap", "phase-6"] }],
      nextCursor: "cursor-1",
    });
    await expect(
      client.createGoldenQuestion({
        expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
        knowledgeSpaceId: "space-1",
        metadata: { owner: "qa" },
        question: "What does the roadmap require?",
        tags: ["roadmap", "phase-6"],
        token: "write-token",
      }),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01" });
    await expect(
      client.getGoldenQuestion({
        knowledgeSpaceId: "space-1",
        questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        token: "read-token",
      }),
    ).resolves.toMatchObject({ expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"] });
    await expect(
      client.updateGoldenQuestion({
        expectedEvidenceIds: [],
        knowledgeSpaceId: "space-1",
        question: "Updated roadmap question",
        questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        tags: ["updated"],
        token: "write-token",
      }),
    ).resolves.toMatchObject({ question: "Updated roadmap question" });
    await expect(
      client.deleteGoldenQuestion({
        knowledgeSpaceId: "space-1",
        questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        token: "write-token",
      }),
    ).resolves.toBe(true);
    await expect(
      client.listGoldenQuestions({
        knowledgeSpaceId: "space-1",
        limit: 3,
        token: "read-token",
      }),
    ).rejects.toThrow("Admin API golden question list limit must be between 1 and 2");
    await expect(
      client.createGoldenQuestion({
        knowledgeSpaceId: "space-1",
        question: " ",
        token: "write-token",
      }),
    ).rejects.toThrow("Admin API golden question is required");
    await expect(
      client.createGoldenQuestion({
        expectedEvidenceIds: ["not-a-node-id"],
        knowledgeSpaceId: "space-1",
        question: "What does the roadmap require?",
        token: "write-token",
      }),
    ).rejects.toThrow("Admin API expectedEvidenceId must be a UUID");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces/space-1/golden-questions?limit=2"],
      ["POST", "http://api.test/knowledge-spaces/space-1/golden-questions"],
      [
        "GET",
        "http://api.test/knowledge-spaces/space-1/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      ],
      [
        "PATCH",
        "http://api.test/knowledge-spaces/space-1/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      ],
      [
        "DELETE",
        "http://api.test/knowledge-spaces/space-1/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      ],
    ]);
  });

  it("surfaces structured Admin API validation messages", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async () =>
        Response.json(
          {
            error: {
              issues: [
                {
                  message: "Invalid UUID",
                  path: ["expectedEvidenceIds", 0],
                },
              ],
            },
          },
          { status: 400 },
        ),
    });

    await expect(
      client.createGoldenQuestion({
        expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
        knowledgeSpaceId: "space-1",
        question: "What does the roadmap require?",
        token: "write-token",
      }),
    ).rejects.toThrow(
      "Admin API request failed with status 400: expectedEvidenceIds.0: Invalid UUID",
    );
  });

  it("captures production bad cases into the evaluation queue", async () => {
    const requests: Request[] = [];
    const captured = {
      createdAt: "2026-05-13T14:00:00.000Z",
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a10",
      knowledgeSpaceId: "space-1",
      metadata: {
        reason: "Missed rollback evidence",
        source: "production-bad-case",
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      },
      question: "What changed after the production incident?",
      tags: ["production-bad-case", "needs-review", "incident-review"],
      updatedAt: "2026-05-13T14:00:00.000Z",
    };
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://api.test/knowledge-spaces/space-1/production-bad-cases");
        expect(request.headers.get("authorization")).toBe("Bearer write-token");
        await expect(request.json()).resolves.toEqual({
          reason: "Missed rollback evidence",
          tags: ["incident-review"],
          traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
        });
        return Response.json(captured, { status: 201 });
      },
    });

    await expect(
      client.captureProductionBadCase({
        knowledgeSpaceId: "space-1",
        reason: "Missed rollback evidence",
        tags: ["incident-review"],
        token: "write-token",
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      }),
    ).resolves.toMatchObject({
      metadata: {
        source: "production-bad-case",
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      },
      question: "What changed after the production incident?",
      tags: ["production-bad-case", "needs-review", "incident-review"],
    });
    await expect(
      client.captureProductionBadCase({
        knowledgeSpaceId: "space-1",
        token: "write-token",
        traceId: "not-a-uuid",
      }),
    ).rejects.toThrow("Admin API traceId must be a UUID");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://api.test/knowledge-spaces/space-1/production-bad-cases"],
    ]);
  });

  it("submits bounded human annotations for golden questions", async () => {
    const requests: Request[] = [];
    const annotated = {
      createdAt: "2026-05-13T15:00:00.000Z",
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a21"],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a21",
      knowledgeSpaceId: "space-1",
      metadata: {
        annotationSummary: {
          latestAnswerCorrectness: "incorrect",
          totalAnnotations: 1,
        },
        annotations: [
          {
            annotatedBy: "subject-1",
            answerCorrectness: "incorrect",
            evidenceRelevance: [
              { evidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a21", relevant: true },
            ],
          },
        ],
      },
      question: "Was the cited evidence relevant?",
      tags: ["annotated"],
      updatedAt: "2026-05-13T15:01:00.000Z",
    };
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        expect(request.method).toBe("POST");
        expect(request.url).toBe(
          "http://api.test/knowledge-spaces/space-1/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a21/annotations",
        );
        expect(request.headers.get("authorization")).toBe("Bearer write-token");
        await expect(request.json()).resolves.toEqual({
          answerCorrectness: "incorrect",
          evidenceRelevance: [
            {
              evidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a21",
              note: "Direct support",
              relevant: true,
            },
          ],
          note: "Answer overclaimed.",
        });
        return Response.json(annotated);
      },
    });

    await expect(
      client.annotateGoldenQuestion({
        answerCorrectness: "incorrect",
        evidenceRelevance: [
          {
            evidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a21",
            note: "Direct support",
            relevant: true,
          },
        ],
        knowledgeSpaceId: "space-1",
        note: "Answer overclaimed.",
        questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a21",
        token: "write-token",
      }),
    ).resolves.toMatchObject({
      metadata: {
        annotationSummary: { latestAnswerCorrectness: "incorrect", totalAnnotations: 1 },
      },
      tags: ["annotated"],
    });
    await expect(
      client.annotateGoldenQuestion({
        answerCorrectness: "correct",
        evidenceRelevance: Array.from({ length: 51 }, (_, index) => ({
          evidenceId: `018f0d60-7a49-7cc2-9c1b-5b36f18f${String(index).padStart(4, "0")}`,
          relevant: true,
        })),
        knowledgeSpaceId: "space-1",
        questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a21",
        token: "write-token",
      }),
    ).rejects.toThrow("Admin API annotation evidenceRelevance cannot exceed 50 items");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "POST",
        "http://api.test/knowledge-spaces/space-1/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a21/annotations",
      ],
    ]);
  });

  it("browses an entity graph and linked KnowledgeFS documents through bounded APIs", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (
          request.url ===
          "http://api.test/knowledge-spaces/space-1/graph/traverse?entityId=018f0d60-7a49-7cc2-9c1b-5b36f18f2c81&depth=2&fanout=8&maxNodes=20&timeoutMs=250"
        ) {
          expect(request.headers.get("authorization")).toBe("Bearer read-token");
          return Response.json({
            entities: [
              {
                aliases: ["Acme"],
                canonicalKey: "organization:acme",
                confidence: 0.94,
                createdAt: "2026-05-12T00:00:00.000Z",
                depth: 0,
                extractionVersion: 1,
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
                knowledgeSpaceId: "space-1",
                metadata: { documentCount: 3 },
                name: "Acme Payments",
                permissionScope: ["tenant:tenant-1"],
                sourceNodeIds: ["node-1"],
                type: "organization",
                updatedAt: "2026-05-12T00:00:00.000Z",
              },
            ],
            metrics: {
              depthReached: 1,
              elapsedMs: 12,
              exploredRelations: 2,
              fanout: 8,
              maxDepth: 2,
              maxNodes: 20,
              timedOut: false,
            },
            relations: [
              {
                confidence: 0.9,
                createdAt: "2026-05-12T00:00:00.000Z",
                depth: 1,
                extractionVersion: 1,
                id: "rel-1",
                knowledgeSpaceId: "space-1",
                metadata: {},
                objectEntityId: "entity-policy",
                permissionScope: ["tenant:tenant-1"],
                sourceNodeIds: ["node-1"],
                subjectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
                type: "references",
                updatedAt: "2026-05-12T00:00:00.000Z",
              },
            ],
            truncated: false,
          });
        }

        if (
          request.url ===
          "http://api.test/knowledge-spaces/space-1/fs/ls?path=%2Fknowledge%2Fby-entity%2F018f0d60-7a49-7cc2-9c1b-5b36f18f2c81&limit=5"
        ) {
          return Response.json({
            items: [
              {
                kind: "resource",
                metadata: { parserStatus: "parsed" },
                name: "roadmap.md",
                path: "/knowledge/by-entity/018f0d60-7a49-7cc2-9c1b-5b36f18f2c81/roadmap.md",
                resourceType: "document",
                targetId: "asset-1",
                version: 1,
              },
            ],
            path: "/knowledge/by-entity/018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
            truncated: false,
          });
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
      maxGraphFanout: 10,
      maxGraphNodes: 25,
    });

    await expect(
      client.traverseGraph({
        depth: 2,
        entityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
        fanout: 8,
        knowledgeSpaceId: "space-1",
        maxNodes: 20,
        timeoutMs: 250,
        token: "read-token",
      }),
    ).resolves.toMatchObject({
      entities: [{ name: "Acme Payments", type: "organization" }],
      relations: [{ type: "references" }],
      truncated: false,
    });
    await expect(
      client.listKnowledgeFs({
        knowledgeSpaceId: "space-1",
        limit: 5,
        path: "/knowledge/by-entity/018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
        token: "read-token",
      }),
    ).resolves.toMatchObject({
      items: [{ name: "roadmap.md", resourceType: "document" }],
      truncated: false,
    });
    await expect(
      client.traverseGraph({
        entityId: "entity-1",
        fanout: 11,
        knowledgeSpaceId: "space-1",
        token: "read-token",
      }),
    ).rejects.toThrow("Admin API graph fanout must be between 1 and 10");
    await expect(
      client.listKnowledgeFs({
        knowledgeSpaceId: "space-1",
        limit: 101,
        path: "/knowledge/by-entity",
        token: "read-token",
      }),
    ).rejects.toThrow("Admin API KnowledgeFS list limit must be between 1 and 100");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "GET",
        "http://api.test/knowledge-spaces/space-1/graph/traverse?entityId=018f0d60-7a49-7cc2-9c1b-5b36f18f2c81&depth=2&fanout=8&maxNodes=20&timeoutMs=250",
      ],
      [
        "GET",
        "http://api.test/knowledge-spaces/space-1/fs/ls?path=%2Fknowledge%2Fby-entity%2F018f0d60-7a49-7cc2-9c1b-5b36f18f2c81&limit=5",
      ],
    ]);
  });

  it("lists semantic topic/entity/community views through a safe KnowledgeFS path helper", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (
          request.url ===
          "http://api.test/knowledge-spaces/space-1/fs/ls?path=%2Fknowledge%2Fby-topic%2Frenewal-risk&limit=3"
        ) {
          expect(request.headers.get("authorization")).toBe("Bearer read-token");
          return Response.json({
            items: [
              {
                kind: "resource",
                metadata: {
                  semanticView: {
                    buildStatus: "ready",
                    generatedVersion: "semantic-v4",
                    staleStatus: "fresh",
                  },
                },
                name: "vendor-contract.pdf",
                path: "/knowledge/by-topic/renewal-risk/vendor-contract.pdf",
                resourceType: "document",
                targetId: "asset-contract",
                version: 1,
              },
            ],
            path: "/knowledge/by-topic/renewal-risk",
            truncated: false,
          });
        }

        if (
          request.url ===
          "http://api.test/knowledge-spaces/space-1/fs/ls?path=%2Fknowledge%2Fby-community%2Facme-risk&limit=3"
        ) {
          expect(request.headers.get("authorization")).toBe("Bearer read-token");
          return Response.json({
            items: [
              {
                kind: "directory",
                metadata: {
                  documentCount: 2,
                  entityCount: 4,
                  summary: "Acme renewal risk community.",
                  title: "Acme risk",
                },
                name: "acme-risk",
                path: "/knowledge/by-community/acme-risk",
              },
            ],
            path: "/knowledge/by-community/acme-risk",
            truncated: false,
          });
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
    });

    await expect(
      client.listSemanticView({
        key: "renewal-risk",
        knowledgeSpaceId: "space-1",
        limit: 3,
        token: "read-token",
        view: "by-topic",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          metadata: {
            semanticView: {
              buildStatus: "ready",
              staleStatus: "fresh",
            },
          },
          name: "vendor-contract.pdf",
        },
      ],
      path: "/knowledge/by-topic/renewal-risk",
    });
    await expect(
      client.listSemanticView({
        key: "acme-risk",
        knowledgeSpaceId: "space-1",
        limit: 3,
        token: "read-token",
        view: "by-community",
      }),
    ).resolves.toMatchObject({
      items: [{ metadata: { title: "Acme risk" }, name: "acme-risk" }],
      path: "/knowledge/by-community/acme-risk",
    });
    await expect(
      client.listSemanticView({
        key: "renewal/risk",
        knowledgeSpaceId: "space-1",
        limit: 3,
        token: "read-token",
        view: "by-topic",
      }),
    ).rejects.toThrow("Admin API semantic view key must be a single path segment");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "GET",
        "http://api.test/knowledge-spaces/space-1/fs/ls?path=%2Fknowledge%2Fby-topic%2Frenewal-risk&limit=3",
      ],
      [
        "GET",
        "http://api.test/knowledge-spaces/space-1/fs/ls?path=%2Fknowledge%2Fby-community%2Facme-risk&limit=3",
      ],
    ]);
  });

  it("runs semantic operator actions through bounded Admin API client calls", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url.endsWith("/semantic-views/topic/materialize")) {
          expect(request.headers.get("authorization")).toBe("Bearer write-token");
          await expect(request.json()).resolves.toEqual({
            generatedVersion: "operator-topic-view-v2",
            limit: 25,
            topicName: "Uploaded Documents",
            topicSlug: "uploaded-documents",
          });
          return Response.json({
            documentCount: 2,
            generatedVersion: "operator-topic-view-v2",
            knowledgeSpaceId: "space-1",
            pathCount: 2,
            topicName: "Uploaded Documents",
            topicSlug: "uploaded-documents",
          });
        }

        if (request.url.endsWith("/semantic-views/entities/extract")) {
          expect(request.headers.get("authorization")).toBe("Bearer write-token");
          await expect(request.json()).resolves.toEqual({ limit: 25 });
          return Response.json({
            entitiesExtracted: 4,
            extractionMode: "provider",
            graphEntitiesIndexed: 3,
            graphRelationsIndexed: 1,
            knowledgeSpaceId: "space-1",
            nodesScanned: 2,
            nodesUpdated: 2,
          });
        }

        if (request.url.endsWith("/semantic-views/communities/materialize")) {
          expect(request.headers.get("authorization")).toBe("Bearer write-token");
          await expect(request.json()).resolves.toEqual({
            generatedVersion: "operator-community-view-v2",
          });
          return Response.json({
            communityCount: 1,
            documentCount: 2,
            entityCount: 4,
            generatedVersion: "operator-community-view-v2",
            knowledgeSpaceId: "space-1",
            pathCount: 3,
          });
        }

        throw new Error(`Unexpected request ${request.method} ${request.url}`);
      },
    });

    await expect(
      client.materializeSemanticTopicView({
        generatedVersion: "operator-topic-view-v2",
        knowledgeSpaceId: "space-1",
        limit: 25,
        token: "write-token",
        topicName: "Uploaded Documents",
        topicSlug: "uploaded-documents",
      }),
    ).resolves.toMatchObject({
      documentCount: 2,
      pathCount: 2,
      topicSlug: "uploaded-documents",
    });
    await expect(
      client.extractSemanticEntities({
        knowledgeSpaceId: "space-1",
        limit: 25,
        token: "write-token",
      }),
    ).resolves.toMatchObject({
      entitiesExtracted: 4,
      extractionMode: "provider",
      graphEntitiesIndexed: 3,
      nodesUpdated: 2,
    });
    await expect(
      client.materializeSemanticCommunities({
        generatedVersion: "operator-community-view-v2",
        knowledgeSpaceId: "space-1",
        token: "write-token",
      }),
    ).resolves.toMatchObject({
      communityCount: 1,
      documentCount: 2,
      pathCount: 3,
    });
    await expect(
      client.materializeSemanticTopicView({
        knowledgeSpaceId: "space-1",
        limit: 101,
        token: "write-token",
      }),
    ).rejects.toThrow("Admin API semantic topic materialization limit must be between 1 and 100");
    await expect(
      client.extractSemanticEntities({
        knowledgeSpaceId: "space-1",
        limit: 101,
        token: "write-token",
      }),
    ).rejects.toThrow("Admin API semantic entity extraction limit must be between 1 and 100");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://api.test/knowledge-spaces/space-1/semantic-views/topic/materialize"],
      ["POST", "http://api.test/knowledge-spaces/space-1/semantic-views/entities/extract"],
      ["POST", "http://api.test/knowledge-spaces/space-1/semantic-views/communities/materialize"],
    ]);
  });

  it("surfaces bounded API error messages from semantic operator failures", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async () =>
        Response.json(
          { error: "Semantic entity extraction requires an LLM provider" },
          { status: 400 },
        ),
    });

    await expect(
      client.extractSemanticEntities({
        knowledgeSpaceId: "space-1",
        token: "write-token",
      }),
    ).rejects.toThrow(
      "Admin API request failed with status 400: Semantic entity extraction requires an LLM provider",
    );
  });

  it("loads text and semantic KnowledgeFS diffs through a bounded diff client", async () => {
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        expect(request.method).toBe("GET");
        expect(request.headers.get("authorization")).toBe("Bearer read-token");
        expect(request.url).toBe(
          "http://api.test/knowledge-spaces/space-1/fs/diff?oldPath=%2Fknowledge%2Fnodes%2Fpolicy-v1.md&newPath=%2Fknowledge%2Fnodes%2Fpolicy-v2.md&mode=word&semantic=true",
        );

        return Response.json({
          mode: "word",
          newPath: "/knowledge/nodes/policy-v2.md",
          oldPath: "/knowledge/nodes/policy-v1.md",
          operations: [
            { kind: "equal", newEnd: 1, newStart: 1, oldEnd: 1, oldStart: 1, text: "alpha" },
            { kind: "delete", oldEnd: 2, oldStart: 2, text: "beta" },
            { kind: "insert", newEnd: 2, newStart: 2, text: "gamma" },
          ],
          semantic: {
            changes: [
              {
                category: "addition",
                evidence: ["gamma"],
                summary: "Added gamma release note.",
              },
            ],
            metadata: { provider: "fake-semantic-diff" },
            model: "semantic-diff-test",
            summary: "The new version adds gamma while replacing beta.",
          },
          stats: { delete: 1, equal: 1, insert: 1 },
        });
      },
    });

    await expect(
      client.diffKnowledgeFs({
        knowledgeSpaceId: "space-1",
        mode: "word",
        newPath: "/knowledge/nodes/policy-v2.md",
        oldPath: "/knowledge/nodes/policy-v1.md",
        semantic: true,
        token: "read-token",
      }),
    ).resolves.toMatchObject({
      mode: "word",
      operations: [
        { kind: "equal", text: "alpha" },
        { kind: "delete", text: "beta" },
        { kind: "insert", text: "gamma" },
      ],
      semantic: {
        changes: [{ category: "addition", summary: "Added gamma release note." }],
        summary: "The new version adds gamma while replacing beta.",
      },
      stats: { delete: 1, equal: 1, insert: 1 },
    });
    await expect(
      client.diffKnowledgeFs({
        knowledgeSpaceId: "space-1",
        newPath: "knowledge/nodes/policy-v2.md",
        oldPath: "/knowledge/nodes/policy-v1.md",
        token: "read-token",
      }),
    ).rejects.toThrow("Admin API KnowledgeFS diff paths must be absolute");
  });

  it("writes and appends KnowledgeFS documents with JSON bodies", async () => {
    const requests: Request[] = [];
    const client = createAdminApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        return Response.json({
          bytesWritten: 12,
          mode: request.url.endsWith("/append") ? "append" : "write",
          objectKey: "tenant-1/spaces/space-1/documents/document-1/example.txt",
          path: "/knowledge/docs/example.txt",
          targetId: "document-1",
          version: 1,
        });
      },
    });

    await expect(
      client.writeKnowledgeFs({
        knowledgeSpaceId: "space-1",
        path: "/knowledge/docs/example.txt",
        text: "hello",
        token: "write-token",
      }),
    ).resolves.toMatchObject({
      mode: "write",
      path: "/knowledge/docs/example.txt",
    });
    await expect(
      client.appendKnowledgeFs({
        knowledgeSpaceId: "space-1",
        path: "/knowledge/docs/example.txt",
        text: " world",
        token: "write-token",
      }),
    ).resolves.toMatchObject({
      mode: "append",
      targetId: "document-1",
    });
    await expect(
      client.writeKnowledgeFs({
        knowledgeSpaceId: "space-1",
        path: "knowledge/docs/example.txt",
        text: "blocked",
        token: "write-token",
      }),
    ).rejects.toThrow("Admin API KnowledgeFS path must be absolute");

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://api.test/knowledge-spaces/space-1/fs/write"],
      ["POST", "http://api.test/knowledge-spaces/space-1/fs/append"],
    ]);
    await expect(requests[0]?.json()).resolves.toEqual({
      path: "/knowledge/docs/example.txt",
      text: "hello",
    });
    await expect(requests[1]?.json()).resolves.toEqual({
      path: "/knowledge/docs/example.txt",
      text: " world",
    });
  });
});

describe("parseSseEvents", () => {
  it("parses compact SSE payloads without exposing raw transport details", () => {
    expect(parseSseEvents('event: answer.delta\ndata: {"delta":"A"}\n\n')).toEqual([
      { data: { delta: "A" }, event: "answer.delta" },
    ]);
    expect(() => parseSseEvents("event: answer.delta\ndata: {\n\n")).toThrow(
      "Admin API SSE event contains invalid JSON",
    );
  });
});

describe("getAdminApiBase", () => {
  it("prefers the private server-side API base and keeps the public base for display", () => {
    const originalPrivateBase = process.env.KNOWLEDGE_API_BASE_URL;
    const originalPublicBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.KNOWLEDGE_API_BASE_URL = "http://api:8787";
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8788";

    try {
      expect(getAdminApiBase()).toBe("http://api:8787");
      expect(getAdminPublicApiBase()).toBe("http://localhost:8788");
    } finally {
      restoreEnv("KNOWLEDGE_API_BASE_URL", originalPrivateBase);
      restoreEnv("NEXT_PUBLIC_API_BASE_URL", originalPublicBase);
    }
  });

  it("defaults local source development to the non-workerd API port", () => {
    const originalPrivateBase = process.env.KNOWLEDGE_API_BASE_URL;
    const originalPublicBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.KNOWLEDGE_API_BASE_URL = "";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";

    try {
      expect(getAdminApiBase()).toBe("http://localhost:8788");
      expect(getAdminPublicApiBase()).toBe("http://localhost:8788");
    } finally {
      restoreEnv("KNOWLEDGE_API_BASE_URL", originalPrivateBase);
      restoreEnv("NEXT_PUBLIC_API_BASE_URL", originalPublicBase);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    process.env[name] = "";
    return;
  }

  process.env[name] = value;
}

function adminGcCandidate() {
  return {
    candidateType: "staged-object",
    count: 1,
    estimatedBytes: 12,
    idempotencyKey: "staged-object:doc-1",
    reason: "expired staged object",
    target: {
      objectKey: "tenant-1/spaces/space-1/staging/doc-1.md",
      type: "staged-object",
    },
  };
}

function adminGcDryRun() {
  return {
    candidates: [adminGcCandidate()],
    dryRunId: "gc-dry-run-1",
    generatedAt: "2026-05-27T11:05:00.000Z",
    knowledgeSpaceId: "space-1",
    summary: {
      candidateCount: 1,
      estimatedBytes: 12,
      failedCommitCount: 0,
      stagedObjectCount: 1,
    },
    tenantId: "tenant-1",
  };
}
