"""Service API retrieval uses shared application services after token admission."""

from collections.abc import Iterator
from dataclasses import dataclass, replace
from unittest.mock import Mock, create_autospec
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_login import LoginManager
from sqlalchemy import delete
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.test import TestResponse

from controllers.common.errors import UnauthorizedError
from controllers.service_api import bp, wraps
from controllers.service_api.dataset import hit_testing as controller
from extensions.ext_application_services import ApplicationServices
from fields.hit_testing_fields import HitTestingPayload
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset
from models.enums import ApiTokenType
from models.model import ApiToken, DatasetApiTokenBinding
from services.entities.feature_entities import KnowledgeRateLimitModel
from services.errors.dataset import DatasetAccessDeniedError, DatasetNotFoundError
from services.errors.index import IndexNotInitializedError
from services.errors.knowledge_retrieval import HitTestingFailedError
from services.knowledge.entities.hit_testing import HitTestingRequest, RetrieveResponseDict
from services.knowledge.entities.knowledge_entities import RetrievalModel
from services.knowledge.hit_testing.application import HitTestingApplicationService
from tests.unit_tests.controllers.console.datasets.test_hit_testing import hit_testing_record


@dataclass(frozen=True)
class _Database:
    engine: Engine
    session: scoped_session[Session]


@dataclass(frozen=True)
class _Runtime:
    client: FlaskClient
    service: Mock
    dataset_id: str
    tenant_id: str
    account_id: str
    token_id: str


@pytest.fixture
def runtime(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> Iterator[_Runtime]:
    tenant = Tenant(name="Workspace")
    account = Account(name="Owner", email="owner@example.com")
    dataset = Dataset(tenant_id=tenant.id, name="Dataset", created_by=account.id, enable_api=True)
    token = ApiToken(tenant_id=tenant.id, type=ApiTokenType.DATASET, token="test-token")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                dataset,
                token,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )

    sessions = scoped_session(sqlite_session_factory)
    monkeypatch.setattr(wraps, "db", _Database(engine=sqlite_engine, session=sessions))

    def validate_token(scope: str | None = None) -> ApiToken:
        assert scope == "dataset"
        if wraps.extract_service_api_bearer_token() != token.token:
            raise UnauthorizedError(description="Invalid API token")
        return token

    validation = create_autospec(wraps.validate_and_get_api_token, spec_set=True, side_effect=validate_token)
    monkeypatch.setattr(wraps, "validate_and_get_api_token", validation)
    monkeypatch.setattr(wraps.FeatureService, "get_knowledge_rate_limit", lambda _tenant_id: KnowledgeRateLimitModel())
    monkeypatch.setattr(wraps, "get_request_id", lambda: "request")
    monkeypatch.setattr(wraps, "get_trace_id", lambda: "")
    service = create_autospec(HitTestingApplicationService, instance=True, spec_set=True)
    result: RetrieveResponseDict = {"query": {"content": "query"}, "records": []}
    service.hit_testing.return_value = result
    services = replace(
        account_application_services, knowledge=replace(account_application_services.knowledge, hit_testing=service)
    )
    monkeypatch.setattr(controller, "application_services", lambda: services)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    LoginManager(app)
    app.register_blueprint(bp)
    try:
        yield _Runtime(app.test_client(), service, dataset.id, tenant.id, account.id, token.id)
    finally:
        sessions.remove()


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


@pytest.mark.parametrize("suffix", ["retrieve", "hit-testing"])
def test_aliases_forward_admitted_owner_context(runtime: _Runtime, suffix: str) -> None:
    response = _request(runtime, suffix=suffix)
    assert response.status_code == 200
    assert response.get_json() == {"query": {"content": "query"}, "records": []}
    context = runtime.service.hit_testing.call_args.args[0]
    assert context.account_id == runtime.account_id
    assert context.active_workspace_id == runtime.tenant_id
    assert context.request_id == "request"
    assert context.trace_id == "trace"
    assert runtime.service.hit_testing.call_args.kwargs == {
        "dataset_id": runtime.dataset_id,
        "request": HitTestingRequest("query", None, None),
    }


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
    request = runtime.service.hit_testing.call_args.kwargs["request"]
    assert request == HitTestingRequest(
        "query", RetrievalModel.model_validate(model).model_dump(exclude_none=True), ["upload"]
    )


def test_normalizes_nullable_response_collections(runtime: _Runtime) -> None:
    runtime.service.hit_testing.return_value = {"query": {"content": "query"}, "records": [hit_testing_record()]}
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
    assert _request(runtime, payload=payload).status_code == 400
    runtime.service.hit_testing.assert_not_called()


@pytest.mark.parametrize("authorization", [None, "Bearer invalid-token"])
def test_invalid_credentials_never_reach_application(runtime: _Runtime, authorization: str | None) -> None:
    response = runtime.client.post(
        f"/v1/datasets/{runtime.dataset_id}/retrieve",
        json={"query": "query"},
        headers={} if authorization is None else {"Authorization": authorization},
    )
    assert response.status_code == 401
    runtime.service.hit_testing.assert_not_called()


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
            session.add(DatasetApiTokenBinding(api_token_id=runtime.token_id, dataset_id=str(uuid4())))
        elif reason == "archived":
            tenant = session.get(Tenant, runtime.tenant_id)
            assert tenant is not None
            tenant.status = TenantStatus.ARCHIVE
        else:
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == runtime.tenant_id))
    response = _request(runtime, dataset_id=dataset_id)
    expected_status = 404 if reason in {"missing", "foreign"} else 403 if reason in {"disabled", "key_scope"} else 401
    assert response.status_code == expected_status
    runtime.service.hit_testing.assert_not_called()


def test_billing_rate_limit_precedes_application(runtime: _Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        wraps.FeatureService,
        "get_knowledge_rate_limit",
        lambda _tenant_id: KnowledgeRateLimitModel(enabled=True, limit=1, subscription_plan="pro"),
    )
    monkeypatch.setattr(wraps.redis_client, "zcard", lambda _key: 2)
    response = _request(runtime)
    assert response.status_code == 403
    assert "rate limit" in response.get_json()["message"]
    runtime.service.hit_testing.assert_not_called()


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [
        (DatasetNotFoundError(), 404, "not_found"),
        (DatasetAccessDeniedError(), 403, "dataset_access_denied"),
        (IndexNotInitializedError(), 400, "dataset_not_initialized"),
        (HitTestingFailedError("failed"), 500, "internal_server_error"),
        (ValueError("invalid"), 400, "invalid_param"),
    ],
)
def test_domain_errors_use_shared_response_mapping(
    runtime: _Runtime, failure: Exception, status: int, code: str
) -> None:
    runtime.service.hit_testing.side_effect = failure
    response = _request(runtime)
    assert response.status_code == status
    assert response.get_json()["code"] == code


class TestHitTestingPayload:
    def test_required_query(self) -> None:
        assert HitTestingPayload(query="query").query == "query"

    def test_optional_fields(self) -> None:
        payload = HitTestingPayload(query="", attachment_ids=["upload"], external_retrieval_model={"top_k": 3})
        assert payload.attachment_ids == ["upload"]
        assert payload.external_retrieval_model == {"top_k": 3}

    def test_query_max_length(self) -> None:
        assert len(HitTestingPayload(query="x" * 250).query) == 250
        with pytest.raises(ValueError, match="1 validation error for HitTestingPayload\\\nquery"):
            HitTestingPayload(query="x" * 251)

    def test_unknown_fields_remain_ignored(self) -> None:
        assert HitTestingPayload.model_validate({"query": "query", "top_k": 3}).model_dump(exclude_none=True) == {
            "query": "query"
        }
