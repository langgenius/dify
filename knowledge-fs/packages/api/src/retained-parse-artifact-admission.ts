import type { ParseArtifact } from "@knowledge/core";

export const DEFAULT_RETAINED_PARSE_ARTIFACT_MAX_CONCURRENCY = 4;
export const DEFAULT_RETAINED_PARSE_ARTIFACT_MAX_BYTES = 128 * 1024 * 1024;

export interface RetainedParseArtifactAdmissionOptions {
  readonly maxConcurrentArtifacts: number;
  readonly maxRetainedBytes: number;
}

export interface RetainedParseArtifactLease {
  readonly estimatedBytes: number;
  release(): void;
}

export interface RetainedParseArtifactAdmission {
  acquire(
    artifact: ParseArtifact,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<RetainedParseArtifactLease>;
}

interface RetainedArtifactWaiter {
  readonly estimatedBytes: number;
  readonly onAbort?: (() => void) | undefined;
  readonly resolve: (lease: RetainedParseArtifactLease) => void;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Process-local FIFO admission for canonical parse artifacts retained by compilation stages.
 * Count protects small-artifact fan-out; estimated bytes protect a few large artifacts from
 * multiplying heap use. An artifact charged at the whole byte budget is admitted only when it can
 * run alone, so lowering the budget never deadlocks an already accepted document.
 */
export function createRetainedParseArtifactAdmission({
  maxConcurrentArtifacts,
  maxRetainedBytes,
}: RetainedParseArtifactAdmissionOptions): RetainedParseArtifactAdmission {
  assertPositiveSafeInteger(maxConcurrentArtifacts, "maxConcurrentArtifacts");
  assertPositiveSafeInteger(maxRetainedBytes, "maxRetainedBytes");

  let activeArtifacts = 0;
  let activeBytes = 0;
  const waiters: RetainedArtifactWaiter[] = [];

  const canAdmit = (estimatedBytes: number): boolean => {
    if (activeArtifacts >= maxConcurrentArtifacts) return false;
    if (estimatedBytes >= maxRetainedBytes) return activeArtifacts === 0;
    return activeBytes + estimatedBytes <= maxRetainedBytes;
  };

  const release = (estimatedBytes: number): void => {
    activeArtifacts -= 1;
    activeBytes -= estimatedBytes;
    drain();
  };

  const createLease = (estimatedBytes: number): RetainedParseArtifactLease => {
    let released = false;
    return {
      estimatedBytes,
      release: () => {
        if (released) return;
        released = true;
        release(estimatedBytes);
      },
    };
  };

  const admit = (waiter: RetainedArtifactWaiter): void => {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    activeArtifacts += 1;
    activeBytes += waiter.estimatedBytes;
    waiter.resolve(createLease(waiter.estimatedBytes));
  };

  function drain(): void {
    while (waiters.length > 0) {
      const waiter = waiters[0];
      if (!waiter || !canAdmit(waiter.estimatedBytes)) return;
      waiters.shift();
      admit(waiter);
    }
  }

  return {
    acquire: async (artifact, { signal } = {}) => {
      signal?.throwIfAborted();
      const estimatedBytes = estimateParseArtifactRetainedBytes(artifact, {
        capBytes: maxRetainedBytes,
      });
      const lease = await new Promise<RetainedParseArtifactLease>((resolve, reject) => {
        let waiter: RetainedArtifactWaiter;
        const onAbort = () => {
          const index = waiters.indexOf(waiter);
          if (index < 0) return;
          waiters.splice(index, 1);
          signal?.removeEventListener("abort", onAbort);
          reject(signal?.reason ?? new DOMException("This operation was aborted", "AbortError"));
          drain();
        };
        waiter = {
          estimatedBytes,
          resolve,
          ...(signal ? { onAbort, signal } : {}),
        };

        if (waiters.length === 0 && canAdmit(estimatedBytes)) {
          admit(waiter);
          return;
        }
        waiters.push(waiter);
        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        }
      });

      if (signal?.aborted) {
        lease.release();
        signal.throwIfAborted();
      }
      return lease;
    },
  };
}

export interface EstimateParseArtifactRetainedBytesOptions {
  /** Stops traversal once this conservative charge is reached. */
  readonly capBytes?: number | undefined;
}

/**
 * Conservatively estimates V8 heap retained by a ParseArtifact without JSON serialization or
 * string copies. Metadata is walked in place. Excessive nesting is charged at the cap rather than
 * risking an unbounded traversal stack.
 */
export function estimateParseArtifactRetainedBytes(
  artifact: ParseArtifact,
  { capBytes = Number.MAX_SAFE_INTEGER }: EstimateParseArtifactRetainedBytesOptions = {},
): number {
  assertPositiveSafeInteger(capBytes, "capBytes");
  let bytes = 0;

  const add = (amount: number): boolean => {
    bytes = Math.min(capBytes, bytes + amount);
    return bytes >= capBytes;
  };

  const visit = (value: unknown, depth: number): boolean => {
    if (bytes >= capBytes) return true;
    if (value === null || value === undefined) return add(8);
    if (typeof value === "string") return add(24 + value.length * 2);
    if (typeof value === "number" || typeof value === "bigint") return add(16);
    if (typeof value === "boolean") return add(8);
    if (typeof value !== "object") return add(32);
    if (depth >= 64) return add(capBytes);

    if (value instanceof Uint8Array) return add(64 + value.byteLength);
    if (value instanceof ArrayBuffer) return add(64 + value.byteLength);
    if (Array.isArray(value)) {
      if (add(32 + value.length * 8)) return true;
      for (const item of value) {
        if (visit(item, depth + 1)) return true;
      }
      return false;
    }

    if (add(64)) return true;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (add(24 + key.length * 2)) return true;
      if (visit((value as Record<string, unknown>)[key], depth + 1)) return true;
    }
    return false;
  };

  visit(artifact, 0);
  return Math.max(1, bytes);
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
