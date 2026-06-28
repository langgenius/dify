import json
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from core.app.apps.completion.app_config_manager import CompletionAppConfig
from graphon.nodes import BuiltinNodeTypes
from models.model import App, AppMode
from services.workflow.workflow_converter import WorkflowConverter, WorkflowGraph


@dataclass(frozen=True, slots=True)
class RuntimeCompletionWorkflow:
    workflow_id: str
    root_node_id: str
    graph_dict: WorkflowGraph


class RuntimeCompletionWorkflowBuilder:
    """Build the transient WorkflowEntry graph used by Completion execution."""

    def __init__(self, workflow_converter: WorkflowConverter | None = None) -> None:
        self._workflow_converter = workflow_converter or WorkflowConverter()

    def build(self, *, app_model: App, app_config: CompletionAppConfig) -> RuntimeCompletionWorkflow:
        graph, _ = self._workflow_converter.build_graph_from_app_config(
            app_model=app_model,
            app_config=app_config,
            target_app_mode=AppMode.WORKFLOW,
        )
        self._route_external_data_query_to_sys_query(graph)
        return RuntimeCompletionWorkflow(
            workflow_id=f"completion-runtime-{uuid4()}",
            root_node_id="start",
            graph_dict=graph,
        )

    @staticmethod
    def _route_external_data_query_to_sys_query(graph: WorkflowGraph) -> None:
        """Preserve Completion API-based variable behavior in the runtime graph."""
        for node in graph["nodes"]:
            data = node.get("data", {})
            if data.get("type") != BuiltinNodeTypes.HTTP_REQUEST:
                continue

            body = data.get("body")
            if not isinstance(body, dict) or body.get("type") != "json":
                continue

            raw_body_data = body.get("data")
            if not isinstance(raw_body_data, str):
                continue

            try:
                body_data: dict[str, Any] = json.loads(raw_body_data)
            except json.JSONDecodeError:
                continue

            params = body_data.get("params")
            if not isinstance(params, dict) or params.get("query") != "":
                continue

            params["query"] = "{{#sys.query#}}"
            body["data"] = json.dumps(body_data)
