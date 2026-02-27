import axios from "axios";
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

describe("HttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it("builds requests with auth headers and JSON content type", async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: { ok: true },
      headers: { "x-request-id": "req" },
    });
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });

    const client = new HttpClient({ apiKey: "test" });
    const response = await client.request({
      method: "POST",
      path: "/chat-messages",
      data: { user: "u" },
    });

    expect(response.requestId).toBe("req");
    const config = mockRequest.mock.calls[0][0];
    expect(config.headers.Authorization).toBe("Bearer test");
    expect(config.headers["Content-Type"]).toBe("application/json");
    expect(config.responseType).toBe("json");
  });

  it("serializes array query params", async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: "ok",
      headers: {},
    });
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });

    const client = new HttpClient({ apiKey: "test" });
    await client.requestRaw({
      method: "GET",
      path: "/datasets",
      query: { tag_ids: ["a", "b"], limit: 2 },
    });

    const config = mockRequest.mock.calls[0][0];
    const queryString = config.paramsSerializer.serialize({
      tag_ids: ["a", "b"],
      limit: 2,
    });
    expect(queryString).toBe("tag_ids=a&tag_ids=b&limit=2");
  });

  it("returns SSE stream helpers", async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: Readable.from(["data: {\"text\":\"hi\"}\n\n"]),
      headers: { "x-request-id": "req" },
    });
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });

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
    const mockRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: Readable.from(["chunk"]),
      headers: { "x-request-id": "req" },
    });
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });

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
    const mockRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: "ok",
      headers: {},
    });
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });

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

    const config = mockRequest.mock.calls[0][0];
    expect(config.headers["content-type"]).toBe(
      "multipart/form-data; boundary=abc"
    );
    expect(config.headers["Content-Type"]).toBeUndefined();
  });

  it("maps 401 and 429 errors", async () => {
    const mockRequest = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    mockRequest.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 401,
        data: { message: "unauthorized" },
        headers: {},
      },
    });
    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(AuthenticationError);

    mockRequest.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 429,
        data: { message: "rate" },
        headers: { "retry-after": "2" },
      },
    });
    const error = await client
      .requestRaw({ method: "GET", path: "/meta" })
      .catch((err) => err);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(2);
  });

  it("maps validation and upload errors", async () => {
    const mockRequest = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    mockRequest.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: { message: "invalid" },
        headers: {},
      },
    });
    await expect(
      client.requestRaw({ method: "POST", path: "/chat-messages", data: { user: "u" } })
    ).rejects.toBeInstanceOf(ValidationError);

    mockRequest.mockRejectedValueOnce({
      isAxiosError: true,
      config: { url: "/files/upload" },
      response: {
        status: 400,
        data: { message: "bad upload" },
        headers: {},
      },
    });
    await expect(
      client.requestRaw({ method: "POST", path: "/files/upload", data: { user: "u" } })
    ).rejects.toBeInstanceOf(FileUploadError);
  });

  it("maps timeout and network errors", async () => {
    const mockRequest = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    mockRequest.mockRejectedValueOnce({
      isAxiosError: true,
      code: "ECONNABORTED",
      message: "timeout",
    });
    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(TimeoutError);

    mockRequest.mockRejectedValueOnce({
      isAxiosError: true,
      message: "network",
    });
    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("retries on timeout errors", async () => {
    const mockRequest = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const client = new HttpClient({ apiKey: "test", maxRetries: 1, retryDelay: 0 });

    mockRequest
      .mockRejectedValueOnce({
        isAxiosError: true,
        code: "ECONNABORTED",
        message: "timeout",
      })
      .mockResolvedValueOnce({ status: 200, data: "ok", headers: {} });

    await client.requestRaw({ method: "GET", path: "/meta" });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("validates query parameters before request", async () => {
    const mockRequest = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const client = new HttpClient({ apiKey: "test" });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta", query: { user: 1 } })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns APIError for other http failures", async () => {
    const mockRequest = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const client = new HttpClient({ apiKey: "test", maxRetries: 0 });

    mockRequest.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { message: "server" }, headers: {} },
    });

    await expect(
      client.requestRaw({ method: "GET", path: "/meta" })
    ).rejects.toBeInstanceOf(APIError);
  });

  it("logs requests and responses when enableLogging is true", async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: { ok: true },
      headers: {},
    });
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const client = new HttpClient({ apiKey: "test", enableLogging: true });
    await client.requestRaw({ method: "GET", path: "/meta" });

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining("dify-client-node response 200 GET")
    );
    consoleInfo.mockRestore();
  });

  it("logs retry attempts when enableLogging is true", async () => {
    const mockRequest = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const client = new HttpClient({
      apiKey: "test",
      maxRetries: 1,
      retryDelay: 0,
      enableLogging: true,
    });

    mockRequest
      .mockRejectedValueOnce({
        isAxiosError: true,
        code: "ECONNABORTED",
        message: "timeout",
      })
      .mockResolvedValueOnce({ status: 200, data: "ok", headers: {} });

    await client.requestRaw({ method: "GET", path: "/meta" });

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining("dify-client-node retry")
    );
    consoleInfo.mockRestore();
  });
});
