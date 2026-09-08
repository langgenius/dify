"""The public telemetry entry point shares the gateway's explicit event API."""

from core import telemetry
from core.telemetry.gateway import emit


def test_public_facade_exports_gateway_and_event_types():
    assert telemetry.emit is emit
    assert telemetry.TelemetryContext is not None
    assert telemetry.DraftNodeExecutionTraceEvent is not None
    assert telemetry.PromptGenerationEvent is not None
