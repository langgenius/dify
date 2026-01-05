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
import {
  DifyError,
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

export type ResponseType = "json" | "stream" | "text" | "blob" | "arraybuffer";

export type RequestOptions = {
  method: RequestMethod;
  path: string;
  query?: QueryParams;
  data?: unknown;
  headers?: Headers;
  responseType?: ResponseType;
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

const normalizeHeaders = (headers: Record<string, string | string[] | number | undefined>): Headers => {
  const result: Headers = {};
  if (!headers) {
    return result;
  }
  Object.entries(headers).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
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

const isUploadLikeRequest = (url: string): boolean => {
  if (!url) {
    return false;
  }
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes("upload") ||
    lowerUrl.includes("/files/") ||
    lowerUrl.includes("audio-to-text") ||
    lowerUrl.includes("create_by_file") ||
    lowerUrl.includes("update_by_file")
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

const mapFetchError = (
  error: unknown,
  url: string,
  response?: Response,
  responseBody?: unknown
): DifyError => {
  if (response) {
    const status = response.status;
    const headers = normalizeHeaders(Object.fromEntries(response.headers.entries()));
    const requestId = resolveRequestId(headers);
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
      if (isUploadLikeRequest(url)) {
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

  if (error instanceof Error) {
    if (error.name === "AbortError" || error.message.includes("aborted")) {
      return new TimeoutError("Request timed out", { cause: error });
    }
    return new NetworkError(error.message, { cause: error });
  }
  return new NetworkError("Unexpected network error", { cause: error });
};

export class HttpClient {
  private settings: HttpClientSettings;

  constructor(config: DifyClientConfig) {
    this.settings = normalizeSettings(config);
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

  async requestRaw(options: RequestOptions): Promise<{
    status: number;
    data: unknown;
    headers: Headers;
  }> {
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

    let url = buildRequestUrl(this.settings.baseUrl, path);
    const queryString = buildQueryString(query);
    if (queryString) {
      url += `?${queryString}`;
    }

    if (enableLogging) {
      console.info(`dify-client-node request ${method} ${url}`);
    }

    let body: BodyInit | undefined;
    if (method !== "GET" && data !== undefined) {
      if (isFormData(data) || isReadableStream(data)) {
        body = data as BodyInit;
      } else {
        body = JSON.stringify(data);
      }
    }

    let attempt = 0;
    // `attempt` is a zero-based retry counter
    // Total attempts = 1 (initial) + maxRetries
    // e.g., maxRetries=3 means: attempt 0 (initial), then retries at 1, 2, 3
    while (true) {
      // Create a new AbortController for each attempt to handle timeouts properly
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), timeout * 1000);

      try {
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body,
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const contentType = response.headers.get("content-type") || "";
          let responseBody: unknown;
          // Read body as text first to avoid "Body has already been read" error
          const text = await response.text();
          if (contentType.includes("application/json")) {
            try {
              responseBody = text ? JSON.parse(text) : null;
            } catch {
              // Fallback to raw text if JSON parsing fails
              responseBody = text;
            }
          } else {
            responseBody = text;
          }
          throw mapFetchError(new Error(`HTTP ${response.status}`), url, response, responseBody);
        }

        if (enableLogging) {
          console.info(
            `dify-client-node response ${response.status} ${method} ${url}`
          );
        }

        let responseData: unknown;
        if (responseType === "stream") {
          // For Node.js, we need to convert web streams to Node.js streams
          if (response.body) {
            const { Readable } = await import("node:stream");
            // Type assertion needed: DOM ReadableStream vs Node.js stream types are incompatible
            // but Readable.fromWeb handles the conversion correctly at runtime
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            responseData = Readable.fromWeb(response.body as any);
          } else {
            throw new Error("Response body is null");
          }
        } else if (responseType === "text") {
          responseData = await response.text();
        } else if (responseType === "blob") {
          responseData = await response.blob();
        } else if (responseType === "arraybuffer") {
          responseData = await response.arrayBuffer();
        } else {
          // json or default
          const contentType = response.headers.get("content-type") || "";
          // Read body as text first to handle malformed JSON gracefully
          const text = await response.text();
          if (contentType.includes("application/json")) {
            try {
              responseData = text ? JSON.parse(text) : null;
            } catch {
              // Fallback to raw text if JSON parsing fails
              responseData = text;
            }
          } else {
            responseData = text;
          }
        }

        return {
          status: response.status,
          data: responseData,
          headers: Object.fromEntries(response.headers.entries()),
        };
      } catch (error) {
        clearTimeout(timeoutId);

        let mapped: DifyError;
        if (error instanceof DifyError) {
          mapped = error;
        } else {
          mapped = mapFetchError(error, url);
        }

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
