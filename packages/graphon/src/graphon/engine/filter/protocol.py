from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

from graphon.engine_events.base import EngineEvent
from graphon.file.protocols import WorkflowFileRuntimeProtocol
from graphon.file.runtime import peek_workflow_file_runtime
from graphon.graph.graph import Graph
from graphon.runtime.read_only_wrappers import ReadOnlyRuntimeStateWrapper
from graphon.runtime.runtime_state_protocol import ReadOnlyRuntimeState

if TYPE_CHECKING:
    from graphon.engine.engine import Engine


@dataclass(frozen=True)
class EngineEventFilterContext:
    """Run-scoped context available to engine event filters."""

    graph: Graph
    runtime_state: ReadOnlyRuntimeState
    file_runtime: WorkflowFileRuntimeProtocol | None = field(
        default_factory=peek_workflow_file_runtime,
    )

    @classmethod
    def from_engine(cls, engine: Engine) -> EngineEventFilterContext:
        return cls(
            graph=engine.graph,
            runtime_state=ReadOnlyRuntimeStateWrapper(
                engine.runtime_state,
            ),
            file_runtime=engine.file_runtime,
        )


class EngineEventFilter(Protocol):
    """Event-to-event transform used outside Engine execution."""

    def initialize(self, context: EngineEventFilterContext) -> None: ...

    def on_event(self, event: EngineEvent) -> Iterable[EngineEvent]: ...

    def flush(self) -> Iterable[EngineEvent]: ...
