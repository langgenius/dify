"""Tracing policy round-trips without dropping content or Agent capture choices."""

import json

import pytest
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.model import App
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_service import AppTracingConfigAppNotFoundError
from services.entities.app_entities import AppTraceSettings


def test_capture_policy_round_trip_and_legacy_defaults(sqlite_session_factory: sessionmaker[Session]) -> None:
    context = RequestContext("request", None, "account", "tenant")
    with sqlite_session_factory.begin() as session:
        session.add(
            App(
                id="app",
                tenant_id="tenant",
                name="Trace app",
                mode="workflow",
                enable_site=False,
                enable_api=False,
                tracing=json.dumps({"enabled": True, "tracing_provider": "langfuse"}),
            )
        )
    repository = ConsoleAppRepository(session_factory=sqlite_session_factory)
    assert repository.get_trace(context, "app") == AppTraceSettings(True, "langfuse", False, True)
    writer = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    writer.create(
        workspace_id="tenant", app_id="app", tracing_provider="langfuse", tracing_config={"secret": "encrypted"}
    )
    expected = writer.get(workspace_id="tenant", app_id="app", tracing_provider="langfuse")
    policy = AppTraceSettings(True, "langfuse", True, False)
    writer.set_trace(workspace_id="tenant", app_id="app", settings=policy, expected=expected)
    assert repository.get_trace(context, "app") == policy
    with sqlite_session_factory() as session:
        app = session.get(App, "app")
        assert app is not None
        assert app.tracing is not None
        assert json.loads(app.tracing) == {
            "enabled": True,
            "tracing_provider": "langfuse",
            "capture_content": True,
            "capture_agent": False,
        }
    with pytest.raises(AppTracingConfigAppNotFoundError):
        writer.set_trace(workspace_id="other-tenant", app_id="app", settings=AppTraceSettings(), expected=None)
    assert repository.get_trace(context, "app") == policy
