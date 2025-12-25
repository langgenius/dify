import type {
  BinaryStream,
  DifyClientConfig,
  DifyResponse,
  MessageFeedbackRequest,
  QueryParams,
  RequestMethod,
  TextToAudioRequest,
} from "../types/common";
import { HttpClient } from "../http/client";
import { ensureNonEmptyString, ensureRating } from "./validation";
import { FileUploadError, ValidationError } from "../errors/dify-error";
import { isFormData } from "../http/form-data";

const toConfig = (
  init: string | DifyClientConfig,
  baseUrl?: string
): DifyClientConfig => {
  if (typeof init === "string") {
    return {
      apiKey: init,
      baseUrl,
    };
  }
  return init;
};

const appendUserToFormData = (form: unknown, user: string): void => {
  if (!isFormData(form)) {
    throw new FileUploadError("FormData is required for file uploads");
  }
  if (typeof form.append === "function") {
    form.append("user", user);
  }
};

export class DifyClient {
  protected http: HttpClient;

  constructor(config: string | DifyClientConfig | HttpClient, baseUrl?: string) {
    if (config instanceof HttpClient) {
      this.http = config;
    } else {
      this.http = new HttpClient(toConfig(config, baseUrl));
    }
  }

  updateApiKey(apiKey: string): void {
    ensureNonEmptyString(apiKey, "apiKey");
    this.http.updateApiKey(apiKey);
  }

  getHttpClient(): HttpClient {
    return this.http;
  }

  sendRequest(
    method: RequestMethod,
    endpoint: string,
    data: unknown = null,
    params: QueryParams | null = null,
    stream = false,
    headerParams: Record<string, string> = {}
  ): ReturnType<HttpClient["requestRaw"]> {
    return this.http.requestRaw({
      method,
      path: endpoint,
      data,
      query: params ?? undefined,
      headers: headerParams,
      responseType: stream ? "stream" : "json",
    });
  }

  getRoot(): Promise<DifyResponse<unknown>> {
    return this.http.request({
      method: "GET",
      path: "/",
    });
  }

  getApplicationParameters(user?: string): Promise<DifyResponse<unknown>> {
    if (user) {
      ensureNonEmptyString(user, "user");
    }
    return this.http.request({
      method: "GET",
      path: "/parameters",
      query: user ? { user } : undefined,
    });
  }

  async getParameters(user?: string): Promise<DifyResponse<unknown>> {
    return this.getApplicationParameters(user);
  }

  getMeta(user?: string): Promise<DifyResponse<unknown>> {
    if (user) {
      ensureNonEmptyString(user, "user");
    }
    return this.http.request({
      method: "GET",
      path: "/meta",
      query: user ? { user } : undefined,
    });
  }

  messageFeedback(
    request: MessageFeedbackRequest
  ): Promise<DifyResponse<Record<string, unknown>>>;
  messageFeedback(
    messageId: string,
    rating: "like" | "dislike" | null,
    user: string,
    content?: string
  ): Promise<DifyResponse<Record<string, unknown>>>;
  messageFeedback(
    messageIdOrRequest: string | MessageFeedbackRequest,
    rating?: "like" | "dislike" | null,
    user?: string,
    content?: string
  ): Promise<DifyResponse<Record<string, unknown>>> {
    let messageId: string;
    const payload: Record<string, unknown> = {};

    if (typeof messageIdOrRequest === "string") {
      messageId = messageIdOrRequest;
      ensureNonEmptyString(messageId, "messageId");
      ensureNonEmptyString(user, "user");
      payload.user = user;
      if (rating !== undefined && rating !== null) {
        ensureRating(rating);
        payload.rating = rating;
      }
      if (content !== undefined) {
        payload.content = content;
      }
    } else {
      const request = messageIdOrRequest;
      messageId = request.messageId;
      ensureNonEmptyString(messageId, "messageId");
      ensureNonEmptyString(request.user, "user");
      payload.user = request.user;
      if (request.rating !== undefined && request.rating !== null) {
        ensureRating(request.rating);
        payload.rating = request.rating;
      }
      if (request.content !== undefined) {
        payload.content = request.content;
      }
    }

    return this.http.request({
      method: "POST",
      path: `/messages/${messageId}/feedbacks`,
      data: payload,
    });
  }

  getInfo(user?: string): Promise<DifyResponse<unknown>> {
    if (user) {
      ensureNonEmptyString(user, "user");
    }
    return this.http.request({
      method: "GET",
      path: "/info",
      query: user ? { user } : undefined,
    });
  }

  getSite(user?: string): Promise<DifyResponse<unknown>> {
    if (user) {
      ensureNonEmptyString(user, "user");
    }
    return this.http.request({
      method: "GET",
      path: "/site",
      query: user ? { user } : undefined,
    });
  }

  fileUpload(form: unknown, user: string): Promise<DifyResponse<unknown>> {
    if (!isFormData(form)) {
      throw new FileUploadError("FormData is required for file uploads");
    }
    ensureNonEmptyString(user, "user");
    appendUserToFormData(form, user);
    return this.http.request({
      method: "POST",
      path: "/files/upload",
      data: form,
    });
  }

  filePreview(
    fileId: string,
    user: string,
    asAttachment?: boolean
  ): Promise<DifyResponse<Buffer>> {
    ensureNonEmptyString(fileId, "fileId");
    ensureNonEmptyString(user, "user");
    return this.http.request<Buffer>({
      method: "GET",
      path: `/files/${fileId}/preview`,
      query: {
        user,
        as_attachment: asAttachment ? "true" : undefined,
      },
      responseType: "arraybuffer",
    });
  }

  audioToText(form: unknown, user: string): Promise<DifyResponse<unknown>> {
    if (!isFormData(form)) {
      throw new FileUploadError("FormData is required for audio uploads");
    }
    ensureNonEmptyString(user, "user");
    appendUserToFormData(form, user);
    return this.http.request({
      method: "POST",
      path: "/audio-to-text",
      data: form,
    });
  }

  textToAudio(
    request: TextToAudioRequest
  ): Promise<DifyResponse<Buffer> | BinaryStream>;
  textToAudio(
    text: string,
    user: string,
    streaming?: boolean,
    voice?: string
  ): Promise<DifyResponse<Buffer> | BinaryStream>;
  textToAudio(
    textOrRequest: string | TextToAudioRequest,
    user?: string,
    streaming = false,
    voice?: string
  ): Promise<DifyResponse<Buffer> | BinaryStream> {
    let payload: TextToAudioRequest;

    if (typeof textOrRequest === "string") {
      ensureNonEmptyString(textOrRequest, "text");
      ensureNonEmptyString(user, "user");
      payload = {
        text: textOrRequest,
        user,
        streaming,
      };
      if (voice) {
        payload.voice = voice;
      }
    } else {
      payload = { ...textOrRequest };
      ensureNonEmptyString(payload.user, "user");
      if (payload.text !== undefined && payload.text !== null) {
        ensureNonEmptyString(payload.text, "text");
      }
      if (payload.message_id !== undefined && payload.message_id !== null) {
        ensureNonEmptyString(payload.message_id, "messageId");
      }
      if (!payload.text && !payload.message_id) {
        throw new ValidationError("text or message_id is required");
      }
      payload.streaming = payload.streaming ?? false;
    }

    if (payload.streaming) {
      return this.http.requestBinaryStream({
        method: "POST",
        path: "/text-to-audio",
        data: payload,
      });
    }

    return this.http.request<Buffer>({
      method: "POST",
      path: "/text-to-audio",
      data: payload,
      responseType: "arraybuffer",
    });
  }
}
