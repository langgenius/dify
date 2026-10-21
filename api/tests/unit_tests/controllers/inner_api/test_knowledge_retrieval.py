"""Unit tests for the plugin inner knowledge retrieval controller."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from unittest.mock import Mock, patch

import httpx
import pytest
from flask import Flask
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from controllers.inner_api import bp as inner_api_bp
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import Source, SourceMetadata
from models.dataset import ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalKnowledgeApiSetting
from services.entities.knowledge_retrieval_inner import InnerKnowledgeRetrieveResult, InnerKnowledgeRetrieveUsage
from services.errors.knowledge_retrieval import (
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveConfigError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
    InnerKnowledgeRetrieveExternalError,
    InnerKnowledgeRetrieveRateLimitError,
)
from services.knowledge.external import service as external_service
from services.knowledge.retrieval.adapters import (
    SQLAlchemyInnerKnowledgeRetrievalScope,
    WorkflowKnowledgeRetrievalGateway,
)
from services.knowledge.retrieval.application import InnerKnowledgeRetrievalService
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app, make_dataset, make_document


@dataclass(frozen=True)
class _KnowledgeServices:
    inner_retrieval: InnerKnowledgeRetrievalService


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


@pytest.fixture
def inner_api_app(sqlite_session_factory: sessionmaker[Session]) -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    services = _ApplicationServices(
        knowledge=_KnowledgeServices(
            inner_retrieval=InnerKnowledgeRetrievalService(
                scope=SQLAlchemyInnerKnowledgeRetrievalScope(session_factory=sqlite_session_factory),
                retrieval=WorkflowKnowledgeRetrievalGateway(session_factory=sqlite_session_factory),
            )
        )
    )
    app.extensions["application_services"] = services
    app.register_blueprint(inner_api_bp)
    return app


def _headers(api_key: str | None = "inner-key") -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key is not None:
        headers["X-Inner-Api-Key"] = api_key
    return headers


def _payload() -> dict[str, object]:
    return {
        "caller": {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "app_id": "app-1",
            "user_from": "account",
            "invoke_from": "workflow",
        },
        "dataset_ids": ["dataset-1"],
        "query": "reset password",
        "retrieval": {
            "mode": "multiple",
            "top_k": 4,
        },
        "metadata_filtering": {
            "mode": "disabled",
        },
        "attachment_ids": [],
    }


@contextmanager
def _plugin_inner_auth() -> Generator[None]:
    with (
        config_overrides_context(PLUGIN_DAEMON_KEY="plugin-daemon-key", INNER_API_KEY_FOR_PLUGIN="inner-key"),
    ):
        yield


@pytest.mark.parametrize("metadata_mode", ["disabled", "manual"])
@pytest.mark.parametrize("provider_fails", [False, True])
def test_inner_entry_releases_validation_connections_before_external_http(
    inner_api_app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    metadata_mode: str,
    provider_fails: bool,
) -> None:
    dataset = make_dataset(provider="external", indexing_technique="high_quality", enable_api=False)
    dataset.retrieval_model = {"top_k": 4, "score_threshold_enabled": False}
    document = make_document(doc_metadata={"category": "pricing"})
    document.indexing_status = "completed"
    template = ExternalKnowledgeApis(
        tenant_id="tenant-1",
        name="Provider",
        description="",
        created_by="user-1",
        updated_by="user-1",
        settings=json.dumps({"endpoint": "https://provider.example", "api_key": "secret"}),
    )
    template.id = "template-1"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_app(),
                dataset,
                document,
                template,
                ExternalKnowledgeBindings(
                    tenant_id="tenant-1",
                    dataset_id="dataset-1",
                    external_knowledge_api_id="template-1",
                    external_knowledge_id="knowledge-1",
                    created_by="user-1",
                ),
            ]
        )

    active: set[object] = set()
    connections_during_http: list[int] = []
    app_reads: list[str] = []

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        active.add(record)

    def checkin(_connection: object, record: object) -> None:
        active.discard(record)

    def executed(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if "FROM apps" in statement:
            app_reads.append(statement)

    def send(request: ExternalKnowledgeApiSetting) -> httpx.Response:
        connections_during_http.append(len(active))
        assert request.params is not None
        assert request.params["knowledge_id"] == "knowledge-1"
        return (
            httpx.Response(502, text="provider failed")
            if provider_fails
            else httpx.Response(
                200,
                json={
                    "records": [{"content": "Pricing information", "title": "Pricing", "score": 0.9, "metadata": {}}]
                },
            )
        )

    monkeypatch.setattr(external_service, "_send_external_knowledge_request", send)
    monkeypatch.setattr(DatasetRetrieval, "_check_knowledge_rate_limit", lambda *_args: None)
    monkeypatch.setattr(DatasetRetrieval, "_on_query", lambda *_args: None)
    monkeypatch.setattr(DatasetRetrieval, "_on_retrieval_end", lambda *_args, **_kwargs: None)
    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    event.listen(sqlite_engine, "before_cursor_execute", executed)
    try:
        payload = _payload()
        payload["retrieval"] = {"mode": "multiple", "top_k": 4, "reranking_enable": False}
        payload["metadata_filtering"] = (
            {
                "mode": "manual",
                "conditions": {
                    "logical_operator": "and",
                    "conditions": [{"name": "category", "comparison_operator": "is", "value": "pricing"}],
                },
            }
            if metadata_mode == "manual"
            else {"mode": "disabled"}
        )
        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve", json=payload, headers=_headers()
            )
        assert not active
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
        event.remove(sqlite_engine, "before_cursor_execute", executed)

    assert len(app_reads) == 1
    assert connections_during_http == [0]
    assert response.status_code == 200
    if provider_fails:
        assert response.get_json()["results"] == []
    else:
        assert response.get_json()["results"][0]["content"] == "Pricing information"


class TestInnerKnowledgeRetrieveApi:
    def test_post_returns_404_when_plugin_bridge_is_disabled(self, inner_api_app: Flask) -> None:
        with config_overrides_context(PLUGIN_DAEMON_KEY="", INNER_API_KEY_FOR_PLUGIN="inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve", json=_payload(), headers=_headers()
            )
        assert response.status_code == 404

    def test_post_returns_404_when_api_key_missing(self, inner_api_app: Flask) -> None:
        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(api_key=None),
            )

        assert response.status_code == 404

    def test_post_returns_404_when_api_key_invalid(self, inner_api_app: Flask) -> None:
        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(api_key="wrong-key"),
            )

        assert response.status_code == 404

    def test_post_returns_400_for_invalid_body(self, inner_api_app: Flask) -> None:
        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json={"caller": {"tenant_id": "tenant-1"}},
                headers=_headers(),
            )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_request"

    @patch("services.knowledge.retrieval.application.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_404_for_service_not_found_error(self, mock_retrieve: Mock, inner_api_app: Flask) -> None:
        mock_retrieve.side_effect = InnerKnowledgeRetrieveAppNotFoundError("app missing")

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 404
        assert response.get_json()["code"] == "app_not_found"

    @patch("services.knowledge.retrieval.application.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_403_for_service_forbidden_error(self, mock_retrieve: Mock, inner_api_app: Flask) -> None:
        mock_retrieve.side_effect = InnerKnowledgeRetrieveDatasetTenantMismatchError("wrong tenant")

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 403
        assert response.get_json()["code"] == "dataset_tenant_mismatch"

    @patch("services.knowledge.retrieval.application.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_422_for_retrieval_config_value_error(self, mock_retrieve: Mock, inner_api_app: Flask) -> None:
        mock_retrieve.side_effect = InnerKnowledgeRetrieveConfigError("invalid reranking config")

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 422
        assert response.get_json()["code"] == "retrieval_config_invalid"

    @patch("services.knowledge.retrieval.application.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_429_for_rate_limit_error(self, mock_retrieve: Mock, inner_api_app: Flask) -> None:
        mock_retrieve.side_effect = InnerKnowledgeRetrieveRateLimitError("knowledge rate limited")

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 429
        assert response.get_json()["code"] == "knowledge_rate_limited"

    def test_post_returns_400_for_manual_metadata_without_conditions(self, inner_api_app: Flask) -> None:
        payload = _payload()
        payload["metadata_filtering"] = {"mode": "manual"}

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=payload,
                headers=_headers(),
            )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_request"

    def test_post_returns_400_for_automatic_metadata_without_model_config(self, inner_api_app: Flask) -> None:
        payload = _payload()
        payload["metadata_filtering"] = {"mode": "automatic"}

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=payload,
                headers=_headers(),
            )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_request"

    @patch("services.knowledge.retrieval.application.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_502_for_external_knowledge_failure(self, mock_retrieve: Mock, inner_api_app: Flask) -> None:
        mock_retrieve.side_effect = InnerKnowledgeRetrieveExternalError("upstream failed")

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 502
        assert response.get_json()["code"] == "external_knowledge_failed"

    @patch("services.knowledge.retrieval.application.InnerKnowledgeRetrievalService.retrieve")
    @pytest.mark.parametrize("trace_id", [None, "trace-context"])
    def test_post_returns_service_response(
        self,
        mock_retrieve: Mock,
        inner_api_app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        trace_id: str | None,
    ) -> None:
        monkeypatch.setattr("controllers.inner_api.wraps.get_request_id", lambda: "request-1")
        monkeypatch.setattr("controllers.inner_api.wraps.get_trace_id", lambda: trace_id)
        mock_retrieve.return_value = InnerKnowledgeRetrieveResult(
            results=[
                Source(
                    metadata=SourceMetadata(
                        dataset_id="dataset-1",
                        dataset_name="Docs",
                        document_id="document-1",
                        document_name="FAQ.md",
                        data_source_type="upload_file",
                    ),
                    title="FAQ.md",
                    files=[],
                    content="Reset your password from settings.",
                    summary=None,
                ).model_dump(mode="json")
            ],
            usage=InnerKnowledgeRetrieveUsage(
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
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

        with _plugin_inner_auth():
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers={**_headers(), "X-Trace-Id": "trace-header"},
            )

        assert response.status_code == 200
        context, payload = mock_retrieve.call_args.args
        assert context.request_id == "request-1"
        assert context.trace_id == (trace_id or "trace-header")
        assert context.account_id == ""
        assert context.active_workspace_id == ""
        assert context.remote_ip == "127.0.0.1"
        assert payload.caller.app_id == "app-1"
        data = response.get_json()
        assert data["results"][0]["metadata"]["_source"] == "knowledge"
        assert data["results"][0]["title"] == "FAQ.md"
        assert data["usage"]["total_tokens"] == 0
