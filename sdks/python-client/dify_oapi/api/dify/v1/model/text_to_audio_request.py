from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest
from .text_to_audio_request_body import TextToAudioRequestBody


class TextToAudioRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.request_body: TextToAudioRequestBody | None = None

    @staticmethod
    def builder() -> TextToAudioRequestBuilder:
        return TextToAudioRequestBuilder()


class TextToAudioRequestBuilder(object):
    def __init__(self):
        text_to_audio_request = TextToAudioRequest()
        text_to_audio_request.http_method = HttpMethod.POST
        text_to_audio_request.uri = "/v1/text-to-audio"
        self._text_to_audio_request = text_to_audio_request

    def build(self) -> TextToAudioRequest:
        return self._text_to_audio_request

    def request_body(
        self, request_body: TextToAudioRequestBody
    ) -> TextToAudioRequestBuilder:
        self._text_to_audio_request.request_body = request_body
        self._text_to_audio_request.body = request_body.model_dump(exclude_none=True)
        return self
