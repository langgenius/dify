from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .rename_conversation_request_body import RenameConversationRequestBody


class RenameConversationRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.conversation_id: str | None = None
        self.request_body: RenameConversationRequestBody | None = None

    @staticmethod
    def builder() -> RenameConversationRequestBuilder:
        return RenameConversationRequestBuilder()


class RenameConversationRequestBuilder:
    def __init__(self):
        rename_conversation_request = RenameConversationRequest()
        rename_conversation_request.http_method = HttpMethod.POST
        rename_conversation_request.uri = "/v1/conversations/:conversation_id/name"
        self._rename_conversation_request = rename_conversation_request

    def build(self) -> RenameConversationRequest:
        return self._rename_conversation_request

    def request_body(
        self, request_body: RenameConversationRequestBody
    ) -> RenameConversationRequestBuilder:
        self._rename_conversation_request.request_body = request_body
        self._rename_conversation_request.body = request_body.model_dump(
            exclude_none=True
        )
        return self

    def conversation_id(self, conversation_id: str) -> RenameConversationRequestBuilder:
        self._rename_conversation_request.conversation_id = conversation_id
        self._rename_conversation_request.paths["conversation_id"] = conversation_id
        return self
