import logging
from abc import abstractmethod
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Generic, Optional, TypeVar, Union, cast

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.enums import CONTINUE_ON_ERROR_NODE_TYPE, NodeType
from core.workflow.nodes.event import NodeEvent, RunCompletedEvent
from models.workflow import WorkflowNodeExecutionStatus

from .entities import BaseNodeData

if TYPE_CHECKING:
    from core.workflow.graph_engine.entities.event import InNodeEvent
    from core.workflow.graph_engine.entities.graph import Graph
    from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
    from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState

logger = logging.getLogger(__name__)

GenericNodeData = TypeVar("GenericNodeData", bound=BaseNodeData)


class BaseNode(Generic[GenericNodeData]):
    _node_data_cls: type[BaseNodeData]
    _node_type: NodeType

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph: "Graph",
        graph_runtime_state: "GraphRuntimeState",
        previous_node_id: Optional[str] = None,
        thread_pool_id: Optional[str] = None,
    ) -> None:
        self.id = id
        self.tenant_id = graph_init_params.tenant_id
        self.app_id = graph_init_params.app_id
        self.workflow_type = graph_init_params.workflow_type
        self.workflow_id = graph_init_params.workflow_id
        self.graph_config = graph_init_params.graph_config
        self.user_id = graph_init_params.user_id
        self.user_from = graph_init_params.user_from
        self.invoke_from = graph_init_params.invoke_from
        self.workflow_call_depth = graph_init_params.call_depth
        self.graph = graph
        self.graph_runtime_state = graph_runtime_state
        self.previous_node_id = previous_node_id
        self.thread_pool_id = thread_pool_id

        node_id = config.get("id")
        if not node_id:
            raise ValueError("Node ID is required.")

        self.node_id = node_id

        node_data = self._node_data_cls.model_validate(config.get("data", {}))
        self.node_data = cast(GenericNodeData, node_data)

    @abstractmethod
    def _run(self) -> NodeRunResult | Generator[Union[NodeEvent, "InNodeEvent"], None, None]:
        """
        Run node
        :return:
        """
        raise NotImplementedError

    def run(self) -> Generator[Union[NodeEvent, "InNodeEvent"], None, None]:
        try:
            result = self._run()
        except Exception as e:
            logger.exception(f"Node {self.node_id} failed to run")
            result = NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED, error=str(e), error_type="SystemError")

        if isinstance(result, NodeRunResult):
            yield RunCompletedEvent(run_result=result)
        else:
            yield from result

    @classmethod
    def extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        config: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param config: node config
        :return:
        """
        node_id = config.get("id")
        if not node_id:
            raise ValueError("Node ID is required when extracting variable selector to variable mapping.")

        node_data = cls._node_data_cls(**config.get("data", {}))
        return cls._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config, node_id=node_id, node_data=cast(GenericNodeData, node_data)
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: GenericNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {}

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {}

    @property
    def node_type(self) -> NodeType:
        """
        Get node type
        :return:
        """
        return self._node_type

    @property
    def should_continue_on_error(self) -> bool:
        """judge if should continue on error

        Returns:
            bool: if should continue on error
        """
        return self.node_data.error_strategy is not None and self.node_type in CONTINUE_ON_ERROR_NODE_TYPE
