from collections.abc import Generator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast, override

from graphon.enums import (
    BuiltinNodeTypes,
    ErrorHandleMode,
    NodeExecutionType,
    WorkflowNodeExecutionStatus,
)
from graphon.graph.scoping import resolve_container_id
from graphon.node_events.base import NodeEventPayload, NodeRunResult
from graphon.node_events.iteration import (
    IterationFailedEvent,
    IterationNextEvent,
    IterationStartedEvent,
    IterationSucceededEvent,
)
from graphon.node_events.node import StreamCompletedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import (
    ContainerExecutionResult,
    ContainerRunResult,
    IterationFrameRequest,
    build_container_value,
)
from graphon.nodes.iteration.entities import IterationNodeData
from graphon.variables.segments import ArrayAnySegment, ArraySegment, NoneSegment


class IterationNode(Node[IterationNodeData]):
    """Iteration node definition.

    Iteration execution is interpreted by Engine. The node keeps only its
    configuration and static variable-mapping behavior.
    """

    node_type = BuiltinNodeTypes.ITERATION
    execution_type = NodeExecutionType.CONTAINER

    @classmethod
    @override
    def get_default_config(
        cls,
        filters: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        _ = filters
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
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(
        self,
    ) -> Generator[NodeEventPayload | IterationFrameRequest, None, None]:
        variable = self.runtime_state.variable_pool.get(
            self.node_data.iterator_selector,
        )
        if variable is None:
            msg = f"iterator variable {self.node_data.iterator_selector} not found"
            raise ValueError(msg)
        started_at = datetime.now(UTC).replace(tzinfo=None)
        if isinstance(variable, NoneSegment) or (
            isinstance(variable, ArraySegment) and len(variable.value) == 0
        ):
            yield from self._run_empty_iteration(
                variable=variable,
                started_at=started_at,
            )
            return
        iterator_value = self._resolve_iterator_value(variable)
        root_node_id = self.node_data.start_node_id
        parallel_nums = (
            self.node_data.parallel_nums if self.node_data.is_parallel else 1
        )

        inputs = {"iterator_selector": iterator_value}
        yield IterationStartedEvent(
            start_at=started_at,
            inputs=inputs,
            metadata={"iteration_length": len(iterator_value)},
        )
        indexes = tuple(range(min(parallel_nums, len(iterator_value))))
        for index in indexes:
            yield IterationNextEvent(index=index)
        yield IterationFrameRequest(
            items=tuple(build_container_value(item) for item in iterator_value),
            root_node_id=root_node_id,
            indexes=indexes,
            output_selector=tuple(self.node_data.output_selector),
            error_handle_mode=self.node_data.error_handle_mode,
            flatten_output=self.node_data.flatten_output,
            parallel_nums=parallel_nums,
        )

    @override
    def _resume_container_events(
        self,
        *,
        result: ContainerRunResult,
    ) -> Generator[NodeEventPayload | IterationFrameRequest, None, None]:
        if isinstance(result, IterationFrameRequest):
            for index in result.indexes:
                yield IterationNextEvent(index=index)
            yield result
            return

        if isinstance(result, ContainerExecutionResult):
            node_run_result = result.node_run_result.to_node_run_result()
            outputs = {
                key: value.to_object()
                for key, value in result.node_run_result.outputs.items()
            }
            if node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
                yield IterationSucceededEvent(
                    start_at=self._start_at,
                    inputs=node_run_result.inputs,
                    outputs=outputs,
                    metadata=result.metadata,
                    steps=result.steps,
                )
            elif node_run_result.status == WorkflowNodeExecutionStatus.FAILED:
                yield IterationFailedEvent(
                    start_at=self._start_at,
                    inputs=node_run_result.inputs,
                    outputs=outputs,
                    metadata=result.metadata,
                    steps=result.steps,
                    error=node_run_result.error,
                )
            else:
                msg = f"Unsupported iteration status {node_run_result.status}"
                raise ValueError(msg)
            yield StreamCompletedEvent(node_run_result=node_run_result)
            return

        msg = f"Unsupported iteration result {type(result).__name__}"
        raise TypeError(msg)

    def _resolve_iterator_value(self, variable: object) -> list[object]:
        if not isinstance(variable, ArraySegment):
            msg = f"invalid iterator value: {variable}, please provide a list."
            raise TypeError(msg)
        iterator_value = variable.to_object()
        if not isinstance(iterator_value, list):
            msg = f"Invalid iterator value: {iterator_value}, please provide a list."
            raise TypeError(msg)
        return cast(list[object], iterator_value)

    def _run_empty_iteration(
        self,
        *,
        variable: NoneSegment | ArraySegment,
        started_at: datetime,
    ) -> Generator[NodeEventPayload, None, None]:
        outputs = {"output": ArrayAnySegment(value=[])}
        if isinstance(variable, ArraySegment):
            outputs = {"output": variable.model_copy(update={"value": []})}
        inputs: dict[str, object] = {"iterator_selector": []}
        yield IterationStartedEvent(
            start_at=started_at,
            inputs=inputs,
            metadata={"iteration_length": 0},
        )
        yield IterationSucceededEvent(
            start_at=started_at,
            inputs=inputs,
            outputs=outputs,
            metadata={},
            steps=0,
        )
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs=outputs,
                inputs=inputs,
            ),
        )

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: IterationNodeData,
    ) -> Mapping[str, Sequence[str]]:
        variable_mapping: dict[str, Sequence[str]] = {
            f"{node_id}.input_selector": node_data.iterator_selector,
        }
        node_configs = {
            node["id"]: node for node in graph_config.get("nodes", []) if "id" in node
        }
        iteration_node_ids = {
            sub_node_id
            for sub_node_id, sub_node_config in node_configs.items()
            if resolve_container_id(sub_node_config, nodes_by_id=node_configs)
            == node_id
        }
        for sub_node_id, sub_node_config in node_configs.items():
            if sub_node_id not in iteration_node_ids:
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

        return {
            key: value
            for key, value in variable_mapping.items()
            if value[0] not in iteration_node_ids
        }
