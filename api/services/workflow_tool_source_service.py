"""Materialize pinned Workflow Tool definitions before execution begins."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict

from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.tools.workflow_as_tool.tool import WorkflowTool
from core.workflow.workflow_tool_container_types import WorkflowToolContainerPayload
from repositories.workflow_tool_source_repository import SQLAlchemyWorkflowToolSourceRepository


class WorkflowToolDefinition(BaseModel):
    """Serializable tool definition, without invocation state or credentials."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    app_id: str
    workflow_id: str
    version: str
    entity: ToolEntity
    label: str


class WorkflowToolSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    tools: dict[str, WorkflowToolDefinition]


@dataclass(frozen=True)
class MaterializedWorkflowTools:
    sources: dict[str, WorkflowToolSource]
    # Multiple providers may refer to the same workflow with different definitions.
    tools: dict[str, WorkflowTool]

    def snapshot(self) -> WorkflowToolSnapshot:
        return WorkflowToolSnapshot(
            tools={
                provider_id: WorkflowToolDefinition(
                    app_id=tool.workflow_app_id,
                    workflow_id=tool.workflow_id,
                    version=tool.version,
                    entity=tool.entity.model_copy(deep=True),
                    label=tool.label,
                )
                for provider_id, tool in self.tools.items()
            }
        )


class WorkflowToolSourceService:
    def __init__(self, repository: SQLAlchemyWorkflowToolSourceRepository) -> None:
        self._repository = repository

    def load(
        self,
        *,
        tenant_id: str,
        graph_config: Mapping[str, Any],
        allow_human_input: bool = True,
        suspended_tools: Sequence[WorkflowToolContainerPayload] = (),
        snapshot: WorkflowToolSnapshot | None = None,
    ) -> MaterializedWorkflowTools:
        """Restore saved definitions, or materialize current providers for new/legacy runs."""
        sources: dict[str, WorkflowToolSource] = {}
        tools: dict[str, WorkflowTool] = {}
        pending = [graph_config]
        for tool in suspended_tools:
            source = self._repository.get_source(
                tenant_id=tenant_id,
                app_id=tool.source_app_id,
                workflow_id=tool.source_workflow_id,
                version=tool.source_workflow_version,
            )
            if source is None:
                raise ValueError("Workflow Tool source was not found")
            sources[source.workflow_id] = source
            pending.append(source.graph_config)

        if snapshot is not None:
            for provider_id, definition in snapshot.tools.items():
                source = self._repository.get_source(
                    tenant_id=tenant_id,
                    app_id=definition.app_id,
                    workflow_id=definition.workflow_id,
                    version=definition.version,
                )
                if source is None:
                    raise ValueError("Workflow Tool source was not found")
                sources[source.workflow_id] = source
                pending.append(source.graph_config)
                tools[provider_id] = WorkflowTool(
                    workflow_app_id=source.app_id,
                    workflow_id=source.workflow_id,
                    workflow_as_tool_id=provider_id,
                    version=definition.version,
                    workflow_call_depth=0,
                    entity=definition.entity.model_copy(deep=True),
                    runtime=ToolRuntime(tenant_id=tenant_id),
                    label=definition.label,
                )

        visited: set[str] = set()
        while pending:
            provider_ids: set[str] = set()
            for graph in pending:
                for node in graph.get("nodes", []):
                    data = node.get("data", {})
                    if not allow_human_input and data.get("type") == "human-input":
                        raise ValueError("Human Input Workflow Tools require Engine-managed container execution.")
                    if data.get("type") == "tool" and data.get("provider_type") == "workflow":
                        provider_id = data.get("provider_id")
                        if isinstance(provider_id, str) and provider_id not in visited:
                            provider_ids.add(provider_id)
            # A present snapshot is authoritative, including an empty registry.
            # Never resolve mutable provider records after a durable pause.
            if snapshot is not None or not provider_ids:
                break
            visited.update(provider_ids)
            pending = []
            for source in self._repository.get_by_provider_ids(tenant_id=tenant_id, provider_ids=tuple(provider_ids)):
                if source.tool is not None:
                    tools[source.tool.workflow_as_tool_id] = source.tool
                if source.workflow_id not in sources:
                    pending.append(source.graph_config)
                sources[source.workflow_id] = source
        return MaterializedWorkflowTools(sources=sources, tools=tools)
