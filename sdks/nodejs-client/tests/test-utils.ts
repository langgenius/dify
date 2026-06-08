import { vi } from "vitest";
import { HttpClient } from "../src/http/client";
import type { DifyClientConfig, DifyResponse } from "../src/types/common";

type FetchMock = ReturnType<typeof vi.fn>;
type RequestSpy = ReturnType<typeof vi.fn>;

type HttpClientWithFetchMock = {
  client: HttpClient;
  fetchMock: FetchMock;
};

type HttpClientWithSpies = HttpClientWithFetchMock & {
  request: RequestSpy;
  requestStream: RequestSpy;
  requestBinaryStream: RequestSpy;
};

export const createHttpClient = (
  configOverrides: Partial<DifyClientConfig> = {}
): HttpClientWithFetchMock => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const client = new HttpClient({ apiKey: "test", ...configOverrides });
  return { client, fetchMock };
};

export const createHttpClientWithSpies = (
  configOverrides: Partial<DifyClientConfig> = {}
): HttpClientWithSpies => {
  const { client, fetchMock } = createHttpClient(configOverrides);
  const request = vi
    .spyOn(client, "request")
    .mockResolvedValue({ data: "ok", status: 200, headers: {} } as DifyResponse<string>);
  const requestStream = vi
    .spyOn(client, "requestStream")
    .mockResolvedValue({ data: null, status: 200, headers: {} } as never);
  const requestBinaryStream = vi
    .spyOn(client, "requestBinaryStream")
    .mockResolvedValue({ data: null, status: 200, headers: {} } as never);
  return {
    client,
    fetchMock,
    request,
    requestStream,
    requestBinaryStream,
  };
};
