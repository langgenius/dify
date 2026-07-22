import { getTraceErrorClass } from "./http-tracing";
import type { TraceRecorder } from "./tracing";

export async function traceAsync<T>(
  traces: TraceRecorder,
  traceId: string,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const span = traces.startSpan(name, { traceId });

  try {
    const result = await fn();
    span.end("ok");
    return result;
  } catch (error) {
    span.end("error", { errorClass: getTraceErrorClass(error) });
    throw error;
  }
}
