import {
  type ParserAdapter,
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createNativeStructuredDataParser,
  createParserRouter,
  createUnstructuredParserClient,
} from "@knowledge/parsers";
import { Agent, type Dispatcher, fetch as undiciFetch } from "undici";

const defaultUnstructuredRequestTimeoutMs = 120_000;
const maxUnstructuredRequestTimeoutMs = 3_600_000;

interface NodeUnstructuredFetchOptions {
  readonly createDispatcher?: (
    options: Readonly<{ bodyTimeout: number; headersTimeout: number }>,
  ) => Dispatcher;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs: number;
}

type DispatcherRequestInit = RequestInit & {
  readonly dispatcher: Dispatcher;
  readonly duplex?: "half";
};

export interface ApiParserEnv {
  readonly NODE_ENV?: string | undefined;
  readonly UNSTRUCTURED_API_KEY?: string | undefined;
  readonly UNSTRUCTURED_API_URL?: string | undefined;
  readonly UNSTRUCTURED_DEFAULT_LANGUAGE?: string | undefined;
  readonly UNSTRUCTURED_MAX_CONCURRENCY?: string | undefined;
  readonly UNSTRUCTURED_MAX_RESPONSE_BYTES?: string | undefined;
  readonly UNSTRUCTURED_MAX_RETRIES?: string | undefined;
  readonly UNSTRUCTURED_PORT?: string | undefined;
  readonly UNSTRUCTURED_RETRY_DELAY_MS?: string | undefined;
  readonly UNSTRUCTURED_REQUEST_TIMEOUT_MS?: string | undefined;
}

export interface CreateApiDocumentParserOptions {
  readonly env?: ApiParserEnv | undefined;
  readonly fetch?: typeof fetch | undefined;
}

export function createApiDocumentParser({
  env = process.env,
  fetch: fetchImpl,
}: CreateApiDocumentParserOptions = {}): ParserAdapter {
  const unstructured = createApiUnstructuredParser({
    env,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  return createParserRouter({
    html: createNativeHtmlParser(),
    markdown: createNativeMarkdownParser(),
    structured: createNativeStructuredDataParser(),
    unstructured,
  });
}

function createApiUnstructuredParser({
  env,
  fetch: fetchImpl,
}: {
  readonly env: ApiParserEnv;
  readonly fetch?: typeof fetch | undefined;
}): ParserAdapter {
  const endpoint = resolveUnstructuredApiUrl(env);

  if (!endpoint) {
    return {
      kind: "unstructured",
      parse: async () => {
        throw new Error("Unstructured parser is not configured");
      },
    };
  }

  const requestTimeoutMs =
    env.UNSTRUCTURED_REQUEST_TIMEOUT_MS === undefined
      ? defaultUnstructuredRequestTimeoutMs
      : parseBoundedPositiveInteger(
          env.UNSTRUCTURED_REQUEST_TIMEOUT_MS,
          "UNSTRUCTURED_REQUEST_TIMEOUT_MS",
          maxUnstructuredRequestTimeoutMs,
        );

  return createUnstructuredParserClient({
    ...(env.UNSTRUCTURED_DEFAULT_LANGUAGE?.trim()
      ? { defaultLanguage: env.UNSTRUCTURED_DEFAULT_LANGUAGE.trim() }
      : {}),
    endpoint,
    ...(env.UNSTRUCTURED_API_KEY?.trim() ? { apiKey: env.UNSTRUCTURED_API_KEY.trim() } : {}),
    fetch:
      fetchImpl ??
      createNodeUnstructuredFetch({
        requestTimeoutMs,
      }),
    ...(env.UNSTRUCTURED_MAX_CONCURRENCY !== undefined
      ? {
          maxConcurrency: parseBoundedPositiveInteger(
            env.UNSTRUCTURED_MAX_CONCURRENCY,
            "UNSTRUCTURED_MAX_CONCURRENCY",
            32,
          ),
        }
      : {}),
    ...(env.UNSTRUCTURED_MAX_RESPONSE_BYTES !== undefined
      ? {
          maxResponseBytes: parsePositiveInteger(
            env.UNSTRUCTURED_MAX_RESPONSE_BYTES,
            "UNSTRUCTURED_MAX_RESPONSE_BYTES",
          ),
        }
      : {}),
    ...(env.UNSTRUCTURED_MAX_RETRIES !== undefined
      ? {
          maxRetries: parseNonNegativeInteger(
            env.UNSTRUCTURED_MAX_RETRIES,
            "UNSTRUCTURED_MAX_RETRIES",
          ),
        }
      : {}),
    ...(env.UNSTRUCTURED_RETRY_DELAY_MS !== undefined
      ? {
          retryDelayMs: parseNonNegativeInteger(
            env.UNSTRUCTURED_RETRY_DELAY_MS,
            "UNSTRUCTURED_RETRY_DELAY_MS",
          ),
        }
      : {}),
    requestTimeoutMs,
  });
}

export function createNodeUnstructuredFetch({
  createDispatcher = (options) => new Agent(options),
  fetch: fetchImpl = undiciFetch as unknown as typeof fetch,
  requestTimeoutMs,
}: NodeUnstructuredFetchOptions): typeof fetch {
  const dispatcher = createDispatcher({
    bodyTimeout: requestTimeoutMs,
    headersTimeout: requestTimeoutMs,
  });

  return (input, init) => {
    if (input instanceof Request) {
      const body = init?.body ?? input.body;

      return fetchImpl(input.url, {
        ...init,
        body,
        dispatcher,
        ...(body ? { duplex: "half" } : {}),
        headers: init?.headers ?? input.headers,
        method: init?.method ?? input.method,
        signal: init?.signal ?? input.signal,
      } as DispatcherRequestInit);
    }

    return fetchImpl(input, {
      ...init,
      dispatcher,
    } as DispatcherRequestInit);
  };
}

function resolveUnstructuredApiUrl(env: ApiParserEnv): string | undefined {
  const configured = env.UNSTRUCTURED_API_URL?.trim();
  if (configured) {
    return configured;
  }

  if (env.NODE_ENV === "production") {
    return undefined;
  }

  const port = env.UNSTRUCTURED_PORT?.trim();
  if (!port) {
    return undefined;
  }

  return `http://127.0.0.1:${parsePort(port, "UNSTRUCTURED_PORT")}`;
}

function parsePort(value: string, name: string): number {
  const port = parsePositiveInteger(value, name);

  if (port > 65535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }

  return port;
}

function parseBoundedPositiveInteger(value: string, name: string, max: number): number {
  const parsed = parsePositiveInteger(value, name);

  if (parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}`);
  }

  return parsed;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = parseInteger(value, name);

  if (parsed < 1) {
    throw new Error(`${name} must be at least 1`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = parseInteger(value, name);

  if (parsed < 0) {
    throw new Error(`${name} must be non-negative`);
  }

  return parsed;
}

function parseInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be an integer`);
  }

  return Number(value);
}
