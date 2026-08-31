export interface BufferedUploadAdmission {
  run<T>(
    work: () => Promise<T>,
    options: {
      readonly reservedBytes: number;
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<T>;
}

export interface BufferedUploadAdmissionOptions {
  readonly label: string;
  readonly maxConcurrency: number;
  readonly maxReservedBytes: number;
}

interface AdmissionWaiter<T> {
  readonly reject: (reason?: unknown) => void;
  readonly reservedBytes: number;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly signal?: AbortSignal | undefined;
  readonly work: () => Promise<T>;
  onAbort?: (() => void) | undefined;
}

/** Process-local, cancellation-aware FIFO admission for request paths that retain upload bytes. */
export function createBufferedUploadAdmission({
  label,
  maxConcurrency,
  maxReservedBytes,
}: BufferedUploadAdmissionOptions): BufferedUploadAdmission {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 8) {
    throw new Error(`${label} maxConcurrency must be a safe integer between 1 and 8`);
  }
  if (!Number.isSafeInteger(maxReservedBytes) || maxReservedBytes < 1) {
    throw new Error(`${label} maxReservedBytes must be a positive safe integer`);
  }

  let activeRequests = 0;
  let reservedBytes = 0;
  const waiters: AdmissionWaiter<unknown>[] = [];

  const removeAbortListener = (waiter: AdmissionWaiter<unknown>): void => {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  };

  const drain = (): void => {
    while (activeRequests < maxConcurrency) {
      const waiter = waiters[0];
      if (!waiter || reservedBytes > maxReservedBytes - waiter.reservedBytes) return;
      waiters.shift();
      removeAbortListener(waiter);
      activeRequests += 1;
      reservedBytes += waiter.reservedBytes;

      void (async () => {
        try {
          waiter.signal?.throwIfAborted();
          waiter.resolve(await waiter.work());
        } catch (error) {
          waiter.reject(error);
        } finally {
          activeRequests -= 1;
          reservedBytes -= waiter.reservedBytes;
          drain();
        }
      })();
    }
  };

  return {
    run: <T>(
      work: () => Promise<T>,
      {
        reservedBytes: requestedBytes,
        signal,
      }: { readonly reservedBytes: number; readonly signal?: AbortSignal | undefined },
    ): Promise<T> => {
      if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 1) {
        return Promise.reject(new Error(`${label} reservedBytes must be a positive safe integer`));
      }
      if (requestedBytes > maxReservedBytes) {
        return Promise.reject(
          new Error(
            `${label} reservedBytes=${requestedBytes} exceeds maxReservedBytes=${maxReservedBytes}`,
          ),
        );
      }
      try {
        signal?.throwIfAborted();
      } catch (error) {
        return Promise.reject(error);
      }

      return new Promise<T>((resolve, reject) => {
        const waiter: AdmissionWaiter<T> = {
          reject,
          reservedBytes: requestedBytes,
          resolve,
          ...(signal ? { signal } : {}),
          work,
        };
        if (signal) {
          waiter.onAbort = () => {
            const index = waiters.indexOf(waiter as AdmissionWaiter<unknown>);
            if (index < 0) return;
            waiters.splice(index, 1);
            removeAbortListener(waiter as AdmissionWaiter<unknown>);
            reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
            drain();
          };
          signal.addEventListener("abort", waiter.onAbort, { once: true });
        }
        waiters.push(waiter as AdmissionWaiter<unknown>);
        if (signal?.aborted) waiter.onAbort?.();
        drain();
      });
    },
  };
}
