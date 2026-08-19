from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from services.data_migration.entities import DependencyKind


@dataclass(frozen=True)
class DiscoveredDependency:
    kind: DependencyKind
    provider_id: str
    provider_name: str | None = None
    source: str | None = None


class DependencyDiscoveryService:
    def discover_from_dsl(self, dsl: dict[str, Any]) -> list[DiscoveredDependency]:
        seen: set[tuple[DependencyKind, str]] = set()
        result: list[DiscoveredDependency] = []
        for node in self._nodes_from_dsl(dsl):
            data = node.get("data", {}) if isinstance(node, dict) else {}
            for dependency in self._dependencies_from_node(data):
                key = (dependency.kind, dependency.provider_id)
                if dependency.provider_id and key not in seen:
                    seen.add(key)
                    result.append(dependency)
        return result

    def _nodes_from_dsl(self, dsl: dict[str, Any]) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        graph = dsl.get("graph") if isinstance(dsl, dict) else None
        if isinstance(graph, dict) and isinstance(graph.get("nodes"), list):
            nodes.extend(node for node in graph["nodes"] if isinstance(node, dict))
        workflow = dsl.get("workflow") if isinstance(dsl, dict) else None
        workflow_graph = workflow.get("graph") if isinstance(workflow, dict) else None
        if isinstance(workflow_graph, dict) and isinstance(workflow_graph.get("nodes"), list):
            nodes.extend(node for node in workflow_graph["nodes"] if isinstance(node, dict))
        return nodes

    def _dependencies_from_node(self, data: dict[str, Any]) -> list[DiscoveredDependency]:
        dependencies: list[DiscoveredDependency] = []
        node_type = data.get("type")
        if node_type == "tool":
            dependency = self._from_tool_config(data, source="tool_node")
            if dependency:
                dependencies.append(dependency)
        if node_type == "agent":
            for tool_config in self._agent_tool_configs(data):
                if isinstance(tool_config, dict):
                    dependency = self._from_tool_config(tool_config, source="agent_node")
                    if dependency:
                        dependencies.append(dependency)
        return dependencies

    def _agent_tool_configs(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        configs = data.get("tools")
        if isinstance(configs, list):
            return [config for config in configs if isinstance(config, dict)]
        agent_parameters = data.get("agent_parameters")
        if not isinstance(agent_parameters, dict):
            return []
        tools_parameter = agent_parameters.get("tools")
        if not isinstance(tools_parameter, dict):
            return []
        value = tools_parameter.get("value", [])
        if not isinstance(value, list):
            return []
        return [config for config in value if isinstance(config, dict)]

    def _from_tool_config(self, config: dict[str, Any], *, source: str) -> DiscoveredDependency | None:
        provider_id = config.get("provider_id") or config.get("provider_name") or config.get("provider")
        if not provider_id:
            return None
        provider_type = str(config.get("provider_type") or config.get("type") or "")
        kind = self._kind_from_provider_type(provider_type)
        return DiscoveredDependency(
            kind=kind,
            provider_id=str(provider_id),
            provider_name=config.get("provider_name"),
            source=source,
        )

    def _kind_from_provider_type(self, provider_type: str) -> DependencyKind:
        normalized = provider_type.lower()
        if normalized in {"api", "custom", "api_tool"}:
            return DependencyKind.API_TOOL
        if normalized in {"workflow", "workflow_tool"}:
            return DependencyKind.WORKFLOW_TOOL
        if normalized == "mcp":
            return DependencyKind.MCP_TOOL
        return DependencyKind.BUILTIN_OR_PLUGIN_TOOL
