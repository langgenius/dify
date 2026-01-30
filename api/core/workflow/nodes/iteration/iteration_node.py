import logging
from collections.abc import Generator, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, NewType, cast

from typing_extensions import TypeIs

from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables import IntegerVariable, NoneSegment
from core.variables.segments import ArrayAnySegment, ArraySegment
from core.variables.variables import Variable
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.enums import (
    NodeExecutionType,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.graph_events import (
    GraphNodeEventBase,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
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
from core.workflow.nodes.base import LLMUsageTrackingMixin
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.iteration.entities import ErrorHandleMode, IterationNodeData
from core.workflow.runtime import VariablePool
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
    from core.workflow.context import IExecutionContext
    from core.workflow.graph_engine import GraphEngine

logger = logging.getLogger(__name__)

EmptyArraySegment = NewType("EmptyArraySegment", ArraySegment)


class IterationNode(LLMUsageTrackingMixin, Node[IterationNodeData]):
    """
    Iteration Node.
    """

    node_type = NodeType.ITERATION
    execution_type = NodeExecutionType.CONTAINER

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        return {
            "type": "iteration",
            "config": {
                "is_parallel": False,
                "parallel_nums": 10,
                "error_handle_mode": ErrorHandleMode.TERMINATED,
                "flatten_output": True,
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
        usage_accumulator = [LLMUsage.empty_usage()]

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
                usage_accumulator=usage_accumulator,
            )

            self._accumulate_usage(usage_accumulator[0])
            yield from self._handle_iteration_success(
                started_at=started_at,
                inputs=inputs,
                outputs=outputs,
                iterator_list_value=iterator_list_value,
                iter_run_map=iter_run_map,
                usage=usage_accumulator[0],
            )
        except IterationNodeError as e:
            self._accumulate_usage(usage_accumulator[0])
            yield from self._handle_iteration_failure(
                started_at=started_at,
                inputs=inputs,
                outputs=outputs,
                iterator_list_value=iterator_list_value,
                iter_run_map=iter_run_map,
                usage=usage_accumulator[0],
                error=e,
            )

    def _get_iterator_variable(self) -> ArraySegment | NoneSegment:
        variable = self.graph_runtime_state.variable_pool.get(self.node_data.iterator_selector)

        if not variable:
            raise IteratorVariableNotFoundError(f"iterator variable {self.node_data.iterator_selector} not found")

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
        if not self.node_data.start_node_id:
            raise StartNodeIdNotFoundError(f"field start_node_id in iteration {self._node_id} not found")

    def _execute_iterations(
        self,
        iterator_list_value: Sequence[object],
        outputs: list[object],
        iter_run_map: dict[str, float],
        usage_accumulator: list[LLMUsage],
    ) -> Generator[GraphNodeEventBase | NodeEventBase, None, None]:
        if self.node_data.is_parallel:
            # Parallel mode execution
            yield from self._execute_parallel_iterations(
                iterator_list_value=iterator_list_value,
                outputs=outputs,
                iter_run_map=iter_run_map,
                usage_accumulator=usage_accumulator,
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

                # Sync conversation variables after each iteration completes
                self._sync_conversation_variables_from_snapshot(
                    self._extract_conversation_variable_snapshot(
                        variable_pool=graph_engine.graph_runtime_state.variable_pool
                    )
                )

                # Accumulate usage from this iteration
                usage_accumulator[0] = self._merge_usage(
                    usage_accumulator[0], graph_engine.graph_runtime_state.llm_usage
                )
                iter_run_map[str(index)] = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()

    def _execute_parallel_iterations(
        self,
        iterator_list_value: Sequence[object],
        outputs: list[object],
        iter_run_map: dict[str, float],
        usage_accumulator: list[LLMUsage],
    ) -> Generator[GraphNodeEventBase | NodeEventBase, None, None]:
        # Initialize outputs list with None values to maintain order
        outputs.extend([None] * len(iterator_list_value))

        # Determine the number of parallel workers
        max_workers = min(self.node_data.parallel_nums, len(iterator_list_value))

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all iteration tasks
            future_to_index: dict[
                Future[
                    tuple[
                        datetime,
                        list[GraphNodeEventBase],
                        object | None,
                        dict[str, Variable],
                        LLMUsage,
                    ]
                ],
                int,
            ] = {}
            for index, item in enumerate(iterator_list_value):
                yield IterationNextEvent(index=index)
                future = executor.submit(
                    self._execute_single_iteration_parallel,
                    index=index,
                    item=item,
                    execution_context=self._capture_execution_context(),
                )
                future_to_index[future] = index

            # Process completed iterations as they finish
            for future in as_completed(future_to_index):
                index = future_to_index[future]
                try:
                    result = future.result()
                    (
                        iter_start_at,
                        events,
                        output_value,
                        conversation_snapshot,
                        iteration_usage,
                    ) = result

                    # Update outputs at the correct index
                    outputs[index] = output_value

                    # Yield all events from this iteration
                    yield from events

                    # Update tokens and timing
                    iter_run_map[str(index)] = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()

                    usage_accumulator[0] = self._merge_usage(usage_accumulator[0], iteration_usage)

                    # Sync conversation variables after iteration completion
                    self._sync_conversation_variables_from_snapshot(conversation_snapshot)

                except Exception as e:
                    # Handle errors based on error_handle_mode
                    match self.node_data.error_handle_mode:
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
        if self.node_data.error_handle_mode == ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
            outputs[:] = [output for output in outputs if output is not None]

    def _execute_single_iteration_parallel(
        self,
        index: int,
        item: object,
        execution_context: "IExecutionContext",
    ) -> tuple[datetime, list[GraphNodeEventBase], object | None, dict[str, Variable], LLMUsage]:
        """Execute a single iteration in parallel mode and return results."""
        with execution_context:
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
            conversation_snapshot = self._extract_conversation_variable_snapshot(
                variable_pool=graph_engine.graph_runtime_state.variable_pool
            )

            return (
                iter_start_at,
                events,
                output_value,
                conversation_snapshot,
                graph_engine.graph_runtime_state.llm_usage,
            )

    def _capture_execution_context(self) -> "IExecutionContext":
        """Capture current execution context for parallel iterations."""
        from core.workflow.context import capture_current_context

        return capture_current_context()

    def _handle_iteration_success(
        self,
        started_at: datetime,
        inputs: dict[str, Sequence[object]],
        outputs: list[object],
        iterator_list_value: Sequence[object],
        iter_run_map: dict[str, float],
        *,
        usage: LLMUsage,
    ) -> Generator[NodeEventBase, None, None]:
        # Flatten the list of lists if all outputs are lists
        flattened_outputs = self._flatten_outputs_if_needed(outputs)

        yield IterationSucceededEvent(
            start_at=started_at,
            inputs=inputs,
            outputs={"output": flattened_outputs},
            steps=len(iterator_list_value),
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                WorkflowNodeExecutionMetadataKey.ITERATION_DURATION_MAP: iter_run_map,
            },
        )

        # Yield final success event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"output": flattened_outputs},
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                },
                llm_usage=usage,
            )
        )

    def _flatten_outputs_if_needed(self, outputs: list[object]) -> list[object]:
        """
        Flatten the outputs list if all elements are lists.
        This maintains backward compatibility with version 1.8.1 behavior.

        If flatten_output is False, returns outputs as-is (nested structure).
        If flatten_output is True (default), flattens the list if all elements are lists.
        """
        # If flatten_output is disabled, return outputs as-is
        if not self.node_data.flatten_output:
            return outputs

        if not outputs:
            return outputs

        # Check if all non-None outputs are lists
        non_none_outputs = [output for output in outputs if output is not None]
        if not non_none_outputs:
            return outputs

        if all(isinstance(output, list) for output in non_none_outputs):
            # Flatten the list of lists
            flattened: list[Any] = []
            for output in outputs:
                if isinstance(output, list):
                    flattened.extend(output)
                elif output is not None:
                    # This shouldn't happen based on our check, but handle it gracefully
                    flattened.append(output)
            return flattened

        return outputs

    def _handle_iteration_failure(
        self,
        started_at: datetime,
        inputs: dict[str, Sequence[object]],
        outputs: list[object],
        iterator_list_value: Sequence[object],
        iter_run_map: dict[str, float],
        *,
        usage: LLMUsage,
        error: IterationNodeError,
    ) -> Generator[NodeEventBase, None, None]:
        # Flatten the list of lists if all outputs are lists (even in failure case)
        flattened_outputs = self._flatten_outputs_if_needed(outputs)

        yield IterationFailedEvent(
            start_at=started_at,
            inputs=inputs,
            outputs={"output": flattened_outputs},
            steps=len(iterator_list_value),
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                WorkflowNodeExecutionMetadataKey.ITERATION_DURATION_MAP: iter_run_map,
            },
            error=str(error),
        )
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(error),
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                },
                llm_usage=usage,
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
        iteration_node_ids = set()

        # Find all nodes that belong to this loop
        nodes = graph_config.get("nodes", [])
        for node in nodes:
            node_data = node.get("data", {})
            if node_data.get("iteration_id") == node_id:
                in_iteration_node_id = node.get("id")
                if in_iteration_node_id:
                    iteration_node_ids.add(in_iteration_node_id)

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
        variable_mapping = {key: value for key, value in variable_mapping.items() if value[0] not in iteration_node_ids}

        return variable_mapping

    def _extract_conversation_variable_snapshot(self, *, variable_pool: VariablePool) -> dict[str, Variable]:
        conversation_variables = variable_pool.variable_dictionary.get(CONVERSATION_VARIABLE_NODE_ID, {})
        return {name: variable.model_copy(deep=True) for name, variable in conversation_variables.items()}

    def _sync_conversation_variables_from_snapshot(self, snapshot: dict[str, Variable]) -> None:
        parent_pool = self.graph_runtime_state.variable_pool
        parent_conversations = parent_pool.variable_dictionary.get(CONVERSATION_VARIABLE_NODE_ID, {})

        current_keys = set(parent_conversations.keys())
        snapshot_keys = set(snapshot.keys())

        for removed_key in current_keys - snapshot_keys:
            parent_pool.remove((CONVERSATION_VARIABLE_NODE_ID, removed_key))

        for name, variable in snapshot.items():
            parent_pool.add((CONVERSATION_VARIABLE_NODE_ID, name), variable)

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
            elif isinstance(event, (GraphRunSucceededEvent, GraphRunPartialSucceededEvent)):
                result = variable_pool.get(self.node_data.output_selector)
                if result is None:
                    outputs.append(None)
                else:
                    outputs.append(result.to_object())
                return
            elif isinstance(event, GraphRunFailedEvent):
                match self.node_data.error_handle_mode:
                    case ErrorHandleMode.TERMINATED:
                        raise IterationNodeError(event.error)
                    case ErrorHandleMode.CONTINUE_ON_ERROR:
                        outputs.append(None)
                        return
                    case ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
                        return

    def _create_graph_engine(self, index: int, item: object):
        # Import dependencies
        from core.app.workflow.node_factory import DifyNodeFactory
        from core.workflow.entities import GraphInitParams
        from core.workflow.graph import Graph
        from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
        from core.workflow.graph_engine.command_channels import InMemoryChannel
        from core.workflow.runtime import GraphRuntimeState

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
            graph_config=self.graph_config, node_factory=node_factory, root_node_id=self.node_data.start_node_id
        )

        if not iteration_graph:
            raise IterationGraphNotFoundError("iteration graph not found")

        # Create a new GraphEngine for this iteration
        graph_engine = GraphEngine(
            workflow_id=self.workflow_id,
            graph=iteration_graph,
            graph_runtime_state=graph_runtime_state_copy,
            command_channel=InMemoryChannel(),  # Use InMemoryChannel for sub-graphs
            config=GraphEngineConfig(),
        )

        return graph_engine
