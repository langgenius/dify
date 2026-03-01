from unittest.mock import MagicMock, patch

import pytest

from enterprise.telemetry import event_handlers
from enterprise.telemetry.contracts import TelemetryCase


@pytest.fixture
def mock_gateway_emit():
    with patch("core.telemetry.gateway.emit") as mock:
        yield mock


def test_handle_app_created_calls_task(mock_gateway_emit):
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"
    sender.mode = "chat"

    event_handlers._handle_app_created(sender)

    mock_gateway_emit.assert_called_once_with(
        case=TelemetryCase.APP_CREATED,
        context={"tenant_id": "tenant-456"},
        payload={"app_id": "app-123", "mode": "chat"},
    )


def test_handle_app_created_no_exporter(mock_gateway_emit):
    """Gateway handles exporter availability internally; handler always calls gateway."""
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"

    event_handlers._handle_app_created(sender)

    mock_gateway_emit.assert_called_once()


def test_handle_app_updated_calls_task(mock_gateway_emit):
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"

    event_handlers._handle_app_updated(sender)

    mock_gateway_emit.assert_called_once_with(
        case=TelemetryCase.APP_UPDATED,
        context={"tenant_id": "tenant-456"},
        payload={"app_id": "app-123"},
    )


def test_handle_app_deleted_calls_task(mock_gateway_emit):
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"

    event_handlers._handle_app_deleted(sender)

    mock_gateway_emit.assert_called_once_with(
        case=TelemetryCase.APP_DELETED,
        context={"tenant_id": "tenant-456"},
        payload={"app_id": "app-123"},
    )


def test_handle_feedback_created_calls_task(mock_gateway_emit):
    sender = MagicMock()
    sender.message_id = "msg-123"
    sender.app_id = "app-456"
    sender.conversation_id = "conv-789"
    sender.from_end_user_id = "user-001"
    sender.from_account_id = None
    sender.rating = "like"
    sender.from_source = "api"
    sender.content = "Great response!"

    event_handlers._handle_feedback_created(sender, tenant_id="tenant-456")

    mock_gateway_emit.assert_called_once_with(
        case=TelemetryCase.FEEDBACK_CREATED,
        context={"tenant_id": "tenant-456"},
        payload={
            "message_id": "msg-123",
            "app_id": "app-456",
            "conversation_id": "conv-789",
            "from_end_user_id": "user-001",
            "from_account_id": None,
            "rating": "like",
            "from_source": "api",
            "content": "Great response!",
        },
    )


def test_handle_feedback_created_no_exporter(mock_gateway_emit):
    """Gateway handles exporter availability internally; handler always calls gateway."""
    sender = MagicMock()
    sender.message_id = "msg-123"

    event_handlers._handle_feedback_created(sender, tenant_id="tenant-456")

    mock_gateway_emit.assert_called_once()


def test_handlers_create_valid_envelopes(mock_gateway_emit):
    """Verify handlers pass correct TelemetryCase and payload structure."""
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"
    sender.mode = "chat"

    event_handlers._handle_app_created(sender)

    call_kwargs = mock_gateway_emit.call_args[1]
    assert call_kwargs["case"] == TelemetryCase.APP_CREATED
    assert call_kwargs["context"]["tenant_id"] == "tenant-456"
    assert call_kwargs["payload"]["app_id"] == "app-123"
    assert call_kwargs["payload"]["mode"] == "chat"
