"""Service API dataset controllers delegate use cases to application services."""

from dataclasses import dataclass, field
from datetime import datetime
from inspect import unwrap
from typing import cast
from uuid import UUID

import pytest
from flask import Flask
from flask_restx import Api, Resource

from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.service_api.dataset.error import (
    DatasetConcurrentUpdateError,
    DatasetInUseError,
    DatasetNameDuplicateError,
    InvalidActionError,
)
from core.errors.error import ProviderTokenNotInitError
from fields.service_api.dataset import DatasetCreatePayload, DatasetUpdatePayload, DocumentStatusPayload
from libs.external_api import register_external_error_handlers
from machinery.context import RequestContext
from services.errors.dataset import DatasetInUseError as DatasetInUseFailure
from services.errors.dataset import DatasetNameDuplicateError as DatasetNameDuplicateFailure
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccess,
    DatasetAccessDeniedError,
    DatasetNotFoundError,
)
from services.knowledge.datasets.application import (
    DatasetApplicationService,
    DatasetMutationStore,
    DatasetOperations,
)
from services.knowledge.datasets.contracts import (
    DatasetConcurrentUpdateError as DatasetConcurrentUpdateFailure,
)
from services.knowledge.datasets.contracts import (
    DatasetListFilter,
    DatasetPermissionChangeSnapshot,
    DatasetUpdateMutation,
    DatasetUpdateSnapshot,
)
from services.knowledge.datasets.model_configuration import KnowledgeModelConfigurationGateway
from services.knowledge.documents.application import DocumentIndexingStateError, DocumentInvalidActionError

DATASET_ID = UUID("11111111-1111-4111-8111-111111111111")
CONTEXT = RequestContext("request", None, "account", "workspace")


def dataset_detail_result(**overrides: object) -> dict[str, object]:
    result: dict[str, object] = {
        "id": str(DATASET_ID),
        "name": "Knowledge",
        "description": "Knowledge base",
        "provider": "vendor",
        "permission": "only_me",
        "data_source_type": None,
        "indexing_technique": "economy",
        "keyword_number": 10,
        "app_count": 0,
        "document_count": 0,
        "word_count": 0,
        "created_by": "account",
        "author_name": "Owner",
        "created_at": 1704067200,
        "updated_by": None,
        "updated_at": 1704067200,
        "embedding_model": None,
        "embedding_model_provider": None,
        "embedding_available": True,
        "retrieval_model_dict": {
            "search_method": "hybrid_search",
            "reranking_enable": False,
            "reranking_mode": None,
            "reranking_model": {
                "reranking_provider_name": None,
                "reranking_model_name": None,
            },
            "weights": None,
            "top_k": 3,
            "score_threshold_enabled": False,
            "score_threshold": None,
        },
        "summary_index_setting": {
            "enable": False,
            "model_name": None,
            "model_provider_name": None,
            "summary_prompt": None,
        },
        "tags": [],
        "doc_form": None,
        "external_knowledge_info": {
            "external_knowledge_id": None,
            "external_knowledge_api_id": None,
            "external_knowledge_api_name": None,
            "external_knowledge_api_endpoint": None,
        },
        "external_retrieval_model": None,
        "doc_metadata": [],
        "built_in_field_enabled": False,
        "pipeline_id": None,
        "runtime_mode": "general",
        "chunk_structure": None,
        "icon_info": {
            "icon_type": None,
            "icon": None,
            "icon_background": None,
            "icon_url": None,
        },
        "is_published": False,
        "total_documents": 0,
        "total_available_documents": 0,
        "enable_api": False,
        "is_multimodal": False,
        "permission_keys": ["dataset.acl.edit"],
        "maintainer": None,
    }
    result.update(overrides)
    return result


def serialized_dataset_detail(result: dict[str, object]) -> dict[str, object]:
    expected = dict(result)
    expected.pop("permission_keys", None)
    expected.pop("keyword_number", None)
    return expected


@dataclass
class DatasetServiceFake:
    result: dict[str, object] = field(default_factory=dataset_detail_result)
    error: Exception | None = None
    calls: list[tuple[str, tuple[object, ...]]] = field(default_factory=list)

    def _return(self) -> dict[str, object]:
        if self.error is not None:
            raise self.error
        return self.result

    def list_workspace_datasets(self, context: RequestContext, query: DatasetListFilter) -> dict[str, object]:
        self.calls.append(("list_workspace", (context, query)))
        return self._return()

    def create_dataset_with_requested_permission(
        self,
        context: RequestContext,
        *,
        values: dict[str, object],
    ) -> dict[str, object]:
        self.calls.append(("create_with_requested_permission", (context, values)))
        return self._return()

    def get_dataset(self, context: RequestContext, *, dataset_id: str) -> dict[str, object]:
        self.calls.append(("get", (context, dataset_id)))
        return self._return()

    def update_dataset(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        values: dict[str, object],
    ) -> dict[str, object]:
        self.calls.append(("update", (context, dataset_id, values)))
        return self._return()

    def delete_dataset(self, context: RequestContext, *, dataset_id: str) -> None:
        self.calls.append(("delete", (context, dataset_id)))
        if self.error is not None:
            raise self.error


@dataclass
class DocumentServiceFake:
    error: Exception | None = None
    calls: list[tuple[RequestContext, str, tuple[str, ...], str]] = field(default_factory=list)

    def change_status(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_ids: list[str],
        action: str,
    ) -> None:
        self.calls.append((context, dataset_id, tuple(document_ids), action))
        if self.error is not None:
            raise self.error


@dataclass
class KnowledgeFake:
    datasets: DatasetServiceFake
    documents: DocumentServiceFake


@dataclass
class ApplicationServicesFake:
    knowledge: KnowledgeFake
    tags: object = None


@pytest.fixture
def datasets() -> DatasetServiceFake:
    return DatasetServiceFake()


@pytest.fixture
def documents() -> DocumentServiceFake:
    return DocumentServiceFake()


@pytest.fixture(autouse=True)
def application_service_boundary(
    monkeypatch: pytest.MonkeyPatch, datasets: DatasetServiceFake, documents: DocumentServiceFake
) -> None:
    from controllers.service_api.dataset import dataset as controller

    services = ApplicationServicesFake(KnowledgeFake(datasets=datasets, documents=documents))
    monkeypatch.setattr(controller, "application_services", lambda: services)


def test_list_delegates_normalized_repeated_tag_ids(app: Flask, datasets: DatasetServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetListApi

    detail = dataset_detail_result()
    datasets.result = {"data": [detail], "has_more": False, "limit": 20, "total": 1, "page": 1}
    with app.test_request_context("/datasets?tag_ids=a&tag_ids=b&limit=200"):
        response, status = unwrap(DatasetListApi.get)(DatasetListApi(), CONTEXT)

    assert (response, status) == (
        {
            "data": [serialized_dataset_detail(detail)],
            "has_more": False,
            "limit": 20,
            "total": 1,
            "page": 1,
        },
        200,
    )
    method, (context, query) = datasets.calls[0]
    assert method == "list_workspace"
    assert context is CONTEXT
    assert isinstance(query, DatasetListFilter)
    assert query == DatasetListFilter(page=1, limit=200, tag_ids=["a", "b"])


def test_create_delegates_typed_settings(datasets: DatasetServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetListApi

    payload = DatasetCreatePayload(name="Knowledge", permission="only_me")
    response, status = unwrap(DatasetListApi.post)(DatasetListApi(), payload, CONTEXT)

    assert (response, status) == (serialized_dataset_detail(datasets.result), 200)
    method, (context, values) = datasets.calls[0]
    assert method == "create_with_requested_permission"
    assert context is CONTEXT
    assert isinstance(values, dict)
    assert values["name"] == "Knowledge"
    assert values["permission"] == "only_me"
    assert values["retrieval_model"] is None


def test_create_translates_duplicate_name(datasets: DatasetServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetListApi

    datasets.error = DatasetNameDuplicateFailure("duplicate")
    with pytest.raises(DatasetNameDuplicateError):
        unwrap(DatasetListApi.post)(DatasetListApi(), DatasetCreatePayload(name="Knowledge"), CONTEXT)


@pytest.mark.parametrize(
    ("error", "expected"),
    [(DatasetNotFoundError(), NotFoundError), (DatasetAccessDeniedError(), ForbiddenError)],
)
def test_get_translates_dataset_scope_errors(
    datasets: DatasetServiceFake, error: Exception, expected: type[Exception]
) -> None:
    from controllers.service_api.dataset.dataset import DatasetApi

    datasets.error = error
    with pytest.raises(expected):
        DatasetApi.get(DatasetApi(), CONTEXT, DATASET_ID)


def test_get_delegates_dataset_id(datasets: DatasetServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetApi

    response, status = DatasetApi.get(DatasetApi(), CONTEXT, DATASET_ID)

    assert (response, status) == (serialized_dataset_detail(datasets.result), 200)
    assert "partial_member_list" not in response
    assert datasets.calls == [("get", (CONTEXT, str(DATASET_ID)))]


@pytest.mark.parametrize("partial_member_list", [None, []], ids=["explicit-null", "empty-list"])
def test_get_preserves_present_partial_member_list(
    datasets: DatasetServiceFake, partial_member_list: list[str] | None
) -> None:
    from controllers.service_api.dataset.dataset import DatasetApi

    datasets.result["partial_member_list"] = partial_member_list

    response, status = DatasetApi.get(DatasetApi(), CONTEXT, DATASET_ID)

    assert (response, status) == (serialized_dataset_detail(datasets.result), 200)
    assert "partial_member_list" in response
    assert response["partial_member_list"] == partial_member_list


def test_update_serializes_permission_and_retrieval_model(datasets: DatasetServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetApi

    payload = DatasetUpdatePayload(
        permission="all_team_members",
        retrieval_model={
            "search_method": "semantic_search",
            "reranking_enable": False,
            "top_k": 2,
            "score_threshold_enabled": False,
        },
    )
    unwrap(DatasetApi.patch)(DatasetApi(), payload, CONTEXT, DATASET_ID)

    _, (_, dataset_id, values) = datasets.calls[0]
    assert isinstance(values, dict)
    assert dataset_id == str(DATASET_ID)
    assert values["permission"] == "all_team_members"
    assert values["retrieval_model"]["search_method"] == "semantic_search"


def test_update_maps_concurrent_change_to_conflict(datasets: DatasetServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetApi

    datasets.error = DatasetConcurrentUpdateFailure("changed")

    with pytest.raises(DatasetConcurrentUpdateError) as error:
        unwrap(DatasetApi.patch)(DatasetApi(), DatasetUpdatePayload(name="Changed"), CONTEXT, DATASET_ID)

    assert error.value.code == 409
    assert error.value.error_code == "dataset_concurrent_update"


def test_explicit_embedding_provider_failure_remains_invalid_param_at_http_boundary(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    documents: DocumentServiceFake,
) -> None:
    from controllers.service_api.dataset import dataset as controller

    class Access:
        def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
            return AccessibleDataset(dataset_id, context.active_workspace_id)

    class Mutations:
        def get_update_snapshot(self, _ref: object) -> DatasetUpdateSnapshot:
            return DatasetUpdateSnapshot(
                provider="vendor",
                indexing_technique="economy",
                embedding_model_provider=None,
                embedding_model=None,
                updated_at=datetime(2026, 1, 1),
                name="Dataset",
                permission="all_team_members",
                collection_binding_id=None,
                runtime_mode="general",
                pipeline_id=None,
                chunk_structure=None,
                keyword_number=10,
                retrieval_model=None,
                summary_index_setting=None,
                is_multimodal=False,
            )

        def get_permission_change_snapshot(self, _ref: object, *, actor_id: str) -> DatasetPermissionChangeSnapshot:
            assert actor_id == CONTEXT.account_id
            return DatasetPermissionChangeSnapshot("owner", "all_team_members", ())

        def update_dataset(self, _mutation: DatasetUpdateMutation) -> bool:
            raise AssertionError("provider validation must precede persistence")

    class FailingModelManager:
        def get_model_instance(self, **_kwargs: object) -> object:
            raise ProviderTokenNotInitError("provider setup required")

    monkeypatch.setattr(
        KnowledgeModelConfigurationGateway,
        "_manager",
        staticmethod(lambda _tenant_id: FailingModelManager()),
    )
    service = DatasetApplicationService(
        dataset_access=cast(DatasetAccess, Access()),
        operations=cast(DatasetOperations, object()),
        mutations=cast(DatasetMutationStore, Mutations()),
        models=KnowledgeModelConfigurationGateway(),
        cleanup_dataset=lambda _cleanup: None,
        rbac_enabled=False,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
    )
    monkeypatch.setattr(
        controller,
        "application_services",
        lambda: ApplicationServicesFake(KnowledgeFake(datasets=cast(DatasetServiceFake, service), documents=documents)),
    )
    method = unwrap(controller.DatasetApi.patch)
    http_api = Api(app, doc=False)
    register_external_error_handlers(http_api)

    class Endpoint(Resource):
        def patch(self) -> object:
            return method(
                controller.DatasetApi(),
                DatasetUpdatePayload(
                    indexing_technique="high_quality",
                    embedding_model_provider="provider",
                    embedding_model="embedding",
                ),
                CONTEXT,
                DATASET_ID,
            )

    http_api.add_resource(Endpoint, "/model-provider-failure")
    response = app.test_client().patch("/model-provider-failure")

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_param",
        "message": "provider setup required",
        "status": 400,
    }


def test_delete_translates_dataset_in_use(datasets: DatasetServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetApi

    datasets.error = DatasetInUseFailure()
    with pytest.raises(DatasetInUseError):
        unwrap(DatasetApi.delete)(DatasetApi(), CONTEXT, DATASET_ID)


def test_batch_document_status_delegates_to_document_use_case(documents: DocumentServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DocumentStatusApi

    response, status = unwrap(DocumentStatusApi.patch)(
        DocumentStatusApi(),
        DocumentStatusPayload(document_ids=["doc-1", "doc-2"]),
        CONTEXT,
        DATASET_ID,
        "archive",
    )

    assert (response, status) == ({"result": "success"}, 200)
    assert documents.calls == [(CONTEXT, str(DATASET_ID), ("doc-1", "doc-2"), "archive")]


def test_batch_document_status_translates_invalid_action(documents: DocumentServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DocumentStatusApi

    documents.error = DocumentInvalidActionError("invalid")
    with pytest.raises(InvalidActionError):
        unwrap(DocumentStatusApi.patch)(DocumentStatusApi(), DocumentStatusPayload(), CONTEXT, DATASET_ID, "enable")


def test_batch_document_status_returns_indexing_state_as_invalid_action(
    app: Flask, documents: DocumentServiceFake
) -> None:
    from controllers.service_api.dataset.dataset import DocumentStatusApi

    documents.error = DocumentIndexingStateError("Document is being indexed, please try again later.")
    method = unwrap(DocumentStatusApi.patch)
    http_api = Api(app, doc=False)
    register_external_error_handlers(http_api)

    class Endpoint(Resource):
        def patch(self) -> object:
            return method(
                DocumentStatusApi(),
                DocumentStatusPayload(document_ids=["doc-1"]),
                CONTEXT,
                DATASET_ID,
                "disable",
            )

    http_api.add_resource(Endpoint, "/document-indexing-state")
    response = app.test_client().patch("/document-indexing-state")

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_action",
        "message": "Document is being indexed, please try again later.",
        "status": 400,
    }
