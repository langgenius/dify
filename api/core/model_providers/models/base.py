from abc import ABC
from typing import Any

from core.model_providers.providers.base import BaseModelProvider


class BaseProviderModel(ABC):
    _client: Any
    _model_provider: BaseModelProvider

    def __init__(self, model_provider: BaseModelProvider, client: Any):
        self._model_provider = model_provider
        self._client = client

    @property
    def client(self):
        return self._client

    @property
    def model_provider(self):
        return self._model_provider

