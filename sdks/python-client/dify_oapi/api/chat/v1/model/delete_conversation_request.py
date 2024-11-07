from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from .delete_conversation_request_body import DeleteConversationRequestBody


class DeleteConversationRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.conversation_id: str | None = None
        self.request_body: DeleteConversationRequestBody | None = None

    @staticmethod
    def builder() -> DeleteConversationRequestBuilder:
        return DeleteConversationRequestBuilder()


class DeleteConversationRequestBuilder:
    def __init__(self):
        delete_conversation_request = DeleteConversationRequest()
        delete_conversation_request.http_method = HttpMethod.DELETE
        delete_conversation_request.uri = "/v1/conversations/:conversation_id"
        self._delete_conversation_request = delete_conversation_request

    def request_body(
        self, request_body: DeleteConversationRequestBody
    ) -> DeleteConversationRequestBuilder:
        self._delete_conversation_request.request_body = request_body
        self._delete_conversation_request.body = request_body.model_dump(
            exclude_none=True
        )
        return self

    def conversation_id(self, conversation_id: str) -> DeleteConversationRequestBuilder:
        self._delete_conversation_request.conversation_id = conversation_id
        self._delete_conversation_request.paths["conversation_id"] = conversation_id
        return self

    def build(self) -> DeleteConversationRequest:
        return self._delete_conversation_request
