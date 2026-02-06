from unittest.mock import MagicMock, patch

import pytest

from enterprise.telemetry import event_handlers
from enterprise.telemetry.contracts import TelemetryCase


@pytest.fixture
def mock_exporter():
    with patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock:
        exporter = MagicMock()
        mock.return_value = exporter
        yield exporter


@pytest.fixture
def mock_task():
    with patch("tasks.enterprise_telemetry_task.process_enterprise_telemetry") as mock:
        yield mock


def test_handle_app_created_calls_task(mock_exporter, mock_task):
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"
    sender.mode = "chat"

    event_handlers._handle_app_created(sender)

    mock_task.delay.assert_called_once()
    call_args = mock_task.delay.call_args[0][0]
    assert "app_created" in call_args
    assert "tenant-456" in call_args
    assert "app-123" in call_args
    assert "chat" in call_args


def test_handle_app_created_no_exporter(mock_task):
    with patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter", return_value=None):
        sender = MagicMock()
        sender.id = "app-123"
        sender.tenant_id = "tenant-456"

        event_handlers._handle_app_created(sender)

        mock_task.delay.assert_not_called()


def test_handle_app_updated_calls_task(mock_exporter, mock_task):
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"

    event_handlers._handle_app_updated(sender)

    mock_task.delay.assert_called_once()
    call_args = mock_task.delay.call_args[0][0]
    assert "app_updated" in call_args
    assert "tenant-456" in call_args
    assert "app-123" in call_args


def test_handle_app_deleted_calls_task(mock_exporter, mock_task):
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"

    event_handlers._handle_app_deleted(sender)

    mock_task.delay.assert_called_once()
    call_args = mock_task.delay.call_args[0][0]
    assert "app_deleted" in call_args
    assert "tenant-456" in call_args
    assert "app-123" in call_args


def test_handle_feedback_created_calls_task(mock_exporter, mock_task):
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

    mock_task.delay.assert_called_once()
    call_args = mock_task.delay.call_args[0][0]
    assert "feedback_created" in call_args
    assert "tenant-456" in call_args
    assert "msg-123" in call_args
    assert "app-456" in call_args
    assert "conv-789" in call_args
    assert "user-001" in call_args
    assert "like" in call_args
    assert "api" in call_args
    assert "Great response!" in call_args


def test_handle_feedback_created_no_exporter(mock_task):
    with patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter", return_value=None):
        sender = MagicMock()
        sender.message_id = "msg-123"

        event_handlers._handle_feedback_created(sender, tenant_id="tenant-456")

        mock_task.delay.assert_not_called()


def test_handlers_create_valid_envelopes(mock_exporter, mock_task):
    import json

    from enterprise.telemetry.contracts import TelemetryEnvelope

    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"
    sender.mode = "chat"

    event_handlers._handle_app_created(sender)

    call_args = mock_task.delay.call_args[0][0]
    envelope_dict = json.loads(call_args)
    envelope = TelemetryEnvelope(**envelope_dict)

    assert envelope.case == TelemetryCase.APP_CREATED
    assert envelope.tenant_id == "tenant-456"
    assert envelope.event_id
    assert envelope.payload["app_id"] == "app-123"
    assert envelope.payload["mode"] == "chat"
