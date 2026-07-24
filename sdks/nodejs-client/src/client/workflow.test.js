import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowClient } from "./workflow";
import { createHttpClientWithSpies } from "../../tests/test-utils";

describe("WorkflowClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs workflows with blocking and streaming modes", async () => {
    const { client, request, requestStream } = createHttpClientWithSpies();
    const workflow = new WorkflowClient(client);

    await workflow.run({ inputs: { input: "x" }, user: "user" });
    await workflow.run({ input: "x" }, "user", true);

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/run",
      data: {
        inputs: { input: "x" },
        user: "user",
      },
    });
    expect(requestStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/run",
      data: {
        inputs: { input: "x" },
        user: "user",
        response_mode: "streaming",
      },
    });
  });

  it("runs workflow by id", async () => {
    const { client, request, requestStream } = createHttpClientWithSpies();
    const workflow = new WorkflowClient(client);

    await workflow.runById("wf", {
      inputs: { input: "x" },
      user: "user",
      response_mode: "blocking",
    });
    await workflow.runById("wf", {
      inputs: { input: "x" },
      user: "user",
      response_mode: "streaming",
    });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/wf/run",
      data: {
        inputs: { input: "x" },
        user: "user",
        response_mode: "blocking",
      },
    });
    expect(requestStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/wf/run",
      data: {
        inputs: { input: "x" },
        user: "user",
        response_mode: "streaming",
      },
    });
  });

  it("gets run details and stops workflow", async () => {
    const { client, request } = createHttpClientWithSpies();
    const workflow = new WorkflowClient(client);

    await workflow.getRun("run");
    await workflow.stop("task", "user");

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/run/run",
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/tasks/task/stop",
      data: { user: "user" },
    });
  });

  it("fetches workflow logs", async () => {
    const { client, request } = createHttpClientWithSpies();
    const workflow = new WorkflowClient(client);

    // Use createdByEndUserSessionId to filter by user session (backend API parameter)
    await workflow.getLogs({
      keyword: "k",
      status: "succeeded",
      startTime: "2024-01-01",
      endTime: "2024-01-02",
      createdByEndUserSessionId: "session-123",
      page: 1,
      limit: 20,
    });

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/logs",
      query: {
        keyword: "k",
        status: "succeeded",
        created_at__before: "2024-01-02",
        created_at__after: "2024-01-01",
        created_by_end_user_session_id: "session-123",
        created_by_account: undefined,
        page: 1,
        limit: 20,
      },
    });
  });
});
