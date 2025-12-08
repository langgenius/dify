"""Unit tests for Chat App Log API."""

import uuid
from datetime import UTC, datetime

import pytest
from flask_restx import marshal
from pydantic import ValidationError

from controllers.console.app.chat_app_log import ChatAppLogQuery
from fields.chat_app_log_fields import build_chat_app_log_pagination_model


class TestChatAppLogQuery:
    """Test cases for ChatAppLogQuery model validation."""

    def test_valid_query_with_all_parameters(self):
        """Test query validation with all valid parameters."""
        query_data = {
            "status": "normal",
            "created_at__before": "2024-01-01T00:00:00Z",
            "created_at__after": "2023-12-01T00:00:00Z",
            "created_by_end_user_session_id": "session_456",
            "created_by_account": "user@example.com",
            "page": 3,
            "limit": 30,
        }

        # Should not raise any validation errors
        query = ChatAppLogQuery.model_validate(query_data)

        assert query.status == "normal"
        assert query.created_at__before == datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)
        assert query.created_at__after == datetime(2023, 12, 1, 0, 0, 0, tzinfo=UTC)
        assert query.created_by_end_user_session_id == "session_456"
        assert query.created_by_account == "user@example.com"
        assert query.page == 3
        assert query.limit == 30

    def test_valid_query_with_minimal_parameters(self):
        """Test query validation with minimal required parameters."""
        query_data = {"page": 1, "limit": 20}

        query = ChatAppLogQuery.model_validate(query_data)

        assert query.status is None
        assert query.created_at__before is None
        assert query.created_at__after is None
        assert query.created_by_end_user_session_id is None
        assert query.created_by_account is None
        assert query.page == 1
        assert query.limit == 20

    def test_invalid_page_number_too_low(self):
        """Test validation with page number too low."""
        query_data = {"page": 0}  # Page should be >= 1

        with pytest.raises(ValidationError):
            ChatAppLogQuery.model_validate(query_data)

    def test_invalid_page_number_too_high(self):
        """Test validation with page number too high."""
        query_data = {"page": 100000}  # Page should be <= 99999

        with pytest.raises(ValidationError):
            ChatAppLogQuery.model_validate(query_data)

    def test_invalid_limit_too_small(self):
        """Test validation with limit too small."""
        query_data = {"limit": 0}  # Limit should be >= 1

        with pytest.raises(ValidationError):
            ChatAppLogQuery.model_validate(query_data)

    def test_invalid_limit_too_large(self):
        """Test validation with limit too large."""
        query_data = {"limit": 101}  # Limit should be <= 100

        with pytest.raises(ValidationError):
            ChatAppLogQuery.model_validate(query_data)

    def test_invalid_datetime_format(self):
        """Test validation with invalid datetime format."""
        query_data = {"created_at__before": "not-a-date"}

        with pytest.raises(ValidationError):
            ChatAppLogQuery.model_validate(query_data)

    def test_empty_and_null_values(self):
        """Test validation with empty and null values."""
        query_data = {
            "status": "",
            "created_at__before": "",
            "created_at__after": None,
            "created_by_end_user_session_id": "",
            "created_by_account": None,
        }

        query = ChatAppLogQuery.model_validate(query_data)

        # Empty strings should remain as empty strings, None should remain None
        assert query.status == ""
        assert query.created_at__before is None  # Empty string becomes None for datetime
        assert query.created_at__after is None
        assert query.created_by_end_user_session_id == ""
        assert query.created_by_account is None

    def test_edge_case_boundary_values(self):
        """Test validation with boundary values."""
        # Test minimum valid values
        query_data = {"page": 1, "limit": 1}
        query = ChatAppLogQuery.model_validate(query_data)
        assert query.page == 1
        assert query.limit == 1

        # Test maximum valid values
        query_data = {"page": 99999, "limit": 100}
        query = ChatAppLogQuery.model_validate(query_data)
        assert query.page == 99999
        assert query.limit == 100

    def test_chat_specific_parameters(self):
        """Test chat-specific parameter validation."""
        query_data = {
            "created_by_end_user_session_id": "user_session_12345",
            "status": "normal",
        }

        query = ChatAppLogQuery.model_validate(query_data)

        assert query.created_by_end_user_session_id == "user_session_12345"
        assert query.status == "normal"

    def test_datetime_parsing_various_formats(self):
        """Test datetime parsing with various ISO formats."""
        valid_datetimes = [
            "2024-01-01T00:00:00Z",
            "2024-01-01T12:30:45+00:00",
            "2024-01-01T12:30:45-05:00",
        ]

        for dt_str in valid_datetimes:
            query_data = {"created_at__before": dt_str}
            query = ChatAppLogQuery.model_validate(query_data)
            assert query.created_at__before is not None
            assert isinstance(query.created_at__before, datetime)
            assert query.created_at__before.tzinfo is not None  # Should have timezone info

    def test_model_to_dict_conversion(self):
        """Test converting query model to dictionary."""
        query_data = {
            "status": "error",
            "created_by_end_user_session_id": "test_session",
            "page": 5,
            "limit": 15,
        }

        query = ChatAppLogQuery.model_validate(query_data)
        query_dict = query.model_dump()

        assert isinstance(query_dict, dict)
        assert query_dict["status"] == "error"
        assert query_dict["created_by_end_user_session_id"] == "test_session"
        assert query_dict["page"] == 5
        assert query_dict["limit"] == 15


class TestChatAppLogFields:
    """Test cases for chat app log field serialization."""

    def test_build_pagination_model(self):
        """Test building the pagination model for chat logs."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_chat_app_log_pagination_model(ns)

        assert model is not None
        assert model.name == "ChatAppLogPagination"

    def test_marshal_empty_chat_response(self):
        """Test marshaling an empty chat log response."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_chat_app_log_pagination_model(ns)

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
        assert marshaled["total"] == 0
        assert marshaled["page"] == 1

    def test_marshal_chat_response_with_conversation(self):
        """Test marshaling a response with conversation data."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_chat_app_log_pagination_model(ns)

        test_response = {
            "data": [
                {
                    "id": str(uuid.uuid4()),
                    "conversation": {
                        "id": str(uuid.uuid4()),
                        "name": "Customer Support Chat",
                        "status": "active",
                    },
                    "message": {
                        "id": str(uuid.uuid4()),
                        "conversation_id": str(uuid.uuid4()),
                        "query": "How can I reset my password?",
                        "answer": "You can reset your password by clicking the 'Forgot Password' link.",
                        "status": "normal",
                        "message_tokens": 12,
                        "total_tokens": 35,
                        "created_at": datetime.utcnow(),
                        "error": None,
                        "provider_response_latency": 1.2,
                        "from_source": "web_app",
                        "from_end_user_id": str(uuid.uuid4()),
                        "from_account_id": None,
                    },
                    "created_from": "web_app",
                    "created_by_role": "end_user",
                    "created_by_account": None,
                    "created_by_end_user": {"id": str(uuid.uuid4())},
                    "created_at": datetime.utcnow(),
                }
            ],
            "has_more": True,
            "limit": 20,
            "total": 150,
            "page": 1,
        }

        marshaled = marshal(test_response, model)

        # Verify structure
        assert len(marshaled["data"]) == 1
        assert marshaled["has_more"] is True
        assert marshaled["total"] == 150

        # Verify conversation data
        conversation = marshaled["data"][0]["conversation"]
        assert conversation["name"] == "Customer Support Chat"
        assert conversation["status"] == "active"

        # Verify message token fields
        message = marshaled["data"][0]["message"]
        assert "message_tokens" in message
        assert "total_tokens" in message
        assert message["message_tokens"] == 12
        assert message["total_tokens"] == 35

    def test_marshal_chat_response_multiple_entries(self):
        """Test marshaling response with multiple chat log entries."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_chat_app_log_pagination_model(ns)

        # Create test data with multiple entries
        test_data = []
        for i in range(3):
            test_data.append(
                {
                    "id": str(uuid.uuid4()),
                    "conversation": {
                        "id": str(uuid.uuid4()),
                        "name": f"Chat {i + 1}",
                        "status": "completed",
                    },
                    "message": {
                        "id": str(uuid.uuid4()),
                        "conversation_id": str(uuid.uuid4()),
                        "query": f"Message {i + 1}",
                        "answer": f"Response {i + 1}",
                        "status": "normal",
                        "message_tokens": 5 + i,
                        "total_tokens": 15 + i * 2,
                        "created_at": datetime.utcnow(),
                        "error": None,
                        "provider_response_latency": 0.5 + i * 0.1,
                        "from_source": "api",
                        "from_end_user_id": None,
                        "from_account_id": str(uuid.uuid4()),
                    },
                    "created_from": "api",
                    "created_by_role": "account",
                    "created_by_account": {"id": str(uuid.uuid4())},
                    "created_by_end_user": None,
                    "created_at": datetime.utcnow(),
                }
            )

        test_response = {
            "data": test_data,
            "has_more": False,
            "limit": 20,
            "total": 3,
            "page": 1,
        }

        marshaled = marshal(test_response, model)

        # Verify all entries are present
        assert len(marshaled["data"]) == 3
        assert marshaled["total"] == 3

        # Verify each entry has conversation and message data
        for i, entry in enumerate(marshaled["data"]):
            assert "conversation" in entry
            assert "message" in entry
            assert entry["conversation"]["name"] == f"Chat {i + 1}"
            assert entry["message"]["query"] == f"Message {i + 1}"
            assert entry["message"]["message_tokens"] == 5 + i
            assert entry["message"]["total_tokens"] == 15 + i * 2

    def test_marshal_response_with_creator_information(self):
        """Test marshaling response with different creator types."""
        from flask_restx import Namespace

        ns = Namespace("test")
        model = build_chat_app_log_pagination_model(ns)

        # Test data for different creator scenarios
        scenarios = [
            {
                "name": "Account created",
                "created_from": "web_app",
                "created_by_role": "account",
                "created_by_account": {"id": str(uuid.uuid4()), "email": "user@example.com", "name": None},
                "created_by_end_user": None,
            },
            {
                "name": "End user created",
                "created_from": "service_api",
                "created_by_role": "end_user",
                "created_by_account": None,
                "created_by_end_user": {
                    "id": str(uuid.uuid4()),
                    "session_id": "session_123",
                    "type": None,
                    "is_anonymous": None,
                },
            },
            {
                "name": "Session created",
                "created_from": "service_api",
                "created_by_role": "end_user",
                "created_by_account": None,
                "created_by_end_user": None,
            },
        ]

        for scenario in scenarios:
            test_response = {
                "data": [
                    {
                        "id": str(uuid.uuid4()),
                        "conversation": {
                            "id": str(uuid.uuid4()),
                            "name": scenario["name"],
                            "status": "active",
                        },
                        "message": {
                            "id": str(uuid.uuid4()),
                            "conversation_id": str(uuid.uuid4()),
                            "query": "Test query",
                            "answer": "Test answer",
                            "status": "normal",
                            "message_tokens": 8,
                            "total_tokens": 20,
                            "created_at": datetime.utcnow(),
                            "error": None,
                            "provider_response_latency": 0.8,
                            "from_source": "api",
                            "from_end_user_id": None,
                            "from_account_id": None,
                        },
                        **{k: v for k, v in scenario.items() if k != "name"},
                        "created_at": datetime.utcnow(),
                    }
                ],
                "has_more": False,
                "limit": 20,
                "total": 1,
                "page": 1,
            }

            marshaled = marshal(test_response, model)
            entry = marshaled["data"][0]

            assert entry["created_from"] == scenario["created_from"]
            assert entry["created_by_role"] == scenario["created_by_role"]
            assert entry["created_by_account"] == scenario["created_by_account"]
            assert entry["created_by_end_user"] == scenario["created_by_end_user"]
