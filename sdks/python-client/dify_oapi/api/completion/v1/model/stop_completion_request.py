from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .stop_completion_request_body import StopCompletionRequestBody


class StopCompletionRequest(BaseRequest):
    def __init__(self) -> None:
        super().__init__()
        self.task_id: str | None = None
        self.request_body: StopCompletionRequestBody | None = None

    @staticmethod
    def builder() -> StopCompletionRequestBuilder:
        return StopCompletionRequestBuilder()


class StopCompletionRequestBuilder:
    def __init__(self) -> None:
        stop_completion_request = StopCompletionRequest()
        stop_completion_request.http_method = HttpMethod.POST
        stop_completion_request.uri = "/v1/completion-messages/:task_id/stop"
        self._stop_completion_request: StopCompletionRequest = stop_completion_request

    def task_id(self, task_id: str) -> StopCompletionRequestBuilder:
        self._stop_completion_request.task_id = task_id
        self._stop_completion_request.paths["task_id"] = str(task_id)
        return self

    def request_body(
        self, request_body: StopCompletionRequestBody
    ) -> StopCompletionRequestBuilder:
        self._stop_completion_request.request_body = request_body
        self._stop_completion_request.body = request_body.model_dump(exclude_none=True)
        return self

    def build(self) -> StopCompletionRequest:
        return self._stop_completion_request
