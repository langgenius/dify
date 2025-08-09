import contextvars
import logging
import uuid
from collections.abc import Generator, Mapping, Sequence
from datetime import UTC, datetime
from queue import Queue
from typing import TYPE_CHECKING, Any, Optional, Union, cast

from flask import Flask

from core.variables import ArrayVariable, IntegerVariable, NoneVariable
from core.variables.segments import ArrayAnySegment, ArraySegment
from core.workflow.entities import VariablePool
from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.events import (
    BaseGraphEvent,
    GraphBaseNodeEvent,
    GraphRunFailedEvent,
    IterationRunFailedEvent,
    IterationRunNextEvent,
    IterationRunStartedEvent,
    NodeInIterationFailedEvent,
    NodeRunCompletedEvent,
    NodeRunFailedEvent,
    NodeRunResult,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph import BaseNodeData, Graph, Node, RetryConfig
from core.workflow.nodes.iteration.entities import ErrorHandleMode, IterationNodeData
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import preserve_flask_contexts

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
            yield NodeRunCompletedEvent(
                run_result=NodeRunResult(
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

        graph_config = self.graph_config
        if not self._node_data.start_node_id:
            raise StartNodeIdNotFoundError(f"field start_node_id in iteration {self.node_id} not found")

        root_node_id = self._node_data.start_node_id

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

        outputs = [None] * len(iterator_list_value)
        iter_run_map: dict[str, float] = {}
        start_at = naive_utc_now()

        yield IterationRunStartedEvent(
            id=self.id,
            node_id=self.node_id,
            node_type=self.node_type,
            iteration_node_data=self._node_data,
            start_at=start_at,
            inputs=inputs,
            metadata={"iteration_length": len(iterator_list_value)},
        )

        for index, item in enumerate(iterator_list_value):
            yield IterationRunNextEvent(
                id=self.id,
                node_id=self.node_id,
                node_type=self.node_type,
                iteration_node_data=self._node_data,
                index=index,
            )

            # Create a deep copy of the variable pool for each iteration
            variable_pool_copy = self.graph_runtime_state.variable_pool.model_copy(deep=True)

            # append iteration variable (item, index) to variable pool
            variable_pool_copy.add([self.node_id, "index"], index)
            variable_pool_copy.add([self.node_id, "item"], item)

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
                graph_config=graph_config, node_factory=node_factory, root_node_id=root_node_id
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
                graph_config=graph_config,
                graph_runtime_state=graph_runtime_state_copy,
                max_execution_steps=10000,  # Use default or config value
                max_execution_time=600,  # Use default or config value
            )

            # Run the iteration
            yield from self._run_single_iter(
                iterator_list_value=iterator_list_value,
                variable_pool=variable_pool_copy,
                inputs=inputs,
                outputs=outputs,
                start_at=start_at,
                graph_engine=graph_engine,
                iteration_graph=iteration_graph,
                iter_run_map=iter_run_map,
                parallel_mode_run_id=None,
            )

            # Update the total tokens from this iteration
            self.graph_runtime_state.total_tokens += graph_runtime_state_copy.total_tokens

        # Yield final success event
        yield NodeRunCompletedEvent(
            run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"output": outputs},
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

    def _handle_event_metadata(
        self,
        *,
        event: GraphBaseNodeEvent,
        iter_run_index: int,
        parallel_mode_run_id: str | None,
    ) -> GraphBaseNodeEvent:
        if self._node_data.is_parallel and isinstance(event, NodeRunStartedEvent):
            event.parallel_mode_run_id = parallel_mode_run_id

        iter_metadata = {
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: self.node_id,
            WorkflowNodeExecutionMetadataKey.ITERATION_INDEX: iter_run_index,
        }
        if parallel_mode_run_id:
            # for parallel, the specific branch ID is more important than the sequential index
            iter_metadata[WorkflowNodeExecutionMetadataKey.PARALLEL_MODE_RUN_ID] = parallel_mode_run_id

        current_metadata = event.node_run_result.metadata
        if WorkflowNodeExecutionMetadataKey.ITERATION_ID not in current_metadata:
            event.node_run_result.metadata = {**current_metadata, **iter_metadata}

        return event

    def _run_single_iter(
        self,
        *,
        iterator_list_value: Sequence[str],
        variable_pool: VariablePool,
        inputs: Mapping[str, list],
        outputs: list,
        start_at: datetime,
        graph_engine: "GraphEngine",
        iteration_graph: Graph,
        iter_run_map: dict[str, float],
        parallel_mode_run_id: Optional[str] = None,
    ) -> Generator[Union[GraphBaseNodeEvent, NodeRunCompletedEvent], None, None]:
        """
        run single iteration
        """
        iter_start_at = datetime.now(UTC).replace(tzinfo=None)

        try:
            rst = graph_engine.run()
            # get current iteration index
            index_variable = variable_pool.get([self.node_id, "index"])
            if not isinstance(index_variable, IntegerVariable):
                raise IterationIndexNotFoundError(f"iteration {self.node_id} current index not found")
            current_index = index_variable.value
            iteration_run_id = parallel_mode_run_id if parallel_mode_run_id is not None else f"{current_index}"
            next_index = int(current_index) + 1
            for event in rst:
                if isinstance(event, GraphBaseNodeEvent) and not event.in_iteration_id:
                    event.in_iteration_id = self.node_id

                if isinstance(event, GraphBaseNodeEvent) and event.node_type == NodeType.ITERATION_START:
                    continue

                if isinstance(event, NodeRunSucceededEvent):
                    yield self._handle_event_metadata(
                        event=event, iter_run_index=current_index, parallel_mode_run_id=parallel_mode_run_id
                    )
                elif isinstance(event, BaseGraphEvent):
                    if isinstance(event, GraphRunFailedEvent):
                        # iteration run failed
                        if self._node_data.is_parallel:
                            yield IterationRunFailedEvent(
                                id=self.id,
                                node_id=self.node_id,
                                node_type=self.node_type,
                                iteration_node_data=self._node_data,
                                parallel_mode_run_id=parallel_mode_run_id,
                                start_at=start_at,
                                inputs=inputs,
                                outputs={"output": outputs},
                                steps=len(iterator_list_value),
                                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                                error=event.error,
                            )
                        else:
                            yield IterationRunFailedEvent(
                                id=self.id,
                                node_id=self.node_id,
                                node_type=self.node_type,
                                iteration_node_data=self._node_data,
                                start_at=start_at,
                                inputs=inputs,
                                outputs={"output": outputs},
                                steps=len(iterator_list_value),
                                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                                error=event.error,
                            )
                        yield NodeRunCompletedEvent(
                            run_result=NodeRunResult(
                                status=WorkflowNodeExecutionStatus.FAILED,
                                error=event.error,
                            )
                        )
                        return
                elif isinstance(event, GraphBaseNodeEvent):
                    metadata_event = self._handle_event_metadata(
                        event=event, iter_run_index=current_index, parallel_mode_run_id=parallel_mode_run_id
                    )
                    if isinstance(event, NodeRunFailedEvent):
                        if self._node_data.error_handle_mode == ErrorHandleMode.CONTINUE_ON_ERROR:
                            yield NodeInIterationFailedEvent(
                                **metadata_event.model_dump(),
                            )
                            outputs[current_index] = None
                            variable_pool.add([self.node_id, "index"], next_index)
                            if next_index < len(iterator_list_value):
                                variable_pool.add([self.node_id, "item"], iterator_list_value[next_index])
                            duration = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()
                            iter_run_map[iteration_run_id] = duration
                            yield IterationRunNextEvent(
                                id=self.id,
                                node_id=self.node_id,
                                node_type=self.node_type,
                                iteration_node_data=self._node_data,
                                index=next_index,
                                parallel_mode_run_id=parallel_mode_run_id,
                                pre_iteration_output=None,
                                duration=duration,
                            )
                            return
                        elif self._node_data.error_handle_mode == ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
                            yield NodeInIterationFailedEvent(
                                **metadata_event.model_dump(),
                            )
                            variable_pool.add([self.node_id, "index"], next_index)

                            if next_index < len(iterator_list_value):
                                variable_pool.add([self.node_id, "item"], iterator_list_value[next_index])
                            duration = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()
                            iter_run_map[iteration_run_id] = duration
                            yield IterationRunNextEvent(
                                id=self.id,
                                node_id=self.node_id,
                                node_type=self.node_type,
                                iteration_node_data=self._node_data,
                                index=next_index,
                                parallel_mode_run_id=parallel_mode_run_id,
                                pre_iteration_output=None,
                                duration=duration,
                            )
                            return
                        elif self._node_data.error_handle_mode == ErrorHandleMode.TERMINATED:
                            yield NodeInIterationFailedEvent(
                                **metadata_event.model_dump(),
                            )
                            outputs[current_index] = None

                            # clean nodes resources
                            for node_id in iteration_graph.node_ids:
                                variable_pool.remove([node_id])

                            # iteration run failed
                            if self._node_data.is_parallel:
                                yield IterationRunFailedEvent(
                                    id=self.id,
                                    node_id=self.node_id,
                                    node_type=self.node_type,
                                    iteration_node_data=self._node_data,
                                    parallel_mode_run_id=parallel_mode_run_id,
                                    start_at=start_at,
                                    inputs=inputs,
                                    outputs={"output": outputs},
                                    steps=len(iterator_list_value),
                                    metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                                    error=event.error,
                                )
                            else:
                                yield IterationRunFailedEvent(
                                    id=self.id,
                                    node_id=self.node_id,
                                    node_type=self.node_type,
                                    iteration_node_data=self._node_data,
                                    start_at=start_at,
                                    inputs=inputs,
                                    outputs={"output": outputs},
                                    steps=len(iterator_list_value),
                                    metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                                    error=event.error,
                                )

                            # stop the iterator
                            yield NodeRunCompletedEvent(
                                run_result=NodeRunResult(
                                    status=WorkflowNodeExecutionStatus.FAILED,
                                    error=event.error,
                                )
                            )
                            return
                    yield metadata_event

            current_output_segment = variable_pool.get(self._node_data.output_selector)
            if current_output_segment is None:
                raise IterationNodeError("iteration output selector not found")
            current_iteration_output = current_output_segment.value
            outputs[current_index] = current_iteration_output
            # remove all nodes outputs from variable pool
            for node_id in iteration_graph.node_ids:
                variable_pool.remove([node_id])

            # move to next iteration
            variable_pool.add([self.node_id, "index"], next_index)

            if next_index < len(iterator_list_value):
                variable_pool.add([self.node_id, "item"], iterator_list_value[next_index])
            duration = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()
            iter_run_map[iteration_run_id] = duration
            yield IterationRunNextEvent(
                id=self.id,
                node_id=self.node_id,
                node_type=self.node_type,
                iteration_node_data=self._node_data,
                index=next_index,
                parallel_mode_run_id=parallel_mode_run_id,
                pre_iteration_output=current_iteration_output or None,
                duration=duration,
            )

        except IterationNodeError as e:
            logger.warning("Iteration run failed:%s", str(e))
            yield IterationRunFailedEvent(
                id=self.id,
                node_id=self.node_id,
                node_type=self.node_type,
                iteration_node_data=self._node_data,
                start_at=start_at,
                inputs=inputs,
                outputs={"output": None},
                steps=len(iterator_list_value),
                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                error=str(e),
            )
            yield NodeRunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                )
            )

    def _run_single_iter_parallel(
        self,
        *,
        flask_app: Flask,
        context: contextvars.Context,
        q: Queue,
        iterator_list_value: Sequence[str],
        inputs: Mapping[str, list],
        outputs: list,
        start_at: datetime,
        graph_engine: "GraphEngine",
        iteration_graph: Graph,
        index: int,
        item: Any,
        iter_run_map: dict[str, float],
    ):
        """
        run single iteration in parallel mode
        """

        with preserve_flask_contexts(flask_app, context_vars=context):
            parallel_mode_run_id = uuid.uuid4().hex

            # Create a copy of the variable pool for parallel execution
            from core.workflow.entities import GraphRuntimeState
            from core.workflow.graph_engine import GraphEngine

            # Create a deep copy of the variable pool
            variable_pool_copy = graph_engine.graph_runtime_state.variable_pool.model_copy(deep=True)
            variable_pool_copy.add([self.node_id, "index"], index)
            variable_pool_copy.add([self.node_id, "item"], item)

            # Create a new GraphRuntimeState with the copied variable pool
            graph_runtime_state_copy = GraphRuntimeState(
                variable_pool=variable_pool_copy, start_at=graph_engine.graph_runtime_state.start_at
            )

            # Create a new graph engine instance for parallel execution
            graph_engine_copy = GraphEngine(
                tenant_id=graph_engine.tenant_id,
                app_id=graph_engine.app_id,
                workflow_id=graph_engine.workflow_id,
                user_id=graph_engine.user_id,
                user_from=graph_engine.user_from,
                invoke_from=graph_engine.invoke_from,
                call_depth=graph_engine.call_depth,
                graph=iteration_graph,
                graph_config=graph_engine.graph_config,
                graph_runtime_state=graph_runtime_state_copy,
                max_execution_steps=graph_engine.max_execution_steps,
                max_execution_time=graph_engine.max_execution_time,
            )
            for event in self._run_single_iter(
                iterator_list_value=iterator_list_value,
                variable_pool=variable_pool_copy,
                inputs=inputs,
                outputs=outputs,
                start_at=start_at,
                graph_engine=graph_engine_copy,
                iteration_graph=iteration_graph,
                iter_run_map=iter_run_map,
                parallel_mode_run_id=parallel_mode_run_id,
            ):
                q.put(event)
            graph_engine.graph_runtime_state.total_tokens += graph_engine_copy.graph_runtime_state.total_tokens
