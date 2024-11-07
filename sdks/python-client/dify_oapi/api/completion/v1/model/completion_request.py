from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .completion_request_body import CompletionRequestBody


class CompletionRequest(BaseRequest):
    def __init__(self) -> None:
        super().__init__()
        self.request_body: CompletionRequestBody | None = None

    @staticmethod
    def builder() -> CompletionRequestBuilder:
        return CompletionRequestBuilder()


class CompletionRequestBuilder:
    def __init__(self) -> None:
        completion_request = CompletionRequest()
        completion_request.http_method = HttpMethod.POST
        completion_request.uri = "/v1/completion-messages"
        self._completion_request: CompletionRequest = completion_request

    def request_body(
        self, request_body: CompletionRequestBody
    ) -> CompletionRequestBuilder:
        self._completion_request.request_body = request_body
        self._completion_request.body = request_body.model_dump(exclude_none=True)
        return self

    def build(self) -> CompletionRequest:
        return self._completion_request
