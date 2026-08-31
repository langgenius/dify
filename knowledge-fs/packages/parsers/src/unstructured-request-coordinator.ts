export interface UnstructuredRequestIdentity {
  readonly documentAssetId: string;
  readonly parserFingerprint: string;
  readonly version: number;
}

export interface CoordinateUnstructuredRequestInput<T> {
  /**
   * The caller signal controls its admission interest and result. It must never be attached to the
   * provider transport after `markTransportStarted` has been called.
   */
  readonly callerSignal?: AbortSignal | undefined;
  readonly identity: UnstructuredRequestIdentity;
  /**
   * Acquires admission and starts the transport-owned operation. The admission signal may cancel
   * a queued gate waiter while no callers remain. Once admitted, call `markTransportStarted`
   * immediately before starting provider work; after that only the transport deadline may cancel.
   */
  readonly request: (admission: UnstructuredRequestAdmission) => Promise<T>;
}

export interface UnstructuredRequestAdmission {
  readonly signal: AbortSignal;
  markTransportStarted(): void;
}

export interface UnstructuredRequestCoordinator {
  run<T>(input: CoordinateUnstructuredRequestInput<T>): Promise<T>;
}

/**
 * Coalesces identical Unstructured requests in one API process.
 *
 * If every caller cancels while a request is still waiting for admission, its gate waiter is
 * canceled and provider work never starts. Once the shared transport starts, caller cancellation
 * is observed only after it settles. This prevents a durable retry from overlapping provider work
 * that survived the original caller disconnect.
 *
 * This coordinator is process-local. Cross-process exclusion still relies on the durable worker
 * lease, and a provider that continues work after closing its HTTP transport needs a provider-side
 * cancellation or idempotency contract before it can be guaranteed not to overlap remotely.
 */
export function createUnstructuredRequestCoordinator(): UnstructuredRequestCoordinator {
  interface ActiveRequest {
    readonly admissionController: AbortController;
    callerCount: number;
    readonly shared: Promise<unknown>;
    settled: boolean;
    readonly transportState: { started: boolean };
  }

  const active = new Map<string, ActiveRequest>();

  return {
    run: async <T>({ callerSignal, identity, request }: CoordinateUnstructuredRequestInput<T>) => {
      callerSignal?.throwIfAborted();
      const key = unstructuredRequestIdentityKey(identity);
      let entry = active.get(key);

      // An all-callers-canceled admission cannot be revived. A later valid caller gets a fresh
      // entry; the old gate waiter is already canceled and is forbidden from starting transport.
      if (entry?.admissionController.signal.aborted && !entry.transportState.started) {
        entry = undefined;
      }

      if (!entry) {
        const admissionController = new AbortController();
        const transportState = { started: false };
        const shared = Promise.resolve().then(
          async () =>
            await request({
              markTransportStarted: () => {
                admissionController.signal.throwIfAborted();
                transportState.started = true;
              },
              signal: admissionController.signal,
            }),
        );
        const createdEntry: ActiveRequest = {
          admissionController,
          callerCount: 0,
          settled: false,
          shared,
          transportState,
        };
        entry = createdEntry;
        active.set(key, entry);
        void shared
          .finally(() => {
            createdEntry.settled = true;
            if (active.get(key) === createdEntry) {
              active.delete(key);
            }
          })
          .catch(() => undefined);
      }

      entry.callerCount += 1;

      let failed = false;
      let failure: unknown;
      let result: T | undefined;
      let callerAbortReason: unknown;
      let callerAborted = false;
      let callerRegistered = true;
      const unregisterCaller = () => {
        if (!callerRegistered) return;
        callerRegistered = false;
        entry.callerCount -= 1;
        if (
          entry.callerCount === 0 &&
          !entry.transportState.started &&
          !entry.settled &&
          !entry.admissionController.signal.aborted
        ) {
          entry.admissionController.abort(
            new DOMException("Unstructured request admission was canceled", "AbortError"),
          );
        }
      };
      const onCallerAbort = () => {
        callerAborted = true;
        callerAbortReason = abortSignalReason(callerSignal as AbortSignal);
        unregisterCaller();
      };
      callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
      if (callerSignal?.aborted) onCallerAbort();
      try {
        result = (await entry.shared) as T;
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        callerSignal?.removeEventListener("abort", onCallerAbort);
        unregisterCaller();
      }

      // Preserve caller cancellation semantics, but only after the shared transport has settled.
      if (callerAborted || callerSignal?.aborted) {
        throw callerAborted ? callerAbortReason : abortSignalReason(callerSignal as AbortSignal);
      }
      if (failed) {
        throw failure;
      }
      return result as T;
    },
  };
}

export function unstructuredRequestIdentityKey({
  documentAssetId,
  parserFingerprint,
  version,
}: UnstructuredRequestIdentity): string {
  if (!documentAssetId.trim()) {
    throw new Error("Unstructured request documentAssetId must not be empty");
  }
  if (!parserFingerprint.trim()) {
    throw new Error("Unstructured request parserFingerprint must not be empty");
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Unstructured request version must be a positive integer");
  }

  // JSON tuple encoding avoids delimiter collisions without leaking this value outside the process.
  return JSON.stringify([documentAssetId, version, parserFingerprint]);
}

function abortSignalReason(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }
  return new DOMException("The operation was aborted", "AbortError");
}
