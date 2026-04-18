import { Readable, Stream } from "node:stream";
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

const stubFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const getFetchCall = (
  fetchMock: ReturnType<typeof vi.fn>,
  index = 0
): [string, RequestInit | undefined] => {
  const call = fetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`Missing fetch call at index ${index}`);
  }
  return call as [string, RequestInit | undefined];
};

const toHeaderRecord = (headers: HeadersInit | undefined): Record<string, string> =>
  Object.fromEntries(new Headers(headers).entries());

const jsonResponse = (
  body: unknown,
  init: ResponseInit = {}
): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const textResponse = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
    },
  });

describe("HttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds requests with auth headers and JSON content type", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true }, { status: 200, headers: { "x-request-id": "req" } })
    );

    const client = new HttpClient({ apiKey: "test" });
    const response = await client.request({
      method: "POST",
      path: "/chat-messages",
      data: { user: "u" },
    });

    expect(response.requestId).toBe("req");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = getFetchCall(fetchMock);
    expect(url).toBe("https://api.dify.ai/v1/chat-messages");
    expect(toHeaderRecord(init?.headers)).toMatchObject({
      authorization: "Bearer test",
      "content-type": "application/json",
      "user-agent": "dify-client-node",
    });
    expect(init?.body).toBe(JSON.stringify({ user: "u" }));
  });

  it("serializes array query params", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));

    const client = new HttpClient({ apiKey: "test" });
    await client.requestRaw({
      method: "GET",
      path: "/datasets",
      query: { tag_ids: ["a", "b"], limit: 2 },
    });

    const [url] = getFetchCall(fetchMock);
    expect(new URL(url).searchParams.toString()).toBe(
      "tag_ids=a&tag_ids=b&limit=2"
    );
  });

  it("returns SSE stream helpers", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      new Response('data: {"text":"hi"}\n\n', {
        status: 200,
        headers: { "x-request-id": "req" },
      })
    );

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
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      new Response("chunk", {
        status: 200,
        headers: { "x-request-id": "req" },
      })
    );

    const client = new HttpClient({ apiKey: "test" });
    const stream = await client.requestBinaryStream({
      method: "POST",
      path: "/text-to-audio",
      data: { user: "u", text: "hi" },
    });

    expect(stream.status).toBe(200);
    expect(stream.requestId).toBe("req");
    expect(stream.data).toBeInstanceOf(Readable);
  });

  it("respects form-data headers", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));

    const client = new HttpClient({ apiKey: "test" });
    const form = new FormData();
    form.append("file", new Blob(["abc"]), "file.txt");

    await client.requestRaw({
      method: "POST",
      path: "/files/upload",
      data: form,
    });

    const [, init] = getFetchCall(fetchMock);
    expect(toHeaderRecord(init?.headers)).toMatchObject({
      authorization: "Bearer test",
    });
    expect(toHeaderRecord(init?.headers)["content-type"]).toBeUndefined();
  });

  it("sends legacy form-data as a readable request body", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));

    const client = new HttpClient({ apiKey: "test" });
    const legacyForm = Object.assign(Readable.from(["chunk"]), {
      append: vi.fn(),
      getHeaders: () => ({
        "content-type": "multipart/form-data; boundary=test",
      }),
    });

    await client.requestRaw({
      method: "POST",
      path: "/files/upload",
      data: legacyForm,
    });

    const [, init] = getFetchCall(fetchMock);
    expect(toHeaderRecord(init?.headers)).toMatchObject({
      authorization: "Bearer test",
      "content-type": "multipart/form-data; boundary=test",
    });
    expect((init as RequestInit & { duplex?: string } | undefined)?.duplex).toBe(
      "half"
    );
    expect(init?.body).not.toBe(legacyForm);
  });

  it("rejects legacy form-data objects that are not readable streams", async () => {
    const fetchMock = stubFetch();
    const client = new HttpClient({ apiKey: "test" });
    const legacyForm = {
      append: vi.fn(),
      getHeaders: () => ({
        "content-type": "multipart/form-data; boundary=test",
      }),
    };

    await expect(
      client.requestRaw({
        method: "POST",
        path: "/files/upload",
        data: legacyForm,
      })
    ).rejects.toBeInstanceOf(FileUploadError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts legacy pipeable streams that are not Readable instances", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));
    const client = new HttpClient({ apiKey: "test" });

    const legacyStream = new Stream() as Stream &
      NodeJS.ReadableStream & {
        append: ReturnType<typeof vi.fn>;
        getHeaders: () => Record<string, string>;
      };
    legacyStream.readable = true;
    legacyStream.pause = () => legacyStream;
    legacyStream.resume = () => legacyStream;
    legacyStream.append = vi.fn();
    legacyStream.getHeaders = () => ({
      "content-type": "multipart/form-data; boundary=test",
    });
    queueMicrotask(() => {
      legacyStream.emit("data", Buffer.from("chunk"));
      legacyStream.emit("end");
    });

    await client.requestRaw({
      method: "POST",
      path: "/files/upload",
      data: legacyStream as unknown as FormData,
    });

    const [, init] = getFetchCall(fetchMock);
    expect((init as RequestInit & { duplex?: string } | undefined)?.duplex).toBe(
      "half"
    );
  });

  it("returns buffers for byte responses", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    );

    const client = new HttpClient({ apiKey: "test" });
    const response = await client.request<Buffer, "bytes">({
      method: "GET",
      path: "/files/file-1/preview",
      responseType: "bytes",
    });

    expect(Buffer.isBuffer(response.data)).toBe(true);
    expect(Array.from(response.data.values())).toEqual([1, 2, 3]);
  });

  it("keeps arraybuffer as a backward-compatible binary alias", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      new Response(Uint8Array.from([4, 5, 6]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    );

    const client = new HttpClient({ apiKey: "test" });
    const response = await client.request<Buffer, "arraybuffer">({
      method: "GET",
      path: "/files/file-1/preview",
      responseType: "arraybuffer",
    });

    expect(Buffer.isBuffer(response.data)).toBe(true);
    expect(Array.from(response.data.values())).toEqual([4, 5, 6]);
  });

  it("returns null for empty no-content responses", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = new HttpClient({ apiKey: "test" });
    const response = await client.requestRaw({
      method: "GET",
      path: "/meta",
    });

    expect(response.data).toBeNull();
  });

  it("maps 401 and 429 errors", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ message: "unauthorized" }, { status: 401 })
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: "rate" }, { status: 429, headers: { "retry-after": "2" } })
      );
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(AuthenticationError);

    const error = await client
      .requestRaw({ method: "GET", path: "/meta" })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(2);
  });

  it("maps validation and upload errors", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "invalid" }, { status: 422 }))
      .mockResolvedValueOnce(jsonResponse({ message: "bad upload" }, { status: 400 }));
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    await expect(
      client.requestRaw({ method: "POST", path: "/chat-messages", data: { user: "u" } })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      client.requestRaw({ method: "POST", path: "/files/upload", data: { user: "u" } })
    ).rejects.toBeInstanceOf(FileUploadError);
  });

  it("maps timeout and network errors", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "AbortError" }))
      .mockRejectedValueOnce(new Error("network"));
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(TimeoutError);

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("maps unknown transport failures to NetworkError", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockRejectedValueOnce("boom");
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toMatchObject({
      name: "NetworkError",
      message: "Unexpected network error",
    });
  });

  it("retries on timeout errors", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "AbortError" }))
      .mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));
    const client = new HttpClient({ apiKey: "test", maxRetries: 1, retryDelay: 0 });

    await client.requestRaw({ method: "GET", path: "/meta" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-replayable readable request bodies", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const client = new HttpClient({ apiKey: "test", maxRetries: 2, retryDelay: 0 });

    await expect(
      client.requestRaw({
        method: "POST",
        path: "/chat-messages",
        data: Readable.from(["chunk"]),
      })
    ).rejects.toBeInstanceOf(NetworkError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = getFetchCall(fetchMock);
    expect((init as RequestInit & { duplex?: string } | undefined)?.duplex).toBe(
      "half"
    );
  });

  it("validates query parameters before request", async () => {
    const fetchMock = stubFetch();
    const client = new HttpClient({ apiKey: "test" });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta", query: { user: 1 } })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns APIError for other http failures", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "server" }, { status: 500 }));
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(APIError);
  });

  it("uses plain text bodies when json parsing is not possible", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      textResponse("plain text", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );
    const client = new HttpClient({ apiKey: "test" });

    const response = await client.requestRaw({
      method: "GET",
      path: "/info",
    });

    expect(response.data).toBe("plain text");
  });

  it("keeps invalid json error bodies as API errors", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      textResponse("{invalid", {
        status: 500,
        headers: { "content-type": "application/json", "x-request-id": "req-500" },
      })
    );
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toMatchObject({
      name: "APIError",
      statusCode: 500,
      requestId: "req-500",
      responseBody: "{invalid",
    });
  });

  it("sends raw string bodies without additional json encoding", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));
    const client = new HttpClient({ apiKey: "test" });

    await client.requestRaw({
      method: "POST",
      path: "/meta",
      data: '{"pre":"serialized"}',
      headers: { "Content-Type": "application/custom+json" },
    });

    const [, init] = getFetchCall(fetchMock);
    expect(init?.body).toBe('{"pre":"serialized"}');
    expect(toHeaderRecord(init?.headers)).toMatchObject({
      "content-type": "application/custom+json",
    });
  });

  it("preserves explicit user-agent headers", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 200 }));
    const client = new HttpClient({ apiKey: "test" });

    await client.requestRaw({
      method: "GET",
      path: "/meta",
      headers: { "User-Agent": "custom-agent" },
    });

    const [, init] = getFetchCall(fetchMock);
    expect(toHeaderRecord(init?.headers)).toMatchObject({
      "user-agent": "custom-agent",
    });
  });

  it("logs requests and responses when enableLogging is true", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 200 }));
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const client = new HttpClient({ apiKey: "test", enableLogging: true });
    await client.requestRaw({ method: "GET", path: "/meta" });

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining("dify-client-node response 200 GET")
    );
  });

  it("logs retry attempts when enableLogging is true", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "AbortError" }))
      .mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));
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
  });
});
