import { z } from "zod";

/**
 * Transport client for plugin-daemon datasource dispatch only.
 *
 * Mirrors the contract Dify uses (api/core/plugin/impl/base.py + datasource.py):
 *   POST {baseUrl}/plugin/{tenant_id}/dispatch/datasource/{method}
 *   headers: X-Api-Key, X-Plugin-ID, Content-Type: application/json
 *   body:    { user_id?, data: {...} }
 *   response: one JSON envelope `{"code":0,"message":"","data":{...}}` per non-empty line,
 *             with an optional `data:` SSE prefix (dify strips it when present); code != 0 is an
 *             error whose message may be a nested JSON {error_type, message} (PluginInvokeError
 *             wraps the real error), and a success envelope must carry non-empty data.
 *
 * Model invocation is deliberately absent. KnowledgeFS calls Dify's inner model API, and Dify's
 * ModelManager resolves the tenant model instance and its plugin-daemon credentials.
 */

export type PluginDaemonErrorCode =
  | "plugin_daemon_aborted"
  | "plugin_daemon_input"
  | "plugin_daemon_invoke"
  | "plugin_daemon_rate_limited"
  | "plugin_daemon_request_failed"
  | "plugin_daemon_response_invalid"
  | "plugin_daemon_timeout";

export class PluginDaemonError extends Error {
  readonly code: PluginDaemonErrorCode;
  readonly daemonCode?: number;
  readonly errorType?: string;
  readonly status?: number;

  constructor(
    message: string,
    {
      cause,
      code,
      daemonCode,
      errorType,
      status,
    }: {
      readonly cause?: unknown;
      readonly code: PluginDaemonErrorCode;
      readonly daemonCode?: number | undefined;
      readonly errorType?: string | undefined;
      readonly status?: number | undefined;
    },
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PluginDaemonError";
    this.code = code;
    if (daemonCode !== undefined) {
      this.daemonCode = daemonCode;
    }
    if (errorType !== undefined) {
      this.errorType = errorType;
    }
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export interface PluginDaemonClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Hard deadline for datasource dispatch, including streaming response iteration. */
  readonly dispatchRequestTimeoutMs?: number | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly maxResponseBytes?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryDelayMs?: number | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Datasource dispatch methods (dify api/core/plugin/impl/datasource.py). Note the wire path is
 * `dispatch/datasource/{method}` WITHOUT the `/invoke` suffix that model ops use.
 */
export type PluginDaemonDatasourceMethod =
  | "get_online_document_page_content"
  | "get_online_document_pages"
  | "get_website_crawl"
  | "online_drive_browse_files"
  | "online_drive_download_file"
  | "validate_credentials";

export interface PluginDaemonDatasourceInput {
  readonly data: Record<string, unknown>;
  readonly method: PluginDaemonDatasourceMethod;
  readonly pluginId: string;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

export interface PluginDaemonDatasourceClient {
  /** Stream every envelope `data` payload from a datasource method dispatch. */
  dispatchDatasourceStream(input: PluginDaemonDatasourceInput): AsyncGenerator<unknown>;
}

export type PluginDaemonClient = PluginDaemonDatasourceClient;

interface PluginDaemonRuntime {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly dispatchRequestTimeoutMs: number;
  readonly fetchImpl: typeof fetch;
  readonly maxResponseBytes: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_DISPATCH_REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUEST_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 100;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 16_384;

const PluginDaemonEnvelopeSchema = z.object({
  code: z.number(),
  data: z.unknown().optional(),
  message: z.string().optional(),
});

export function createPluginDaemonClient(options: PluginDaemonClientOptions): PluginDaemonClient {
  const baseUrl = options.baseUrl.trim();

  if (!baseUrl) {
    throw new PluginDaemonError("Plugin daemon baseUrl is required", {
      code: "plugin_daemon_input",
    });
  }

  if (!options.apiKey.trim()) {
    throw new PluginDaemonError("Plugin daemon apiKey is required", {
      code: "plugin_daemon_input",
    });
  }

  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const dispatchRequestTimeoutMs =
    options.dispatchRequestTimeoutMs ?? DEFAULT_DISPATCH_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new PluginDaemonError("Plugin daemon maxResponseBytes must be at least 1", {
      code: "plugin_daemon_input",
    });
  }

  validateRequestTimeout(dispatchRequestTimeoutMs, "dispatchRequestTimeoutMs");

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new PluginDaemonError("Plugin daemon maxRetries must be at least 0", {
      code: "plugin_daemon_input",
    });
  }

  const runtime: PluginDaemonRuntime = {
    apiKey: options.apiKey,
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    dispatchRequestTimeoutMs,
    fetchImpl: options.fetch ?? fetch,
    maxResponseBytes,
    maxRetries,
    retryDelayMs,
    sleep: options.sleep ?? sleepMs,
  };

  async function* streamPath(
    path: string,
    input: {
      readonly data: Record<string, unknown>;
      readonly pluginId: string;
      readonly signal?: AbortSignal | undefined;
      readonly userId?: string | undefined;
    },
  ): AsyncGenerator<unknown> {
    const url = `${runtime.baseUrl}${path}`;
    assertJsonRecord(input.data, "dispatch data");
    const redactions = dispatchCredentialRedactions(input.data);
    const init: RequestInit = {
      body: JSON.stringify({
        ...(input.userId ? { user_id: input.userId } : {}),
        data: input.data,
      }),
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        "x-api-key": runtime.apiKey,
        "x-plugin-id": input.pluginId.trim(),
      },
      method: "POST",
      ...(input.signal ? { signal: input.signal } : {}),
    };

    const response = await fetchWithRetries(runtime, url, init);

    if (!response.ok) {
      throw pluginDaemonRequestError(response.status);
    }

    for await (const event of readSseEvents(response, runtime.maxResponseBytes)) {
      yield unwrapEnvelope(event.data, redactions);
    }
  }

  function dispatchDatasource(input: PluginDaemonDatasourceInput): AsyncGenerator<unknown> {
    validateDispatchInput(input);

    // Datasource dispatch has NO `/invoke` suffix (dify contract).
    return withDispatchDeadline(runtime, input.signal, (signal) =>
      streamPath(
        `/plugin/${encodeURIComponent(input.tenantId.trim())}/dispatch/datasource/${input.method}`,
        {
          data: input.data,
          pluginId: input.pluginId,
          signal,
          ...(input.userId ? { userId: input.userId } : {}),
        },
      ),
    );
  }

  return {
    dispatchDatasourceStream: (input) => dispatchDatasource(input),
  };
}

function assertJsonRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new PluginDaemonError(`Plugin daemon ${name} must be a JSON object`, {
      code: "plugin_daemon_input",
    });
  }

  assertJsonValue(value, name);
}

function assertJsonValue(value: unknown, name: string): void {
  let nodes = 0;
  const ancestors = new Set<object>();

  const visit = (current: unknown, depth: number): void => {
    nodes += 1;

    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new PluginDaemonError(`Plugin daemon ${name} exceeds JSON complexity limits`, {
        code: "plugin_daemon_input",
      });
    }

    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return;
    }

    if (typeof current === "number") {
      if (Number.isFinite(current)) {
        return;
      }

      throw new PluginDaemonError(`Plugin daemon ${name} contains a non-finite number`, {
        code: "plugin_daemon_input",
      });
    }

    if (typeof current !== "object" || (!Array.isArray(current) && !isPlainRecord(current))) {
      throw new PluginDaemonError(`Plugin daemon ${name} must contain only JSON values`, {
        code: "plugin_daemon_input",
      });
    }

    if (ancestors.has(current)) {
      throw new PluginDaemonError(`Plugin daemon ${name} must not contain circular references`, {
        code: "plugin_daemon_input",
      });
    }

    ancestors.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item, depth + 1);
      }
    } else {
      for (const item of Object.values(current)) {
        visit(item, depth + 1);
      }
    }

    ancestors.delete(current);
  };

  visit(value, 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function collectCredentialRedactions(credentials: Readonly<Record<string, unknown>>): string[] {
  const values = new Set<string>();
  const visited = new WeakSet<object>();
  let nodes = 0;

  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      return;
    }
    if (typeof value === "string" && value.length > 0) {
      values.add(value);
      const encoded = encodeURIComponent(value);
      if (encoded !== value) {
        values.add(encoded);
      }
      return;
    }

    if (Array.isArray(value)) {
      if (visited.has(value)) return;
      visited.add(value);
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }

    if (isPlainRecord(value)) {
      if (visited.has(value)) return;
      visited.add(value);
      for (const item of Object.values(value)) {
        visit(item, depth + 1);
      }
    }
  };

  visit(credentials, 0);
  return [...values].sort((left, right) => right.length - left.length);
}

function dispatchCredentialRedactions(data: Readonly<Record<string, unknown>>): string[] {
  return isPlainRecord(data.credentials) ? collectCredentialRedactions(data.credentials) : [];
}

function redactSensitiveText(value: string, redactions: readonly string[]): string {
  let redacted = value;

  for (const secret of redactions) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  return redacted;
}

const DISPATCH_TIMEOUT = Symbol("plugin-daemon-dispatch-timeout");
const DISPATCH_ABORTED = Symbol("plugin-daemon-dispatch-aborted");

type DispatchDeadlineReason = typeof DISPATCH_ABORTED | typeof DISPATCH_TIMEOUT;

/**
 * Applies one hard deadline to the full async-generator lifetime. Every pending `next()` races the
 * same deadline, so a fetch implementation or response reader that ignores AbortSignal cannot keep
 * datasource callers pending forever. Iterator cleanup is deliberately fire-and-forget:
 * awaiting a non-cooperative iterator's `return()` would reintroduce the hang this fence prevents.
 */
async function* withDispatchDeadline(
  runtime: PluginDaemonRuntime,
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => AsyncGenerator<unknown>,
): AsyncGenerator<unknown> {
  if (externalSignal?.aborted) {
    throw dispatchDeadlineError(DISPATCH_ABORTED);
  }

  const controller = new AbortController();
  let deadlineReason: DispatchDeadlineReason | undefined;
  let resolveDeadline: ((reason: DispatchDeadlineReason) => void) | undefined;
  const deadline = new Promise<DispatchDeadlineReason>((resolve) => {
    resolveDeadline = resolve;
  });
  const settleDeadline = (reason: DispatchDeadlineReason): void => {
    if (deadlineReason !== undefined) return;
    deadlineReason = reason;
    resolveDeadline?.(reason);
    controller.abort();
  };
  const onExternalAbort = (): void => settleDeadline(DISPATCH_ABORTED);
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  // Close the check/add race if the caller aborted between the initial guard and listener setup.
  if (externalSignal?.aborted) {
    onExternalAbort();
  }
  const timeout = setTimeout(
    () => settleDeadline(DISPATCH_TIMEOUT),
    runtime.dispatchRequestTimeoutMs,
  );
  const iterator = operation(controller.signal)[Symbol.asyncIterator]();

  try {
    while (true) {
      const outcome:
        | { readonly result: IteratorResult<unknown>; readonly type: "next" }
        | { readonly reason: DispatchDeadlineReason; readonly type: "deadline" } =
        await Promise.race([
          // Register the deadline first. settleDeadline resolves it before aborting the transport,
          // so an abort-aware fetch cannot win the race with an implementation-specific error.
          deadline.then((reason) => ({ reason, type: "deadline" }) as const),
          iterator.next().then((result) => ({ result, type: "next" }) as const),
        ]);

      if (outcome.type === "deadline") {
        throw dispatchDeadlineError(outcome.reason);
      }
      if (outcome.result.done) {
        return;
      }
      yield outcome.result.value;
    }
  } catch (cause) {
    if (deadlineReason !== undefined) {
      throw dispatchDeadlineError(deadlineReason);
    }
    if (cause instanceof PluginDaemonError) {
      throw cause;
    }
    throw new PluginDaemonError("Plugin daemon request failed", {
      code: "plugin_daemon_request_failed",
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    if (!controller.signal.aborted) {
      controller.abort();
    }
    const cleanup = iterator.return?.(undefined);
    if (cleanup) {
      void cleanup.catch(() => undefined);
    }
  }
}

function dispatchDeadlineError(reason: DispatchDeadlineReason): PluginDaemonError {
  return reason === DISPATCH_TIMEOUT
    ? new PluginDaemonError("Plugin daemon request timed out", {
        code: "plugin_daemon_timeout",
      })
    : new PluginDaemonError("Plugin daemon request was aborted", {
        code: "plugin_daemon_aborted",
      });
}

function validateRequestTimeout(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_REQUEST_TIMEOUT_MS) {
    throw new PluginDaemonError(
      `Plugin daemon ${name} must be between 1 and ${MAX_REQUEST_TIMEOUT_MS}`,
      { code: "plugin_daemon_input" },
    );
  }
}

function validateDispatchInput(input: {
  readonly pluginId: string;
  readonly tenantId: string;
}): void {
  if (!input.tenantId.trim()) {
    throw new PluginDaemonError("Plugin daemon dispatch requires a tenantId", {
      code: "plugin_daemon_input",
    });
  }

  if (!input.pluginId.trim()) {
    throw new PluginDaemonError("Plugin daemon dispatch requires a pluginId", {
      code: "plugin_daemon_input",
    });
  }
}

function unwrapEnvelope(raw: string, redactions: readonly string[] = []): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new PluginDaemonError("Plugin daemon returned invalid JSON", {
      cause,
      code: "plugin_daemon_response_invalid",
    });
  }

  const envelope = PluginDaemonEnvelopeSchema.safeParse(parsed);

  if (!envelope.success) {
    throw new PluginDaemonError("Plugin daemon returned an invalid envelope", {
      cause: envelope.error,
      code: "plugin_daemon_response_invalid",
    });
  }

  if (envelope.data.code !== 0) {
    const unwrapped = unwrapDaemonError(envelope.data.message ?? "");
    const safeMessage = redactSensitiveText(unwrapped.message, redactions);
    const safeErrorType = unwrapped.errorType
      ? redactSensitiveText(unwrapped.errorType, redactions)
      : undefined;

    throw new PluginDaemonError(safeMessage || `Plugin daemon error code ${envelope.data.code}`, {
      code: "plugin_daemon_invoke",
      daemonCode: envelope.data.code,
      ...(safeErrorType ? { errorType: safeErrorType } : {}),
    });
  }

  // Mirrors dify base.py: a success envelope with empty `data` is an error.
  if (envelope.data.data === undefined || envelope.data.data === null) {
    throw new PluginDaemonError("Plugin daemon returned an empty data payload", {
      code: "plugin_daemon_response_invalid",
    });
  }

  return envelope.data.data;
}

function unwrapDaemonError(message: string): { errorType?: string; message: string } {
  const parsed = tryParseJson(message);

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const errorType = record.error_type;
    const innerMessage = record.message;

    if (typeof errorType === "string") {
      // plugin-daemon nests the real error inside PluginInvokeError.
      if (errorType === "PluginInvokeError" && typeof innerMessage === "string") {
        return unwrapDaemonError(innerMessage);
      }

      return {
        errorType,
        message: typeof innerMessage === "string" ? innerMessage : message,
      };
    }
  }

  return { message };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pluginDaemonRequestError(status: number): PluginDaemonError {
  const message = `Plugin daemon request failed with status ${status}`;

  if (status === 429) {
    return new PluginDaemonError(message, { code: "plugin_daemon_rate_limited", status });
  }

  return new PluginDaemonError(message, { code: "plugin_daemon_request_failed", status });
}

async function fetchWithRetries(
  runtime: PluginDaemonRuntime,
  input: string,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await runtime.fetchImpl(input, init);

    if (!isRetryableStatus(response.status) || attempt >= runtime.maxRetries) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    await runtime.sleep(runtime.retryDelayMs);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function sleepMs(ms: number): Promise<void> {
  if (ms === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface SseEvent {
  readonly data: string;
}

async function* readSseEvents(response: Response, maxBytes: number): AsyncGenerator<SseEvent> {
  if (!response.body) {
    for (const event of parseSseEvents(await readBoundedText(response, maxBytes))) {
      yield event;
    }

    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        completed = true;
        break;
      }

      bytes += value.byteLength;

      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        completed = true;
        throw responseTooLarge(maxBytes);
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const event = parseSseLine(rawLine);
        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const event = parseSseLine(buffer);
      if (event) {
        yield event;
      }
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }

    reader.releaseLock();
  }
}

function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];

  for (const line of text.split(/\r?\n/u)) {
    const event = parseSseLine(line);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Mirrors dify base.py `_stream_request` line handling exactly: every non-empty line is one
 * event, with an optional `data:` prefix stripped. The daemon emits one complete JSON envelope
 * per line; there is no multi-line `data:` accumulation in the reference client.
 */
function parseSseLine(rawLine: string): SseEvent | null {
  let line = rawLine.trim();

  if (line.startsWith("data:")) {
    line = line.slice(5).trim();
  }

  if (!line) {
    return null;
  }

  return { data: line };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) {
    throw responseTooLarge(maxBytes);
  }

  const text = await response.text();

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw responseTooLarge(maxBytes);
  }

  return text;
}

function responseTooLarge(maxBytes: number): PluginDaemonError {
  return new PluginDaemonError(`Plugin daemon response exceeds maxResponseBytes=${maxBytes}`, {
    code: "plugin_daemon_response_invalid",
  });
}
