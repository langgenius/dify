import { DifyClient } from "./base";
import type { ChatMessageRequest, ChatMessageResponse } from "../types/chat";
import type {
  AnnotationCreateRequest,
  AnnotationListOptions,
  AnnotationReplyActionRequest,
  AnnotationResponse,
} from "../types/annotation";
import type {
  DifyResponse,
  DifyStream,
  QueryParams,
} from "../types/common";
import {
  ensureNonEmptyString,
  ensureOptionalInt,
  ensureOptionalString,
} from "./validation";

export class ChatClient extends DifyClient {
  createChatMessage(
    request: ChatMessageRequest
  ): Promise<DifyResponse<ChatMessageResponse> | DifyStream<ChatMessageResponse>>;
  createChatMessage(
    inputs: Record<string, unknown>,
    query: string,
    user: string,
    stream?: boolean,
    conversationId?: string | null,
    files?: Array<Record<string, unknown>> | null
  ): Promise<DifyResponse<ChatMessageResponse> | DifyStream<ChatMessageResponse>>;
  createChatMessage(
    inputOrRequest: ChatMessageRequest | Record<string, unknown>,
    query?: string,
    user?: string,
    stream = false,
    conversationId?: string | null,
    files?: Array<Record<string, unknown>> | null
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

  stopChatMessage(
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

  stopMessage(
    taskId: string,
    user: string
  ): Promise<DifyResponse<ChatMessageResponse>> {
    return this.stopChatMessage(taskId, user);
  }

  getSuggested(
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

  // Note: messageFeedback is inherited from DifyClient

  getAppFeedbacks(
    page?: number,
    limit?: number
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureOptionalInt(page, "page");
    ensureOptionalInt(limit, "limit");
    return this.http.request({
      method: "GET",
      path: "/app/feedbacks",
      query: {
        page,
        limit,
      },
    });
  }

  getConversations(
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

  getConversationMessages(
    user: string,
    conversationId: string,
    firstId?: string | null,
    limit?: number | null
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(user, "user");
    ensureNonEmptyString(conversationId, "conversationId");
    ensureOptionalString(firstId, "firstId");
    ensureOptionalInt(limit, "limit");

    const params: QueryParams = { user };
    params.conversation_id = conversationId;
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

  renameConversation(
    conversationId: string,
    name: string,
    user: string,
    autoGenerate?: boolean
  ): Promise<DifyResponse<Record<string, unknown>>>;
  renameConversation(
    conversationId: string,
    user: string,
    options?: { name?: string | null; autoGenerate?: boolean }
  ): Promise<DifyResponse<Record<string, unknown>>>;
  renameConversation(
    conversationId: string,
    nameOrUser: string,
    userOrOptions?: string | { name?: string | null; autoGenerate?: boolean },
    autoGenerate?: boolean
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(conversationId, "conversationId");

    let name: string | null | undefined;
    let user: string;
    let resolvedAutoGenerate: boolean;

    if (typeof userOrOptions === "string" || userOrOptions === undefined) {
      name = nameOrUser;
      user = userOrOptions ?? "";
      resolvedAutoGenerate = autoGenerate ?? false;
    } else {
      user = nameOrUser;
      name = userOrOptions.name;
      resolvedAutoGenerate = userOrOptions.autoGenerate ?? false;
    }

    ensureNonEmptyString(user, "user");
    if (!resolvedAutoGenerate) {
      ensureNonEmptyString(name, "name");
    }

    const payload: Record<string, unknown> = {
      user,
      auto_generate: resolvedAutoGenerate,
    };
    if (typeof name === "string" && name.trim().length > 0) {
      payload.name = name;
    }

    return this.http.request({
      method: "POST",
      path: `/conversations/${conversationId}/name`,
      data: payload,
    });
  }

  deleteConversation(
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

  getConversationVariables(
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

  updateConversationVariable(
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

  annotationReplyAction(
    action: "enable" | "disable",
    request: AnnotationReplyActionRequest
  ): Promise<DifyResponse<AnnotationResponse>> {
    ensureNonEmptyString(action, "action");
    ensureNonEmptyString(request.embedding_provider_name, "embedding_provider_name");
    ensureNonEmptyString(request.embedding_model_name, "embedding_model_name");
    return this.http.request({
      method: "POST",
      path: `/apps/annotation-reply/${action}`,
      data: request,
    });
  }

  getAnnotationReplyStatus(
    action: "enable" | "disable",
    jobId: string
  ): Promise<DifyResponse<AnnotationResponse>> {
    ensureNonEmptyString(action, "action");
    ensureNonEmptyString(jobId, "jobId");
    return this.http.request({
      method: "GET",
      path: `/apps/annotation-reply/${action}/status/${jobId}`,
    });
  }

  listAnnotations(
    options?: AnnotationListOptions
  ): Promise<DifyResponse<AnnotationResponse>> {
    ensureOptionalInt(options?.page, "page");
    ensureOptionalInt(options?.limit, "limit");
    ensureOptionalString(options?.keyword, "keyword");
    return this.http.request({
      method: "GET",
      path: "/apps/annotations",
      query: {
        page: options?.page,
        limit: options?.limit,
        keyword: options?.keyword ?? undefined,
      },
    });
  }

  createAnnotation(
    request: AnnotationCreateRequest
  ): Promise<DifyResponse<AnnotationResponse>> {
    ensureNonEmptyString(request.question, "question");
    ensureNonEmptyString(request.answer, "answer");
    return this.http.request({
      method: "POST",
      path: "/apps/annotations",
      data: request,
    });
  }

  updateAnnotation(
    annotationId: string,
    request: AnnotationCreateRequest
  ): Promise<DifyResponse<AnnotationResponse>> {
    ensureNonEmptyString(annotationId, "annotationId");
    ensureNonEmptyString(request.question, "question");
    ensureNonEmptyString(request.answer, "answer");
    return this.http.request({
      method: "PUT",
      path: `/apps/annotations/${annotationId}`,
      data: request,
    });
  }

  deleteAnnotation(
    annotationId: string
  ): Promise<DifyResponse<AnnotationResponse>> {
    ensureNonEmptyString(annotationId, "annotationId");
    return this.http.request({
      method: "DELETE",
      path: `/apps/annotations/${annotationId}`,
    });
  }

  // Note: audioToText is inherited from DifyClient
}
