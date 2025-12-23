import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatClient, DifyClient, WorkflowClient, BASE_URL, routes } from ".";
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

    expect(mockRequest).toHaveBeenCalledWith({
      method: routes.getMeta.method,
      url: routes.getMeta.url(),
      params: { user: "end-user" },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    });
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

    await difyClient.fileUpload(form);

    expect(mockRequest).toHaveBeenCalledWith({
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
    });
  });
});

describe("Workflow client", () => {
  it("uses tasks stop path for workflow stop", async () => {
    const workflowClient = new WorkflowClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "stopped", headers: {} });

    await workflowClient.stop("task-1", "end-user");

    expect(mockRequest).toHaveBeenCalledWith({
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
    });
  });
});

describe("Chat client", () => {
  it("places user in query for suggested messages", async () => {
    const chatClient = new ChatClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await chatClient.getSuggested("msg-1", "end-user");

    expect(mockRequest).toHaveBeenCalledWith({
      method: routes.getSuggested.method,
      url: routes.getSuggested.url("msg-1"),
      params: { user: "end-user" },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    });
  });

  it("uses last_id when listing conversations", async () => {
    const chatClient = new ChatClient("test");
    mockRequest.mockResolvedValue({ status: 200, data: "ok", headers: {} });

    await chatClient.getConversations("end-user", "last-1", 10);

    expect(mockRequest).toHaveBeenCalledWith({
      method: routes.getConversations.method,
      url: routes.getConversations.url(),
      params: { user: "end-user", last_id: "last-1", limit: 10 },
      headers: expect.objectContaining({
        Authorization: "Bearer test",
      }),
      responseType: "json",
      timeout: 60000,
    });
  });
});
