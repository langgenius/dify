import { Readable } from "node:stream";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
} from "../types/common";
import type {
  BinaryStream,
  DifyClientConfig,
  DifyResponse,
  DifyStream,
  Headers,
  JsonValue,
  QueryParams,
  RequestMethod,
} from "../types/common";
import {
  APIError,
  AuthenticationError,
  DifyError,
  FileUploadError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from "../errors/dify-error";
import type { SdkFormData } from "./form-data";
import { getFormDataHeaders, isFormData } from "./form-data";
import { createBinaryStream, createSseStream } from "./sse";
import { getRetryDelayMs, shouldRetry, sleep } from "./retry";
import { validateParams } from "../client/validation";
import { hasStringProperty, isRecord } from "../internal/type-guards";

const DEFAULT_USER_AGENT = "dify-client-node";

export type HttpResponseType = "json" | "bytes" | "stream" | "arraybuffer";

export type HttpRequestBody =
  | JsonValue
  | Readable
  | SdkFormData
  | URLSearchParams
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | string
  | null;

export type ResponseDataFor<TResponseType extends HttpResponseType> =
  TResponseType extends "stream"
    ? Readable
    : TResponseType extends "bytes" | "arraybuffer"
      ? Buffer
      : JsonValue | string | null;

export type RawHttpResponse<TData = unknown> = {
  data: TData;
  status: number;
  headers: Headers;
  requestId?: string;
  url: string;
};

export type RequestOptions<TResponseType extends HttpResponseType = "json"> = {
  method: RequestMethod;
  path: string;
  query?: QueryParams;
  data?: HttpRequestBody;
  headers?: Headers;
  responseType?: TResponseType;
};

export type HttpClientSettings = Required<
  Omit<DifyClientConfig, "apiKey">
> & {
  apiKey: string;
};

type FetchRequestInit = RequestInit & {
  duplex?: "half";
};

type PreparedRequestBody = {
  body?: BodyInit | null;
  headers: Headers;
  duplex?: "half";
  replayable: boolean;
};

type TimeoutContext = {
  cleanup: () => void;
  reason: Error;
  signal: AbortSignal;
};

const normalizeSettings = (config: DifyClientConfig): HttpClientSettings => ({
  apiKey: config.apiKey,
  baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
  timeout: config.timeout ?? DEFAULT_TIMEOUT_SECONDS,
  maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
  retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY_SECONDS,
  enableLogging: config.enableLogging ?? false,
});

const normalizeHeaders = (headers: globalThis.Headers): Headers => {
  const result: Headers = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
};

const resolveRequestId = (headers: Headers): string | undefined =>
  headers["x-request-id"] ?? headers["x-requestid"];

const buildRequestUrl = (
  baseUrl: string,
  path: string,
  query?: QueryParams
): string => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${trimmed}${path}`);
  const queryString = buildQueryString(query);
  if (queryString) {
    url.search = queryString;
  }
  return url.toString();
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

const isPipeableStream = (value: unknown): value is { pipe: (destination: unknown) => unknown } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as { pipe?: unknown }).pipe === "function";
};

const toNodeReadable = (value: unknown): Readable | null => {
  if (value instanceof Readable) {
    return value;
  }
  if (!isPipeableStream(value)) {
    return null;
  }
  const readable = new Readable({
    read() {},
  });
  return readable.wrap(value as NodeJS.ReadableStream);
};

const isBinaryBody = (
  value: unknown
): value is ArrayBuffer | ArrayBufferView | Blob => {
  if (value instanceof Blob) {
    return true;
  }
  if (value instanceof ArrayBuffer) {
    return true;
  }
  return ArrayBuffer.isView(value);
};

const isJsonBody = (value: unknown): value is Exclude<JsonValue, string> =>
  value === null ||
  typeof value === "boolean" ||
  typeof value === "number" ||
  Array.isArray(value) ||
  isRecord(value);

const isUploadLikeRequest = (path: string): boolean => {
  const normalizedPath = path.toLowerCase();
  return (
    normalizedPath.includes("upload") ||
    normalizedPath.includes("/files/") ||
    normalizedPath.includes("audio-to-text") ||
    normalizedPath.includes("create_by_file") ||
    normalizedPath.includes("update_by_file")
  );
};

const resolveErrorMessage = (status: number, responseBody: unknown): string => {
  if (typeof responseBody === "string" && responseBody.trim().length > 0) {
    return responseBody;
  }
  if (hasStringProperty(responseBody, "message")) {
    const message = responseBody.message.trim();
    if (message.length > 0) {
      return message;
    }
  }
  return `Request failed with status code ${status}`;
};

const parseJsonLikeText = (
  value: string,
  contentType?: string | null
): JsonValue | string | null => {
  if (value.length === 0) {
    return null;
  }
  const shouldParseJson =
    contentType?.includes("application/json") === true ||
    contentType?.includes("+json") === true;
  if (!shouldParseJson) {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return value;
    }
  }
  return JSON.parse(value) as JsonValue;
};

const prepareRequestBody = (
  method: RequestMethod,
  data: HttpRequestBody | undefined
): PreparedRequestBody => {
  if (method === "GET" || data === undefined) {
    return {
      body: undefined,
      headers: {},
      replayable: true,
    };
  }

  if (isFormData(data)) {
    if ("getHeaders" in data && typeof data.getHeaders === "function") {
      const readable = toNodeReadable(data);
      if (!readable) {
        throw new FileUploadError(
          "Legacy FormData must be a readable stream when used with fetch"
        );
      }
      return {
        body: Readable.toWeb(readable) as BodyInit,
        headers: getFormDataHeaders(data),
        duplex: "half",
        replayable: false,
      };
    }
    return {
      body: data as BodyInit,
      headers: getFormDataHeaders(data),
      replayable: true,
    };
  }

  if (typeof data === "string") {
    return {
      body: data,
      headers: {},
      replayable: true,
    };
  }

  const readable = toNodeReadable(data);
  if (readable) {
    return {
      body: Readable.toWeb(readable) as BodyInit,
      headers: {},
      duplex: "half",
      replayable: false,
    };
  }

  if (data instanceof URLSearchParams || isBinaryBody(data)) {
    const body =
      ArrayBuffer.isView(data) && !(data instanceof Uint8Array)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : data;
    return {
      body: body as BodyInit,
      headers: {},
      replayable: true,
    };
  }

  if (isJsonBody(data)) {
    return {
      body: JSON.stringify(data),
      headers: {
        "Content-Type": "application/json",
      },
      replayable: true,
    };
  }

  throw new ValidationError("Unsupported request body type");
};

const createTimeoutContext = (timeoutMs: number): TimeoutContext => {
  const controller = new AbortController();
  const reason = new Error("Request timed out");
  const timer = setTimeout(() => {
    controller.abort(reason);
  }, timeoutMs);
  return {
    signal: controller.signal,
    reason,
    cleanup: () => {
      clearTimeout(timer);
    },
  };
};

const parseResponseBody = async <TResponseType extends HttpResponseType>(
  response: Response,
  responseType: TResponseType
): Promise<ResponseDataFor<TResponseType>> => {
  if (responseType === "stream") {
    if (!response.body) {
      throw new NetworkError("Response body is empty");
    }
    return Readable.fromWeb(
      response.body as unknown as Parameters<typeof Readable.fromWeb>[0]
    ) as ResponseDataFor<TResponseType>;
  }

  if (responseType === "bytes" || responseType === "arraybuffer") {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes as ResponseDataFor<TResponseType>;
  }

  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return null as ResponseDataFor<TResponseType>;
  }

  const text = await response.text();
  try {
    return parseJsonLikeText(
      text,
      response.headers.get("content-type")
    ) as ResponseDataFor<TResponseType>;
  } catch (error) {
    if (!response.ok && error instanceof SyntaxError) {
      return text as ResponseDataFor<TResponseType>;
    }
    throw error;
  }
};

const mapHttpError = (
  response: RawHttpResponse,
  path: string
): DifyError => {
  const status = response.status;
  const responseBody = response.data;
  const message = resolveErrorMessage(status, responseBody);

  if (status === 401) {
    return new AuthenticationError(message, {
      statusCode: status,
      responseBody,
      requestId: response.requestId,
    });
  }

  if (status === 429) {
    const retryAfter = parseRetryAfterSeconds(response.headers["retry-after"]);
    return new RateLimitError(message, {
      statusCode: status,
      responseBody,
      requestId: response.requestId,
      retryAfter,
    });
  }

  if (status === 422) {
    return new ValidationError(message, {
      statusCode: status,
      responseBody,
      requestId: response.requestId,
    });
  }

  if (status === 400 && isUploadLikeRequest(path)) {
    return new FileUploadError(message, {
      statusCode: status,
      responseBody,
      requestId: response.requestId,
    });
  }

  return new APIError(message, {
    statusCode: status,
    responseBody,
    requestId: response.requestId,
  });
};

const mapTransportError = (
  error: unknown,
  timeoutContext: TimeoutContext
): DifyError => {
  if (error instanceof DifyError) {
    return error;
  }

  if (
    timeoutContext.signal.aborted &&
    timeoutContext.signal.reason === timeoutContext.reason
  ) {
    return new TimeoutError("Request timed out", { cause: error });
  }

  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
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

  async request<
    T,
    TResponseType extends HttpResponseType = "json",
  >(options: RequestOptions<TResponseType>): Promise<DifyResponse<T>> {
    const response = await this.requestRaw(options);
    return {
      data: response.data as T,
      status: response.status,
      headers: response.headers,
      requestId: response.requestId,
    };
  }

  async requestStream<T>(options: RequestOptions): Promise<DifyStream<T>> {
    const response = await this.requestRaw({
      ...options,
      responseType: "stream",
    });
    return createSseStream<T>(response.data, {
      status: response.status,
      headers: response.headers,
      requestId: response.requestId,
    });
  }

  async requestBinaryStream(options: RequestOptions): Promise<BinaryStream> {
    const response = await this.requestRaw({
      ...options,
      responseType: "stream",
    });
    return createBinaryStream(response.data, {
      status: response.status,
      headers: response.headers,
      requestId: response.requestId,
    });
  }

  async requestRaw<TResponseType extends HttpResponseType = "json">(
    options: RequestOptions<TResponseType>
  ): Promise<RawHttpResponse<ResponseDataFor<TResponseType>>> {
    const responseType = options.responseType ?? "json";
    const { method, path, query, data, headers } = options;
    const { apiKey, enableLogging, maxRetries, retryDelay, timeout } = this.settings;

    if (query) {
      validateParams(query as Record<string, unknown>);
    }

    if (isRecord(data) && !Array.isArray(data) && !isFormData(data) && !isPipeableStream(data)) {
      validateParams(data);
    }

    const url = buildRequestUrl(this.settings.baseUrl, path, query);

    if (enableLogging) {
      console.info(`dify-client-node request ${method} ${url}`);
    }

    let attempt = 0;
    while (true) {
      const preparedBody = prepareRequestBody(method, data);
      const requestHeaders: Headers = {
        Authorization: `Bearer ${apiKey}`,
        ...preparedBody.headers,
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

      const timeoutContext = createTimeoutContext(timeout * 1000);
      const requestInit: FetchRequestInit = {
        method,
        headers: requestHeaders,
        body: preparedBody.body,
        signal: timeoutContext.signal,
      };

      if (preparedBody.duplex) {
        requestInit.duplex = preparedBody.duplex;
      }

      try {
        const fetchResponse = await fetch(url, requestInit);
        const responseHeaders = normalizeHeaders(fetchResponse.headers);
        const parsedBody =
          (await parseResponseBody(fetchResponse, responseType)) as ResponseDataFor<TResponseType>;
        const response: RawHttpResponse<ResponseDataFor<TResponseType>> = {
          data: parsedBody,
          status: fetchResponse.status,
          headers: responseHeaders,
          requestId: resolveRequestId(responseHeaders),
          url,
        };

        if (!fetchResponse.ok) {
          throw mapHttpError(response, path);
        }

        if (enableLogging) {
          console.info(
            `dify-client-node response ${response.status} ${method} ${url}`
          );
        }

        return response;
      } catch (error) {
        const mapped = mapTransportError(error, timeoutContext);
        const shouldRetryRequest =
          preparedBody.replayable && shouldRetry(mapped, attempt, maxRetries);
        if (!shouldRetryRequest) {
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
      } finally {
        timeoutContext.cleanup();
      }
    }
  }
}
