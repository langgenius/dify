from abc import abstractmethod
from typing import Any, Optional, List
from langchain.schema import Document

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider
import logging

logger = logging.getLogger(__name__)


class BaseReranking(BaseProviderModel):
    name: str
    type: ModelType = ModelType.RERANKING

    def __init__(self, model_provider: BaseModelProvider, client: Any, name: str):
        super().__init__(model_provider, client)
        self.name = name

    @property
    def base_model_name(self) -> str:
        """
        get base model name
        
        :return: str
        """
        return self.name

    @abstractmethod
    def rerank(self, query: str, documents: List[Document], score_threshold: Optional[float], top_k: Optional[int]) -> Optional[List[Document]]:
        raise NotImplementedError

    @abstractmethod
    def handle_exceptions(self, ex: Exception) -> Exception:
        raise NotImplementedError
