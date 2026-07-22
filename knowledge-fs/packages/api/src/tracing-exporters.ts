import type { TraceAttributeValue, TraceAttributes, TraceRecorder } from "./tracing";

/**
 * Structured-log trace recorder: one JSON line per finished span. Zero-infrastructure
 * observability for deployments without a collector.
 */
export function createConsoleTraceRecorder({
  log = (line) => console.log(line),
  now = () => Date.now(),
}: {
  readonly log?: (line: string) => void;
  readonly now?: () => number;
} = {}): TraceRecorder {
  return {
    startSpan: (name, attributes) => {
      const startedAt = now();

      return {
        end: (status, endAttributes) => {
          log(
            JSON.stringify({
              attributes: { ...attributes, ...endAttributes },
              durationMs: Math.max(0, now() - startedAt),
              kind: "trace-span",
              name,
              status,
            }),
          );
        },
      };
    },
  };
}

export interface OtlpTraceRecorder extends TraceRecorder {
  /** Sends every buffered span now; resolves when the export attempt settles. */
  flush(): Promise<void>;
  /** Stops the periodic flush timer (buffered spans are flushed one last time). */
  stop(): Promise<void>;
}

export interface OtlpTraceRecorderOptions {
  /** Full OTLP/HTTP traces URL, e.g. `http://collector:4318/v1/traces`. */
  readonly endpoint: string;
  readonly fetchImpl?: typeof fetch;
  readonly flushIntervalMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Buffer cap; spans beyond it are dropped (counted, warned once). */
  readonly maxBufferedSpans?: number;
  readonly now?: () => number;
  readonly onExportError?: (error: unknown) => void;
  readonly serviceName: string;
}

interface BufferedSpan {
  readonly attributes: TraceAttributes;
  readonly endMs: number;
  readonly name: string;
  readonly startMs: number;
  readonly status: "error" | "ok";
}

/**
 * Minimal OTLP/HTTP (JSON) trace exporter for the gateway's `TraceRecorder` seam — spans are
 * buffered and posted in batches to a collector, with no OpenTelemetry SDK dependency. The
 * recorder interface has no context propagation, so every span exports as a root span.
 * Export is best-effort: a failed POST drops the batch and reports via `onExportError`.
 */
export function createOtlpTraceRecorder({
  endpoint,
  fetchImpl = fetch,
  flushIntervalMs = 5_000,
  headers = {},
  maxBufferedSpans = 2_048,
  now = () => Date.now(),
  onExportError = () => undefined,
  serviceName,
}: OtlpTraceRecorderOptions): OtlpTraceRecorder {
  if (!endpoint.trim()) {
    throw new Error("OTLP trace recorder endpoint is required");
  }

  if (!Number.isInteger(flushIntervalMs) || flushIntervalMs < 100) {
    throw new Error("OTLP trace recorder flushIntervalMs must be at least 100");
  }

  const buffer: BufferedSpan[] = [];
  let dropped = 0;

  async function flush(): Promise<void> {
    if (buffer.length === 0) {
      return;
    }

    const batch = buffer.splice(0, buffer.length);

    try {
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify(otlpExportPayload(batch, serviceName)),
        headers: { "content-type": "application/json", ...headers },
        method: "POST",
      });

      if (!response.ok) {
        onExportError(new Error(`OTLP export failed with status ${response.status}`));
      }
    } catch (error) {
      onExportError(error);
    }
  }

  const timer = setInterval(() => {
    void flush();
  }, flushIntervalMs);
  // Do not hold the process open for the exporter (node timers only).
  (timer as { unref?: () => void }).unref?.();

  return {
    flush,
    startSpan: (name, attributes) => {
      const startMs = now();

      return {
        end: (status, endAttributes) => {
          if (buffer.length >= maxBufferedSpans) {
            dropped += 1;

            if (dropped === 1) {
              onExportError(
                new Error(`OTLP span buffer full (${maxBufferedSpans}); dropping spans`),
              );
            }

            return;
          }

          buffer.push({
            attributes: { ...attributes, ...endAttributes },
            endMs: now(),
            name,
            startMs,
            status,
          });
        },
      };
    },
    stop: async () => {
      clearInterval(timer);
      await flush();
    },
  };
}

function otlpExportPayload(spans: readonly BufferedSpan[], serviceName: string): unknown {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: "knowledge-fs" },
            spans: spans.map((span) => ({
              attributes: otlpAttributes(span.attributes),
              endTimeUnixNano: msToUnixNano(span.endMs),
              kind: 1,
              name: span.name,
              spanId: randomHexId(8),
              startTimeUnixNano: msToUnixNano(span.startMs),
              status: { code: span.status === "ok" ? 1 : 2 },
              traceId: randomHexId(16),
            })),
          },
        ],
      },
    ],
  };
}

function otlpAttributes(
  attributes: TraceAttributes,
): Array<{ key: string; value: Record<string, unknown> }> {
  const result: Array<{ key: string; value: Record<string, unknown> }> = [];

  for (const [key, raw] of Object.entries(attributes)) {
    const value = otlpAttributeValue(raw);

    if (value) {
      result.push({ key, value });
    }
  }

  return result;
}

function otlpAttributeValue(value: TraceAttributeValue): Record<string, unknown> | null {
  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }

  return null;
}

function msToUnixNano(ms: number): string {
  // ms * 1e6 exceeds Number.MAX_SAFE_INTEGER for current epochs — use BigInt for exactness.
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}

function randomHexId(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);

  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
