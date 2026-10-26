"""The execution port is gated before Flask lookup and bound per application."""

from contextvars import Context

import pytest
from flask import Flask, has_app_context

from core.ops.base_trace_instance import (
    ApplicationTracingHooksNotRegisteredError,
    application_tracing_hooks,
    bind_application_tracing_hooks,
)
from services.tracing.runtime_bridge import RuntimeApplicationTracingHooks
from tests.unit_tests.config_override import apply_config_overrides


def test_disabled_port_needs_no_application_context(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
    isolated_context = Context()
    assert not isolated_context.run(has_app_context)
    assert isolated_context.run(application_tracing_hooks) is None


def test_enabled_port_reports_missing_registration_without_context(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    isolated_context = Context()
    assert not isolated_context.run(has_app_context)
    with pytest.raises(ApplicationTracingHooksNotRegisteredError, match="application_tracing_hooks_not_registered"):
        isolated_context.run(application_tracing_hooks)


def test_enabled_port_reports_missing_registration_in_app(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    with Flask(__name__).app_context():
        with pytest.raises(ApplicationTracingHooksNotRegisteredError, match="application_tracing_hooks_not_registered"):
            application_tracing_hooks()


def test_port_does_not_leak_between_flask_applications(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    first, second = Flask("first"), Flask("second")
    first_hooks = RuntimeApplicationTracingHooks()
    second_hooks = RuntimeApplicationTracingHooks()
    bind_application_tracing_hooks(first, first_hooks)
    bind_application_tracing_hooks(second, second_hooks)
    with first.app_context():
        assert application_tracing_hooks() is first_hooks
        with second.app_context():
            assert application_tracing_hooks() is second_hooks
        assert application_tracing_hooks() is first_hooks
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
        assert application_tracing_hooks() is None
