"""External knowledge use cases without transport or persistence dependencies."""

from collections.abc import Mapping
from typing import Any, Protocol

from machinery.context import RequestContext
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalDatasetCreatePayload
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.resource_scope import DatasetRef


class ExternalTemplateNotFoundError(Exception):
    pass


class ExternalHitTestingError(Exception):
    pass


class ExternalKnowledgeOperations(Protocol):
    def list_templates(self, workspace_id: str, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]: ...
    def get_template(self, workspace_id: str, template_id: str) -> dict[str, Any]: ...
    def create_template(self, context: RequestContext, *, name: str, settings: Mapping[str, Any]) -> dict[str, Any]: ...
    def update_template(
        self, context: RequestContext, template_id: str, *, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]: ...
    def delete_template(self, workspace_id: str, template_id: str) -> None: ...
    def template_usage(self, workspace_id: str, template_id: str) -> tuple[bool, int]: ...
    def create_dataset(self, context: RequestContext, payload: ExternalDatasetCreatePayload) -> dict[str, Any]: ...
    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> dict[str, Any]: ...


class ExternalKnowledgeApplicationService:
    def __init__(self, *, dataset_access: DatasetAccess, operations: ExternalKnowledgeOperations) -> None:
        self._dataset_access = dataset_access
        self._operations = operations

    @staticmethod
    def _validate_settings(settings: Mapping[str, Any]) -> None:
        if not settings:
            raise ValueError("api list is empty")
        if not settings.get("endpoint"):
            raise ValueError("endpoint is required")
        if not settings.get("api_key"):
            raise ValueError("api_key is required")

    def list_templates(self, context: RequestContext, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]:
        return self._operations.list_templates(context.active_workspace_id, page=page, limit=limit, keyword=keyword)

    def get_template(self, context: RequestContext, *, template_id: str) -> dict[str, Any]:
        return self._operations.get_template(context.active_workspace_id, template_id)

    def create_template(self, context: RequestContext, *, name: str, settings: Mapping[str, Any]) -> dict[str, Any]:
        self._validate_settings(settings)
        return self._operations.create_template(context, name=name, settings=settings)

    def update_template(
        self, context: RequestContext, *, template_id: str, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]:
        self._validate_settings(settings)
        return self._operations.update_template(context, template_id, name=name, settings=settings)

    def delete_template(self, context: RequestContext, *, template_id: str) -> None:
        self._operations.delete_template(context.active_workspace_id, template_id)

    def template_usage(self, context: RequestContext, *, template_id: str) -> tuple[bool, int]:
        return self._operations.template_usage(context.active_workspace_id, template_id)

    def create_dataset(self, context: RequestContext, *, payload: ExternalDatasetCreatePayload) -> dict[str, Any]:
        return self._operations.create_dataset(context, payload)

    def hit_testing(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> dict[str, Any]:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        if not query:
            raise ValueError("Query or attachment_ids is required")
        if len(query) > 250:
            raise ValueError("Query cannot exceed 250 characters")
        try:
            return self._operations.retrieve(
                context,
                DatasetRef(dataset.workspace_id, dataset.id),
                query=query,
                retrieval_model=retrieval_model,
                metadata_filters=metadata_filters,
            )
        except Exception as error:
            raise ExternalHitTestingError(str(error)) from error
