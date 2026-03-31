import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, ChatClient, DifyClient, WorkflowClient, routes } from "./index";

const stubFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

describe("Client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a client with default settings", () => {
    const difyClient = new DifyClient("test");

    expect(difyClient.getHttpClient().getSettings()).toMatchObject({
      apiKey: "test",
      baseUrl: BASE_URL,
      timeout: 60,
    });
  });

  it("updates the api key", () => {
    const difyClient = new DifyClient("test");
    difyClient.updateApiKey("test2");

    expect(difyClient.getHttpClient().getSettings().apiKey).toBe("test2");
  });
});

describe("Send Requests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes a successful request to the application parameter route", async () => {
    const fetchMock = stubFetch();
    const difyClient = new DifyClient("test");
    const method = "GET";
    const endpoint = routes.application.url();

    fetchMock.mockResolvedValueOnce(jsonResponse("response"));

    const response = await difyClient.sendRequest(method, endpoint);

    expect(response).toMatchObject({
      status: 200,
      data: "response",
      headers: {
        "content-type": "application/json",
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${endpoint}`);
    expect(init.method).toBe(method);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test",
      "User-Agent": "dify-client-node",
    });
  });

  it("uses the getMeta route configuration", async () => {
    const fetchMock = stubFetch();
    const difyClient = new DifyClient("test");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await difyClient.getMeta("end-user");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${routes.getMeta.url()}?user=end-user`);
    expect(init.method).toBe(routes.getMeta.method);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test",
    });
  });
});

describe("File uploads", () => {
  const OriginalFormData = globalThis.FormData;

  beforeAll(() => {
    globalThis.FormData = class FormDataMock extends Readable {
      constructor() {
        super();
      }

      _read() {}

      append() {}

      getHeaders() {
        return {
          "content-type": "multipart/form-data; boundary=test",
        };
      }
    } as unknown as typeof FormData;
  });

  afterAll(() => {
    globalThis.FormData = OriginalFormData;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not override multipart boundary headers for legacy FormData", async () => {
    const fetchMock = stubFetch();
    const difyClient = new DifyClient("test");
    const form = new globalThis.FormData();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await difyClient.fileUpload(form, "end-user");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${routes.fileUpload.url()}`);
    expect(init.method).toBe(routes.fileUpload.method);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test",
      "content-type": "multipart/form-data; boundary=test",
    });
    expect(init.body).not.toBe(form);
    expect((init as RequestInit & { duplex?: string }).duplex).toBe("half");
  });
});

describe("Workflow client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses tasks stop path for workflow stop", async () => {
    const fetchMock = stubFetch();
    const workflowClient = new WorkflowClient("test");
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: "success" }));

    await workflowClient.stop("task-1", "end-user");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${routes.stopWorkflow.url("task-1")}`);
    expect(init.method).toBe(routes.stopWorkflow.method);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test",
      "Content-Type": "application/json",
    });
    expect(init.body).toBe(JSON.stringify({ user: "end-user" }));
  });

  it("maps workflow log filters to service api params", async () => {
    const fetchMock = stubFetch();
    const workflowClient = new WorkflowClient("test");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await workflowClient.getLogs({
      createdAtAfter: "2024-01-01T00:00:00Z",
      createdAtBefore: "2024-01-02T00:00:00Z",
      createdByEndUserSessionId: "sess-1",
      createdByAccount: "acc-1",
      page: 2,
      limit: 10,
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url);
    expect(parsedUrl.origin + parsedUrl.pathname).toBe(`${BASE_URL}/workflows/logs`);
    expect(parsedUrl.searchParams.get("created_at__before")).toBe(
      "2024-01-02T00:00:00Z"
    );
    expect(parsedUrl.searchParams.get("created_at__after")).toBe(
      "2024-01-01T00:00:00Z"
    );
    expect(parsedUrl.searchParams.get("created_by_end_user_session_id")).toBe(
      "sess-1"
    );
    expect(parsedUrl.searchParams.get("created_by_account")).toBe("acc-1");
    expect(parsedUrl.searchParams.get("page")).toBe("2");
    expect(parsedUrl.searchParams.get("limit")).toBe("10");
  });
});

describe("Chat client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("places user in query for suggested messages", async () => {
    const fetchMock = stubFetch();
    const chatClient = new ChatClient("test");
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: "success", data: [] }));

    await chatClient.getSuggested("msg-1", "end-user");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${routes.getSuggested.url("msg-1")}?user=end-user`);
    expect(init.method).toBe(routes.getSuggested.method);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test",
    });
  });

  it("uses last_id when listing conversations", async () => {
    const fetchMock = stubFetch();
    const chatClient = new ChatClient("test");
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await chatClient.getConversations("end-user", "last-1", 10);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${routes.getConversations.url()}?user=end-user&last_id=last-1&limit=10`);
  });

  it("lists app feedbacks without user params", async () => {
    const fetchMock = stubFetch();
    const chatClient = new ChatClient("test");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await chatClient.getAppFeedbacks(1, 20);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/app/feedbacks?page=1&limit=20`);
  });
});
