import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createNativeStructuredDataParser } from "@knowledge/parsers";
import { describe, expect, it, vi } from "vitest";
import { createIsolatedProcessExecutor } from "./isolated-process-executor";
import { createNativeParserIsolation } from "./native-parser-isolation";

function fakeChild() {
  const child = new EventEmitter() as ChildProcess;
  child.send = vi.fn(() => true) as unknown as ChildProcess["send"];
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  });
  return child;
}
const input = {
  body: new TextEncoder().encode("{}"),
  documentAssetId: "00000000-0000-4000-8000-000000000001",
  filename: "x.json",
  mimeType: "application/json",
  version: 1,
};

describe("isolated process boundary regressions", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5])(
    "rejects invalid input byte accounting %s before spawning",
    async (inputBytes) => {
      const spawn = vi.fn(() => fakeChild());
      const executor = createIsolatedProcessExecutor({ spawn, timeoutMs: 5 });
      await expect(executor.execute({}, inputBytes)).rejects.toMatchObject({
        code: "provider_input",
      });
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it.each([
    [1, null],
    [null, "SIGKILL"],
  ])("rejects a response followed by abnormal exit %s/%s", async (code, signal) => {
    const child = fakeChild();
    const executor = createIsolatedProcessExecutor({ spawn: () => child });
    const result = expect(executor.execute({}, 1)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
    child.emit("message", { result: "not publishable" });
    child.emit("close", code, signal);
    await result;
  });
  it("classifies a clean exit without a result as a worker protocol failure", async () => {
    const child = fakeChild();
    const executor = createIsolatedProcessExecutor({ spawn: () => child });
    const result = expect(executor.execute({}, 1)).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
    child.emit("close", 0, null);
    await result;
  });
  it.each([null, {}, { ok: true, artifact: {} }, { ok: false, message: null }])(
    "classifies malformed worker output %#",
    async (response) => {
      const child = fakeChild();
      const parser = createNativeParserIsolation({ spawn: () => child }).wrap(
        createNativeStructuredDataParser(),
        {},
      );
      const result = expect(parser.parse(input)).rejects.toMatchObject({
        code: "provider_response_invalid",
        retryable: false,
      });
      await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
      child.emit("message", response);
      child.emit("close", 0, null);
      await result;
    },
  );
  it.each(["provider_input", "provider_response_invalid"])(
    "preserves the worker's typed %s failure",
    async (errorCode) => {
      const child = fakeChild();
      const parser = createNativeParserIsolation({ spawn: () => child }).wrap(
        createNativeStructuredDataParser(),
        {},
      );
      const result = expect(parser.parse(input)).rejects.toMatchObject({ code: errorCode });
      await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
      child.emit("message", { ok: false, message: "failure", errorCode });
      child.emit("close", 0, null);
      await result;
    },
  );
  it("rejects non-serializable callback options before accepting work", () => {
    const runtimeOptions = { maxInputBytes: 15, now: () => "2026-01-01T00:00:00Z" };
    expect(() =>
      createNativeParserIsolation().wrap(createNativeStructuredDataParser(), runtimeOptions),
    ).toThrow("serializable");
  });
  it.each([null, false, 0])("preserves a falsy abort reason %s", async (reason) => {
    const child = fakeChild();
    const executor = createIsolatedProcessExecutor({ spawn: () => child });
    const controller = new AbortController();
    const result = expect(executor.execute({}, 1, controller.signal)).rejects.toBe(reason);
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
    controller.abort(reason);
    await result;
  });
});
