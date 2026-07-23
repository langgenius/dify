import json
from unittest.mock import MagicMock

import pytest

from core.helper.trace_id_helper import ParentTraceContext
from core.ops.exceptions import (
    InvalidTraceParentContextError,
    PendingTraceParentContextError,
    TraceParentContextAccessError,
)
from core.ops.unified_trace.parent_context import (
    ParentContextCoordinator,
    ParentDestination,
    ParentResolutionKind,
    ProviderParentContext,
    destination_scope,
    parent_destination_from_config,
)


def parent() -> ParentTraceContext:
    return ParentTraceContext(parent_workflow_run_id="outer-run", parent_node_execution_id="outer-tool")


def context(**overrides) -> ProviderParentContext:
    values = {
        "provider": "langsmith",
        "scope": "scope-a",
        "trace_id": "root-run",
        "parent_id": "outer-tool",
        "provider_context": {"dotted_order": "root.tool"},
    }
    values.update(overrides)
    return ProviderParentContext(**values)


def coordinator(redis: MagicMock, destination: ParentDestination | None) -> ParentContextCoordinator:
    return ParentContextCoordinator(redis, lambda workflow_run_id: destination)


def test_parent_destination_uses_non_secret_provider_scope():
    destination = parent_destination_from_config(
        "langsmith",
        {"api_key": "secret", "endpoint": "https://smith.example", "project": "project-a"},
        unified=True,
    )

    assert destination == ParentDestination(
        provider="langsmith",
        scope=destination_scope("langsmith", "https://smith.example", "project-a"),
        unified=True,
    )
    assert "secret" not in destination.scope


def test_publish_uses_unified_namespace_and_ttl():
    redis = MagicMock()
    value = context()

    coordinator(redis, None).publish("outer-tool", value)

    key, ttl, payload = redis.setex.call_args.args
    assert key == "trace:unified:parent:outer-tool"
    assert ttl == 300
    assert json.loads(payload)["provider"] == "langsmith"


def test_resolve_returns_compatible_context():
    redis = MagicMock()
    redis.get.return_value = context().model_dump_json().encode()
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    result = subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")

    assert result.kind is ParentResolutionKind.RESTORED
    assert result.context == context()
    assert result.linked_parent is None


def test_resolve_required_restores_message_context_without_destination_lookup():
    redis = MagicMock()
    redis.get.return_value = context().model_dump_json().encode()
    resolve_destination = MagicMock()
    subject = ParentContextCoordinator(redis, resolve_destination)

    result = subject.resolve_required(
        "message-1",
        expected_provider="langsmith",
        expected_scope="scope-a",
    )

    assert result.kind is ParentResolutionKind.RESTORED
    assert result.context == context()
    redis.get.assert_called_once_with("trace:unified:parent:message-1")
    resolve_destination.assert_not_called()


def test_missing_required_message_context_is_retryable():
    redis = MagicMock()
    redis.get.return_value = None
    subject = coordinator(redis, None)

    with pytest.raises(PendingTraceParentContextError):
        subject.resolve_required(
            "message-1",
            expected_provider="langsmith",
            expected_scope="scope-a",
        )


def test_missing_compatible_context_is_retryable():
    redis = MagicMock()
    redis.get.return_value = None
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    with pytest.raises(PendingTraceParentContextError):
        subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")


def test_non_unified_or_incompatible_parent_becomes_linked_root():
    redis = MagicMock()
    destinations = [
        None,
        ParentDestination(provider="langsmith", scope="scope-a", unified=False),
        ParentDestination(provider="phoenix", scope="scope-a", unified=True),
        ParentDestination(provider="langsmith", scope="scope-b", unified=True),
    ]

    for destination in destinations:
        result = coordinator(redis, destination).resolve(
            parent(), expected_provider="langsmith", expected_scope="scope-a"
        )
        assert result.kind is ParentResolutionKind.LINKED_ROOT
        assert result.linked_parent == parent()

    redis.get.assert_not_called()


def test_malformed_or_stale_context_is_terminal():
    redis = MagicMock()
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    for payload in (b"not-json", b'{"version": 2}', context(scope="scope-b").model_dump_json().encode()):
        redis.get.return_value = payload
        with pytest.raises(InvalidTraceParentContextError):
            subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")


def test_redis_read_and_write_failures_are_retryable():
    redis = MagicMock()
    redis.get.side_effect = ConnectionError("down")
    redis.setex.side_effect = ConnectionError("down")
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    with pytest.raises(TraceParentContextAccessError):
        subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")
    with pytest.raises(TraceParentContextAccessError):
        subject.publish("outer-tool", context())
