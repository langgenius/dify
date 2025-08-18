import json
import logging
from collections.abc import Callable, Generator, Mapping, Sequence
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, Optional, cast

from configs import dify_config
from core.variables import Segment, SegmentType
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
    NodeRunSucceededEvent,
)
from core.workflow.node_events import (
    LoopFailedEvent,
    LoopNextEvent,
    LoopStartedEvent,
    LoopSucceededEvent,
    NodeEventBase,
    NodeRunResult,
    StreamCompletedEvent,
)
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.loop.entities import LoopNodeData, LoopVariableData
from core.workflow.utils.condition.processor import ConditionProcessor
from factories.variable_factory import TypeMismatchError, build_segment_with_type, segment_to_variable
from libs.datetime_utils import naive_utc_now

if TYPE_CHECKING:
    from core.workflow.graph_engine import GraphEngine

logger = logging.getLogger(__name__)


class LoopNode(Node):
    """
    Loop Node.
    """

    node_type = NodeType.LOOP
    _node_data: LoopNodeData
    execution_type = NodeExecutionType.CONTAINER

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = LoopNodeData.model_validate(data)

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
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator:
        """Run the node."""
        # Get inputs
        loop_count = self._node_data.loop_count
        break_conditions = self._node_data.break_conditions
        logical_operator = self._node_data.logical_operator

        inputs = {"loop_count": loop_count}

        if not self._node_data.start_node_id:
            raise ValueError(f"field start_node_id in loop {self._node_id} not found")

        root_node_id = self._node_data.start_node_id

        # Initialize loop variables in the original variable pool
        loop_variable_selectors = {}
        if self._node_data.loop_variables:
            value_processor: dict[Literal["constant", "variable"], Callable[[LoopVariableData], Segment | None]] = {
                "constant": lambda var: self._get_segment_for_constant(var.var_type, var.value),
                "variable": lambda var: self.graph_runtime_state.variable_pool.get(var.value),
            }
            for loop_variable in self._node_data.loop_variables:
                if loop_variable.value_type not in value_processor:
                    raise ValueError(
                        f"Invalid value type '{loop_variable.value_type}' for loop variable {loop_variable.label}"
                    )

                processed_segment = value_processor[loop_variable.value_type](loop_variable)
                if not processed_segment:
                    raise ValueError(f"Invalid value for loop variable {loop_variable.label}")
                variable_selector = [self._node_id, loop_variable.label]
                variable = segment_to_variable(segment=processed_segment, selector=variable_selector)
                self.graph_runtime_state.variable_pool.add(variable_selector, variable)
                loop_variable_selectors[loop_variable.label] = variable_selector
                inputs[loop_variable.label] = processed_segment.value

        start_at = naive_utc_now()
        condition_processor = ConditionProcessor()

        loop_duration_map: dict[str, float] = {}
        single_loop_variable_map: dict[str, dict[str, Any]] = {}  # single loop variable output

        # Start Loop event
        yield LoopStartedEvent(
            start_at=start_at,
            inputs=inputs,
            metadata={"loop_length": loop_count},
        )

        try:
            reach_break_condition = False
            if break_conditions:
                _, _, reach_break_condition = condition_processor.process_conditions(
                    variable_pool=self.graph_runtime_state.variable_pool,
                    conditions=break_conditions,
                    operator=logical_operator,
                )
            if reach_break_condition:
                loop_count = 0
            cost_tokens = 0

            for i in range(loop_count):
                graph_engine = self._create_graph_engine(start_at=start_at, root_node_id=root_node_id)

                loop_start_time = naive_utc_now()
                reach_break_node = yield from self._run_single_loop(graph_engine=graph_engine, current_index=i)
                # Track loop duration
                loop_duration_map[str(i)] = (naive_utc_now() - loop_start_time).total_seconds()

                # Accumulate outputs from the sub-graph's response nodes
                for key, value in graph_engine.graph_runtime_state.outputs.items():
                    if key == "answer":
                        # Concatenate answer outputs with newline
                        existing_answer = self.graph_runtime_state.outputs.get("answer", "")
                        if existing_answer:
                            self.graph_runtime_state.outputs["answer"] = f"{existing_answer}{value}"
                        else:
                            self.graph_runtime_state.outputs["answer"] = value
                    else:
                        # For other outputs, just update
                        self.graph_runtime_state.outputs[key] = value

                # Update the total tokens from this iteration
                cost_tokens += graph_engine.graph_runtime_state.total_tokens

                # Collect loop variable values after iteration
                single_loop_variable = {}
                for key, selector in loop_variable_selectors.items():
                    segment = self.graph_runtime_state.variable_pool.get(selector)
                    single_loop_variable[key] = segment.value if segment else None

                single_loop_variable_map[str(i)] = single_loop_variable

                if reach_break_node:
                    break

                if break_conditions:
                    _, _, reach_break_condition = condition_processor.process_conditions(
                        variable_pool=self.graph_runtime_state.variable_pool,
                        conditions=break_conditions,
                        operator=logical_operator,
                    )
                if reach_break_condition:
                    break

                yield LoopNextEvent(
                    index=i + 1,
                    pre_loop_output=self._node_data.outputs,
                )

            self.graph_runtime_state.total_tokens += cost_tokens
            # Loop completed successfully
            yield LoopSucceededEvent(
                start_at=start_at,
                inputs=inputs,
                outputs=self._node_data.outputs,
                steps=loop_count,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: cost_tokens,
                    "completed_reason": "loop_break" if reach_break_condition else "loop_completed",
                    WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                    WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                },
            )

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    metadata={
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens,
                        WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                        WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                    },
                    outputs=self._node_data.outputs,
                    inputs=inputs,
                )
            )

        except Exception as e:
            yield LoopFailedEvent(
                start_at=start_at,
                inputs=inputs,
                steps=loop_count,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens,
                    "completed_reason": "error",
                    WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                    WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                },
                error=str(e),
            )

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    metadata={
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: self.graph_runtime_state.total_tokens,
                        WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                        WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                    },
                )
            )

    def _run_single_loop(
        self,
        *,
        graph_engine: "GraphEngine",
        current_index: int,
    ) -> Generator[NodeEventBase | GraphNodeEventBase, None, bool]:
        reach_break_node = False
        for event in graph_engine.run():
            if isinstance(event, GraphNodeEventBase):
                self._append_loop_info_to_event(event=event, loop_run_index=current_index)

            if isinstance(event, GraphNodeEventBase) and event.node_type == NodeType.LOOP_START:
                continue
            if isinstance(event, GraphNodeEventBase):
                yield event
            if isinstance(event, NodeRunSucceededEvent) and event.node_type == NodeType.LOOP_END:
                reach_break_node = True
            if isinstance(event, GraphRunFailedEvent):
                raise Exception(event.error)

        for loop_var in self._node_data.loop_variables or []:
            key, sel = loop_var.label, [self._node_id, loop_var.label]
            segment = self.graph_runtime_state.variable_pool.get(sel)
            self._node_data.outputs[key] = segment.value if segment else None
        self._node_data.outputs["loop_round"] = current_index + 1

        return reach_break_node

    def _append_loop_info_to_event(
        self,
        event: GraphNodeEventBase,
        loop_run_index: int,
    ):
        event.in_loop_id = self._node_id
        loop_metadata = {
            WorkflowNodeExecutionMetadataKey.LOOP_ID: self._node_id,
            WorkflowNodeExecutionMetadataKey.LOOP_INDEX: loop_run_index,
        }

        current_metadata = event.node_run_result.metadata
        if WorkflowNodeExecutionMetadataKey.LOOP_ID not in current_metadata:
            event.node_run_result.metadata = {**current_metadata, **loop_metadata}

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = LoopNodeData.model_validate(node_data)

        variable_mapping = {}

        # init graph
        # Note: This is a classmethod without access to instance attributes
        # We'll skip node factory for now since this appears to be for static analysis
        # TODO: Refactor to properly handle node factory in classmethods
        from core.workflow.graph import Graph

        loop_graph = Graph.init(
            graph_config=graph_config,
            node_factory=None,  # type: ignore[arg-type]
            root_node_id=typed_node_data.start_node_id,
        )

        if not loop_graph:
            raise ValueError("loop graph not found")

        # Get node configs from graph_config instead of non-existent node_id_config_mapping
        node_configs = {node["id"]: node for node in graph_config.get("nodes", []) if "id" in node}
        for sub_node_id, sub_node_config in node_configs.items():
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

        for loop_variable in typed_node_data.loop_variables or []:
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

    def _create_graph_engine(self, start_at: datetime, root_node_id: str):
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

        # Create a new GraphRuntimeState for this iteration
        graph_runtime_state_copy = GraphRuntimeState(
            variable_pool=self.graph_runtime_state.variable_pool,
            start_at=start_at.timestamp(),
        )

        # Create a new node factory with the new GraphRuntimeState
        node_factory = DifyNodeFactory(
            graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state_copy
        )

        # Initialize the loop graph with the new node factory
        loop_graph = Graph.init(graph_config=self.graph_config, node_factory=node_factory, root_node_id=root_node_id)

        # Create a new GraphEngine for this iteration
        graph_engine = GraphEngine(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_id=self.workflow_id,
            user_id=self.user_id,
            user_from=self.user_from,
            invoke_from=self.invoke_from,
            call_depth=self.workflow_call_depth,
            graph=loop_graph,
            graph_config=self.graph_config,
            graph_runtime_state=graph_runtime_state_copy,
            max_execution_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME,
            command_channel=InMemoryChannel(),  # Use InMemoryChannel for sub-graphs
        )

        return graph_engine
