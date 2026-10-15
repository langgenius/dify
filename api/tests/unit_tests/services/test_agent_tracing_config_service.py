"""Agent tracing resolves the complete owner chain before existing App operations."""

from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from services.agent_tracing_config_service import AgentTracingConfigService
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.entities.app_entities import AppTraceSettings

CONTEXT = RequestContext("request", None, "account", "tenant")


@pytest.mark.parametrize("method", ["get_trace", "set_trace", "get", "create", "update", "delete"])
def test_agent_operations_resolve_tenant_scoped_roster_app(method: str) -> None:
    owners, settings, configs = MagicMock(), MagicMock(), MagicMock()
    owners.resolve_roster_app_id.return_value = "backing-app"
    service = AgentTracingConfigService(owners=owners, settings=settings, configs=configs)
    args: tuple = ()
    if method == "set_trace":
        args = (AppTraceSettings(True, "langfuse", capture_content=True, capture_agent=False),)
    elif method in {"get", "delete"}:
        args = ("langfuse",)
    elif method in {"create", "update"}:
        args = ("langfuse", {"secret_key": "masked"})
    getattr(service, method)(CONTEXT, "agent", *args)
    owners.resolve_roster_app_id.assert_called_once_with(tenant_id="tenant", agent_id="agent")
    target = settings if method.endswith("trace") else configs
    getattr(target, method).assert_called_once_with(CONTEXT, "backing-app", *args)


@pytest.mark.parametrize("method", ["get_trace", "set_trace", "get", "create", "update", "delete"])
def test_invalid_or_foreign_agent_never_reaches_app_services(method: str) -> None:
    owners, settings, configs = MagicMock(), MagicMock(), MagicMock()
    owners.resolve_roster_app_id.side_effect = AgentAppNotFoundError
    service = AgentTracingConfigService(owners=owners, settings=settings, configs=configs)
    args: tuple = ()
    if method == "set_trace":
        args = (AppTraceSettings(),)
    elif method in {"get", "delete"}:
        args = ("langfuse",)
    elif method in {"create", "update"}:
        args = ("langfuse", {})
    with pytest.raises(AgentAppNotFoundError):
        getattr(service, method)(CONTEXT, "agent", *args)
    assert settings.mock_calls == configs.mock_calls == []
