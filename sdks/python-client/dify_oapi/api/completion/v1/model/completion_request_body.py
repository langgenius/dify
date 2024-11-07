from __future__ import annotations

from pydantic import BaseModel

from .completion_request_body_input import CompletionRequestBodyInput
from .completion_request_file import CompletionRequestFile


class CompletionRequestBody(BaseModel):
    inputs: CompletionRequestBodyInput | None = None
    response_mode: str | None = None
    user: str | None = None
    files: list[CompletionRequestFile] | None = None

    @staticmethod
    def builder() -> CompletionRequestBodyBuilder:
        return CompletionRequestBodyBuilder()


class CompletionRequestBodyBuilder:
    def __init__(self):
        self._completion_request_body = CompletionRequestBody()

    def inputs(
        self, inputs: CompletionRequestBodyInput
    ) -> CompletionRequestBodyBuilder:
        self._completion_request_body.inputs = inputs.model_dump(exclude_none=True)
        return self

    def response_mode(self, response_mode: str) -> CompletionRequestBodyBuilder:
        if response_mode not in ["streaming", "blocking"]:
            raise ValueError('response_mode must be either "streaming" or "blocking"')
        self._completion_request_body.response_mode = response_mode
        return self

    def user(self, user: str) -> CompletionRequestBodyBuilder:
        self._completion_request_body.user = user
        return self

    def files(self, files: list[CompletionRequestFile]) -> CompletionRequestBodyBuilder:
        self._completion_request_body.files = files
        return self

    def build(self):
        return self._completion_request_body
