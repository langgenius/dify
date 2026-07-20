import {
  type TraceRecorder,
  createConsoleTraceRecorder,
  createOtlpTraceRecorder,
} from "@knowledge/api";

export interface ApiTracingEnv {
  readonly KNOWLEDGE_TRACING?: string;
  readonly KNOWLEDGE_TRACING_FLUSH_MS?: string;
  readonly KNOWLEDGE_TRACING_OTLP_ENDPOINT?: string;
  readonly KNOWLEDGE_TRACING_OTLP_HEADERS?: string;
  readonly KNOWLEDGE_TRACING_SERVICE_NAME?: string;
}

export interface ApiTracingOptions {
  readonly traces: TraceRecorder;
}

/**
 * Resolves the gateway span recorder. Off by default (spans are dropped);
 * `KNOWLEDGE_TRACING=console` logs one JSON line per span, `KNOWLEDGE_TRACING=otlp` exports
 * OTLP/HTTP JSON batches to `KNOWLEDGE_TRACING_OTLP_ENDPOINT` (e.g. an OpenTelemetry collector
 * at `http://collector:4318/v1/traces`). Invalid configuration fails startup fast.
 */
export function createApiTracingOptions(
  env: ApiTracingEnv = process.env,
): ApiTracingOptions | undefined {
  const mode = env.KNOWLEDGE_TRACING?.trim().toLowerCase();

  if (!mode || mode === "0" || mode === "false" || mode === "off") {
    return undefined;
  }

  if (mode === "console") {
    return { traces: createConsoleTraceRecorder() };
  }

  if (mode === "otlp") {
    const endpoint = env.KNOWLEDGE_TRACING_OTLP_ENDPOINT?.trim();

    if (!endpoint) {
      throw new Error("KNOWLEDGE_TRACING=otlp requires KNOWLEDGE_TRACING_OTLP_ENDPOINT");
    }

    return {
      traces: createOtlpTraceRecorder({
        endpoint,
        flushIntervalMs: positiveIntegerEnv(
          env.KNOWLEDGE_TRACING_FLUSH_MS,
          5_000,
          "KNOWLEDGE_TRACING_FLUSH_MS",
          100,
        ),
        headers: headersFromEnv(env.KNOWLEDGE_TRACING_OTLP_HEADERS),
        onExportError: (error) => {
          console.warn("OTLP trace export failed", {
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        },
        serviceName: env.KNOWLEDGE_TRACING_SERVICE_NAME?.trim() || "knowledge-fs-api",
      }),
    };
  }

  throw new Error(`KNOWLEDGE_TRACING must be off, console, or otlp (got "${mode}")`);
}

function headersFromEnv(value: string | undefined): Record<string, string> {
  const raw = value?.trim();

  if (!raw) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("KNOWLEDGE_TRACING_OTLP_HEADERS must be a JSON object");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("KNOWLEDGE_TRACING_OTLP_HEADERS must be a JSON object");
  }

  const headers: Record<string, string> = {};

  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== "string") {
      throw new Error("KNOWLEDGE_TRACING_OTLP_HEADERS values must be strings");
    }

    headers[key] = headerValue;
  }

  return headers;
}

function positiveIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
): number {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer of at least ${min}`);
  }

  return parsed;
}
