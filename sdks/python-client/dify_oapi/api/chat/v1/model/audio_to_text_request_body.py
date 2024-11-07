from __future__ import annotations

from pydantic import BaseModel


class AudioToTextRequestBody(BaseModel):
    user: str | None = None

    @staticmethod
    def builder() -> AudioToTextRequestBodyBuilder:
        return AudioToTextRequestBodyBuilder()


class AudioToTextRequestBodyBuilder(object):
    def __init__(self):
        self._audio_to_text_request_body = AudioToTextRequestBody()

    def build(self) -> AudioToTextRequestBody:
        return self._audio_to_text_request_body

    def user(self, user: str) -> AudioToTextRequestBodyBuilder:
        self._audio_to_text_request_body.user = user
        return self
