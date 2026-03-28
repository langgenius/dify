import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatClient, DifyClient, WorkflowClient, BASE_URL, routes } from "./index";
import axios from "axios";

const mockRequest = vi.fn();

const setupAxiosMock = () => {
  vi.spyOn(axios, "create").mockReturnValue({ request: mockRequest });
};

beforeEach(() => {
  vi.restoreAllMocks();
  mockRequest.mockReset();
  setupAxiosMock();
});

describe("Client", () => {
  it("should create a client", () => {
    new DifyClient("test");

    expect(axios.create).toHaveBeenCalledWith({
      baseURL: BASE_URL,
      timeout: 60000,
    });
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
    mockRequest.mockResolvedValue({
      status: 200,
      data: "response",
      headers: {},
    });

    await difyClient.sendRequest(method, endpoint);

    const requestConfig = mockRequest.mock.calls[0][0];
    expect(requestConfig).toMatchObject({
      method,
      url: endpoint,
      params: undefined,
      responseType: "json",
      timeout: 60000,
    });
    expect(requestConfig.headers.Authorization).toBe("Bearer test");
  });

  it("uses the getMeta route configuration", async () => {
    const difyClient = new DifyClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await difyClient.getMeta("end-user");

    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: routes.getMeta.method,
      url: routes.getMeta.url(),
      params: { user: "end-user" },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    }));
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
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await difyClient.fileUpload(form, "end-user");

    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: routes.fileUpload.method,
      url: routes.fileUpload.url(),
      params: undefined,
      headers: expect.objectContaining({
        Authorization: "Bearer test",
        "content-type": "multipart/form-data; boundary=test",
      }),
      responseType: "json",
      timeout: 60000,
      data: form,
    }));
  });
});

describe("Workflow client", () => {
  it("uses tasks stop path for workflow stop", async () => {
    const workflowClient = new WorkflowClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "stopped", headers: {} });

    await workflowClient.stop("task-1", "end-user");

    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: routes.stopWorkflow.method,
      url: routes.stopWorkflow.url("task-1"),
      params: undefined,
      headers: expect.objectContaining({
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      }),
      responseType: "json",
      timeout: 60000,
      data: { user: "end-user" },
    }));
  });

  it("maps workflow log filters to service api params", async () => {
    const workflowClient = new WorkflowClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await workflowClient.getLogs({
      createdAtAfter: "2024-01-01T00:00:00Z",
      createdAtBefore: "2024-01-02T00:00:00Z",
      createdByEndUserSessionId: "sess-1",
      createdByAccount: "acc-1",
      page: 2,
      limit: 10,
    });

    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      url: "/workflows/logs",
      params: {
        created_at__after: "2024-01-01T00:00:00Z",
        created_at__before: "2024-01-02T00:00:00Z",
        created_by_end_user_session_id: "sess-1",
        created_by_account: "acc-1",
        page: 2,
        limit: 10,
      },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    }));
  });
});

describe("Chat client", () => {
  it("places user in query for suggested messages", async () => {
    const chatClient = new ChatClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await chatClient.getSuggested("msg-1", "end-user");

    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: routes.getSuggested.method,
      url: routes.getSuggested.url("msg-1"),
      params: { user: "end-user" },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    }));
  });

  it("uses last_id when listing conversations", async () => {
    const chatClient = new ChatClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await chatClient.getConversations("end-user", "last-1", 10);

    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: routes.getConversations.method,
      url: routes.getConversations.url(),
      params: { user: "end-user", last_id: "last-1", limit: 10 },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    }));
  });

  it("lists app feedbacks without user params", async () => {
    const chatClient = new ChatClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await chatClient.getAppFeedbacks(1, 20);

    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      url: "/app/feedbacks",
      params: { page: 1, limit: 20 },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    }));
  });
});
