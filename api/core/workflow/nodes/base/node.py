import logging
from abc import abstractmethod
from collections.abc import Callable, Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, ClassVar, Optional
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.enums import NodeExecutionType, NodeState, NodeType, WorkflowNodeExecutionStatus
from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunAgentLogEvent,
    NodeRunFailedEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import (
    AgentLogEvent,
    IterationFailedEvent,
    IterationNextEvent,
    IterationStartedEvent,
    IterationSucceededEvent,
    LoopFailedEvent,
    LoopNextEvent,
    LoopStartedEvent,
    LoopSucceededEvent,
    NodeEventBase,
    NodeRunResult,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from libs.datetime_utils import naive_utc_now
from models.enums import UserFrom

from .entities import BaseNodeData, RetryConfig

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams, GraphRuntimeState
    from core.workflow.enums import ErrorStrategy, NodeType
    from core.workflow.node_events import NodeRunResult

logger = logging.getLogger(__name__)


class Node:
    node_type: ClassVar["NodeType"]
    execution_type: NodeExecutionType = NodeExecutionType.EXECUTABLE

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ) -> None:
        self.id = id
        self.tenant_id = graph_init_params.tenant_id
        self.app_id = graph_init_params.app_id
        self.workflow_id = graph_init_params.workflow_id
        self.graph_config = graph_init_params.graph_config
        self.user_id = graph_init_params.user_id
        self.user_from = UserFrom(graph_init_params.user_from)
        self.invoke_from = InvokeFrom(graph_init_params.invoke_from)
        self.workflow_call_depth = graph_init_params.call_depth
        self.graph_runtime_state = graph_runtime_state
        self.state: NodeState = NodeState.UNKNOWN  # node execution state

        node_id = config.get("id")
        if not node_id:
            raise ValueError("Node ID is required.")

        self._node_id = node_id
        self._node_execution_id: str = ""
        self._start_at = naive_utc_now()

    @abstractmethod
    def init_node_data(self, data: Mapping[str, Any]) -> None: ...

    @abstractmethod
    def _run(self) -> "NodeRunResult | Generator[GraphNodeEventBase, None, None]":
        """
        Run node
        :return:
        """
        raise NotImplementedError

    def run(self) -> "Generator[GraphNodeEventBase, None, None]":
        # Generate a single node execution ID to use for all events
        if not self._node_execution_id:
            self._node_execution_id = str(uuid4())
        self._start_at = naive_utc_now()

        # Create and push start event with required fields
        start_event = NodeRunStartedEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.title,
            in_iteration_id=None,
            start_at=self._start_at,
        )

        # === FIXME(-LAN-): Needs to refactor.
        from core.workflow.nodes.tool.tool_node import ToolNode

        if isinstance(self, ToolNode):
            start_event.provider_id = getattr(self.get_base_node_data(), "provider_id", "")
            start_event.provider_type = getattr(self.get_base_node_data(), "provider_type", "")

        from typing import cast

        from core.workflow.nodes.agent.agent_node import AgentNode
        from core.workflow.nodes.agent.entities import AgentNodeData

        if isinstance(self, AgentNode):
            start_event.agent_strategy = NodeRunStartedEvent.AgentNodeStrategyInit(
                name=cast(AgentNodeData, self.get_base_node_data()).agent_strategy_name,
                icon=self.agent_strategy_icon,
            )

        # ===
        yield start_event

        try:
            result = self._run()

            # Handle NodeRunResult
            if isinstance(result, NodeRunResult):
                yield self._convert_node_run_result_to_graph_node_event(result)
                return

            # Handle event stream
            for event in result:
                if isinstance(event, NodeEventBase):
                    event = self._convert_node_event_to_graph_node_event(event)

                if not event.in_iteration_id and not event.in_loop_id:
                    event.id = self._node_execution_id
                yield event
        except Exception as e:
            logger.exception("Node %s failed to run", self._node_id)
            result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type="WorkflowNodeError",
            )
            yield NodeRunFailedEvent(
                id=self._node_execution_id,
                node_id=self._node_id,
                node_type=self.node_type,
                start_at=self._start_at,
                node_run_result=result,
                error=str(e),
            )

    @classmethod
    def extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        config: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """Extracts references variable selectors from node configuration.

        The `config` parameter represents the configuration for a specific node type and corresponds
        to the `data` field in the node definition object.

        The returned mapping has the following structure:

            {'1747829548239.#1747829667553.result#': ['1747829667553', 'result']}

        For loop and iteration nodes, the mapping may look like this:

            {
                "1748332301644.input_selector": ["1748332363630", "result"],
                "1748332325079.1748332325079.#sys.workflow_id#": ["sys", "workflow_id"],
            }

        where `1748332301644` is the ID of the loop / iteration node,
        and `1748332325079` is the ID of the node inside the loop or iteration node.

        Here, the key consists of two parts: the current node ID (provided as the `node_id`
        parameter to `_extract_variable_selector_to_variable_mapping`) and the variable selector,
        enclosed in `#` symbols. These two parts are separated by a dot (`.`).

        The value is a list of string representing the variable selector, where the first element is the node ID
        of the referenced variable, and the second element is the variable name within that node.

        The meaning of the above response is:

        The node with ID `1747829548239` references the variable `result` from the node with
        ID `1747829667553`. For example, if `1747829548239` is a LLM node, its prompt may contain a
        reference to the `result` output variable of node `1747829667553`.

        :param graph_config: graph config
        :param config: node config
        :return:
        """
        node_id = config.get("id")
        if not node_id:
            raise ValueError("Node ID is required when extracting variable selector to variable mapping.")

        # Pass raw dict data instead of creating NodeData instance
        data = cls._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config, node_id=node_id, node_data=config.get("data", {})
        )
        return data

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        return {}

    def blocks_variable_output(self, variable_selectors: set[tuple[str, ...]]) -> bool:
        """
        Check if this node blocks the output of specific variables.

        This method is used to determine if a node must complete execution before
        the specified variables can be used in streaming output.

        :param variable_selectors: Set of variable selectors, each as a tuple (e.g., ('conversation', 'str'))
        :return: True if this node blocks output of any of the specified variables, False otherwise
        """
        return False

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        return {}

    @classmethod
    @abstractmethod
    def version(cls) -> str:
        """`node_version` returns the version of current node type."""
        # NOTE(QuantumGhost): This should be in sync with `NODE_TYPE_CLASSES_MAPPING`.
        #
        # If you have introduced a new node type, please add it to `NODE_TYPE_CLASSES_MAPPING`
        # in `api/core/workflow/nodes/__init__.py`.
        raise NotImplementedError("subclasses of BaseNode must implement `version` method.")

    @property
    def retry(self) -> bool:
        return False

    # Abstract methods that subclasses must implement to provide access
    # to BaseNodeData properties in a type-safe way

    @abstractmethod
    def _get_error_strategy(self) -> Optional["ErrorStrategy"]:
        """Get the error strategy for this node."""
        ...

    @abstractmethod
    def _get_retry_config(self) -> RetryConfig:
        """Get the retry configuration for this node."""
        ...

    @abstractmethod
    def _get_title(self) -> str:
        """Get the node title."""
        ...

    @abstractmethod
    def _get_description(self) -> Optional[str]:
        """Get the node description."""
        ...

    @abstractmethod
    def _get_default_value_dict(self) -> dict[str, Any]:
        """Get the default values dictionary for this node."""
        ...

    @abstractmethod
    def get_base_node_data(self) -> BaseNodeData:
        """Get the BaseNodeData object for this node."""
        ...

    # Public interface properties that delegate to abstract methods
    @property
    def error_strategy(self) -> Optional["ErrorStrategy"]:
        """Get the error strategy for this node."""
        return self._get_error_strategy()

    @property
    def retry_config(self) -> RetryConfig:
        """Get the retry configuration for this node."""
        return self._get_retry_config()

    @property
    def title(self) -> str:
        """Get the node title."""
        return self._get_title()

    @property
    def description(self) -> Optional[str]:
        """Get the node description."""
        return self._get_description()

    @property
    def default_value_dict(self) -> dict[str, Any]:
        """Get the default values dictionary for this node."""
        return self._get_default_value_dict()

    def _convert_node_run_result_to_graph_node_event(self, result: NodeRunResult) -> GraphNodeEventBase:
        match result.status:
            case WorkflowNodeExecutionStatus.FAILED:
                return NodeRunFailedEvent(
                    id=self._node_execution_id,
                    node_id=self.id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=result,
                    error=result.error,
                )
            case WorkflowNodeExecutionStatus.SUCCEEDED:
                return NodeRunSucceededEvent(
                    id=self._node_execution_id,
                    node_id=self.id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=result,
                )
        raise Exception(f"result status {result.status} not supported")

    def _convert_node_event_to_graph_node_event(self, event: NodeEventBase) -> GraphNodeEventBase:
        handler_maps: dict[type[NodeEventBase], Callable[[Any], GraphNodeEventBase]] = {
            StreamChunkEvent: self._handle_stream_chunk_event,
            StreamCompletedEvent: self._handle_stream_completed_event,
            AgentLogEvent: self._handle_agent_log_event,
            LoopStartedEvent: self._handle_loop_started_event,
            LoopNextEvent: self._handle_loop_next_event,
            LoopSucceededEvent: self._handle_loop_succeeded_event,
            LoopFailedEvent: self._handle_loop_failed_event,
            IterationStartedEvent: self._handle_iteration_started_event,
            IterationNextEvent: self._handle_iteration_next_event,
            IterationSucceededEvent: self._handle_iteration_succeeded_event,
            IterationFailedEvent: self._handle_iteration_failed_event,
        }
        handler = handler_maps.get(type(event))
        if not handler:
            raise NotImplementedError(f"Node {self._node_id} does not support event type {type(event)}")
        return handler(event)

    def _handle_stream_chunk_event(self, event: StreamChunkEvent) -> NodeRunStreamChunkEvent:
        return NodeRunStreamChunkEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            selector=event.selector,
            chunk=event.chunk,
            is_final=event.is_final,
            chunk_content=event.chunk_content,
            from_variable_selector=event.from_variable_selector,
        )

    def _handle_stream_completed_event(self, event: StreamCompletedEvent) -> NodeRunSucceededEvent | NodeRunFailedEvent:
        match event.node_run_result.status:
            case WorkflowNodeExecutionStatus.SUCCEEDED:
                return NodeRunSucceededEvent(
                    id=self._node_execution_id,
                    node_id=self._node_id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=event.node_run_result,
                )
            case WorkflowNodeExecutionStatus.FAILED:
                return NodeRunFailedEvent(
                    id=self._node_execution_id,
                    node_id=self._node_id,
                    node_type=self.node_type,
                    start_at=self._start_at,
                    node_run_result=event.node_run_result,
                    error=event.node_run_result.error,
                )
        raise NotImplementedError(f"Node {self._node_id} does not support status {event.node_run_result.status}")

    def _handle_agent_log_event(self, event: AgentLogEvent) -> NodeRunAgentLogEvent:
        return NodeRunAgentLogEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            message_id=event.message_id,
            label=event.label,
            node_execution_id=event.node_execution_id,
            parent_id=event.parent_id,
            error=event.error,
            status=event.status,
            data=event.data,
            metadata=event.metadata,
        )

    def _handle_loop_started_event(self, event: LoopStartedEvent) -> NodeRunLoopStartedEvent:
        return NodeRunLoopStartedEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            start_at=event.start_at,
            inputs=event.inputs,
            metadata=event.metadata,
            predecessor_node_id=event.predecessor_node_id,
        )

    def _handle_loop_next_event(self, event: LoopNextEvent) -> NodeRunLoopNextEvent:
        return NodeRunLoopNextEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            index=event.index,
            pre_loop_output=event.pre_loop_output,
            duration=event.duration,
        )

    def _handle_loop_succeeded_event(self, event: LoopSucceededEvent) -> NodeRunLoopSucceededEvent:
        return NodeRunLoopSucceededEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
            loop_duration_map=event.loop_duration_map,
        )

    def _handle_loop_failed_event(self, event: LoopFailedEvent) -> NodeRunLoopFailedEvent:
        return NodeRunLoopFailedEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
            error=event.error,
        )

    def _handle_iteration_started_event(self, event: IterationStartedEvent) -> NodeRunIterationStartedEvent:
        return NodeRunIterationStartedEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            start_at=event.start_at,
            inputs=event.inputs,
            metadata=event.metadata,
            predecessor_node_id=event.predecessor_node_id,
        )

    def _handle_iteration_next_event(self, event: IterationNextEvent) -> NodeRunIterationNextEvent:
        return NodeRunIterationNextEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            index=event.index,
            pre_iteration_output=event.pre_iteration_output,
            duration=event.duration,
        )

    def _handle_iteration_succeeded_event(self, event: IterationSucceededEvent) -> NodeRunIterationSucceededEvent:
        return NodeRunIterationSucceededEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
            iteration_duration_map=event.iteration_duration_map,
        )

    def _handle_iteration_failed_event(self, event: IterationFailedEvent) -> NodeRunIterationFailedEvent:
        return NodeRunIterationFailedEvent(
            id=self._node_execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_title=self.get_base_node_data().title,
            start_at=event.start_at,
            inputs=event.inputs,
            outputs=event.outputs,
            metadata=event.metadata,
            steps=event.steps,
            error=event.error,
        )
