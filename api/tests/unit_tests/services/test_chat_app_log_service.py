"""Unit tests for ChatAppLogService."""

import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

from sqlalchemy.orm import Session

from models import Account, App, Conversation, EndUser, Message
from models.model import AppMode
from services.chat_app_log_service import ChatAppLogService


class TestChatAppLogService:
    """Test cases for ChatAppLogService."""

    def setup_method(self):
        """Set up test fixtures."""
        self.service = ChatAppLogService()
        self.app_id = str(uuid.uuid4())
        self.app_model = MagicMock(spec=App)
        self.app_model.id = self.app_id
        self.session = MagicMock(spec=Session)

    def test_get_app_mode_filter(self):
        """Test that app mode filter returns correct condition for chat modes."""
        filter_condition = self.service.get_app_mode_filter()
        # Should return a SQLAlchemy filter condition for chat modes
        assert filter_condition is not None

    @patch("services.chat_app_log_service.or_")
    @patch("services.chat_app_log_service.Message")
    def test_get_app_mode_filter_values(self, mock_message_model, mock_or):
        """Test that app mode filter includes all chat modes."""
        # Setup mocks
        mock_chat_condition = MagicMock()
        mock_agent_chat_condition = MagicMock()
        mock_advanced_chat_condition = MagicMock()

        mock_message_model.app_mode.__eq__.side_effect = lambda value: {
            AppMode.CHAT.value: mock_chat_condition,
            AppMode.AGENT_CHAT.value: mock_agent_chat_condition,
            AppMode.ADVANCED_CHAT.value: mock_advanced_chat_condition,
        }[value]

        mock_or.return_value = "combined_condition"

        # Call the method
        result = self.service.get_app_mode_filter()

        # Verify or_ was called with all three chat mode conditions
        mock_or.assert_called_once_with(
            mock_chat_condition,
            mock_agent_chat_condition,
            mock_advanced_chat_condition,
        )

        assert result == "combined_condition"

    def test_build_log_data_with_conversation(self):
        """Test building log data with conversation information."""
        # Create mock conversation
        conversation = MagicMock(spec=Conversation)
        conversation.id = str(uuid.uuid4())
        conversation.name = "Test Conversation"
        conversation.status = "active"

        # Create mock message
        message = MagicMock(spec=Message)
        message.id = str(uuid.uuid4())
        message.conversation_id = conversation.id
        message.query = "Hello"
        message.answer = "Hi there!"
        message.status = "normal"
        message.message_tokens = 5
        message.total_tokens = 12
        message.created_at = datetime.utcnow()
        message.error = None
        message.provider_response_latency = 0.4
        message.from_source = "web_app"
        message.from_end_user_id = None
        message.from_account_id = str(uuid.uuid4())

        # Create mock account
        account = MagicMock(spec=Account)
        account.id = message.from_account_id

        # Mock session.get to return the account
        self.session.get.return_value = account

        # Build log data
        result = self.service.build_log_data(self.session, message, conversation)

        # Verify the result structure
        assert result["id"] == message.id
        assert result["conversation"]["id"] == str(conversation.id)
        assert result["conversation"]["name"] == conversation.name
        assert result["conversation"]["status"] == conversation.status
        assert result["message"]["id"] == str(message.id)
        assert result["message"]["conversation_id"] == str(message.conversation_id)
        assert result["message"]["query"] == message.query
        assert result["message"]["answer"] == message.answer
        assert result["message"]["message_tokens"] == message.message_tokens
        assert result["message"]["total_tokens"] == message.total_tokens
        assert result["created_from"] == "web_app"
        assert result["created_by_role"] == "account"
        assert result["created_by_account"] == account
        assert result["created_by_end_user"] is None

    def test_build_log_data_without_conversation(self):
        """Test building log data when conversation is not provided."""
        # Create mock message
        message = MagicMock(spec=Message)
        message.id = str(uuid.uuid4())
        message.conversation_id = str(uuid.uuid4())
        message.query = "Hello"
        message.answer = "Hi there!"
        message.status = "normal"
        message.message_tokens = 8
        message.total_tokens = 15
        message.created_at = datetime.utcnow()
        message.from_end_user_id = str(uuid.uuid4())
        message.from_account_id = None

        # Create mock end user
        end_user = MagicMock(spec=EndUser)
        end_user.id = message.from_end_user_id

        # Mock session.get to return the end user
        def mock_get_side_effect(model, id):
            if model == EndUser:
                return end_user
            elif model == Conversation:
                return MagicMock(spec=Conversation, id=id, name="Test", status="active")
            return None

        self.session.get.side_effect = mock_get_side_effect

        # Build log data without conversation
        result = self.service.build_log_data(self.session, message)

        # Verify conversation is None when not provided
        assert result["conversation"]["id"] is None
        assert result["conversation"]["name"] is None
        assert result["conversation"]["status"] is None
        assert result["created_from"] == "service_api"
        assert result["created_by_role"] == "end_user"
        assert result["created_by_account"] is None
        assert result["created_by_end_user"] == end_user

    def test_build_log_data_with_session_id(self):
        """Test building log data when created by session ID."""
        # Create mock message
        message = MagicMock(spec=Message)
        message.id = str(uuid.uuid4())
        message.conversation_id = str(uuid.uuid4())
        message.query = "Hello"
        message.answer = "Hi there!"
        message.status = "normal"
        message.message_tokens = 3
        message.total_tokens = 8
        message.created_at = datetime.utcnow()
        message.from_end_user_id = None
        message.from_account_id = None
        message.created_by_end_user_session_id = "test_session_123"

        # Build log data
        result = self.service.build_log_data(self.session, message)

        # Verify the result
        assert result["message"]["total_tokens"] == message.total_tokens
        assert result["created_from"] == "api"  # Default when no from_end_user_id or from_account_id
        assert result["created_by_role"] is None  # Default when no specific creator
        assert result["created_by_account"] is None
        assert result["created_by_end_user"] is None

        # Verify session.get was not called for account/end user since using session ID
        calls = self.session.get.call_args_list
        account_calls = [call for call in calls if call[0][0] == Account]
        end_user_calls = [call for call in calls if call[0][0] == EndUser]
        assert len(account_calls) == 0
        assert len(end_user_calls) == 0

    @patch.object(ChatAppLogService, "get_paginate_app_logs")
    def test_get_paginate_chat_app_logs(self, mock_get_paginate_app_logs):
        """Test the main pagination method."""
        # Setup mock return value
        expected_result = {
            "data": [{"id": "test_chat_log"}],
            "has_more": True,
            "limit": 10,
            "total": 50,
            "page": 2,
        }
        mock_get_paginate_app_logs.return_value = expected_result

        # Store datetime value to ensure consistency
        test_datetime = datetime.utcnow()

        # Call the method
        result = self.service.get_paginate_chat_app_logs(
            session=self.session,
            app_model=self.app_model,
            status="normal",
            created_at_before=test_datetime,
            page=2,
            limit=10,
            created_by_end_user_session_id="session_123",
        )

        # Verify the result
        assert result == expected_result

        # Verify the base method was called with correct parameters
        mock_get_paginate_app_logs.assert_called_once_with(
            session=self.session,
            app_model=self.app_model,
            status="normal",
            created_at_before=test_datetime,
            created_at_after=None,
            page=2,
            limit=10,
            created_by_end_user_session_id="session_123",
            created_by_account=None,
        )

    @patch("services.chat_app_log_service.select")
    @patch("services.chat_app_log_service.Message")
    @patch("services.chat_app_log_service.Conversation")
    def test_build_base_query(self, mock_conversation_model, mock_message_model, mock_select):
        """Test building the base query for chat apps."""
        # Setup mocks
        mock_query = MagicMock()
        mock_join = MagicMock()
        mock_where = MagicMock()
        mock_where.order_by.return_value = mock_query
        mock_join.where.return_value = mock_where
        mock_select.return_value.join.return_value = mock_join

        # Call the method
        result = self.service._build_base_query(self.app_model)

        # Verify the query was built correctly
        mock_select.assert_called_once_with(mock_message_model)
        mock_select.return_value.join.assert_called_once_with(
            mock_conversation_model, mock_message_model.conversation_id == mock_conversation_model.id
        )
        mock_join.where.assert_called_once()
        mock_where.order_by.assert_called_once()

        assert result == mock_query

    @patch("services.chat_app_log_service.select")
    @patch("services.chat_app_log_service.func")
    @patch("services.chat_app_log_service.Message")
    @patch("services.chat_app_log_service.Conversation")
    def test_build_total_count_query(self, mock_conversation_model, mock_message_model, mock_func, mock_select):
        """Test building the total count query."""
        # Setup mocks
        mock_count_query = MagicMock()
        mock_join = MagicMock()
        mock_join.where.return_value = mock_count_query
        mock_select.return_value.join.return_value = mock_join

        # Call the method
        result = self.service._build_total_count_query(self.app_model)

        # Verify the count query was built correctly
        mock_func.count.assert_called_once_with(mock_message_model.id)
        mock_select.return_value.join.assert_called_once_with(
            mock_conversation_model, mock_message_model.conversation_id == mock_conversation_model.id
        )
        mock_join.where.assert_called_once()

        assert result == mock_count_query

    def test_build_log_data_token_consumption_fields(self):
        """Test that token consumption fields are properly included."""
        # Create mock message with token data
        message = MagicMock(spec=Message)
        message.id = str(uuid.uuid4())
        message.conversation_id = str(uuid.uuid4())
        message.query = "What is the weather?"
        message.answer = "The weather is sunny today."
        message.status = "normal"
        message.message_tokens = 7  # Input tokens
        message.total_tokens = 20  # Total tokens (input + output)
        message.created_at = datetime.utcnow()
        message.from_source = "api"
        message.from_end_user_id = None
        message.from_account_id = None
        message.created_by_end_user_session_id = "web_session"

        # Build log data
        result = self.service.build_log_data(self.session, message)

        # Verify token consumption fields are present and correct
        assert "message" in result
        assert result["message"]["message_tokens"] == 7
        assert result["message"]["total_tokens"] == 20
        assert result["message"]["query"] == message.query
        assert result["message"]["answer"] == message.answer
