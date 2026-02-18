import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceClient } from "./workspace";
import { createHttpClientWithSpies } from "../../tests/test-utils";

describe("WorkspaceClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("gets models by type", async () => {
    const { client, request } = createHttpClientWithSpies();
    const workspace = new WorkspaceClient(client);

    await workspace.getModelsByType("llm");

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/workspaces/current/models/model-types/llm",
    });
  });
});
