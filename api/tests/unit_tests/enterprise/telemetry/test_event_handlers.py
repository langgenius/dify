from unittest.mock import MagicMock, patch

import pytest

from enterprise.telemetry import event_handlers
from enterprise.telemetry.contracts import TelemetryCase


@pytest.fixture
def mock_telemetry_emit():
    with patch("core.telemetry.emit") as mock:
        yield mock


def test_handle_app_created_calls_emit(mock_telemetry_emit):
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"
    sender.mode = "chat"

    event_handlers._handle_app_created(sender)

    mock_telemetry_emit.assert_called_once()
    event = mock_telemetry_emit.call_args[0][0]
    assert event.case == TelemetryCase.APP_CREATED
    assert event.context.tenant_id == "tenant-456"
    assert event.payload["app_id"] == "app-123"
    assert event.payload["mode"] == "chat"


def test_handle_app_created_no_exporter(mock_telemetry_emit):
    """Public facade handles exporter availability internally; handler always calls it."""
    sender = MagicMock()
    sender.id = "app-123"
    sender.tenant_id = "tenant-456"

    event_handlers._handle_app_created(sender)

    mock_telemetry_emit.assert_called_once()
