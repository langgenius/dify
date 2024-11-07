from __future__ import annotations

from pydantic import BaseModel


class DeleteConversationRequestBody(BaseModel):
    user: str | None = None

    @staticmethod
    def builder() -> DeleteConversationRequestBodyBuilder:
        return DeleteConversationRequestBodyBuilder()


class DeleteConversationRequestBodyBuilder:
    def __init__(self):
        self._delete_conversation_request_body = DeleteConversationRequestBody()

    def user(self, user: str):
        self._delete_conversation_request_body.user = user
        return self

    def build(self) -> DeleteConversationRequestBody:
        return self._delete_conversation_request_body
