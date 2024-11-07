from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .stop_chat_request_body import StopChatRequestBody


class StopChatRequest(BaseRequest):
    def __init__(self) -> None:
        super().__init__()
        self.task_id: str | None = None
        self.request_body: StopChatRequestBody | None = None

    @staticmethod
    def builder() -> StopChatRequestBuilder:
        return StopChatRequestBuilder()


class StopChatRequestBuilder:
    def __init__(self) -> None:
        stop_chat_request = StopChatRequest()
        stop_chat_request.http_method = HttpMethod.POST
        stop_chat_request.uri = "/v1/chat-messages/:task_id/stop"
        self._stop_chat_request: StopChatRequest = stop_chat_request

    def task_id(self, task_id: str) -> StopChatRequestBuilder:
        self._stop_chat_request.task_id = task_id
        self._stop_chat_request.paths["task_id"] = str(task_id)
        return self

    def request_body(self, request_body: StopChatRequestBody) -> StopChatRequestBuilder:
        self._stop_chat_request.request_body = request_body
        self._stop_chat_request.body = request_body.model_dump(exclude_none=True)
        return self

    def build(self) -> StopChatRequest:
        return self._stop_chat_request
