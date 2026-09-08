import { describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeController } from "./background-runtime-controller";

describe("background lifecycle ownership", () => {
  it("registers an API operation without starting its timers or executing it", async () => {
    const operation = {
      start: vi.fn(),
      stop: vi.fn(),
      tick: vi.fn().mockResolvedValue({ claimed: 1 }),
    };
    const controller = createBackgroundRuntimeController(false);
    controller.register("source.execute", operation);
    expect(operation.start).not.toHaveBeenCalled();
    expect(operation.tick).not.toHaveBeenCalled();
    expect(await controller.execute("source.execute")).toEqual({ claimed: 1 });
    expect(operation.tick).toHaveBeenCalledOnce();
    await controller.stop();
    expect(operation.stop).toHaveBeenCalledOnce();
  });
  it("preserves explicit embedded lifecycle and rejects double registration", () => {
    const operation = { start: vi.fn(), tick: vi.fn() };
    const controller = createBackgroundRuntimeController(true);
    controller.register("document.execute", operation);
    expect(operation.start).toHaveBeenCalledOnce();
    expect(() => controller.register("document.execute", operation)).toThrow("Duplicate");
  });
  it("does not turn an optional unavailable feature into an unrelated operation", async () => {
    expect(await createBackgroundRuntimeController(false).execute("fts.backfill")).toEqual({
      unavailable: true,
    });
  });
});
