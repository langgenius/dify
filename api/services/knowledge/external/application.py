"""External knowledge use cases without transport or persistence dependencies."""

from collections.abc import Callable, Mapping
from typing import Any, Protocol

from machinery.context import RequestContext
from services.errors.knowledge_retrieval import ExternalHitTestingError
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.entities.datasets import DatasetDetailRecord
from services.knowledge.entities.external import ExternalDatasetCreatePayload, ExternalKnowledgeRetrievalRequest
from services.knowledge.entities.hit_testing import (
    HitTestingQueryRecorder,
    RetrieveResponseDict,
    external_hit_testing_response,
    validate_hit_testing_input,
)
from services.knowledge.entities.resource_scope import DatasetRef


class ExternalKnowledgeRepository(Protocol):
    def list_templates(self, workspace_id: str, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]: ...
    def get_template(self, workspace_id: str, template_id: str) -> dict[str, Any]: ...
    def create_template(self, context: RequestContext, *, name: str, settings: Mapping[str, Any]) -> dict[str, Any]: ...
    def update_template(
        self, context: RequestContext, template_id: str, *, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]: ...
    def delete_template(self, workspace_id: str, template_id: str) -> None: ...
    def template_usage(self, workspace_id: str, template_id: str) -> tuple[bool, int]: ...
    def create_dataset(self, context: RequestContext, payload: ExternalDatasetCreatePayload) -> DatasetRef: ...
    def prepare_retrieval(
        self,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> ExternalKnowledgeRetrievalRequest | None: ...


class ExternalKnowledgeRetrieval(Protocol):
    def check_settings(self, settings: Mapping[str, Any]) -> None: ...
    def retrieve(self, request: ExternalKnowledgeRetrievalRequest) -> list[dict[str, Any]]: ...


class ExternalDatasetDetails(Protocol):
    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> DatasetDetailRecord: ...


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
        return self._repository.get_template(context.active_workspace_id, template_id)

    def create_template(self, context: RequestContext, *, name: str, settings: Mapping[str, Any]) -> dict[str, Any]:
        self._validate_settings(settings)
        self._retrieval.check_settings(settings)
        return self._repository.create_template(context, name=name, settings=settings)

    def update_template(
        self, context: RequestContext, *, template_id: str, name: str, settings: Mapping[str, Any]
    ) -> dict[str, Any]:
        self._validate_settings(settings)
        return self._repository.update_template(context, template_id, name=name, settings=settings)

    def delete_template(self, context: RequestContext, *, template_id: str) -> None:
        self._repository.delete_template(context.active_workspace_id, template_id)

    def template_usage(self, context: RequestContext, *, template_id: str) -> tuple[bool, int]:
        return self._repository.template_usage(context.active_workspace_id, template_id)

    def create_dataset(self, context: RequestContext, *, payload: ExternalDatasetCreatePayload) -> DatasetDetailRecord:
        ref = self._repository.create_dataset(context, payload)
        self._sync_creator_access(context, ref)
        return self._dataset_details.get_dataset(context, ref)

    def hit_testing(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> RetrieveResponseDict:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        validate_hit_testing_input(query, None)
        ref = DatasetRef(dataset.workspace_id, dataset.id)
        try:
            request = self._repository.prepare_retrieval(
                ref,
                query=query,
                retrieval_model=retrieval_model,
                metadata_filters=metadata_filters,
            )
            if request is None:
                return external_hit_testing_response(query, [])
            documents = self._retrieval.retrieve(request)
            self._queries.record_hit_testing_query(context, ref, query)
            return external_hit_testing_response(query, documents)
        except Exception as error:
            raise ExternalHitTestingError(str(error)) from error
