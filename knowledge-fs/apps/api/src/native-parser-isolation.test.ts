import { type ChildProcess, fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { createNativeStructuredDataParser } from "@knowledge/parsers";
import { describe, expect, it, vi } from "vitest";
import { createNativeParserIsolation } from "./native-parser-isolation";

const input = {
  body: new TextEncoder().encode('{"value":"preserved"}'),
  documentAssetId: "00000000-0000-4000-8000-000000000001",
  filename: "example.json",
  mimeType: "application/json",
  version: 1,
};

function childFixture() {
  const child = new EventEmitter() as ChildProcess;
  child.send = vi.fn(() => true) as unknown as ChildProcess["send"];
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  });
  return child;
}

describe("native parser process isolation", () => {
  it("runs the real parser outside the API process and preserves its semantic identity", async () => {
    const native = createNativeStructuredDataParser();
    const isolated = createNativeParserIsolation().wrap(native, {});
    const expected = await native.parse(input);
    const actual = await isolated.parse(input);
    expect(actual.elements.map(({ id: _id, ...element }) => element)).toEqual(
      expected.elements.map(({ id: _id, ...element }) => element),
    );
    expect(actual.artifactHash).toEqual(expected.artifactHash);
    expect(isolated.policyFingerprint?.(input)).toBe(native.policyFingerprint?.(input));
    expect(actual.metadata.parserExecution).toMatchObject({ isolation: "child-process" });
    expect(actual.metadata.parserExecution).toHaveProperty("peakRssKiB");
  }, 15_000);

  it("terminates synchronous work on cancellation before releasing its shared slot", async () => {
    const first = childFixture();
    const second = childFixture();
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const isolation = createNativeParserIsolation({ spawn, maxConcurrency: 1 });
    const parser = isolation.wrap(createNativeStructuredDataParser(), {});
    const controller = new AbortController();
    const aborted = expect(parser.parse({ ...input, signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const queuedController = new AbortController();
    const queued = expect(
      parser.parse({ ...input, signal: queuedController.signal }),
    ).rejects.toThrow("queued");
    queuedController.abort(new Error("queued"));
    await queued;
    controller.abort(new Error("cancelled"));
    await aborted;
    expect(first.kill).toHaveBeenCalledWith("SIGKILL");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("enforces a real wall deadline on a non-responsive child", async () => {
    const child = childFixture();
    const parser = createNativeParserIsolation({ spawn: () => child, timeoutMs: 20 }).wrap(
      createNativeStructuredDataParser(),
      {},
    );
    await expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_timeout",
      requestOutcomeAmbiguous: false,
      retryable: false,
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("never spawns for cancelled or oversized input", async () => {
    const spawn = vi.fn();
    const parser = createNativeParserIsolation({ spawn, maxInputBytes: 1 }).wrap(
      createNativeStructuredDataParser(),
      {},
    );
    await expect(parser.parse(input)).rejects.toMatchObject({ code: "provider_input" });
    await expect(
      parser.parse({ ...input, signal: AbortSignal.abort(new Error("cancelled")) }),
    ).rejects.toThrow("cancelled");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("kills an actual CPU-bound process, not just its request promise", async () => {
    const controller = new AbortController();
    let pid: number | undefined;
    const parser = createNativeParserIsolation({
      timeoutMs: 5_000,
      spawn: () => {
        const child = fork(new URL("./native-parser-busy.fixture.mjs", import.meta.url), [], {
          execArgv: [],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        pid = child.pid;
        child.once("message", () => controller.abort(new Error("actual CPU cancellation")));
        return child;
      },
    }).wrap(createNativeStructuredDataParser(), {});
    await expect(parser.parse({ ...input, signal: controller.signal })).rejects.toThrow(
      "actual CPU cancellation",
    );
    expect(pid).toBeTypeOf("number");
    expect(() => process.kill(pid as number, 0)).toThrow();
  });

  it("bounds aggregate input retention before joining the queue", async () => {
    const child = childFixture();
    const spawn = vi.fn(() => child);
    const parser = createNativeParserIsolation({
      spawn,
      maxReservedBytes: input.body.byteLength,
    }).wrap(createNativeStructuredDataParser(), {});
    const controller = new AbortController();
    const first = expect(parser.parse({ ...input, signal: controller.signal })).rejects.toThrow(
      "done",
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    await expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
    });
    controller.abort(new Error("done"));
    await first;
  });

  it("bounds queue length and frees the slot on process failure", async () => {
    const child = childFixture();
    const spawn = vi.fn(() => child);
    const parser = createNativeParserIsolation({ spawn, maxConcurrency: 1, maxQueued: 1 }).wrap(
      createNativeStructuredDataParser(),
      {},
    );
    const first = expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const controller = new AbortController();
    const second = expect(parser.parse({ ...input, signal: controller.signal })).rejects.toThrow(
      "queue cancellation",
    );
    await expect(parser.parse(input)).rejects.toMatchObject({ code: "provider_rate_limited" });
    controller.abort(new Error("queue cancellation"));
    await second;
    child.emit("close", 1, null);
    await first;
  });

  it("preserves typed format errors and rejects invalid worker budgets", async () => {
    for (const maxConcurrency of [0, Number.NaN, 1.1, Number.POSITIVE_INFINITY])
      expect(() => createNativeParserIsolation({ maxConcurrency })).toThrow("Invalid");
    const child = childFixture();
    const parser = createNativeParserIsolation({ spawn: () => child }).wrap(
      createNativeStructuredDataParser(),
      {},
    );
    const result = expect(parser.parse(input)).rejects.toMatchObject({
      code: "document_parser_unsupported_type",
    });
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
    child.emit("message", {
      ok: false,
      message: "unsupported",
      errorCode: "document_parser_unsupported_type",
    });
    child.emit("close", 0, null);
    await result;
  });

  it.each(["event", "callback", "throw", "input"])(
    "cleans up %s worker failures without leaking admission",
    async (mode) => {
      const child = childFixture();
      if (mode === "callback" || mode === "throw") {
        child.send = vi.fn((_message, callback) => {
          if (mode === "throw") throw new Error("IPC failed");
          callback(new Error("IPC failed"));
          return false;
        }) as unknown as ChildProcess["send"];
      }
      const parser = createNativeParserIsolation({ spawn: () => child }).wrap(
        createNativeStructuredDataParser(),
        {},
      );
      const result = expect(parser.parse(input)).rejects.toThrow(
        mode === "input" ? "bad input" : "IPC failed",
      );
      if (mode === "event" || mode === "input") {
        await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce());
        if (mode === "event") child.emit("error", new Error("IPC failed"));
        else {
          child.emit("message", { ok: false, message: "bad input", errorCode: "provider_input" });
          child.emit("close", 0, null);
        }
      }
      await result;
    },
  );

  it("advances queued work only after the preceding process closes", async () => {
    const first = childFixture();
    const second = childFixture();
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const parser = createNativeParserIsolation({ spawn, maxConcurrency: 1 }).wrap(
      createNativeStructuredDataParser(),
      {},
    );
    const failed = expect(parser.parse(input)).rejects.toMatchObject({
      code: "provider_response_invalid",
    });
    const artifact = await createNativeStructuredDataParser().parse(input);
    const next = parser.parse(input);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    first.emit("close", 1, null);
    await failed;
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    second.emit("message", { ok: true, artifact });
    second.emit("close", 0, null);
    expect(await next).toEqual(artifact);
  });

  it("handles cancellation during spawn and rejects accidental remote adapters", async () => {
    expect(() =>
      createNativeParserIsolation().wrap({ kind: "unstructured", parse: vi.fn() }, {}),
    ).toThrow("remote");
    const controller = new AbortController();
    const child = childFixture();
    const parser = createNativeParserIsolation({
      spawn: () => {
        controller.abort(new Error("spawn cancelled"));
        return child;
      },
    }).wrap(createNativeStructuredDataParser(), {});
    await expect(parser.parse({ ...input, signal: controller.signal })).rejects.toThrow(
      "spawn cancelled",
    );
    expect(child.send).not.toHaveBeenCalled();
  });
});
