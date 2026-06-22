"""Unit tests for the inner knowledge retrieval controller."""

from unittest.mock import patch

import pytest
from flask import Flask

from controllers.inner_api import bp as inner_api_bp
from core.workflow.nodes.knowledge_retrieval.exc import RateLimitExceededError
from core.workflow.nodes.knowledge_retrieval.retrieval import Source, SourceMetadata
from services.entities.knowledge_retrieval_inner import InnerKnowledgeRetrieveResponse, InnerKnowledgeRetrieveUsage
from services.errors.knowledge_retrieval import (
    ExternalKnowledgeRetrievalError,
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
)


@pytest.fixture
def inner_api_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
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


class TestInnerKnowledgeRetrieveApi:
    def test_post_returns_401_when_api_key_missing(self, inner_api_app: Flask):
        with patch("configs.dify_config.INNER_API", True):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(api_key=None),
            )

        assert response.status_code == 401
        assert response.get_json()["code"] == "inner_api_unauthorized"

    def test_post_returns_401_when_api_key_invalid(self, inner_api_app: Flask):
        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(api_key="wrong-key"),
            )

        assert response.status_code == 401
        assert response.get_json()["code"] == "inner_api_unauthorized"

    def test_post_returns_400_for_invalid_body(self, inner_api_app: Flask):
        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json={"caller": {"tenant_id": "tenant-1"}},
                headers=_headers(),
            )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_request"

    @patch("controllers.inner_api.knowledge.retrieval.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_404_for_service_not_found_error(self, mock_retrieve, inner_api_app: Flask):
        mock_retrieve.side_effect = InnerKnowledgeRetrieveAppNotFoundError("app missing")

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 404
        assert response.get_json()["code"] == "app_not_found"

    @patch("controllers.inner_api.knowledge.retrieval.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_403_for_service_forbidden_error(self, mock_retrieve, inner_api_app: Flask):
        mock_retrieve.side_effect = InnerKnowledgeRetrieveDatasetTenantMismatchError("wrong tenant")

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 403
        assert response.get_json()["code"] == "dataset_tenant_mismatch"

    @patch("controllers.inner_api.knowledge.retrieval.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_422_for_retrieval_config_value_error(self, mock_retrieve, inner_api_app: Flask):
        mock_retrieve.side_effect = ValueError("invalid reranking config")

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 422
        assert response.get_json()["code"] == "retrieval_config_invalid"

    @patch("controllers.inner_api.knowledge.retrieval.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_429_for_rate_limit_error(self, mock_retrieve, inner_api_app: Flask):
        mock_retrieve.side_effect = RateLimitExceededError("knowledge rate limited")

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 429
        assert response.get_json()["code"] == "knowledge_rate_limited"

    def test_post_returns_400_for_manual_metadata_without_conditions(self, inner_api_app: Flask):
        payload = _payload()
        payload["metadata_filtering"] = {"mode": "manual"}

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=payload,
                headers=_headers(),
            )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_request"

    def test_post_returns_400_for_automatic_metadata_without_model_config(self, inner_api_app: Flask):
        payload = _payload()
        payload["metadata_filtering"] = {"mode": "automatic"}

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=payload,
                headers=_headers(),
            )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_request"

    @patch("controllers.inner_api.knowledge.retrieval.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_502_for_external_knowledge_failure(self, mock_retrieve, inner_api_app: Flask):
        mock_retrieve.side_effect = ExternalKnowledgeRetrievalError("upstream failed")

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 502
        assert response.get_json()["code"] == "external_knowledge_failed"

    @patch("controllers.inner_api.knowledge.retrieval.InnerKnowledgeRetrievalService.retrieve")
    def test_post_returns_service_response(self, mock_retrieve, inner_api_app: Flask):
        mock_retrieve.return_value = InnerKnowledgeRetrieveResponse(
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
                )
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

        with patch("configs.dify_config.INNER_API", True), patch("configs.dify_config.INNER_API_KEY", "inner-key"):
            response = inner_api_app.test_client().post(
                "/inner/api/knowledge/retrieve",
                json=_payload(),
                headers=_headers(),
            )

        assert response.status_code == 200
        data = response.get_json()
        assert data["results"][0]["metadata"]["_source"] == "knowledge"
        assert data["results"][0]["title"] == "FAQ.md"
        assert data["usage"]["total_tokens"] == 0
