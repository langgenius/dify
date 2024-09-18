import re
from typing import Any, Literal, Union

from openai._types import NOT_GIVEN, FileTypes, NotGiven
from openai.resources.audio.transcriptions import Transcriptions
from openai.types.audio.transcription import Transcription

from core.model_runtime.errors.invoke import InvokeAuthorizationError


class MockSpeech2TextClass:
    def speech2text_create(
        self: Transcriptions,
        *,
        file: FileTypes,
        model: Union[str, Literal["whisper-1"]],
        language: str | NotGiven = NOT_GIVEN,
        prompt: str | NotGiven = NOT_GIVEN,
        response_format: Literal["json", "text", "srt", "verbose_json", "vtt"] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        **kwargs: Any,
    ) -> Transcription:
        if not re.match(r"^(https?):\/\/[^\s\/$.?#].[^\s]*$", str(self._client.base_url)):
            raise InvokeAuthorizationError("Invalid base url")

        if len(self._client.api_key) < 18:
            raise InvokeAuthorizationError("Invalid API key")

        return Transcription(text="1, 2, 3, 4, 5, 6, 7, 8, 9, 10")
