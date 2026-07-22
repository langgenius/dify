import { describe, expect, it } from "vitest";

import { traceAsync } from "./trace-async";
import { createInMemoryTraceRecorder } from "./tracing";

describe("traceAsync", () => {
  it("records an ok span with the trace id", async () => {
    const traces = createInMemoryTraceRecorder();

    await expect(traceAsync(traces, "trace-1", "step.ok", async () => "done")).resolves.toBe(
      "done",
    );

    expect(traces.spans).toEqual([
      {
        attributes: { traceId: "trace-1" },
        name: "step.ok",
        status: "ok",
      },
    ]);
  });

  it("records a bounded error class and rethrows the original error", async () => {
    const traces = createInMemoryTraceRecorder();
    const error = new TypeError("bad");

    await expect(
      traceAsync(traces, "trace-1", "step.error", async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(traces.spans).toEqual([
      {
        attributes: { errorClass: "TypeError", traceId: "trace-1" },
        name: "step.error",
        status: "error",
      },
    ]);
  });
});
