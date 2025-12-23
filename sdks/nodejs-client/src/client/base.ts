import type {
  BinaryStream,
  DifyClientConfig,
  DifyResponse,
  QueryParams,
  RequestMethod,
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

  getApplicationParameters(user: string): Promise<DifyResponse<unknown>> {
    ensureNonEmptyString(user, "user");
    return this.http.request({
      method: "GET",
      path: "/parameters",
      query: { user },
    });
  }

  async getParameters(user: string): Promise<DifyResponse<unknown>> {
    return this.getApplicationParameters(user);
  }

  getMeta(user: string): Promise<DifyResponse<unknown>> {
    ensureNonEmptyString(user, "user");
    return this.http.request({
      method: "GET",
      path: "/meta",
      query: { user },
    });
  }

  messageFeedback(
    messageId: string,
    rating: "like" | "dislike" | number,
    user: string,
    content?: string
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(messageId, "messageId");
    ensureNonEmptyString(user, "user");
    let normalizedRating: "like" | "dislike";
    if (typeof rating === "number") {
      if (rating === 1) {
        normalizedRating = "like";
      } else if (rating === 0) {
        normalizedRating = "dislike";
      } else {
        throw new ValidationError("rating must be 'like' or 'dislike'");
      }
    } else {
      ensureRating(rating);
      normalizedRating = rating;
    }

    const payload: Record<string, unknown> = {
      rating: normalizedRating,
      user,
    };
    if (content) {
      payload.content = content;
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

  fileUpload(form: unknown, user?: string): Promise<DifyResponse<unknown>> {
    if (!isFormData(form)) {
      throw new FileUploadError("FormData is required for file uploads");
    }
    if (user) {
      ensureNonEmptyString(user, "user");
      appendUserToFormData(form, user);
    }
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

  audioToText(form: unknown, user?: string): Promise<DifyResponse<unknown>> {
    if (!isFormData(form)) {
      throw new FileUploadError("FormData is required for audio uploads");
    }
    if (user) {
      ensureNonEmptyString(user, "user");
      appendUserToFormData(form, user);
    }
    return this.http.request({
      method: "POST",
      path: "/audio-to-text",
      data: form,
    });
  }

  textToAudio(
    text: string,
    user: string,
    streaming = false,
    voice?: string
  ): Promise<DifyResponse<Buffer> | BinaryStream> {
    ensureNonEmptyString(text, "text");
    ensureNonEmptyString(user, "user");
    const payload: Record<string, unknown> = {
      text,
      user,
      streaming,
    };
    if (voice) {
      payload.voice = voice;
    }

    if (streaming) {
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
