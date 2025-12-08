"""Integration tests for Feedback Export API endpoints."""

import json
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest import mock

import pytest
from flask.testing import FlaskClient

from controllers.console.app import message as message_api
from controllers.console.app import wraps
from libs.datetime_utils import naive_utc_now
from models import App, Tenant
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.model import AppMode, MessageFeedback
from services.feedback_service import FeedbackService


class TestFeedbackExportApi:
    """Test feedback export API endpoints."""

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model for testing."""
        app = App()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.CHAT
        app.tenant_id = str(uuid.uuid4())
        app.status = "normal"
        app.name = "Test App"
        return app

    @pytest.fixture
    def mock_account(self, monkeypatch: pytest.MonkeyPatch):
        """Create a mock Account for testing."""
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.last_active_at = naive_utc_now()
        account.created_at = naive_utc_now()
        account.updated_at = naive_utc_now()
        account.id = str(uuid.uuid4())

        # Create mock tenant
        tenant = Tenant(name="Test Tenant")
        tenant.id = str(uuid.uuid4())

        mock_session_instance = mock.Mock()

        mock_tenant_join = TenantAccountJoin(role=TenantAccountRole.OWNER)
        monkeypatch.setattr(mock_session_instance, "scalar", mock.Mock(return_value=mock_tenant_join))

        mock_scalars_result = mock.Mock()
        mock_scalars_result.one.return_value = tenant
        monkeypatch.setattr(mock_session_instance, "scalars", mock.Mock(return_value=mock_scalars_result))

        mock_session_context = mock.Mock()
        mock_session_context.__enter__.return_value = mock_session_instance
        monkeypatch.setattr("models.account.Session", lambda _, expire_on_commit: mock_session_context)

        account.current_tenant = tenant
        return account

    @pytest.fixture
    def sample_feedback_data(self):
        """Create sample feedback data for testing."""
        app_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())
        message_id = str(uuid.uuid4())

        # Mock feedback data
        user_feedback = MessageFeedback(
            id=str(uuid.uuid4()),
            app_id=app_id,
            conversation_id=conversation_id,
            message_id=message_id,
            rating="like",
            from_source="user",
            content=None,
            from_end_user_id=str(uuid.uuid4()),
            from_account_id=None,
            created_at=naive_utc_now(),
        )

        admin_feedback = MessageFeedback(
            id=str(uuid.uuid4()),
            app_id=app_id,
            conversation_id=conversation_id,
            message_id=message_id,
            rating="dislike",
            from_source="admin",
            content="The response was not helpful",
            from_end_user_id=None,
            from_account_id=str(uuid.uuid4()),
            created_at=naive_utc_now(),
        )

        # Mock message and conversation
        mock_message = SimpleNamespace(
            id=message_id,
            conversation_id=conversation_id,
            query="What is the weather today?",
            answer="It's sunny and 25 degrees outside.",
            inputs={"query": "What is the weather today?"},
            created_at=naive_utc_now(),
        )

        mock_conversation = SimpleNamespace(id=conversation_id, name="Weather Conversation", app_id=app_id)

        mock_app = SimpleNamespace(id=app_id, name="Weather App")

        return {
            "user_feedback": user_feedback,
            "admin_feedback": admin_feedback,
            "message": mock_message,
            "conversation": mock_conversation,
            "app": mock_app,
        }

    @pytest.mark.parametrize(
        ("role", "status"),
        [
            (TenantAccountRole.OWNER, 200),
            (TenantAccountRole.ADMIN, 200),
            (TenantAccountRole.EDITOR, 200),
            (TenantAccountRole.NORMAL, 403),
            (TenantAccountRole.DATASET_OPERATOR, 403),
        ],
    )
    def test_feedback_export_permissions(
        self,
        test_client: FlaskClient,
        auth_header,
        monkeypatch,
        mock_app_model,
        mock_account,
        role: TenantAccountRole,
        status: int,
    ):
        """Test feedback export endpoint permissions."""

        # Setup mocks
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        mock_export_feedbacks = mock.Mock(return_value="mock csv response")
        monkeypatch.setattr(FeedbackService, "export_feedbacks", mock_export_feedbacks)

        monkeypatch.setattr(message_api, "current_user", mock_account)

        # Set user role
        mock_account.role = role

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/feedbacks/export",
            headers=auth_header,
            query_string={"format": "csv"},
        )

        assert response.status_code == status

        if status == 200:
            mock_export_feedbacks.assert_called_once()

    def test_feedback_export_csv_format(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, sample_feedback_data
    ):
        """Test feedback export in CSV format."""

        # Setup mocks
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        # Create mock CSV response
        mock_csv_content = (
            "feedback_id,app_name,conversation_id,user_query,ai_response,feedback_rating,feedback_comment\n"
        )
        mock_csv_content += f"{sample_feedback_data['user_feedback'].id},{sample_feedback_data['app'].name},"
        mock_csv_content += f"{sample_feedback_data['conversation'].id},{sample_feedback_data['message'].query},"
        mock_csv_content += f"{sample_feedback_data['message'].answer},👍,\n"

        mock_response = mock.Mock()
        mock_response.headers = {"Content-Type": "text/csv; charset=utf-8-sig"}
        mock_response.data = mock_csv_content.encode("utf-8")

        mock_export_feedbacks = mock.Mock(return_value=mock_response)
        monkeypatch.setattr(FeedbackService, "export_feedbacks", mock_export_feedbacks)

        monkeypatch.setattr(message_api, "current_user", mock_account)

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/feedbacks/export",
            headers=auth_header,
            query_string={"format": "csv", "from_source": "user"},
        )

        assert response.status_code == 200
        assert "text/csv" in response.content_type

    def test_feedback_export_json_format(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, sample_feedback_data
    ):
        """Test feedback export in JSON format."""

        # Setup mocks
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        mock_json_response = {
            "export_info": {
                "app_id": mock_app_model.id,
                "export_date": datetime.now().isoformat(),
                "total_records": 2,
                "data_source": "dify_feedback_export",
            },
            "feedback_data": [
                {
                    "feedback_id": sample_feedback_data["user_feedback"].id,
                    "feedback_rating": "👍",
                    "feedback_rating_raw": "like",
                    "feedback_comment": "",
                }
            ],
        }

        mock_response = mock.Mock()
        mock_response.headers = {"Content-Type": "application/json; charset=utf-8"}
        mock_response.data = json.dumps(mock_json_response).encode("utf-8")

        mock_export_feedbacks = mock.Mock(return_value=mock_response)
        monkeypatch.setattr(FeedbackService, "export_feedbacks", mock_export_feedbacks)

        monkeypatch.setattr(message_api, "current_user", mock_account)

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/feedbacks/export",
            headers=auth_header,
            query_string={"format": "json"},
        )

        assert response.status_code == 200
        assert "application/json" in response.content_type

    def test_feedback_export_with_filters(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account
    ):
        """Test feedback export with various filters."""

        # Setup mocks
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        mock_export_feedbacks = mock.Mock(return_value="mock filtered response")
        monkeypatch.setattr(FeedbackService, "export_feedbacks", mock_export_feedbacks)

        monkeypatch.setattr(message_api, "current_user", mock_account)

        # Test with multiple filters
        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/feedbacks/export",
            headers=auth_header,
            query_string={
                "from_source": "user",
                "rating": "dislike",
                "has_comment": True,
                "start_date": "2024-01-01",
                "end_date": "2024-12-31",
                "format": "csv",
            },
        )

        assert response.status_code == 200

        # Verify service was called with correct parameters
        mock_export_feedbacks.assert_called_once_with(
            app_id=mock_app_model.id,
            from_source="user",
            rating="dislike",
            has_comment=True,
            start_date="2024-01-01",
            end_date="2024-12-31",
            format_type="csv",
        )

    def test_feedback_export_invalid_date_format(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account
    ):
        """Test feedback export with invalid date format."""

        # Setup mocks
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        # Mock the service to raise ValueError for invalid date
        mock_export_feedbacks = mock.Mock(side_effect=ValueError("Invalid date format"))
        monkeypatch.setattr(FeedbackService, "export_feedbacks", mock_export_feedbacks)

        monkeypatch.setattr(message_api, "current_user", mock_account)

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/feedbacks/export",
            headers=auth_header,
            query_string={"start_date": "invalid-date", "format": "csv"},
        )

        assert response.status_code == 400
        response_json = response.get_json()
        assert "Parameter validation error" in response_json["error"]

    def test_feedback_export_server_error(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account
    ):
        """Test feedback export with server error."""

        # Setup mocks
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        # Mock the service to raise an exception
        mock_export_feedbacks = mock.Mock(side_effect=Exception("Database connection failed"))
        monkeypatch.setattr(FeedbackService, "export_feedbacks", mock_export_feedbacks)

        monkeypatch.setattr(message_api, "current_user", mock_account)

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/feedbacks/export",
            headers=auth_header,
            query_string={"format": "csv"},
        )

        assert response.status_code == 500
