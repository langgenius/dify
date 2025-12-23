import { DifyClient } from "./base";
import { ChatMessageRequest, ChatMessageResponse } from "../types/chat";
import { DifyResponse, DifyStream, QueryParams } from "../types/common";
import {
  ensureNonEmptyString,
  ensureOptionalInt,
  ensureOptionalString,
  ensureRating,
} from "./validation";

export class ChatClient extends DifyClient {
  async createChatMessage(
    request: ChatMessageRequest
  ): Promise<DifyResponse<ChatMessageResponse>>;
  async createChatMessage(
    inputs: Record<string, unknown>,
    query: string,
    user: string,
    stream?: boolean,
    conversationId?: string | null,
    files?: unknown
  ): Promise<DifyResponse<ChatMessageResponse> | DifyStream<ChatMessageResponse>>;
  async createChatMessage(
    inputOrRequest: ChatMessageRequest | Record<string, unknown>,
    query?: string,
    user?: string,
    stream = false,
    conversationId?: string | null,
    files?: unknown
  ): Promise<DifyResponse<ChatMessageResponse> | DifyStream<ChatMessageResponse>> {
    let payload: ChatMessageRequest;
    let shouldStream = stream;

    if (query === undefined && "user" in (inputOrRequest as ChatMessageRequest)) {
      payload = inputOrRequest as ChatMessageRequest;
      shouldStream = payload.response_mode === "streaming";
    } else {
      ensureNonEmptyString(query, "query");
      ensureNonEmptyString(user, "user");
      payload = {
        inputs: inputOrRequest as Record<string, unknown>,
        query,
        user,
        response_mode: stream ? "streaming" : "blocking",
        files,
      };
      if (conversationId) {
        payload.conversation_id = conversationId;
      }
    }

    ensureNonEmptyString(payload.user, "user");
    ensureNonEmptyString(payload.query, "query");

    if (shouldStream) {
      return this.http.requestStream<ChatMessageResponse>({
        method: "POST",
        path: "/chat-messages",
        data: payload,
      });
    }

    return this.http.request<ChatMessageResponse>({
      method: "POST",
      path: "/chat-messages",
      data: payload,
    });
  }

  async stopChatMessage(
    taskId: string,
    user: string
  ): Promise<DifyResponse<ChatMessageResponse>> {
    ensureNonEmptyString(taskId, "taskId");
    ensureNonEmptyString(user, "user");
    return this.http.request<ChatMessageResponse>({
      method: "POST",
      path: `/chat-messages/${taskId}/stop`,
      data: { user },
    });
  }

  async stopMessage(
    taskId: string,
    user: string
  ): Promise<DifyResponse<ChatMessageResponse>> {
    return this.stopChatMessage(taskId, user);
  }

  async getSuggested(
    messageId: string,
    user: string
  ): Promise<DifyResponse<ChatMessageResponse>> {
    ensureNonEmptyString(messageId, "messageId");
    ensureNonEmptyString(user, "user");
    return this.http.request<ChatMessageResponse>({
      method: "GET",
      path: `/messages/${messageId}/suggested`,
      query: { user },
    });
  }

  async messageFeedback(
    messageId: string,
    rating: "like" | "dislike",
    user: string,
    content?: string
  ): Promise<DifyResponse<ChatMessageResponse>> {
    ensureNonEmptyString(messageId, "messageId");
    ensureNonEmptyString(user, "user");
    ensureRating(rating);
    if (content) {
      ensureOptionalString(content, "content");
    }

    const payload: Record<string, unknown> = { rating, user };
    if (content) {
      payload.content = content;
    }

    return this.http.request<ChatMessageResponse>({
      method: "POST",
      path: `/messages/${messageId}/feedbacks`,
      data: payload,
    });
  }

  async getAppFeedbacks(
    user: string,
    page?: number,
    limit?: number
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(user, "user");
    ensureOptionalInt(page, "page");
    ensureOptionalInt(limit, "limit");
    return this.http.request({
      method: "GET",
      path: "/app/feedbacks",
      query: {
        user,
        page,
        limit,
      },
    });
  }

  async getConversations(
    user: string,
    lastId?: string | null,
    limit?: number | null,
    sortByOrPinned?: string | boolean | null
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(user, "user");
    ensureOptionalString(lastId, "lastId");
    ensureOptionalInt(limit, "limit");

    const params: QueryParams = { user };
    if (lastId) {
      params.last_id = lastId;
    }
    if (limit) {
      params.limit = limit;
    }
    if (typeof sortByOrPinned === "string") {
      params.sort_by = sortByOrPinned;
    } else if (typeof sortByOrPinned === "boolean") {
      params.pinned = sortByOrPinned;
    }

    return this.http.request({
      method: "GET",
      path: "/conversations",
      query: params,
    });
  }

  async getConversationMessages(
    user: string,
    conversationId?: string,
    firstId?: string | null,
    limit?: number | null
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(user, "user");
    ensureOptionalString(conversationId, "conversationId");
    ensureOptionalString(firstId, "firstId");
    ensureOptionalInt(limit, "limit");

    const params: QueryParams = { user };
    if (conversationId) {
      params.conversation_id = conversationId;
    }
    if (firstId) {
      params.first_id = firstId;
    }
    if (limit) {
      params.limit = limit;
    }

    return this.http.request({
      method: "GET",
      path: "/messages",
      query: params,
    });
  }

  async renameConversation(
    conversationId: string,
    name: string,
    user: string,
    autoGenerate?: boolean
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(conversationId, "conversationId");
    ensureNonEmptyString(user, "user");
    ensureNonEmptyString(name, "name");
    return this.http.request({
      method: "POST",
      path: `/conversations/${conversationId}/name`,
      data: {
        name,
        user,
        auto_generate: autoGenerate,
      },
    });
  }

  async deleteConversation(
    conversationId: string,
    user: string
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(conversationId, "conversationId");
    ensureNonEmptyString(user, "user");
    return this.http.request({
      method: "DELETE",
      path: `/conversations/${conversationId}`,
      data: { user },
    });
  }

  async getConversationVariables(
    conversationId: string,
    user: string,
    lastId?: string | null,
    limit?: number | null,
    variableName?: string | null
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(conversationId, "conversationId");
    ensureNonEmptyString(user, "user");
    ensureOptionalString(lastId, "lastId");
    ensureOptionalInt(limit, "limit");
    ensureOptionalString(variableName, "variableName");

    return this.http.request({
      method: "GET",
      path: `/conversations/${conversationId}/variables`,
      query: {
        user,
        last_id: lastId ?? undefined,
        limit: limit ?? undefined,
        variable_name: variableName ?? undefined,
      },
    });
  }

  async updateConversationVariable(
    conversationId: string,
    variableId: string,
    user: string,
    value: unknown
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(conversationId, "conversationId");
    ensureNonEmptyString(variableId, "variableId");
    ensureNonEmptyString(user, "user");
    return this.http.request({
      method: "PUT",
      path: `/conversations/${conversationId}/variables/${variableId}`,
      data: {
        user,
        value,
      },
    });
  }

  async audioToText(form: unknown, user?: string): Promise<DifyResponse<unknown>> {
    return super.audioToText(form, user);
  }
}
