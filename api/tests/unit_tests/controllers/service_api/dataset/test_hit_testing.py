"""Thin Service API hit-testing controller tests."""

from dataclasses import dataclass, field
from inspect import unwrap
from typing import Literal, cast
from uuid import UUID, uuid4

import pytest
from flask import Flask
from flask_restx import Api, Resource

from controllers.common.errors import ForbiddenError, InternalServerError, NotFoundError
from controllers.service_api.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.dataset import hit_testing as controller
from controllers.service_api.dataset.error import DatasetNotInitializedError, ExternalKnowledgeRetrievalFailedError
from core.errors.error import KnowledgeIndexUnavailableError
from fields.hit_testing_fields import HitTestingPayload
from libs.external_api import register_external_error_handlers
from machinery.context import RequestContext
from services.errors.index import IndexNotInitializedError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.entities.knowledge_entities import RetrievalModel
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse
from services.knowledge.hit_testing.errors import (
    HitTestingFailedError,
    HitTestingInvocationError,
    HitTestingProviderError,
    HitTestingUpstreamError,
)

CONTEXT = RequestContext("request", "trace", "account", "tenant")


def hit_testing_record() -> dict[str, object]:
    return {
        "segment": {
            "id": "segment-1",
            "position": 1,
            "document_id": "document-1",
            "content": "Chunk text",
            "sign_content": None,
            "answer": None,
            "word_count": 2,
            "tokens": 3,
            "keywords": None,
            "index_node_id": None,
            "index_node_hash": None,
            "hit_count": 0,
            "enabled": True,
            "disabled_at": None,
            "disabled_by": None,
            "status": "completed",
            "created_by": "account-1",
            "created_at": 1_700_000_000,
            "indexing_at": None,
            "completed_at": None,
            "error": None,
            "stopped_at": None,
            "document": {
                "id": "document-1",
                "data_source_type": "upload_file",
                "name": "guide.md",
                "doc_type": None,
                "doc_metadata": None,
            },
        },
        "child_chunks": None,
        "files": None,
        "score": 0.9,
    }


def empty_hit_testing_response() -> HitTestingResponse:
    return {"query": {"content": "query"}, "records": []}


@dataclass
class HitTestingServiceStub:
    result: HitTestingResponse = field(default_factory=empty_hit_testing_response)
    error: Exception | None = None
    calls: list[tuple[RequestContext, str, HitTestingRequest]] = field(default_factory=list)

    def retrieve(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        request: HitTestingRequest,
    ) -> HitTestingResponse:
        self.calls.append((context, dataset_id, request))
        if self.error is not None:
            raise self.error
        return self.result


@dataclass(frozen=True)
class KnowledgeStub:
    hit_testing: HitTestingServiceStub


@dataclass(frozen=True)
class ApplicationServicesStub:
    knowledge: KnowledgeStub


def _call_post(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    service: HitTestingServiceStub,
    payload: HitTestingPayload,
    dataset_id: UUID,
) -> dict[str, object]:
    monkeypatch.setattr(
        controller,
        "application_services",
        lambda: ApplicationServicesStub(KnowledgeStub(service)),
    )
    method = unwrap(controller.HitTestingApi.post)
    with app.test_request_context():
        return method(controller.HitTestingApi(), payload, CONTEXT, dataset_id)


def test_post_forwards_transport_values_to_the_application_service(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HitTestingServiceStub()
    dataset_id = uuid4()
    retrieval_model = RetrievalModel.model_validate(
        {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "score_threshold_enabled": True,
            "score_threshold": 0.8,
            "top_k": 10,
            "metadata_filtering_conditions": {
                "logical_operator": "and",
                "conditions": [{"name": "category", "comparison_operator": "is", "value": "finance"}],
            },
        }
    )
    payload = HitTestingPayload(
        query="query",
        retrieval_model=retrieval_model,
        external_retrieval_model={"top_k": 3},
        attachment_ids=["upload"],
    )

    assert _call_post(app, monkeypatch, service, payload, dataset_id) == service.result
    assert service.calls == [
        (
            CONTEXT,
            str(dataset_id),
            HitTestingRequest(
                "query",
                retrieval_model.model_dump(exclude_none=True),
                {"top_k": 3},
                ["upload"],
            ),
        )
    ]


def test_response_schema_normalizes_nullable_legacy_collections(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HitTestingServiceStub(result={"query": {"content": "query"}, "records": [hit_testing_record()]})

    response = _call_post(app, monkeypatch, service, HitTestingPayload(query="query"), uuid4())

    records = cast(list[dict[str, object]], response["records"])
    record = records[0]
    segment = cast(dict[str, object], record["segment"])
    assert segment["keywords"] == []
    assert record["child_chunks"] == []
    assert record["files"] == []
    assert record["tsne_position"] is None
    assert record["summary"] is None


def test_response_preserves_external_knowledge_records(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result: HitTestingResponse = {
        "query": {"content": "query"},
        "records": [{"content": "External text", "title": "Guide", "score": 0.8, "metadata": {"source": "remote"}}],
    }
    service = HitTestingServiceStub(result=result)

    response = _call_post(app, monkeypatch, service, HitTestingPayload(query="query"), uuid4())

    assert response == result


def test_invalid_internal_record_cannot_fall_back_to_external_schema(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HitTestingServiceStub(result={"query": {"content": "query"}, "records": [{"segment": {"id": "bad"}}]})

    with pytest.raises(ValueError, match="document_id"):
        _call_post(app, monkeypatch, service, HitTestingPayload(query="query"), uuid4())


@pytest.mark.parametrize(
    ("failure", "transport_error"),
    [
        (DatasetNotFoundError(), NotFoundError),
        (DatasetAccessDeniedError(), ForbiddenError),
        (IndexNotInitializedError(), DatasetNotInitializedError),
        (HitTestingProviderError("missing", kind="uninitialized"), ProviderNotInitializeError),
        (HitTestingProviderError("quota", kind="quota"), ProviderQuotaExceededError),
        (HitTestingProviderError("unsupported", kind="unsupported"), ProviderModelCurrentlyNotSupportError),
        (HitTestingInvocationError("invoke"), CompletionRequestError),
        (HitTestingUpstreamError("upstream"), ExternalKnowledgeRetrievalFailedError),
        (HitTestingFailedError("failed"), InternalServerError),
    ],
)
def test_domain_errors_are_translated_at_the_transport_boundary(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    transport_error: type[Exception],
) -> None:
    service = HitTestingServiceStub(error=failure)

    with pytest.raises(transport_error):
        _call_post(app, monkeypatch, service, HitTestingPayload(query="query"), uuid4())


def test_external_provider_failure_reaches_the_unified_http_handler_as_502(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HitTestingServiceStub(error=HitTestingUpstreamError("provider unavailable"))
    monkeypatch.setattr(
        controller,
        "application_services",
        lambda: ApplicationServicesStub(KnowledgeStub(service)),
    )
    method = unwrap(controller.HitTestingApi.post)
    http_api = Api(app, doc=False)
    register_external_error_handlers(http_api)
    dataset_id = uuid4()

    class Endpoint(Resource):
        def post(self) -> object:
            return method(controller.HitTestingApi(), HitTestingPayload(query="query"), CONTEXT, dataset_id)

    http_api.add_resource(Endpoint, "/retrieve")
    response = app.test_client().post("/retrieve")

    assert response.status_code == 502
    assert response.get_json() == {
        "code": "external_knowledge_failed",
        "message": "provider unavailable",
        "status": 502,
    }


def test_payload_preserves_public_validation_and_compatibility() -> None:
    assert HitTestingPayload.model_validate({"query": "query", "top_k": 3}).model_dump(exclude_none=True) == {
        "query": "query"
    }
    assert len(HitTestingPayload(query="x" * 250).query) == 250
    with pytest.raises(ValueError, match="query"):
        HitTestingPayload(query="x" * 251)


@pytest.mark.parametrize("reason", ["indexing", "failed"])
def test_unavailable_index_returns_503_with_recovery_reason(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    reason: Literal["indexing", "failed"],
) -> None:
    service = HitTestingServiceStub(error=KnowledgeIndexUnavailableError(reason))
    monkeypatch.setattr(controller, "application_services", lambda: ApplicationServicesStub(KnowledgeStub(service)))
    method = unwrap(controller.HitTestingApi.post)
    http_api = Api(app, doc=False)
    register_external_error_handlers(http_api)

    class Endpoint(Resource):
        def post(self) -> object:
            return method(controller.HitTestingApi(), HitTestingPayload(query="query"), CONTEXT, uuid4())

    http_api.add_resource(Endpoint, "/retrieve")
    response = app.test_client().post("/retrieve")
    assert response.status_code == 503
    assert response.get_json()["code"] == "knowledge_index_unavailable"
    assert response.get_json()["details"] == {"reason": reason}
