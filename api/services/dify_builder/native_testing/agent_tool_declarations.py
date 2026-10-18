"""Inert Agent tool declarations, separate from credential/runtime construction.

Only declared schemas and opaque runtime references cross this boundary. Dynamic
runtime schemas are not fetched here: those are capability operations themselves.
"""

from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal

from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin import DifyPluginToolConfig, DifyPluginToolParameter, DifyPluginToolsLayerConfig
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.tools.entities.tool_entities import ToolEntity, ToolProviderType
from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from models.agent_config_entities import AgentSoulToolsConfig
from models.tools import WorkflowToolProvider
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest


@dataclass(frozen=True)
class AgentToolMetadata:
    entity: ToolEntity
    implementation_revision: str
    requires_credentials: bool


@dataclass(frozen=True)
class AgentToolRuntimeReference:
    tool_ref: str
    provider_id: str
    tool_name: str
    credential_id: str | None
    implementation_revision: str
    readiness: Literal["ready", "needs_setup", "unresolved"]


@dataclass(frozen=True)
class PreparedAgentToolDeclarations:
    plugin_tools: DifyPluginToolsLayerConfig | None
    core_tools: DifyCoreToolsLayerConfig | None
    references: tuple[AgentToolRuntimeReference, ...]


def _metadata(*, tenant_id: str, provider_type: ToolProviderType, provider_id: str, tool_name: str | None):
    if provider_type in {ToolProviderType.PLUGIN, ToolProviderType.BUILT_IN}:
        controller = (
            ToolManager.get_plugin_provider(provider_id, tenant_id)
            if provider_type == ToolProviderType.PLUGIN
            else ToolManager.get_builtin_provider(provider_id, tenant_id)
        )
        declared = controller.get_tools() or []
        revision = getattr(controller, "plugin_unique_identifier", None)
        needs_credentials = controller.need_credentials
    elif provider_type == ToolProviderType.API:
        controller, _encrypted = ToolManager.get_api_provider_controller(tenant_id, provider_id)
        declared = controller.get_tools(tenant_id) or []
        revision = None
        needs_credentials = True  # Readiness is unresolved, never infer an account from schema.
    elif provider_type == ToolProviderType.WORKFLOW:
        from core.tools.workflow_as_tool.provider import WorkflowToolProviderController

        row = db.session.scalar(
            select(WorkflowToolProvider).where(
                WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == provider_id
            )
        )
        if row is None:
            raise BuilderExecutionPolicyError("agent_tool_declaration_not_found")
        declared = WorkflowToolProviderController.from_db(row).get_tools(tenant_id) or []
        revision = None
        needs_credentials = False
    elif provider_type == ToolProviderType.MCP:
        from core.mcp.types import Tool as RemoteMCPTool
        from services.tools.mcp_tools_manage_service import MCPToolManageService
        from services.tools.tools_transform_service import ToolTransformService

        # Read stored declarations directly. MCPToolProvider.to_entity() resolves
        # encrypted URL/headers, so it is intentionally not a metadata boundary.
        with Session(db.engine) as session:
            row = MCPToolManageService(session=session).get_provider_by_persisted_reference(
                id_or_server_identifier=provider_id, tenant_id=tenant_id
            )
            stored_tools = row.tool_dict
            revision = canonical_digest({"id": row.id, "updated_at": row.updated_at.isoformat(), "tools": stored_tools})
        results = []
        for raw in stored_tools:
            remote = RemoteMCPTool.model_validate(raw)
            if tool_name is not None and remote.name != tool_name:
                continue
            description = remote.description or ""
            entity = ToolEntity.model_validate(
                {
                    "identity": {
                        "author": "",
                        "name": remote.name,
                        "label": {"en_US": remote.title or remote.name},
                        "provider": provider_id,
                    },
                    "description": {"human": {"en_US": description}, "llm": description},
                    "parameters": ToolTransformService.convert_mcp_schema_to_parameter(remote.inputSchema),
                    "output_schema": remote.outputSchema or {},
                }
            )
            results.append(AgentToolMetadata(entity, revision, True))
        if not results:
            raise BuilderExecutionPolicyError("agent_tool_declaration_not_found")
        return results
    else:
        raise BuilderExecutionPolicyError("agent_tool_metadata_unavailable")
    results = []
    for tool in declared:
        if tool_name is not None and tool.entity.identity.name != tool_name:
            continue
        entity = ToolEntity.model_validate(tool.entity.model_dump(mode="json"))
        results.append(
            AgentToolMetadata(entity, revision or canonical_digest(entity.model_dump(mode="json")), needs_credentials)
        )
    if not results:
        raise BuilderExecutionPolicyError("agent_tool_declaration_not_found")
    return results


def _schema(parameters: list[DifyPluginToolParameter]) -> dict[str, JsonValue]:
    properties: dict[str, JsonValue] = {}
    required: list[JsonValue] = []
    for parameter in parameters:
        if parameter.form.value != "llm":
            continue
        kind = parameter.type.value
        item: dict[str, JsonValue]
        if kind in {"file", "files", "system-files"}:
            from core.workflow.nodes.agent_v2.dify_tools_builder import _plugin_file_input_schema

            item = _plugin_file_input_schema(parameter.llm_description or "")
            properties[parameter.name] = item if kind == "file" else {"type": "array", "items": item}
        else:
            normal = parameter.type.as_normal_type()
            normal = {"dynamic-select": "string", "app-selector": "object", "model-selector": "object"}.get(
                normal, normal
            )
            item = (
                deepcopy(parameter.input_schema)
                if parameter.input_schema is not None
                else ({} if normal == "any" else {"type": normal})
            )
            item.setdefault("description", parameter.llm_description or "")
            if parameter.options:
                item["enum"] = [option.value for option in parameter.options]
            properties[parameter.name] = item
        if parameter.required:
            required.append(parameter.name)
    return {"type": "object", "properties": properties, "required": required}


class AgentToolDeclarationService:
    def __init__(self, *, metadata: Callable = _metadata):
        self.metadata = metadata

    def prepare(
        self,
        *,
        tenant_id: str,
        actor_id: str,
        app_id: str,
        tools: AgentSoulToolsConfig,
        profile: Literal["isolated", "confirmed"] = "isolated",
    ) -> PreparedAgentToolDeclarations:
        plugins, core, references = [], [], []
        names: set[str] = set()
        for selected in tools.dify_tools:
            if not selected.enabled:
                continue
            provider_id = selected.provider_id or f"{selected.plugin_id}/{selected.provider}"
            declarations = self.metadata(
                tenant_id=tenant_id,
                provider_type=selected.provider_type,
                provider_id=provider_id,
                tool_name=selected.tool_name,
            )
            if isinstance(declarations, AgentToolMetadata):
                declarations = [declarations]
            for declaration in declarations:
                name = declaration.entity.identity.name
                if name in names:
                    raise BuilderExecutionPolicyError("agent_tool_name_duplicated")
                names.add(name)
                parameters = [
                    DifyPluginToolParameter.model_validate(item.model_dump(mode="json"))
                    for item in declaration.entity.parameters or []
                ]
                credential_id = selected.credential_ref.id if selected.credential_ref else None
                tool_ref = canonical_digest(
                    {
                        "tenant_id": tenant_id,
                        "actor_id": actor_id,
                        "app_id": app_id,
                        "provider_id": provider_id,
                        "tool_name": name,
                        "credential_id": credential_id,
                        "implementation_revision": declaration.implementation_revision,
                    }
                )
                runtime_parameters = TypeAdapter(dict[str, JsonValue]).validate_python(selected.runtime_parameters)
                for parameter in parameters:
                    if parameter.type.value == "secret-input" and parameter.name in runtime_parameters:
                        runtime_parameters[parameter.name] = {"secret_ref": f"{tool_ref}:{parameter.name}"}
                common = {
                    "tool_name": name,
                    "name": name,
                    "description": selected.description or declaration.entity.description.llm,
                    "runtime_parameters": runtime_parameters,
                    "parameters": parameters,
                    "parameters_json_schema": _schema(parameters),
                }
                if profile == "isolated" and (
                    selected.provider_type == ToolProviderType.PLUGIN
                    or (selected.provider_type == ToolProviderType.BUILT_IN and provider_id.count("/") == 2)
                ):
                    plugin_id, provider = provider_id.rsplit("/", 1)
                    plugins.append(
                        DifyPluginToolConfig(
                            plugin_id=plugin_id,
                            provider=provider,
                            credential_type=selected.credential_type,
                            credentials={},
                            **common,
                        )
                    )
                else:
                    core.append(
                        DifyCoreToolConfig.model_validate(
                            {
                                "provider_type": selected.provider_type.value,
                                "provider_id": provider_id,
                                "credential_id": credential_id,
                                **common,
                            }
                        )
                    )
                references.append(
                    AgentToolRuntimeReference(
                        tool_ref,
                        provider_id,
                        name,
                        credential_id,
                        declaration.implementation_revision,
                        "needs_setup"
                        if declaration.requires_credentials and credential_id is None
                        else "unresolved"
                        if declaration.requires_credentials
                        else "ready",
                    )
                )
        return PreparedAgentToolDeclarations(
            DifyPluginToolsLayerConfig(tools=plugins) if plugins else None,
            DifyCoreToolsLayerConfig(tools=core) if core else None,
            tuple(references),
        )
