import axios from "axios";
import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import type { Readable } from "node:stream";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
} from "../types/common";
import type {
  DifyClientConfig,
  DifyResponse,
  Headers,
  QueryParams,
  RequestMethod,
} from "../types/common";
import type { DifyError } from "../errors/dify-error";
import {
  APIError,
  AuthenticationError,
  FileUploadError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from "../errors/dify-error";
import { getFormDataHeaders, isFormData } from "./form-data";
import { createBinaryStream, createSseStream } from "./sse";
import { getRetryDelayMs, shouldRetry, sleep } from "./retry";
import { validateParams } from "../client/validation";

const DEFAULT_USER_AGENT = "dify-client-node";

export type RequestOptions = {
  method: RequestMethod;
  path: string;
  query?: QueryParams;
  data?: unknown;
  headers?: Headers;
  responseType?: AxiosRequestConfig["responseType"];
};

export type HttpClientSettings = Required<
  Omit<DifyClientConfig, "apiKey">
> & {
  apiKey: string;
};

const normalizeSettings = (config: DifyClientConfig): HttpClientSettings => ({
  apiKey: config.apiKey,
  baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
  timeout: config.timeout ?? DEFAULT_TIMEOUT_SECONDS,
  maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
  retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY_SECONDS,
  enableLogging: config.enableLogging ?? false,
});

const normalizeHeaders = (headers: AxiosResponse["headers"]): Headers => {
  const result: Headers = {};
  if (!headers) {
    return result;
  }
  Object.entries(headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      result[key.toLowerCase()] = value.join(", ");
    } else if (typeof value === "string") {
      result[key.toLowerCase()] = value;
    } else if (typeof value === "number") {
      result[key.toLowerCase()] = value.toString();
    }
  });
  return result;
};

const resolveRequestId = (headers: Headers): string | undefined =>
  headers["x-request-id"] ?? headers["x-requestid"];

const buildRequestUrl = (baseUrl: string, path: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${path}`;
};

const buildQueryString = (params?: QueryParams): string => {
  if (!params) {
    return "";
  }
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        searchParams.append(key, String(item));
      });
      return;
    }
    searchParams.append(key, String(value));
  });
  return searchParams.toString();
};

const parseRetryAfterSeconds = (headerValue?: string): number | undefined => {
  if (!headerValue) {
    return undefined;
  }
  const asNumber = Number.parseInt(headerValue, 10);
  if (!Number.isNaN(asNumber)) {
    return asNumber;
  }
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? Math.ceil(diff / 1000) : 0;
  }
  return undefined;
};

const isReadableStream = (value: unknown): value is Readable => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as { pipe?: unknown }).pipe === "function";
};

const isUploadLikeRequest = (config?: AxiosRequestConfig): boolean => {
  const url = (config?.url ?? "").toLowerCase();
  if (!url) {
    return false;
  }
  return (
    url.includes("upload") ||
    url.includes("/files/") ||
    url.includes("audio-to-text") ||
    url.includes("create_by_file") ||
    url.includes("update_by_file")
  );
};

const resolveErrorMessage = (status: number, responseBody: unknown): string => {
  if (typeof responseBody === "string" && responseBody.trim().length > 0) {
    return responseBody;
  }
  if (
    responseBody &&
    typeof responseBody === "object" &&
    "message" in responseBody
  ) {
    const message = (responseBody as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return `Request failed with status code ${status}`;
};

const mapAxiosError = (error: unknown): DifyError => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      const status = axiosError.response.status;
      const headers = normalizeHeaders(axiosError.response.headers);
      const requestId = resolveRequestId(headers);
      const responseBody = axiosError.response.data;
      const message = resolveErrorMessage(status, responseBody);

      if (status === 401) {
        return new AuthenticationError(message, {
          statusCode: status,
          responseBody,
          requestId,
        });
      }
      if (status === 429) {
        const retryAfter = parseRetryAfterSeconds(headers["retry-after"]);
        return new RateLimitError(message, {
          statusCode: status,
          responseBody,
          requestId,
          retryAfter,
        });
      }
      if (status === 422) {
        return new ValidationError(message, {
          statusCode: status,
          responseBody,
          requestId,
        });
      }
      if (status === 400) {
        if (isUploadLikeRequest(axiosError.config)) {
          return new FileUploadError(message, {
            statusCode: status,
            responseBody,
            requestId,
          });
        }
      }
      return new APIError(message, {
        statusCode: status,
        responseBody,
        requestId,
      });
    }
    if (axiosError.code === "ECONNABORTED") {
      return new TimeoutError("Request timed out", { cause: axiosError });
    }
    return new NetworkError(axiosError.message, { cause: axiosError });
  }
  if (error instanceof Error) {
    return new NetworkError(error.message, { cause: error });
  }
  return new NetworkError("Unexpected network error", { cause: error });
};

export class HttpClient {
  private axios: AxiosInstance;
  private settings: HttpClientSettings;

  constructor(config: DifyClientConfig) {
    this.settings = normalizeSettings(config);
    this.axios = axios.create({
      baseURL: this.settings.baseUrl,
      timeout: this.settings.timeout * 1000,
    });
  }

  updateApiKey(apiKey: string): void {
    this.settings.apiKey = apiKey;
  }

  getSettings(): HttpClientSettings {
    return { ...this.settings };
  }

  async request<T>(options: RequestOptions): Promise<DifyResponse<T>> {
    const response = await this.requestRaw(options);
    const headers = normalizeHeaders(response.headers);
    return {
      data: response.data as T,
      status: response.status,
      headers,
      requestId: resolveRequestId(headers),
    };
  }

  async requestStream<T>(options: RequestOptions) {
    const response = await this.requestRaw({
      ...options,
      responseType: "stream",
    });
    const headers = normalizeHeaders(response.headers);
    return createSseStream<T>(response.data as Readable, {
      status: response.status,
      headers,
      requestId: resolveRequestId(headers),
    });
  }

  async requestBinaryStream(options: RequestOptions) {
    const response = await this.requestRaw({
      ...options,
      responseType: "stream",
    });
    const headers = normalizeHeaders(response.headers);
    return createBinaryStream(response.data as Readable, {
      status: response.status,
      headers,
      requestId: resolveRequestId(headers),
    });
  }

  async requestRaw(options: RequestOptions): Promise<AxiosResponse> {
    const { method, path, query, data, headers, responseType } = options;
    const { apiKey, enableLogging, maxRetries, retryDelay, timeout } =
      this.settings;

    if (query) {
      validateParams(query as Record<string, unknown>);
    }
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      !isFormData(data) &&
      !isReadableStream(data)
    ) {
      validateParams(data as Record<string, unknown>);
    }

    const requestHeaders: Headers = {
      Authorization: `Bearer ${apiKey}`,
      ...headers,
    };
    if (
      typeof process !== "undefined" &&
      !!process.versions?.node &&
      !requestHeaders["User-Agent"] &&
      !requestHeaders["user-agent"]
    ) {
      requestHeaders["User-Agent"] = DEFAULT_USER_AGENT;
    }

    if (isFormData(data)) {
      Object.assign(requestHeaders, getFormDataHeaders(data));
    } else if (data && method !== "GET") {
      requestHeaders["Content-Type"] = "application/json";
    }

    const url = buildRequestUrl(this.settings.baseUrl, path);

    if (enableLogging) {
      console.info(`dify-client-node request ${method} ${url}`);
    }

    const axiosConfig: AxiosRequestConfig = {
      method,
      url: path,
      params: query,
      paramsSerializer: {
        serialize: (params) => buildQueryString(params as QueryParams),
      },
      headers: requestHeaders,
      responseType: responseType ?? "json",
      timeout: timeout * 1000,
    };

    if (method !== "GET" && data !== undefined) {
      axiosConfig.data = data;
    }

    let attempt = 0;
    // `attempt` is a zero-based retry counter
    // Total attempts = 1 (initial) + maxRetries
    // e.g., maxRetries=3 means: attempt 0 (initial), then retries at 1, 2, 3
    while (true) {
      try {
        const response = await this.axios.request(axiosConfig);
        if (enableLogging) {
          console.info(
            `dify-client-node response ${response.status} ${method} ${url}`
          );
        }
        return response;
      } catch (error) {
        const mapped = mapAxiosError(error);
        if (!shouldRetry(mapped, attempt, maxRetries)) {
          throw mapped;
        }
        const retryAfterSeconds =
          mapped instanceof RateLimitError ? mapped.retryAfter : undefined;
        const delay = getRetryDelayMs(attempt + 1, retryDelay, retryAfterSeconds);
        if (enableLogging) {
          console.info(
            `dify-client-node retry ${attempt + 1} in ${delay}ms for ${method} ${url}`
          );
        }
        attempt += 1;
        await sleep(delay);
      }
    }
  }
}
