"""External knowledge retrieval behavior at its network and ownership boundaries."""

import json

import httpx
import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.dataset_access import DatasetNotFoundError
from services.knowledge.entities.external import ExternalKnowledgeApiSetting, ExternalRetrievalConfig
from services.knowledge.external.adapters import ExternalKnowledgeGateway


def _request() -> ExternalKnowledgeApiSetting:
    return ExternalKnowledgeApiSetting(
        url="https://example.com/retrieval",
        headers={"Authorization": "Bearer secret", "Content-Type": "application/json"},
        params={"knowledge_id": "knowledge", "query": "hello"},
    )


def test_endpoint_validation_sends_minimal_retrieval_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict[str, object] = {}

    def post(url: str, **kwargs: object) -> httpx.Response:
        sent.update({"url": url, **kwargs})
        return httpx.Response(200)

    monkeypatch.setattr("services.knowledge.external.adapters.ssrf_proxy.post", post)
    ExternalKnowledgeGateway.check_endpoint_and_api_key({"endpoint": "https://example.com", "api_key": "secret"})

    assert sent["url"] == "https://example.com/retrieval"
    assert sent["headers"] == {
        "Authorization": "Bearer secret",
        "Content-Type": "application/json",
    }
    assert json.loads(str(sent["data"])) == {
        "knowledge_id": "",
        "query": "",
        "retrieval_setting": {"top_k": 1, "score_threshold": 0.0},
    }


@pytest.mark.parametrize(
    ("settings", "message"),
    [
        ({"api_key": "secret"}, "endpoint is required"),
        ({"endpoint": "https://example.com"}, "api_key is required"),
        ({"endpoint": "example.com", "api_key": "secret"}, "must start with http:// or https://"),
    ],
)
def test_endpoint_validation_rejects_incomplete_or_invalid_settings(
    settings: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)


@pytest.mark.parametrize(
    ("status_code", "message"),
    [(403, "Authorization failed"), (404, "Not Found"), (502, "Bad Gateway")],
)
def test_endpoint_validation_normalizes_probe_failures_without_echoing_secret(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    message: str,
) -> None:
    monkeypatch.setattr(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        lambda *_args, **_kwargs: httpx.Response(status_code),
    )

    with pytest.raises(ValueError, match=message) as raised:
        ExternalKnowledgeGateway.check_endpoint_and_api_key(
            {"endpoint": "https://example.com", "api_key": "private-secret"}
        )
    assert "private-secret" not in str(raised.value)


def test_retrieval_request_uses_tenant_owned_binding(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    template = ExternalKnowledgeApis(
        tenant_id="tenant",
        created_by="actor",
        updated_by="actor",
        name="API",
        description="",
        settings=json.dumps({"endpoint": "https://example.com", "api_key": "secret"}),
    )
    template.id = "template"
    sqlite_session.add_all(
        [
            template,
            Dataset(
                id="dataset",
                tenant_id="tenant",
                created_by="actor",
                name="Dataset",
                provider="external",
            ),
            ExternalKnowledgeBindings(
                tenant_id="tenant",
                dataset_id="dataset",
                external_knowledge_api_id=template.id,
                external_knowledge_id="knowledge",
                created_by="actor",
            ),
        ]
    )
    sqlite_session.commit()

    repository = SQLAlchemyExternalKnowledgeRepository(session_factory=sqlite_session_factory)
    request = repository.get_retrieval_request(
        tenant_id="tenant",
        dataset_id="dataset",
        query="hello",
        retrieval_model=ExternalRetrievalConfig(top_k=3, score_threshold_enabled=True, score_threshold=0.5),
        metadata_filters=None,
    )
    assert request is not None
    assert request.endpoint == "https://example.com"
    assert request.api_key == "secret"
    assert request.knowledge_id == "knowledge"
    assert request.query == "hello"
    prepared = ExternalKnowledgeGateway.build_external_knowledge_retrieval_request(request)
    assert prepared.url == "https://example.com/retrieval"
    assert prepared.headers == {"Content-Type": "application/json", "Authorization": "Bearer secret"}
    assert prepared.params == {
        "retrieval_setting": {"top_k": 3, "score_threshold": 0.5},
        "query": "hello",
        "knowledge_id": "knowledge",
        "metadata_condition": None,
    }

    with pytest.raises(DatasetNotFoundError):
        repository.get_retrieval_request(
            tenant_id="other",
            dataset_id="dataset",
            query="hello",
            retrieval_model=None,
            metadata_filters=None,
        )


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(502, text="unavailable"),
        httpx.Response(200, content=b"{"),
        httpx.Response(200, json=[]),
        httpx.Response(200, json={"records": {}}),
    ],
)
def test_execute_retrieval_normalizes_transport_contract_failures(
    monkeypatch: pytest.MonkeyPatch,
    response: httpx.Response,
) -> None:
    def sender(*_args: object, **_kwargs: object) -> httpx.Response:
        return response

    monkeypatch.setattr("services.knowledge.external.adapters.ssrf_proxy.post", sender)

    with pytest.raises(ExternalKnowledgeRetrievalError):
        ExternalKnowledgeGateway.execute_external_knowledge_retrieval(_request())


def test_execute_retrieval_returns_records(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        lambda *_args, **_kwargs: httpx.Response(200, json={"records": [{"content": "answer"}]}),
    )

    records = ExternalKnowledgeGateway.execute_external_knowledge_retrieval(_request())
    assert len(records) == 1
    assert records[0].content == "answer"
