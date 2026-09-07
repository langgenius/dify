import { open } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseProcStatusRss,
  readProcessRssBytes,
  superviseProcessMemory,
} from "./isolated-process-memory";

vi.mock("node:fs/promises", () => ({ open: vi.fn() }));
const originalPlatform = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("bounded Linux RSS reader", () => {
  it("parses KiB and handles zombie status without invented values", () => {
    expect(parseProcStatusRss("Name: node\nVmRSS:\t1200 kB\n")).toBe(1200 * 1024);
    expect(parseProcStatusRss("Name: node\nState: Z\n")).toBeUndefined();
    expect(() => parseProcStatusRss("VmRSS: 99999999999999999 kB\n")).toThrow("counter");
  });
  it("does not attempt procfs on non-Linux adapters", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(await readProcessRssBytes(1)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
  it("uses a bounded read and closes the descriptor", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const close = vi.fn();
    const read = vi.fn(async (buffer: Buffer) => ({ bytesRead: buffer.write("VmRSS: 10 kB\n") }));
    vi.mocked(open).mockResolvedValue({ read, close } as never);
    expect(await readProcessRssBytes(123)).toBe(10240);
    expect(open).toHaveBeenCalledWith("/proc/123/status", "r");
    expect(read.mock.calls[0]?.[0].length).toBe(16 * 1024);
    expect(close).toHaveBeenCalledOnce();
  });
  it("handles exit races and rejects unavailable or oversized metadata", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    await expect(readProcessRssBytes(-1)).rejects.toThrow("PID");
    vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" }));
    expect(await readProcessRssBytes(123)).toBeUndefined();
    vi.mocked(open).mockRejectedValueOnce(new Error("permission"));
    await expect(readProcessRssBytes(123)).rejects.toThrow("permission");
    const close = vi.fn();
    vi.mocked(open).mockResolvedValueOnce({
      read: vi.fn(async () => ({ bytesRead: 16 * 1024 })),
      close,
    } as never);
    await expect(readProcessRssBytes(123)).rejects.toThrow("metadata budget");
    expect(close).toHaveBeenCalledOnce();
  });
  it("never overlaps probes and ignores a late sample after disposal", async () => {
    vi.useFakeTimers();
    let resolve: (bytes: number) => void = () => {};
    const readRssBytes = vi.fn(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const stop = vi.fn();
    const dispose = superviseProcessMemory({ pid: 1, maxRssBytes: 1, readRssBytes, stop });
    await vi.advanceTimersByTimeAsync(200);
    expect(readRssBytes).toHaveBeenCalledOnce();
    dispose();
    resolve(2000);
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
  });
  it("fails closed on a live probe error and accepts values below the budget", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const readRssBytes = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(10)
      .mockRejectedValueOnce(new Error());
    const dispose = superviseProcessMemory({ pid: 1, maxRssBytes: 100, readRssBytes, stop });
    await vi.advanceTimersByTimeAsync(100);
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({ code: "provider_request_failed" }));
    dispose();
  });
});
