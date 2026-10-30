"""External knowledge use cases without transport or persistence dependencies."""

from collections.abc import Callable, Mapping
from typing import Any, Protocol

from machinery.context import RequestContext
from services.errors.knowledge_retrieval import ExternalTemplateNotFoundError as _ExternalTemplateNotFoundError
from services.knowledge.dataset_access import DatasetAccess, DatasetNotFoundError
from services.knowledge.entities.datasets import DatasetDetailRecord
from services.knowledge.entities.external import (
    ExternalDatasetCreatePayload,
    ExternalKnowledgeRetrievalRequest,
    ExternalRetrievalCandidate,
    ExternalRetrievalConfig,
    validate_external_knowledge_api_settings,
)
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.hit_testing.entities import (
    HitTestingQueryRecorder,
    HitTestingResponse,
    external_hit_testing_response,
    validate_hit_testing_input,
)


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
        expected_api_key: str | None,
    ) -> dict[str, Any]: ...
    def delete_template(self, tenant_id: str, template_id: str) -> None: ...
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
    ) -> DatasetRef: ...
    def get_retrieval_request(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: ExternalRetrievalConfig | None,
        metadata_filters: MetadataFilteringCondition | None,
    ) -> ExternalKnowledgeRetrievalRequest | None: ...


class ExternalKnowledgeRetrieval(Protocol):
    def check_settings(self, settings: Mapping[str, Any]) -> None: ...
    def retrieve(self, request: ExternalKnowledgeRetrievalRequest) -> list[ExternalRetrievalCandidate]: ...


class ExternalDatasetRetrievalService:
    """Materialize provider configuration, then perform provider I/O outside the read session."""

    def __init__(self, *, repository: ExternalKnowledgeRepository, gateway: ExternalKnowledgeRetrieval) -> None:
        self._repository = repository
        self._gateway = gateway

    def retrieve(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        query: str,
        retrieval_model: ExternalRetrievalConfig | None,
        metadata_filters: MetadataFilteringCondition | None,
    ) -> list[ExternalRetrievalCandidate]:
        try:
            request = self._repository.get_retrieval_request(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                query=query,
                retrieval_model=retrieval_model,
                metadata_filters=metadata_filters,
            )
        except DatasetNotFoundError:
            return []
        if request is None:
            return []
        return self._gateway.retrieve(request)


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
        api_key_mask: str,
    ) -> None:
        self._dataset_access = dataset_access
        self._repository = repository
        self._retrieval = retrieval
        self._queries = queries
        self._dataset_details = dataset_details
        self._sync_creator_access = sync_creator_access
        self._api_key_mask = api_key_mask

    @staticmethod
    def _validate_settings(settings: dict[str, Any]) -> None:
        validate_external_knowledge_api_settings(settings)

    def list_templates(self, context: RequestContext, *, page: int, limit: int, keyword: str | None) -> dict[str, Any]:
        return self._repository.list_templates(context.active_workspace_id, page=page, limit=limit, keyword=keyword)

    def get_template(self, context: RequestContext, *, template_id: str) -> dict[str, Any]:
        result = self._repository.get_template(context.active_workspace_id, template_id)
        if result is None:
            raise _ExternalTemplateNotFoundError("API template not found.")
        return result

    def create_template(self, context: RequestContext, *, name: str, settings: dict[str, Any]) -> Mapping[str, Any]:
        self._validate_settings(settings)
        self._retrieval.check_settings(settings)
        return self._repository.create_template(
            tenant_id=context.active_workspace_id,
            user_id=context.account_id,
            name=name,
            settings=settings,
        )

    def update_template(
        self, context: RequestContext, *, template_id: str, name: str, settings: dict[str, Any]
    ) -> Mapping[str, Any]:
        self._validate_settings(settings)
        existing = self._repository.get_template(context.active_workspace_id, template_id)
        if existing is None:
            raise _ExternalTemplateNotFoundError("API template not found.")

        settings_for_probe = dict(settings)
        expected_api_key: str | None = None
        if settings_for_probe.get("api_key") == self._api_key_mask:
            existing_settings = existing.get("settings")
            existing_api_key = existing_settings.get("api_key") if isinstance(existing_settings, Mapping) else None
            if not isinstance(existing_api_key, str) or not existing_api_key:
                raise ValueError("api_key is required")
            settings_for_probe["api_key"] = existing_api_key
            expected_api_key = existing_api_key

        self._retrieval.check_settings(settings_for_probe)
        return self._repository.update_template(
            tenant_id=context.active_workspace_id,
            template_id=template_id,
            user_id=context.account_id,
            name=name,
            settings=settings,
            expected_api_key=expected_api_key,
        )

    def delete_template(self, context: RequestContext, *, template_id: str) -> None:
        self._repository.delete_template(context.active_workspace_id, template_id)

    def template_usage(self, context: RequestContext, *, template_id: str) -> tuple[bool, int]:
        return self._repository.template_usage(context.active_workspace_id, template_id)

    def create_dataset(self, context: RequestContext, *, payload: ExternalDatasetCreatePayload) -> DatasetDetailRecord:
        ref = self._repository.create_dataset(
            tenant_id=context.active_workspace_id,
            user_id=context.account_id,
            name=payload.name,
            description=payload.description or "",
            retrieval_model=payload.external_retrieval_model,
            template_id=payload.external_knowledge_api_id,
            external_knowledge_id=payload.external_knowledge_id,
        )
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
    ) -> HitTestingResponse:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        validate_hit_testing_input(query, None)
        ref = DatasetRef(dataset.workspace_id, dataset.id)
        try:
            request = self._repository.get_retrieval_request(
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                query=query,
                retrieval_model=ExternalRetrievalConfig.from_mapping(retrieval_model),
                metadata_filters=(
                    MetadataFilteringCondition.model_validate(metadata_filters) if metadata_filters else None
                ),
            )
            if request is None:
                return external_hit_testing_response(query, [])
            documents = self._retrieval.retrieve(request)
            self._queries.record_hit_testing_query(context.account_id, ref, query)
            return external_hit_testing_response(query, documents)
        except Exception as error:
            raise ExternalHitTestingError(str(error)) from error
