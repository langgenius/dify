from __future__ import annotations

from pydantic import BaseModel


class CompletionRequestBodyInput(BaseModel):
    query: str | None = None

    @staticmethod
    def builder() -> CompletionRequestBodyInputBuilder:
        return CompletionRequestBodyInputBuilder()


class CompletionRequestBodyInputBuilder:
    def __init__(self):
        self._completion_request_body_input = CompletionRequestBodyInput()

    def build(self) -> CompletionRequestBodyInput:
        if self._completion_request_body_input.query is None:
            raise ValueError("CompletionRequestBodyInput.query is None")
        return self._completion_request_body_input

    def query(self, query: str):
        self._completion_request_body_input.query = query
        return self
