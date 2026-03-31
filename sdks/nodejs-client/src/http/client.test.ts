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

  it("retries on timeout errors", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "AbortError" }))
      .mockResolvedValueOnce(jsonResponse("ok", { status: 200 }));
    const client = new HttpClient({ apiKey: "test", maxRetries: 1, retryDelay: 0 });

    await client.requestRaw({ method: "GET", path: "/meta" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
