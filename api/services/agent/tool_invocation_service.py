"""Authorize and dispatch API-owned Agent tool invocations through explicit ports."""

from typing import Protocol

from services.entities.agent_tool_inner import AgentToolInvokeRequest, AgentToolInvokeResponse
from services.errors.agent_tool_inner import AgentToolInnerServiceError


class ToolAppOwnership(Protocol):
    def app_tenant_id(self, app_id: str) -> str | None: ...


class AgentToolInvocation(Protocol):
    def invoke(self, request: AgentToolInvokeRequest) -> AgentToolInvokeResponse: ...


class AgentToolInnerService:
    def __init__(self, *, apps: ToolAppOwnership, tools: AgentToolInvocation) -> None:
        self._apps = apps
        self._tools = tools

    def invoke(self, request: AgentToolInvokeRequest) -> AgentToolInvokeResponse:
        tenant_id = self._apps.app_tenant_id(request.caller.app_id)
        if tenant_id is None:
            raise AgentToolInnerServiceError(error_code="app_not_found", description="App not found.", status_code=404)
        if tenant_id != request.caller.tenant_id:
            raise AgentToolInnerServiceError(
                error_code="app_tenant_mismatch",
                description="App does not belong to the caller tenant.",
                status_code=403,
            )
        return self._tools.invoke(request)
