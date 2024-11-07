from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class MessageHistoryRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.conversation_id: str | None = None
        self.user: str | None = None
        self.first_id: str | None = None
        self.limit: int | None = None

    @staticmethod
    def builder() -> MessageHistoryRequestBuilder:
        return MessageHistoryRequestBuilder()


class MessageHistoryRequestBuilder:
    def __init__(self):
        message_history_request = MessageHistoryRequest()
        message_history_request.http_method = HttpMethod.GET
        message_history_request.uri = "/v1/messages"
        self._message_history_request = message_history_request

    def build(self) -> MessageHistoryRequest:
        return self._message_history_request

    def conversation_id(self, conversation_id: str):
        self._message_history_request.conversation_id = conversation_id
        self._message_history_request.add_query("conversation_id", conversation_id)
        return self

    def user(self, user: str):
        self._message_history_request.user = user
        self._message_history_request.add_query("user", user)
        return self

    def first_id(self, first_id: str):
        self._message_history_request.first_id = first_id
        self._message_history_request.add_query("first_id", first_id)
        return self

    def limit(self, limit: int):
        self._message_history_request.limit = limit
        self._message_history_request.add_query("limit", limit)
        return self
