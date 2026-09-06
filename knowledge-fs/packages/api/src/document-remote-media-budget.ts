import type { DocumentRemoteAssetFetcher } from "./document-multimodal-asset-extractor";

type RemoteImage = Awaited<ReturnType<DocumentRemoteAssetFetcher["fetch"]>>;

/** One document, one bounded cache and one absolute deadline, including unsuccessful URLs. */
export function createDocumentRemoteMediaBudget(input: {
  readonly fetcher?: DocumentRemoteAssetFetcher | undefined;
  readonly maxAttempts: number;
  readonly maxBytes: number;
  readonly maxTotalBytes: number;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
}) {
  for (const [name, value] of Object.entries({
    maxRemoteAssetAttempts: input.maxAttempts,
    maxRemoteAssetBytes: input.maxBytes,
    maxTotalRemoteAssetBytes: input.maxTotalBytes,
    remoteAssetTimeoutMs: input.timeoutMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be at least 1`);
  }
  const deadline = performance.now() + input.timeoutMs;
  const cache = new Map<string, RemoteImage>();
  const reasons = new Set<string>();
  let attempts = 0;
  let downloadedBytes = 0;
  let reservedBytes = 0;
  let deadlineReached = false;
  return {
    reasons,
    get attempts() {
      return attempts;
    },
    get downloadedBytes() {
      return downloadedBytes;
    },
    async fetch(url: string): Promise<RemoteImage> {
      input.signal?.throwIfAborted();
      if (cache.has(url)) return cache.get(url) ?? null;
      if (!input.fetcher) {
        reasons.add("remote-fetcher-unavailable");
        return null;
      }
      if (deadlineReached || performance.now() >= deadline) {
        reasons.add("remote-deadline");
        return null;
      }
      if (attempts >= input.maxAttempts) {
        reasons.add("remote-attempt-budget");
        return null;
      }
      if (reservedBytes >= input.maxTotalBytes) {
        reasons.add("remote-byte-budget");
        return null;
      }
      attempts += 1;
      const maxBytes = Math.min(input.maxBytes, input.maxTotalBytes - reservedBytes);
      // A failed fetch can have consumed its entire body limit without returning a body. Keep
      // that reservation charged so failures cannot bypass the aggregate network budget.
      reservedBytes += maxBytes;
      const controller = new AbortController();
      const abortFromParent = () => controller.abort(input.signal?.reason);
      input.signal?.addEventListener("abort", abortFromParent, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error("remote-deadline")),
        Math.max(1, deadline - performance.now()),
      );
      let rejectAbort: (() => void) | undefined;
      try {
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", rejectAbort, { once: true });
          if (controller.signal.aborted) rejectAbort();
        });
        const image = await Promise.race([
          input.fetcher.fetch({ maxBytes, signal: controller.signal, url }),
          aborted,
        ]);
        input.signal?.throwIfAborted();
        if (image) {
          if (image.body.byteLength > maxBytes)
            throw new RemoteMediaContractError(
              `Document multimodal remote asset exceeds maxRemoteAssetBytes=${maxBytes}`,
            );
          downloadedBytes += image.body.byteLength;
          reservedBytes -= maxBytes - image.body.byteLength;
        } else {
          reasons.add("remote-unavailable");
        }
        cache.set(url, image);
        return image;
      } catch (error) {
        input.signal?.throwIfAborted();
        if (error instanceof RemoteMediaContractError || !controller.signal.aborted) throw error;
        deadlineReached = true;
        reasons.add("remote-deadline");
        cache.set(url, null);
        return null;
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abortFromParent);
        if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      }
    },
  };
}

class RemoteMediaContractError extends Error {}
