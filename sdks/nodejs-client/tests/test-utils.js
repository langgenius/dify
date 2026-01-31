import axios from "axios";
import { vi } from "vitest";
import { HttpClient } from "../src/http/client";

export const createHttpClient = (configOverrides = {}) => {
  const mockRequest = vi.fn();
  vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
  const client = new HttpClient({ apiKey: "test", ...configOverrides });
  return { client, mockRequest };
};

export const createHttpClientWithSpies = (configOverrides = {}) => {
  const { client, mockRequest } = createHttpClient(configOverrides);
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
    mockRequest,
    request,
    requestStream,
    requestBinaryStream,
  };
};
