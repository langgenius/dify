import time
from abc import abstractmethod
from typing import Optional

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel


class ModerationModel(AIModel):
    """
    Model class for moderation model.
    """

    model_type: ModelType = ModelType.MODERATION

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(self, model: str, credentials: dict, text: str, user: Optional[str] = None) -> bool:
        """
        Invoke moderation model

        :param model: model name
        :param credentials: model credentials
        :param text: text to moderate
        :param user: unique user id
        :return: false if text is safe, true otherwise
        """
        self.started_at = time.perf_counter()

        try:
            return self._invoke(model, credentials, text, user)
        except Exception as e:
            raise self._transform_invoke_error(e)

    @abstractmethod
    def _invoke(self, model: str, credentials: dict, text: str, user: Optional[str] = None) -> bool:
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param text: text to moderate
        :param user: unique user id
        :return: false if text is safe, true otherwise
        """
        raise NotImplementedError
