from __future__ import annotations

from pydantic import BaseModel

from .chat_request_file import ChatRequestFile


class ChatRequestBody(BaseModel):
    query: str | None = None
    inputs: dict | None = None
    response_mode: str | None = None
    user: str | None = None
    conversation_id: str | None = None
    files: list[ChatRequestFile] | None = None
    auto_generate_name: bool | None = None

    @staticmethod
    def builder() -> ChatRequestBodyBuilder:
        return ChatRequestBodyBuilder()


class ChatRequestBodyBuilder:
    def __init__(self):
        self._chat_request_body = ChatRequestBody()

    def query(self, query: str) -> ChatRequestBodyBuilder:
        self._chat_request_body.query = query
        return self

    def inputs(self, inputs: dict) -> ChatRequestBodyBuilder:
        self._chat_request_body.inputs = inputs
        return self

    def response_mode(self, response_mode: str) -> ChatRequestBodyBuilder:
        if response_mode not in ["streaming", "blocking"]:
            raise ValueError('response_mode must be either "streaming" or "blocking"')
        self._chat_request_body.response_mode = response_mode
        return self

    def user(self, user: str) -> ChatRequestBodyBuilder:
        self._chat_request_body.user = user
        return self

    def conversation_id(self, conversation_id: str) -> ChatRequestBodyBuilder:
        self._chat_request_body.conversation_id = conversation_id
        return self

    def files(self, files: list[ChatRequestFile]) -> ChatRequestBodyBuilder:
        self._chat_request_body.files = files
        return self

    def auto_generate_name(self, auto_generate_name: bool) -> ChatRequestBodyBuilder:
        self._chat_request_body.auto_generate_name = auto_generate_name
        return self

    def build(self):
        return self._chat_request_body
