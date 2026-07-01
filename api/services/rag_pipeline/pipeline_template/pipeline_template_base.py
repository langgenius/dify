from typing import Any, Protocol


class PipelineTemplateRetrievalBase(Protocol):
    """Interface for pipeline template retrieval."""

    def get_pipeline_templates(self, language: str, current_tenant_id: str | None = None) -> dict[str, Any]: ...

    def get_pipeline_template_detail(self, template_id: str) -> dict[str, Any] | None: ...

    def get_type(self) -> str: ...
