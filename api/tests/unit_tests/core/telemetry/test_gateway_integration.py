"""Telemetry traces enter the tenant-checked OPS service exactly once."""

import sys
from unittest.mock import patch

import pytest

from core.telemetry.events import (
    DraftNodeExecutionTraceEvent,
    PromptGenerationEvent,
    TelemetryContext,
)
from core.telemetry.gateway import emit, is_enterprise_telemetry_enabled


def make_trace_event(kind):
    context = TelemetryContext(tenant_id="tenant", user_id="actor", app_id="app")
    if kind == "node":
        return DraftNodeExecutionTraceEvent(context=context, payload={"node_execution_data": {"id": "execution"}})
    return PromptGenerationEvent(
        context=context,
        payload={
            "tenant_id": "tenant",
            "operation_type": "generate",
            "instruction": "test",
            "generated_output": "out",
            "model_provider": "provider",
            "model_name": "model",
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "latency": 0.5,
        },
    )


@pytest.mark.parametrize("kind", ["node", "prompt"])
@pytest.mark.parametrize("enabled", [False, True])
def test_enterprise_traces_use_owned_event_and_respect_enablement(kind, enabled):
    event = make_trace_event(kind)
    with (
        patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=enabled),
        patch("services.ops_trace_service.record_enterprise_operation") as record,
    ):
        emit(event)
    if enabled:
        record.assert_called_once_with(event)
        assert record.call_args.args[0].context.tenant_id == "tenant"
    else:
        record.assert_not_called()


def test_trace_recording_error_does_not_interrupt_application(caplog):
    with (
        patch("core.telemetry.gateway.is_enterprise_telemetry_enabled", return_value=True),
        patch("services.ops_trace_service.record_enterprise_operation", side_effect=ValueError("private data")),
    ):
        emit(make_trace_event("node"))
    assert "Cannot record enterprise trace" in caplog.text
    assert "private data" not in caplog.text


def test_missing_enterprise_exporter_disables_telemetry():
    with patch.dict(sys.modules, {"enterprise.telemetry.exporter": None}):
        assert not is_enterprise_telemetry_enabled()
