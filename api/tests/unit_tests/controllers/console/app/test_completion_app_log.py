"""Unit tests for Completion App Log API."""

import uuid
from datetime import UTC, datetime

import pytest
from flask_restx import marshal
from pydantic import ValidationError

from controllers.console.app.completion_app_log import CompletionAppLogQuery
from fields.completion_app_log_fields import build_completion_app_log_pagination_model


class TestCompletionAppLogQuery:
    """Test cases for CompletionAppLogQuery model validation."""

    def test_valid_query_with_all_parameters(self):
        """Test query validation with all valid parameters."""
        query_data = {
            "status": "normal",
            "created_at__before": "2024-01-01T00:00:00Z",
            "created_at__after": "2023-12-01T00:00:00Z",
            "created_by_end_user_session_id": "session_123",
            "created_by_account": "user@example.com",
            "page": 2,
            "limit": 50,
        }

        # Should not raise any validation errors
        query = CompletionAppLogQuery.model_validate(query_data)

        assert query.status == "normal"
        assert query.created_at__before == datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
        assert query.created_at__after == datetime(2023, 12, 1, 0, 0, 0, tzinfo=UTC)
        assert query.created_by_end_user_session_id == "session_123"
        assert query.created_by_account == "user@example.com"
        assert query.page == 2
        assert query.limit == 50

    def test_valid_query_with_minimal_parameters(self):
        """Test query validation with minimal required parameters."""
        query_data = {"page": 1, "limit": 20}

        query = CompletionAppLogQuery.model_validate(query_data)

        assert query.status is None
        assert query.created_at__before is None
        assert query.created_at__after is None
        assert query.created_by_end_user_session_id is None
        assert query.created_by_account is None
        assert query.page == 1
        assert query.limit == 20

    def test_invalid_page_number(self):
        """Test validation with invalid page number."""
        query_data = {"page": 0}  # Page should be >= 1

        with pytest.raises(ValidationError):
            CompletionAppLogQuery.model_validate(query_data)

    def test_invalid_limit_too_small(self):
        """Test validation with limit too small."""
        query_data = {"limit": 0}  # Limit should be >= 1

        with pytest.raises(ValidationError):
            CompletionAppLogQuery.model_validate(query_data)

    def test_invalid_limit_too_large(self):
        """Test validation with limit too large."""
        query_data = {"limit": 101}  # Limit should be <= 100

        with pytest.raises(ValidationError):
            CompletionAppLogQuery.model_validate(query_data)

    def test_invalid_datetime_format(self):
        """Test validation with invalid datetime format."""
        query_data = {"created_at__before": "invalid-date"}

        with pytest.raises(ValidationError):
            CompletionAppLogQuery.model_validate(query_data)

    def test_empty_datetime_values(self):
        """Test validation with empty datetime values."""
        query_data = {
            "created_at__before": "",
            "created_at__after": None,
        }

        query = CompletionAppLogQuery.model_validate(query_data)

        assert query.created_at__before is None
        assert query.created_at__after is None

    def test_edge_case_page_and_limit_values(self):
        """Test validation with edge case values for page and limit."""
        query_data = {"page": 1, "limit": 1}  # Minimum valid values

        query = CompletionAppLogQuery.model_validate(query_data)

        assert query.page == 1
        assert query.limit == 1

        query_data = {"page": 99999, "limit": 100}  # Maximum valid values

        query = CompletionAppLogQuery.model_validate(query_data)

        assert query.page == 99999
        assert query.limit == 100

    def test_status_various_values(self):
        """Test validation with various status values."""
        valid_statuses = ["normal", "error", "finished", "running"]

        for status in valid_statuses:
            query_data = {"status": status}
            query = CompletionAppLogQuery.model_validate(query_data)
            assert query.status == status

    def test_model_serialization(self):
        """Test that the query model can be properly serialized."""
        query_data = {
            "status": "normal",
            "created_at__before": "2024-01-01T00:00:00Z",
            "page": 1,
            "limit": 20,
        }

        query = CompletionAppLogQuery.model_validate(query_data)

        # Should be able to convert to dict without errors
        query_dict = query.model_dump()
        assert isinstance(query_dict, dict)
        assert query_dict["status"] == "normal"
        assert query_dict["page"] == 1
        assert query_dict["limit"] == 20

    def test_default_values(self):
        """Test that default values are applied correctly."""
        query = CompletionAppLogQuery.model_validate({})

        assert query.status is None
        assert query.created_at__before is None
        assert query.created_at__after is None
        assert query.created_by_end_user_session_id is None
        assert query.created_by_account is None
        assert query.page == 1  # Default page
        assert query.limit == 20  # Default limit


class TestCompletionAppLogFields:
    """Test cases for completion app log field serialization."""

    def test_build_pagination_model(self):
        """Test building the pagination model."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_completion_app_log_pagination_model(ns)

        assert model is not None
        assert model.name == "CompletionAppLogPagination"

    def test_marshal_empty_response(self):
        """Test marshaling an empty response."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_completion_app_log_pagination_model(ns)

        empty_response = {
            "data": [],
            "has_more": False,
            "limit": 20,
            "total": 0,
            "page": 1,
        }

        marshaled = marshal(empty_response, model)

        assert marshaled["data"] == []
        assert marshaled["has_more"] is False
        assert marshaled["limit"] == 20
        assert marshaled["total"] == 0
        assert marshaled["page"] == 1

    def test_marshal_response_with_data(self):
        """Test marshaling a response with data."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_completion_app_log_pagination_model(ns)

        test_response = {
            "data": [
                {
                    "id": str(uuid.uuid4()),
                    "message": {
                        "id": str(uuid.uuid4()),
                        "query": "Test query",
                        "answer": "Test answer",
                        "status": "normal",
                        "message_tokens": 10,
                        "total_tokens": 25,
                        "created_at": datetime.utcnow(),
                        "error": None,
                        "provider_response_latency": 0.5,
                        "from_source": "api",
                        "from_end_user_id": None,
                        "from_account_id": None,
                    },
                    "created_from": "api",
                    "created_by_role": None,
                    "created_by_account": None,
                    "created_by_end_user": None,
                    "created_at": datetime.utcnow(),
                }
            ],
            "has_more": True,
            "limit": 20,
            "total": 100,
            "page": 1,
        }

        marshaled = marshal(test_response, model)

        assert len(marshaled["data"]) == 1
        assert marshaled["has_more"] is True
        assert marshaled["total"] == 100
        assert marshaled["page"] == 1

        # Verify message token fields are present
        message = marshaled["data"][0]["message"]
        assert "message_tokens" in message
        assert "total_tokens" in message
        assert message["message_tokens"] == 10
        assert message["total_tokens"] == 25
