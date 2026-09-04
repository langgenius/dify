import { describe, expect, it } from "vitest";
import { answerTraceSourceForCaller } from "./answer-trace-source";

describe("answerTraceSourceForCaller", () => {
  it("prefers the precise Capability v2 caller kind over the collapsed gateway kind", () => {
    // The gateway maps workflow grants to the "agent" access channel; history must keep them apart.
    expect(
      answerTraceSourceForCaller({ callerKind: "agent", capabilityCallerKind: "workflow" }),
    ).toBe("workflow");
    expect(answerTraceSourceForCaller({ capabilityCallerKind: "agent" })).toBe("agent");
    expect(answerTraceSourceForCaller({ capabilityCallerKind: "mcp" })).toBe("mcp");
    expect(answerTraceSourceForCaller({ capabilityCallerKind: "service" })).toBe("service_api");
    expect(answerTraceSourceForCaller({ capabilityCallerKind: "internal_worker" })).toBe(
      "service_api",
    );
    expect(answerTraceSourceForCaller({ capabilityCallerKind: "interactive" })).toBe(
      "retrieval_test",
    );
  });

  it("falls back to the gateway caller kind for legacy sessions and API keys", () => {
    expect(answerTraceSourceForCaller({ callerKind: "api_key" })).toBe("service_api");
    expect(answerTraceSourceForCaller({ callerKind: "service_api" })).toBe("service_api");
    expect(answerTraceSourceForCaller({ callerKind: "agent" })).toBe("agent");
    expect(answerTraceSourceForCaller({ callerKind: "mcp" })).toBe("mcp");
    expect(answerTraceSourceForCaller({ callerKind: "interactive" })).toBe("retrieval_test");
    expect(answerTraceSourceForCaller({})).toBe("retrieval_test");
  });
});
