"""Materialize pinned Workflow Tool definitions before execution begins."""

from collections.abc import Mapping, Sequence
from typing import Any

from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.workflow.workflow_tool_container_types import WorkflowToolContainerPayload
from repositories.workflow_tool_source_repository import SQLAlchemyWorkflowToolSourceRepository


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
    ) -> dict[str, WorkflowToolSource]:
        sources: dict[str, WorkflowToolSource] = {}
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
            if not provider_ids:
                break
            visited.update(provider_ids)
            pending = []
            for source in self._repository.get_by_provider_ids(tenant_id=tenant_id, provider_ids=tuple(provider_ids)):
                if source.workflow_id not in sources:
                    pending.append(source.graph_config)
                sources[source.workflow_id] = source
        return sources
