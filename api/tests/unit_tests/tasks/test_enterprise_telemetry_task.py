"""Unit tests for enterprise telemetry Celery task."""

import json
from unittest.mock import MagicMock, patch

import pytest

from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
from tasks.enterprise_telemetry_task import process_enterprise_telemetry


@pytest.fixture
def sample_envelope_json():
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_CREATED,
        tenant_id="test-tenant",
        event_id="test-event-123",
        payload={"app_id": "app-123"},
    )
    return envelope.model_dump_json()


def test_process_enterprise_telemetry_success(sample_envelope_json):
    with patch("tasks.enterprise_telemetry_task.EnterpriseMetricHandler") as mock_handler_class:
        mock_handler = MagicMock()
        mock_handler_class.return_value = mock_handler

        process_enterprise_telemetry(sample_envelope_json)

        mock_handler.handle.assert_called_once()
        call_args = mock_handler.handle.call_args[0][0]
        assert isinstance(call_args, TelemetryEnvelope)
        assert call_args.case == TelemetryCase.APP_CREATED
        assert call_args.tenant_id == "test-tenant"
        assert call_args.event_id == "test-event-123"


def test_process_enterprise_telemetry_invalid_json(caplog):
    invalid_json = "not valid json"

    process_enterprise_telemetry(invalid_json)

    assert "Failed to process enterprise telemetry envelope" in caplog.text


def test_process_enterprise_telemetry_handler_exception(sample_envelope_json, caplog):
    with patch("tasks.enterprise_telemetry_task.EnterpriseMetricHandler") as mock_handler_class:
        mock_handler = MagicMock()
        mock_handler.handle.side_effect = Exception("Handler error")
        mock_handler_class.return_value = mock_handler

        process_enterprise_telemetry(sample_envelope_json)

        assert "Failed to process enterprise telemetry envelope" in caplog.text


def test_process_enterprise_telemetry_validation_error(caplog):
    invalid_envelope = json.dumps(
        {
            "case": "INVALID_CASE",
            "tenant_id": "test-tenant",
            "event_id": "test-event",
            "payload": {},
        }
    )

    process_enterprise_telemetry(invalid_envelope)

    assert "Failed to process enterprise telemetry envelope" in caplog.text
