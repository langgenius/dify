from __future__ import annotations
from pydantic import BaseModel


class TextToAudioRequestBody(BaseModel):
    message_id: str | None = None
    text: str | None = None
    user: str | None = None

    @staticmethod
    def builder() -> TextToAudioRequestBodyBuilder:
        return TextToAudioRequestBodyBuilder()


class TextToAudioRequestBodyBuilder(object):
    def __init__(self):
        self._text_to_audio_request_body = TextToAudioRequestBody()

    def build(self) -> TextToAudioRequestBody:
        return self._text_to_audio_request_body

    def message_id(self, message_id: str) -> TextToAudioRequestBodyBuilder:
        self._text_to_audio_request_body.message_id = message_id
        return self

    def text(self, text: str) -> TextToAudioRequestBodyBuilder:
        self._text_to_audio_request_body.text = text
        return self

    def user(self, user: str) -> TextToAudioRequestBodyBuilder:
        self._text_to_audio_request_body.user = user
        return self
