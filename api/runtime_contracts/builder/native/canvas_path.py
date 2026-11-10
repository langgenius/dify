"""Presentation facts for the edges taken by one Native Test Run."""

from dataclasses import dataclass
from typing import Literal

type NativeCanvasNodeStatus = Literal["running", "retry", "paused", "succeeded", "failed", "exception", "stopped"]


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
