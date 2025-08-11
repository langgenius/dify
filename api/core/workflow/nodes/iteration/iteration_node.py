import logging
from collections.abc import Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Optional, Union, cast

from core.variables import ArrayVariable, IntegerVariable, NoneVariable
from core.variables.segments import ArrayAnySegment, ArraySegment
from core.workflow.entities import VariablePool
from core.workflow.enums import (
    ErrorStrategy,
    NodeExecutionType,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.events import (
    GraphNodeEventBase,
    GraphRunFailedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.graph import BaseNodeData, Graph, Node, RetryConfig
from core.workflow.node_events import (
    IterationFailedEvent,
    IterationNextEvent,
    IterationStartedEvent,
    IterationSucceededEvent,
    NodeRunResult,
    StreamCompletedEvent,
)
from core.workflow.nodes.iteration.entities import ErrorHandleMode, IterationNodeData
from libs.datetime_utils import naive_utc_now

from .exc import (
    InvalidIteratorValueError,
    IterationGraphNotFoundError,
    IterationIndexNotFoundError,
    IterationNodeError,
    IteratorVariableNotFoundError,
    StartNodeIdNotFoundError,
)

if TYPE_CHECKING:
    from core.workflow.graph_engine import GraphEngine

logger = logging.getLogger(__name__)


class IterationNode(Node):
    """
    Iteration Node.
    """

    node_type = NodeType.ITERATION
    execution_type = NodeExecutionType.CONTAINER
    _node_data: IterationNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = IterationNodeData.model_validate(data)

    def _get_error_strategy(self) -> Optional[ErrorStrategy]:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> Optional[str]:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        return {
            "type": "iteration",
            "config": {
                "is_parallel": False,
                "parallel_nums": 10,
                "error_handle_mode": ErrorHandleMode.TERMINATED.value,
            },
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator:
        variable = self.graph_runtime_state.variable_pool.get(self._node_data.iterator_selector)

        if not variable:
            raise IteratorVariableNotFoundError(f"iterator variable {self._node_data.iterator_selector} not found")

        if not isinstance(variable, ArrayVariable) and not isinstance(variable, NoneVariable):
            raise InvalidIteratorValueError(f"invalid iterator value: {variable}, please provide a list.")

        if isinstance(variable, NoneVariable) or len(variable.value) == 0:
            # Try our best to preserve the type informat.
            if isinstance(variable, ArraySegment):
                output = variable.model_copy(update={"value": []})
            else:
                output = ArrayAnySegment(value=[])
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    # TODO(QuantumGhost): is it possible to compute the type of `output`
                    # from graph definition?
                    outputs={"output": output},
                )
            )
            return

        iterator_list_value = variable.to_object()

        if not isinstance(iterator_list_value, list):
            raise InvalidIteratorValueError(f"Invalid iterator value: {iterator_list_value}, please provide a list.")

        inputs = {"iterator_selector": iterator_list_value}

        if not self._node_data.start_node_id:
            raise StartNodeIdNotFoundError(f"field start_node_id in iteration {self._node_id} not found")

        started_at = naive_utc_now()
        iter_run_map: dict[str, float] = {}
        outputs: list[Any] = []

        yield IterationStartedEvent(
            start_at=started_at,
            inputs=inputs,
            metadata={"iteration_length": len(iterator_list_value)},
        )

        try:
            for index, item in enumerate(iterator_list_value):
                iter_start_at = datetime.now(UTC).replace(tzinfo=None)
                yield IterationNextEvent(index=index)

                graph_engine = self._create_graph_engine(index, item)

                # Run the iteration
                yield from self._run_single_iter(
                    variable_pool=graph_engine.graph_runtime_state.variable_pool,
                    outputs=outputs,
                    graph_engine=graph_engine,
                )

                # Update the total tokens from this iteration
                self.graph_runtime_state.total_tokens += graph_engine.graph_runtime_state.total_tokens
                iter_run_map[str(index)] = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()

            yield IterationSucceededEvent(
                start_at=started_at,
                inputs=inputs,
                outputs={"output": outputs},
                steps=len(iterator_list_value),
                metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens},
            )

            # Yield final success event
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    outputs={"output": outputs},
                    metadata={
                        WorkflowNodeExecutionMetadataKey.ITERATION_DURATION_MAP: iter_run_map,
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens,
                    },
                )
            )
        except IterationNodeError as e:
            yield IterationFailedEvent(
                start_at=started_at,
                inputs=inputs,
                outputs={"output": outputs},
                steps=len(iterator_list_value),
                metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens},
                error=str(e),
            )
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                )
            )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = IterationNodeData.model_validate(node_data)

        variable_mapping: dict[str, Sequence[str]] = {
            f"{node_id}.input_selector": typed_node_data.iterator_selector,
        }

        # init graph
        # Note: This is a classmethod without access to instance attributes
        # We'll skip node factory for now since this appears to be for static analysis
        # TODO: Refactor to properly handle node factory in classmethods
        iteration_graph = Graph.init(
            graph_config=graph_config,
            node_factory=None,  # type: ignore[arg-type]
            root_node_id=typed_node_data.start_node_id,
        )

        if not iteration_graph:
            raise IterationGraphNotFoundError("iteration graph not found")

        # Get node configs from graph_config instead of non-existent node_id_config_mapping
        node_configs = {node["id"]: node for node in graph_config.get("nodes", []) if "id" in node}
        for sub_node_id, sub_node_config in node_configs.items():
            if sub_node_config.get("data", {}).get("iteration_id") != node_id:
                continue

            # variable selector to variable mapping
            try:
                # Get node class
                from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING

                node_type = NodeType(sub_node_config.get("data", {}).get("type"))
                if node_type not in NODE_TYPE_CLASSES_MAPPING:
                    continue
                node_version = sub_node_config.get("data", {}).get("version", "1")
                node_cls = NODE_TYPE_CLASSES_MAPPING[node_type][node_version]

                sub_node_variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                    graph_config=graph_config, config=sub_node_config
                )
                sub_node_variable_mapping = cast(dict[str, Sequence[str]], sub_node_variable_mapping)
            except NotImplementedError:
                sub_node_variable_mapping = {}

            # remove iteration variables
            sub_node_variable_mapping = {
                sub_node_id + "." + key: value
                for key, value in sub_node_variable_mapping.items()
                if value[0] != node_id
            }

            variable_mapping.update(sub_node_variable_mapping)

        # remove variable out from iteration
        variable_mapping = {
            key: value for key, value in variable_mapping.items() if value[0] not in iteration_graph.node_ids
        }

        return variable_mapping

    def _append_iteration_info_to_event(
        self,
        event: GraphNodeEventBase,
        iter_run_index: int,
    ):
        event.in_iteration_id = self._node_id
        iter_metadata = {
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: self._node_id,
            WorkflowNodeExecutionMetadataKey.ITERATION_INDEX: iter_run_index,
        }

        current_metadata = event.node_run_result.metadata
        if WorkflowNodeExecutionMetadataKey.ITERATION_ID not in current_metadata:
            event.node_run_result.metadata = {**current_metadata, **iter_metadata}

    def _run_single_iter(
        self,
        *,
        variable_pool: VariablePool,
        outputs: list,
        graph_engine: "GraphEngine",
    ) -> Generator[Union[GraphNodeEventBase, StreamCompletedEvent], None, None]:
        rst = graph_engine.run()
        # get current iteration index
        index_variable = variable_pool.get([self._node_id, "index"])
        if not isinstance(index_variable, IntegerVariable):
            raise IterationIndexNotFoundError(f"iteration {self._node_id} current index not found")
        current_index = index_variable.value
        for event in rst:
            if isinstance(event, GraphNodeEventBase) and event.node_type == NodeType.ITERATION_START:
                continue

            if isinstance(event, GraphNodeEventBase):
                self._append_iteration_info_to_event(event=event, iter_run_index=current_index)
                yield event
            elif isinstance(event, GraphRunSucceededEvent):
                result = variable_pool.get(self._node_data.output_selector)
                if result is None:
                    outputs.append(None)
                else:
                    outputs.append(result.to_object())
                return
            elif isinstance(event, GraphRunFailedEvent):
                match self._node_data.error_handle_mode:
                    case ErrorHandleMode.TERMINATED:
                        raise IterationNodeError(event.error)
                    case ErrorHandleMode.CONTINUE_ON_ERROR:
                        outputs.append(None)
                        return
                    case ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
                        return

    def _create_graph_engine(self, index: int, item: Any):
        # Import dependencies
        from core.workflow.entities import GraphInitParams, GraphRuntimeState
        from core.workflow.graph_engine import GraphEngine
        from core.workflow.nodes.node_factory import DifyNodeFactory

        # Create GraphInitParams from node attributes
        graph_init_params = GraphInitParams(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_id=self.workflow_id,
            graph_config=self.graph_config,
            user_id=self.user_id,
            user_from=self.user_from.value,
            invoke_from=self.invoke_from.value,
            call_depth=self.workflow_call_depth,
        )
        # Create a deep copy of the variable pool for each iteration
        variable_pool_copy = self.graph_runtime_state.variable_pool.model_copy(deep=True)

        # append iteration variable (item, index) to variable pool
        variable_pool_copy.add([self._node_id, "index"], index)
        variable_pool_copy.add([self._node_id, "item"], item)

        # Create a new GraphRuntimeState for this iteration
        graph_runtime_state_copy = GraphRuntimeState(
            variable_pool=variable_pool_copy,
            start_at=self.graph_runtime_state.start_at,
            total_tokens=0,
            node_run_steps=0,
        )

        # Create a new node factory with the new GraphRuntimeState
        node_factory = DifyNodeFactory(
            graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state_copy
        )

        # Initialize the iteration graph with the new node factory
        iteration_graph = Graph.init(
            graph_config=self.graph_config, node_factory=node_factory, root_node_id=self._node_data.start_node_id
        )

        if not iteration_graph:
            raise IterationGraphNotFoundError("iteration graph not found")

        # Create a new GraphEngine for this iteration
        graph_engine = GraphEngine(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_id=self.workflow_id,
            user_id=self.user_id,
            user_from=self.user_from,
            invoke_from=self.invoke_from,
            call_depth=self.workflow_call_depth,
            graph=iteration_graph,
            graph_config=self.graph_config,
            graph_runtime_state=graph_runtime_state_copy,
            max_execution_steps=10000,  # Use default or config value
            max_execution_time=600,  # Use default or config value
        )

        return graph_engine
