import csv
import io
import json
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from services.feedback_service import FeedbackService


class TestFeedbackServiceFactory:
    """Factory class for creating test data and mock objects for feedback service tests."""

    @staticmethod
    def create_feedback_mock(
        feedback_id: str = "feedback-123",
        app_id: str = "app-456",
        conversation_id: str = "conv-789",
        message_id: str = "msg-001",
        rating: str = "like",
        content: str | None = "Great response!",
        from_source: str = "user",
        from_account_id: str | None = None,
        from_end_user_id: str | None = "end-user-001",
        created_at: datetime | None = None,
    ) -> MagicMock:
        """Create a mock MessageFeedback object."""
        feedback = MagicMock()
        feedback.id = feedback_id
        feedback.app_id = app_id
        feedback.conversation_id = conversation_id
        feedback.message_id = message_id
        feedback.rating = rating
        feedback.content = content
        feedback.from_source = from_source
        feedback.from_account_id = from_account_id
        feedback.from_end_user_id = from_end_user_id
        feedback.created_at = created_at or datetime.now()
        return feedback

    @staticmethod
    def create_message_mock(
        message_id: str = "msg-001",
        query: str = "What is AI?",
        answer: str = "AI stands for Artificial Intelligence.",
        inputs: dict | None = None,
        created_at: datetime | None = None,
    ):
        """Create a mock Message object."""

        # Create a simple object with instance attributes
        # Using a class with __init__ ensures attributes are instance attributes
        class Message:
            def __init__(self):
                self.id = message_id
                self.query = query
                self.answer = answer
                self.inputs = inputs
                self.created_at = created_at or datetime.now()

        return Message()

    @staticmethod
    def create_conversation_mock(
        conversation_id: str = "conv-789",
        name: str | None = "Test Conversation",
    ) -> MagicMock:
        """Create a mock Conversation object."""
        conversation = MagicMock()
        conversation.id = conversation_id
        conversation.name = name
        return conversation

    @staticmethod
    def create_app_mock(
        app_id: str = "app-456",
        name: str = "Test App",
    ) -> MagicMock:
        """Create a mock App object."""
        app = MagicMock()
        app.id = app_id
        app.name = name
        return app

    @staticmethod
    def create_account_mock(
        account_id: str = "account-123",
        name: str = "Test Admin",
    ) -> MagicMock:
        """Create a mock Account object."""
        account = MagicMock()
        account.id = account_id
        account.name = name
        return account


class TestFeedbackService:
    """
    Comprehensive unit tests for FeedbackService.

    This test suite covers:
    - CSV and JSON export formats
    - All filter combinations
    - Edge cases and error handling
    - Response validation
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestFeedbackServiceFactory()

    @pytest.fixture
    def sample_feedback_data(self, factory):
        """Create sample feedback data for testing."""
        feedback = factory.create_feedback_mock(
            rating="like",
            content="Excellent answer!",
            from_source="user",
        )
        message = factory.create_message_mock(
            query="What is Python?",
            answer="Python is a programming language.",
        )
        conversation = factory.create_conversation_mock(name="Python Discussion")
        app = factory.create_app_mock(name="AI Assistant")
        account = factory.create_account_mock(name="Admin User")

        return [(feedback, message, conversation, app, account)]

    # Test 01: CSV Export - Basic Functionality
    @patch("services.feedback_service.db")
    def test_export_feedbacks_csv_basic(self, mock_db, factory, sample_feedback_data):
        """Test basic CSV export with single feedback record."""
        # Arrange
        mock_query = MagicMock()
        # Configure the mock to return itself for all chaining methods
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = sample_feedback_data

        # Set up the session.query to return our mock
        mock_db.session.query.return_value = mock_query

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="csv")

        # Assert
        assert response.mimetype == "text/csv"
        assert "charset=utf-8-sig" in response.content_type
        assert "attachment" in response.headers["Content-Disposition"]
        assert "dify_feedback_export_app-456" in response.headers["Content-Disposition"]

        # Verify CSV content
        csv_content = response.get_data(as_text=True)
        reader = csv.DictReader(io.StringIO(csv_content))
        rows = list(reader)

        assert len(rows) == 1
        assert rows[0]["feedback_rating"] == "👍"
        assert rows[0]["feedback_rating_raw"] == "like"
        assert rows[0]["feedback_comment"] == "Excellent answer!"
        assert rows[0]["user_query"] == "What is Python?"
        assert rows[0]["ai_response"] == "Python is a programming language."

    # Test 02: JSON Export - Basic Functionality
    @patch("services.feedback_service.db")
    def test_export_feedbacks_json_basic(self, mock_db, factory, sample_feedback_data):
        """Test basic JSON export with metadata structure."""
        # Arrange
        mock_query = MagicMock()
        # Configure the mock to return itself for all chaining methods
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = sample_feedback_data

        # Set up the session.query to return our mock
        mock_db.session.query.return_value = mock_query

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        assert response.mimetype == "application/json"
        assert "charset=utf-8" in response.content_type
        assert "attachment" in response.headers["Content-Disposition"]

        # Verify JSON structure
        json_content = json.loads(response.get_data(as_text=True))
        assert "export_info" in json_content
        assert "feedback_data" in json_content
        assert json_content["export_info"]["app_id"] == "app-456"
        assert json_content["export_info"]["total_records"] == 1
        assert len(json_content["feedback_data"]) == 1

    # Test 03: Filter by from_source
    @patch("services.feedback_service.db")
    def test_export_feedbacks_filter_from_source(self, mock_db, factory):
        """Test filtering by feedback source (user/admin)."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        FeedbackService.export_feedbacks(app_id="app-456", from_source="admin")

        # Assert
        mock_query.filter.assert_called()

    # Test 04: Filter by rating
    @patch("services.feedback_service.db")
    def test_export_feedbacks_filter_rating(self, mock_db, factory):
        """Test filtering by rating (like/dislike)."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        FeedbackService.export_feedbacks(app_id="app-456", rating="dislike")

        # Assert
        mock_query.filter.assert_called()

    # Test 05: Filter by has_comment (True)
    @patch("services.feedback_service.db")
    def test_export_feedbacks_filter_has_comment_true(self, mock_db, factory):
        """Test filtering for feedback with comments."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        FeedbackService.export_feedbacks(app_id="app-456", has_comment=True)

        # Assert
        mock_query.filter.assert_called()

    # Test 06: Filter by has_comment (False)
    @patch("services.feedback_service.db")
    def test_export_feedbacks_filter_has_comment_false(self, mock_db, factory):
        """Test filtering for feedback without comments."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        FeedbackService.export_feedbacks(app_id="app-456", has_comment=False)

        # Assert
        mock_query.filter.assert_called()

    # Test 07: Filter by date range
    @patch("services.feedback_service.db")
    def test_export_feedbacks_filter_date_range(self, mock_db, factory):
        """Test filtering by start and end dates."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        FeedbackService.export_feedbacks(
            app_id="app-456",
            start_date="2024-01-01",
            end_date="2024-12-31",
        )

        # Assert
        assert mock_query.filter.call_count >= 2  # Called for both start and end dates

    # Test 08: Invalid date format - start_date
    @patch("services.feedback_service.db")
    def test_export_feedbacks_invalid_start_date(self, mock_db):
        """Test error handling for invalid start_date format."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid start_date format"):
            FeedbackService.export_feedbacks(app_id="app-456", start_date="invalid-date")

    # Test 09: Invalid date format - end_date
    @patch("services.feedback_service.db")
    def test_export_feedbacks_invalid_end_date(self, mock_db):
        """Test error handling for invalid end_date format."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid end_date format"):
            FeedbackService.export_feedbacks(app_id="app-456", end_date="2024-13-45")

    # Test 10: Unsupported format
    def test_export_feedbacks_unsupported_format(self):
        """Test error handling for unsupported export format."""
        # Act & Assert
        with pytest.raises(ValueError, match="Unsupported format"):
            FeedbackService.export_feedbacks(app_id="app-456", format_type="xml")

    # Test 11: Empty result set - CSV
    @patch("services.feedback_service.db")
    def test_export_feedbacks_empty_results_csv(self, mock_db):
        """Test CSV export with no feedback records."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="csv")

        # Assert
        csv_content = response.get_data(as_text=True)
        reader = csv.DictReader(io.StringIO(csv_content))
        rows = list(reader)
        assert len(rows) == 0
        # But headers should still be present
        assert reader.fieldnames is not None

    # Test 12: Empty result set - JSON
    @patch("services.feedback_service.db")
    def test_export_feedbacks_empty_results_json(self, mock_db):
        """Test JSON export with no feedback records."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        json_content = json.loads(response.get_data(as_text=True))
        assert json_content["export_info"]["total_records"] == 0
        assert len(json_content["feedback_data"]) == 0

    # Test 13: Long response truncation
    @patch("services.feedback_service.db")
    def test_export_feedbacks_long_response_truncation(self, mock_db, factory):
        """Test that long AI responses are truncated to 500 characters."""
        # Arrange
        long_answer = "A" * 600  # 600 characters
        feedback = factory.create_feedback_mock()
        message = factory.create_message_mock(answer=long_answer)
        conversation = factory.create_conversation_mock()
        app = factory.create_app_mock()
        account = factory.create_account_mock()

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [(feedback, message, conversation, app, account)]

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        json_content = json.loads(response.get_data(as_text=True))
        ai_response = json_content["feedback_data"][0]["ai_response"]
        assert len(ai_response) == 503  # 500 + "..."
        assert ai_response.endswith("...")

    # Test 14: Null account (end user feedback)
    @patch("services.feedback_service.db")
    def test_export_feedbacks_null_account(self, mock_db, factory):
        """Test handling of feedback from end users (no account)."""
        # Arrange
        feedback = factory.create_feedback_mock(from_account_id=None)
        message = factory.create_message_mock()
        conversation = factory.create_conversation_mock()
        app = factory.create_app_mock()
        account = None  # No account for end user

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [(feedback, message, conversation, app, account)]

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        json_content = json.loads(response.get_data(as_text=True))
        assert json_content["feedback_data"][0]["from_account_name"] == ""

    # Test 15: Null conversation name
    @patch("services.feedback_service.db")
    def test_export_feedbacks_null_conversation_name(self, mock_db, factory):
        """Test handling of conversations without names."""
        # Arrange
        feedback = factory.create_feedback_mock()
        message = factory.create_message_mock()
        conversation = factory.create_conversation_mock(name=None)
        app = factory.create_app_mock()
        account = factory.create_account_mock()

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [(feedback, message, conversation, app, account)]

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        json_content = json.loads(response.get_data(as_text=True))
        assert json_content["feedback_data"][0]["conversation_name"] == ""

    # Test 16: Dislike rating emoji
    @patch("services.feedback_service.db")
    def test_export_feedbacks_dislike_rating(self, mock_db, factory):
        """Test that dislike rating shows thumbs down emoji."""
        # Arrange
        feedback = factory.create_feedback_mock(rating="dislike")
        message = factory.create_message_mock()
        conversation = factory.create_conversation_mock()
        app = factory.create_app_mock()
        account = factory.create_account_mock()

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [(feedback, message, conversation, app, account)]

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        json_content = json.loads(response.get_data(as_text=True))
        assert json_content["feedback_data"][0]["feedback_rating"] == "👎"
        assert json_content["feedback_data"][0]["feedback_rating_raw"] == "dislike"

    # Test 17: Combined filters
    @patch("services.feedback_service.db")
    def test_export_feedbacks_combined_filters(self, mock_db, factory):
        """Test applying multiple filters simultaneously."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = []

        # Act
        FeedbackService.export_feedbacks(
            app_id="app-456",
            from_source="admin",
            rating="like",
            has_comment=True,
            start_date="2024-01-01",
            end_date="2024-12-31",
        )

        # Assert
        # Should have called filter multiple times for each condition
        assert mock_query.filter.call_count >= 4

    # Test 18: Message query fallback to inputs
    @patch("services.feedback_service.db")
    def test_export_feedbacks_message_query_from_inputs(self, mock_db, factory):
        """Test fallback to inputs.query when message.query is None."""
        # Arrange
        feedback = factory.create_feedback_mock()
        message = factory.create_message_mock(query=None, inputs={"query": "Query from inputs"})
        conversation = factory.create_conversation_mock()
        app = factory.create_app_mock()
        account = factory.create_account_mock()

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [(feedback, message, conversation, app, account)]

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        json_content = json.loads(response.get_data(as_text=True))
        assert json_content["feedback_data"][0]["user_query"] == "Query from inputs"

    # Test 19: Empty feedback content
    @patch("services.feedback_service.db")
    def test_export_feedbacks_empty_feedback_content(self, mock_db, factory):
        """Test handling of feedback with empty/null content."""
        # Arrange
        feedback = factory.create_feedback_mock(content=None)
        message = factory.create_message_mock()
        conversation = factory.create_conversation_mock()
        app = factory.create_app_mock()
        account = factory.create_account_mock()

        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = [(feedback, message, conversation, app, account)]

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="json")

        # Assert
        json_content = json.loads(response.get_data(as_text=True))
        assert json_content["feedback_data"][0]["feedback_comment"] == ""
        assert json_content["feedback_data"][0]["has_comment"] == "No"

    # Test 20: CSV headers validation
    @patch("services.feedback_service.db")
    def test_export_feedbacks_csv_headers(self, mock_db, factory, sample_feedback_data):
        """Test that CSV contains all expected headers."""
        # Arrange
        mock_query = MagicMock()
        mock_db.session.query.return_value = mock_query
        mock_query.join.return_value = mock_query
        mock_query.outerjoin.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.all.return_value = sample_feedback_data

        expected_headers = [
            "feedback_id",
            "app_name",
            "app_id",
            "conversation_id",
            "conversation_name",
            "message_id",
            "user_query",
            "ai_response",
            "feedback_rating",
            "feedback_rating_raw",
            "feedback_comment",
            "feedback_source",
            "feedback_date",
            "message_date",
            "from_account_name",
            "from_end_user_id",
            "has_comment",
        ]

        # Act
        response = FeedbackService.export_feedbacks(app_id="app-456", format_type="csv")

        # Assert
        csv_content = response.get_data(as_text=True)
        reader = csv.DictReader(io.StringIO(csv_content))
        assert list(reader.fieldnames) == expected_headers
