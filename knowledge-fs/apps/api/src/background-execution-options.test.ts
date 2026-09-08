import { describe, expect, it } from "vitest";
import { resolveBackgroundExecutionMode } from "./background-execution-options";

describe("background execution deployment mode", () => {
  it("preserves embedded deployments until explicit cutover", () => {
    expect(resolveBackgroundExecutionMode({})).toBe("embedded");
    expect(resolveBackgroundExecutionMode({ KNOWLEDGE_BACKGROUND_EXECUTION: "celery" })).toBe(
      "celery",
    );
  });
  it("honors explicit root overrides without erasing service env settings", () => {
    expect(
      resolveBackgroundExecutionMode({
        KNOWLEDGE_BACKGROUND_EXECUTION: "celery",
        DIFY_ROOT_KNOWLEDGE_BACKGROUND_EXECUTION_OVERRIDE: "",
      }),
    ).toBe("celery");
    expect(
      resolveBackgroundExecutionMode({
        KNOWLEDGE_BACKGROUND_EXECUTION: "embedded",
        DIFY_ROOT_KNOWLEDGE_BACKGROUND_EXECUTION_OVERRIDE: "celery",
      }),
    ).toBe("celery");
  });
  it("fails closed on an unknown mode", () => {
    expect(() =>
      resolveBackgroundExecutionMode({ KNOWLEDGE_BACKGROUND_EXECUTION: "auto" }),
    ).toThrow();
  });
});
