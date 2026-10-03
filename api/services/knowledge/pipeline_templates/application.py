"""Application boundary for knowledge pipeline templates."""

from typing import Any, NamedTuple, Protocol

from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess


class PipelineTemplateInput(NamedTuple):
    name: str
    description: str
    icon: dict[str, Any]


class PipelineTemplateNotFoundError(Exception):
    """A template or a resource required to publish it is missing."""


class PipelineTemplateNameConflictError(Exception):
    def __init__(self) -> None:
        super().__init__("Template name is already exists")


class PipelineTemplatePublishForbiddenError(Exception):
    """The admitted account does not have a legacy dataset editing role."""


class PipelineTemplateCatalog(Protocol):
    def list_templates(self, workspace_id: str, template_type: str, language: str) -> dict[str, Any]: ...

    def get_template(self, workspace_id: str, template_id: str, template_type: str) -> dict[str, Any] | None: ...


class PipelineTemplateStore(Protocol):
    def get_yaml(self, workspace_id: str, template_id: str) -> str: ...

    def update(self, workspace_id: str, actor_id: str, template_id: str, template: PipelineTemplateInput) -> None: ...

    def delete(self, workspace_id: str, template_id: str) -> None: ...

    def get_dataset_id(self, workspace_id: str, pipeline_id: str) -> str: ...

    def validate_publication(self, workspace_id: str, pipeline_id: str, name: str) -> str:
        """Validate both workflow owners and the name then return the chunk structure."""
        ...

    def create(
        self,
        workspace_id: str,
        actor_id: str,
        template: PipelineTemplateInput,
        *,
        yaml_content: str,
        chunk_structure: str,
    ) -> None: ...


class PipelineTemplateExporter(Protocol):
    def export(self, workspace_id: str, pipeline_id: str) -> str: ...


class PipelineTemplateService:
    def __init__(
        self,
        *,
        catalog: PipelineTemplateCatalog,
        store: PipelineTemplateStore,
        exporter: PipelineTemplateExporter,
        dataset_access: DatasetAccess,
    ) -> None:
        self._catalog = catalog
        self._store = store
        self._exporter = exporter
        self._dataset_access = dataset_access

    def list_templates(self, context: RequestContext, template_type: str, language: str) -> dict[str, Any]:
        return self._catalog.list_templates(context.active_workspace_id, template_type, language)

    def get_template(self, context: RequestContext, template_id: str, template_type: str) -> dict[str, Any] | None:
        return self._catalog.get_template(context.active_workspace_id, template_id, template_type)

    def get_yaml(self, context: RequestContext, template_id: str) -> str:
        return self._store.get_yaml(context.active_workspace_id, template_id)

    def update(self, context: RequestContext, template_id: str, template: PipelineTemplateInput) -> None:
        self._store.update(context.active_workspace_id, context.account_id, template_id, template)

    def delete(self, context: RequestContext, template_id: str) -> None:
        self._store.delete(context.active_workspace_id, template_id)

    def publish(
        self,
        context: RequestContext,
        pipeline_id: str,
        template: PipelineTemplateInput,
        *,
        can_edit_datasets: bool,
    ) -> None:
        workspace_id = context.active_workspace_id
        dataset_id = self._store.get_dataset_id(workspace_id, pipeline_id)
        if not can_edit_datasets:
            raise PipelineTemplatePublishForbiddenError()
        self._dataset_access.require_accessible(context, dataset_id)
        chunk_structure = self._store.validate_publication(workspace_id, pipeline_id, template.name)
        yaml_content = self._exporter.export(workspace_id, pipeline_id)
        self._store.create(
            workspace_id,
            context.account_id,
            template,
            yaml_content=yaml_content,
            chunk_structure=chunk_structure,
        )
