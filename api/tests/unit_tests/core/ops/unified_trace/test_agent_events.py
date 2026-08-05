import pytest

from core.ops.ops_trace_manager import OpsTraceManager
from core.ops.unified_trace.agent_events import (
    REDACTED_VALUE,
    TRACE_VALUE_LIMIT,
    AgentTraceCollectionGate,
    bound_trace_value,
)


def test_collection_gate_disables_tracing_when_no_provider_is_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lambda _app_id: None)

    assert AgentTraceCollectionGate.for_app("app-1").enabled is False


def test_bound_trace_value_redacts_sensitive_mapping_values() -> None:
    value = {"api_key": "secret", "city": "Paris"}

    assert bound_trace_value(value) == {"api_key": REDACTED_VALUE, "city": "Paris"}


def test_bound_trace_value_marks_truncated_strings() -> None:
    bounded = bound_trace_value("x" * (TRACE_VALUE_LIMIT + 1))

    assert bounded == {"value": "x" * TRACE_VALUE_LIMIT, "truncated": True}


def test_bound_trace_value_redacts_jwe_shaped_values() -> None:
    assert bound_trace_value("header.payload.signature") == REDACTED_VALUE
