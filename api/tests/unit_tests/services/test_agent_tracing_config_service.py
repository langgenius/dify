"""Agent tracing resolves the complete owner chain before existing App operations."""

from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.app import AppServices
from machinery.context import RequestContext
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.agent_tracing_config_service import AgentTracingConfigService
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigService
from services.entities.app_entities import AppTraceSettings

type TraceConfigArguments = tuple[()] | tuple[AppTraceSettings] | tuple[str] | tuple[str, dict[str, str]]
type RecordedCall = tuple[str, tuple[object, ...]]

CONTEXT = RequestContext("request", None, "account", "tenant")


def invoke(service: AgentTracingConfigService, method: str) -> TraceConfigArguments:
    settings = AppTraceSettings(True, "langfuse", capture_content=True, capture_agent=False)
    config = {"secret_key": "masked"}
    if method == "get_trace":
        service.get_trace(CONTEXT, "agent")
        return ()
    if method == "set_trace":
        service.set_trace(CONTEXT, "agent", settings)
        return (settings,)
    if method == "get":
        service.get(CONTEXT, "agent", "langfuse")
        return ("langfuse",)
    if method == "delete":
        service.delete(CONTEXT, "agent", "langfuse")
        return ("langfuse",)
    if method == "create":
        service.create(CONTEXT, "agent", "langfuse", config)
    else:
        assert method == "update"
        service.update(CONTEXT, "agent", "langfuse", config)
    return ("langfuse", config)


@pytest.mark.parametrize("method", ["get_trace", "set_trace", "get", "create", "update", "delete"])
@pytest.mark.parametrize("valid_owner", [True, False])
def test_agent_operations_resolve_tenant_owner_before_app_services(
    method: str,
    valid_owner: bool,
    sqlite_session_factory: sessionmaker[Session],
    app_services: AppServices,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owners = AgentAppRepository(session_factory=sqlite_session_factory)
    settings = app_services.console
    configs = AppTracingConfigService(
        configs=SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory),
        provider=OpsTraceManagerGateway(),
    )
    calls: list[RecordedCall] = []

    def resolve(*, tenant_id: str, agent_id: str) -> str:
        calls.append(("resolve", (tenant_id, agent_id)))
        if not valid_owner:
            raise AgentAppNotFoundError
        return "backing-app"

    def recorder(name: str) -> Callable[..., None]:
        def record(*args: object) -> None:
            calls.append((name, args))

        return record

    monkeypatch.setattr(owners, "resolve_roster_app_id", resolve)
    for name in ("get_trace", "set_trace"):
        monkeypatch.setattr(settings, name, recorder(name))
    for name in ("get", "create", "update", "delete"):
        monkeypatch.setattr(configs, name, recorder(name))
    service = AgentTracingConfigService(owners=owners, settings=settings, configs=configs)
    if not valid_owner:
        with pytest.raises(AgentAppNotFoundError):
            invoke(service, method)
        assert calls == [("resolve", ("tenant", "agent"))]
        return
    args = invoke(service, method)
    assert calls == [("resolve", ("tenant", "agent")), (method, (CONTEXT, "backing-app", *args))]
