from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Literal, assert_never

from pydantic import BaseModel, ConfigDict, Field

from graphon.enums import ErrorHandleMode, NodeState
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.container_effects import (
    ContainerAwaitRequest,
    ContainerValue,
    CustomContainerRequest,
    IterationFrameRequest,
    LoopFrameRequest,
)
from graphon.runtime.variable_pool import VariablePool


class FrameRuntimeData(BaseModel):
    """Serializable runtime data needed to rebuild one execution frame."""

    model_config = ConfigDict(frozen=True)

    # Local snapshot, or a marker to rebind the parent frame's shared pool.
    variable_pool: VariablePool | Literal["parent"]
    outputs: Mapping[str, object]
    llm_usage: LLMUsage
    node_run_steps: int
    graph_node_states: Mapping[str, NodeState]
    graph_edge_states: Mapping[str, NodeState]


class LoopRunState(BaseModel):
    """Serializable state for one Loop node invocation."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["loop"] = "loop"
    invocation_id: str
    frame_id: str
    node_id: str
    started_at: datetime
    inputs: Mapping[str, ContainerValue]
    outputs: Mapping[str, ContainerValue]
    loop_count: int
    root_node_id: str
    loop_variable_selectors: Mapping[str, tuple[str, ...]]
    loop_node_ids: frozenset[str]
    duration_map: Mapping[str, float] = Field(default_factory=dict)
    variable_map: Mapping[str, Mapping[str, ContainerValue]] = Field(
        default_factory=dict,
    )
    usage: LLMUsage = Field(default_factory=LLMUsage.empty_usage)
    completed_count: int = 0
    reached_break: bool = False


class IterationRunState(BaseModel):
    """Serializable state for one Iteration node invocation."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["iteration"] = "iteration"
    invocation_id: str
    frame_id: str
    node_id: str
    started_at: datetime
    items: tuple[ContainerValue, ...]
    root_node_id: str
    output_selector: tuple[str, ...]
    error_handle_mode: ErrorHandleMode
    flatten_output: bool
    parallel_nums: int
    outputs: Mapping[str, ContainerValue] = Field(default_factory=dict)
    duration_map: Mapping[str, float] = Field(default_factory=dict)
    usage: LLMUsage = Field(default_factory=LLMUsage.empty_usage)
    scheduled_count: int = 0
    completed_count: int = 0
    resume_pending: bool = False
    errors: tuple[str, ...] = ()


class CustomContainerRunState(BaseModel):
    """Serializable state for one custom container invocation."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["custom"] = "custom"
    invocation_id: str
    frame_id: str
    node_id: str
    started_at: datetime
    payload: str


ContainerRunState = Annotated[
    LoopRunState | IterationRunState | CustomContainerRunState,
    Field(discriminator="kind"),
]


def create_container_run_state(
    *,
    invocation_id: str,
    frame_id: str,
    node_id: str,
    started_at: datetime,
    request: ContainerAwaitRequest,
) -> ContainerRunState:
    match request:
        case LoopFrameRequest():
            return LoopRunState(
                invocation_id=invocation_id,
                frame_id=frame_id,
                node_id=node_id,
                started_at=started_at,
                inputs=request.inputs,
                outputs=request.outputs,
                loop_count=request.loop_count,
                root_node_id=request.root_node_id,
                loop_variable_selectors=request.loop_variable_selectors,
                loop_node_ids=request.loop_node_ids,
            )
        case IterationFrameRequest():
            return IterationRunState(
                invocation_id=invocation_id,
                frame_id=frame_id,
                node_id=node_id,
                started_at=started_at,
                items=request.items,
                root_node_id=request.root_node_id,
                output_selector=request.output_selector,
                error_handle_mode=request.error_handle_mode,
                flatten_output=request.flatten_output,
                parallel_nums=request.parallel_nums,
            )
        case CustomContainerRequest():
            return CustomContainerRunState(
                invocation_id=invocation_id,
                frame_id=frame_id,
                node_id=node_id,
                started_at=started_at,
                payload=request.payload,
            )
        case _:
            assert_never(request)


class LoopFrameState(BaseModel):
    """Serializable state for one Loop child frame."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["loop"] = "loop"
    frame_id: str
    parent_invocation_id: str
    root_node_id: str
    index: int
    started_at: datetime
    reached_break: bool = False
    errors: tuple[str, ...] = ()
    runtime_data: FrameRuntimeData


class IterationFrameState(BaseModel):
    """Serializable state for one Iteration child frame."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["iteration"] = "iteration"
    frame_id: str
    parent_invocation_id: str
    root_node_id: str
    index: int
    started_at: datetime
    errors: tuple[str, ...] = ()
    runtime_data: FrameRuntimeData


class CustomContainerFrameState(BaseModel):
    """Serializable state for one custom container child frame."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["custom"] = "custom"
    frame_id: str
    parent_invocation_id: str
    runtime_data: FrameRuntimeData


ContainerFrameState = Annotated[
    LoopFrameState | IterationFrameState | CustomContainerFrameState,
    Field(discriminator="kind"),
]
