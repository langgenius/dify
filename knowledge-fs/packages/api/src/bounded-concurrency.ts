export interface ConcurrencyGate {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** Fair FIFO gate that shares a fixed concurrency budget across independent callers. */
export function createConcurrencyGate(limit: number): ConcurrencyGate {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Concurrency gate limit must be at least 1");
  }

  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  };

  const release = (): void => {
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }

    active -= 1;
  };

  return {
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

/** Order-preserving async map that stops scheduling after the first observed failure. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failed) {
    throw firstError;
  }

  return results;
}
