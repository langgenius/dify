import { vi } from "vitest";
import { HttpClient } from "../src/http/client";

export const createHttpClient = (configOverrides = {}) => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;
  const client = new HttpClient({ apiKey: "test", ...configOverrides });
  return { client, mockFetch };
};

export const createHttpClientWithSpies = (configOverrides = {}) => {
  const { client, mockFetch } = createHttpClient(configOverrides);
  const request = vi
    .spyOn(client, "request")
    .mockResolvedValue({ data: "ok", status: 200, headers: {} });
  const requestStream = vi
    .spyOn(client, "requestStream")
    .mockResolvedValue({ data: null });
  const requestBinaryStream = vi
    .spyOn(client, "requestBinaryStream")
    .mockResolvedValue({ data: null });
  return {
    client,
    mockFetch,
    request,
    requestStream,
    requestBinaryStream,
  };
};
