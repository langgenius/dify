from __future__ import annotations

from typing_extensions import Literal

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class GetWorkflowLogRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.keyword: str | None = None
        self.status: str | None = None
        self.page: int | None = None
        self.limit: int | None = None

    @staticmethod
    def builder() -> GetWorkflowLogRequestBuilder:
        return GetWorkflowLogRequestBuilder()


class GetWorkflowLogRequestBuilder:
    def __init__(self):
        get_workflow_log_request = GetWorkflowLogRequest()
        get_workflow_log_request.http_method = HttpMethod.GET
        get_workflow_log_request.uri = "/v1/workflows/logs"
        self._get_workflow_log_request = get_workflow_log_request

    def build(self):
        return self._get_workflow_log_request

    def keyword(self, keyword: str) -> GetWorkflowLogRequestBuilder:
        self._get_workflow_log_request.keyword = keyword
        self._get_workflow_log_request.add_query("keyword", keyword)
        return self

    def status(self, status: Literal["succeeded", "failed", "stopped"]) -> GetWorkflowLogRequestBuilder:
        self._get_workflow_log_request.status = status
        self._get_workflow_log_request.add_query("status", status)
        return self

    def page(self, page: int) -> GetWorkflowLogRequestBuilder:
        self._get_workflow_log_request.page = page
        self._get_workflow_log_request.add_query("page", page)
        return self

    def limit(self, limit: int) -> GetWorkflowLogRequestBuilder:
        self._get_workflow_log_request.limit = limit
        self._get_workflow_log_request.add_query("limit", limit)
        return self
