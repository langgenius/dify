from openai.resources.audio.transcriptions import Transcriptions
from openai._types import NotGiven, NOT_GIVEN, FileTypes
from openai.types.audio.transcription import Transcription

from typing import Union, List, Literal, Any

from core.model_runtime.errors.invoke import InvokeAuthorizationError

import re

class MockSpeech2TextClass(object):
    def speech2text_create(self: Transcriptions,
        *,
        file: FileTypes,
        model: Union[str, Literal["whisper-1"]],
        language: str | NotGiven = NOT_GIVEN,
        prompt: str | NotGiven = NOT_GIVEN,
        response_format: Literal["json", "text", "srt", "verbose_json", "vtt"] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        **kwargs: Any
    ) -> Transcription:
        if not re.match(r'^(https?):\/\/[^\s\/$.?#].[^\s]*$', self._client.base_url.__str__()):
            raise InvokeAuthorizationError('Invalid base url')
        
        if len(self._client.api_key) < 18:
            raise InvokeAuthorizationError('Invalid API key')
        
        return Transcription(
            text='1, 2, 3, 4, 5, 6, 7, 8, 9, 10'
        )