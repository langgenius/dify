import logging
import uuid
from collections.abc import Generator, Mapping, Sequence
from concurrent.futures import Future, wait
from datetime import UTC, datetime
from queue import Empty, Queue
from typing import TYPE_CHECKING, Any, Optional, cast

from flask import Flask, current_app

from configs import dify_config
from core.variables import IntegerVariable
from core.workflow.entities.node_entities import (
    NodeRunMetadataKey,
    NodeRunResult,
)
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import (
    BaseGraphEvent,
    BaseNodeEvent,
    BaseParallelBranchEvent,
    GraphRunFailedEvent,
    InNodeEvent,
    IterationRunFailedEvent,
    IterationRunNextEvent,
    IterationRunStartedEvent,
    IterationRunSucceededEvent,
    NodeInIterationFailedEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event import NodeEvent, RunCompletedEvent
from core.workflow.nodes.iteration.entities import ErrorHandleMode, IterationNodeData
from models.workflow import WorkflowNodeExecutionStatus

from .exc import (
    InvalidIteratorValueError,
    IterationGraphNotFoundError,
    IterationIndexNotFoundError,
    IterationNodeError,
    IteratorVariableNotFoundError,
    StartNodeIdNotFoundError,
)

if TYPE_CHECKING:
    from core.workflow.graph_engine.graph_engine import GraphEngine
logger = logging.getLogger(__name__)


class IterationNode(BaseNode[IterationNodeData]):
    """
    Iteration Node.
    """

    _node_data_cls = IterationNodeData
    _node_type = NodeType.ITERATION

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

    def _run(self) -> Generator[NodeEvent | InNodeEvent, None, None]:
        """
        Run the node.
        """
        iterator_list_segment = self.graph_runtime_state.variable_pool.get(self.node_data.iterator_selector)

        if not iterator_list_segment:
            raise IteratorVariableNotFoundError(f"Iterator variable {self.node_data.iterator_selector} not found")

        if len(iterator_list_segment.value) == 0:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    outputs={"output": []},
                )
            )
            return

        iterator_list_value = iterator_list_segment.to_object()

        if not isinstance(iterator_list_value, list):
            raise InvalidIteratorValueError(f"Invalid iterator value: {iterator_list_value}, please provide a list.")

        inputs = {"iterator_selector": iterator_list_value}

        graph_config = self.graph_config

        if not self.node_data.start_node_id:
            raise StartNodeIdNotFoundError(f"field start_node_id in iteration {self.node_id} not found")

        root_node_id = self.node_data.start_node_id

        # init graph
        iteration_graph = Graph.init(graph_config=graph_config, root_node_id=root_node_id)

        if not iteration_graph:
            raise IterationGraphNotFoundError("iteration graph not found")

        variable_pool = self.graph_runtime_state.variable_pool

        # append iteration variable (item, index) to variable pool
        variable_pool.add([self.node_id, "index"], 0)
        variable_pool.add([self.node_id, "item"], iterator_list_value[0])

        # init graph engine
        from core.workflow.graph_engine.graph_engine import GraphEngine, GraphEngineThreadPool

        graph_engine = GraphEngine(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_type=self.workflow_type,
            workflow_id=self.workflow_id,
            user_id=self.user_id,
            user_from=self.user_from,
            invoke_from=self.invoke_from,
            call_depth=self.workflow_call_depth,
            graph=iteration_graph,
            graph_config=graph_config,
            variable_pool=variable_pool,
            max_execution_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME,
            thread_pool_id=self.thread_pool_id,
        )

        start_at = datetime.now(UTC).replace(tzinfo=None)

        yield IterationRunStartedEvent(
            iteration_id=self.id,
            iteration_node_id=self.node_id,
            iteration_node_type=self.node_type,
            iteration_node_data=self.node_data,
            start_at=start_at,
            inputs=inputs,
            metadata={"iterator_length": len(iterator_list_value)},
            predecessor_node_id=self.previous_node_id,
        )

        yield IterationRunNextEvent(
            iteration_id=self.id,
            iteration_node_id=self.node_id,
            iteration_node_type=self.node_type,
            iteration_node_data=self.node_data,
            index=0,
            pre_iteration_output=None,
            duration=None,
        )
        iter_run_map: dict[str, float] = {}
        outputs: list[Any] = [None] * len(iterator_list_value)
        try:
            if self.node_data.is_parallel:
                futures: list[Future] = []
                q: Queue = Queue()
                thread_pool = GraphEngineThreadPool(
                    max_workers=self.node_data.parallel_nums, max_submit_count=dify_config.MAX_SUBMIT_COUNT
                )
                for index, item in enumerate(iterator_list_value):
                    future: Future = thread_pool.submit(
                        self._run_single_iter_parallel,
                        flask_app=current_app._get_current_object(),  # type: ignore
                        q=q,
                        iterator_list_value=iterator_list_value,
                        inputs=inputs,
                        outputs=outputs,
                        start_at=start_at,
                        graph_engine=graph_engine,
                        iteration_graph=iteration_graph,
                        index=index,
                        item=item,
                        iter_run_map=iter_run_map,
                    )
                    future.add_done_callback(thread_pool.task_done_callback)
                    futures.append(future)
                succeeded_count = 0
                while True:
                    try:
                        event = q.get(timeout=1)
                        if event is None:
                            break
                        if isinstance(event, IterationRunNextEvent):
                            succeeded_count += 1
                            if succeeded_count == len(futures):
                                q.put(None)
                        yield event
                        if isinstance(event, RunCompletedEvent):
                            q.put(None)
                            for f in futures:
                                if not f.done():
                                    f.cancel()
                            yield event
                        if isinstance(event, IterationRunFailedEvent):
                            q.put(None)
                            yield event
                    except Empty:
                        continue

                # wait all threads
                wait(futures)
            else:
                for _ in range(len(iterator_list_value)):
                    yield from self._run_single_iter(
                        iterator_list_value=iterator_list_value,
                        variable_pool=variable_pool,
                        inputs=inputs,
                        outputs=outputs,
                        start_at=start_at,
                        graph_engine=graph_engine,
                        iteration_graph=iteration_graph,
                        iter_run_map=iter_run_map,
                    )
            if self.node_data.error_handle_mode == ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
                outputs = [output for output in outputs if output is not None]

            # Flatten the list of lists
            if isinstance(outputs, list) and all(isinstance(output, list) for output in outputs):
                outputs = [item for sublist in outputs for item in sublist]

            yield IterationRunSucceededEvent(
                iteration_id=self.id,
                iteration_node_id=self.node_id,
                iteration_node_type=self.node_type,
                iteration_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                outputs={"output": outputs},
                steps=len(iterator_list_value),
                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    outputs={"output": outputs},
                    metadata={
                        NodeRunMetadataKey.ITERATION_DURATION_MAP: iter_run_map,
                        NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                    },
                )
            )
        except IterationNodeError as e:
            # iteration run failed
            logger.warning("Iteration run failed")
            yield IterationRunFailedEvent(
                iteration_id=self.id,
                iteration_node_id=self.node_id,
                iteration_node_type=self.node_type,
                iteration_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                outputs={"output": outputs},
                steps=len(iterator_list_value),
                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                error=str(e),
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                )
            )
        finally:
            # remove iteration variable (item, index) from variable pool after iteration run completed
            variable_pool.remove([self.node_id, "index"])
            variable_pool.remove([self.node_id, "item"])

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: IterationNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        variable_mapping: dict[str, Sequence[str]] = {
            f"{node_id}.input_selector": node_data.iterator_selector,
        }

        # init graph
        iteration_graph = Graph.init(graph_config=graph_config, root_node_id=node_data.start_node_id)

        if not iteration_graph:
            raise IterationGraphNotFoundError("iteration graph not found")

        for sub_node_id, sub_node_config in iteration_graph.node_id_config_mapping.items():
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
        event: BaseNodeEvent | InNodeEvent,
        iter_run_index: int,
        parallel_mode_run_id: str | None,
    ) -> NodeRunStartedEvent | BaseNodeEvent | InNodeEvent:
        """
        add iteration metadata to event.
        """
        if not isinstance(event, BaseNodeEvent):
            return event
        if self.node_data.is_parallel and isinstance(event, NodeRunStartedEvent):
            event.parallel_mode_run_id = parallel_mode_run_id
            return event
        if event.route_node_state.node_run_result:
            metadata = event.route_node_state.node_run_result.metadata
            if not metadata:
                metadata = {}

            if NodeRunMetadataKey.ITERATION_ID not in metadata:
                metadata[NodeRunMetadataKey.ITERATION_ID] = self.node_id
                if self.node_data.is_parallel:
                    metadata[NodeRunMetadataKey.PARALLEL_MODE_RUN_ID] = parallel_mode_run_id
                else:
                    metadata[NodeRunMetadataKey.ITERATION_INDEX] = iter_run_index
                event.route_node_state.node_run_result.metadata = metadata
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
    ) -> Generator[NodeEvent | InNodeEvent, None, None]:
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
                if isinstance(event, (BaseNodeEvent | BaseParallelBranchEvent)) and not event.in_iteration_id:
                    event.in_iteration_id = self.node_id

                if (
                    isinstance(event, BaseNodeEvent)
                    and event.node_type == NodeType.ITERATION_START
                    and not isinstance(event, NodeRunStreamChunkEvent)
                ):
                    continue

                if isinstance(event, NodeRunSucceededEvent):
                    yield self._handle_event_metadata(
                        event=event, iter_run_index=current_index, parallel_mode_run_id=parallel_mode_run_id
                    )
                elif isinstance(event, BaseGraphEvent):
                    if isinstance(event, GraphRunFailedEvent):
                        # iteration run failed
                        if self.node_data.is_parallel:
                            yield IterationRunFailedEvent(
                                iteration_id=self.id,
                                iteration_node_id=self.node_id,
                                iteration_node_type=self.node_type,
                                iteration_node_data=self.node_data,
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
                                iteration_id=self.id,
                                iteration_node_id=self.node_id,
                                iteration_node_type=self.node_type,
                                iteration_node_data=self.node_data,
                                start_at=start_at,
                                inputs=inputs,
                                outputs={"output": outputs},
                                steps=len(iterator_list_value),
                                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                                error=event.error,
                            )
                        yield RunCompletedEvent(
                            run_result=NodeRunResult(
                                status=WorkflowNodeExecutionStatus.FAILED,
                                error=event.error,
                            )
                        )
                        return
                elif isinstance(event, InNodeEvent):
                    # event = cast(InNodeEvent, event)
                    metadata_event = self._handle_event_metadata(
                        event=event, iter_run_index=current_index, parallel_mode_run_id=parallel_mode_run_id
                    )
                    if isinstance(event, NodeRunFailedEvent):
                        if self.node_data.error_handle_mode == ErrorHandleMode.CONTINUE_ON_ERROR:
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
                                iteration_id=self.id,
                                iteration_node_id=self.node_id,
                                iteration_node_type=self.node_type,
                                iteration_node_data=self.node_data,
                                index=next_index,
                                parallel_mode_run_id=parallel_mode_run_id,
                                pre_iteration_output=None,
                                duration=duration,
                            )
                            return
                        elif self.node_data.error_handle_mode == ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT:
                            yield NodeInIterationFailedEvent(
                                **metadata_event.model_dump(),
                            )
                            variable_pool.add([self.node_id, "index"], next_index)

                            if next_index < len(iterator_list_value):
                                variable_pool.add([self.node_id, "item"], iterator_list_value[next_index])
                            duration = (datetime.now(UTC).replace(tzinfo=None) - iter_start_at).total_seconds()
                            iter_run_map[iteration_run_id] = duration
                            yield IterationRunNextEvent(
                                iteration_id=self.id,
                                iteration_node_id=self.node_id,
                                iteration_node_type=self.node_type,
                                iteration_node_data=self.node_data,
                                index=next_index,
                                parallel_mode_run_id=parallel_mode_run_id,
                                pre_iteration_output=None,
                                duration=duration,
                            )
                            return
                        elif self.node_data.error_handle_mode == ErrorHandleMode.TERMINATED:
                            yield IterationRunFailedEvent(
                                iteration_id=self.id,
                                iteration_node_id=self.node_id,
                                iteration_node_type=self.node_type,
                                iteration_node_data=self.node_data,
                                start_at=start_at,
                                inputs=inputs,
                                outputs={"output": None},
                                steps=len(iterator_list_value),
                                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                                error=event.error,
                            )
                    yield metadata_event

            current_output_segment = variable_pool.get(self.node_data.output_selector)
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
                iteration_id=self.id,
                iteration_node_id=self.node_id,
                iteration_node_type=self.node_type,
                iteration_node_data=self.node_data,
                index=next_index,
                parallel_mode_run_id=parallel_mode_run_id,
                pre_iteration_output=current_iteration_output or None,
                duration=duration,
            )

        except IterationNodeError as e:
            logger.warning(f"Iteration run failed:{str(e)}")
            yield IterationRunFailedEvent(
                iteration_id=self.id,
                iteration_node_id=self.node_id,
                iteration_node_type=self.node_type,
                iteration_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                outputs={"output": None},
                steps=len(iterator_list_value),
                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                error=str(e),
            )
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                )
            )

    def _run_single_iter_parallel(
        self,
        *,
        flask_app: Flask,
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
        with flask_app.app_context():
            parallel_mode_run_id = uuid.uuid4().hex
            graph_engine_copy = graph_engine.create_copy()
            variable_pool_copy = graph_engine_copy.graph_runtime_state.variable_pool
            variable_pool_copy.add([self.node_id, "index"], index)
            variable_pool_copy.add([self.node_id, "item"], item)
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
