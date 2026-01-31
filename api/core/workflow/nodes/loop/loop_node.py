import contextlib
import json
import logging
from collections.abc import Callable, Generator, Mapping, Sequence
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, cast

from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables import Segment, SegmentType
from core.workflow.enums import (
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
from core.workflow.nodes.base import LLMUsageTrackingMixin
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.loop.entities import LoopCompletedReason, LoopNodeData, LoopVariableData
from core.workflow.utils.condition.processor import ConditionProcessor
from factories.variable_factory import TypeMismatchError, build_segment_with_type, segment_to_variable
from libs.datetime_utils import naive_utc_now

if TYPE_CHECKING:
    from core.workflow.graph_engine import GraphEngine

logger = logging.getLogger(__name__)


class LoopNode(LLMUsageTrackingMixin, Node[LoopNodeData]):
    """
    Loop Node.
    """

    node_type = NodeType.LOOP
    execution_type = NodeExecutionType.CONTAINER

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator:
        """Run the node."""
        # Get inputs
        loop_count = self.node_data.loop_count
        break_conditions = self.node_data.break_conditions
        logical_operator = self.node_data.logical_operator

        inputs = {"loop_count": loop_count}

        if not self.node_data.start_node_id:
            raise ValueError(f"field start_node_id in loop {self._node_id} not found")

        root_node_id = self.node_data.start_node_id

        # Initialize loop variables in the original variable pool
        loop_variable_selectors = {}
        if self.node_data.loop_variables:
            value_processor: dict[Literal["constant", "variable"], Callable[[LoopVariableData], Segment | None]] = {
                "constant": lambda var: self._get_segment_for_constant(var.var_type, var.value),
                "variable": lambda var: self.graph_runtime_state.variable_pool.get(var.value)
                if isinstance(var.value, list)
                else None,
            }
            for loop_variable in self.node_data.loop_variables:
                if loop_variable.value_type not in value_processor:
                    raise ValueError(
                        f"Invalid value type '{loop_variable.value_type}' for loop variable {loop_variable.label}"
                    )

                processed_segment = value_processor[loop_variable.value_type](loop_variable)
                if not processed_segment:
                    raise ValueError(f"Invalid value for loop variable {loop_variable.label}")
                variable_selector = [self._node_id, loop_variable.label]
                variable = segment_to_variable(segment=processed_segment, selector=variable_selector)
                self.graph_runtime_state.variable_pool.add(variable_selector, variable.value)
                loop_variable_selectors[loop_variable.label] = variable_selector
                inputs[loop_variable.label] = processed_segment.value

        start_at = naive_utc_now()
        condition_processor = ConditionProcessor()

        loop_duration_map: dict[str, float] = {}
        single_loop_variable_map: dict[str, dict[str, Any]] = {}  # single loop variable output
        loop_usage = LLMUsage.empty_usage()
        loop_node_ids = self._extract_loop_node_ids_from_config(self.graph_config, self._node_id)

        # Start Loop event
        yield LoopStartedEvent(
            start_at=start_at,
            inputs=inputs,
            metadata={"loop_length": loop_count},
        )

        try:
            reach_break_condition = False
            if break_conditions:
                with contextlib.suppress(ValueError):
                    _, _, reach_break_condition = condition_processor.process_conditions(
                        variable_pool=self.graph_runtime_state.variable_pool,
                        conditions=break_conditions,
                        operator=logical_operator,
                    )

            if reach_break_condition:
                loop_count = 0

            for i in range(loop_count):
                # Clear stale variables from previous loop iterations to avoid streaming old values
                self._clear_loop_subgraph_variables(loop_node_ids)
                graph_engine = self._create_graph_engine(start_at=start_at, root_node_id=root_node_id)

                loop_start_time = naive_utc_now()
                reach_break_node = yield from self._run_single_loop(graph_engine=graph_engine, current_index=i)
                # Track loop duration
                loop_duration_map[str(i)] = (naive_utc_now() - loop_start_time).total_seconds()

                # Accumulate outputs from the sub-graph's response nodes
                for key, value in graph_engine.graph_runtime_state.outputs.items():
                    if key == "answer":
                        # Concatenate answer outputs with newline
                        existing_answer = self.graph_runtime_state.get_output("answer", "")
                        if existing_answer:
                            self.graph_runtime_state.set_output("answer", f"{existing_answer}{value}")
                        else:
                            self.graph_runtime_state.set_output("answer", value)
                    else:
                        # For other outputs, just update
                        self.graph_runtime_state.set_output(key, value)

                # Accumulate usage from the sub-graph execution
                loop_usage = self._merge_usage(loop_usage, graph_engine.graph_runtime_state.llm_usage)

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
                    pre_loop_output=self.node_data.outputs,
                )

            self._accumulate_usage(loop_usage)
            # Loop completed successfully
            yield LoopSucceededEvent(
                start_at=start_at,
                inputs=inputs,
                outputs=self.node_data.outputs,
                steps=loop_count,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: loop_usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: loop_usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: loop_usage.currency,
                    WorkflowNodeExecutionMetadataKey.COMPLETED_REASON: (
                        LoopCompletedReason.LOOP_BREAK
                        if reach_break_condition
                        else LoopCompletedReason.LOOP_COMPLETED.value
                    ),
                    WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                    WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                },
            )

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    metadata={
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: loop_usage.total_tokens,
                        WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: loop_usage.total_price,
                        WorkflowNodeExecutionMetadataKey.CURRENCY: loop_usage.currency,
                        WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                        WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                    },
                    outputs=self.node_data.outputs,
                    inputs=inputs,
                    llm_usage=loop_usage,
                )
            )

        except Exception as e:
            self._accumulate_usage(loop_usage)
            yield LoopFailedEvent(
                start_at=start_at,
                inputs=inputs,
                steps=loop_count,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: loop_usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: loop_usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: loop_usage.currency,
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
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: loop_usage.total_tokens,
                        WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: loop_usage.total_price,
                        WorkflowNodeExecutionMetadataKey.CURRENCY: loop_usage.currency,
                        WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: loop_duration_map,
                        WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: single_loop_variable_map,
                    },
                    llm_usage=loop_usage,
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

        for loop_var in self.node_data.loop_variables or []:
            key, sel = loop_var.label, [self._node_id, loop_var.label]
            segment = self.graph_runtime_state.variable_pool.get(sel)
            self.node_data.outputs[key] = segment.value if segment else None
        self.node_data.outputs["loop_round"] = current_index + 1

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

    def _clear_loop_subgraph_variables(self, loop_node_ids: set[str]) -> None:
        """
        Remove variables produced by loop sub-graph nodes from previous iterations.

        Keeping stale variables causes a freshly created response coordinator in the
        next iteration to fall back to outdated values when no stream chunks exist.
        """
        variable_pool = self.graph_runtime_state.variable_pool
        for node_id in loop_node_ids:
            variable_pool.remove([node_id])

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

        # Extract loop node IDs statically from graph_config

        loop_node_ids = cls._extract_loop_node_ids_from_config(graph_config, node_id)

        # Get node configs from graph_config
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
        variable_mapping = {key: value for key, value in variable_mapping.items() if value[0] not in loop_node_ids}

        return variable_mapping

    @classmethod
    def _extract_loop_node_ids_from_config(cls, graph_config: Mapping[str, Any], loop_node_id: str) -> set[str]:
        """
        Extract node IDs that belong to a specific loop from graph configuration.

        This method statically analyzes the graph configuration to find all nodes
        that are part of the specified loop, without creating actual node instances.

        :param graph_config: the complete graph configuration
        :param loop_node_id: the ID of the loop node
        :return: set of node IDs that belong to the loop
        """
        loop_node_ids = set()

        # Find all nodes that belong to this loop
        nodes = graph_config.get("nodes", [])
        for node in nodes:
            node_data = node.get("data", {})
            if node_data.get("loop_id") == loop_node_id:
                node_id = node.get("id")
                if node_id:
                    loop_node_ids.add(node_id)

        return loop_node_ids

    @staticmethod
    def _get_segment_for_constant(var_type: SegmentType, original_value: Any) -> Segment:
        """Get the appropriate segment type for a constant value."""
        # TODO: Refactor for maintainability:
        # 1. Ensure type handling logic stays synchronized with _VALID_VAR_TYPE (entities.py)
        # 2. Consider moving this method to LoopVariableData class for better encapsulation
        if not var_type.is_array_type() or var_type == SegmentType.ARRAY_BOOLEAN:
            value = original_value
        elif var_type in [
            SegmentType.ARRAY_NUMBER,
            SegmentType.ARRAY_OBJECT,
            SegmentType.ARRAY_STRING,
        ]:
            if original_value and isinstance(original_value, str):
                value = json.loads(original_value)
            else:
                logger.warning("unexpected value for LoopNode, value_type=%s, value=%s", original_value, var_type)
                value = []
        else:
            raise AssertionError("this statement should be unreachable.")
        try:
            return build_segment_with_type(var_type, value=value)
        except TypeMismatchError as type_exc:
            # Attempt to parse the value as a JSON-encoded string, if applicable.
            if not isinstance(original_value, str):
                raise
            try:
                value = json.loads(original_value)
            except ValueError:
                raise type_exc
            return build_segment_with_type(var_type, value)

    def _create_graph_engine(self, start_at: datetime, root_node_id: str):
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
            workflow_id=self.workflow_id,
            graph=loop_graph,
            graph_runtime_state=graph_runtime_state_copy,
            command_channel=InMemoryChannel(),  # Use InMemoryChannel for sub-graphs
            config=GraphEngineConfig(),
        )

        return graph_engine
