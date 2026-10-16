"""Bounded native diagnostic context through Dify and public Graphon ports.

No logger is installed or reconfigured here. Real application handlers must
already protect these factual native emitters. Captured Dify contexts restore
Flask but do not reset ContextVar writes; this adapter owns the missing tokens
and uses a fresh enter manager for nested/parallel/reused-thread isolation.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import AbstractContextManager, contextmanager
from contextvars import Context, ContextVar, Token
from threading import local
from typing import TYPE_CHECKING, Any, cast

from context import capture_current_context
from context.execution_context import ExecutionContext
from context.flask_app_context import FlaskExecutionContext, capture_flask_context
from flask import Flask, has_app_context
from libs.flask_utils import preserve_flask_contexts
from libs.sensitive_http_telemetry import sensitive_http_telemetry

from graphon.runtime import GraphRuntimeState
from services.dify_builder.native_testing.control import NativeApprovalWait, NativePolicyStop
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard

if TYPE_CHECKING:
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

NATIVE_LOG_EMITTERS = (
    "core.app.apps.workflow",
    "core.app.apps.base_app_queue_manager",
    "core.app.apps.workflow_app_runner",
    "core.app.apps.common.workflow_response_converter",
    "core.app.workflow.layers.persistence",
    "core.workflow",
    "graphon",
    "services.dify_builder.native_testing",
)
_native_observation: ContextVar[NativeObservationGuard | None] = ContextVar("dify_native_observation", default=None)


def current_native_observation() -> NativeObservationGuard | None:
    """Context-local association only; host/state establish trusted ownership."""
    return _native_observation.get()


@contextmanager
def native_observation_scope(*, guard: NativeObservationGuard) -> Generator[None]:
    if type(guard) is not NativeObservationGuard:
        raise NativeObservationError() from None
    guard.require_healthy()
    try:
        with sensitive_http_telemetry(additional_emitters=NATIVE_LOG_EMITTERS):
            token = _native_observation.set(guard)
            try:
                yield
            finally:
                _native_observation.reset(token)
    except (NativeApprovalWait, NativePolicyStop):
        raise  # Existing marked native boundary owns typed control semantics.
    except BaseException:
        guard.fail()


@contextmanager
def native_flask_worker_scope(*, host: NativeHostLaunch, flask_app: Flask, context_vars: Context) -> Generator[None]:
    """Retain Dify's actual user/Flask adapter while bounding all captured writes."""
    tokens: list[tuple[ContextVar[Any], Token[Any]]] = []
    try:
        for variable, value in context_vars.items():
            tokens.append((variable, variable.set(value)))
        with preserve_flask_contexts(flask_app, context_vars=context_vars), host.observation_scope():
            yield
    finally:
        for variable, token in reversed(tokens):
            variable.reset(token)


class NativeExecutionContext:
    """Reentrant public execution context; every entry restores prior tokens."""

    def __init__(self, *, guard: NativeObservationGuard) -> None:
        captured = capture_flask_context() if has_app_context() else capture_current_context()
        if type(guard) is not NativeObservationGuard or type(captured) not in (ExecutionContext, FlaskExecutionContext):
            raise NativeObservationError() from None
        self._captured = cast(ExecutionContext | FlaskExecutionContext, captured)
        self._guard = guard
        self._local = local()

    @contextmanager
    def enter(self) -> Generator[None]:
        tokens: list[tuple[ContextVar[Any], Token[Any]]] = []
        try:
            if self._captured.context_vars is not None:
                for variable, value in self._captured.context_vars.items():
                    tokens.append((variable, variable.set(value)))
            # .enter() allocates a fresh manager; existing __enter__ stores only
            # one local manager and is therefore not safe for nested reuse.
            with self._captured.enter(), native_observation_scope(guard=self._guard):
                yield
        finally:
            for variable, token in reversed(tokens):
                variable.reset(token)

    def __enter__(self) -> NativeExecutionContext:
        manager = self.enter()
        manager.__enter__()
        stack = getattr(self._local, "stack", None)
        if stack is None:
            stack = self._local.stack = []
        stack.append(manager)
        return self

    def __exit__(self, *args: Any) -> None:
        manager: AbstractContextManager[None] = self._local.stack.pop()
        manager.__exit__(*args)


class NativeGraphRuntimeState(GraphRuntimeState):
    """Use public constructor injection, including inherited snapshot restore.

    This establishes no resume provenance; all existing marked resume guards
    stay closed. Upstream restoration calls cls(...) without process context,
    so our constructor obtains the current explicitly entered native guard.
    """

    def __init__(self, **kwargs: Any) -> None:
        guard = current_native_observation()
        if guard is None or "execution_context" in kwargs:
            raise NativeObservationError() from None
        super().__init__(execution_context=NativeExecutionContext(guard=guard), **kwargs)
