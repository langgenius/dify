from abc import abstractmethod
from typing import Optional

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel


class TTSModel(AIModel):
    """
    Model class for ttstext model.
    """
    model_type: ModelType = ModelType.TTS

    def invoke(self, model: str, credentials: dict, content_text: str, streaming: bool, user: Optional[str] = None):
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param streaming: output is streaming
        :param user: unique user id
        :return: translated audio file
        """
        try:
            return self._invoke(model=model, credentials=credentials, user=user, streaming=streaming, content_text=content_text)
        except Exception as e:
            raise self._transform_invoke_error(e)

    @abstractmethod
    def _invoke(self, model: str, credentials: dict, content_text: str, streaming: bool, user: Optional[str] = None):
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param streaming: output is streaming
        :param user: unique user id
        :return: translated audio file
        """
        raise NotImplementedError
