import type { ChildProcess } from "node:child_process";
import { ProviderError, ProviderInputError, ProviderResponseError } from "@knowledge/parsers";
import { readProcessRssBytes, superviseProcessMemory } from "./isolated-process-memory";

export interface IsolatedProcessOptions {
  readonly maxConcurrency?: number;
  readonly maxQueued?: number;
  readonly maxInputBytes?: number;
  readonly maxReservedBytes?: number;
  readonly timeoutMs?: number;
  readonly maxRssBytes?: number;
  readonly readRssBytes?: (pid: number) => Promise<number | undefined>;
  readonly spawn: () => ChildProcess;
}

/** Shared bounded process lifecycle; resolve/release only after the worker actually exits. */
export function createIsolatedProcessExecutor<TRequest, TResponse>({
  maxConcurrency = 2,
  maxQueued = 32,
  maxInputBytes = 50 * 1024 * 1024,
  maxReservedBytes = 128 * 1024 * 1024,
  timeoutMs = 600_000,
  maxRssBytes,
  readRssBytes = readProcessRssBytes,
  spawn,
}: IsolatedProcessOptions) {
  for (const value of [maxConcurrency, maxQueued, maxInputBytes, maxReservedBytes, timeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Invalid native parser isolation budget");
  }
  if (maxRssBytes !== undefined && (!Number.isSafeInteger(maxRssBytes) || maxRssBytes < 1))
    throw new Error("Invalid worker RSS budget");
  let active = 0;
  let reservedBytes = 0;
  const queue: Array<() => void> = [];
  const acquire = (signal: AbortSignal): Promise<() => void> =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const enter = () => {
        signal.removeEventListener("abort", cancel);
        active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          active--;
          queue.shift()?.();
        });
      };
      const cancel = () => {
        const index = queue.indexOf(enter);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason);
      };
      if (active < maxConcurrency) enter();
      else if (queue.length >= maxQueued)
        reject(
          new ProviderError("Native parser admission queue is full", {
            code: "provider_rate_limited",
            retryable: true,
          }),
        );
      else {
        queue.push(enter);
        signal.addEventListener("abort", cancel, { once: true });
      }
    });

  return {
    async execute(request: TRequest, inputBytes: number, signal?: AbortSignal): Promise<TResponse> {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(inputBytes) || inputBytes < 0)
        throw new ProviderInputError(
          "Isolated process input byte count must be a non-negative safe integer",
        );
      if (inputBytes > maxInputBytes)
        throw new ProviderInputError(`Native parser input exceeds maxInputBytes=${maxInputBytes}`);
      if (reservedBytes + inputBytes > maxReservedBytes)
        throw new ProviderError("Native parser reserved-input byte budget is full", {
          code: "provider_rate_limited",
          retryable: true,
        });
      reservedBytes += inputBytes;
      const controller = new AbortController();
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(
        () =>
          controller.abort(
            new ProviderError("Native parser wall-clock budget exceeded", {
              code: "provider_timeout",
              retryable: false,
              requestOutcomeAmbiguous: false,
            }),
          ),
        timeoutMs,
      );
      let release: (() => void) | undefined;
      try {
        release = await acquire(controller.signal);
        controller.signal.throwIfAborted();
        return await runChild<TRequest, TResponse>(
          spawn,
          request,
          controller.signal,
          maxRssBytes,
          readRssBytes,
        );
      } finally {
        release?.();
        reservedBytes -= inputBytes;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}

function runChild<TRequest, TResponse>(
  spawn: () => ChildProcess,
  request: TRequest,
  signal: AbortSignal,
  maxRssBytes: number | undefined,
  readRssBytes: (pid: number) => Promise<number | undefined>,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn();
    let response: TResponse | undefined;
    let failure: unknown;
    let failed = false;
    const stopMemory =
      child.pid !== undefined && maxRssBytes !== undefined
        ? superviseProcessMemory({
            pid: child.pid,
            maxRssBytes,
            readRssBytes,
            stop: (reason) => {
              if (failed || signal.aborted) return;
              failed = true;
              failure = reason;
              child.kill("SIGKILL");
            },
          })
        : () => {};
    const cancel = () => {
      failed = true;
      failure = signal.reason;
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", cancel, { once: true });
    child.once("error", (error) => {
      failed = true;
      failure = error;
      child.kill("SIGKILL");
    });
    child.once("message", (message: TResponse) => {
      response = message;
    });
    child.once("close", (code: number | null, exitSignal: NodeJS.Signals | null) => {
      stopMemory();
      signal.removeEventListener("abort", cancel);
      if (failed) reject(failure);
      else if (response === undefined || code !== 0 || exitSignal !== null)
        reject(
          new ProviderResponseError("Isolated worker exited without a valid completed response"),
        );
      else resolve(response);
    });
    if (signal.aborted) cancel();
    else {
      try {
        child.send(request as Parameters<ChildProcess["send"]>[0], (error) => {
          if (error) {
            failed = true;
            failure = error;
            child.kill("SIGKILL");
          }
        });
      } catch (error) {
        failed = true;
        failure = error;
        child.kill("SIGKILL");
      }
    }
  });
}
