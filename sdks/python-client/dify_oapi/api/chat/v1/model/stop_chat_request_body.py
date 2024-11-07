from __future__ import annotations

from pydantic import BaseModel


class StopChatRequestBody(BaseModel):
    user: str | None = None

    @staticmethod
    def builder() -> StopChatRequestBodyBuilder:
        return StopChatRequestBodyBuilder()


class StopChatRequestBodyBuilder:
    def __init__(self):
        self._stop_chat_request_body = StopChatRequestBody()

    def user(self, user: str) -> StopChatRequestBodyBuilder:
        self._stop_chat_request_body.user = user
        return self

    def build(self) -> StopChatRequestBody:
        return self._stop_chat_request_body
