from abc import abstractmethod
from typing import Optional

from core.workflow.callbacks.base_workflow_callback import BaseWorkflowCallback
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from models.workflow import WorkflowNodeExecutionStatus


class BaseNode:
    _node_data_cls: type[BaseNodeData]
    _node_type: NodeType

    node_id: str
    node_data: BaseNodeData
    node_run_result: Optional[NodeRunResult] = None

    stream_output_supported: bool = False
    callbacks: list[BaseWorkflowCallback]

    def __init__(self, config: dict,
                 callbacks: list[BaseWorkflowCallback] = None) -> None:
        self.node_id = config.get("id")
        if not self.node_id:
            raise ValueError("Node ID is required.")

        self.node_data = self._node_data_cls(**config.get("data", {}))
        self.callbacks = callbacks or []

    @abstractmethod
    def _run(self, variable_pool: Optional[VariablePool] = None,
             run_args: Optional[dict] = None) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :param run_args: run args
        :return:
        """
        raise NotImplementedError

    def run(self, variable_pool: Optional[VariablePool] = None,
            run_args: Optional[dict] = None) -> NodeRunResult:
        """
        Run node entry
        :param variable_pool: variable pool
        :param run_args: run args
        :return:
        """
        if variable_pool is None and run_args is None:
            raise ValueError("At least one of `variable_pool` or `run_args` must be provided.")

        try:
            result = self._run(
                variable_pool=variable_pool,
                run_args=run_args
            )
        except Exception as e:
            # process unhandled exception
            result = NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e)
            )

        self.node_run_result = result
        return result

    def publish_text_chunk(self, text: str) -> None:
        """
        Publish text chunk
        :param text: chunk text
        :return:
        """
        if self.stream_output_supported:
            if self.callbacks:
                for callback in self.callbacks:
                    callback.on_text_chunk(text)

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
