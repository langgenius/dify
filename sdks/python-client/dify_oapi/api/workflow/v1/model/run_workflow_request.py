from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .run_workflow_request_body import RunWorkflowRequestBody


class RunWorkflowRequest(BaseRequest):
    def __init__(self) -> None:
        super().__init__()
        self.request_body: RunWorkflowRequestBody | None = None

    @staticmethod
    def builder() -> RunWorkflowRequestBuilder:
        return RunWorkflowRequestBuilder()


class RunWorkflowRequestBuilder:
    def __init__(self) -> None:
        run_workflow_request = RunWorkflowRequest()
        run_workflow_request.http_method = HttpMethod.POST
        run_workflow_request.uri = "/v1/workflows/run"
        self._run_workflow_request: RunWorkflowRequest = run_workflow_request

    def request_body(
        self, request_body: RunWorkflowRequestBody
    ) -> RunWorkflowRequestBuilder:
        self._run_workflow_request.request_body = request_body
        self._run_workflow_request.body = request_body.model_dump(exclude_none=True)
        return self

    def build(self) -> RunWorkflowRequest:
        return self._run_workflow_request
