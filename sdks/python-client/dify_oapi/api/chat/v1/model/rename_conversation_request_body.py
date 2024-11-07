from __future__ import annotations

from pydantic import BaseModel


class RenameConversationRequestBody(BaseModel):
    name: str | None = None
    auto_generate: bool | None = None
    user: str | None = None

    @staticmethod
    def builder() -> RenameConversationRequestBodyBuilder:
        return RenameConversationRequestBodyBuilder()


class RenameConversationRequestBodyBuilder:
    def __init__(self):
        self._rename_conversation_request_body = RenameConversationRequestBody()

    def builder(self) -> RenameConversationRequestBody:
        return self._rename_conversation_request_body

    def name(self, name: str) -> RenameConversationRequestBodyBuilder:
        self._rename_conversation_request_body.name = name
        return self

    def auto_generate(
        self, auto_generate: bool
    ) -> RenameConversationRequestBodyBuilder:
        self._rename_conversation_request_body.auto_generate = auto_generate
        return self

    def user(self, user: str) -> RenameConversationRequestBodyBuilder:
        self._rename_conversation_request_body.user = user
        return self
