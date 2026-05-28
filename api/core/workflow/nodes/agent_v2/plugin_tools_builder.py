from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, cast

from dify_agent.layers.dify_plugin import (
    DifyPluginCredentialValue,
    DifyPluginToolConfig,
    DifyPluginToolCredentialType,
    DifyPluginToolParameter,
    DifyPluginToolParameterForm,
    DifyPluginToolsLayerConfig,
)

from core.agent.entities import AgentToolEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import (
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from core.tools.tool_manager import ToolManager
from models.agent_config_entities import AgentSoulDifyToolConfig, AgentSoulToolsConfig
from models.provider_ids import ToolProviderID


class WorkflowAgentPluginToolsBuildError(ValueError):
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
    ) -> Tool: ...


class WorkflowAgentPluginToolsBuilder:
    """Prepare Agent Soul Dify Plugin Tools for the public Agent backend DTO."""

    def __init__(self, *, tool_runtime_provider: AgentToolRuntimeProvider | None = None) -> None:
        self._tool_runtime_provider = tool_runtime_provider or ToolManager

    def build(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str | None,
        tools: AgentSoulToolsConfig,
        invoke_from: InvokeFrom,
    ) -> DifyPluginToolsLayerConfig | None:
        """Resolve user-selected Dify Plugin Tools into the Agent backend DTO.

        ``invoke_from`` is the *real* runtime caller category (DEBUGGER for a
        Composer test run, SERVICE_API / WEB_APP for a published run). It must
        be threaded through to :class:`ToolManager` so credential quotas, rate
        limits, and audit tags match the actual call site.
        """
        enabled_tools = [tool for tool in tools.dify_tools if tool.enabled]
        if not enabled_tools:
            return None

        prepared: list[DifyPluginToolConfig] = []
        seen_names: set[str] = set()
        for tool_config in enabled_tools:
            agent_tool = self._to_agent_tool_entity(tool_config)
            tool_runtime = self._fetch_tool_runtime(
                tenant_id=tenant_id,
                app_id=app_id,
                user_id=user_id,
                agent_tool=agent_tool,
                invoke_from=invoke_from,
                tool_config=tool_config,
            )

            exposed_name = self._exposed_tool_name(tool_config)
            if exposed_name in seen_names:
                raise WorkflowAgentPluginToolsBuildError(
                    "agent_tool_name_duplicated",
                    f"Duplicate Dify Plugin Tool name {exposed_name!r}.",
                )
            seen_names.add(exposed_name)

            prepared.append(self._to_backend_tool_config(tool_config, tool_runtime, exposed_name))

        return DifyPluginToolsLayerConfig(tools=prepared)

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
        """Resolve the API-side ``Tool`` runtime, mapping fetch errors to
        Inspector-friendly error codes so callers can render distinct UX for
        "tool definition gone" vs "credential failed".
        """
        try:
            return self._tool_runtime_provider.get_agent_tool_runtime(
                tenant_id=tenant_id,
                app_id=app_id,
                agent_tool=agent_tool,
                user_id=user_id,
                invoke_from=invoke_from,
                variable_pool=None,
            )
        except ToolProviderNotFoundError as exc:
            raise WorkflowAgentPluginToolsBuildError(
                "agent_tool_declaration_not_found",
                f"Dify Plugin Tool {tool_config.tool_name!r} declaration not found: {exc}",
            ) from exc
        except ToolProviderCredentialValidationError as exc:
            raise WorkflowAgentPluginToolsBuildError(
                "agent_tool_credential_invalid",
                f"Dify Plugin Tool {tool_config.tool_name!r} credential validation failed: {exc}",
            ) from exc
        except ValueError as exc:
            # ToolManager raises bare ValueError when the agent tool's
            # ``runtime`` / runtime parameters are missing. Surface it under a
            # narrower error code than a generic "declaration not found" so
            # frontend can render an actionable hint.
            raise WorkflowAgentPluginToolsBuildError(
                "agent_tool_config_invalid",
                f"Dify Plugin Tool {tool_config.tool_name!r} runtime construction failed: {exc}",
            ) from exc

    @staticmethod
    def _to_agent_tool_entity(tool_config: AgentSoulDifyToolConfig) -> AgentToolEntity:
        return AgentToolEntity(
            provider_type=ToolProviderType.value_of(tool_config.provider_type),
            provider_id=WorkflowAgentPluginToolsBuilder._provider_id(tool_config),
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
    def _exposed_tool_name(tool_config: AgentSoulDifyToolConfig) -> str:
        # Stage 3.1 decision: no user rename yet. Keep the model-visible tool
        # name aligned with the plugin declaration identity.
        return tool_config.tool_name

    def _to_backend_tool_config(
        self,
        tool_config: AgentSoulDifyToolConfig,
        tool_runtime: Tool,
        exposed_name: str,
    ) -> DifyPluginToolConfig:
        runtime = tool_runtime.runtime
        if runtime is None:
            raise WorkflowAgentPluginToolsBuildError(
                "agent_tool_config_invalid",
                f"Dify Plugin Tool {tool_config.tool_name!r} has no runtime.",
            )

        provider_id = self._provider_id(tool_config)
        plugin_id, provider = self._plugin_provider(tool_config, provider_id)
        parameters = [
            DifyPluginToolParameter.model_validate(parameter.model_dump(mode="json"))
            for parameter in tool_runtime.get_merged_runtime_parameters()
        ]
        runtime_parameters = self._runtime_parameters(tool_runtime, parameters)
        description = tool_config.description
        if description is None and tool_runtime.entity.description is not None:
            description = tool_runtime.entity.description.llm

        return DifyPluginToolConfig(
            plugin_id=plugin_id,
            provider=provider,
            tool_name=tool_config.tool_name,
            credential_type=self._credential_type(tool_config, runtime.credentials),
            name=exposed_name,
            description=description,
            credentials=self._normalize_credentials(runtime.credentials, tool_name=tool_config.tool_name),
            runtime_parameters=runtime_parameters,
            parameters=parameters,
            parameters_json_schema=cast(dict[str, Any], tool_runtime.get_llm_parameters_json_schema()),
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
            raise WorkflowAgentPluginToolsBuildError(
                "agent_tool_runtime_parameter_missing",
                f"Dify Plugin Tool {tool_runtime.entity.identity.name!r} is missing runtime parameters: {names}.",
            )
        return runtime_parameters

    @staticmethod
    def _normalize_credentials(
        credentials: Mapping[str, Any],
        *,
        tool_name: str,
    ) -> dict[str, DifyPluginCredentialValue]:
        """Forward only scalar credential values to the Agent backend.

        ``DifyPluginCredentialValue`` is ``str | int | float | bool | None``.
        Refusing non-scalar values (lists, dicts, custom objects) is safer than
        ``str(value)`` — stringifying a nested OAuth token blob produces a
        Python ``repr`` that the plugin daemon cannot use, and we'd rather
        surface a clear ``agent_tool_credential_shape_invalid`` than send junk.
        """
        normalized: dict[str, DifyPluginCredentialValue] = {}
        for key, value in credentials.items():
            if isinstance(value, str | int | float | bool) or value is None:
                normalized[key] = value
                continue
            raise WorkflowAgentPluginToolsBuildError(
                "agent_tool_credential_shape_invalid",
                (
                    f"Dify Plugin Tool {tool_name!r} credential {key!r} has a non-scalar value "
                    f"({type(value).__name__}); only str/int/float/bool/None are forwarded to the daemon."
                ),
            )
        return normalized
