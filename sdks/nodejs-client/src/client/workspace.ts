import { DifyClient } from "./base";
import type { WorkspaceModelType, WorkspaceModelsResponse } from "../types/workspace";
import type { DifyResponse } from "../types/common";
import { ensureNonEmptyString } from "./validation";

export class WorkspaceClient extends DifyClient {
  async getModelsByType(
    modelType: WorkspaceModelType
  ): Promise<DifyResponse<WorkspaceModelsResponse>> {
    ensureNonEmptyString(modelType, "modelType");
    return this.http.request({
      method: "GET",
      path: `/workspaces/current/models/model-types/${modelType}`,
    });
  }
}
