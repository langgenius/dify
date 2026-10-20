"""Observe the native worker boundary, without granting execution authority.

Only instrumented synchronous generation can prove preparation failed before
worker dispatch. Missing instrumentation and interrupted processes stay unknown.
"""

import re
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Literal

FailureResource = tuple[Literal["model", "tool"], str, str]


@dataclass
class NativeLaunchObservation:
    preparing: bool = False
    dispatched: bool = False
    failure_resource: FailureResource | None = None
    _resource_error: Exception | None = field(default=None, repr=False)

    def resource_for(self, error: Exception) -> FailureResource | None:
        current: BaseException | None = error
        for _ in range(8):
            if current is None:
                break
            if current is self._resource_error:
                return self.failure_resource
            current = current.__cause__ or current.__context__
        return None

    @contextmanager
    def track(self) -> Generator[None]:
        token = _active.set(self)
        try:
            yield
        finally:
            _active.reset(token)

    @property
    def failed_before_dispatch(self) -> bool:
        return self.preparing and not self.dispatched


_active: ContextVar[NativeLaunchObservation | None] = ContextVar("builder_native_launch", default=None)


def begin_preparation() -> None:
    if (observation := _active.get()) is not None:
        observation.preparing = True


def mark_dispatched() -> None:
    # Mark before Thread.start: a start acknowledgement failure is conservative.
    if (observation := _active.get()) is not None:
        observation.dispatched = True


def _public_id(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,127}", value))


@contextmanager
def observe_resource(kind: Literal["model", "tool"], provider: str, name: str = "") -> Generator[None]:
    """Attribute only a failed metadata read, never successful earlier reads."""
    try:
        yield
    except Exception as exc:
        observation = _active.get()
        if observation is not None:
            from services.dify_builder import trace_diagnostics

            if trace_diagnostics.plugin_activation_unavailable(exc):
                # Worker context is copied before dispatch. Observe the typed
                # cause here, before native response handling converts it to
                # text; this grants no execution or retry authority.
                trace_diagnostics.report(
                    "native_preparation_failed" if observation.failed_before_dispatch else "native_outcome_unknown",
                    error=exc,
                    provider=provider,
                    model=name if kind == "model" else None,
                )
        if observation is not None and _public_id(provider) and (not name or _public_id(name)):
            observation.failure_resource = (kind, provider, name)
            observation._resource_error = exc
        raise


def resource_node_ids(graph: dict, resource: FailureResource | None) -> tuple[str, ...]:
    if resource is None:
        return ()
    kind, provider, name = resource
    result = []
    for node in graph.get("nodes", []):
        data = node.get("data") or {}
        if kind == "model":
            config = data.get("model") or {}
            matches = data.get("type") == "llm" and config.get("provider") == provider and config.get("name") == name
        else:
            matches = (
                data.get("type") == "tool"
                and data.get("provider_id") == provider
                and (not name or data.get("tool_name") == name)
            )
        node_id = node.get("id")
        if matches and isinstance(node_id, str) and _public_id(node_id):
            result.append(node_id)
    return tuple(sorted(set(result)))
