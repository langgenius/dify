from __future__ import annotations

from pydantic import BaseModel


class StopCompletionRequestBody(BaseModel):
    user: str | None = None

    @staticmethod
    def builder() -> StopCompletionRequestBodyBuilder:
        return StopCompletionRequestBodyBuilder()


class StopCompletionRequestBodyBuilder:
    def __init__(self):
        self._stop_completion_request_body = StopCompletionRequestBody()

    def user(self, user: str) -> StopCompletionRequestBodyBuilder:
        self._stop_completion_request_body.user = user
        return self

    def build(self) -> StopCompletionRequestBody:
        return self._stop_completion_request_body
