from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from typing import Any, override

from graphon.entities.pause_reason import HitlRequired
from graphon.enums import (
    BuiltinNodeTypes,
    NodeExecutionType,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events.base import NodeEventPayload, NodeRunResult
from graphon.node_events.node import PauseRequestedEvent, StreamCompletedEvent
from graphon.nodes.base.node import Node
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.variables.segments import Segment

from .entities import (
    Completed,
    Expired,
    HITLCallback,
    HITLContext,
    HumanInputNodeData,
    PauseRequested,
)

_WORKFLOW_EXECUTION_ID_KEYS = ("workflow_execution_id", "workflow_run_id")
_WORKFLOW_EXECUTION_ID_SELECTORS = (
    ("sys", "workflow_execution_id"),
    ("sys", "workflow_run_id"),
)


class HumanInputNode(Node[HumanInputNodeData]):
    node_type = BuiltinNodeTypes.HUMAN_INPUT
    execution_type = NodeExecutionType.BRANCH

    @override
    def __init__(
        self,
        node_id: str,
        data: HumanInputNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        hitl_callback: HITLCallback,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        self._hitl_callback = hitl_callback

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> Generator[NodeEventPayload, None, None]:
        decision = self._hitl_callback(
            HITLContext(
                workflow_execution_id=self._resolve_workflow_execution_id(),
                node_id=self.id,
                node_title=self.title,
                variable_pool=self.runtime_state.variable_pool,
            )
        )

        match decision:
            case PauseRequested(session_id=session_id):
                yield PauseRequestedEvent(
                    reason=HitlRequired(
                        session_id=session_id,
                        node_id=self.id,
                        node_title=self.title,
                    )
                )
            case Completed(selected_handle=handle, inputs=inputs, outputs=outputs):
                yield self._completed_event(
                    selected_handle=handle,
                    inputs=inputs,
                    outputs=outputs,
                )
            case Expired(selected_handle=handle, outputs=outputs):
                yield self._completed_event(
                    selected_handle=handle,
                    outputs=outputs,
                )
            case _:
                msg = f"unsupported HITL decision: {type(decision).__name__}"
                raise AssertionError(msg)

    def _resolve_workflow_execution_id(self) -> str:
        variable_pool = self.runtime_state.variable_pool
        for selector in _WORKFLOW_EXECUTION_ID_SELECTORS:
            segment = variable_pool.get(selector)
            if segment is not None and segment.text:
                return segment.text

        for key in _WORKFLOW_EXECUTION_ID_KEYS:
            value = self.get_run_context_value(key)
            if isinstance(value, str) and value:
                return value

        msg = "workflow_execution_id is required for HITL"
        raise ValueError(msg)

    @staticmethod
    def _completed_event(
        *,
        selected_handle: str,
        outputs: Mapping[str, Segment],
        inputs: Mapping[str, Segment] | None = None,
    ) -> StreamCompletedEvent:
        return StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={} if inputs is None else inputs,
                outputs=outputs,
                edge_source_handle=selected_handle,
            ),
        )

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: HumanInputNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config, node_id, node_data
        return {}
