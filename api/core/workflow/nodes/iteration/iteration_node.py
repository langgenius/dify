import logging
from collections.abc import Generator, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, NewType, cast

from typing_extensions import TypeIs

from core.variables import IntegerVariable, NoneSegment
from core.variables.segments import ArrayAnySegment, ArraySegment
from core.workflow.entities import VariablePool
from core.workflow.enums import (
    ErrorStrategy,
    NodeExecutionType,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.graph_events import (
    GraphNodeEventBase,
    GraphRunFailedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.node_events import (
    IterationFailedEvent,
    IterationNextEvent,
    IterationStartedEvent,
    IterationSucceededEvent,
    NodeEventBase,
    NodeRunResult,
    StreamCompletedEvent,
)
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
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

EmptyArraySegment = NewType("EmptyArraySegment", ArraySegment)


class IterationNode(Node):
    """
    Iteration Node.
    """

    node_type = NodeType.ITERATION
    execution_type = NodeExecutionType.CONTAINER
    _node_data: IterationNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = IterationNodeData.model_validate(data)

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
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

    def _run(self) -> Generator[GraphNodeEventBase | NodeEventBase, None, None]:  # type: ignore
        variable = self._get_iterator_variable()

        if self._is_empty_iteration(variable):
            yield from self._handle_empty_iteration(variable)
            return

        iterator_list_value = self._validate_and_get_iterator_list(variable)
        inputs = {"iterator_selector": iterator_list_value}

        self._validate_start_node()

        started_at = naive_utc_now()
        iter_run_map: dict[str, float] = {}
        outputs: list[object] = []

        yield IterationStartedEvent(
            start_at=started_at,
            inputs=inputs,
            metadata={"iteration_length": len(iterator_list_value)},
        )

        try:
            yield from self._execute_iterations(
                iterator_list_value=iterator_list_value,
                outputs=outputs,
                iter_run_map=iter_run_map,
            )

            yield from self._handle_iteration_success(
                started_at=started_at,
                inputs=inputs,
                outputs=outputs,
                iterator_list_value=iterator_list_value,
                iter_run_map=iter_run_map,
            )
        except IterationNodeError as e:
            yield from self._handle_iteration_failure(
                started_at=started_at,
                inputs=inputs,
                outputs=outputs,
                iterator_list_value=iterator_list_value,
                iter_run_map=iter_run_map,
                error=e,
            )

    def _get_iterator_variable(self) -> ArraySegment | NoneSegment:
        variable = self.graph_runtime_state.variable_pool.get(self._node_data.iterator_selector)

        if not variable:
            raise IteratorVariableNotFoundError(f"iterator variable {self._node_data.iterator_selector} not found")

        if not isinstance(variable, ArraySegment) and not isinstance(variable, NoneSegment):
            raise InvalidIteratorValueError(f"invalid iterator value: {variable}, please provide a list.")

        return variable

    def _is_empty_iteration(self, variable: ArraySegment | NoneSegment) -> TypeIs[NoneSegment | EmptyArraySegment]:
        return isinstance(variable, NoneSegment) or len(variable.value) == 0

    def _handle_empty_iteration(self, variable: ArraySegment | NoneSegment) -> Generator[NodeEventBase, None, None]:
        # Try our best to preserve the type information.
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

    def _validate_and_get_iterator_list(self, variable: ArraySegment) -> Sequence[object]:
        iterator_list_value = variable.to_object()

        if not isinstance(iterator_list_value, list):
            raise InvalidIteratorValueError(f"Invalid iterator value: {iterator_list_value}, please provide a list.")

        return cast(list[object], iterator_list_value)

    def _validate_start_node(self) -> None:
        if not self._node_data.start_node_id:
            raise StartNodeIdNotFoundError(f"field start_node_id in iteration {self._node_id} not found")

    def _execute_iterations(
        self,
        iterator_list_value: Sequence[object],
        outputs: list[object],
        iter_run_map: dict[str, float],
    ) -> Generator[GraphNodeEventBase | NodeEventBase, None, None]:
        if self._node_data.is_parallel:
            # Parallel mode execution
            yield from self._execute_parallel_iterations(
                iterator_list_value=iterator_list_value,
                outputs=outputs,
                iter_run_map=iter_run_map,
            )
        else:
            # Sequential mode execution
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

    def _execute_parallel_iterations(
        self,
        iterator_list_value: Sequence[object],
        outputs: list[object],
        iter_run_map: dict[str, float],
    ) -> Generator[GraphNodeEventBase | NodeEventBase, None, None]:
        # Initialize outputs list with None values to maintain order
        outputs.extend([None] * len(iterator_list_value))

        # Determine the number of parallel workers
        max_workers = min(self._node_data.parallel_nums, len(iterator_list_value))

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all iteration tasks
            future_to_index: dict[Future[tuple[datetime, list[GraphNodeEventBase], object | None, int]], int] = {}
            for index, item in enumerate(iterator_list_value):
                yield IterationNextEvent(index=index)
                future = executor.submit(
                    self._execute_single_iteration_parallel,
                    index=index,
                    item=item,
                )
                future_to_index[future] = index

            # Process completed iterations as they finish
            for future in as_completed(future_to_index):
                index = future_to_index[future]
                try:
                    result = future.result()
                    iter_start_at, events, output_value, tokens_used = result

                    # Update outputs at the correct index
                    outputs[index] = output_value

                    # Yield all events from this iteration
                    yield from events

                    # Update tokens and timing
                    self.graph_runtime_state.total_tokens += tokens_used
                    iter_run_map[str(index)] = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()

                except Exception as e:
                    # Handle errors based on error_handle_mode
                    match self._node_data.error_handle_mode:
                        case ErrorHandleMode.TERMINATED:
                            # Cancel remaining futures and re-raise
                            for f in future_to_index:
                                if f != future:
                                    f.cancel()
                            raise IterationNodeError(str(e))
                        case ErrorHandleMode.CONTINUE_ON_ERROR:
                            outputs[index] = None
                        case ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
                            outputs[index] = None  # Will be filtered later

        # Remove None values if in REMOVE_ABNORMAL_OUTPUT mode
        if self._node_data.error_handle_mode == ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
            outputs[:] = [output for output in outputs if output is not None]

    def _execute_single_iteration_parallel(
        self,
        index: int,
        item: object,
    ) -> tuple[datetime, list[GraphNodeEventBase], object | None, int]:
        """Execute a single iteration in parallel mode and return results."""
        iter_start_at = datetime.now(UTC).replace(tzinfo=None)
        events: list[GraphNodeEventBase] = []
        outputs_temp: list[object] = []

        graph_engine = self._create_graph_engine(index, item)

        # Collect events instead of yielding them directly
        for event in self._run_single_iter(
            variable_pool=graph_engine.graph_runtime_state.variable_pool,
            outputs=outputs_temp,
            graph_engine=graph_engine,
        ):
            events.append(event)

        # Get the output value from the temporary outputs list
        output_value = outputs_temp[0] if outputs_temp else None

        return iter_start_at, events, output_value, graph_engine.graph_runtime_state.total_tokens

    def _handle_iteration_success(
        self,
        started_at: datetime,
        inputs: dict[str, Sequence[object]],
        outputs: list[object],
        iterator_list_value: Sequence[object],
        iter_run_map: dict[str, float],
    ) -> Generator[NodeEventBase, None, None]:
        yield IterationSucceededEvent(
            start_at=started_at,
            inputs=inputs,
            outputs={"output": outputs},
            steps=len(iterator_list_value),
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens,
                WorkflowNodeExecutionMetadataKey.ITERATION_DURATION_MAP: iter_run_map,
            },
        )

        # Yield final success event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"output": outputs},
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens,
                },
            )
        )

    def _handle_iteration_failure(
        self,
        started_at: datetime,
        inputs: dict[str, Sequence[object]],
        outputs: list[object],
        iterator_list_value: Sequence[object],
        iter_run_map: dict[str, float],
        error: IterationNodeError,
    ) -> Generator[NodeEventBase, None, None]:
        yield IterationFailedEvent(
            start_at=started_at,
            inputs=inputs,
            outputs={"output": outputs},
            steps=len(iterator_list_value),
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens,
                WorkflowNodeExecutionMetadataKey.ITERATION_DURATION_MAP: iter_run_map,
            },
            error=str(error),
        )
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(error),
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
        from core.workflow.entities import GraphInitParams, GraphRuntimeState
        from core.workflow.graph import Graph
        from core.workflow.nodes.node_factory import DifyNodeFactory

        # Create minimal GraphInitParams for static analysis
        graph_init_params = GraphInitParams(
            tenant_id="",
            app_id="",
            workflow_id="",
            graph_config=graph_config,
            user_id="",
            user_from="",
            invoke_from="",
            call_depth=0,
        )

        # Create minimal GraphRuntimeState for static analysis
        from core.workflow.entities import VariablePool

        graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(),
            start_at=0,
        )

        # Create node factory for static analysis
        node_factory = DifyNodeFactory(graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state)

        iteration_graph = Graph.init(
            graph_config=graph_config,
            node_factory=node_factory,
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
        outputs: list[object],
        graph_engine: "GraphEngine",
    ) -> Generator[GraphNodeEventBase, None, None]:
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

    def _create_graph_engine(self, index: int, item: object):
        # Import dependencies
        from core.workflow.entities import GraphInitParams, GraphRuntimeState
        from core.workflow.graph import Graph
        from core.workflow.graph_engine import GraphEngine
        from core.workflow.graph_engine.command_channels import InMemoryChannel
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
            workflow_id=self.workflow_id,
            graph=iteration_graph,
            graph_runtime_state=graph_runtime_state_copy,
            command_channel=InMemoryChannel(),  # Use InMemoryChannel for sub-graphs
        )

        return graph_engine
