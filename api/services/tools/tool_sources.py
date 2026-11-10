from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Self

from sqlalchemy import select

from core.db.session_factory import session_factory
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import ToolProviderNotFoundError
from core.tools.mcp_tool.provider import MCPToolProviderController
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from libs.i18n_text import localized
from models.tools import WorkflowToolProvider
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.mcp_tools_manage_service import MCPToolManageService
from services.tools.tools_transform_service import ToolTransformService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

type ProviderLister = Callable[[str, str], list[ToolProviderApiEntity]]
type ToolController = (
    BuiltinToolProviderController
    | PluginToolProviderController
    | ApiToolProviderController
    | MCPToolProviderController
    | WorkflowToolProviderController
)
type ControllerLoader = Callable[[str, str], ToolController]

TOOL_NODE_VERSION: Final = "2"


def _list_builtin(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    return BuiltinToolManageService.list_builtin_tools(user_id, tenant_id)


def _list_workflow(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    return WorkflowToolManageService.list_tenant_workflow_tools(user_id, tenant_id)


def _list_api(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    return ApiToolManageService.list_api_tools(tenant_id)


def _list_mcp(tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
    with session_factory.create_session() as session:
        return MCPToolManageService(session=session).list_providers(tenant_id=tenant_id, include_sensitive=False)


def _load_builtin(tenant_id: str, provider_id: str) -> ToolController:
    return ToolManager.get_builtin_provider(provider_id, tenant_id)


def _load_workflow(tenant_id: str, provider_id: str) -> ToolController:
    with session_factory.create_session() as session:
        provider = session.scalar(
            select(WorkflowToolProvider).where(
                WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == provider_id
            )
        )
    if provider is None:
        raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")
    return ToolTransformService.workflow_provider_to_controller(provider)


def _load_api(tenant_id: str, provider_id: str) -> ToolController:
    controller, _credentials = ToolManager.get_api_provider_controller(tenant_id, provider_id)
    return controller


def _load_mcp(tenant_id: str, provider_id: str) -> ToolController:
    return ToolManager.get_mcp_provider_controller(tenant_id, provider_id)


class ToolSource(StrEnum):
    """Tool provider types a workflow tool node can call; values match the node's provider_type."""

    lister: ProviderLister
    controller: ControllerLoader

    def __new__(cls, value: str, lister: ProviderLister, controller: ControllerLoader) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.lister = lister
        member.controller = controller
        return member

    BUILTIN = (ToolProviderType.BUILT_IN.value, _list_builtin, _load_builtin)
    WORKFLOW = (ToolProviderType.WORKFLOW.value, _list_workflow, _load_workflow)
    API = (ToolProviderType.API.value, _list_api, _load_api)
    MCP = (ToolProviderType.MCP.value, _list_mcp, _load_mcp)

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


def resolve_tool(*, tenant_id: str, provider_type: str, provider_id: str, tool_name: str) -> ToolApiEntity | None:
    """One tool's declaration, read from its provider controller without building a runtime or touching credentials."""
    source = ToolSource.of_node(provider_type)
    if source is None:
        return None
    try:
        controller = source.controller(tenant_id, provider_id)
    except ToolProviderNotFoundError:
        return None
    try:
        tool = controller.get_tool(tool_name)
    except ValueError:
        return None
    if tool is None:
        return None
    return ToolTransformService.convert_tool_entity_to_api_entity(tool, tenant_id)


@dataclass(frozen=True)
class ToolNodeIdentity:
    """The values a tool node names its tool by, as the web writes them for a tool picked from the block menu."""

    title: str
    provider_type: str
    provider_id: str
    provider_name: str
    plugin_id: str | None
    plugin_unique_identifier: str | None
    tool_name: str
    tool_label: str

    @classmethod
    def of(cls, provider: ToolProviderApiEntity, tool: ToolApiEntity, language: str | None) -> Self:
        label = localized(tool.label, language) or tool.name
        return cls(
            title=label,
            provider_type=str(provider.type),
            provider_id=provider.server_identifier or provider.id,
            provider_name=provider.name,
            plugin_id=provider.plugin_id or None,
            plugin_unique_identifier=provider.plugin_unique_identifier or None,
            tool_name=tool.name,
            tool_label=label,
        )


def tool_names(provider: ToolProviderApiEntity, tool: ToolApiEntity, language: str | None) -> tuple[str | None, ...]:
    """What a tool is called besides its label: its name, and its provider's ids, name and label. A tool search
    finds the tool by any of these, its label or its description.
    """
    identity = ToolNodeIdentity.of(provider, tool, language)
    return tool.name, provider.id, identity.provider_id, provider.name, localized(provider.label, language)
