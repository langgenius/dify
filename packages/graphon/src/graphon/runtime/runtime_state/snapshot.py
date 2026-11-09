from __future__ import annotations

# Version codecs are package internals and intentionally stage migration state.
# ruff: file-ignore[private-member-access]
import importlib
from collections.abc import Callable
from typing import TYPE_CHECKING, Protocol, cast

from pydantic import BaseModel, ConfigDict, Field

from graphon.enums import NodeState
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime.container_state import ContainerFrameState, ContainerRunState
from graphon.runtime.execution import GraphExecution
from graphon.runtime.ready_queue import ReadyQueue
from graphon.runtime.variable_pool import VariablePool

from .protocol import GraphProtocol

if TYPE_CHECKING:
    from .state import RuntimeState


ReadyQueueFactory = Callable[[], ReadyQueue]
GraphStateMigration = Callable[["RuntimeState", GraphProtocol], None]


class BaseSnapshot(BaseModel):
    """Fields persisted by every RuntimeState snapshot version."""

    model_config = ConfigDict(frozen=True)

    start_at: float
    node_run_steps: int = Field(ge=0)
    llm_usage: LLMUsage
    outputs: dict[str, object]
    variable_pool: VariablePool
    ready_queue: str
    graph_execution: str


class FrameSnapshot(BaseSnapshot):
    """Frame-aware fields shared without change by snapshot versions 2 and 3."""

    deferred_ready_tasks: str
    container_runs: tuple[ContainerRunState, ...]
    container_frames: tuple[ContainerFrameState, ...]
    graph_node_states: dict[str, NodeState]
    graph_edge_states: dict[str, NodeState]


class _SnapshotVersion(BaseModel):
    """Minimal envelope used to select a version module before full validation."""

    model_config = ConfigDict(frozen=True)

    version: str


class _VersionModule(Protocol):
    """Callable surface implemented independently by every version module."""

    def loads(
        self,
        data: str,
        *,
        state_type: type[RuntimeState],
        ready_queue_factory: ReadyQueueFactory,
    ) -> RuntimeState: ...


def new_state(
    snapshot: BaseSnapshot,
    *,
    state_type: type[RuntimeState],
    ready_queue: ReadyQueue,
    deferred_ready_queue: ReadyQueue,
) -> RuntimeState:
    """Construct RuntimeState fields shared by every persisted version.

    Args:
        snapshot: Validated version-specific model containing the common fields.
        state_type: RuntimeState class selected by the public classmethod caller.
        ready_queue: Restored queue containing immediately runnable tasks.
        deferred_ready_queue: Restored queue containing pause-deferred tasks.

    Returns:
        A mutable runtime state with its execution aggregate and task queues set.

    """
    return state_type(
        variable_pool=snapshot.variable_pool,
        start_at=snapshot.start_at,
        llm_usage=snapshot.llm_usage,
        outputs=snapshot.outputs,
        node_run_steps=snapshot.node_run_steps,
        ready_queue=ready_queue,
        deferred_ready_queue=deferred_ready_queue,
        graph_execution=GraphExecution.from_snapshot(snapshot.graph_execution),
    )


def restore_frame_snapshot(
    snapshot: FrameSnapshot,
    *,
    state_type: type[RuntimeState],
    ready_queue_factory: ReadyQueueFactory,
    graph_state_migration: GraphStateMigration | None = None,
) -> RuntimeState:
    """Restore fields shared by frame-aware snapshot versions 2 and 3.

    Version modules validate their exact version before calling this helper.
    The optional migration is staged only when graph state exists, because an
    empty pre-attachment snapshot is already valid for any subsequently bound
    graph. The migration runs later from ``RuntimeState.attach_graph()``.

    Args:
        snapshot: Fully validated version-specific frame snapshot.
        state_type: RuntimeState class selected by the public classmethod caller.
        ready_queue_factory: Factory used to create both restored task queues.
        graph_state_migration: Optional graph-aware conversion owned by the
            selected version module.

    Returns:
        Restored runtime state ready for graph attachment or execution.

    """
    ready_queue = ready_queue_factory()
    ready_queue.loads(snapshot.ready_queue)
    deferred_ready_queue = ready_queue_factory()
    deferred_ready_queue.loads(snapshot.deferred_ready_tasks)
    state = new_state(
        snapshot,
        state_type=state_type,
        ready_queue=ready_queue,
        deferred_ready_queue=deferred_ready_queue,
    )
    for run in snapshot.container_runs:
        state.put_container_run(run)
    for frame in snapshot.container_frames:
        state.put_container_frame(frame)
    if snapshot.graph_node_states or snapshot.graph_edge_states:
        state.restore_graph_state(
            node_states=snapshot.graph_node_states,
            edge_states=snapshot.graph_edge_states,
        )
        state._graph_state_migration = graph_state_migration
    return state


def load_snapshot(
    data: str,
    *,
    state_type: type[RuntimeState],
    ready_queue_factory: ReadyQueueFactory,
) -> RuntimeState:
    """Load RuntimeState with the module derived from its serialized version.

    Only the version envelope is parsed here. ``<major>.0`` maps directly to
    ``runtime_state.v<major>``, whose ``loads()`` function owns all schema
    validation and migration for that version. There is intentionally no registry:
    deleting an old module removes its support without edits or import-time
    registration elsewhere.

    Args:
        data: Serialized runtime-state JSON.
        state_type: RuntimeState class selected by the public classmethod caller.
        ready_queue_factory: Factory passed unchanged to the version loader.

    Returns:
        Runtime state restored by the exact serialized-version module.

    Raises:
        ValueError: If the version does not have the ``<positive integer>.0``
            format or its derived module does not exist.
        ModuleNotFoundError: If a supported version module exists but one of its
            own imports is missing; this is not treated as an unsupported version.

    """
    version = _SnapshotVersion.model_validate_json(data).version
    major, separator, minor = version.partition(".")
    if (
        separator != "."
        or minor != "0"
        or not major.isascii()
        or not major.isdigit()
        or major.startswith("0")
    ):
        msg = f"Unsupported RuntimeState snapshot version {version!r}"
        raise ValueError(msg)
    module_name = f"{__package__}.v{major}"
    try:
        module = cast(_VersionModule, importlib.import_module(module_name))
    except ModuleNotFoundError as exc:
        if exc.name != module_name:
            raise
        msg = f"Unsupported RuntimeState snapshot version {version!r}"
        raise ValueError(msg) from exc
    return module.loads(
        data,
        state_type=state_type,
        ready_queue_factory=ready_queue_factory,
    )
