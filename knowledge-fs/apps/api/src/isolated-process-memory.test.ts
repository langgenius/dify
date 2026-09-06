import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createIsolatedProcessExecutor } from "./isolated-process-executor";

describe("isolated parser resident memory supervision", () => {
  it("kills the worker when native allocations exceed the sampled RSS budget", async () => {
    const child = new EventEmitter() as ChildProcess;
    Object.defineProperty(child, "pid", { value: 123 });
    child.send = vi.fn(() => true) as unknown as ChildProcess["send"];
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      return true;
    });
    const executor = createIsolatedProcessExecutor({
      spawn: () => child,
      timeoutMs: 500,
      maxRssBytes: 1000,
      readRssBytes: async () => 2000,
    });
    await expect(executor.execute({}, 0)).rejects.toThrow("resident-memory");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
