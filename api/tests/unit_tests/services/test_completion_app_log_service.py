"""Unit tests for CompletionAppLogService."""

import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

from sqlalchemy.orm import Session

from models import Account, App, EndUser, Message
from services.completion_app_log_service import CompletionAppLogService


class TestCompletionAppLogService:
    """Test cases for CompletionAppLogService."""

    def setup_method(self):
        """Set up test fixtures."""
        self.service = CompletionAppLogService()
        self.app_id = str(uuid.uuid4())
        self.app_model = MagicMock(spec=App)
        self.app_model.id = self.app_id
        self.session = MagicMock(spec=Session)

    def test_get_app_mode_filter(self):
        """Test that app mode filter returns correct condition."""
        filter_condition = self.service.get_app_mode_filter()
        # Should return a SQLAlchemy filter condition for COMPLETION mode
        assert filter_condition is not None

    def test_build_log_data_with_account_creator(self):
        """Test building log data when message was created by an account."""
        # Create mock message
        message = MagicMock(spec=Message)
        message.id = str(uuid.uuid4())
        message.query = "Test query"
        message.answer = "Test answer"
        message.status = "normal"
        message.message_tokens = 10
        message.total_tokens = 25
        message.created_at = datetime.utcnow()
        message.error = None
        message.provider_response_latency = 0.5
        message.from_source = "api"
        message.from_end_user_id = None
        message.from_account_id = str(uuid.uuid4())

        # Create mock account
        account = MagicMock(spec=Account)
        account.id = message.from_account_id

        # Mock session.get to return the account
        self.session.get.return_value = account

        # Build log data
        result = self.service.build_log_data(self.session, message)

        # Verify the result structure
        assert result["id"] == message.id
        assert result["message"]["id"] == message.id
        assert result["message"]["query"] == message.query
        assert result["message"]["answer"] == message.answer
        assert result["message"]["status"] == message.status
        assert result["message"]["message_tokens"] == message.message_tokens
        assert result["message"]["total_tokens"] == message.total_tokens
        assert result["message"]["created_at"] == message.created_at
        assert result["message"]["error"] == message.error
        assert result["message"]["provider_response_latency"] == message.provider_response_latency
        assert result["created_from"] == "web_app"
        assert result["created_by_role"] == "account"
        assert result["created_by_account"] == account
        assert result["created_by_end_user"] is None

        # Verify session.get was called with correct parameters
        self.session.get.assert_called_with(Account, message.from_account_id)

    def test_build_log_data_with_end_user_creator(self):
        """Test building log data when message was created by an end user."""
        # Create mock message
        message = MagicMock(spec=Message)
        message.id = str(uuid.uuid4())
        message.query = "Test query"
        message.answer = "Test answer"
        message.status = "normal"
        message.message_tokens = 15
        message.total_tokens = 30
        message.created_at = datetime.utcnow()
        message.error = None
        message.provider_response_latency = 0.3
        message.from_source = "api"
        message.from_end_user_id = str(uuid.uuid4())
        message.from_account_id = None

        # Create mock end user
        end_user = MagicMock(spec=EndUser)
        end_user.id = message.from_end_user_id

        # Mock session.get to return the end user
        self.session.get.return_value = end_user

        # Build log data
        result = self.service.build_log_data(self.session, message)

        # Verify the result structure
        assert result["id"] == message.id
        assert result["message"]["total_tokens"] == message.total_tokens
        assert result["created_from"] == "service_api"
        assert result["created_by_role"] == "end_user"
        assert result["created_by_account"] is None
        assert result["created_by_end_user"] == end_user

        # Verify session.get was called with correct parameters
        self.session.get.assert_called_with(EndUser, message.from_end_user_id)

    def test_build_log_data_with_session_creator(self):
        """Test building log data when message was created by session."""
        # Create mock message
        message = MagicMock(spec=Message)
        message.id = str(uuid.uuid4())
        message.query = "Test query"
        message.answer = "Test answer"
        message.status = "normal"
        message.message_tokens = 20
        message.total_tokens = 40
        message.created_at = datetime.utcnow()
        message.error = None
        message.provider_response_latency = 0.8
        message.from_source = "api"
        message.from_end_user_id = None
        message.from_account_id = None

        # Build log data
        result = self.service.build_log_data(self.session, message)

        # Verify the result structure
        assert result["id"] == message.id
        assert result["message"]["total_tokens"] == message.total_tokens
        assert result["created_from"] == "api"  # Default when no from_end_user_id or from_account_id
        assert result["created_by_role"] is None  # Default when no specific creator
        assert result["created_by_account"] is None
        assert result["created_by_end_user"] is None

        # Verify session.get was not called
        self.session.get.assert_not_called()

    @patch.object(CompletionAppLogService, "get_paginate_app_logs")
    def test_get_paginate_completion_app_logs(self, mock_get_paginate_app_logs):
        """Test the main pagination method."""
        # Setup mock return value
        expected_result = {
            "data": [{"id": "test"}],
            "has_more": False,
            "limit": 20,
            "total": 1,
            "page": 1,
        }
        mock_get_paginate_app_logs.return_value = expected_result

        # Call the method
        result = self.service.get_paginate_completion_app_logs(
            session=self.session,
            app_model=self.app_model,
            status="normal",
            page=1,
            limit=20,
        )

        # Verify the result
        assert result == expected_result

        # Verify the base method was called with correct parameters
        mock_get_paginate_app_logs.assert_called_once_with(
            session=self.session,
            app_model=self.app_model,
            status="normal",
            created_at_before=None,
            created_at_after=None,
            page=1,
            limit=20,
            created_by_end_user_session_id=None,
            created_by_account=None,
        )

    @patch("services.completion_app_log_service.select")
    @patch("services.completion_app_log_service.Message")
    def test_build_base_query(self, mock_message_model, mock_select):
        """Test building the base query for completion apps."""
        # Setup mocks
        mock_query = MagicMock()
        mock_where = MagicMock()
        mock_where.order_by.return_value = mock_query
        mock_select.return_value.where.return_value = mock_where

        # Call the method
        result = self.service._build_base_query(self.app_model)

        # Verify the query was built correctly
        mock_select.assert_called_once_with(mock_message_model)
        mock_select.return_value.where.assert_called_once()
        mock_where.order_by.assert_called_once()

        assert result == mock_query

    @patch("services.completion_app_log_service.select")
    @patch("services.completion_app_log_service.func")
    @patch("services.completion_app_log_service.Message")
    def test_build_total_count_query(self, mock_message_model, mock_func, mock_select):
        """Test building the total count query."""
        # Setup mocks
        mock_count_query = MagicMock()
        mock_select.return_value.where.return_value = mock_count_query

        # Call the method
        result = self.service._build_total_count_query(self.app_model)

        # Verify the count query was built correctly
        mock_func.count.assert_called_once_with(mock_message_model.id)
        mock_select.return_value.where.assert_called_once()

        assert result == mock_count_query
