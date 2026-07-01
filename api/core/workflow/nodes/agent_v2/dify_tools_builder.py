from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolProviderType, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin import (
    DifyPluginCredentialValue,
    DifyPluginToolConfig,
    DifyPluginToolCredentialType,
    DifyPluginToolParameter,
    DifyPluginToolParameterForm,
    DifyPluginToolsLayerConfig,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.entities import AgentToolEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.tool_manager import ToolManager
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from extensions.ext_database import db
from models.agent_config_entities import AgentSoulDifyToolConfig, AgentSoulToolsConfig
from models.provider_ids import ToolProviderID
from models.tools import WorkflowToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService


class WorkflowAgentDifyToolsBuildError(ValueError):
    """Raised when Agent Soul tools cannot be prepared for Agent backend."""

    def __init__(self, error_code: str, message: str) -> None:
        self.error_code = error_code
        super().__init__(message)


class AgentToolRuntimeProvider(Protocol):
    def get_agent_tool_runtime(
        self,
        tenant_id: str,
        app_id: str,
        agent_tool: AgentToolEntity,
        user_id: str | None = None,
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        variable_pool: Any | None = None,
        allow_file_parameters: bool = False,
        use_default_for_missing_form_parameters: bool = False,
    ) -> Tool: ...


class ProviderToolsLister(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        provider_type: ToolProviderType,
        provider_id: str,
    ) -> list[str]: ...


class MCPProviderIDResolver(Protocol):
    def __call__(self, *, tenant_id: str, provider_id: str) -> str: ...


@dataclass(frozen=True, slots=True)
class WorkflowAgentToolLayers:
    plugin_tools: DifyPluginToolsLayerConfig | None = None
    core_tools: DifyCoreToolsLayerConfig | None = None

    def exposed_tool_names(self) -> list[str]:
        names: list[str] = []
        if self.plugin_tools is not None:
            names.extend(tool.name or tool.tool_name for tool in self.plugin_tools.tools)
        if self.core_tools is not None:
            names.extend(tool.name or tool.tool_name for tool in self.core_tools.tools)
        return names


class WorkflowAgentDifyToolLayersBuilder(Protocol):
    def build_layers(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str | None,
        tools: AgentSoulToolsConfig,
        invoke_from: InvokeFrom,
    ) -> WorkflowAgentToolLayers: ...


def _list_provider_tool_names(
    *,
    tenant_id: str,
    provider_type: ToolProviderType,
    provider_id: str,
) -> list[str]:
    """Tool names a provider currently declares for provider-level Agent entries."""
    match provider_type:
        case ToolProviderType.PLUGIN:
            plugin_provider = ToolManager.get_plugin_provider(provider_id, tenant_id)
            return [tool.entity.identity.name for tool in plugin_provider.get_tools() or []]
        case ToolProviderType.BUILT_IN:
            builtin_provider = ToolManager.get_builtin_provider(provider_id, tenant_id)
            return [tool.entity.identity.name for tool in builtin_provider.get_tools() or []]
        case ToolProviderType.API:
            api_provider, _ = ToolManager.get_api_provider_controller(tenant_id, provider_id)
            return [tool.entity.identity.name for tool in api_provider.get_tools(tenant_id) or []]
        case ToolProviderType.WORKFLOW:
            db_provider = db.session.scalar(
                select(WorkflowToolProvider)
                .where(
                    WorkflowToolProvider.id == provider_id,
                    WorkflowToolProvider.tenant_id == tenant_id,
                )
                .limit(1)
            )
            if db_provider is None:
                raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")
            workflow_provider = WorkflowToolProviderController.from_db(db_provider)
            return [tool.entity.identity.name for tool in workflow_provider.get_tools(tenant_id) or []]
        case ToolProviderType.MCP:
            mcp_provider = ToolManager.get_mcp_provider_controller(tenant_id, provider_id)
            return [tool.entity.identity.name for tool in mcp_provider.get_tools() or []]
        case _:
            raise ToolProviderNotFoundError(f"provider type {provider_type.value} not found")


def _resolve_mcp_provider_id(*, tenant_id: str, provider_id: str) -> str:
    """Normalize MCP provider ids to the runtime-facing server identifier."""
    service = MCPToolManageService(session=cast(Session, db.session))
    try:
        return service.get_provider_entity(provider_id, tenant_id, by_server_id=True).provider_id
    except ValueError:
        try:
            return service.get_provider_entity(provider_id, tenant_id, by_server_id=False).provider_id
        except ValueError as exc:
            raise ToolProviderNotFoundError(f"mcp provider {provider_id} not found") from exc


class WorkflowAgentDifyToolsBuilder:
    """Prepare Agent Soul Dify tools for Agent backend run-layer configs.

    Plugin tools keep their existing direct daemon path. Core-routed tools
    (`builtin`/`api`/`workflow`/`mcp`) are emitted as `dify.core.tools`.
    """

    def __init__(
        self,
        *,
        tool_runtime_provider: AgentToolRuntimeProvider | None = None,
        provider_tools_lister: ProviderToolsLister | None = None,
        mcp_provider_id_resolver: MCPProviderIDResolver | None = None,
    ) -> None:
        self._tool_runtime_provider = tool_runtime_provider or ToolManager
        self._provider_tools_lister = provider_tools_lister or _list_provider_tool_names
        self._mcp_provider_id_resolver = mcp_provider_id_resolver or _resolve_mcp_provider_id

    def build_layers(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str | None,
        tools: AgentSoulToolsConfig,
        invoke_from: InvokeFrom,
    ) -> WorkflowAgentToolLayers:
        """Resolve user-selected Dify tools into direct/core Agent backend DTOs.

        `invoke_from` is the real runtime caller category (DEBUGGER for a
        Composer test run, SERVICE_API / WEB_APP for a published run). It must
        be threaded through to `ToolManager` so credential quotas, rate limits,
        and audit tags match the actual call site.
        """
        enabled_tools = [tool for tool in tools.dify_tools if tool.enabled]
        if not enabled_tools:
            return WorkflowAgentToolLayers()

        prepared_plugin: list[DifyPluginToolConfig] = []
        prepared_core: list[DifyCoreToolConfig] = []
        seen_names: set[str] = set()

        for tool_config in self._expand_provider_entries(tenant_id=tenant_id, enabled_tools=enabled_tools):
            normalized_tool_config = self._normalized_tool_config(tenant_id=tenant_id, tool_config=tool_config)
            destination = self._tool_layer_destination(normalized_tool_config)
            exposed_name = self._exposed_tool_name(normalized_tool_config)
            if exposed_name in seen_names:
                raise WorkflowAgentDifyToolsBuildError(
                    "agent_tool_name_duplicated",
                    f"Duplicate Dify Tool name {exposed_name!r}.",
                )
            seen_names.add(exposed_name)

            agent_tool = self._to_agent_tool_entity(normalized_tool_config)
            tool_runtime = self._fetch_tool_runtime(
                tenant_id=tenant_id,
                app_id=app_id,
                user_id=user_id,
                agent_tool=agent_tool,
                invoke_from=invoke_from,
                tool_config=normalized_tool_config,
            )

            if destination == "plugin":
                prepared_plugin.append(
                    self._to_plugin_backend_tool_config(normalized_tool_config, tool_runtime, exposed_name)
                )
            else:
                prepared_core.append(
                    self._to_core_backend_tool_config(normalized_tool_config, tool_runtime, exposed_name)
                )

        return WorkflowAgentToolLayers(
            plugin_tools=DifyPluginToolsLayerConfig(tools=prepared_plugin) if prepared_plugin else None,
            core_tools=DifyCoreToolsLayerConfig(tools=prepared_core) if prepared_core else None,
        )

    def _expand_provider_entries(
        self,
        *,
        tenant_id: str,
        enabled_tools: list[AgentSoulDifyToolConfig],
    ) -> list[AgentSoulDifyToolConfig]:
        """Expand provider-level entries (`tool_name` omitted = all tools)."""
        explicit_by_provider: dict[tuple[ToolProviderType, str], set[str]] = {}
        for tool_config in enabled_tools:
            if tool_config.tool_name is not None:
                explicit_by_provider.setdefault(self._provider_key(tool_config), set()).add(tool_config.tool_name)

        expanded: list[AgentSoulDifyToolConfig] = []
        for tool_config in enabled_tools:
            if tool_config.tool_name is not None:
                expanded.append(tool_config)
                continue
            provider_type = ToolProviderType.value_of(tool_config.provider_type)
            provider_id = self._provider_id(tool_config)
            try:
                tool_names = self._provider_declared_tool_names(
                    tenant_id=tenant_id,
                    provider_type=provider_type,
                    provider_id=provider_id,
                )
            except ToolProviderNotFoundError as exc:
                raise WorkflowAgentDifyToolsBuildError(
                    "agent_tool_declaration_not_found",
                    f"Dify Tool provider {provider_id!r} declaration not found: {exc}",
                ) from exc
            if not tool_names:
                raise WorkflowAgentDifyToolsBuildError(
                    "agent_tool_declaration_not_found",
                    f"Dify Tool provider {provider_id!r} declares no tools.",
                )
            already_explicit = explicit_by_provider.get(self._provider_key(tool_config), set())
            for tool_name in tool_names:
                if tool_name in already_explicit:
                    continue
                expanded.append(tool_config.model_copy(update={"tool_name": tool_name, "runtime_parameters": {}}))
        return expanded

    def _provider_declared_tool_names(
        self,
        *,
        tenant_id: str,
        provider_type: ToolProviderType,
        provider_id: str,
    ) -> list[str]:
        return self._provider_tools_lister(
            tenant_id=tenant_id,
            provider_type=provider_type,
            provider_id=provider_id,
        )

    def _normalized_tool_config(
        self,
        *,
        tenant_id: str,
        tool_config: AgentSoulDifyToolConfig,
    ) -> AgentSoulDifyToolConfig:
        if tool_config.provider_type != ToolProviderType.MCP.value:
            return tool_config
        provider_id = self._mcp_provider_id_resolver(tenant_id=tenant_id, provider_id=self._provider_id(tool_config))
        return tool_config.model_copy(update={"provider_id": provider_id, "plugin_id": None, "provider": None})

    def _fetch_tool_runtime(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str | None,
        agent_tool: AgentToolEntity,
        invoke_from: InvokeFrom,
        tool_config: AgentSoulDifyToolConfig,
    ) -> Tool:
        """Resolve the API-side `Tool` runtime and map fetch errors to stable codes."""
        try:
            return self._tool_runtime_provider.get_agent_tool_runtime(
                tenant_id=tenant_id,
                app_id=app_id,
                agent_tool=agent_tool,
                user_id=user_id,
                invoke_from=invoke_from,
                variable_pool=None,
                allow_file_parameters=True,
                use_default_for_missing_form_parameters=True,
            )
        except ToolProviderNotFoundError as exc:
            raise WorkflowAgentDifyToolsBuildError(
                "agent_tool_declaration_not_found",
                f"Dify Tool {tool_config.tool_name!r} declaration not found: {exc}",
            ) from exc
        except ToolProviderCredentialValidationError as exc:
            raise WorkflowAgentDifyToolsBuildError(
                "agent_tool_credential_invalid",
                f"Dify Tool {tool_config.tool_name!r} credential validation failed: {exc}",
            ) from exc
        except ValueError as exc:
            raise WorkflowAgentDifyToolsBuildError(
                "agent_tool_config_invalid",
                f"Dify Tool {tool_config.tool_name!r} runtime construction failed: {exc}",
            ) from exc

    @staticmethod
    def _to_agent_tool_entity(tool_config: AgentSoulDifyToolConfig) -> AgentToolEntity:
        assert tool_config.tool_name is not None
        return AgentToolEntity(
            provider_type=ToolProviderType.value_of(tool_config.provider_type),
            provider_id=WorkflowAgentDifyToolsBuilder._provider_id(tool_config),
            tool_name=tool_config.tool_name,
            tool_parameters=dict(tool_config.runtime_parameters),
            credential_id=tool_config.credential_ref.id if tool_config.credential_ref else None,
        )

    @staticmethod
    def _provider_id(tool_config: AgentSoulDifyToolConfig) -> str:
        if tool_config.provider_id:
            return tool_config.provider_id
        assert tool_config.plugin_id is not None
        assert tool_config.provider is not None
        return f"{tool_config.plugin_id}/{tool_config.provider}"

    @staticmethod
    def _provider_key(tool_config: AgentSoulDifyToolConfig) -> tuple[ToolProviderType, str]:
        return (
            ToolProviderType.value_of(tool_config.provider_type),
            WorkflowAgentDifyToolsBuilder._provider_id(tool_config),
        )

    @staticmethod
    def _tool_layer_destination(tool_config: AgentSoulDifyToolConfig) -> Literal["plugin", "core"]:
        provider_type = ToolProviderType.value_of(tool_config.provider_type)
        if provider_type is ToolProviderType.PLUGIN:
            return "plugin"
        if provider_type in {
            ToolProviderType.BUILT_IN,
            ToolProviderType.API,
            ToolProviderType.WORKFLOW,
            ToolProviderType.MCP,
        }:
            return "core"
        if provider_type is ToolProviderType.DATASET_RETRIEVAL:
            raise WorkflowAgentDifyToolsBuildError(
                "agent_tool_provider_not_supported",
                "dataset-retrieval remains on the knowledge path and is not supported in Agent tool layers.",
            )
        raise WorkflowAgentDifyToolsBuildError(
            "agent_tool_provider_not_supported",
            f"Dify Tool provider type {provider_type.value!r} is not supported in Agent tool layers.",
        )

    @staticmethod
    def _exposed_tool_name(tool_config: AgentSoulDifyToolConfig) -> str:
        assert tool_config.tool_name is not None
        return tool_config.tool_name

    def _to_plugin_backend_tool_config(
        self,
        tool_config: AgentSoulDifyToolConfig,
        tool_runtime: Tool,
        exposed_name: str,
    ) -> DifyPluginToolConfig:
        runtime = tool_runtime.runtime
        if runtime is None:
            raise WorkflowAgentDifyToolsBuildError(
                "agent_tool_config_invalid",
                f"Dify Tool {tool_config.tool_name!r} has no runtime.",
            )

        provider_id = self._provider_id(tool_config)
        plugin_id, provider = self._plugin_provider(tool_config, provider_id)
        parameters = self._prepared_parameters(tool_runtime)
        runtime_parameters = self._runtime_parameters(tool_runtime, parameters)
        description = self._description(tool_config, tool_runtime)

        return DifyPluginToolConfig(
            plugin_id=plugin_id,
            provider=provider,
            tool_name=exposed_name,
            credential_type=self._credential_type(tool_config, runtime.credentials),
            name=exposed_name,
            description=description,
            credentials=self._normalize_credentials(runtime.credentials, tool_name=exposed_name),
            runtime_parameters=runtime_parameters,
            parameters=parameters,
            parameters_json_schema=tool_runtime.get_llm_parameters_json_schema(),
        )

    def _to_core_backend_tool_config(
        self,
        tool_config: AgentSoulDifyToolConfig,
        tool_runtime: Tool,
        exposed_name: str,
    ) -> DifyCoreToolConfig:
        parameters = self._prepared_parameters(tool_runtime)
        return DifyCoreToolConfig(
            provider_type=cast(DifyCoreToolProviderType, tool_config.provider_type),
            provider_id=self._provider_id(tool_config),
            tool_name=tool_config.tool_name or exposed_name,
            credential_id=tool_config.credential_ref.id if tool_config.credential_ref else None,
            name=exposed_name,
            description=self._description(tool_config, tool_runtime),
            runtime_parameters=self._runtime_parameters(tool_runtime, parameters),
            parameters=parameters,
            parameters_json_schema=tool_runtime.get_llm_parameters_json_schema(),
        )

    @staticmethod
    def _plugin_provider(tool_config: AgentSoulDifyToolConfig, provider_id: str) -> tuple[str, str]:
        if tool_config.plugin_id and tool_config.provider:
            return tool_config.plugin_id, tool_config.provider
        provider_id_entity = ToolProviderID(provider_id)
        return provider_id_entity.plugin_id, provider_id_entity.provider_name

    @staticmethod
    def _credential_type(
        tool_config: AgentSoulDifyToolConfig,
        credentials: Mapping[str, Any],
    ) -> DifyPluginToolCredentialType:
        if not credentials and tool_config.credential_type == "unauthorized":
            return "unauthorized"
        return tool_config.credential_type

    @staticmethod
    def _prepared_parameters(tool_runtime: Tool) -> list[DifyPluginToolParameter]:
        return [
            DifyPluginToolParameter.model_validate(parameter.model_dump(mode="json"))
            for parameter in tool_runtime.get_merged_runtime_parameters()
        ]

    @staticmethod
    def _description(tool_config: AgentSoulDifyToolConfig, tool_runtime: Tool) -> str | None:
        description = tool_config.description
        if description is None and tool_runtime.entity.description is not None:
            description = tool_runtime.entity.description.llm
        return description

    @staticmethod
    def _runtime_parameters(
        tool_runtime: Tool,
        parameters: list[DifyPluginToolParameter],
    ) -> dict[str, Any]:
        runtime = tool_runtime.runtime
        runtime_parameters = dict(runtime.runtime_parameters if runtime is not None else {})
        missing = [
            parameter.name
            for parameter in parameters
            if parameter.form is not DifyPluginToolParameterForm.LLM
            and parameter.required
            and parameter.default is None
            and parameter.name not in runtime_parameters
        ]
        if missing:
            names = ", ".join(sorted(missing))
            raise WorkflowAgentDifyToolsBuildError(
                "agent_tool_runtime_parameter_missing",
                f"Dify Tool {tool_runtime.entity.identity.name!r} is missing runtime parameters: {names}.",
            )
        return runtime_parameters

    @staticmethod
    def _normalize_credentials(
        credentials: Mapping[str, Any],
        *,
        tool_name: str,
    ) -> dict[str, DifyPluginCredentialValue]:
        normalized: dict[str, DifyPluginCredentialValue] = {}
        for key, value in credentials.items():
            if isinstance(value, str | int | float | bool) or value is None:
                normalized[key] = value
                continue
            raise WorkflowAgentDifyToolsBuildError(
                "agent_tool_credential_shape_invalid",
                (
                    f"Dify Plugin Tool {tool_name!r} credential {key!r} has a non-scalar value "
                    f"({type(value).__name__}); only str/int/float/bool/None are forwarded to the daemon."
                ),
            )
        return normalized
