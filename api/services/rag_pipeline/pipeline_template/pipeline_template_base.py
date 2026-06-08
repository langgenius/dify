from abc import ABC, abstractmethod
from typing import Any


class PipelineTemplateRetrievalBase(ABC):
    """Interface for pipeline template retrieval."""

    @abstractmethod
    def get_pipeline_templates(self, language: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_pipeline_template_detail(self, template_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    @abstractmethod
    def get_type(self) -> str:
        raise NotImplementedError
