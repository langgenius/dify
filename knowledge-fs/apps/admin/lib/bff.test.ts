import { describe, expect, it } from "vitest";

import { createAdminBffProxy, listForbiddenAdminImports } from "./bff";

describe("createAdminBffProxy", () => {
  it("proxies only allowlisted UI BFF requests to the Hono API", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        return Response.json({ ok: true });
      },
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/health?verbose=1", {
        headers: {
          authorization: "Bearer secret-token",
          cookie: "session=private",
          "x-trace-id": "trace-1",
        },
      }),
      { path: ["health"] },
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://api.test/health?verbose=1");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret-token");
    expect(requests[0]?.headers.get("x-trace-id")).toBe("trace-1");
    expect(requests[0]?.headers.has("cookie")).toBe(false);

    await expect(
      proxy.proxy(new Request("http://admin.test/api/bff/admin-internals"), {
        path: ["admin-internals"],
      }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("allows golden question CRUD routes without exposing arbitrary paths", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        return request.method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json({});
      },
    });

    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/golden-questions?limit=5", {
        headers: { authorization: "Bearer read-token" },
      }),
      { path: ["knowledge-spaces", "space-1", "golden-questions"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/golden-questions", {
        body: '{"question":"What changed?"}',
        headers: {
          authorization: "Bearer write-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      { path: ["knowledge-spaces", "space-1", "golden-questions"] },
    );
    await proxy.proxy(
      new Request(
        "http://admin.test/api/bff/knowledge-spaces/space-1/golden-questions/question-1",
        {
          method: "DELETE",
        },
      ),
      { path: ["knowledge-spaces", "space-1", "golden-questions", "question-1"] },
    );
    await proxy.proxy(
      new Request(
        "http://admin.test/api/bff/knowledge-spaces/space-1/golden-questions/question-1/annotations",
        {
          body: '{"answerCorrectness":"incorrect","evidenceRelevance":[]}',
          headers: {
            authorization: "Bearer write-token",
            "content-type": "application/json",
          },
          method: "POST",
        },
      ),
      { path: ["knowledge-spaces", "space-1", "golden-questions", "question-1", "annotations"] },
    );

    await expect(
      proxy.proxy(
        new Request(
          "http://admin.test/api/bff/knowledge-spaces/space-1/golden-questions/question-1/annotations/unsafe",
        ),
        {
          path: [
            "knowledge-spaces",
            "space-1",
            "golden-questions",
            "question-1",
            "annotations",
            "unsafe",
          ],
        },
      ),
    ).resolves.toMatchObject({ status: 404 });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces/space-1/golden-questions?limit=5"],
      ["POST", "http://api.test/knowledge-spaces/space-1/golden-questions"],
      ["DELETE", "http://api.test/knowledge-spaces/space-1/golden-questions/question-1"],
      ["POST", "http://api.test/knowledge-spaces/space-1/golden-questions/question-1/annotations"],
    ]);
  });

  it("allows read-only KnowledgeSpace control-plane routes", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        return Response.json({ ok: true });
      },
    });

    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/manifest", {
        headers: { authorization: "Bearer read-token" },
      }),
      { path: ["knowledge-spaces", "space-1", "manifest"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/status", {
        headers: { authorization: "Bearer read-token" },
      }),
      { path: ["knowledge-spaces", "space-1", "status"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/staged-commits?limit=5", {
        headers: { authorization: "Bearer read-token" },
      }),
      { path: ["knowledge-spaces", "space-1", "staged-commits"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/leases/active?limit=5", {
        headers: { authorization: "Bearer read-token" },
      }),
      { path: ["knowledge-spaces", "space-1", "leases", "active"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/fsck?check=raw-objects", {
        headers: { authorization: "Bearer read-token" },
      }),
      { path: ["knowledge-spaces", "space-1", "fsck"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/gc/staged-objects", {
        headers: { authorization: "Bearer read-token" },
      }),
      { path: ["knowledge-spaces", "space-1", "gc", "staged-objects"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/gc/staged-objects/execute", {
        body: '{"candidates":[]}',
        headers: {
          authorization: "Bearer write-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      { path: ["knowledge-spaces", "space-1", "gc", "staged-objects", "execute"] },
    );

    await expect(
      proxy.proxy(
        new Request("http://admin.test/api/bff/knowledge-spaces/space-1/status", {
          method: "POST",
        }),
        { path: ["knowledge-spaces", "space-1", "status"] },
      ),
    ).resolves.toMatchObject({ status: 404 });
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

  it("allows production bad-case capture without opening arbitrary evaluation routes", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        return Response.json({ ok: true }, { status: 201 });
      },
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/production-bad-cases", {
        body: '{"traceId":"018f0d60-7a49-7cc2-9c1b-5b36f18f8a01"}',
        headers: {
          authorization: "Bearer write-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      { path: ["knowledge-spaces", "space-1", "production-bad-cases"] },
    );

    expect(response.status).toBe(201);
    await expect(
      proxy.proxy(
        new Request("http://admin.test/api/bff/knowledge-spaces/space-1/production-bad-cases/1", {
          method: "POST",
        }),
        { path: ["knowledge-spaces", "space-1", "production-bad-cases", "1"] },
      ),
    ).resolves.toMatchObject({ status: 404 });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://api.test/knowledge-spaces/space-1/production-bad-cases"],
    ]);
  });

  it("resolves the default workspace slug before proxying document uploads", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url === "http://api.test/knowledge-spaces?limit=100") {
          return Response.json({
            items: [
              {
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
                slug: "workspace",
              },
            ],
          });
        }

        expect(request.url).toBe(
          "http://api.test/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
        );
        await expect(request.text()).resolves.toBe("upload-body");
        return Response.json({ id: "asset-1" }, { status: 201 });
      },
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/workspace/documents", {
        body: "upload-body",
        headers: {
          authorization: "Bearer write-token",
          "content-type": "multipart/form-data; boundary=test",
        },
        method: "POST",
      }),
      { path: ["knowledge-spaces", "workspace", "documents"] },
    );

    expect(response.status).toBe(201);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces?limit=100"],
      ["POST", "http://api.test/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents"],
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer write-token");
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer write-token");
  });

  it("creates the default workspace and injects local dev auth before upload", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url === "http://api.test/knowledge-spaces?limit=100") {
          return Response.json({ items: [] });
        }

        if (request.url === "http://api.test/knowledge-spaces") {
          expect(request.headers.get("authorization")).toBe("Bearer dev-token");
          expect(request.headers.get("content-type")).toContain("application/json");
          await expect(request.json()).resolves.toEqual({
            name: "Workspace",
            slug: "workspace",
          });
          return Response.json({
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            slug: "workspace",
          });
        }

        expect(request.url).toBe(
          "http://api.test/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
        );
        expect(request.headers.get("authorization")).toBe("Bearer dev-token");
        expect(request.headers.get("content-type")).toContain("multipart/form-data");
        await expect(request.text()).resolves.toBe("upload-body");
        return Response.json({ id: "asset-1" }, { status: 201 });
      },
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/workspace/documents", {
        body: "upload-body",
        headers: {
          "content-type": "multipart/form-data; boundary=test",
        },
        method: "POST",
      }),
      { path: ["knowledge-spaces", "workspace", "documents"] },
    );

    expect(response.status).toBe(201);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces?limit=100"],
      ["POST", "http://api.test/knowledge-spaces"],
      ["POST", "http://api.test/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents"],
    ]);
  });

  it("rejects oversized default workspace lookup responses before upload proxying", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        return new Response(JSON.stringify({ items: [{ id: "space-1", slug: "workspace" }] }), {
          headers: { "content-type": "application/json" },
        });
      },
      maxBodyBytes: 32,
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/workspace/documents", {
        body: "upload-body",
        method: "POST",
      }),
      { path: ["knowledge-spaces", "workspace", "documents"] },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Bad Gateway" });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces?limit=100"],
    ]);
  });

  it("rejects oversized default workspace creation responses before upload proxying", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());

        if (request.url === "http://api.test/knowledge-spaces?limit=100") {
          return Response.json({ items: [] });
        }

        return new Response(
          JSON.stringify({
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            slug: "workspace",
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
      maxBodyBytes: 32,
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/workspace/documents", {
        body: "upload-body",
        method: "POST",
      }),
      { path: ["knowledge-spaces", "workspace", "documents"] },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Bad Gateway" });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces?limit=100"],
      ["POST", "http://api.test/knowledge-spaces"],
    ]);
  });

  it("allows Admin graph and KnowledgeFS routes used by the shared API client", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test/",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        return Response.json({ ok: true });
      },
    });

    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/graph/traverse", {
        method: "GET",
      }),
      { path: ["knowledge-spaces", "space-1", "graph", "traverse"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/fs/ls?path=/knowledge"),
      { path: ["knowledge-spaces", "space-1", "fs", "ls"] },
    );
    await proxy.proxy(
      new Request(
        "http://admin.test/api/bff/knowledge-spaces/space-1/fs/diff?oldPath=/sources/a&newPath=/sources/b",
        {
          method: "GET",
        },
      ),
      { path: ["knowledge-spaces", "space-1", "fs", "diff"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/fs/tree?path=/knowledge"),
      { path: ["knowledge-spaces", "space-1", "fs", "tree"] },
    );
    await proxy.proxy(
      new Request(
        "http://admin.test/api/bff/knowledge-spaces/space-1/fs/open_node?nodeId=node-1",
      ),
      { path: ["knowledge-spaces", "space-1", "fs", "open_node"] },
    );
    await proxy.proxy(
      new Request("http://admin.test/api/bff/knowledge-spaces/space-1/fs/write", {
        body: '{"path":"/knowledge/docs/example.txt","text":"hello"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { path: ["knowledge-spaces", "space-1", "fs", "write"] },
    );

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/knowledge-spaces/space-1/graph/traverse"],
      ["GET", "http://api.test/knowledge-spaces/space-1/fs/ls?path=/knowledge"],
      [
        "GET",
        "http://api.test/knowledge-spaces/space-1/fs/diff?oldPath=/sources/a&newPath=/sources/b",
      ],
      ["GET", "http://api.test/knowledge-spaces/space-1/fs/tree?path=/knowledge"],
      ["GET", "http://api.test/knowledge-spaces/space-1/fs/open_node?nodeId=node-1"],
      ["POST", "http://api.test/knowledge-spaces/space-1/fs/write"],
    ]);
    await expect(requests.at(-1)?.text()).resolves.toBe(
      '{"path":"/knowledge/docs/example.txt","text":"hello"}',
    );
  });

  it("bounds proxied request bodies and preserves streaming responses", async () => {
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://api.test/queries");
        await expect(request.text()).resolves.toBe('{"query":"hello"}');
        return new Response('event: answer.done\ndata: {"ok":true}\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      },
      maxBodyBytes: 64,
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/queries", {
        body: '{"query":"hello"}',
        headers: {
          authorization: "Bearer read-token",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      { path: ["queries"] },
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(response.text()).resolves.toContain("answer.done");

    await expect(
      proxy.proxy(
        new Request("http://admin.test/api/bff/queries", {
          body: "x".repeat(65),
          method: "POST",
        }),
        { path: ["queries"] },
      ),
    ).resolves.toMatchObject({ status: 413 });
  });

  it("proxies answer trace and query virtual tree reads to the live query routes", async () => {
    const requests: Request[] = [];
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test",
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request.clone());
        return Response.json({ ok: true });
      },
    });

    await proxy.proxy(new Request("http://admin.test/api/bff/queries/trace-1"), {
      path: ["queries", "trace-1"],
    });
    await proxy.proxy(new Request("http://admin.test/api/bff/queries/trace-1/evidence?limit=5"), {
      path: ["queries", "trace-1", "evidence"],
    });
    await proxy.proxy(new Request("http://admin.test/api/bff/traces/trace-2"), {
      path: ["traces", "trace-2"],
    });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://api.test/queries/trace-1"],
      ["GET", "http://api.test/queries/trace-1/evidence?limit=5"],
      ["GET", "http://api.test/queries/trace-2"],
    ]);
  });

  it("stops reading request bodies after the configured byte limit", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("1234"));
        if (pulls >= 10) {
          controller.close();
        }
      },
    });
    const proxy = createAdminBffProxy({
      apiBaseUrl: "http://api.test",
      fetch: async () => {
        throw new Error("upstream should not be called");
      },
      maxBodyBytes: 5,
    });

    const response = await proxy.proxy(
      new Request("http://admin.test/api/bff/queries", {
        body,
        duplex: "half",
        method: "POST",
      } as RequestInit),
      { path: ["queries"] },
    );

    expect(response.status).toBe(413);
    expect(pulls).toBeLessThan(10);
  });
});

describe("listForbiddenAdminImports", () => {
  it("keeps Admin UI and BFF code from importing core runtime packages", async () => {
    await expect(listForbiddenAdminImports()).resolves.toEqual([]);
  });
});
