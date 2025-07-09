import json
import logging
import time
from collections.abc import Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal, cast

from configs import dify_config
from core.variables import (
    IntegerSegment,
    Segment,
    SegmentType,
)
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.entities.event import (
    BaseGraphEvent,
    BaseNodeEvent,
    BaseParallelBranchEvent,
    GraphRunFailedEvent,
    InNodeEvent,
    LoopRunFailedEvent,
    LoopRunNextEvent,
    LoopRunStartedEvent,
    LoopRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event import NodeEvent, RunCompletedEvent
from core.workflow.nodes.loop.entities import LoopNodeData
from core.workflow.utils.condition.processor import ConditionProcessor
from factories.variable_factory import TypeMismatchError, build_segment_with_type

if TYPE_CHECKING:
    from core.workflow.entities.variable_pool import VariablePool
    from core.workflow.graph_engine.graph_engine import GraphEngine

logger = logging.getLogger(__name__)


class LoopNode(BaseNode[LoopNodeData]):
    """
    Loop Node.
    """

    _node_data_cls = LoopNodeData
    _node_type = NodeType.LOOP

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator[NodeEvent | InNodeEvent, None, None]:
        """Run the node."""
        # Get inputs
        loop_count = self.node_data.loop_count
        break_conditions = self.node_data.break_conditions
        logical_operator = self.node_data.logical_operator

        inputs = {"loop_count": loop_count}

        if not self.node_data.start_node_id:
            raise ValueError(f"field start_node_id in loop {self.node_id} not found")

        # Initialize graph
        loop_graph = Graph.init(graph_config=self.graph_config, root_node_id=self.node_data.start_node_id)
        if not loop_graph:
            raise ValueError("loop graph not found")

        # Initialize variable pool
        variable_pool = self.graph_runtime_state.variable_pool
        variable_pool.add([self.node_id, "index"], 0)

        # Initialize loop variables
        loop_variable_selectors = {}
        if self.node_data.loop_variables:
            for loop_variable in self.node_data.loop_variables:
                value_processor = {
                    "constant": lambda var=loop_variable: self._get_segment_for_constant(var.var_type, var.value),
                    "variable": lambda var=loop_variable: variable_pool.get(var.value),
                }

                if loop_variable.value_type not in value_processor:
                    raise ValueError(
                        f"Invalid value type '{loop_variable.value_type}' for loop variable {loop_variable.label}"
                    )

                processed_segment = value_processor[loop_variable.value_type]()
                if not processed_segment:
                    raise ValueError(f"Invalid value for loop variable {loop_variable.label}")
                variable_selector = [self.node_id, loop_variable.label]
                variable_pool.add(variable_selector, processed_segment.value)
                loop_variable_selectors[loop_variable.label] = variable_selector
                inputs[loop_variable.label] = processed_segment.value

        from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
        from core.workflow.graph_engine.graph_engine import GraphEngine

        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        graph_engine = GraphEngine(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_type=self.workflow_type,
            workflow_id=self.workflow_id,
            user_id=self.user_id,
            user_from=self.user_from,
            invoke_from=self.invoke_from,
            call_depth=self.workflow_call_depth,
            graph=loop_graph,
            graph_config=self.graph_config,
            graph_runtime_state=graph_runtime_state,
            max_execution_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME,
            thread_pool_id=self.thread_pool_id,
        )

        start_at = datetime.now(UTC).replace(tzinfo=None)
        condition_processor = ConditionProcessor()

        # Start Loop event
        yield LoopRunStartedEvent(
            loop_id=self.id,
            loop_node_id=self.node_id,
            loop_node_type=self.node_type,
            loop_node_data=self.node_data,
            start_at=start_at,
            inputs=inputs,
            metadata={"loop_length": loop_count},
            predecessor_node_id=self.previous_node_id,
        )

        # yield LoopRunNextEvent(
        #     loop_id=self.id,
        #     loop_node_id=self.node_id,
        #     loop_node_type=self.node_type,
        #     loop_node_data=self.node_data,
        #     index=0,
        #     pre_loop_output=None,
        # )
        loop_duration_map = {}
        single_loop_variable_map = {}  # single loop variable output
        try:
            check_break_result = False
            for i in range(loop_count):
                loop_start_time = datetime.now(UTC).replace(tzinfo=None)
                # run single loop
                loop_result = yield from self._run_single_loop(
                    graph_engine=graph_engine,
                    loop_graph=loop_graph,
                    variable_pool=variable_pool,
                    loop_variable_selectors=loop_variable_selectors,
                    break_conditions=break_conditions,
                    logical_operator=logical_operator,
                    condition_processor=condition_processor,
                    current_index=i,
                    start_at=start_at,
                    inputs=inputs,
                )
                loop_end_time = datetime.now(UTC).replace(tzinfo=None)

                single_loop_variable = {}
                for key, selector in loop_variable_selectors.items():
                    item = variable_pool.get(selector)
                    if item:
                        single_loop_variable[key] = item.value
                    else:
                        single_loop_variable[key] = None

                loop_duration_map[str(i)] = (loop_end_time - loop_start_time).total_seconds()
                single_loop_variable_map[str(i)] = single_loop_variable

                check_break_result = loop_result.get("check_break_result", False)

                if check_break_result:
                    break

            # Loop completed successfully
            yield LoopRunSucceededEvent(
                loop_id=self.id,
                loop_node_id=self.node_id,
                loop_node_type=self.node_type,
                loop_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                outputs=self.node_data.outputs,
                steps=loop_count,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                    "completed_reason": "loop_break" if check_break_result else "loop_completed",
                    WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                    WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                },
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    metadata={
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                        WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                        WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                    },
                    outputs=self.node_data.outputs,
                    inputs=inputs,
                )
            )

        except Exception as e:
            # Loop failed
            logger.exception("Loop run failed")
            yield LoopRunFailedEvent(
                loop_id=self.id,
                loop_node_id=self.node_id,
                loop_node_type=self.node_type,
                loop_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                steps=loop_count,
                metadata={
                    "total_tokens": graph_engine.graph_runtime_state.total_tokens,
                    "completed_reason": "error",
                    WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                    WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                },
                error=str(e),
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    metadata={
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                        WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                        WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                    },
                )
            )

        finally:
            # Clean up
            variable_pool.remove([self.node_id, "index"])

    def _run_single_loop(
        self,
        *,
        graph_engine: "GraphEngine",
        loop_graph: Graph,
        variable_pool: "VariablePool",
        loop_variable_selectors: dict,
        break_conditions: list,
        logical_operator: Literal["and", "or"],
        condition_processor: ConditionProcessor,
        current_index: int,
        start_at: datetime,
        inputs: dict,
    ) -> Generator[NodeEvent | InNodeEvent, None, dict]:
        """Run a single loop iteration.
        Returns:
            dict:  {'check_break_result': bool}
        """
        # Run workflow
        rst = graph_engine.run()
        current_index_variable = variable_pool.get([self.node_id, "index"])
        if not isinstance(current_index_variable, IntegerSegment):
            raise ValueError(f"loop {self.node_id} current index not found")
        current_index = current_index_variable.value

        check_break_result = False

        for event in rst:
            if isinstance(event, (BaseNodeEvent | BaseParallelBranchEvent)) and not event.in_loop_id:
                event.in_loop_id = self.node_id

            if (
                isinstance(event, BaseNodeEvent)
                and event.node_type == NodeType.LOOP_START
                and not isinstance(event, NodeRunStreamChunkEvent)
            ):
                continue

            if (
                isinstance(event, NodeRunSucceededEvent)
                and event.node_type == NodeType.LOOP_END
                and not isinstance(event, NodeRunStreamChunkEvent)
            ):
                check_break_result = True
                yield self._handle_event_metadata(event=event, iter_run_index=current_index)
                break

            if isinstance(event, NodeRunSucceededEvent):
                yield self._handle_event_metadata(event=event, iter_run_index=current_index)

                # Check if all variables in break conditions exist
                exists_variable = False
                for condition in break_conditions:
                    if not self.graph_runtime_state.variable_pool.get(condition.variable_selector):
                        exists_variable = False
                        break
                    else:
                        exists_variable = True
                if exists_variable:
                    input_conditions, group_result, check_break_result = condition_processor.process_conditions(
                        variable_pool=self.graph_runtime_state.variable_pool,
                        conditions=break_conditions,
                        operator=logical_operator,
                    )
                    if check_break_result:
                        break

            elif isinstance(event, BaseGraphEvent):
                if isinstance(event, GraphRunFailedEvent):
                    # Loop run failed
                    yield LoopRunFailedEvent(
                        loop_id=self.id,
                        loop_node_id=self.node_id,
                        loop_node_type=self.node_type,
                        loop_node_data=self.node_data,
                        start_at=start_at,
                        inputs=inputs,
                        steps=current_index,
                        metadata={
                            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: (
                                graph_engine.graph_runtime_state.total_tokens
                            ),
                            "completed_reason": "error",
                        },
                        error=event.error,
                    )
                    yield RunCompletedEvent(
                        run_result=NodeRunResult(
                            status=WorkflowNodeExecutionStatus.FAILED,
                            error=event.error,
                            metadata={
                                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: (
                                    graph_engine.graph_runtime_state.total_tokens
                                )
                            },
                        )
                    )
                    return {"check_break_result": True}
            elif isinstance(event, NodeRunFailedEvent):
                # Loop run failed
                yield self._handle_event_metadata(event=event, iter_run_index=current_index)
                yield LoopRunFailedEvent(
                    loop_id=self.id,
                    loop_node_id=self.node_id,
                    loop_node_type=self.node_type,
                    loop_node_data=self.node_data,
                    start_at=start_at,
                    inputs=inputs,
                    steps=current_index,
                    metadata={
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                        "completed_reason": "error",
                    },
                    error=event.error,
                )
                yield RunCompletedEvent(
                    run_result=NodeRunResult(
                        status=WorkflowNodeExecutionStatus.FAILED,
                        error=event.error,
                        metadata={
                            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens
                        },
                    )
                )
                return {"check_break_result": True}
            else:
                yield self._handle_event_metadata(event=cast(InNodeEvent, event), iter_run_index=current_index)

        # Remove all nodes outputs from variable pool
        for node_id in loop_graph.node_ids:
            variable_pool.remove([node_id])

        _outputs = {}
        for loop_variable_key, loop_variable_selector in loop_variable_selectors.items():
            _loop_variable_segment = variable_pool.get(loop_variable_selector)
            if _loop_variable_segment:
                _outputs[loop_variable_key] = _loop_variable_segment.value
            else:
                _outputs[loop_variable_key] = None

        _outputs["loop_round"] = current_index + 1
        self.node_data.outputs = _outputs

        if check_break_result:
            return {"check_break_result": True}

        # Move to next loop
        next_index = current_index + 1
        variable_pool.add([self.node_id, "index"], next_index)

        yield LoopRunNextEvent(
            loop_id=self.id,
            loop_node_id=self.node_id,
            loop_node_type=self.node_type,
            loop_node_data=self.node_data,
            index=next_index,
            pre_loop_output=self.node_data.outputs,
        )

        return {"check_break_result": False}

    def _handle_event_metadata(
        self,
        *,
        event: BaseNodeEvent | InNodeEvent,
        iter_run_index: int,
    ) -> NodeRunStartedEvent | BaseNodeEvent | InNodeEvent:
        """
        add iteration metadata to event.
        """
        if not isinstance(event, BaseNodeEvent):
            return event
        if event.route_node_state.node_run_result:
            metadata = event.route_node_state.node_run_result.metadata
            if not metadata:
                metadata = {}
            if WorkflowNodeExecutionMetadataKey.LOOP_ID not in metadata:
                metadata = {
                    **metadata,
                    WorkflowNodeExecutionMetadataKey.LOOP_ID: self.node_id,
                    WorkflowNodeExecutionMetadataKey.LOOP_INDEX: iter_run_index,
                }
                event.route_node_state.node_run_result.metadata = metadata
        return event

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: LoopNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        variable_mapping = {}

        # init graph
        loop_graph = Graph.init(graph_config=graph_config, root_node_id=node_data.start_node_id)

        if not loop_graph:
            raise ValueError("loop graph not found")

        for sub_node_id, sub_node_config in loop_graph.node_id_config_mapping.items():
            if sub_node_config.get("data", {}).get("loop_id") != node_id:
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

            # remove loop variables
            sub_node_variable_mapping = {
                sub_node_id + "." + key: value
                for key, value in sub_node_variable_mapping.items()
                if value[0] != node_id
            }

            variable_mapping.update(sub_node_variable_mapping)

        for loop_variable in node_data.loop_variables or []:
            if loop_variable.value_type == "variable":
                assert loop_variable.value is not None, "Loop variable value must be provided for variable type"
                # add loop variable to variable mapping
                selector = loop_variable.value
                variable_mapping[f"{node_id}.{loop_variable.label}"] = selector

        # remove variable out from loop
        variable_mapping = {
            key: value for key, value in variable_mapping.items() if value[0] not in loop_graph.node_ids
        }

        return variable_mapping

    @staticmethod
    def _get_segment_for_constant(var_type: SegmentType, value: Any) -> Segment:
        """Get the appropriate segment type for a constant value."""
        if var_type in ["array[string]", "array[number]", "array[object]"]:
            if value and isinstance(value, str):
                value = json.loads(value)
            else:
                value = []
        try:
            return build_segment_with_type(var_type, value)
        except TypeMismatchError as type_exc:
            # Attempt to parse the value as a JSON-encoded string, if applicable.
            if not isinstance(value, str):
                raise
            try:
                value = json.loads(value)
            except ValueError:
                raise type_exc
            return build_segment_with_type(var_type, value)
