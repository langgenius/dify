from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from flask import Flask
from flask.testing import FlaskClient
from werkzeug.test import TestResponse

from controllers.service_api import bp as service_api_bp
from controllers.service_api.appdeploy import knowledge as controller
from core.workflow.nodes.knowledge_retrieval.retrieval import Source, SourceMetadata
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInvalidError,
)
from services.entities.knowledge_retrieval_inner import InnerKnowledgeRetrieveResponse, InnerKnowledgeRetrieveUsage
from services.errors.knowledge_retrieval import InnerKnowledgeRetrieveDatasetNotFoundError

URL = "/v1/appdeploy/knowledge/retrieve"
DATASET_ID = "5b3a1c2e-7f64-4c1d-9e0a-2f8b6d4c3a10"
APP_ID = "9d2e4f6a-1b3c-4d5e-8f70-a1b2c3d4e5f6"
RETRIEVE = "controllers.service_api.appdeploy.knowledge.InnerKnowledgeRetrievalService.retrieve"


@pytest.fixture
def client() -> FlaskClient:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(service_api_bp)
    return app.test_client()


@dataclass
class _Tokens:
    """Records authorization calls; ``error`` is raised instead of returning the token's tenant."""

    error: Exception | None = None
    authorized: list[dict[str, object]] = field(default_factory=list)

    def authorize_appdeploy_knowledge(self, **kwargs: object) -> str:
        self.authorized.append(kwargs)
        if self.error is not None:
            raise self.error
        return "tenant-from-token"


@dataclass
class _Services:
    resource_access_tokens: _Tokens


@pytest.fixture
def tokens(monkeypatch: pytest.MonkeyPatch) -> _Tokens:
    service = _Tokens()
    monkeypatch.setattr(controller, "application_services", lambda: _Services(resource_access_tokens=service))
    return service


def _payload(**overrides: object) -> dict[str, object]:
    return {
        "caller": {"user_id": "end-user-1", "app_id": APP_ID, "user_from": "end-user", "invoke_from": "service-api"},
        "dataset_ids": [DATASET_ID.upper()],
        "query": "reset password",
        "retrieval": {"mode": "multiple", "top_k": 4},
        **overrides,
    }


def _post(client: FlaskClient, payload: dict[str, object], token: str | None = "sk-managed") -> TestResponse:
    headers: dict[str, str] = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(URL, json=payload, headers=headers)


def _response() -> InnerKnowledgeRetrieveResponse:
    return InnerKnowledgeRetrieveResponse(
        results=[
            Source(
                metadata=SourceMetadata(
                    dataset_id=DATASET_ID,
                    dataset_name="Docs",
                    document_id="document-1",
                    document_name="FAQ.md",
                    data_source_type="upload_file",
                ),
                title="FAQ.md",
                content="Reset your password from settings.",
            )
        ],
        usage=InnerKnowledgeRetrieveUsage(
            prompt_tokens=3,
            completion_tokens=2,
            total_tokens=5,
            prompt_unit_price="0",
            completion_unit_price="0",
            prompt_price_unit="0.001",
            completion_price_unit="0.001",
            prompt_price="0",
            completion_price="0",
            total_price="0",
            currency="USD",
            latency=0,
        ),
    )


def test_missing_bearer_token_is_rejected_before_authorization(client: FlaskClient, tokens: _Tokens) -> None:
    with patch(RETRIEVE) as retrieve:
        response = _post(client, _payload(), token=None)

    assert response.status_code == 401
    assert tokens.authorized == []
    retrieve.assert_not_called()


def test_tenant_comes_from_the_token_and_results_keep_the_node_shape(client: FlaskClient, tokens: _Tokens) -> None:
    with patch(RETRIEVE, return_value=_response()) as retrieve:
        response = _post(client, _payload())

    assert response.status_code == 200
    assert tokens.authorized == [{"token": "sk-managed", "dataset_ids": [DATASET_ID]}]
    request = retrieve.call_args.args[0]
    assert request.caller.tenant_id == "tenant-from-token"
    assert request.caller.app_id == APP_ID
    assert request.dataset_ids == [DATASET_ID]
    body = response.get_json()
    assert body["results"][0]["metadata"]["_source"] == "knowledge"
    assert body["usage"]["total_tokens"] == 5


@pytest.mark.parametrize(
    "payload",
    [
        _payload(caller={**_payload()["caller"], "tenant_id": "attacker-tenant"}),  # type: ignore[dict-item]
        _payload(attachment_ids=["file-1"]),
        _payload(dataset_ids=[]),
        _payload(caller={**_payload()["caller"], "app_id": "app-1"}),  # type: ignore[dict-item]
    ],
)
def test_invalid_payload_is_rejected_before_authorization(
    client: FlaskClient, tokens: _Tokens, payload: dict[str, object]
) -> None:
    with patch(RETRIEVE) as retrieve:
        response = _post(client, payload)

    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_request"
    assert tokens.authorized == []
    retrieve.assert_not_called()


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ResourceAccessTokenInvalidError("Resource access token is invalid."), 401),
        (ResourceAccessTokenForbiddenError("not allowed to access this knowledge base."), 403),
    ],
)
def test_token_denials_never_reach_retrieval(
    client: FlaskClient, tokens: _Tokens, error: Exception, status: int
) -> None:
    tokens.error = error
    with patch(RETRIEVE) as retrieve:
        response = _post(client, _payload())

    assert response.status_code == status
    retrieve.assert_not_called()


@pytest.mark.usefixtures("tokens")
def test_retrieval_failures_use_the_inner_error_codes(client: FlaskClient) -> None:
    with patch(RETRIEVE, side_effect=InnerKnowledgeRetrieveDatasetNotFoundError("Datasets not found: x")):
        response = _post(client, _payload())

    assert response.status_code == 404
    assert response.get_json()["code"] == "dataset_not_found"
