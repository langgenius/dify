import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompletionClient } from "./completion";
import { createHttpClientWithSpies } from "../../tests/test-utils";

describe("CompletionClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates completion messages in blocking mode", async () => {
    const { client, request } = createHttpClientWithSpies();
    const completion = new CompletionClient(client);

    await completion.createCompletionMessage({ input: "x" }, "user", false);

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/completion-messages",
      data: {
        inputs: { input: "x" },
        user: "user",
        files: undefined,
        response_mode: "blocking",
      },
    });
  });

  it("creates completion messages in streaming mode", async () => {
    const { client, requestStream } = createHttpClientWithSpies();
    const completion = new CompletionClient(client);

    await completion.createCompletionMessage({
      inputs: { input: "x" },
      user: "user",
      response_mode: "streaming",
    });

    expect(requestStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/completion-messages",
      data: {
        inputs: { input: "x" },
        user: "user",
        response_mode: "streaming",
      },
    });
  });

  it("stops completion messages", async () => {
    const { client, request } = createHttpClientWithSpies();
    const completion = new CompletionClient(client);

    await completion.stopCompletionMessage("task", "user");
    await completion.stop("task", "user");

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/completion-messages/task/stop",
      data: { user: "user" },
    });
  });

  it("supports deprecated runWorkflow", async () => {
    const { client, request, requestStream } = createHttpClientWithSpies();
    const completion = new CompletionClient(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await completion.runWorkflow({ input: "x" }, "user", false);
    await completion.runWorkflow({ input: "x" }, "user", true);

    expect(warn).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/run",
      data: { inputs: { input: "x" }, user: "user", response_mode: "blocking" },
    });
    expect(requestStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/run",
      data: { inputs: { input: "x" }, user: "user", response_mode: "streaming" },
    });
  });
});
