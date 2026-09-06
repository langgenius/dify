import { open } from "node:fs/promises";
import { ProviderError, ProviderInputError } from "@knowledge/parsers";

export function parseProcStatusRss(status: string): number | undefined {
  const value = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];
  if (value === undefined) return undefined; // Zombie processes have no VmRSS.
  const bytes = Number(value) * 1024;
  if (!Number.isSafeInteger(bytes)) throw new Error("Invalid process RSS counter");
  return bytes;
}

export async function readProcessRssBytes(pid: number): Promise<number | undefined> {
  if (process.platform !== "linux") return undefined;
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid worker PID");
  try {
    const file = await open(`/proc/${pid}/status`, "r");
    try {
      const buffer = Buffer.alloc(16 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead === buffer.length) throw new Error("Process status exceeds metadata budget");
      return parseProcStatusRss(buffer.toString("utf8", 0, bytesRead));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/** Sampled stop for native allocations; not a hard cgroup or hostile-code sandbox. */
export function superviseProcessMemory(input: {
  readonly pid: number;
  readonly maxRssBytes: number;
  readonly readRssBytes: (pid: number) => Promise<number | undefined>;
  readonly stop: (reason: Error) => void;
}): () => void {
  let stopped = false;
  let sampling = false;
  const sample = async () => {
    if (stopped || sampling) return;
    sampling = true;
    try {
      const bytes = await input.readRssBytes(input.pid);
      if (!stopped && bytes !== undefined && bytes > input.maxRssBytes)
        input.stop(
          new ProviderInputError("Document parser worker resident-memory budget exceeded"),
        );
    } catch {
      if (!stopped)
        input.stop(
          new ProviderError("Document parser worker memory supervision unavailable", {
            code: "provider_request_failed",
            retryable: false,
          }),
        );
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(() => {
    void sample();
  }, 50);
  timer.unref();
  void sample();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
