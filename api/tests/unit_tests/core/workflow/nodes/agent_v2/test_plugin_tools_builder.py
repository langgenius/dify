from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from core.agent.entities import AgentToolEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
)
from core.workflow.nodes.agent_v2.plugin_tools_builder import (
    WorkflowAgentPluginToolsBuilder,
    WorkflowAgentPluginToolsBuildError,
)
from models.agent_config_entities import AgentSoulToolsConfig


class FakeRuntimeProvider:
    def __init__(self, tool: Tool) -> None:
        self.tool = tool
        self.last_agent_tool: AgentToolEntity | None = None

    def get_agent_tool_runtime(
        self,
        tenant_id: str,
        app_id: str,
        agent_tool: AgentToolEntity,
        user_id: str | None = None,
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        variable_pool: Any | None = None,
    ) -> Tool:
        self.last_agent_tool = agent_tool
        return self.tool


class FakeTool(Tool):
    def tool_provider_type(self):
        raise NotImplementedError

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> ToolInvokeMessage | list[ToolInvokeMessage] | Generator[ToolInvokeMessage, None, None]:
        raise NotImplementedError


def _tool(*, runtime_parameters: dict[str, Any] | None = None) -> FakeTool:
    if runtime_parameters is None:
        runtime_parameters = {"region": "us"}
    parameters = [
        ToolParameter(
            name="query",
            label=I18nObject(en_US="Query"),
            type=ToolParameter.ToolParameterType.STRING,
            form=ToolParameter.ToolParameterForm.LLM,
            required=True,
            llm_description="Search query",
        ),
        ToolParameter(
            name="region",
            label=I18nObject(en_US="Region"),
            type=ToolParameter.ToolParameterType.STRING,
            form=ToolParameter.ToolParameterForm.FORM,
            required=True,
        ),
    ]
    entity = ToolEntity(
        identity=ToolIdentity(
            author="langgenius",
            name="search",
            label=I18nObject(en_US="Search"),
            provider="search",
        ),
        description=ToolDescription(human=I18nObject(en_US="Search"), llm="Search the web."),
        parameters=parameters,
    )
    runtime = ToolRuntime(
        tenant_id="tenant-1",
        user_id="user-1",
        credentials={"api_key": "secret"},
        runtime_parameters=runtime_parameters,
    )
    return FakeTool(entity=entity, runtime=runtime)


def test_builds_dify_plugin_tools_layer_from_existing_tool_runtime():
    runtime_provider = FakeRuntimeProvider(_tool())
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=runtime_provider)
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                }
            ]
        }
    )

    result = builder.build(tenant_id="tenant-1", app_id="app-1", user_id="user-1", tools=tools)

    assert result is not None
    prepared = result.tools[0]
    assert prepared.plugin_id == "langgenius/search"
    assert prepared.provider == "search"
    assert prepared.tool_name == "search"
    assert prepared.name == "search"
    assert prepared.credentials == {"api_key": "secret"}
    assert prepared.runtime_parameters == {"region": "us"}
    assert prepared.parameters_json_schema["properties"]["query"]["type"] == "string"
    assert "region" not in prepared.parameters_json_schema["properties"]
    assert runtime_provider.last_agent_tool is not None
    assert runtime_provider.last_agent_tool.credential_id == "credential-1"


def test_rejects_duplicate_exposed_tool_names():
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=FakeRuntimeProvider(_tool()))
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                },
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                    "runtime_parameters": {"region": "us"},
                },
            ]
        }
    )

    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        builder.build(tenant_id="tenant-1", app_id="app-1", user_id="user-1", tools=tools)

    assert exc_info.value.error_code == "agent_tool_name_duplicated"


def test_rejects_missing_required_runtime_parameter():
    builder = WorkflowAgentPluginToolsBuilder(tool_runtime_provider=FakeRuntimeProvider(_tool(runtime_parameters={})))
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_id": "langgenius/search/search",
                    "tool_name": "search",
                    "credential_type": "api-key",
                    "credential_id": "credential-1",
                }
            ]
        }
    )

    with pytest.raises(WorkflowAgentPluginToolsBuildError) as exc_info:
        builder.build(tenant_id="tenant-1", app_id="app-1", user_id="user-1", tools=tools)

    assert exc_info.value.error_code == "agent_tool_runtime_parameter_missing"
