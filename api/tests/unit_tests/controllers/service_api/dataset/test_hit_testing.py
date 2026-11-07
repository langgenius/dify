"""Thin Service API hit-testing controller tests."""

from dataclasses import dataclass, field
from inspect import unwrap
from unittest.mock import Mock, create_autospec
from uuid import UUID, uuid4

import pytest
from flask import Flask, request
from flask.testing import FlaskClient
from flask_login import LoginManager
from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized
from werkzeug.test import TestResponse

from controllers.common.errors import ForbiddenError, InternalServerError, NotFoundError, ServiceUnavailableError
from controllers.service_api import bp as service_api_bp
from controllers.service_api import flask_admission
from controllers.service_api.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.dataset import hit_testing as controller
from controllers.service_api.dataset.error import DatasetNotInitializedError
from fields.hit_testing_fields import HitTestingPayload
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset
from models.enums import ApiTokenType
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.errors.index import IndexNotInitializedError
from services.errors.knowledge_retrieval import KnowledgeRetrievalUnavailableError
from services.knowledge.admission.application import DatasetAdmissionService
from services.knowledge.admission.limits import KnowledgeApiLimitsError, KnowledgeApiRateLimitExceededError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.entities.external import ExternalRetrievalConfig
from services.knowledge.entities.knowledge_entities import RetrievalModel
from services.knowledge.hit_testing.application import HitTestingApplicationService
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse
from services.knowledge.hit_testing.errors import (
    HitTestingFailedError,
    HitTestingInvocationError,
    HitTestingProviderError,
    HitTestingUnsupportedInputError,
    HitTestingUpstreamError,
)


@dataclass
class _Runtime:
    client: FlaskClient
    service: Mock
    limits: "_LimitsStub"
    trace_ids: list[str]
    dataset_id: str
    tenant_id: str
    account_id: str
    token_id: str


@dataclass
class _LimitsStub:
    error: KnowledgeApiLimitsError | None = None

    def check(
        self,
        workspace_id: str,
        *,
        rate_limit: bool,
        billing_resources: tuple[str, ...],
        require_paid_segments: bool,
    ) -> None:
        del workspace_id, rate_limit, billing_resources, require_paid_segments
        if self.error is not None:
            raise self.error


class _AccountIdentityStub:
    def __init__(self, account: Account, workspace_id: str) -> None:
        self._account = account
        self._workspace_id = workspace_id

    def get_account_for_workspace(self, account_id: str, workspace_id: str) -> Account | None:
        if account_id == self._account.id and workspace_id == self._workspace_id:
            return self._account
        return None


@dataclass(frozen=True)
class _RuntimeKnowledgeServices:
    admission: DatasetAdmissionService
    hit_testing: Mock


@dataclass(frozen=True)
class _RuntimeAccountServices:
    identity: _AccountIdentityStub


@dataclass(frozen=True)
class _RuntimeApplicationServices:
    knowledge: _RuntimeKnowledgeServices
    accounts: _RuntimeAccountServices


@pytest.fixture
def runtime(
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> _Runtime:
    tenant_id = str(uuid4())
    account_id = str(uuid4())
    dataset_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Workspace")
        tenant.id = tenant_id
        account = Account(name="Owner", email=f"owner-{account_id}@example.com")
        account.id = account_id
        membership = TenantAccountJoin(
            tenant_id=tenant_id,
            account_id=account_id,
            role=TenantAccountRole.OWNER,
        )
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="Dataset",
            created_by=account_id,
            enable_api=True,
        )
        token = ApiToken(tenant_id=tenant_id, type=ApiTokenType.DATASET, token="test-token")
        session.add_all([tenant, account, membership, dataset, token])
        session.flush()
        token_id = token.id

    datasets = SQLAlchemyDatasetRepository(
        session_factory=sqlite_session_factory,
        revoke_keys_after_commit=lambda _session, _keys: None,
    )
    limits = _LimitsStub()
    admission = DatasetAdmissionService(
        datasets=datasets,
        keys=DatasetApiKeyRepository(session_factory=sqlite_session_factory),
        workspaces=WorkspaceRepository(sqlite_session_factory),
        limits=limits,
    )
    service = create_autospec(HitTestingApplicationService, instance=True, spec_set=True)
    service.retrieve.return_value = empty_hit_testing_response()
    services = _RuntimeApplicationServices(
        knowledge=_RuntimeKnowledgeServices(admission=admission, hit_testing=service),
        accounts=_RuntimeAccountServices(identity=_AccountIdentityStub(account, tenant_id)),
    )
    monkeypatch.setattr(flask_admission, "application_services", lambda: services)
    monkeypatch.setattr(controller, "application_services", lambda: services)
    monkeypatch.setattr(flask_admission, "current_user", account)
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request")
    get_current_trace_id = flask_admission.get_trace_id
    admitted_trace_ids: list[str] = []

    def record_current_trace_id() -> str:
        trace_id = get_current_trace_id()
        admitted_trace_ids.append(trace_id)
        return trace_id

    monkeypatch.setattr(flask_admission, "get_trace_id", record_current_trace_id)

    def validate_token(scope: str | None = None) -> ApiToken:
        if scope != "dataset" or request.headers.get("Authorization") != "Bearer test-token":
            raise Unauthorized()
        return token

    monkeypatch.setattr(flask_admission, "validate_and_get_api_token", validate_token)
    LoginManager(app)
    app.register_blueprint(service_api_bp)
    return _Runtime(
        client=app.test_client(),
        service=service,
        limits=limits,
        trace_ids=admitted_trace_ids,
        dataset_id=dataset_id,
        tenant_id=tenant_id,
        account_id=account_id,
        token_id=token_id,
    )


def _request(
    runtime: _Runtime,
    *,
    suffix: str = "retrieve",
    dataset_id: str | None = None,
    payload: dict[str, object] | None = None,
) -> TestResponse:
    return runtime.client.post(
        f"/v1/datasets/{dataset_id or runtime.dataset_id}/{suffix}",
        json={"query": "query"} if payload is None else payload,
        headers={"Authorization": "Bearer test-token", "X-Trace-Id": "trace"},
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
        "files": [],
        "score": 0.9,
        "tsne_position": None,
        "summary": None,
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
                ExternalRetrievalConfig(top_k=3),
                ["upload"],
            ),
        )
    ]


def test_empty_external_retrieval_settings_preserve_dataset_defaults(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = HitTestingServiceStub()
    payload = HitTestingPayload.model_validate({"query": "query", "external_retrieval_model": {}})

    _call_post(app, monkeypatch, service, payload, uuid4())

    assert service.calls[0][2].external_retrieval_model is None


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
        (KnowledgeRetrievalUnavailableError("indexing"), ServiceUnavailableError),
        (HitTestingProviderError("missing", kind="uninitialized"), ProviderNotInitializeError),
        (HitTestingProviderError("quota", kind="quota"), ProviderQuotaExceededError),
        (HitTestingProviderError("unsupported", kind="unsupported"), ProviderModelCurrentlyNotSupportError),
        (HitTestingInvocationError("invoke"), CompletionRequestError),
        (HitTestingUpstreamError("upstream"), InternalServerError),
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


def test_payload_preserves_public_validation_and_compatibility() -> None:
    assert HitTestingPayload.model_validate({"query": "query", "top_k": 3}).model_dump(exclude_none=True) == {
        "query": "query"
    }
    assert len(HitTestingPayload(query="x" * 250).query) == 250
    with pytest.raises(ValueError, match="query"):
        HitTestingPayload(query="x" * 251)


@pytest.mark.parametrize("suffix", ["retrieve", "hit-testing"])
def test_aliases_forward_admitted_owner_context(runtime: _Runtime, suffix: str) -> None:
    response = _request(runtime, suffix=suffix)
    assert response.status_code == 200
    assert response.get_json() == {"query": {"content": "query"}, "records": []}
    context = runtime.service.retrieve.call_args.args[0]
    assert context.account_id == runtime.account_id
    assert context.active_workspace_id == runtime.tenant_id
    assert context.request_id == "request"
    assert context.trace_id == (runtime.trace_ids[-1] or "trace")
    assert runtime.service.retrieve.call_args.kwargs == {
        "dataset_id": runtime.dataset_id,
        "request": HitTestingRequest("query", None, None, None),
    }


def test_http_empty_external_retrieval_settings_preserve_dataset_defaults(runtime: _Runtime) -> None:
    response = _request(runtime, payload={"query": "query", "external_retrieval_model": {}})

    assert response.status_code == 200
    request_model = runtime.service.retrieve.call_args.kwargs["request"]
    assert request_model.external_retrieval_model is None


def test_preserves_retrieval_options_and_metadata_filters(runtime: _Runtime) -> None:
    model = {
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
    response = _request(runtime, payload={"query": "query", "retrieval_model": model, "attachment_ids": ["upload"]})
    assert response.status_code == 200
    request = runtime.service.retrieve.call_args.kwargs["request"]
    assert request == HitTestingRequest(
        "query",
        RetrievalModel.model_validate(model).model_dump(exclude_none=True),
        None,
        ["upload"],
    )


def test_serializes_hit_testing_records(runtime: _Runtime) -> None:
    runtime.service.retrieve.return_value = {"query": {"content": "query"}, "records": [hit_testing_record()]}
    response = _request(runtime)
    assert response.status_code == 200
    record = response.get_json()["records"][0]
    assert record["segment"]["keywords"] == []
    assert record["segment"]["sign_content"] is None
    assert record["child_chunks"] == []
    assert record["files"] == []
    assert record["summary"] is None
    assert record["tsne_position"] is None


@pytest.mark.parametrize("payload", [{}, {"query": "x" * 251}, {"query": "query", "attachment_ids": "invalid"}])
def test_invalid_payload_never_reaches_application(runtime: _Runtime, payload: dict[str, object]) -> None:
    assert _request(runtime, payload=payload).status_code == 422
    runtime.service.retrieve.assert_not_called()


@pytest.mark.parametrize("authorization", [None, "Bearer invalid-token"])
def test_invalid_credentials_never_reach_application(runtime: _Runtime, authorization: str | None) -> None:
    response = runtime.client.post(
        f"/v1/datasets/{runtime.dataset_id}/retrieve",
        json={"query": "query"},
        headers={} if authorization is None else {"Authorization": authorization},
    )
    assert response.status_code == 401
    runtime.service.retrieve.assert_not_called()


@pytest.mark.parametrize("reason", ["missing", "foreign", "disabled", "key_scope", "archived", "no_owner"])
def test_token_admission_rejects_before_application(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], reason: str
) -> None:
    dataset_id = runtime.dataset_id
    with sqlite_session_factory.begin() as session:
        if reason == "missing":
            dataset_id = str(uuid4())
        elif reason == "foreign":
            foreign = Dataset(tenant_id=str(uuid4()), name="Foreign", created_by=str(uuid4()), enable_api=True)
            session.add(foreign)
            session.flush()
            dataset_id = foreign.id
        elif reason == "disabled":
            dataset = session.get(Dataset, runtime.dataset_id)
            assert dataset is not None
            dataset.enable_api = False
        elif reason == "key_scope":
            other_dataset = Dataset(
                tenant_id=runtime.tenant_id,
                name="Other",
                created_by=runtime.account_id,
                enable_api=True,
            )
            session.add(other_dataset)
            session.flush()
            session.add(DatasetApiTokenBinding(api_token_id=runtime.token_id, dataset_id=other_dataset.id))
        elif reason == "archived":
            tenant = session.get(Tenant, runtime.tenant_id)
            assert tenant is not None
            tenant.status = TenantStatus.ARCHIVE
        else:
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == runtime.tenant_id))
    response = _request(runtime, dataset_id=dataset_id)
    expected_status = 404 if reason in {"missing", "foreign"} else 403 if reason in {"disabled", "key_scope"} else 401
    assert response.status_code == expected_status
    runtime.service.retrieve.assert_not_called()


def test_billing_rate_limit_precedes_application(runtime: _Runtime) -> None:
    runtime.limits.error = KnowledgeApiRateLimitExceededError()
    response = _request(runtime)
    assert response.status_code == 403
    assert "rate limit" in response.get_json()["message"]
    runtime.service.retrieve.assert_not_called()


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [
        (DatasetNotFoundError(), 404, "not_found"),
        (DatasetAccessDeniedError(), 403, "forbidden"),
        (IndexNotInitializedError(), 400, "dataset_not_initialized"),
        (KnowledgeRetrievalUnavailableError("indexing"), 503, "service_unavailable"),
        (HitTestingFailedError("failed"), 500, "internal_server_error"),
        (HitTestingUnsupportedInputError("unsupported input"), 400, "invalid_param"),
        (ValueError("invalid"), 400, "invalid_param"),
    ],
)
def test_domain_errors_use_service_api_response_mapping(
    runtime: _Runtime, failure: Exception, status: int, code: str
) -> None:
    runtime.service.retrieve.side_effect = failure
    response = _request(runtime)
    assert response.status_code == status
    assert response.get_json()["code"] == code


def test_external_attachment_only_error_is_a_clear_client_failure(runtime: _Runtime) -> None:
    runtime.service.retrieve.side_effect = HitTestingUnsupportedInputError(
        "External knowledge bases do not support attachment-only retrieval."
    )

    response = _request(runtime, payload={"query": "", "attachment_ids": ["upload-file-id"]})

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_param",
        "message": "External knowledge bases do not support attachment-only retrieval.",
        "status": 400,
    }


def test_unavailable_index_uses_standard_safe_service_response(runtime: _Runtime) -> None:
    failure = KnowledgeRetrievalUnavailableError("indexing")
    runtime.service.retrieve.side_effect = failure

    response = _request(runtime)

    assert response.status_code == 503
    assert response.get_json() == {
        "code": "service_unavailable",
        "message": "The knowledge index is temporarily unavailable. Please retry later.",
        "status": 503,
    }
    assert str(failure) not in response.get_data(as_text=True)


class TestHitTestingPayload:
    def test_required_query(self) -> None:
        assert HitTestingPayload(query="query").query == "query"

    def test_optional_fields(self) -> None:
        payload = HitTestingPayload(query="", attachment_ids=["upload"])
        assert payload.attachment_ids == ["upload"]

    def test_schema_advertises_external_retrieval_settings(self) -> None:
        assert "external_retrieval_model" in HitTestingPayload.model_json_schema()["properties"]

    def test_query_max_length(self) -> None:
        assert len(HitTestingPayload(query="x" * 250).query) == 250
        with pytest.raises(ValueError, match="1 validation error for HitTestingPayload\\\nquery"):
            HitTestingPayload(query="x" * 251)

    def test_external_retrieval_settings_are_validated_while_unknown_fields_remain_ignored(self) -> None:
        payload = HitTestingPayload.model_validate(
            {"query": "query", "top_k": 3, "external_retrieval_model": {"top_k": 3}}
        )
        assert payload.model_dump(exclude_none=True) == {
            "query": "query",
            "external_retrieval_model": {
                "top_k": 3,
            },
        }

    def test_empty_external_settings_inherit_dataset_configuration(self) -> None:
        payload = HitTestingPayload.model_validate({"query": "query", "external_retrieval_model": {}})
        assert payload.external_retrieval_model is not None
        assert payload.external_retrieval_model.to_domain() is None
        assert payload.model_dump(exclude_none=True) == {"query": "query", "external_retrieval_model": {}}
