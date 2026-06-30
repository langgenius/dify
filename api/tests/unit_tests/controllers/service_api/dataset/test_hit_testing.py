"""
Unit tests for Service API HitTesting controller.

Tests coverage for:
- HitTestingPayload Pydantic model validation
- HitTestingApi endpoint (success and error paths via direct method calls)

Strategy:
- ``HitTestingApi.post`` is decorated with ``@cloud_edition_billing_rate_limit_check``
  which preserves ``__wrapped__``.  We call ``post.__wrapped__(self, ...)`` to skip
  the billing decorator and test the business logic directly.
- ``validate_dataset_token`` installs the tenant owner account into Flask-Login's
  request context before calling the handler, so direct method-call tests install
  the same concrete account on ``g._login_user``.
"""

import uuid
from unittest.mock import patch

import pytest
from flask import Flask, g
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.service_api.dataset.hit_testing import HitTestingApi, HitTestingPayload
from models.account import Account, Tenant, TenantAccountRole
from models.dataset import Dataset
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel

# ---------------------------------------------------------------------------
# HitTestingPayload Model Tests
# ---------------------------------------------------------------------------


def hit_testing_record() -> dict[str, object]:
    return {
        "segment": {
            "id": "segment-1",
            "position": 1,
            "document_id": "document-1",
            "content": "Chunk text",
            "sign_content": "Chunk text",
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


class TestHitTestingPayload:
    """Test suite for HitTestingPayload Pydantic model."""

    def test_payload_with_required_query(self):
        """Test payload with required query field."""
        payload = HitTestingPayload(query="test query")
        assert payload.query == "test query"

    def test_payload_with_all_fields(self):
        """Test payload with all optional fields."""
        retrieval_model_data = {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "score_threshold_enabled": False,
            "top_k": 5,
        }
        payload = HitTestingPayload(
            query="test query",
            retrieval_model=RetrievalModel.model_validate(retrieval_model_data),
            external_retrieval_model={"provider": "openai"},
            attachment_ids=["att_1", "att_2"],
        )
        assert payload.query == "test query"
        assert payload.retrieval_model is not None
        assert payload.retrieval_model.top_k == 5
        assert payload.external_retrieval_model == {"provider": "openai"}
        assert payload.attachment_ids == ["att_1", "att_2"]

    def test_payload_query_too_long(self):
        """Test payload rejects query over 250 characters."""
        with pytest.raises(ValueError):
            HitTestingPayload(query="x" * 251)

    def test_payload_query_at_max_length(self):
        """Test payload accepts query at exactly 250 characters."""
        payload = HitTestingPayload(query="x" * 250)
        assert len(payload.query) == 250

    def test_payload_ignores_unknown_fields_for_compatibility(self):
        """Top-level fields outside the documented schema remain ignored as before."""
        payload = HitTestingPayload.model_validate({"query": "test query", "top_k": 3})

        assert payload.model_dump(exclude_none=True) == {"query": "test query"}


# ---------------------------------------------------------------------------
# HitTestingApi Tests
#
# We use ``post.__wrapped__`` to bypass ``@cloud_edition_billing_rate_limit_check``
# and call the underlying method directly.
# ---------------------------------------------------------------------------


class TestHitTestingApiPost:
    """Tests for HitTestingApi.post() via __wrapped__ to skip billing decorator."""

    @staticmethod
    def _dataset(dataset_id: str, tenant_id: str) -> Dataset:
        return Dataset(id=dataset_id, tenant_id=tenant_id, name="Dataset", created_by="account-1")

    @staticmethod
    def _account(tenant_id: str) -> Account:
        account = Account(name="Service API", email="service-api@example.com")
        account.id = "account-1"
        tenant = Tenant(name="Tenant")
        tenant.id = tenant_id
        account._current_tenant = tenant
        account.role = TenantAccountRole.OWNER
        return account

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.HitTestingService")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    def test_post_success(
        self,
        mock_dataset_svc,
        mock_hit_svc,
        mock_ns,
        app: Flask,
    ):
        """Test successful hit testing request."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = self._dataset(dataset_id, tenant_id)
        account = self._account(tenant_id)

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        mock_hit_svc.retrieve.return_value = {"query": {"content": "test query"}, "records": []}
        mock_hit_svc.hit_testing_args_check.return_value = None

        mock_ns.payload = {"query": "test query"}

        with app.test_request_context():
            # TODO: the service APIs are NOT migrated yet, so we have to do the very dirty hack
            g._login_user = account
            api = HitTestingApi()
            # Skip billing decorator via __wrapped__
            response = HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

        assert response["query"] == {"content": "test query"}
        mock_hit_svc.retrieve.assert_called_once()

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.HitTestingService")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    def test_post_with_retrieval_model(
        self,
        mock_dataset_svc,
        mock_hit_svc,
        mock_ns,
        app: Flask,
    ):
        """Test hit testing with custom retrieval model."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = self._dataset(dataset_id, tenant_id)
        account = self._account(tenant_id)

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        retrieval_model = {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "score_threshold_enabled": True,
            "top_k": 10,
            "score_threshold": 0.8,
        }

        mock_hit_svc.retrieve.return_value = {"query": {"content": "complex query"}, "records": []}
        mock_hit_svc.hit_testing_args_check.return_value = None

        mock_ns.payload = {
            "query": "complex query",
            "retrieval_model": retrieval_model,
            "external_retrieval_model": {"provider": "custom"},
        }

        with app.test_request_context():
            # TODO: the service APIs are NOT migrated yet, so we have to do the very dirty hack
            g._login_user = account
            api = HitTestingApi()
            response = HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

        assert response["query"] == {"content": "complex query"}
        call_kwargs = mock_hit_svc.retrieve.call_args
        # retrieval_model is serialized via model_dump, verify key fields
        passed_retrieval_model = call_kwargs.kwargs.get("retrieval_model")
        assert passed_retrieval_model is not None
        assert passed_retrieval_model["search_method"] == "semantic_search"
        assert passed_retrieval_model["top_k"] == 10

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.HitTestingService")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    def test_post_preserves_retrieval_model_metadata_filtering_conditions(
        self,
        mock_dataset_svc,
        mock_hit_svc,
        mock_ns,
        app: Flask,
    ):
        """Service API retrieval payload should not drop metadata filters."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = self._dataset(dataset_id, tenant_id)
        account = self._account(tenant_id)

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_hit_svc.retrieve.return_value = {"query": {"content": "filtered query"}, "records": []}
        mock_hit_svc.hit_testing_args_check.return_value = None

        metadata_filtering_conditions = {
            "logical_operator": "and",
            "conditions": [
                {
                    "name": "category",
                    "comparison_operator": "is",
                    "value": "finance",
                }
            ],
        }
        mock_ns.payload = {
            "query": "filtered query",
            "retrieval_model": {
                "search_method": "semantic_search",
                "reranking_enable": False,
                "score_threshold_enabled": False,
                "top_k": 4,
                "metadata_filtering_conditions": metadata_filtering_conditions,
            },
        }

        with app.test_request_context():
            # TODO: the service APIs are NOT migrated yet, so we have to do the very dirty hack
            g._login_user = account
            api = HitTestingApi()
            HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

        passed_retrieval_model = mock_hit_svc.retrieve.call_args.kwargs.get("retrieval_model")
        assert passed_retrieval_model is not None
        assert passed_retrieval_model["metadata_filtering_conditions"] == metadata_filtering_conditions

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.HitTestingService")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    def test_post_prepares_nullable_list_fields(
        self,
        mock_dataset_svc,
        mock_hit_svc,
        mock_ns,
        app: Flask,
    ):
        """Test service API prepares nullable list fields from retrieval records."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = self._dataset(dataset_id, tenant_id)
        account = self._account(tenant_id)

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        mock_hit_svc.retrieve.return_value = {
            "query": {"content": "legacy query"},
            "records": [hit_testing_record()],
        }
        mock_hit_svc.hit_testing_args_check.return_value = None

        mock_ns.payload = {"query": "legacy query"}

        with app.test_request_context():
            # TODO: the service APIs are NOT migrated yet, so we have to do the very dirty hack
            g._login_user = account
            api = HitTestingApi()
            response = HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

        assert response["query"] == {"content": "legacy query"}
        record = response["records"][0]
        assert record["segment"]["id"] == "segment-1"
        assert record["segment"]["keywords"] == []
        assert record["child_chunks"] == []
        assert record["files"] == []
        assert record["score"] == 0.9
        assert record["tsne_position"] is None
        assert record["summary"] is None

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.HitTestingService")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    def test_post_allows_null_document_name(
        self,
        mock_dataset_svc,
        mock_hit_svc,
        mock_ns,
        app: Flask,
    ):
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = self._dataset(dataset_id, tenant_id)
        account = self._account(tenant_id)

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        record = hit_testing_record()
        record["segment"]["document"]["name"] = None
        mock_hit_svc.retrieve.return_value = {
            "query": {"content": "legacy query"},
            "records": [record],
        }
        mock_hit_svc.hit_testing_args_check.return_value = None

        mock_ns.payload = {"query": "legacy query"}

        with app.test_request_context():
            g._login_user = account
            api = HitTestingApi()
            response = HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

        assert response["records"][0]["segment"]["document"]["name"] is None

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    def test_post_dataset_not_found(
        self,
        mock_dataset_svc,
        mock_ns,
        app: Flask,
    ):
        """Test hit testing with non-existent dataset."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())
        account = self._account(tenant_id)

        mock_dataset_svc.get_dataset.return_value = None
        mock_ns.payload = {"query": "test query"}

        with app.test_request_context():
            # TODO: the service APIs are NOT migrated yet, so we have to do the very dirty hack
            g._login_user = account
            api = HitTestingApi()
            with pytest.raises(NotFound):
                HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    def test_post_no_dataset_permission(
        self,
        mock_dataset_svc,
        mock_ns,
        app: Flask,
    ):
        """Test hit testing when user lacks dataset permission."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = self._dataset(dataset_id, tenant_id)
        account = self._account(tenant_id)

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.side_effect = services.errors.account.NoPermissionError(
            "Access denied"
        )
        mock_ns.payload = {"query": "test query"}

        with app.test_request_context():
            # TODO: the service APIs are NOT migrated yet, so we have to do the very dirty hack
            g._login_user = account
            api = HitTestingApi()
            with pytest.raises(Forbidden):
                HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)
