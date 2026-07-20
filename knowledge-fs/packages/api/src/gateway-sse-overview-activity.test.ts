import { describe, expect, it, vi } from "vitest";

import { createQuerySseResponse } from "./gateway-sse-responses";

const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";

describe("query Overview activity isolation", () => {
  it("records a canceled terminal state when the client disconnects", async () => {
    const onTerminal = vi.fn(async () => undefined);
    const response = createQuerySseResponse({
      generator: {
        stream: async function* () {
          yield { delta: "partial", type: "delta" as const };
          await new Promise<void>(() => undefined);
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionScope: ["team:camera"],
        query: "What is indexed?",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "member-1",
          tenantId: "tenant-1",
        },
        traceId: TRACE_ID,
      },
      onTerminal,
      traceId: TRACE_ID,
    });

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();
    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith("canceled");
  });

  it("does not turn a successful answer into a query failure when terminal activity append fails", async () => {
    const onTerminal = vi.fn(async () => {
      throw new Error("overview activity backend unavailable");
    });
    const response = createQuerySseResponse({
      generator: {
        stream: async function* () {
          yield { delta: "answer", type: "delta" as const };
          yield { finishReason: "stop", metadata: {}, type: "done" as const };
        },
      },
      input: {
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionScope: ["team:camera"],
        query: "What is indexed?",
        subject: {
          scopes: ["knowledge-spaces:read"],
          subjectId: "member-1",
          tenantId: "tenant-1",
        },
        traceId: TRACE_ID,
      },
      onTerminal,
      traceId: TRACE_ID,
    });

    const body = await response.text();
    expect(body).toContain("answer");
    expect(body).toContain("stop");
    expect(body).not.toContain("overview activity backend unavailable");
    expect(onTerminal).toHaveBeenCalledOnce();
    expect(onTerminal).toHaveBeenCalledWith("succeeded");
  });
});
