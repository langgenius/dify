import logging
from collections.abc import Iterable, Mapping

from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.model_providers.base.ai_model import AIModel
from graphon.model_runtime.protocols.tts_runtime import (
    TTSChunk,
    TTSModelRuntime,
    TTSModelVoice,
)

logger = logging.getLogger(__name__)


class TTSModel(AIModel[TTSModelRuntime]):
    """Model class for TTS model."""

    model_type: ModelType = ModelType.TTS

    def invoke(
        self,
        model: str,
        credentials: dict,
        content_text: str,
        voice: str,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Iterable[TTSChunk]:
        """Invoke the TTS model and return an audio stream."""
        try:
            return self.model_runtime.invoke_tts(
                provider=self.provider,
                model=model,
                credentials=credentials,
                content_text=content_text,
                voice=voice,
                request_metadata=request_metadata,
            )
        except Exception as e:
            raise self._transform_invoke_error(e) from e

    def get_tts_model_voices(
        self,
        model: str,
        credentials: dict,
        language: str | None = None,
    ) -> list[TTSModelVoice]:
        """Retrieve the voices supported by a text-to-speech model."""
        return self.model_runtime.get_tts_model_voices(
            provider=self.provider,
            model=model,
            credentials=credentials,
            language=language,
        )
