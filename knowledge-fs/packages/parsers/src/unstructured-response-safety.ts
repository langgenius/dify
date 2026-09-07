const maxErrorBodyBytes = 4 * 1024;
const inspectionTimeoutMs = 1_000;

// unstructured-inference 1.6.11 emits this exact message before allocating a PDF page bitmap.
// The pinned API preserves it in JSON `detail`, but wraps the ValueError as HTTP 500.
const rasterLimitDetailPattern =
  /^PDF page would render to too many pixels for safe processing: page=([1-9]\d*), pixels=([1-9]\d*), maximum=([1-9]\d*)\. Try splitting the PDF, reducing the page dimensions, or using a lower render DPI\.$/;

/** Consumes only recognized error-status bodies; unknown errors keep their HTTP classification. */
export async function isPdfRasterLimitResponse(
  response: Response,
  signal: AbortSignal,
): Promise<boolean> {
  return Boolean(
    await inspectUnstructuredErrorPayload(
      response,
      signal,
      [500, 422],
      (payload) => isPdfRasterLimitPayload(payload) || undefined,
    ),
  );
}

/** One bounded read shared by classifiers, so HTTP 422 bodies are never consumed twice. */
export async function inspectUnstructuredErrorPayload<T>(
  response: Response,
  signal: AbortSignal,
  statuses: readonly number[],
  classify: (payload: unknown) => T | undefined,
): Promise<T | undefined> {
  signal.throwIfAborted();
  if (!statuses.includes(response.status)) return undefined;
  if (!response.body || response.body.locked) return undefined;

  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<undefined>((resolve, reject) => {
      timer = setTimeout(() => resolve(undefined), inspectionTimeoutMs);
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const payload = await Promise.race([readErrorPayload(reader), interrupted]);
    signal.throwIfAborted();
    return classify(payload);
  } catch {
    signal.throwIfAborted();
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    // A stalled or broken provider must not prolong the inspection while acknowledging cancel.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function readErrorPayload(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  const body = new Uint8Array(maxErrorBodyBytes);
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.byteLength > maxErrorBodyBytes - length) return undefined;
    body.set(value, length);
    length += value.byteLength;
  }

  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, length)));
}

export function isPdfRasterLimitPayload(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || !("detail" in payload)) return false;
  if (typeof payload.detail !== "string") return false;
  const match = rasterLimitDetailPattern.exec(payload.detail);
  if (!match) return false;
  const page = Number(match[1]);
  const pixels = Number(match[2]);
  const maximum = Number(match[3]);
  return [page, pixels, maximum].every(Number.isSafeInteger) && pixels > maximum;
}
