from __future__ import annotations

from io import BytesIO

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .audio_to_text_request_body import AudioToTextRequestBody


class AudioToTextRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.file: BytesIO | None = None
        self.request_body: AudioToTextRequestBody | None = None

    @staticmethod
    def builder() -> AudioToTextRequestBuilder:
        return AudioToTextRequestBuilder()


class AudioToTextRequestBuilder(object):
    def __init__(self):
        audio_to_text_request = AudioToTextRequest()
        audio_to_text_request.http_method = HttpMethod.POST
        audio_to_text_request.uri = "/v1/audio-to-text"
        self._audio_to_text_request = audio_to_text_request

    def build(self) -> AudioToTextRequest:
        return self._audio_to_text_request

    def request_body(
        self, request_body: AudioToTextRequestBody
    ) -> AudioToTextRequestBuilder:
        self._audio_to_text_request.request_body = request_body
        self._audio_to_text_request.body = request_body.model_dump(exclude_none=True)
        return self

    def file(self, file: BytesIO, file_name: str) -> AudioToTextRequestBuilder:
        self._audio_to_text_request.file = file
        self._audio_to_text_request.files = {"file": (file_name, file)}
        return self
