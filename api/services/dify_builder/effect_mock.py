"""Mocked results for side-effect nodes a Builder confirmed Test Run did not confirm.

PRD §9.1 makes Mock the Test Run default. The mocked class keeps the real
node's data model, title, edges and output handles. It initializes only the
Graphon lifecycle and returns empty values without native execution resources.
``process_data`` marks the row so the run evidence and the
result card can say which steps were mocked, and a run with any mocked step
cannot be published (§19.2).
"""

from __future__ import annotations

import copy
from functools import cache
from typing import TYPE_CHECKING, Any, cast

from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, ErrorStrategy, NodeExecutionType, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node
from models.agent_config_entities import (
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)

if TYPE_CHECKING:
    from graphon.engine_events import NodeRunStartedEvent
    from graphon.runtime import InitParams, RuntimeState

MOCKED_PROCESS_KEY = "builder_mocked"

_OUTPUTS: dict[str, dict[str, Any]] = {
    BuiltinNodeTypes.TOOL: {"text": "", "files": [], "json": []},
    BuiltinNodeTypes.HTTP_REQUEST: {"status_code": 200, "body": "", "headers": {}, "files": []},
    BuiltinNodeTypes.AGENT: {"text": "", "files": [], "json": []},
}


class _MockedRun:
    node_type: str
    node_data: BaseNodeData

    def __init__(
        self,
        node_id: str,
        data: Any,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
    ) -> None:
        # Keep Graphon's lifecycle/data contract without constructing the native
        # node's clients, credential owners, or other execution resources.
        Node.__init__(
            cast(Node, self),
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        node_config = self.node_data.model_dump(mode="python")
        self._agent_mock_job = (
            WorkflowNodeJobConfig.model_validate(
                {
                    "declared_outputs": node_config.get("agent_declared_outputs", []),
                    "output_routes": node_config.get("agent_output_routes", {}),
                }
            )
            if is_dify_agent_node_data(self.node_data)
            else None
        )
        if self._agent_mock_job is not None and self._agent_mock_job.output_routes.enabled:
            # Preserve DifyAgentNode's configuration invariant without entering
            # its resource-bearing constructor.
            if self.node_data.error_strategy == ErrorStrategy.DEFAULT_VALUE:
                raise ValueError("Output routes do not support the node-level default-value error strategy.")
            self.execution_type = NodeExecutionType.BRANCH

    def post_init(self) -> None:
        """Mock initialization never enters a native node's optional resource hook."""

    def _run(self) -> NodeRunResult:
        outputs = copy.deepcopy(_OUTPUTS.get(self.node_type, {}))
        edge_source_handle = "source"
        if self._agent_mock_job is not None:
            outputs = {
                "text": "",
                **{output.name: _empty_declared_output(output) for output in self._agent_mock_job.declared_outputs},
            }
            if self._agent_mock_job.output_routes.enabled:
                # This is a simulated branch, never an Agent decision. Select a
                # declared handle so the remaining mock workflow can execute.
                edge_source_handle = self._agent_mock_job.output_routes.routes[0].id
                outputs["switch"] = edge_source_handle
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={},
            process_data={MOCKED_PROCESS_KEY: True},
            outputs=outputs,
            edge_source_handle=edge_source_handle,
        )


def _empty_declared_output(output: DeclaredOutputConfig | DeclaredOutputChildConfig) -> Any:
    match output.type:
        case DeclaredOutputType.STRING:
            return ""
        case DeclaredOutputType.NUMBER:
            return 0
        case DeclaredOutputType.BOOLEAN:
            return False
        case DeclaredOutputType.OBJECT:
            return {child.name: _empty_declared_output(child) for child in output.children}
        case DeclaredOutputType.ARRAY:
            return []
        case DeclaredOutputType.FILE:
            # A mock cannot mint a valid tenant-owned persisted file reference.
            return None


def _populate_legacy_agent_start_event(self: Node, event: NodeRunStartedEvent) -> None:
    """Retain graph-owned strategy metadata without a provider/icon lookup."""
    event.extras["agent_strategy"] = {"name": self.node_data.model_dump(mode="python")["agent_strategy_name"]}


@cache
def mocked_node_class(node_class: type[Node]) -> type[Node]:
    """A resource-free mock with native node data; never replace its registration."""
    attributes: dict[str, Any] = {"__module__": __name__}
    if node_class.node_type == BuiltinNodeTypes.AGENT and node_class.version() == "1":
        # The native legacy hook needs a presentation provider, which a Mock
        # deliberately never constructs. Other native hooks remain unchanged.
        attributes["populate_start_event"] = _populate_legacy_agent_start_event
    return type(f"BuilderMocked{node_class.__name__}", (_MockedRun, node_class), attributes)
