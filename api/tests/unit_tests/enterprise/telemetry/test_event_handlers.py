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
