from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .stop_workflow_request_body import StopWorkflowRequestBody


class StopWorkflowRequest(BaseRequest):
    def __init__(self) -> None:
        super().__init__()
        self.task_id: str | None = None
        self.request_body: StopWorkflowRequestBody | None = None

    @staticmethod
    def builder() -> StopWorkflowRequestBuilder:
        return StopWorkflowRequestBuilder()


class StopWorkflowRequestBuilder:
    def __init__(self) -> None:
        stop_Workflow_request = StopWorkflowRequest()
        stop_Workflow_request.http_method = HttpMethod.POST
        stop_Workflow_request.uri = "/v1/workflows/tasks/:task_id/stop"
        self._stop_workflow_request: StopWorkflowRequest = stop_Workflow_request

    def task_id(self, task_id: str) -> StopWorkflowRequestBuilder:
        self._stop_workflow_request.task_id = task_id
        self._stop_workflow_request.paths["task_id"] = str(task_id)
        return self

    def request_body(
        self, request_body: StopWorkflowRequestBody
    ) -> StopWorkflowRequestBuilder:
        self._stop_workflow_request.request_body = request_body
        self._stop_workflow_request.body = request_body.model_dump(exclude_none=True)
        return self

    def build(self) -> StopWorkflowRequest:
        return self._stop_workflow_request
