import uuid
from dataclasses import dataclass, field
from importlib import import_module
from inspect import unwrap
from typing import cast

import pytest
from flask import Flask
from flask_restx import Api, Resource

from controllers.common.errors import (
    ForbiddenError,
    InternalServerError,
    InvalidArgumentError,
    NotFoundError,
    ServiceUnavailableError,
)
from controllers.console import flask_admission, wraps
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import DatasetNotInitializedError
from controllers.console.datasets.hit_testing import HitTestingApi
from fields.hit_testing_fields import HitTestingPayload
from fields.hit_testing_fields import HitTestingResponse as HitTestingResponseModel
from libs.external_api import ExternalApi
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account
from services.errors.index import IndexNotInitializedError
from services.errors.knowledge_retrieval import KnowledgeRetrievalUnavailableError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse
from services.knowledge.hit_testing.errors import (
    HitTestingFailedError,
    HitTestingInvocationError,
    HitTestingProviderError,
    HitTestingUnsupportedInputError,
    HitTestingUpstreamError,
)


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
            "keywords": [],
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
        "child_chunks": [],
        "files": [
            {
                "id": "file-1",
                "name": "attachment.bin",
                "size": 4,
                "extension": "bin",
                "mime_type": "application/octet-stream",
                "source_url": "https://example.com/attachment.bin",
            }
        ],
        "score": 0.8,
        "tsne_position": None,
        "summary": None,
    }


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
            "sign_content": None,
            "answer": None,
            "word_count": 2,
            "tokens": 3,
            "keywords": [],
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
        "child_chunks": [],
        "files": [
            {
                "id": "file-1",
                "name": "attachment.bin",
                "size": 4,
                "extension": "bin",
                "mime_type": "application/octet-stream",
                "source_url": "https://example.com/attachment.bin",
            }
        ],
        "score": 0.8,
        "tsne_position": None,
        "summary": None,
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


def test_empty_external_retrieval_settings_preserve_dataset_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    service = HitTestingStub(response={"query": {"content": "hello"}, "records": []})
    payload = HitTestingPayload.model_validate({"query": "hello", "external_retrieval_model": {}})

    _invoke(monkeypatch, service, payload)

    assert service.calls[0][2].external_retrieval_model is None


def test_hit_testing_response_serializes_internal_record(
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
    files = record["files"]
    assert isinstance(files, list)
    assert files[0]["mime_type"] == "application/octet-stream"
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


def test_hit_testing_response_schema_requires_file_mime_type() -> None:
    schema = HitTestingResponseModel.model_json_schema(mode="serialization")
    mime_type = schema["$defs"]["HitTestingFile"]["properties"]["mime_type"]
    assert mime_type["type"] == "string"
    assert "mime_type" in schema["$defs"]["HitTestingFile"]["required"]


@pytest.mark.parametrize(
    ("error", "status", "code", "message"),
    [
        (DatasetNotFoundError(), 404, "not_found", "Dataset not found."),
        (
            DatasetAccessDeniedError(),
            403,
            "forbidden",
            ForbiddenError.description,
        ),
        (
            HitTestingUpstreamError("sensitive upstream details"),
            500,
            "internal_server_error",
            InternalServerError.description,
        ),
        (
            HitTestingFailedError("sensitive failure details"),
            500,
            "internal_server_error",
            InternalServerError.description,
        ),
        (
            KnowledgeRetrievalUnavailableError("indexing"),
            503,
            "service_unavailable",
            "The knowledge index is temporarily unavailable. Please retry later.",
        ),
        (
            ValueError("sensitive invalid request details"),
            400,
            "invalid_param",
            "Invalid hit testing request.",
        ),
        (
            HitTestingUnsupportedInputError("External knowledge bases do not support attachment-only retrieval."),
            400,
            "invalid_param",
            "External knowledge bases do not support attachment-only retrieval.",
        ),
        (
            RuntimeError("sensitive unexpected details"),
            500,
            "internal_server_error",
            InternalServerError.description,
        ),
    ],
)
def test_serializes_dataset_failures(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    status: int,
    code: str,
    message: str,
) -> None:
    service = HitTestingStub(error=error)
    monkeypatch.setattr(
        module,
        "application_services",
        lambda: ApplicationServicesStub(KnowledgeServicesStub(service)),
    )
    app = Flask(__name__)
    app.config["RESTX_ERROR_404_HELP"] = False
    api = ExternalApi(app)

    class HitTestingResource(Resource):
        def post(self) -> dict[str, object]:
            return _invoke(monkeypatch, service, HitTestingPayload(query="query"))

    api.add_resource(HitTestingResource, "/hit-testing")
    response = app.test_client().post("/hit-testing")
    assert response.status_code == status
    assert response.get_json() == {"code": code, "message": message, "status": status}
    assert "sensitive" not in response.get_data(as_text=True)


def test_hit_testing_response_schema_accepts_internal_and_external_records() -> None:
    schema = HitTestingResponseModel.model_json_schema(mode="serialization")

    assert schema["properties"]["records"]["items"]["oneOf"] == [
        {"$ref": "#/$defs/HitTestingRecord"},
        {"$ref": "#/$defs/ExternalHitTestingRecordResponse"},
    ]


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (DatasetNotFoundError(), NotFoundError),
        (DatasetAccessDeniedError(), ForbiddenError),
        (IndexNotInitializedError(), DatasetNotInitializedError),
        (KnowledgeRetrievalUnavailableError("indexing"), ServiceUnavailableError),
        (HitTestingProviderError("missing", kind="uninitialized"), ProviderNotInitializeError),
        (HitTestingProviderError("quota", kind="quota"), ProviderQuotaExceededError),
        (HitTestingProviderError("unsupported", kind="unsupported"), ProviderModelCurrentlyNotSupportError),
        (HitTestingInvocationError("invoke"), CompletionRequestError),
        (HitTestingUpstreamError("upstream"), InternalServerError),
        (HitTestingFailedError("failed"), InternalServerError),
        (HitTestingUnsupportedInputError("unsupported input"), InvalidArgumentError),
        (ValueError("invalid"), InvalidArgumentError),
        (RuntimeError("unexpected"), InternalServerError),
    ],
)
def test_hit_testing_maps_application_errors(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
) -> None:
    with pytest.raises(expected):
        _invoke(monkeypatch, HitTestingStub(error=error), HitTestingPayload(query="hello"))


@pytest.mark.parametrize(
    "error",
    [
        HitTestingProviderError("sensitive provider details", kind="uninitialized"),
        HitTestingInvocationError("sensitive invocation details"),
        HitTestingUpstreamError("sensitive upstream details"),
        HitTestingFailedError("sensitive failure details"),
    ],
)
def test_hit_testing_hides_application_failure_details(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
) -> None:
    expected = (
        ProviderNotInitializeError
        if isinstance(error, HitTestingProviderError)
        else CompletionRequestError
        if isinstance(error, HitTestingInvocationError)
        else InternalServerError
    )
    with pytest.raises(expected) as exc_info:
        _invoke(
            monkeypatch,
            HitTestingStub(error=error),
            HitTestingPayload(query="hello"),
        )

    assert "sensitive" not in str(exc_info.value)
    assert exc_info.value.__cause__ is error


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
            raise ForbiddenError(description="rate limited")

    def check_rbac(**_kwargs: object) -> None:
        order.append("rbac")

    monkeypatch.setattr(wraps, "check_knowledge_rate_limit", check_limit)
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", check_rbac)
    with app.test_request_context(method="POST", json={"query": "query"}):
        if rate_limited:
            with pytest.raises(ForbiddenError, match="rate limited"):
                HitTestingApi().post(dataset_id=uuid.UUID("00000000-0000-0000-0000-000000000001"))
            assert not service.calls
            assert order == ["limit"]
        else:
            assert HitTestingApi().post(dataset_id=uuid.UUID("00000000-0000-0000-0000-000000000001")) == {
                "query": {"content": "query"},
                "records": [],
            }
            assert order == ["limit", "rbac"]


def test_forwards_context_and_parsed_retrieval_options(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = HitTestingPayload.model_validate(
        {
            "query": "query",
            "attachment_ids": ["upload"],
            "retrieval_model": {
                "search_method": "semantic_search",
                "reranking_enable": False,
                "top_k": 2,
                "score_threshold_enabled": False,
            },
        }
    )
    service = HitTestingStub(response={"query": {"content": "query"}, "records": []})
    result = _invoke(monkeypatch, service, payload)

    assert result == service.response
    context, dataset_id, request = service.calls[0]
    assert context == _context()
    assert dataset_id == "00000000-0000-0000-0000-000000000001"
    assert payload.retrieval_model is not None
    assert request == HitTestingRequest(
        query="query",
        retrieval_model=payload.retrieval_model.model_dump(exclude_none=True),
        external_retrieval_model=None,
        attachment_ids=["upload"],
    )
