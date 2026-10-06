import json
from collections.abc import Callable

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
    RedisParentContextStore,
    destination_scope,
    parent_destination_from_config,
)


class InMemoryParentContextStore(RedisParentContextStore):
    def __init__(self, value: bytes | str | None = None) -> None:
        self.value = value
        self.get_calls: list[str] = []
        self.setex_calls: list[tuple[str, int, str]] = []
        self.read_error: Exception | None = None
        self.write_error: Exception | None = None

    def get(self, name: str) -> bytes | str | None:
        self.get_calls.append(name)
        if self.read_error is not None:
            raise self.read_error
        return self.value

    def setex(self, name: str, time: int, value: str) -> object:
        self.setex_calls.append((name, time, value))
        if self.write_error is not None:
            raise self.write_error
        self.value = value
        return True


def parent() -> ParentTraceContext:
    return ParentTraceContext(parent_workflow_run_id="outer-run", parent_node_execution_id="outer-tool")


def context(**overrides: object) -> ProviderParentContext:
    values: dict[str, object] = {
        "provider": "langsmith",
        "scope": "scope-a",
        "trace_id": "root-run",
        "parent_id": "outer-tool",
        "provider_context": {"dotted_order": "root.tool"},
    }
    values.update(overrides)
    return ProviderParentContext.model_validate(values)


def coordinator(redis: InMemoryParentContextStore, destination: ParentDestination | None) -> ParentContextCoordinator:
    return ParentContextCoordinator(redis, lambda _workflow_run_id: destination)


def test_parent_destination_uses_non_secret_provider_scope() -> None:
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


def test_publish_uses_unified_namespace_and_configured_ttl(config_overrides: Callable[..., None]) -> None:
    redis = InMemoryParentContextStore()
    value = context()
    config_overrides(OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS=1_800)

    coordinator(redis, None).publish("outer-tool", value)

    key, ttl, payload = redis.setex_calls[-1]
    assert key == "trace:unified:parent:outer-tool"
    assert ttl == 1_800
    assert json.loads(payload)["provider"] == "langsmith"


def test_resolve_returns_compatible_context() -> None:
    redis = InMemoryParentContextStore(context().model_dump_json().encode())
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    result = subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")

    assert result.kind is ParentResolutionKind.RESTORED
    assert result.context == context()
    assert result.linked_parent is None


def test_resolve_required_restores_message_context_without_destination_lookup() -> None:
    redis = InMemoryParentContextStore(context().model_dump_json().encode())
    destination_calls: list[str] = []

    def resolve_destination(workflow_run_id: str) -> ParentDestination | None:
        destination_calls.append(workflow_run_id)
        return None

    subject = ParentContextCoordinator(redis, resolve_destination)

    result = subject.resolve_required(
        "message-1",
        expected_provider="langsmith",
        expected_scope="scope-a",
    )

    assert result.kind is ParentResolutionKind.RESTORED
    assert result.context == context()
    assert redis.get_calls == ["trace:unified:parent:message-1"]
    assert destination_calls == []


def test_missing_required_message_context_is_retryable() -> None:
    redis = InMemoryParentContextStore()
    subject = coordinator(redis, None)

    with pytest.raises(PendingTraceParentContextError):
        subject.resolve_required(
            "message-1",
            expected_provider="langsmith",
            expected_scope="scope-a",
        )


def test_missing_compatible_context_is_retryable() -> None:
    redis = InMemoryParentContextStore()
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    with pytest.raises(PendingTraceParentContextError):
        subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")


def test_non_unified_or_incompatible_parent_becomes_linked_root() -> None:
    redis = InMemoryParentContextStore()
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

    assert redis.get_calls == []


def test_malformed_or_stale_context_is_terminal() -> None:
    redis = InMemoryParentContextStore()
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    for payload in (b"not-json", b'{"version": 2}', context(scope="scope-b").model_dump_json().encode()):
        redis.value = payload
        with pytest.raises(InvalidTraceParentContextError):
            subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")


def test_redis_read_and_write_failures_are_retryable() -> None:
    redis = InMemoryParentContextStore()
    redis.read_error = ConnectionError("down")
    redis.write_error = ConnectionError("down")
    subject = coordinator(redis, ParentDestination(provider="langsmith", scope="scope-a", unified=True))

    with pytest.raises(TraceParentContextAccessError):
        subject.resolve(parent(), expected_provider="langsmith", expected_scope="scope-a")
    with pytest.raises(TraceParentContextAccessError):
        subject.publish("outer-tool", context())
