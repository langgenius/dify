from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest


class GetConversationListRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.user: str | None = None
        self.last_id: str | None = None
        self.limit: int | None = None
        self.pinned: bool | None = None

    @staticmethod
    def builder() -> GetConversationListRequestBuilder:
        return GetConversationListRequestBuilder()


class GetConversationListRequestBuilder:
    def __init__(self):
        get_conversation_list_request = GetConversationListRequest()
        get_conversation_list_request.http_method = HttpMethod.GET
        get_conversation_list_request.uri = "/v1/conversations"
        self._get_conversation_list_request = get_conversation_list_request

    def user(self, user: str) -> GetConversationListRequestBuilder:
        self._get_conversation_list_request.user = user
        self._get_conversation_list_request.add_query("user", user)
        return self

    def last_id(self, last_id: str) -> GetConversationListRequestBuilder:
        self._get_conversation_list_request.last_id = last_id
        self._get_conversation_list_request.add_query("last_id", last_id)
        return self

    def limit(self, limit: int) -> GetConversationListRequestBuilder:
        self._get_conversation_list_request.limit = limit
        self._get_conversation_list_request.add_query("limit", limit)
        return self

    def pinned(self, pinned: bool) -> GetConversationListRequestBuilder:
        self._get_conversation_list_request.pinned = pinned
        self._get_conversation_list_request.add_query("pinned", str(pinned).lower())
        return self

    def build(self) -> GetConversationListRequest:
        return self._get_conversation_list_request
