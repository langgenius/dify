from dataclasses import replace
from inspect import unwrap
from unittest.mock import create_autospec
from uuid import UUID

import pytest
from flask import Flask
from flask_restx import Resource

from controllers.common.errors import InternalServerError, NotFoundError
from controllers.console import flask_admission, wraps
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets import hit_testing as controller
from controllers.console.datasets.error import DatasetAccessDeniedRequestError, DatasetNotInitializedError
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from fields.hit_testing_fields import HitTestingPayload
from libs.external_api import ExternalApi
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account
from services.errors.dataset import DatasetAccessDeniedError, DatasetNotFoundError
from services.errors.index import IndexNotInitializedError
from services.errors.knowledge_retrieval import HitTestingFailedError, HitTestingInvocationError
from services.knowledge.entities.hit_testing import HitTestingRequest
from services.knowledge.hit_testing.application import (
    HitTestingApplicationService,
)

CONTEXT = RequestContext("request", None, "actor", "tenant")
ID = UUID(int=1)


def hit_testing_record() -> dict[str, object]:
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
        "files": None,
        "score": 0.8,
    }


@pytest.fixture
def hit_testing(monkeypatch, account_application_services):
    service = create_autospec(HitTestingApplicationService, instance=True, spec_set=True)
    services = replace(
        account_application_services, knowledge=replace(account_application_services.knowledge, hit_testing=service)
    )
    monkeypatch.setattr(controller, "application_services", lambda: services)
    return service


def test_forwards_context_and_parsed_retrieval_options(hit_testing):
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
    hit_testing.hit_testing.return_value = {"query": {"content": "query"}, "records": []}
    result = unwrap(controller.HitTestingApi.post)(controller.HitTestingApi(), payload, CONTEXT, ID)
    assert result == hit_testing.hit_testing.return_value
    hit_testing.hit_testing.assert_called_once_with(
        CONTEXT,
        dataset_id=str(ID),
        request=HitTestingRequest(
            "query",
            payload.retrieval_model.model_dump(exclude_none=True),
            ["upload"],
        ),
    )


def test_normalizes_nullable_record_collections(hit_testing):
    record = hit_testing_record()
    hit_testing.hit_testing.return_value = {"query": {"content": "query"}, "records": [record]}
    result = unwrap(controller.HitTestingApi.post)(
        controller.HitTestingApi(), HitTestingPayload(query="query"), CONTEXT, ID
    )
    serialized = result["records"][0]
    assert serialized["segment"]["keywords"] == []
    assert serialized["segment"]["sign_content"] is None
    assert serialized["child_chunks"] == []
    assert serialized["files"] == []
    assert serialized["tsne_position"] is None
    assert serialized["summary"] is None
    assert record["segment"]["keywords"] is None


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (DatasetNotFoundError(), NotFoundError),
        (DatasetAccessDeniedError(), DatasetAccessDeniedRequestError),
        (IndexNotInitializedError(), DatasetNotInitializedError),
        (ProviderTokenNotInitError("missing"), ProviderNotInitializeError),
        (QuotaExceededError(), ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError(), ProviderModelCurrentlyNotSupportError),
        (LLMBadRequestError(), ProviderNotInitializeError),
        (HitTestingInvocationError("failed"), CompletionRequestError),
        (HitTestingFailedError("failed"), InternalServerError),
        (ValueError("invalid"), ValueError),
    ],
)
def test_maps_domain_failures(hit_testing, error, http_error):
    hit_testing.hit_testing.side_effect = error
    with pytest.raises(http_error) as failure:
        unwrap(controller.HitTestingApi.post)(controller.HitTestingApi(), HitTestingPayload(query="query"), CONTEXT, ID)
    if http_error is ValueError:
        assert failure.value is error
    else:
        assert failure.value.data == {
            "code": http_error.error_code,
            "message": failure.value.description,
            "status": http_error.code,
        }
        assert failure.value.__cause__ is error


@pytest.mark.parametrize(
    ("error", "status", "code", "message"),
    [
        (DatasetNotFoundError(), 404, "not_found", "Dataset not found."),
        (
            DatasetAccessDeniedError(),
            403,
            "dataset_access_denied",
            "You do not have permission to access this dataset",
        ),
        (HitTestingFailedError("failed"), 500, "internal_server_error", "failed"),
    ],
)
def test_serializes_dataset_failures(hit_testing, error, status, code, message):
    hit_testing.hit_testing.side_effect = error
    app = Flask(__name__)
    app.config["RESTX_ERROR_404_HELP"] = False
    api = ExternalApi(app)

    class HitTestingResource(Resource):
        def post(self):
            return unwrap(controller.HitTestingApi.post)(
                controller.HitTestingApi(), HitTestingPayload(query="query"), CONTEXT, ID
            )

    api.add_resource(HitTestingResource, "/hit-testing")
    response = app.test_client().post("/hit-testing")
    assert response.status_code == status
    assert response.get_json() == {"code": code, "message": message, "status": status}


@pytest.mark.parametrize("rate_limited", [False, True])
def test_admission_limits_before_rbac_and_injects_context(app: Flask, monkeypatch, hit_testing, rate_limited):
    account = Account(name="User", email="user@example.com")
    account.id = "actor"
    identity = AccountWithTenant(account, "tenant")
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr("libs.login._resolve_current_user", lambda: account)
    monkeypatch.setattr("libs.login.check_csrf_token", lambda _request, _account_id: None)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    order = []

    def check_limit():
        order.append("limit")
        if rate_limited:
            raise DatasetAccessDeniedRequestError(description="rate limited")

    def check_rbac(**kwargs):
        order.append("rbac")
        assert kwargs["tenant_id"] == "tenant"
        assert kwargs["account_id"] == "actor"
        assert kwargs["path_args"]["dataset_id"] == ID

    monkeypatch.setattr(wraps, "check_knowledge_rate_limit", check_limit)
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", check_rbac)
    hit_testing.hit_testing.return_value = {"query": {"content": "query"}, "records": []}
    with app.test_request_context(method="POST", json={"query": "query"}):
        if rate_limited:
            with pytest.raises(DatasetAccessDeniedRequestError):
                controller.HitTestingApi().post(dataset_id=ID)
            hit_testing.hit_testing.assert_not_called()
            assert order == ["limit"]
        else:
            assert controller.HitTestingApi().post(dataset_id=ID)["records"] == []
            context = hit_testing.hit_testing.call_args.args[0]
            assert context.account_id == "actor"
            assert context.active_workspace_id == "tenant"
            assert order == ["limit", "rbac"]
