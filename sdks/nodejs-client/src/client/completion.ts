import { DifyClient } from "./base";
import type { CompletionRequest, CompletionResponse } from "../types/completion";
import type {
  DifyResponse,
  DifyStream,
  JsonObject,
  SuccessResponse,
} from "../types/common";
import { ensureNonEmptyString } from "./validation";

const warned = new Set<string>();
const warnOnce = (message: string): void => {
  if (warned.has(message)) {
    return;
  }
  warned.add(message);
  console.warn(message);
};

export class CompletionClient extends DifyClient {
  createCompletionMessage(
    request: CompletionRequest
  ): Promise<DifyResponse<CompletionResponse> | DifyStream<CompletionResponse>>;
  createCompletionMessage(
    inputs: JsonObject,
    user: string,
    stream?: boolean,
    files?: CompletionRequest["files"]
  ): Promise<DifyResponse<CompletionResponse> | DifyStream<CompletionResponse>>;
  createCompletionMessage(
    inputOrRequest: CompletionRequest | JsonObject,
    user?: string,
    stream = false,
    files?: CompletionRequest["files"]
  ): Promise<DifyResponse<CompletionResponse> | DifyStream<CompletionResponse>> {
    let payload: CompletionRequest;
    let shouldStream = stream;

    if (user === undefined && "user" in (inputOrRequest as CompletionRequest)) {
      payload = inputOrRequest as CompletionRequest;
      shouldStream = payload.response_mode === "streaming";
    } else {
      ensureNonEmptyString(user, "user");
      payload = {
        inputs: inputOrRequest,
        user,
        files,
        response_mode: stream ? "streaming" : "blocking",
      };
    }

    ensureNonEmptyString(payload.user, "user");

    if (shouldStream) {
      return this.http.requestStream<CompletionResponse>({
        method: "POST",
        path: "/completion-messages",
        data: payload,
      });
    }

    return this.http.request<CompletionResponse>({
      method: "POST",
      path: "/completion-messages",
      data: payload,
    });
  }

  stopCompletionMessage(
    taskId: string,
    user: string
  ): Promise<DifyResponse<SuccessResponse>> {
    ensureNonEmptyString(taskId, "taskId");
    ensureNonEmptyString(user, "user");
    return this.http.request<SuccessResponse>({
      method: "POST",
      path: `/completion-messages/${taskId}/stop`,
      data: { user },
    });
  }

  stop(
    taskId: string,
    user: string
  ): Promise<DifyResponse<SuccessResponse>> {
    return this.stopCompletionMessage(taskId, user);
  }

  runWorkflow(
    inputs: JsonObject,
    user: string,
    stream = false
  ): Promise<DifyResponse<JsonObject> | DifyStream<JsonObject>> {
    warnOnce(
      "CompletionClient.runWorkflow is deprecated. Use WorkflowClient.run instead."
    );
    ensureNonEmptyString(user, "user");
    const payload = {
      inputs,
      user,
      response_mode: stream ? "streaming" : "blocking",
    };
    if (stream) {
      return this.http.requestStream<JsonObject>({
        method: "POST",
        path: "/workflows/run",
        data: payload,
      });
    }
    return this.http.request<JsonObject>({
      method: "POST",
      path: "/workflows/run",
      data: payload,
    });
  }
}
