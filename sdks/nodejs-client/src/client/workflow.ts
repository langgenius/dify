import { DifyClient } from "./base";
import { WorkflowRunRequest, WorkflowRunResponse } from "../types/workflow";
import { DifyResponse, DifyStream, QueryParams } from "../types/common";
import {
  ensureNonEmptyString,
  ensureOptionalInt,
  ensureOptionalString,
} from "./validation";

export class WorkflowClient extends DifyClient {
  async run(
    request: WorkflowRunRequest
  ): Promise<DifyResponse<WorkflowRunResponse>>;
  async run(
    inputs: Record<string, unknown>,
    user: string,
    stream?: boolean
  ): Promise<DifyResponse<WorkflowRunResponse> | DifyStream<WorkflowRunResponse>>;
  async run(
    inputOrRequest: WorkflowRunRequest | Record<string, unknown>,
    user?: string,
    stream = false
  ): Promise<DifyResponse<WorkflowRunResponse> | DifyStream<WorkflowRunResponse>> {
    let payload: WorkflowRunRequest;
    let shouldStream = stream;

    if (user === undefined && "user" in (inputOrRequest as WorkflowRunRequest)) {
      payload = inputOrRequest as WorkflowRunRequest;
      shouldStream = payload.response_mode === "streaming";
    } else {
      ensureNonEmptyString(user, "user");
      payload = {
        inputs: inputOrRequest as Record<string, unknown>,
        user,
        response_mode: stream ? "streaming" : "blocking",
      };
    }

    ensureNonEmptyString(payload.user, "user");

    if (shouldStream) {
      return this.http.requestStream<WorkflowRunResponse>({
        method: "POST",
        path: "/workflows/run",
        data: payload,
      });
    }

    return this.http.request<WorkflowRunResponse>({
      method: "POST",
      path: "/workflows/run",
      data: payload,
    });
  }

  async runById(
    workflowId: string,
    request: WorkflowRunRequest
  ): Promise<DifyResponse<WorkflowRunResponse> | DifyStream<WorkflowRunResponse>> {
    ensureNonEmptyString(workflowId, "workflowId");
    ensureNonEmptyString(request.user, "user");
    if (request.response_mode === "streaming") {
      return this.http.requestStream<WorkflowRunResponse>({
        method: "POST",
        path: `/workflows/${workflowId}/run`,
        data: request,
      });
    }
    return this.http.request<WorkflowRunResponse>({
      method: "POST",
      path: `/workflows/${workflowId}/run`,
      data: request,
    });
  }

  async getRun(workflowRunId: string): Promise<DifyResponse<WorkflowRunResponse>> {
    ensureNonEmptyString(workflowRunId, "workflowRunId");
    return this.http.request({
      method: "GET",
      path: `/workflows/run/${workflowRunId}`,
    });
  }

  async stop(
    taskId: string,
    user: string
  ): Promise<DifyResponse<WorkflowRunResponse>> {
    ensureNonEmptyString(taskId, "taskId");
    ensureNonEmptyString(user, "user");
    return this.http.request<WorkflowRunResponse>({
      method: "POST",
      path: `/workflows/tasks/${taskId}/stop`,
      data: { user },
    });
  }

  async getLogs(
    user: string,
    options?: {
      keyword?: string;
      status?: string;
      startTime?: string;
      endTime?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<DifyResponse<Record<string, unknown>>> {
    ensureNonEmptyString(user, "user");
    if (options?.keyword) {
      ensureOptionalString(options.keyword, "keyword");
    }
    if (options?.status) {
      ensureOptionalString(options.status, "status");
    }
    if (options?.startTime) {
      ensureOptionalString(options.startTime, "startTime");
    }
    if (options?.endTime) {
      ensureOptionalString(options.endTime, "endTime");
    }
    ensureOptionalInt(options?.page, "page");
    ensureOptionalInt(options?.limit, "limit");

    const query: QueryParams = {
      user,
      keyword: options?.keyword,
      status: options?.status,
      start_time: options?.startTime,
      end_time: options?.endTime,
      page: options?.page,
      limit: options?.limit,
    };

    return this.http.request({
      method: "GET",
      path: "/workflows/logs",
      query,
    });
  }
}
