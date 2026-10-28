"""Locate and retarget Workflow Tool references inside App DSL data."""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any

import yaml

from graphon.enums import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolProviderType


@dataclass(frozen=True)
class WorkflowToolReference:
    """A tool configuration in a DSL whose ``id_key`` holds a Workflow Tool provider id."""

    config: dict[str, Any]
    id_key: str

    @property
    def provider_id(self) -> str:
        return self.config[self.id_key]


@dataclass(frozen=True)
class WorkflowToolTarget:
    """The Workflow Tool that a packaged provider id resolves to in the importing workspace."""

    provider_id: str
    name: str
    create: bool


def iter_workflow_tool_references(data: Mapping[str, Any]) -> Iterator[WorkflowToolReference]:
    """Yield the Workflow Tool references of tool nodes, legacy Agent nodes and agent-chat configs."""
    tool_configs: list[Any] = []
    workflow = data.get("workflow")
    graph = workflow.get("graph") if isinstance(workflow, Mapping) else None
    nodes = graph.get("nodes") if isinstance(graph, Mapping) else None
    for node in nodes if isinstance(nodes, list) else []:
        node_data = node.get("data") if isinstance(node, Mapping) else None
        if not isinstance(node_data, Mapping):
            continue
        if node_data.get("type") == BuiltinNodeTypes.TOOL:
            tool_configs.append(node_data)
        agent_parameters = node_data.get("agent_parameters")
        if node_data.get("type") == BuiltinNodeTypes.AGENT and isinstance(agent_parameters, Mapping):
            for parameter in agent_parameters.values():
                value = parameter.get("value") if isinstance(parameter, Mapping) else None
                tool_configs.extend(value if isinstance(value, list) else [])
    model_config = data.get("model_config")
    agent_mode = model_config.get("agent_mode") if isinstance(model_config, Mapping) else None
    agent_tools = agent_mode.get("tools") if isinstance(agent_mode, Mapping) else None
    tool_configs.extend(agent_tools if isinstance(agent_tools, list) else [])

    for config in tool_configs:
        if not isinstance(config, dict):
            continue
        # Agent node tools name the provider type ``type`` and keep the provider id in ``provider_name``.
        if "provider_type" in config:
            provider_type, id_key = config["provider_type"], "provider_id"
        else:
            provider_type, id_key = config.get("type"), "provider_name"
        provider_id = config.get(id_key)
        if provider_type == ToolProviderType.WORKFLOW and isinstance(provider_id, str) and provider_id:
            yield WorkflowToolReference(config=config, id_key=id_key)


def retarget_workflow_tool_dsl(dsl: str, targets: Mapping[str, WorkflowToolTarget]) -> str:
    """Point the DSL's Workflow Tool references at their targets, keeping unknown providers as they are."""
    data = yaml.safe_load(dsl)
    if not isinstance(data, dict):
        return dsl
    for reference in iter_workflow_tool_references(data):
        target = targets.get(reference.provider_id)
        if target is None:
            continue
        reference.config[reference.id_key] = target.provider_id
        # The editor matches a tool node's outputs by the tool name, which follows a renamed provider.
        reference.config["tool_name"] = target.name
    return yaml.dump(data, allow_unicode=True)
