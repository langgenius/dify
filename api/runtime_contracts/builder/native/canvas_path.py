"""Presentation facts for the edges taken by one Native Test Run."""

from dataclasses import dataclass

from runtime_contracts.builder.string_enum import BuilderStringEnum


class NativeCanvasStatus(BuilderStringEnum):
    RUNNING = "running"
    RETRY = "retry"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    EXCEPTION = "exception"
    STOPPED = "stopped"


type NativeCanvasNodeStatus = NativeCanvasStatus


@dataclass(frozen=True, slots=True)
class NativeCanvasEdge:
    """A taken edge in the executed graph, with the states used by the canvas renderer."""

    edge_id: str | None
    source: str
    target: str
    source_handle: str
    target_handle: str
    source_status: NativeCanvasNodeStatus | None = None
    target_status: NativeCanvasNodeStatus | None = None


@dataclass(frozen=True, slots=True)
class NativeCanvasPath:
    """Cumulative path for one Run; revision orders visual changes across resumes."""

    native_run_id: str
    revision: int
    edges: tuple[NativeCanvasEdge, ...]
