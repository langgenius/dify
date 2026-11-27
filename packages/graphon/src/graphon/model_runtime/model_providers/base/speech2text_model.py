from collections.abc import Mapping
from typing import IO

from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.model_providers.base.ai_model import AIModel
from graphon.model_runtime.protocols.speech_to_text_runtime import (
    SpeechToTextModelRuntime,
)


class Speech2TextModel(AIModel[SpeechToTextModelRuntime]):
    """Model class for speech2text model."""

    model_type: ModelType = ModelType.SPEECH2TEXT

    def invoke(
        self,
        model: str,
        credentials: dict,
        file: IO[bytes],
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> str:
        """Invoke the speech-to-text model and return the transcribed text."""
        try:
            return self.model_runtime.invoke_speech_to_text(
                provider=self.provider,
                model=model,
                credentials=credentials,
                file=file,
                request_metadata=request_metadata,
            )
        except Exception as e:
            raise self._transform_invoke_error(e) from e
