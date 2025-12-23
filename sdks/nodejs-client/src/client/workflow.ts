import { DifyClient } from "./base";
import type { WorkflowRunRequest, WorkflowRunResponse } from "../types/workflow";
import type { DifyResponse, DifyStream, QueryParams } from "../types/common";
import {
  ensureNonEmptyString,
  ensureOptionalInt,
  ensureOptionalString,
} from "./validation";

export class WorkflowClient extends DifyClient {
  run(
    request: WorkflowRunRequest
  ): Promise<DifyResponse<WorkflowRunResponse> | DifyStream<WorkflowRunResponse>>;
  run(
    inputs: Record<string, unknown>,
    user: string,
    stream?: boolean
  ): Promise<DifyResponse<WorkflowRunResponse> | DifyStream<WorkflowRunResponse>>;
  run(
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

  runById(
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

  getRun(workflowRunId: string): Promise<DifyResponse<WorkflowRunResponse>> {
    ensureNonEmptyString(workflowRunId, "workflowRunId");
    return this.http.request({
      method: "GET",
      path: `/workflows/run/${workflowRunId}`,
    });
  }

  stop(
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

  /**
   * Get workflow execution logs with filtering options.
   *
   * Note: The backend API filters by `createdByEndUserSessionId` (end user session ID)
   * or `createdByAccount` (account ID), not by a generic `user` parameter.
   */
  getLogs(options?: {
    keyword?: string;
    status?: string;
    createdAtBefore?: string;
    createdAtAfter?: string;
    createdByEndUserSessionId?: string;
    createdByAccount?: string;
    page?: number;
    limit?: number;
    startTime?: string;
    endTime?: string;
  }): Promise<DifyResponse<Record<string, unknown>>> {
    if (options?.keyword) {
      ensureOptionalString(options.keyword, "keyword");
    }
    if (options?.status) {
      ensureOptionalString(options.status, "status");
    }
    if (options?.createdAtBefore) {
      ensureOptionalString(options.createdAtBefore, "createdAtBefore");
    }
    if (options?.createdAtAfter) {
      ensureOptionalString(options.createdAtAfter, "createdAtAfter");
    }
    if (options?.createdByEndUserSessionId) {
      ensureOptionalString(
        options.createdByEndUserSessionId,
        "createdByEndUserSessionId"
      );
    }
    if (options?.createdByAccount) {
      ensureOptionalString(options.createdByAccount, "createdByAccount");
    }
    if (options?.startTime) {
      ensureOptionalString(options.startTime, "startTime");
    }
    if (options?.endTime) {
      ensureOptionalString(options.endTime, "endTime");
    }
    ensureOptionalInt(options?.page, "page");
    ensureOptionalInt(options?.limit, "limit");

    const createdAtAfter = options?.createdAtAfter ?? options?.startTime;
    const createdAtBefore = options?.createdAtBefore ?? options?.endTime;

    const query: QueryParams = {
      keyword: options?.keyword,
      status: options?.status,
      created_at__before: createdAtBefore,
      created_at__after: createdAtAfter,
      created_by_end_user_session_id: options?.createdByEndUserSessionId,
      created_by_account: options?.createdByAccount,
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
