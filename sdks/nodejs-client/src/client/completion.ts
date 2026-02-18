import { DifyClient } from "./base";
import type { CompletionRequest, CompletionResponse } from "../types/completion";
import type { DifyResponse, DifyStream } from "../types/common";
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
    inputs: Record<string, unknown>,
    user: string,
    stream?: boolean,
    files?: Array<Record<string, unknown>> | null
  ): Promise<DifyResponse<CompletionResponse> | DifyStream<CompletionResponse>>;
  createCompletionMessage(
    inputOrRequest: CompletionRequest | Record<string, unknown>,
    user?: string,
    stream = false,
    files?: Array<Record<string, unknown>> | null
  ): Promise<DifyResponse<CompletionResponse> | DifyStream<CompletionResponse>> {
    let payload: CompletionRequest;
    let shouldStream = stream;

    if (user === undefined && "user" in (inputOrRequest as CompletionRequest)) {
      payload = inputOrRequest as CompletionRequest;
      shouldStream = payload.response_mode === "streaming";
    } else {
      ensureNonEmptyString(user, "user");
      payload = {
        inputs: inputOrRequest as Record<string, unknown>,
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
  ): Promise<DifyResponse<CompletionResponse>> {
    ensureNonEmptyString(taskId, "taskId");
    ensureNonEmptyString(user, "user");
    return this.http.request<CompletionResponse>({
      method: "POST",
      path: `/completion-messages/${taskId}/stop`,
      data: { user },
    });
  }

  stop(
    taskId: string,
    user: string
  ): Promise<DifyResponse<CompletionResponse>> {
    return this.stopCompletionMessage(taskId, user);
  }

  runWorkflow(
    inputs: Record<string, unknown>,
    user: string,
    stream = false
  ): Promise<DifyResponse<Record<string, unknown>> | DifyStream<Record<string, unknown>>> {
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
      return this.http.requestStream<Record<string, unknown>>({
        method: "POST",
        path: "/workflows/run",
        data: payload,
      });
    }
    return this.http.request<Record<string, unknown>>({
      method: "POST",
      path: "/workflows/run",
      data: payload,
    });
  }
}
