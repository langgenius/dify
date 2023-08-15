from abc import abstractmethod
from typing import Any

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider


class BaseSpeech2Text(BaseProviderModel):
    name: str
    type: ModelType = ModelType.SPEECH_TO_TEXT

    def __init__(self, model_provider: BaseModelProvider, client: Any, name: str):
        super().__init__(model_provider, client)
        self.name = name

    def run(self, file):
        try:
            return self._run(file)
        except Exception as ex:
            raise self.handle_exceptions(ex)

    @abstractmethod
    def _run(self, file):
        raise NotImplementedError

    @abstractmethod
    def handle_exceptions(self, ex: Exception) -> Exception:
        raise NotImplementedError
