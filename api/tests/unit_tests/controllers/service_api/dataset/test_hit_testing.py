"""
Unit tests for Service API HitTesting controller.

Tests coverage for:
- HitTestingPayload Pydantic model validation
- HitTestingApi endpoint (success and error paths via direct method calls)

Strategy:
- ``HitTestingApi.post`` is decorated with ``@cloud_edition_billing_rate_limit_check``
  which preserves ``__wrapped__``.  We call ``post.__wrapped__(self, ...)`` to skip
  the billing decorator and test the business logic directly.
- Base-class methods (``get_and_validate_dataset``, ``perform_hit_testing``) read
  ``current_user`` from ``controllers.console.datasets.hit_testing_base``, so we
  patch it there.
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.service_api.dataset.hit_testing import HitTestingApi, HitTestingPayload
from models.account import Account

# ---------------------------------------------------------------------------
# HitTestingPayload Model Tests
# ---------------------------------------------------------------------------


class TestHitTestingPayload:
    """Test suite for HitTestingPayload Pydantic model."""

    def test_payload_with_required_query(self):
        """Test payload with required query field."""
        payload = HitTestingPayload(query="test query")
        assert payload.query == "test query"

    def test_payload_with_all_fields(self):
        """Test payload with all optional fields."""
        payload = HitTestingPayload(
            query="test query",
            retrieval_model={"top_k": 5},
            external_retrieval_model={"provider": "openai"},
            attachment_ids=["att_1", "att_2"],
        )
        assert payload.query == "test query"
        assert payload.retrieval_model == {"top_k": 5}
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


# ---------------------------------------------------------------------------
# HitTestingApi Tests
#
# We use ``post.__wrapped__`` to bypass ``@cloud_edition_billing_rate_limit_check``
# and call the underlying method directly.
# ---------------------------------------------------------------------------


class TestHitTestingApiPost:
    """Tests for HitTestingApi.post() via __wrapped__ to skip billing decorator."""

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.marshal")
    @patch("controllers.console.datasets.hit_testing_base.HitTestingService")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    @patch("controllers.console.datasets.hit_testing_base.current_user", new_callable=lambda: Mock(spec=Account))
    def test_post_success(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_hit_svc,
        mock_marshal,
        mock_ns,
        app,
    ):
        """Test successful hit testing request."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = Mock()
        mock_dataset.id = dataset_id

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        mock_hit_svc.retrieve.return_value = {"query": "test query", "records": []}
        mock_hit_svc.hit_testing_args_check.return_value = None
        mock_marshal.return_value = []

        mock_ns.payload = {"query": "test query"}

        with app.test_request_context():
            api = HitTestingApi()
            # Skip billing decorator via __wrapped__
            response = HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

        assert response["query"] == "test query"
        mock_hit_svc.retrieve.assert_called_once()

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.marshal")
    @patch("controllers.console.datasets.hit_testing_base.HitTestingService")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    @patch("controllers.console.datasets.hit_testing_base.current_user", new_callable=lambda: Mock(spec=Account))
    def test_post_with_retrieval_model(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_hit_svc,
        mock_marshal,
        mock_ns,
        app,
    ):
        """Test hit testing with custom retrieval model."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = Mock()
        mock_dataset.id = dataset_id

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        retrieval_model = {"search_method": "semantic", "top_k": 10, "score_threshold": 0.8}

        mock_hit_svc.retrieve.return_value = {"query": "complex query", "records": []}
        mock_hit_svc.hit_testing_args_check.return_value = None
        mock_marshal.return_value = []

        mock_ns.payload = {
            "query": "complex query",
            "retrieval_model": retrieval_model,
            "external_retrieval_model": {"provider": "custom"},
        }

        with app.test_request_context():
            api = HitTestingApi()
            response = HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

        assert response["query"] == "complex query"
        call_kwargs = mock_hit_svc.retrieve.call_args
        assert call_kwargs.kwargs.get("retrieval_model") == retrieval_model

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    @patch("controllers.console.datasets.hit_testing_base.current_user", new_callable=lambda: Mock(spec=Account))
    def test_post_dataset_not_found(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_ns,
        app,
    ):
        """Test hit testing with non-existent dataset."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset_svc.get_dataset.return_value = None
        mock_ns.payload = {"query": "test query"}

        with app.test_request_context():
            api = HitTestingApi()
            with pytest.raises(NotFound):
                HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)

    @patch("controllers.service_api.dataset.hit_testing.service_api_ns")
    @patch("controllers.console.datasets.hit_testing_base.DatasetService")
    @patch("controllers.console.datasets.hit_testing_base.current_user", new_callable=lambda: Mock(spec=Account))
    def test_post_no_dataset_permission(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_ns,
        app,
    ):
        """Test hit testing when user lacks dataset permission."""
        dataset_id = str(uuid.uuid4())
        tenant_id = str(uuid.uuid4())

        mock_dataset = Mock()
        mock_dataset.id = dataset_id

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.side_effect = services.errors.account.NoPermissionError(
            "Access denied"
        )
        mock_ns.payload = {"query": "test query"}

        with app.test_request_context():
            api = HitTestingApi()
            with pytest.raises(Forbidden):
                HitTestingApi.post.__wrapped__(api, tenant_id, dataset_id)
