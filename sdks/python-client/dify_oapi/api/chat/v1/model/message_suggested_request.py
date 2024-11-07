from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class MessageSuggestedRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.message_id: str | None = None
        self.user: str | None = None

    @staticmethod
    def builder() -> MessageSuggestedRequestBuilder:
        return MessageSuggestedRequestBuilder()


class MessageSuggestedRequestBuilder:
    def __init__(self):
        message_suggested_request = MessageSuggestedRequest()
        message_suggested_request.http_method = HttpMethod.GET
        message_suggested_request.uri = "/v1/messages/:message_id/suggested"
        self._message_suggested_request = message_suggested_request

    def build(self) -> MessageSuggestedRequest:
        return self._message_suggested_request

    def message_id(self, message_id: str):
        self._message_suggested_request.message_id = message_id
        self._message_suggested_request.paths["message_id"] = message_id
        return self

    def user(self, user: str):
        self._message_suggested_request.user = user
        self._message_suggested_request.add_query("user", user)
        return self
