import { beforeEach, describe, expect, it, vi } from "vitest";
import { DifyClient } from "./base";
import { ValidationError } from "../errors/dify-error";
import { createHttpClientWithSpies } from "../../tests/test-utils";

describe("DifyClient base", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getRoot calls root endpoint", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    await dify.getRoot();

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/",
    });
  });

  it("getApplicationParameters includes optional user", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    await dify.getApplicationParameters();
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/parameters",
      query: undefined,
    });

    await dify.getApplicationParameters("user-1");
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/parameters",
      query: { user: "user-1" },
    });
  });

  it("getMeta includes optional user", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    await dify.getMeta("user-1");
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/meta",
      query: { user: "user-1" },
    });
  });

  it("getInfo and getSite support optional user", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    await dify.getInfo();
    await dify.getSite("user");

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/info",
      query: undefined,
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/site",
      query: { user: "user" },
    });
  });

  it("messageFeedback builds payload from request object", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    await dify.messageFeedback({
      messageId: "msg",
      user: "user",
      rating: "like",
      content: "good",
    });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/messages/msg/feedbacks",
      data: { user: "user", rating: "like", content: "good" },
    });
  });

  it("fileUpload appends user to form data", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);
    const form = { append: vi.fn(), getHeaders: () => ({}) };

    await dify.fileUpload(form, "user");

    expect(form.append).toHaveBeenCalledWith("user", "user");
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/files/upload",
      data: form,
    });
  });

  it("filePreview uses arraybuffer response", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    await dify.filePreview("file", "user", true);

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/files/file/preview",
      query: { user: "user", as_attachment: "true" },
      responseType: "arraybuffer",
    });
  });

  it("audioToText appends user and sends form", async () => {
    const { client, request } = createHttpClientWithSpies();
    const dify = new DifyClient(client);
    const form = { append: vi.fn(), getHeaders: () => ({}) };

    await dify.audioToText(form, "user");

    expect(form.append).toHaveBeenCalledWith("user", "user");
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/audio-to-text",
      data: form,
    });
  });

  it("textToAudio supports streaming and message id", async () => {
    const { client, request, requestBinaryStream } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    await dify.textToAudio({
      user: "user",
      message_id: "msg",
      streaming: true,
    });

    expect(requestBinaryStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/text-to-audio",
      data: {
        user: "user",
        message_id: "msg",
        streaming: true,
      },
    });

    await dify.textToAudio("hello", "user", false, "voice");
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/text-to-audio",
      data: {
        text: "hello",
        user: "user",
        streaming: false,
        voice: "voice",
      },
      responseType: "arraybuffer",
    });
  });

  it("textToAudio requires text or message id", async () => {
    const { client } = createHttpClientWithSpies();
    const dify = new DifyClient(client);

    expect(() => dify.textToAudio({ user: "user" })).toThrow(ValidationError);
  });
});
