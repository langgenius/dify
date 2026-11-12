import json
import logging
from collections.abc import Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, assert_never, override

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import (
    BuiltinNodeTypes,
    NodeExecutionType,
    WorkflowNodeExecutionStatus,
)
from graphon.graph.scoping import resolve_container_id
from graphon.node_events.base import NodeEventPayload
from graphon.node_events.loop import (
    LoopFailedEvent,
    LoopNextEvent,
    LoopStartedEvent,
    LoopSucceededEvent,
)
from graphon.node_events.node import StreamCompletedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import (
    ContainerExecutionResult,
    ContainerRunResult,
    LoopFrameRequest,
    build_container_value,
)
from graphon.nodes.loop.entities import LoopNodeData
from graphon.variables.factory import (
    TypeMismatchError,
    build_segment_with_type,
)
from graphon.variables.segments import Segment
from graphon.variables.types import SegmentType

logger = logging.getLogger(__name__)


class LoopNode(Node[LoopNodeData]):
    """Loop node definition.

    Loop execution is interpreted by Engine. The node keeps only its
    configuration, loop-variable initialization, and static variable mapping.
    """

    node_type = BuiltinNodeTypes.LOOP
    execution_type = NodeExecutionType.CONTAINER

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(
        self,
    ) -> Generator[NodeEventPayload | LoopFrameRequest, None, None]:
        loop_count = self.node_data.loop_count
        inputs: dict[str, object] = {"loop_count": loop_count}
        root_node_id = self.node_data.start_node_id
        loop_variable_selectors = self._initialize_loop_variables(inputs=inputs)
        loop_node_ids = self._extract_loop_node_ids_from_config(
            self.graph_config,
            self._node_id,
        )
        started_at = datetime.now(UTC).replace(tzinfo=None)
        yield LoopStartedEvent(
            start_at=started_at,
            inputs=inputs,
            metadata={"loop_length": loop_count},
        )
        yield LoopFrameRequest(
            inputs={key: build_container_value(value) for key, value in inputs.items()},
            outputs={},
            loop_count=loop_count,
            root_node_id=root_node_id,
            loop_variable_selectors=loop_variable_selectors,
            loop_node_ids=frozenset(loop_node_ids),
            index=0,
        )

    @override
    def _resume_container_events(
        self,
        *,
        result: ContainerRunResult,
    ) -> Generator[NodeEventPayload | LoopFrameRequest, None, None]:
        if isinstance(result, LoopFrameRequest):
            yield LoopNextEvent(
                index=result.index,
                pre_loop_output={
                    key: value.to_object() for key, value in result.outputs.items()
                },
            )
            yield result
            return

        if isinstance(result, ContainerExecutionResult):
            node_run_result = result.node_run_result.to_node_run_result()
            outputs = {
                key: value.to_object()
                for key, value in result.node_run_result.outputs.items()
            }
            if node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
                yield LoopSucceededEvent(
                    start_at=self._start_at,
                    inputs=node_run_result.inputs,
                    outputs=outputs,
                    metadata=result.metadata,
                    steps=result.steps,
                )
            elif node_run_result.status == WorkflowNodeExecutionStatus.FAILED:
                yield LoopFailedEvent(
                    start_at=self._start_at,
                    inputs=node_run_result.inputs,
                    outputs=outputs,
                    metadata=result.metadata,
                    steps=result.steps,
                    error=node_run_result.error,
                )
            else:
                msg = f"Unsupported loop status {node_run_result.status}"
                raise ValueError(msg)
            yield StreamCompletedEvent(node_run_result=node_run_result)
            return

        msg = f"Unsupported loop result {type(result).__name__}"
        raise TypeError(msg)

    def _initialize_loop_variables(
        self,
        *,
        inputs: dict[str, Any],
    ) -> dict[str, tuple[str, ...]]:
        loop_variable_selectors: dict[str, tuple[str, ...]] = {}
        if not self.node_data.loop_variables:
            return loop_variable_selectors

        for loop_variable in self.node_data.loop_variables:
            match loop_variable.value_type:
                case "constant":
                    processed_segment = self._get_segment_for_constant(
                        var_type=loop_variable.var_type,
                        original_value=loop_variable.value,
                    )
                case "variable":
                    if not isinstance(loop_variable.value, list):
                        msg = f"Invalid value for loop variable {loop_variable.label}"
                        raise TypeError(msg)
                    processed_segment = self.runtime_state.variable_pool.get(
                        loop_variable.value,
                    )
                case _:
                    assert_never(loop_variable.value_type)

            if processed_segment is None:
                msg = f"Invalid value for loop variable {loop_variable.label}"
                raise ValueError(msg)

            variable_selector = (self._node_id, loop_variable.label)
            self.runtime_state.variable_pool.add(
                variable_selector,
                build_container_value(processed_segment),
            )
            loop_variable_selectors[loop_variable.label] = variable_selector
            inputs[loop_variable.label] = processed_segment.value
        return loop_variable_selectors

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: LoopNodeData,
    ) -> Mapping[str, Sequence[str]]:
        variable_mapping = {}
        loop_node_ids = cls._extract_loop_node_ids_from_config(graph_config, node_id)

        node_configs = {
            node["id"]: node for node in graph_config.get("nodes", []) if "id" in node
        }
        for sub_node_id, sub_node_config in node_configs.items():
            if sub_node_id not in loop_node_ids:
                continue

            sub_node_variable_mapping = cls._extract_mapping_from_node_config(
                graph_config=graph_config,
                config=sub_node_config,
            )

            variable_mapping.update({
                sub_node_id + "." + key: value
                for key, value in sub_node_variable_mapping.items()
                if value[0] != node_id
            })

        for loop_variable in node_data.loop_variables:
            if loop_variable.value_type == "variable":
                if not isinstance(loop_variable.value, list):
                    msg = "Loop variable value must be a selector for variable type"
                    raise TypeError(msg)
                variable_mapping[f"{node_id}.{loop_variable.label}"] = (
                    loop_variable.value
                )

        return {
            key: value
            for key, value in variable_mapping.items()
            if value[0] not in loop_node_ids
        }

    @classmethod
    def _extract_loop_node_ids_from_config(
        cls,
        graph_config: Mapping[str, Any],
        loop_node_id: str,
    ) -> set[str]:
        """Return nodes governed by the nearest enclosing Loop.

        Resolve canonical and legacy ownership before walking the hierarchy so
        callers can inspect persisted configs before ``Graph.init``. A Loop End
        nested in an Iteration can still stop its surrounding Loop. The walk stops
        at a different Loop so an inner Loop End never breaks an outer Loop.

        Args:
            graph_config: Container subtree visible to the Loop node.
            loop_node_id: Loop whose governed node IDs are requested.

        Returns:
            IDs of nodes whose nearest Loop ancestor is ``loop_node_id``.

        """
        loop_node_ids = set()
        node_configs = {
            node_id: node
            for node in graph_config.get("nodes", [])
            if isinstance(node, Mapping)
            and isinstance((node_id := node.get("id")), str)
        }
        for node_id, node_config in node_configs.items():
            owner = resolve_container_id(node_config, nodes_by_id=node_configs)
            visited: set[str] = set()
            while owner and owner not in visited:
                if owner == loop_node_id:
                    loop_node_ids.add(node_id)
                    break
                visited.add(owner)
                owner_config = node_configs.get(owner)
                if owner_config is None:
                    break
                owner_data = owner_config.get("data")
                if (
                    isinstance(owner_data, (Mapping, BaseNodeData))
                    and owner_data.get("type") == BuiltinNodeTypes.LOOP
                ):
                    break
                owner = resolve_container_id(owner_config, nodes_by_id=node_configs)
        return loop_node_ids

    @staticmethod
    def _get_segment_for_constant(
        var_type: SegmentType,
        original_value: Any,
    ) -> Segment:
        value = LoopNode._deserialize_constant_value(
            var_type=var_type,
            original_value=original_value,
        )
        try:
            return build_segment_with_type(var_type, value=value)
        except TypeMismatchError as type_exc:
            if not isinstance(original_value, str):
                raise
            try:
                value = json.loads(original_value)
            except ValueError:
                raise type_exc from None
            return build_segment_with_type(var_type, value)

    @staticmethod
    def _deserialize_constant_value(
        *,
        var_type: SegmentType,
        original_value: Any,
    ) -> Any:
        match var_type:
            case (
                SegmentType.NUMBER
                | SegmentType.INTEGER
                | SegmentType.FLOAT
                | SegmentType.STRING
                | SegmentType.OBJECT
                | SegmentType.SECRET
                | SegmentType.FILE
                | SegmentType.BOOLEAN
                | SegmentType.NONE
                | SegmentType.GROUP
                | SegmentType.ARRAY_BOOLEAN
            ):
                return original_value
            case (
                SegmentType.ARRAY_NUMBER
                | SegmentType.ARRAY_OBJECT
                | SegmentType.ARRAY_STRING
            ):
                if original_value and isinstance(original_value, str):
                    return json.loads(original_value)
                logger.warning(
                    "unexpected value for LoopNode, value_type=%s, value=%s",
                    original_value,
                    var_type,
                )
                return []
            case SegmentType.ARRAY_ANY | SegmentType.ARRAY_FILE:
                msg = "this statement should be unreachable."
                raise AssertionError(msg)
            case _:
                assert_never(var_type)
