import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpClient } from "../src/http/client";

const readBody = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

describe("HttpClient integration", () => {
  const requests: Array<{
    url: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> = [];

  const server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      requests.push({
        url: req.url ?? "",
        method: req.method ?? "",
        headers: req.headers,
        body,
      });

      if (req.url?.startsWith("/json")) {
        res.writeHead(200, { "content-type": "application/json", "x-request-id": "req-json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.url === "/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end('data: {"answer":"hello"}\n\ndata: {"delta":" world"}\n\n');
        return;
      }

      if (req.url === "/bytes") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from([1, 2, 3, 4]));
        return;
      }

      if (req.url === "/upload-stream") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ received: body.toString("utf8") }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "not found" }));
    })();
  });

  let client: HttpClient;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    client = new HttpClient({
      apiKey: "test-key",
      baseUrl: `http://127.0.0.1:${address.port}`,
      maxRetries: 0,
      retryDelay: 0,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("uses real fetch for query serialization and json bodies", async () => {
    const response = await client.request({
      method: "POST",
      path: "/json",
      query: { tag_ids: ["a", "b"], limit: 2 },
      data: { user: "u" },
    });

    expect(response.requestId).toBe("req-json");
    expect(response.data).toEqual({ ok: true });
    expect(requests.at(-1)).toMatchObject({
      url: "/json?tag_ids=a&tag_ids=b&limit=2",
      method: "POST",
    });
    expect(requests.at(-1)?.headers.authorization).toBe("Bearer test-key");
    expect(requests.at(-1)?.headers["content-type"]).toBe("application/json");
    expect(requests.at(-1)?.body.toString("utf8")).toBe(JSON.stringify({ user: "u" }));
  });

  it("supports streaming request bodies with duplex fetch", async () => {
    const response = await client.request<{ received: string }>({
      method: "POST",
      path: "/upload-stream",
      data: Readable.from(["hello ", "world"]),
    });

    expect(response.data).toEqual({ received: "hello world" });
    expect(requests.at(-1)?.body.toString("utf8")).toBe("hello world");
  });

  it("parses real sse responses into text", async () => {
    const stream = await client.requestStream({
      method: "GET",
      path: "/stream",
    });

    await expect(stream.toText()).resolves.toBe("hello world");
  });

  it("parses real byte responses into buffers", async () => {
    const response = await client.request<Buffer, "bytes">({
      method: "GET",
      path: "/bytes",
      responseType: "bytes",
    });

    expect(Array.from(response.data.values())).toEqual([1, 2, 3, 4]);
  });
});
