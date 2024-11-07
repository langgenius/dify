from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .chat_request_body import ChatRequestBody


class ChatRequest(BaseRequest):
    def __init__(self) -> None:
        super().__init__()
        self.request_body: ChatRequestBody | None = None

    @staticmethod
    def builder() -> ChatRequestBuilder:
        return ChatRequestBuilder()


class ChatRequestBuilder:
    def __init__(self) -> None:
        chat_request = ChatRequest()
        chat_request.http_method = HttpMethod.POST
        chat_request.uri = "/v1/chat-messages"
        self._chat_request: ChatRequest = chat_request

    def request_body(self, request_body: ChatRequestBody) -> ChatRequestBuilder:
        self._chat_request.request_body = request_body
        self._chat_request.body = request_body.model_dump(exclude_none=True)
        return self

    def build(self) -> ChatRequest:
        return self._chat_request
