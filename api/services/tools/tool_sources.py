from collections.abc import Callable
from enum import StrEnum
from typing import Self

from sqlalchemy import select

from core.db.session_factory import session_factory
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import ToolProviderNotFoundError
from core.tools.tool_manager import ToolManager
from models.tools import WorkflowToolProvider
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.mcp_tools_manage_service import MCPToolManageService
from services.tools.tools_transform_service import ToolTransformService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

type ProviderLister = Callable[[str, str], list[ToolProviderApiEntity]]


def _list_builtin(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    return BuiltinToolManageService.list_builtin_tools(user_id, tenant_id)


def _list_workflow(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    return WorkflowToolManageService.list_tenant_workflow_tools(user_id, tenant_id)


def _list_api(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    return ApiToolManageService.list_api_tools(tenant_id)


def _list_mcp(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    with session_factory.create_session() as session:
        return MCPToolManageService(session=session).list_providers(tenant_id=tenant_id, include_sensitive=False)


class ToolSource(StrEnum):
    """Tool provider types a workflow tool node can call; values match the node's provider_type."""

    lister: ProviderLister

    def __new__(cls, value: str, lister: ProviderLister) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.lister = lister
        return member

    BUILTIN = (ToolProviderType.BUILT_IN.value, _list_builtin)
    WORKFLOW = (ToolProviderType.WORKFLOW.value, _list_workflow)
    API = (ToolProviderType.API.value, _list_api)
    MCP = (ToolProviderType.MCP.value, _list_mcp)

    def list_providers(self, *, tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
        return self.lister(tenant_id, user_id)

    @classmethod
    def of_node(cls, provider_type: str) -> Self | None:
        """The source serving a tool node's provider_type; plugin tools are served as builtin."""
        if provider_type == ToolProviderType.PLUGIN:
            return cls.BUILTIN
        try:
            return cls(provider_type)
        except ValueError:
            return None


def _workflow_controller(tenant_id: str, provider_id: str):
    with session_factory.create_session() as session:
        provider = session.scalar(
            select(WorkflowToolProvider).where(
                WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == provider_id
            )
        )
    if provider is None:
        raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")
    controller = ToolTransformService.workflow_provider_to_controller(provider)
    controller.get_tools(tenant_id=tenant_id)
    return controller


def _controller(source: ToolSource, tenant_id: str, provider_id: str):
    match source:
        case ToolSource.BUILTIN:
            return ToolManager.get_builtin_provider(provider_id, tenant_id)
        case ToolSource.API:
            controller, _credentials = ToolManager.get_api_provider_controller(tenant_id, provider_id)
            return controller
        case ToolSource.MCP:
            return ToolManager.get_mcp_provider_controller(tenant_id, provider_id)
        case ToolSource.WORKFLOW:
            return _workflow_controller(tenant_id, provider_id)


def resolve_tool(*, tenant_id: str, provider_type: str, provider_id: str, tool_name: str) -> ToolApiEntity | None:
    """One tool's declaration, read from its provider controller without building a runtime or touching credentials."""
    source = ToolSource.of_node(provider_type)
    if source is None:
        return None
    try:
        tool = _controller(source, tenant_id, provider_id).get_tool(tool_name)
    except (ToolProviderNotFoundError, ValueError):
        return None
    if tool is None:
        return None
    return ToolTransformService.convert_tool_entity_to_api_entity(tool, tenant_id)
