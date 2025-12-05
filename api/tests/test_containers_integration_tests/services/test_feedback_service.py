"""Unit tests for FeedbackService."""

import json
from datetime import datetime
from types import SimpleNamespace
from unittest import mock

import pytest

from extensions.ext_database import db
from models.model import App, Conversation, Message
from services.feedback_service import FeedbackService


class TestFeedbackService:
    """Test FeedbackService methods."""

    @pytest.fixture
    def mock_db_session(self, monkeypatch):
        """Mock database session."""
        mock_session = mock.Mock()
        monkeypatch.setattr(db, "session", mock_session)
        return mock_session

    @pytest.fixture
    def sample_data(self):
        """Create sample data for testing."""
        app_id = "test-app-id"

        # Create mock models
        app = App(id=app_id, name="Test App")

        conversation = Conversation(id="test-conversation-id", app_id=app_id, name="Test Conversation")

        message = Message(
            id="test-message-id",
            conversation_id="test-conversation-id",
            query="What is AI?",
            answer="AI is artificial intelligence.",
            inputs={"query": "What is AI?"},
            created_at=datetime(2024, 1, 1, 10, 0, 0),
        )

        # Use SimpleNamespace to avoid ORM model constructor issues
        user_feedback = SimpleNamespace(
            id="user-feedback-id",
            app_id=app_id,
            conversation_id="test-conversation-id",
            message_id="test-message-id",
            rating="like",
            from_source="user",
            content="Great answer!",
            from_end_user_id="user-123",
            from_account_id=None,
            from_account=None,  # Mock account object
            created_at=datetime(2024, 1, 1, 10, 5, 0),
        )

        admin_feedback = SimpleNamespace(
            id="admin-feedback-id",
            app_id=app_id,
            conversation_id="test-conversation-id",
            message_id="test-message-id",
            rating="dislike",
            from_source="admin",
            content="Could be more detailed",
            from_end_user_id=None,
            from_account_id="admin-456",
            from_account=SimpleNamespace(name="Admin User"),  # Mock account object
            created_at=datetime(2024, 1, 1, 10, 10, 0),
        )

        return {
            "app": app,
            "conversation": conversation,
            "message": message,
            "user_feedback": user_feedback,
            "admin_feedback": admin_feedback,
        }

    def test_export_feedbacks_csv_format(self, mock_db_session, sample_data):
        """Test exporting feedback data in CSV format."""

        # Setup mock query result
        mock_query = mock.Mock()
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [
            (
                sample_data["user_feedback"],
                sample_data["message"],
                sample_data["conversation"],
                sample_data["app"],
                sample_data["user_feedback"].from_account,
            )
        ]

        mock_db_session.query.return_value = mock_query

        # Test CSV export
        result = FeedbackService.export_feedbacks(app_id=sample_data["app"].id, format_type="csv")

        # Verify response structure
        assert hasattr(result, "headers")
        assert "text/csv" in result.headers["Content-Type"]
        assert "attachment" in result.headers["Content-Disposition"]

        # Check CSV content
        csv_content = result.get_data(as_text=True)
        # Verify essential headers exist (order may include additional columns)
        assert "feedback_id" in csv_content
        assert "app_name" in csv_content
        assert "conversation_id" in csv_content
        assert sample_data["app"].name in csv_content
        assert sample_data["message"].query in csv_content

    def test_export_feedbacks_json_format(self, mock_db_session, sample_data):
        """Test exporting feedback data in JSON format."""

        # Setup mock query result
        mock_query = mock.Mock()
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [
            (
                sample_data["admin_feedback"],
                sample_data["message"],
                sample_data["conversation"],
                sample_data["app"],
                sample_data["admin_feedback"].from_account,
            )
        ]

        mock_db_session.query.return_value = mock_query

        # Test JSON export
        result = FeedbackService.export_feedbacks(app_id=sample_data["app"].id, format_type="json")

        # Verify response structure
        assert hasattr(result, "headers")
        assert "application/json" in result.headers["Content-Type"]
        assert "attachment" in result.headers["Content-Disposition"]

        # Check JSON content
        json_content = json.loads(result.get_data(as_text=True))
        assert "export_info" in json_content
        assert "feedback_data" in json_content
        assert json_content["export_info"]["app_id"] == sample_data["app"].id
        assert json_content["export_info"]["total_records"] == 1

    def test_export_feedbacks_with_filters(self, mock_db_session, sample_data):
        """Test exporting feedback with various filters."""

        # Setup mock query result
        mock_query = mock.Mock()
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [
            (
                sample_data["admin_feedback"],
                sample_data["message"],
                sample_data["conversation"],
                sample_data["app"],
                sample_data["admin_feedback"].from_account,
            )
        ]

        mock_db_session.query.return_value = mock_query

        # Test with filters
        result = FeedbackService.export_feedbacks(
            app_id=sample_data["app"].id,
            from_source="admin",
            rating="dislike",
            has_comment=True,
            start_date="2024-01-01",
            end_date="2024-12-31",
            format_type="csv",
        )

        # Verify filters were applied
        assert mock_query.filter.called
        filter_calls = mock_query.filter.call_args_list
        # At least three filter invocations are expected (source, rating, comment)
        assert len(filter_calls) >= 3

    def test_export_feedbacks_no_data(self, mock_db_session, sample_data):
        """Test exporting feedback when no data exists."""

        # Setup mock query result with no data
        mock_query = mock.Mock()
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        mock_db_session.query.return_value = mock_query

        result = FeedbackService.export_feedbacks(app_id=sample_data["app"].id, format_type="csv")

        # Should return an empty CSV with headers only
        assert hasattr(result, "headers")
        assert "text/csv" in result.headers["Content-Type"]
        csv_content = result.get_data(as_text=True)
        # Headers should exist (order can include additional columns)
        assert "feedback_id" in csv_content
        assert "app_name" in csv_content
        assert "conversation_id" in csv_content
        # No data rows expected
        assert len([line for line in csv_content.strip().splitlines() if line.strip()]) == 1

    def test_export_feedbacks_invalid_date_format(self, mock_db_session, sample_data):
        """Test exporting feedback with invalid date format."""

        # Test with invalid start_date
        with pytest.raises(ValueError, match="Invalid start_date format"):
            FeedbackService.export_feedbacks(app_id=sample_data["app"].id, start_date="invalid-date-format")

        # Test with invalid end_date
        with pytest.raises(ValueError, match="Invalid end_date format"):
            FeedbackService.export_feedbacks(app_id=sample_data["app"].id, end_date="invalid-date-format")

    def test_export_feedbacks_invalid_format(self, mock_db_session, sample_data):
        """Test exporting feedback with unsupported format."""

        with pytest.raises(ValueError, match="Unsupported format"):
            FeedbackService.export_feedbacks(
                app_id=sample_data["app"].id,
                format_type="xml",  # Unsupported format
            )

    def test_export_feedbacks_long_response_truncation(self, mock_db_session, sample_data):
        """Test that long AI responses are truncated in export."""

        # Create message with long response
        long_message = Message(
            id="long-message-id",
            conversation_id="test-conversation-id",
            query="What is AI?",
            answer="A" * 600,  # 600 character response
            inputs={"query": "What is AI?"},
            created_at=datetime(2024, 1, 1, 10, 0, 0),
        )

        # Setup mock query result
        mock_query = mock.Mock()
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [
            (
                sample_data["user_feedback"],
                long_message,
                sample_data["conversation"],
                sample_data["app"],
                sample_data["user_feedback"].from_account,
            )
        ]

        mock_db_session.query.return_value = mock_query

        # Test export
        result = FeedbackService.export_feedbacks(app_id=sample_data["app"].id, format_type="json")

        # Check JSON content
        json_content = json.loads(result.get_data(as_text=True))
        exported_answer = json_content["feedback_data"][0]["ai_response"]

        # Should be truncated with ellipsis
        assert len(exported_answer) <= 503  # 500 + "..."
        assert exported_answer.endswith("...")
        assert len(exported_answer) > 500  # Should be close to limit

    def test_export_feedbacks_unicode_content(self, mock_db_session, sample_data):
        """Test exporting feedback with unicode content (Chinese characters)."""

        # Create feedback with Chinese content (use SimpleNamespace to avoid ORM constructor constraints)
        chinese_feedback = SimpleNamespace(
            id="chinese-feedback-id",
            app_id=sample_data["app"].id,
            conversation_id="test-conversation-id",
            message_id="test-message-id",
            rating="dislike",
            from_source="user",
            content="回答不够详细，需要更多信息",
            from_end_user_id="user-123",
            from_account_id=None,
            created_at=datetime(2024, 1, 1, 10, 5, 0),
        )

        # Create Chinese message
        chinese_message = Message(
            id="chinese-message-id",
            conversation_id="test-conversation-id",
            query="什么是人工智能？",
            answer="人工智能是模拟人类智能的技术。",
            inputs={"query": "什么是人工智能？"},
            created_at=datetime(2024, 1, 1, 10, 0, 0),
        )

        # Setup mock query result
        mock_query = mock.Mock()
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [
            (
                chinese_feedback,
                chinese_message,
                sample_data["conversation"],
                sample_data["app"],
                None,  # No account for user feedback
            )
        ]

        mock_db_session.query.return_value = mock_query

        # Test export
        result = FeedbackService.export_feedbacks(app_id=sample_data["app"].id, format_type="csv")

        # Check that unicode content is preserved
        csv_content = result.get_data(as_text=True)
        assert "什么是人工智能？" in csv_content
        assert "回答不够详细，需要更多信息" in csv_content
        assert "人工智能是模拟人类智能的技术" in csv_content

    def test_export_feedbacks_emoji_ratings(self, mock_db_session, sample_data):
        """Test that rating emojis are properly formatted in export."""

        # Setup mock query result with both like and dislike feedback
        mock_query = mock.Mock()
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [
            (
                sample_data["user_feedback"],
                sample_data["message"],
                sample_data["conversation"],
                sample_data["app"],
                sample_data["user_feedback"].from_account,
            ),
            (
                sample_data["admin_feedback"],
                sample_data["message"],
                sample_data["conversation"],
                sample_data["app"],
                sample_data["admin_feedback"].from_account,
            ),
        ]

        mock_db_session.query.return_value = mock_query

        # Test export
        result = FeedbackService.export_feedbacks(app_id=sample_data["app"].id, format_type="json")

        # Check JSON content for emoji ratings
        json_content = json.loads(result.get_data(as_text=True))
        feedback_data = json_content["feedback_data"]

        # Should have both feedback records
        assert len(feedback_data) == 2

        # Check that emojis are properly set
        like_feedback = next(f for f in feedback_data if f["feedback_rating_raw"] == "like")
        dislike_feedback = next(f for f in feedback_data if f["feedback_rating_raw"] == "dislike")

        assert like_feedback["feedback_rating"] == "👍"
        assert dislike_feedback["feedback_rating"] == "👎"
