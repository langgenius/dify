import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APIError,
  AuthenticationError,
  FileUploadError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from "../errors/dify-error";
import { HttpClient } from "./client";

// Helper to create a mock fetch response
const createMockResponse = (options = {}) => {
  const {
    ok = true,
    status = 200,
    headers = {},
    body = null,
    data = null,
  } = options;

  const headersObj = new Headers(headers);
  const response = {
    ok,
    status,
    headers: headersObj,
    body,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
    blob: vi.fn().mockResolvedValue(new Blob()),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  };

  return response;
};

describe("HttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds requests with auth headers and JSON content type", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse({
        status: 200,
        headers: { "x-request-id": "req" },
        data: { ok: true },
      })
    );
    global.fetch = mockFetch;

    const client = new HttpClient({ apiKey: "test" });
    const response = await client.request({
      method: "POST",
      path: "/chat-messages",
      data: { user: "u" },
    });

    expect(response.requestId).toBe("req");
    const [url, config] = mockFetch.mock.calls[0];
    expect(config.headers.Authorization).toBe("Bearer test");
    expect(config.headers["Content-Type"]).toBe("application/json");
    expect(url).toContain("/chat-messages");
  });

  it("serializes array query params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "ok",
    });
    global.fetch = mockFetch;

    const client = new HttpClient({ apiKey: "test" });
    await client.requestRaw({
      method: "GET",
      path: "/datasets",
      query: { tag_ids: ["a", "b"], limit: 2 },
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("tag_ids=a&tag_ids=b&limit=2");
  });

  it("returns SSE stream helpers", async () => {
    // Create a mock web ReadableStream from Node stream data
    const chunks = ['data: {"text":"hi"}\n\n'];
    let index = 0;
    const webStream = new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[index++]));
        } else {
          controller.close();
        }
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "req" }),
      body: webStream,
    });
    global.fetch = mockFetch;

    const client = new HttpClient({ apiKey: "test" });
    const stream = await client.requestStream({
      method: "POST",
      path: "/chat-messages",
      data: { user: "u" },
    });

    expect(stream.status).toBe(200);
    expect(stream.requestId).toBe("req");
    await expect(stream.toText()).resolves.toBe("hi");
  });

  it("returns binary stream helpers", async () => {
    // Create a mock web ReadableStream from Node stream data
    const chunks = ["chunk"];
    let index = 0;
    const webStream = new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[index++]));
        } else {
          controller.close();
        }
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "req" }),
      body: webStream,
    });
    global.fetch = mockFetch;

    const client = new HttpClient({ apiKey: "test" });
    const stream = await client.requestBinaryStream({
      method: "POST",
      path: "/text-to-audio",
      data: { user: "u", text: "hi" },
    });

    expect(stream.status).toBe(200);
    expect(stream.requestId).toBe("req");
  });

  it("respects form-data headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "ok",
    });
    global.fetch = mockFetch;

    const client = new HttpClient({ apiKey: "test" });
    const form = {
      append: () => {},
      getHeaders: () => ({ "content-type": "multipart/form-data; boundary=abc" }),
    };

    await client.requestRaw({
      method: "POST",
      path: "/files/upload",
      data: form,
    });

    const [, config] = mockFetch.mock.calls[0];
    expect(config.headers["content-type"]).toBe(
      "multipart/form-data; boundary=abc"
    );
    expect(config.headers["Content-Type"]).toBeUndefined();
  });

  it("maps 401 and 429 errors", async () => {
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{"message":"unauthorized"}'),
      json: vi.fn().mockResolvedValue({ message: "unauthorized" }),
    });
    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(AuthenticationError);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "2" }),
      text: vi.fn().mockResolvedValue('{"message":"rate"}'),
      json: vi.fn().mockResolvedValue({ message: "rate" }),
    });
    const error = await client
      .requestRaw({ method: "GET", path: "/meta" })
      .catch((err) => err);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(2);
  });

  it("maps validation and upload errors", async () => {
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{"message":"invalid"}'),
      json: vi.fn().mockResolvedValue({ message: "invalid" }),
    });
    await expect(
      client.requestRaw({ method: "POST", path: "/chat-messages", data: { user: "u" } })
    ).rejects.toBeInstanceOf(ValidationError);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{"message":"bad upload"}'),
      json: vi.fn().mockResolvedValue({ message: "bad upload" }),
    });
    await expect(
      client.requestRaw({ method: "POST", path: "/files/upload", data: { user: "u" } })
    ).rejects.toBeInstanceOf(FileUploadError);
  });

  it("maps timeout and network errors", async () => {
    const client = new HttpClient({ apiKey: "test", maxRetries: 0, timeout: 0.001 });

    global.fetch = vi.fn().mockImplementation(() =>
      new Promise((resolve) => setTimeout(() => resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
      }), 100))
    );
    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(TimeoutError);

    global.fetch = vi.fn().mockRejectedValue(new Error("network"));
    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("retries on timeout errors", async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "ok",
      });
    global.fetch = mockFetch;

    const client = new HttpClient({ apiKey: "test", maxRetries: 1, retryDelay: 0 });
    await client.requestRaw({ method: "GET", path: "/meta" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("validates query parameters before request", async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;
    const client = new HttpClient({ apiKey: "test" });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta", query: { user: 1 } })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns APIError for other http failures", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{"message":"server"}'),
      json: vi.fn().mockResolvedValue({ message: "server" }),
    });
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(APIError);
  });

  it("logs requests and responses when enableLogging is true", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    });
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const client = new HttpClient({ apiKey: "test", enableLogging: true });
    await client.requestRaw({ method: "GET", path: "/meta" });

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining("dify-client-node response 200 GET")
    );
    consoleInfo.mockRestore();
  });

  it("logs retry attempts when enableLogging is true", async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "ok",
      });
    global.fetch = mockFetch;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const client = new HttpClient({
      apiKey: "test",
      maxRetries: 1,
      retryDelay: 0,
      enableLogging: true,
    });

    await client.requestRaw({ method: "GET", path: "/meta" });

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining("dify-client-node retry")
    );
    consoleInfo.mockRestore();
  });
});
