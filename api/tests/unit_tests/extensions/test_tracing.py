from collections.abc import Mapping

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import TraceEvent
from flask import Flask

from extensions.tracing import (
    application_tracing_hooks,
    bind_tracing,
    create_trace_scope,
    create_trace_scope_for_app,
)
from services.tracing.emitter import correlation_from_extras
from services.tracing.runtime_bridge import RuntimeApplicationTracingHooks
from tests.unit_tests.config_override import apply_config_overrides


class _Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class _Scopes:
    def __init__(self, *, fails: bool) -> None:
        self.fails = fails
        self.policies: list[str | None] = []

    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str | None,
        app_tracing: str | None,
        user_id: str | None,
        extras: Mapping[str, object],
    ) -> TraceScope | None:
        self.policies.append(app_tracing)
        if self.fails:
            raise RuntimeError("policy lookup failed")
        return TraceScope(
            emitter=_Recorder(),
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            correlation=correlation_from_extras(extras),
        )

    def for_app(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, extras: Mapping[str, object]
    ) -> TraceScope | None:
        return self(tenant_id=tenant_id, app_id=app_id, app_tracing=None, user_id=user_id, extras=extras)


def _app(*, fails: bool) -> Flask:
    app = Flask(__name__)
    bind_tracing(app, scopes=_Scopes(fails=fails), hooks=RuntimeApplicationTracingHooks())
    return app


def test_scopes_come_from_the_bound_factory() -> None:
    with _app(fails=False).app_context():
        scope = create_trace_scope(tenant_id="tenant-1", app_id="app-1", app_tracing=None, user_id="u", extras={})
        app_scope = create_trace_scope_for_app(tenant_id="tenant-1", app_id=None, user_id=None, extras={})

    assert scope is not None
    assert (scope.tenant_id, scope.app_id, scope.user_id) == ("tenant-1", "app-1", "u")
    assert app_scope is not None
    assert app_scope.app_id is None


def test_scopes_fail_open() -> None:
    assert create_trace_scope(tenant_id="tenant-1", app_id="app-1", app_tracing=None, user_id=None, extras={}) is None
    with _app(fails=True).app_context():
        assert (
            create_trace_scope(tenant_id="tenant-1", app_id="app-1", app_tracing=None, user_id=None, extras={}) is None
        )
        assert create_trace_scope_for_app(tenant_id="tenant-1", app_id="app-1", user_id=None, extras={}) is None
    with Flask(__name__).app_context():
        assert create_trace_scope_for_app(tenant_id="tenant-1", app_id="app-1", user_id=None, extras={}) is None


def test_agent_hooks_follow_the_agent_tracing_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    app = _app(fails=False)

    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
    with app.app_context():
        assert application_tracing_hooks() is None

    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    with app.app_context():
        assert isinstance(application_tracing_hooks(), RuntimeApplicationTracingHooks)
    assert application_tracing_hooks() is None
