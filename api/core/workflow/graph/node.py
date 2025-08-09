import logging
from abc import abstractmethod
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, ClassVar, Optional
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.enums import NodeExecutionType, NodeState, NodeType, WorkflowNodeExecutionStatus
from core.workflow.events import (
    GraphBaseNodeEvent,
    NodeRunFailedEvent,
    NodeRunResult,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.events.node import NodeRunCompletedEvent
from libs.datetime_utils import naive_utc_now
from models.enums import UserFrom

from .base_entities import BaseNodeData, RetryConfig

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams, GraphRuntimeState
    from core.workflow.enums import ErrorStrategy, NodeType
    from core.workflow.events import NodeRunResult

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
        previous_node_id: Optional[str] = None,
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
        self.previous_node_id = previous_node_id
        self.state: NodeState = NodeState.UNKNOWN  # node execution state

        node_id = config.get("id")
        if not node_id:
            raise ValueError("Node ID is required.")

        self.node_id = node_id

    @abstractmethod
    def init_node_data(self, data: Mapping[str, Any]) -> None: ...

    @abstractmethod
    def _run(self) -> "NodeRunResult | Generator[GraphBaseNodeEvent, None, None]":
        """
        Run node
        :return:
        """
        raise NotImplementedError

    def run(self) -> "Generator[GraphBaseNodeEvent, None, None]":
        # Generate a single node execution ID to use for all events
        node_execution_id = str(uuid4())

        # Create and push start event with required fields
        start_at = naive_utc_now()
        start_event = NodeRunStartedEvent(
            id=node_execution_id,
            node_id=self.id,
            node_type=self.node_type,
            node_title=self.title,
            parallel_id=None,
            in_iteration_id=None,
            start_at=start_at,
        )

        yield start_event

        # === FIXME(-LAN-): For ToolNode. Needs to refactor.
        start_event.provider_id = getattr(self.get_base_node_data(), "provider_id", "")
        start_event.provider_type = getattr(self.get_base_node_data(), "provider_type", "")
        # ===

        try:
            result = self._run()
            if isinstance(result, NodeRunResult):
                if result.status == WorkflowNodeExecutionStatus.FAILED:
                    yield NodeRunFailedEvent(
                        id=node_execution_id,
                        node_id=self.id,
                        node_type=self.node_type,
                        start_at=start_at,
                        node_run_result=result,
                        error=result.error,
                    )
                    return
                elif result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
                    yield NodeRunSucceededEvent(
                        id=node_execution_id,
                        node_id=self.id,
                        node_type=self.node_type,
                        start_at=start_at,
                        node_run_result=result,
                    )
                else:
                    raise Exception(f"result status {result.status} not supported")
            else:
                for event in result:
                    if isinstance(event, NodeRunCompletedEvent):
                        yield NodeRunSucceededEvent(
                            id=node_execution_id,
                            node_id=self.id,
                            node_type=self.node_type,
                            start_at=start_at,
                            node_run_result=event.run_result,
                        )
                        return
                    yield event
        except Exception as e:
            logger.exception("Node %s failed to run", self.node_id)
            result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                error_type="WorkflowNodeError",
            )
            yield NodeRunFailedEvent(
                id=node_execution_id,  # Use same node execution id
                node_id=self.id,
                node_type=self.node_type,
                start_at=start_at,
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
