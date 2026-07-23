from datetime import datetime
from unittest.mock import MagicMock

import pytest

from core.helper.trace_id_helper import ParentTraceContext
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.parent_context import ParentResolution
from core.ops.unified_trace.provider import UnifiedTraceInstance


def canonical_trace(*, nested: bool = False, required_parent_context_id: str | None = None) -> CanonicalTrace:
    parent = (
        ParentTraceContext(parent_workflow_run_id="outer-run", parent_node_execution_id="outer-tool")
        if nested
        else None
    )
    return CanonicalTrace(
        trace_id="trace-1",
        session_id="session-1",
        root_span_id="root-1",
        external_parent=parent,
        required_parent_context_id=required_parent_context_id,
        spans=(
            CanonicalSpan(
                id="root-1",
                parent_id=None,
                name="root",
                kind=CanonicalSpanKind.CHAIN,
                start_time=datetime(2025, 1, 1),
                end_time=datetime(2025, 1, 1, 0, 0, 1),
                status=CanonicalSpanStatus.OK,
            ),
        ),
    )


def make_runtime(trace: CanonicalTrace):
    builder = MagicMock()
    builder.build.return_value = trace
    adapter = MagicMock(provider_name="langsmith", scope="scope-a")
    adapter.provider_name = "langsmith"
    adapter.scope = "scope-a"
    coordinator = MagicMock()
    runtime = UnifiedTraceInstance(MagicMock(), builder=builder, adapter=adapter, coordinator=coordinator)
    return runtime, builder, adapter, coordinator


def test_runtime_passes_core_publisher_to_adapter():
    runtime, _, adapter, coordinator = make_runtime(canonical_trace())
    provider_context = MagicMock()

    def emit(trace, parent, publish_parent_context):
        publish_parent_context("tool-exec", provider_context)

    adapter.emit.side_effect = emit

    runtime.trace(MagicMock())

    coordinator.publish.assert_called_once_with("tool-exec", provider_context)


def test_runtime_resolves_nested_parent_before_emission():
    runtime, _, adapter, coordinator = make_runtime(canonical_trace(nested=True))
    resolution = ParentResolution.restored(MagicMock())
    coordinator.resolve.return_value = resolution

    runtime.trace(MagicMock())

    coordinator.resolve.assert_called_once()
    assert coordinator.resolve.call_args.kwargs == {
        "expected_provider": "langsmith",
        "expected_scope": "scope-a",
    }
    adapter.emit.assert_called_once()
    assert adapter.emit.call_args.args[1] is resolution


def test_runtime_resolves_required_message_parent_before_emission():
    runtime, _, adapter, coordinator = make_runtime(canonical_trace(required_parent_context_id="message-1"))
    resolution = ParentResolution.restored(MagicMock())
    coordinator.resolve_required.return_value = resolution

    runtime.trace(MagicMock())

    coordinator.resolve_required.assert_called_once_with(
        "message-1",
        expected_provider="langsmith",
        expected_scope="scope-a",
    )
    coordinator.resolve.assert_not_called()
    assert adapter.emit.call_args.args[1] is resolution


def test_runtime_does_not_publish_when_adapter_fails_before_callback():
    runtime, _, adapter, coordinator = make_runtime(canonical_trace())
    adapter.emit.side_effect = RuntimeError("provider rejected run")

    with pytest.raises(RuntimeError, match="provider rejected run"):
        runtime.trace(MagicMock())

    coordinator.publish.assert_not_called()


def test_runtime_has_no_legacy_fallback():
    runtime, _, adapter, _ = make_runtime(canonical_trace())
    adapter.emit.side_effect = RuntimeError("terminal")

    with pytest.raises(RuntimeError, match="terminal"):
        runtime.trace(MagicMock())

    assert not hasattr(runtime, "legacy_provider")
