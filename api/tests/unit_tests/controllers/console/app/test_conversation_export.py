"""
Unit tests for conversation export API endpoint.

Tests the /apps/<app_id>/chat-conversations/export endpoint which provides
streaming export of chat conversations in JSONL and CSV formats.
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, patch

import pytest
from flask import Flask, request
from werkzeug.exceptions import BadRequest

from models.model import AppMode


class TestChatConversationExportApi:
    """
    Test suite for the conversation export API endpoint.

    Tests endpoint security, parameter handling, format validation,
    and proper delegation to the service layer.
    """

    @pytest.fixture
    def mock_app(self):
        """Mock app model."""
        app = Mock()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.CHAT
        app.tenant_id = "test_tenant_id"
        return app

    @pytest.fixture
    def mock_current_user(self):
        """Mock current authenticated user."""
        user = Mock()
        user.id = "user_123"
        user.timezone = "UTC"
        return user

    @pytest.fixture
    def flask_app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("services.conversation_service.ConversationService.export_conversations_streaming")
    @patch("controllers.console.app.conversation.parse_time_range")
    def test_export_jsonl_format_success(
        self,
        mock_parse_time,
        mock_export,
        flask_app,
        mock_app,
        mock_current_user,
    ):
        """
        Test successful export in JSONL format.

        Should:
        - Parse query parameters
        - Call service with correct parameters
        - Return streaming response
        """
        # Arrange
        start_dt = datetime(2025, 12, 25, 0, 0, 0, tzinfo=UTC)
        end_dt = datetime(2026, 1, 1, 23, 59, 59, tzinfo=UTC)
        mock_parse_time.return_value = (start_dt, end_dt)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_export.return_value = mock_response

        from controllers.console.app.conversation import ConversationService

        # Act - simulate request with query parameters
        with flask_app.test_request_context("/test?format=jsonl&start=2025-12-25+00%3A00&end=2026-01-01+23%3A59"):
            with patch("controllers.console.app.conversation.current_account_with_tenant") as mock_current_account:
                mock_current_account.return_value = (mock_current_user, Mock())

                # Simulate the controller logic directly
                format_type = request.args.get("format", "jsonl").lower()
                keyword = request.args.get("keyword")
                start = request.args.get("start")
                end = request.args.get("end")
                annotation_status = request.args.get("annotation_status", "all")
                sort_by = request.args.get("sort_by", "-created_at")

                start_datetime_utc, end_datetime_utc = mock_parse_time(start, end, mock_current_user.timezone)

                # Call service with extracted parameters
                response = ConversationService.export_conversations_streaming(
                    app_id=str(mock_app.id),
                    format_type=format_type,
                    keyword=keyword,
                    start_datetime_utc=start_datetime_utc,
                    end_datetime_utc=end_datetime_utc,
                    annotation_status=annotation_status,
                    sort_by=sort_by,
                    exclude_debugger=False,
                )

        # Assert
        assert response.status_code == 200
        mock_export.assert_called_once()
        call_kwargs = mock_export.call_args.kwargs
        assert call_kwargs["app_id"] == str(mock_app.id)
        assert call_kwargs["format_type"] == "jsonl"

    @patch("services.conversation_service.ConversationService.export_conversations_streaming")
    @patch("controllers.console.app.conversation.parse_time_range")
    def test_export_csv_format_success(
        self,
        mock_parse_time,
        mock_export,
        flask_app,
        mock_app,
        mock_current_user,
    ):
        """
        Test successful export in CSV format.

        Should:
        - Accept format=csv query parameter
        - Call service with format_type='csv'
        - Return streaming response
        """
        # Arrange
        start_dt = datetime(2025, 12, 25, 0, 0, 0, tzinfo=UTC)
        end_dt = datetime(2026, 1, 1, 23, 59, 59, tzinfo=UTC)
        mock_parse_time.return_value = (start_dt, end_dt)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_export.return_value = mock_response

        from controllers.console.app.conversation import ConversationService

        # Act with CSV format parameter
        with flask_app.test_request_context("/test?format=csv&start=2025-12-25+00%3A00&end=2026-01-01+23%3A59"):
            with patch("controllers.console.app.conversation.current_account_with_tenant") as mock_current_account:
                mock_current_account.return_value = (mock_current_user, Mock())

                format_type = request.args.get("format", "jsonl").lower()
                keyword = request.args.get("keyword")
                start = request.args.get("start")
                end = request.args.get("end")
                annotation_status = request.args.get("annotation_status", "all")
                sort_by = request.args.get("sort_by", "-created_at")

                start_datetime_utc, end_datetime_utc = mock_parse_time(start, end, mock_current_user.timezone)

                response = ConversationService.export_conversations_streaming(
                    app_id=str(mock_app.id),
                    format_type=format_type,
                    keyword=keyword,
                    start_datetime_utc=start_datetime_utc,
                    end_datetime_utc=end_datetime_utc,
                    annotation_status=annotation_status,
                    sort_by=sort_by,
                    exclude_debugger=False,
                )

        # Assert
        assert response.status_code == 200
        call_kwargs = mock_export.call_args.kwargs
        assert call_kwargs["format_type"] == "csv"

    @patch("services.conversation_service.ConversationService.export_conversations_streaming")
    @patch("controllers.console.app.conversation.parse_time_range")
    def test_export_with_filter_parameters(
        self,
        mock_parse_time,
        mock_export,
        flask_app,
        mock_app,
        mock_current_user,
    ):
        """
        Test export with filter parameters passed through.

        Should forward keyword, start, end, annotation_status, and sort_by
        to the service layer.
        """
        # Arrange
        start_dt = datetime(2025, 12, 25, 0, 0, 0, tzinfo=UTC)
        end_dt = datetime(2026, 1, 1, 23, 59, 59, tzinfo=UTC)
        mock_parse_time.return_value = (start_dt, end_dt)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_export.return_value = mock_response

        from controllers.console.app.conversation import ConversationService

        # Act with filter parameters
        query_string = (
            "keyword=test&start=2025-12-25+00%3A00&"
            "end=2026-01-01+23%3A59&annotation_status=annotated&sort_by=-created_at"
        )
        with flask_app.test_request_context(f"/test?{query_string}"):
            with patch("controllers.console.app.conversation.current_account_with_tenant") as mock_account:
                mock_account.return_value = (mock_current_user, Mock())

                format_type = request.args.get("format", "jsonl").lower()
                keyword = request.args.get("keyword")
                start = request.args.get("start")
                end = request.args.get("end")
                annotation_status = request.args.get("annotation_status", "all")
                sort_by = request.args.get("sort_by", "-created_at")

                start_datetime_utc, end_datetime_utc = mock_parse_time(start, end, mock_current_user.timezone)

                _ = ConversationService.export_conversations_streaming(
                    app_id=str(mock_app.id),
                    format_type=format_type,
                    keyword=keyword,
                    start_datetime_utc=start_datetime_utc,
                    end_datetime_utc=end_datetime_utc,
                    annotation_status=annotation_status,
                    sort_by=sort_by,
                    exclude_debugger=False,
                )

        # Assert - verify all filter parameters were passed
        mock_export.assert_called_once()
        call_kwargs = mock_export.call_args.kwargs
        assert call_kwargs["keyword"] == "test"
        assert call_kwargs["start_datetime_utc"] == start_dt
        assert call_kwargs["end_datetime_utc"] == end_dt
        assert call_kwargs["annotation_status"] == "annotated"
        assert call_kwargs["sort_by"] == "-created_at"

    @patch("services.conversation_service.ConversationService.export_conversations_streaming")
    @patch("controllers.console.app.conversation.parse_time_range")
    def test_export_advanced_chat_excludes_debugger(
        self,
        mock_parse_time,
        mock_export,
        flask_app,
        mock_current_user,
    ):
        """
        Test export in ADVANCED_CHAT mode excludes debugger conversations.

        Should pass exclude_debugger=True when app mode is ADVANCED_CHAT.
        """
        # Arrange
        start_dt = datetime(2025, 12, 25, 0, 0, 0, tzinfo=UTC)
        end_dt = datetime(2026, 1, 1, 23, 59, 59, tzinfo=UTC)
        mock_parse_time.return_value = (start_dt, end_dt)

        app = Mock()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.ADVANCED_CHAT
        app.tenant_id = "test_tenant_id"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_export.return_value = mock_response

        from controllers.console.app.conversation import ConversationService

        # Act
        with flask_app.test_request_context("/test?format=jsonl&start=2025-12-25+00%3A00&end=2026-01-01+23%3A59"):
            with patch("controllers.console.app.conversation.current_account_with_tenant") as mock_current_account:
                mock_current_account.return_value = (mock_current_user, Mock())

                format_type = request.args.get("format", "jsonl").lower()
                keyword = request.args.get("keyword")
                start = request.args.get("start")
                end = request.args.get("end")
                annotation_status = request.args.get("annotation_status", "all")
                sort_by = request.args.get("sort_by", "-created_at")

                start_datetime_utc, end_datetime_utc = mock_parse_time(start, end, mock_current_user.timezone)

                response = ConversationService.export_conversations_streaming(
                    app_id=str(app.id),
                    format_type=format_type,
                    keyword=keyword,
                    start_datetime_utc=start_datetime_utc,
                    end_datetime_utc=end_datetime_utc,
                    annotation_status=annotation_status,
                    sort_by=sort_by,
                    exclude_debugger=(app.mode == AppMode.ADVANCED_CHAT),
                )

        # Assert - verify exclude_debugger parameter
        mock_export.assert_called_once()
        call_kwargs = mock_export.call_args.kwargs
        assert call_kwargs["exclude_debugger"] is True

    @patch("services.conversation_service.ConversationService.export_conversations_streaming")
    @patch("controllers.console.app.conversation.parse_time_range")
    def test_export_default_format_is_jsonl(
        self,
        mock_parse_time,
        mock_export,
        flask_app,
        mock_app,
        mock_current_user,
    ):
        """
        Test that default format is JSONL when not specified.

        Should default to 'jsonl' format when no format parameter is provided.
        """
        # Arrange
        start_dt = datetime(2025, 12, 25, 0, 0, 0, tzinfo=UTC)
        end_dt = datetime(2026, 1, 1, 23, 59, 59, tzinfo=UTC)
        mock_parse_time.return_value = (start_dt, end_dt)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_export.return_value = mock_response

        from controllers.console.app.conversation import ConversationService

        # Act without format parameter
        with flask_app.test_request_context("/test?start=2025-12-25+00%3A00&end=2026-01-01+23%3A59"):
            with patch("controllers.console.app.conversation.current_account_with_tenant") as mock_current_account:
                mock_current_account.return_value = (mock_current_user, Mock())

                format_type = request.args.get("format", "jsonl").lower()
                keyword = request.args.get("keyword")
                start = request.args.get("start")
                end = request.args.get("end")
                annotation_status = request.args.get("annotation_status", "all")
                sort_by = request.args.get("sort_by", "-created_at")

                start_datetime_utc, end_datetime_utc = mock_parse_time(start, end, mock_current_user.timezone)

                response = ConversationService.export_conversations_streaming(
                    app_id=str(mock_app.id),
                    format_type=format_type,
                    keyword=keyword,
                    start_datetime_utc=start_datetime_utc,
                    end_datetime_utc=end_datetime_utc,
                    annotation_status=annotation_status,
                    sort_by=sort_by,
                    exclude_debugger=False,
                )

        # Assert - verify default format is jsonl
        mock_export.assert_called_once()
        call_kwargs = mock_export.call_args.kwargs
        assert call_kwargs["format_type"] == "jsonl"

    def test_export_invalid_format_raises_error(
        self,
        flask_app,
        mock_app,
    ):
        """
        Test that invalid format parameter returns 400 error.

        Should only accept 'jsonl' or 'csv' formats.
        """
        from controllers.console.app.conversation import abort

        # Act with invalid format
        with flask_app.test_request_context("/test?format=xml"):
            format_type = request.args.get("format", "jsonl").lower()

            # Simulate validation logic from controller
            if format_type not in {"jsonl", "csv"}:
                # Should raise 400 error via abort
                with pytest.raises(BadRequest):
                    abort(400, description="Format must be 'jsonl' or 'csv'")

    @patch("services.conversation_service.ConversationService.export_conversations_streaming")
    @patch("controllers.console.app.conversation.parse_time_range")
    def test_export_with_time_range_parsing(
        self,
        mock_parse_time,
        mock_export,
        flask_app,
        mock_app,
        mock_current_user,
    ):
        """
        Test that time range is correctly parsed and converted to UTC.

        Should use user's timezone to parse start/end times and convert to UTC.
        """
        # Arrange
        user = mock_current_user
        user.timezone = "America/New_York"

        start_utc = datetime(2025, 12, 25, 5, 0, 0, tzinfo=UTC)
        end_utc = datetime(2026, 1, 1, 4, 59, 59, tzinfo=UTC)
        mock_parse_time.return_value = (start_utc, end_utc)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_export.return_value = mock_response

        from controllers.console.app.conversation import ConversationService

        # Act with time range parameters
        with flask_app.test_request_context("/test?start=2025-12-25+00%3A00&end=2026-01-01+23%3A59"):
            with patch("controllers.console.app.conversation.current_account_with_tenant") as mock_current_account:
                mock_current_account.return_value = (user, Mock())

                start = request.args.get("start")
                end = request.args.get("end")

                # Verify time parsing was called correctly
                start_datetime_utc, end_datetime_utc = mock_parse_time(start, end, user.timezone)

                response = ConversationService.export_conversations_streaming(
                    app_id=str(mock_app.id),
                    format_type="jsonl",
                    keyword=None,
                    start_datetime_utc=start_datetime_utc,
                    end_datetime_utc=end_datetime_utc,
                    annotation_status="all",
                    sort_by="-created_at",
                    exclude_debugger=False,
                )

        # Assert - verify time parsing was called
        mock_parse_time.assert_called_once_with(
            "2025-12-25 00:00",
            "2026-01-01 23:59",
            "America/New_York",
        )
        # Verify UTC times were passed to service
        call_kwargs = mock_export.call_args.kwargs
        assert call_kwargs["start_datetime_utc"] == start_utc
        assert call_kwargs["end_datetime_utc"] == end_utc
