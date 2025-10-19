from abc import ABC, abstractmethod


class PipelineTemplateRetrievalBase(ABC):
    """Interface for pipeline template retrieval."""

    @abstractmethod
    def get_pipeline_templates(self, language: str) -> dict:
        raise NotImplementedError

    @abstractmethod
    def get_pipeline_template_detail(self, template_id: str) -> dict | None:
        raise NotImplementedError

    @abstractmethod
    def get_type(self) -> str:
        raise NotImplementedError
