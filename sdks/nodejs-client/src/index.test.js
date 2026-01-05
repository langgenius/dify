import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatClient, DifyClient, WorkflowClient, BASE_URL, routes } from "./index";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

describe("Client", () => {
  it("should create a client", () => {
    new DifyClient("test");
    // Just verify client can be created successfully
    expect(true).toBe(true);
  });

  it("should update the api key", () => {
    const difyClient = new DifyClient("test");
    difyClient.updateApiKey("test2");

    expect(difyClient.getHttpClient().getSettings().apiKey).toBe("test2");
  });
});

describe("Send Requests", () => {
  it("should make a successful request to the application parameter", async () => {
    const difyClient = new DifyClient("test");
    const method = "GET";
    const endpoint = routes.application.url();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "response",
    });

    await difyClient.sendRequest(method, endpoint);

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain(endpoint);
    expect(config.method).toBe(method);
    expect(config.headers.Authorization).toBe("Bearer test");
  });

  it("uses the getMeta route configuration", async () => {
    const difyClient = new DifyClient("test");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "ok",
    });

    await difyClient.getMeta("end-user");

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain(routes.getMeta.url());
    expect(url).toContain("user=end-user");
    expect(config.method).toBe(routes.getMeta.method);
    expect(config.headers.Authorization).toBe("Bearer test");
  });
});

describe("File uploads", () => {
  const OriginalFormData = globalThis.FormData;

  beforeAll(() => {
    globalThis.FormData = class FormDataMock {
      append() {}

      getHeaders() {
        return {
          "content-type": "multipart/form-data; boundary=test",
        };
      }
    };
  });

  afterAll(() => {
    globalThis.FormData = OriginalFormData;
  });

  it("does not override multipart boundary headers for FormData", async () => {
    const difyClient = new DifyClient("test");
    const form = new globalThis.FormData();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "ok",
    });

    await difyClient.fileUpload(form, "end-user");

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain(routes.fileUpload.url());
    expect(config.method).toBe(routes.fileUpload.method);
    expect(config.headers.Authorization).toBe("Bearer test");
    expect(config.headers["content-type"]).toBe("multipart/form-data; boundary=test");
    expect(config.body).toBe(form);
  });
});

describe("Workflow client", () => {
  it("uses tasks stop path for workflow stop", async () => {
    const workflowClient = new WorkflowClient("test");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "stopped",
    });

    await workflowClient.stop("task-1", "end-user");

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain(routes.stopWorkflow.url("task-1"));
    expect(config.method).toBe(routes.stopWorkflow.method);
    expect(config.headers.Authorization).toBe("Bearer test");
    expect(config.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(config.body)).toEqual({ user: "end-user" });
  });

  it("maps workflow log filters to service api params", async () => {
    const workflowClient = new WorkflowClient("test");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "ok",
    });

    await workflowClient.getLogs({
      createdAtAfter: "2024-01-01T00:00:00Z",
      createdAtBefore: "2024-01-02T00:00:00Z",
      createdByEndUserSessionId: "sess-1",
      createdByAccount: "acc-1",
      page: 2,
      limit: 10,
    });

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain("/workflows/logs");
    expect(url).toContain("created_at__after=2024-01-01T00%3A00%3A00Z");
    expect(url).toContain("created_at__before=2024-01-02T00%3A00%3A00Z");
    expect(url).toContain("created_by_end_user_session_id=sess-1");
    expect(url).toContain("created_by_account=acc-1");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=10");
    expect(config.method).toBe("GET");
    expect(config.headers.Authorization).toBe("Bearer test");
  });
});

describe("Chat client", () => {
  it("places user in query for suggested messages", async () => {
    const chatClient = new ChatClient("test");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "ok",
    });

    await chatClient.getSuggested("msg-1", "end-user");

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain(routes.getSuggested.url("msg-1"));
    expect(url).toContain("user=end-user");
    expect(config.method).toBe(routes.getSuggested.method);
    expect(config.headers.Authorization).toBe("Bearer test");
  });

  it("uses last_id when listing conversations", async () => {
    const chatClient = new ChatClient("test");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "ok",
    });

    await chatClient.getConversations("end-user", "last-1", 10);

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain(routes.getConversations.url());
    expect(url).toContain("user=end-user");
    expect(url).toContain("last_id=last-1");
    expect(url).toContain("limit=10");
    expect(config.method).toBe(routes.getConversations.method);
    expect(config.headers.Authorization).toBe("Bearer test");
  });

  it("lists app feedbacks without user params", async () => {
    const chatClient = new ChatClient("test");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => "ok",
    });

    await chatClient.getAppFeedbacks(1, 20);

    const [url, config] = mockFetch.mock.calls[0];
    expect(url).toContain("/app/feedbacks");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
    expect(config.method).toBe("GET");
    expect(config.headers.Authorization).toBe("Bearer test");
  });
});
