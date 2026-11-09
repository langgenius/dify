"""Built-in loop container handler."""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
from typing import final

from graphon.engine_events.base import NodeEvent
from graphon.engine_events.node import (
    NodeRunFailedEvent,
    NodeRunSucceededEvent,
    NodeRunVariableUpdatedEvent,
)
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.nodes.container_effects import (
    ContainerAwaitRequest,
    ContainerExecutionResult,
    ContainerNodeRunResult,
    LoopFrameRequest,
    build_container_value,
)
from graphon.nodes.loop.loop_node import LoopNode
from graphon.runtime.container_state import (
    ContainerFrameState,
    LoopFrameState,
    LoopRunState,
)
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.runtime.ready_queue import ResumeTask
from graphon.runtime.runtime_state import RuntimeState
from graphon.utils.condition.processor import ConditionProcessor
from graphon.variables.segments import SerializableSegment

from ...frame import ExecutionFrame, FrameRegistry


@final
class LoopContainerHandler:
    node_type = BuiltinNodeTypes.LOOP

    def __init__(
        self,
        frame_registry: FrameRegistry,
    ) -> None:
        self._frame_registry = frame_registry

    def restore_frame(self, frame_state: ContainerFrameState) -> None:
        if not isinstance(frame_state, LoopFrameState):
            msg = f"loop handler cannot restore {frame_state.kind} frame"
            raise TypeError(msg)
        root_runtime_state = self._root_runtime_state()
        run_state = root_runtime_state.get_container_run(
            frame_state.parent_invocation_id,
        )
        if not isinstance(run_state, LoopRunState):
            msg = f"loop frame cannot belong to {run_state.kind} run"
            raise TypeError(msg)
        variable_pool = frame_state.runtime_data.variable_pool
        inherited_parent_pool = isinstance(variable_pool, str)
        if inherited_parent_pool:
            variable_pool = self._frame_registry[run_state.frame_id].state.variable_pool
        frame = self._frame_registry.restore_child(
            frame_id=frame_state.frame_id,
            parent_frame_id=run_state.frame_id,
            container_id=run_state.node_id,
            root_node_id=frame_state.root_node_id,
            runtime_data=frame_state.runtime_data,
            variable_pool=variable_pool.model_copy(deep=True),
        )
        if inherited_parent_pool:
            root_runtime_state.put_container_frame(
                frame_state.model_copy(
                    update={
                        "runtime_data": frame.state.snapshot_frame(),
                    },
                ),
            )

    def handle_request(
        self,
        *,
        invocation_id: str,
        request: ContainerAwaitRequest,
    ) -> None:
        """Start the next loop frame requested by a suspended Loop node.

        The request and persisted run state are validated before evaluating the
        break condition against the parent frame. A satisfied break resumes the
        parent with a terminal result; otherwise a new scoped child is started.

        Raises:
            TypeError: If the request, stored run, or owning graph node is not
                a loop value.

        """
        if not isinstance(request, LoopFrameRequest):
            msg = f"loop handler cannot handle {type(request).__name__}"
            raise TypeError(msg)

        run_state = self._root_runtime_state().get_container_run(invocation_id)
        if not isinstance(run_state, LoopRunState):
            msg = f"loop handler cannot continue {run_state.kind} run"
            raise TypeError(msg)
        parent_frame = self._frame_registry[run_state.frame_id]
        node = parent_frame.graph.nodes[run_state.node_id]
        if not isinstance(node, LoopNode):
            msg = f"node {run_state.node_id} cannot handle loop await requests"
            raise TypeError(msg)
        if self._loop_break_conditions_reached(
            frame=parent_frame,
            node=node,
            suppress_errors=True,
        ):
            run_state = run_state.model_copy(
                update={"reached_break": True},
            )
            self._root_runtime_state().put_container_run(run_state)
            self._enqueue_container_result(
                runtime_state=parent_frame.state,
                invocation_id=run_state.invocation_id,
                result=self._complete_loop(
                    run_state=run_state,
                    steps=0,
                ),
            )
            return

        self._start_loop_frame(
            parent_frame=parent_frame,
            run_state=run_state,
            request=request,
        )

    def prepare_frame_event(
        self,
        *,
        frame: ExecutionFrame,
        event: NodeEvent,
    ) -> None:
        root_runtime_state = self._root_runtime_state()
        frame_state = root_runtime_state.get_container_frame(frame.frame_id)
        if not isinstance(frame_state, LoopFrameState):
            msg = f"loop handler cannot prepare {frame_state.kind} frame"
            raise TypeError(msg)
        run_state = root_runtime_state.get_container_run(
            frame_state.parent_invocation_id,
        )
        if not isinstance(run_state, LoopRunState):
            msg = f"loop frame cannot belong to {run_state.kind} run"
            raise TypeError(msg)
        # Frame creation deep-copies variables. Identity therefore survives only
        # across Loop write-backs and naturally stops at isolated containers.
        if (
            isinstance(event, NodeRunVariableUpdatedEvent)
            and frame.state.variable_pool.get_variable(event.variable.selector)
            is event.variable
        ):
            parent_pool = self._frame_registry[run_state.frame_id].state.variable_pool
            if parent_pool.get_variable(event.variable.selector) is not None:
                parent_pool.add(event.variable.selector, event.variable)
        loop_metadata = {
            WorkflowNodeExecutionMetadataKey.LOOP_ID: run_state.node_id,
            WorkflowNodeExecutionMetadataKey.LOOP_INDEX: frame_state.index,
        }
        current_metadata = event.node_run_result.metadata
        if WorkflowNodeExecutionMetadataKey.LOOP_ID not in current_metadata:
            event.node_run_result.metadata = {
                **current_metadata,
                **loop_metadata,
            }
        if (
            isinstance(event, NodeRunSucceededEvent)
            and event.node_type == BuiltinNodeTypes.LOOP_END
            and event.node_id in run_state.loop_node_ids
        ):
            root_runtime_state.put_container_frame(
                frame_state.model_copy(
                    update={"reached_break": True},
                ),
            )

    def should_emit(
        self,
        *,
        event: NodeEvent,
    ) -> bool:
        """Hide the synthetic Loop Start event from outer observers."""
        return event.node_type != BuiltinNodeTypes.LOOP_START

    def record_frame_failure(
        self,
        *,
        frame: ExecutionFrame,
        event: NodeRunFailedEvent,
    ) -> None:
        frame_state = self._root_runtime_state().get_container_frame(frame.frame_id)
        if not isinstance(frame_state, LoopFrameState):
            msg = f"loop handler cannot fail {frame_state.kind} frame"
            raise TypeError(msg)
        self._root_runtime_state().put_container_frame(
            frame_state.model_copy(
                update={"errors": (*frame_state.errors, event.error)},
            ),
        )

    def complete_frame_if_ready(self, frame: ExecutionFrame) -> None:
        """Finalize and remove a loop frame once all its nodes finish.

        The completed step updates loop variables, usage, and duration before
        either scheduling the next round or resuming the parent. Frames that
        still have unfinished nodes are left untouched.

        Raises:
            TypeError: If restored container state has inconsistent types.
            ValueError: If a completed child lacks a required loop variable.

        """
        if not frame.scheduler.is_execution_complete():
            return

        root_runtime_state = self._root_runtime_state()
        frame_state = root_runtime_state.get_container_frame(frame.frame_id)
        if not isinstance(frame_state, LoopFrameState):
            msg = f"loop handler cannot complete {frame_state.kind} frame"
            raise TypeError(msg)
        try:
            self._complete_ready_loop_frame(
                frame=frame,
                frame_state=frame_state,
            )
        except (TypeError, ValueError) as error:
            run_state = root_runtime_state.get_container_run(
                frame_state.parent_invocation_id,
            )
            if not isinstance(run_state, LoopRunState):
                raise
            parent_frame = self._frame_registry[run_state.frame_id]
            self._enqueue_container_result(
                runtime_state=parent_frame.state,
                invocation_id=run_state.invocation_id,
                result=self._fail_loop(run_state=run_state, error=str(error)),
            )
        finally:
            root_runtime_state.pop_container_frame(frame.frame_id)
            self._frame_registry.remove(frame.frame_id)

    def _complete_ready_loop_frame(
        self,
        *,
        frame: ExecutionFrame,
        frame_state: LoopFrameState,
    ) -> None:
        root_runtime_state = self._root_runtime_state()
        run_state = root_runtime_state.get_container_run(
            frame_state.parent_invocation_id,
        )
        if not isinstance(run_state, LoopRunState):
            msg = f"loop frame cannot complete {run_state.kind} run"
            raise TypeError(msg)
        parent_frame = self._frame_registry[run_state.frame_id]
        node = parent_frame.graph.nodes[run_state.node_id]
        if not isinstance(node, LoopNode):
            msg = f"node {run_state.node_id} is not a loop"
            raise TypeError(msg)

        run_state = self._complete_loop_step(
            frame=frame,
            frame_state=frame_state,
            parent_frame=parent_frame,
            run_state=run_state,
        )
        if frame_state.errors:
            self._enqueue_container_result(
                runtime_state=parent_frame.state,
                invocation_id=run_state.invocation_id,
                result=self._fail_loop(
                    run_state=run_state,
                    error=frame_state.errors[0],
                ),
            )
            return

        if frame_state.reached_break or (
            self._loop_break_conditions_reached(
                frame=frame,
                node=node,
                suppress_errors=False,
            )
        ):
            run_state = run_state.model_copy(
                update={"reached_break": True},
            )
            self._root_runtime_state().put_container_run(run_state)

        if run_state.reached_break or run_state.completed_count >= run_state.loop_count:
            self._enqueue_container_result(
                runtime_state=parent_frame.state,
                invocation_id=run_state.invocation_id,
                result=self._complete_loop(
                    run_state=run_state,
                    steps=run_state.loop_count,
                ),
            )
            return

        self._enqueue_container_result(
            runtime_state=parent_frame.state,
            invocation_id=run_state.invocation_id,
            result=LoopFrameRequest(
                inputs=run_state.inputs,
                outputs=run_state.outputs,
                loop_count=run_state.loop_count,
                root_node_id=run_state.root_node_id,
                loop_variable_selectors=run_state.loop_variable_selectors,
                loop_node_ids=run_state.loop_node_ids,
                index=run_state.completed_count,
            ),
        )

    def _start_loop_frame(
        self,
        *,
        parent_frame: ExecutionFrame,
        run_state: LoopRunState,
        request: LoopFrameRequest,
    ) -> None:
        variable_pool = parent_frame.state.variable_pool.model_copy(
            deep=True,
        )
        for node_id in request.loop_node_ids:
            variable_pool.remove([node_id])
        # The parent pool is authoritative: loop assignments are written back as
        # events, and external commands may update it between completed rounds.
        # ``run_state.outputs`` is only a reporting snapshot of the prior round.
        child_frame_id = f"{run_state.invocation_id}:loop:{request.index}"
        child_frame = self._frame_registry.create_child(
            frame_id=child_frame_id,
            parent_frame_id=parent_frame.frame_id,
            container_id=run_state.node_id,
            root_node_id=request.root_node_id,
            variable_pool=variable_pool,
        )
        self._root_runtime_state().put_container_frame(
            LoopFrameState(
                frame_id=child_frame_id,
                parent_invocation_id=run_state.invocation_id,
                root_node_id=request.root_node_id,
                index=request.index,
                started_at=datetime.now(UTC).replace(tzinfo=None),
                runtime_data=child_frame.state.snapshot_frame(
                    copy_variable_pool=False,
                ),
            ),
        )
        child_frame.scheduler.enqueue_node(request.root_node_id)

    def _complete_loop_step(
        self,
        *,
        frame: ExecutionFrame,
        frame_state: LoopFrameState,
        parent_frame: ExecutionFrame,
        run_state: LoopRunState,
    ) -> LoopRunState:
        completed_count = run_state.completed_count + 1
        usage = run_state.usage.plus(frame.state.llm_usage)
        duration_map = dict(run_state.duration_map)
        loop_index = frame_state.index
        duration_map[str(loop_index)] = (
            datetime.now(UTC).replace(tzinfo=None) - frame_state.started_at
        ).total_seconds()
        outputs = dict(run_state.outputs)
        variable_map = {
            key: dict(value) for key, value in run_state.variable_map.items()
        }
        loop_variable_values: dict[str, SerializableSegment] = {}
        for key, selector in run_state.loop_variable_selectors.items():
            segment = frame.state.variable_pool.get(selector)
            if segment is None:
                msg = f"loop variable {key} is missing"
                raise ValueError(msg)
            loop_variable_values[key] = build_container_value(segment)
        variable_map[str(loop_index)] = loop_variable_values
        if not frame_state.errors:
            parent_frame.state.merge_response_outputs(
                frame.state.outputs,
            )
        outputs.update(loop_variable_values)
        outputs["loop_round"] = build_container_value(loop_index + 1)
        updated_run_state = run_state.model_copy(
            update={
                "completed_count": completed_count,
                "duration_map": duration_map,
                "outputs": outputs,
                "variable_map": variable_map,
                "usage": usage,
            },
        )
        self._root_runtime_state().put_container_run(updated_run_state)
        return updated_run_state

    def _complete_loop(
        self,
        *,
        run_state: LoopRunState,
        steps: int,
    ) -> ContainerExecutionResult:
        metadata = self._loop_metadata(run_state)
        loop_metadata = self._event_metadata(metadata)
        loop_metadata[WorkflowNodeExecutionMetadataKey.COMPLETED_REASON.value] = (
            "loop_break" if run_state.reached_break else "loop_completed"
        )
        return ContainerExecutionResult(
            metadata=loop_metadata,
            steps=steps,
            node_run_result=ContainerNodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                metadata=metadata,
                outputs=run_state.outputs,
                inputs=run_state.inputs,
                llm_usage=run_state.usage,
            ),
        )

    def _fail_loop(
        self,
        *,
        run_state: LoopRunState,
        error: str,
    ) -> ContainerExecutionResult:
        metadata = self._loop_metadata(run_state)
        loop_metadata = self._event_metadata(metadata)
        loop_metadata[WorkflowNodeExecutionMetadataKey.COMPLETED_REASON.value] = "error"
        return ContainerExecutionResult(
            metadata=loop_metadata,
            steps=run_state.loop_count,
            node_run_result=ContainerNodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=error,
                metadata=metadata,
                inputs=run_state.inputs,
                llm_usage=run_state.usage,
            ),
        )

    def _enqueue_container_result(
        self,
        *,
        runtime_state: RuntimeState,
        invocation_id: str,
        result: ContainerExecutionResult | LoopFrameRequest,
    ) -> None:
        runtime_state.enqueue_ready_task(
            ResumeTask(invocation_id=invocation_id, result=result),
        )

    def _loop_metadata(
        self,
        run_state: LoopRunState,
    ) -> dict[WorkflowNodeExecutionMetadataKey, object]:
        return {
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: run_state.usage.total_tokens,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: run_state.usage.total_price,
            WorkflowNodeExecutionMetadataKey.CURRENCY: run_state.usage.currency,
            WorkflowNodeExecutionMetadataKey.LOOP_DURATION_MAP: run_state.duration_map,
            WorkflowNodeExecutionMetadataKey.LOOP_VARIABLE_MAP: {
                index: {key: value.to_object() for key, value in variables.items()}
                for index, variables in run_state.variable_map.items()
            },
        }

    def _event_metadata(
        self,
        metadata: dict[WorkflowNodeExecutionMetadataKey, object],
    ) -> dict[str, object]:
        return {key.value: value for key, value in metadata.items()}

    def _loop_break_conditions_reached(
        self,
        *,
        frame: ExecutionFrame,
        node: LoopNode,
        suppress_errors: bool,
    ) -> bool:
        if not node.node_data.break_conditions:
            return False
        condition_processor = ConditionProcessor()
        if suppress_errors:
            with contextlib.suppress(ValueError):
                _, _, result = condition_processor.process_conditions(
                    variable_pool=frame.state.variable_pool,
                    conditions=node.node_data.break_conditions,
                    operator=node.node_data.logical_operator,
                )
                return result
            return False

        _, _, result = condition_processor.process_conditions(
            variable_pool=frame.state.variable_pool,
            conditions=node.node_data.break_conditions,
            operator=node.node_data.logical_operator,
        )
        return result

    def _root_runtime_state(self) -> RuntimeState:
        return self._frame_registry[ROOT_FRAME_ID].state
