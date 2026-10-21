"""External knowledge use cases without transport or persistence dependencies."""

from collections.abc import Callable, Mapping
from typing import Any, Literal, Protocol

from machinery.context import RequestContext
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalDatasetCreatePayload
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.dataset_access import DatasetAccess, DatasetNotFoundError
from services.knowledge.entities.datasets import DatasetDetailRecord
from services.knowledge.hit_testing.entities import HitTestingQueryRecorder, HitTestingResponse
from services.knowledge.resource_scope import DatasetRef

ExternalDatasetCreationStatus = Literal["created", "name_conflict", "template_missing"]
ExternalRetrievalPreparationStatus = Literal["prepared", "missing", "not_external", "configuration_missing"]


class ExternalTemplateNotFoundError(Exception):
    pass


class ExternalHitTestingError(Exception):
    pass


class ExternalKnowledgeRepository(Protocol):
    def list_templates(self, tenant_id: str, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]: ...
    def get_template(self, tenant_id: str, template_id: str) -> dict[str, Any] | None: ...
    def create_template(
        self, *, tenant_id: str, user_id: str, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]: ...
    def update_template(
        self,
        *,
        tenant_id: str,
        template_id: str,
        user_id: str,
        name: str,
        settings: Mapping[str, Any],
    ) -> dict[str, Any] | None: ...
    def delete_template(self, tenant_id: str, template_id: str) -> bool: ...
    def template_usage(self, tenant_id: str, template_id: str) -> tuple[bool, int]: ...
    def create_dataset(
        self,
        *,
        tenant_id: str,
        user_id: str,
        name: str,
        description: str,
        retrieval_model: Mapping[str, Any] | None,
        template_id: str,
        external_knowledge_id: str,
    ) -> tuple[ExternalDatasetCreationStatus, str | None, str | None]: ...
    def prepare_retrieval(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: Mapping[str, Any] | None,
        metadata_filters: Mapping[str, Any] | None,
    ) -> tuple[ExternalRetrievalPreparationStatus, dict[str, Any] | None]: ...


class ExternalKnowledgeRetrieval(Protocol):
    def check_settings(self, settings: Mapping[str, Any]) -> None: ...
    def retrieve(self, request: Mapping[str, Any]) -> list[dict[str, Any]]: ...


class ExternalDatasetDetails(Protocol):
    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> DatasetDetailRecord: ...
    def console_permission_keys(self, context: RequestContext, dataset_id: str) -> list[str]: ...


def _external_hit_testing_response(query: str, documents: list[dict[str, Any]]) -> HitTestingResponse:
    return {
        "query": {"content": query},
        "records": [
            {
                "content": document.get("content"),
                "title": document.get("title"),
                "score": document.get("score"),
                "metadata": document.get("metadata"),
            }
            for document in documents
        ],
    }


class ExternalKnowledgeApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        repository: ExternalKnowledgeRepository,
        retrieval: ExternalKnowledgeRetrieval,
        queries: HitTestingQueryRecorder,
        dataset_details: ExternalDatasetDetails,
        sync_creator_access: Callable[[RequestContext, DatasetRef], None],
    ) -> None:
        self._dataset_access = dataset_access
        self._repository = repository
        self._retrieval = retrieval
        self._queries = queries
        self._dataset_details = dataset_details
        self._sync_creator_access = sync_creator_access

    @staticmethod
    def _validate_settings(settings: Mapping[str, Any]) -> None:
        if not settings:
            raise ValueError("api list is empty")
        if not settings.get("endpoint"):
            raise ValueError("endpoint is required")
        if not settings.get("api_key"):
            raise ValueError("api_key is required")

    def list_templates(self, context: RequestContext, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]:
        return self._repository.list_templates(context.active_workspace_id, page=page, limit=limit, keyword=keyword)

    def get_template(self, context: RequestContext, *, template_id: str) -> dict[str, Any]:
        result = self._repository.get_template(context.active_workspace_id, template_id)
        if result is None:
            raise ExternalTemplateNotFoundError("API template not found.")
        return result

    def create_template(self, context: RequestContext, *, name: str, settings: Mapping[str, Any]) -> dict[str, Any]:
        self._validate_settings(settings)
        self._retrieval.check_settings(settings)
        return self._repository.create_template(
            tenant_id=context.active_workspace_id,
            user_id=context.account_id,
            name=name,
            settings=settings,
        )

    def update_template(
        self, context: RequestContext, *, template_id: str, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]:
        self._validate_settings(settings)
        result = self._repository.update_template(
            tenant_id=context.active_workspace_id,
            template_id=template_id,
            user_id=context.account_id,
            name=name,
            settings=settings,
        )
        if result is None:
            raise ExternalTemplateNotFoundError("API template not found.")
        return result

    def delete_template(self, context: RequestContext, *, template_id: str) -> None:
        if not self._repository.delete_template(context.active_workspace_id, template_id):
            raise ExternalTemplateNotFoundError("API template not found.")

    def template_usage(self, context: RequestContext, *, template_id: str) -> tuple[bool, int]:
        return self._repository.template_usage(context.active_workspace_id, template_id)

    def create_dataset(self, context: RequestContext, *, payload: ExternalDatasetCreatePayload) -> DatasetDetailRecord:
        status, tenant_id, dataset_id = self._repository.create_dataset(
            tenant_id=context.active_workspace_id,
            user_id=context.account_id,
            name=payload.name,
            description=payload.description or "",
            retrieval_model=payload.external_retrieval_model,
            template_id=payload.external_knowledge_api_id,
            external_knowledge_id=payload.external_knowledge_id,
        )
        if status == "name_conflict":
            raise DatasetNameDuplicateError(f"Dataset with name {payload.name} already exists.")
        if status == "template_missing":
            raise ExternalTemplateNotFoundError("API template not found.")
        if tenant_id is None or dataset_id is None:
            raise RuntimeError("External dataset persistence returned an incomplete identity")
        ref = DatasetRef(tenant_id, dataset_id)
        self._sync_creator_access(context, ref)
        result = self._dataset_details.get_dataset(context, ref)
        result["permission_keys"] = self._dataset_details.console_permission_keys(context, dataset_id)
        return result

    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> HitTestingResponse:
        status, request = self._repository.prepare_retrieval(
            tenant_id=ref.tenant_id,
            dataset_id=ref.dataset_id,
            query=query,
            retrieval_model=retrieval_model,
            metadata_filters=metadata_filters,
        )
        if status == "missing":
            raise DatasetNotFoundError()
        if status == "not_external":
            return _external_hit_testing_response(query, [])
        if status == "configuration_missing" or request is None:
            raise ExternalKnowledgeRetrievalError("external knowledge configuration not found")
        documents = self._retrieval.retrieve(request)
        self._queries.record_hit_testing_query(context, ref, query)
        return _external_hit_testing_response(query, documents)

    def hit_testing(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> HitTestingResponse:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        if not query:
            raise ValueError("Query or attachment_ids is required")
        if len(query) > 250:
            raise ValueError("Query cannot exceed 250 characters")
        try:
            return self.retrieve(
                context,
                DatasetRef(dataset.workspace_id, dataset.id),
                query=query,
                retrieval_model=retrieval_model,
                metadata_filters=metadata_filters,
            )
        except Exception as error:
            raise ExternalHitTestingError(str(error)) from error
