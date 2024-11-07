from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class GetWorkflowResultRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.workflow_id: str | None = None

    @staticmethod
    def builder() -> GetWorkflowResultRequestBuilder:
        return GetWorkflowResultRequestBuilder()


class GetWorkflowResultRequestBuilder(object):
    def __init__(self):
        get_workflow_request = GetWorkflowResultRequest()
        get_workflow_request.http_method = HttpMethod.GET
        get_workflow_request.uri = "/v1/workflows/run/:workflow_id"
        self._get_workflow_request = get_workflow_request

    def build(self):
        return self._get_workflow_request

    def workflow_id(self, workflow_id: str) -> GetWorkflowResultRequestBuilder:
        self._get_workflow_request.workflow_id = workflow_id
        self._get_workflow_request.paths["workflow_id"] = workflow_id
        return self
