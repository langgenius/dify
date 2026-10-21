import uuid
from dataclasses import dataclass, field
from importlib import import_module
from inspect import unwrap
from typing import Literal, cast

import pytest
from flask import Flask
from flask_restx import Api, Resource
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

from controllers.console import flask_admission, wraps
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import DatasetNotInitializedError
from controllers.console.datasets.hit_testing import HitTestingApi
from core.errors.error import KnowledgeIndexUnavailableError
from fields.hit_testing_fields import HitTestingPayload
from fields.hit_testing_fields import HitTestingResponse as HitTestingResponseModel
from libs.external_api import register_external_error_handlers
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account
from services.errors.index import IndexNotInitializedError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse
from services.knowledge.hit_testing.errors import (
    HitTestingFailedError,
    HitTestingInvocationError,
    HitTestingProviderError,
    HitTestingUpstreamError,
)

module = import_module("controllers.console.datasets.hit_testing")


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "tenant-1")


def _record() -> dict[str, object]:
    return {
        "segment": {
            "id": "segment-1",
            "position": 1,
            "document_id": "document-1",
            "content": "Chunk text",
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
        "score": None,
        "files": None,
    }


@dataclass
class HitTestingStub:
    response: HitTestingResponse | None = None
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
        assert self.response is not None
        return self.response


@dataclass(frozen=True)
class KnowledgeServicesStub:
    hit_testing: HitTestingStub


@dataclass(frozen=True)
class ApplicationServicesStub:
    knowledge: KnowledgeServicesStub


def _invoke(monkeypatch: pytest.MonkeyPatch, service: HitTestingStub, payload: HitTestingPayload) -> dict[str, object]:
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: ApplicationServicesStub(KnowledgeServicesStub(service)),
    )
    method = unwrap(HitTestingApi().post)
    return method(HitTestingApi(), payload, _context(), uuid.UUID("00000000-0000-0000-0000-000000000001"))


def test_hit_testing_delegates_to_application_service(monkeypatch: pytest.MonkeyPatch) -> None:
    service = HitTestingStub(response={"query": {"content": "hello"}, "records": []})

    result = _invoke(monkeypatch, service, HitTestingPayload(query="hello"))

    assert result == {"query": {"content": "hello"}, "records": []}
    context, dataset_id, request = service.calls[0]
    assert context == _context()
    assert dataset_id == "00000000-0000-0000-0000-000000000001"
    assert request == HitTestingRequest(
        query="hello",
        retrieval_model=None,
        external_retrieval_model=None,
        attachment_ids=None,
    )


def test_hit_testing_response_serialization_normalizes_optional_collections(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = cast(HitTestingResponse, {"query": {"content": "hello"}, "records": [_record()]})
    service = HitTestingStub(response=response)

    result = _invoke(monkeypatch, service, HitTestingPayload(query="hello"))

    records = result["records"]
    assert isinstance(records, list)
    record = records[0]
    assert isinstance(record, dict)
    assert record["segment"]["keywords"] == []
    assert record["segment"]["sign_content"] is None
    assert record["child_chunks"] == []
    assert record["files"] == []
    assert record["tsne_position"] is None
    assert record["summary"] is None


def test_external_hit_testing_response_is_serialized_through_the_http_endpoint(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = cast(
        HitTestingResponse,
        {
            "query": {"content": "hello"},
            "records": [
                {
                    "content": "External passage",
                    "title": "External title",
                    "score": 0.91,
                    "metadata": {"source": "remote"},
                }
            ],
        },
    )
    service = HitTestingStub(response=response)
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: ApplicationServicesStub(KnowledgeServicesStub(service)),
    )
    method = unwrap(HitTestingApi().post)
    http_api = Api(app, doc=False)

    class Endpoint(Resource):
        def post(self) -> object:
            return method(
                HitTestingApi(),
                HitTestingPayload(query="hello"),
                _context(),
                uuid.UUID("00000000-0000-0000-0000-000000000001"),
            )

    http_api.add_resource(Endpoint, "/hit-testing")
    http_response = app.test_client().post("/hit-testing")

    assert http_response.status_code == 200
    assert http_response.get_json() == response


def test_hit_testing_response_schema_accepts_internal_and_external_records() -> None:
    schema = HitTestingResponseModel.model_json_schema(mode="serialization")

    assert schema["properties"]["records"]["items"]["oneOf"] == [
        {"$ref": "#/$defs/HitTestingRecord"},
        {"$ref": "#/$defs/ExternalHitTestingRecordResponse"},
    ]


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (DatasetNotFoundError(), NotFound),
        (DatasetAccessDeniedError(), Forbidden),
        (IndexNotInitializedError(), DatasetNotInitializedError),
        (HitTestingProviderError("missing", kind="uninitialized"), ProviderNotInitializeError),
        (HitTestingProviderError("quota", kind="quota"), ProviderQuotaExceededError),
        (HitTestingProviderError("unsupported", kind="unsupported"), ProviderModelCurrentlyNotSupportError),
        (HitTestingInvocationError("invoke"), CompletionRequestError),
        (HitTestingUpstreamError("upstream"), InternalServerError),
        (HitTestingFailedError("failed"), InternalServerError),
    ],
)
def test_hit_testing_maps_application_errors(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
) -> None:
    with pytest.raises(expected):
        _invoke(monkeypatch, HitTestingStub(error=error), HitTestingPayload(query="hello"))


def test_hit_testing_hides_unexpected_failure_details(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(InternalServerError) as exc_info:
        _invoke(
            monkeypatch,
            HitTestingStub(error=HitTestingFailedError("boom")),
            HitTestingPayload(query="hello"),
        )

    assert "boom" not in str(exc_info.value)


@pytest.mark.parametrize("reason", ["indexing", "failed"])
def test_unavailable_index_returns_503_with_recovery_reason(
    monkeypatch: pytest.MonkeyPatch,
    reason: Literal["indexing", "failed"],
) -> None:
    app = Flask(__name__)
    service = HitTestingStub(error=KnowledgeIndexUnavailableError(reason))
    http_api = Api(app, doc=False)
    register_external_error_handlers(http_api)

    class Endpoint(Resource):
        def post(self) -> object:
            return _invoke(monkeypatch, service, HitTestingPayload(query="hello"))

    http_api.add_resource(Endpoint, "/hit-testing")
    response = app.test_client().post("/hit-testing")
    assert response.status_code == 503
    assert response.get_json()["code"] == "knowledge_index_unavailable"
    assert response.get_json()["details"] == {"reason": reason}


@pytest.mark.parametrize("rate_limited", [False, True])
def test_admission_checks_knowledge_rate_limit_before_rbac(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    rate_limited: bool,
) -> None:
    service = HitTestingStub(response={"query": {"content": "query"}, "records": []})
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: ApplicationServicesStub(KnowledgeServicesStub(service)),
    )
    account = Account(name="User", email="user@example.com")
    account.id = "account-1"
    identity = AccountWithTenant(account, "tenant-1")
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr("libs.login._resolve_current_user", lambda: account)
    monkeypatch.setattr("libs.login.check_csrf_token", lambda _request, _account_id: None)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    order: list[str] = []

    def check_limit() -> None:
        order.append("limit")
        if rate_limited:
            raise Forbidden("rate limited")

    def check_rbac(**_kwargs: object) -> None:
        order.append("rbac")

    monkeypatch.setattr(wraps, "check_knowledge_rate_limit", check_limit)
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", check_rbac)
    with app.test_request_context(method="POST", json={"query": "query"}):
        if rate_limited:
            with pytest.raises(Forbidden, match="rate limited"):
                HitTestingApi().post(dataset_id=uuid.UUID("00000000-0000-0000-0000-000000000001"))
            assert not service.calls
            assert order == ["limit"]
        else:
            assert HitTestingApi().post(dataset_id=uuid.UUID("00000000-0000-0000-0000-000000000001")) == {
                "query": {"content": "query"},
                "records": [],
            }
            assert order == ["limit", "rbac"]
