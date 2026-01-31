import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatClient } from "./chat";
import { ValidationError } from "../errors/dify-error";
import { createHttpClientWithSpies } from "../../tests/test-utils";

describe("ChatClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates chat messages in blocking mode", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.createChatMessage({ input: "x" }, "hello", "user", false, null);

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/chat-messages",
      data: {
        inputs: { input: "x" },
        query: "hello",
        user: "user",
        response_mode: "blocking",
        files: undefined,
      },
    });
  });

  it("creates chat messages in streaming mode", async () => {
    const { client, requestStream } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.createChatMessage({
      inputs: { input: "x" },
      query: "hello",
      user: "user",
      response_mode: "streaming",
    });

    expect(requestStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/chat-messages",
      data: {
        inputs: { input: "x" },
        query: "hello",
        user: "user",
        response_mode: "streaming",
      },
    });
  });

  it("stops chat messages", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.stopChatMessage("task", "user");
    await chat.stopMessage("task", "user");

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/chat-messages/task/stop",
      data: { user: "user" },
    });
  });

  it("gets suggested questions", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.getSuggested("msg", "user");

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/messages/msg/suggested",
      query: { user: "user" },
    });
  });

  it("submits message feedback", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.messageFeedback("msg", "like", "user", "good");
    await chat.messageFeedback({
      messageId: "msg",
      user: "user",
      rating: "dislike",
    });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/messages/msg/feedbacks",
      data: { user: "user", rating: "like", content: "good" },
    });
  });

  it("lists app feedbacks", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.getAppFeedbacks(2, 5);

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/app/feedbacks",
      query: { page: 2, limit: 5 },
    });
  });

  it("lists conversations and messages", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.getConversations("user", "last", 10, "-updated_at");
    await chat.getConversationMessages("user", "conv", "first", 5);

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/conversations",
      query: {
        user: "user",
        last_id: "last",
        limit: 10,
        sort_by: "-updated_at",
      },
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/messages",
      query: {
        user: "user",
        conversation_id: "conv",
        first_id: "first",
        limit: 5,
      },
    });
  });

  it("renames conversations with optional auto-generate", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.renameConversation("conv", "name", "user", false);
    await chat.renameConversation("conv", "user", { autoGenerate: true });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/conversations/conv/name",
      data: { user: "user", auto_generate: false, name: "name" },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/conversations/conv/name",
      data: { user: "user", auto_generate: true },
    });
  });

  it("requires name when autoGenerate is false", async () => {
    const { client } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    expect(() =>
      chat.renameConversation("conv", "", "user", false)
    ).toThrow(ValidationError);
  });

  it("deletes conversations", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.deleteConversation("conv", "user");

    expect(request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/conversations/conv",
      data: { user: "user" },
    });
  });

  it("manages conversation variables", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.getConversationVariables("conv", "user", "last", 10, "name");
    await chat.updateConversationVariable("conv", "var", "user", "value");

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/conversations/conv/variables",
      query: {
        user: "user",
        last_id: "last",
        limit: 10,
        variable_name: "name",
      },
    });
    expect(request).toHaveBeenCalledWith({
      method: "PUT",
      path: "/conversations/conv/variables/var",
      data: { user: "user", value: "value" },
    });
  });

  it("handles annotation APIs", async () => {
    const { client, request } = createHttpClientWithSpies();
    const chat = new ChatClient(client);

    await chat.annotationReplyAction("enable", {
      score_threshold: 0.5,
      embedding_provider_name: "prov",
      embedding_model_name: "model",
    });
    await chat.getAnnotationReplyStatus("enable", "job");
    await chat.listAnnotations({ page: 1, limit: 10, keyword: "k" });
    await chat.createAnnotation({ question: "q", answer: "a" });
    await chat.updateAnnotation("id", { question: "q", answer: "a" });
    await chat.deleteAnnotation("id");

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/apps/annotation-reply/enable",
      data: {
        score_threshold: 0.5,
        embedding_provider_name: "prov",
        embedding_model_name: "model",
      },
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/apps/annotation-reply/enable/status/job",
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/apps/annotations",
      query: { page: 1, limit: 10, keyword: "k" },
    });
  });
});
