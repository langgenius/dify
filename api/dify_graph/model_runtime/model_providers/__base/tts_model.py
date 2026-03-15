import logging
from collections.abc import Iterable

from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.model_providers.__base.ai_model import AIModel

logger = logging.getLogger(__name__)


class TTSModel(AIModel):
    """
    Model class for TTS model.
    """

    model_type: ModelType = ModelType.TTS

    def invoke(
        self,
        model: str,
        credentials: dict,
        content_text: str,
        voice: str,
    ) -> Iterable[bytes]:
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :return: translated audio file
        """
        try:
            return self.model_runtime.invoke_tts(
                provider=self.provider,
                model=model,
                credentials=credentials,
                content_text=content_text,
                voice=voice,
            )
        except Exception as e:
            raise self._transform_invoke_error(e)

    def get_tts_model_voices(self, model: str, credentials: dict, language: str | None = None):
        """
        Retrieves the list of voices supported by a given text-to-speech (TTS) model.

        :param language: The language for which the voices are requested.
        :param model: The name of the TTS model.
        :param credentials: The credentials required to access the TTS model.
        :return: A list of voices supported by the TTS model.
        """
        return self.model_runtime.get_tts_model_voices(
            provider=self.provider,
            model=model,
            credentials=credentials,
            language=language,
        )
