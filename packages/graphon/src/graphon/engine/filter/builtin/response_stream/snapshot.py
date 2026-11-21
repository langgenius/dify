from __future__ import annotations

import json
from importlib import import_module
from types import ModuleType
from typing import Literal, cast

from pydantic import BaseModel, Field

from graphon.engine_events.node import NodeRunStreamChunkEvent
from graphon.runtime.runtime_state import GraphProtocol

type Selector = tuple[str, ...]


class ResponseSessionState(BaseModel):
    """Serializable position within one response template."""

    node_id: str
    index: int = Field(default=0, ge=0)


class StreamBufferState(BaseModel):
    """Serializable stream chunks buffered for one selector."""

    selector: Selector
    events: list[NodeRunStreamChunkEvent] = Field(default_factory=list)


class StreamPositionState(BaseModel):
    """Serializable read position for one buffered stream."""

    selector: Selector
    position: int = Field(default=0, ge=0)


class ResponseStreamFilterSnapshot(BaseModel):
    """Fields shared by every persisted ResponseStreamFilter version."""

    type: Literal["ResponseStreamFilter"] = "ResponseStreamFilter"
    version: str
    response_nodes: list[str] = Field(default_factory=list)
    active_session: ResponseSessionState | None = None
    waiting_sessions: list[ResponseSessionState] = Field(default_factory=list)
    pending_sessions: list[ResponseSessionState] = Field(default_factory=list)
    node_execution_ids: dict[str, str] = Field(default_factory=dict)
    paths_map: dict[str, list[list[str]]] = Field(default_factory=dict)
    stream_buffers: list[StreamBufferState] = Field(default_factory=list)
    stream_positions: list[StreamPositionState] = Field(default_factory=list)
    closed_streams: list[Selector] = Field(default_factory=list)


def loads(data: str) -> ResponseStreamFilterSnapshot:
    """Parse persisted filter state through its version-owned module.

    This shared boundary reads only the ``version`` header, derives the matching
    module name, and delegates the complete schema validation to that module. It has
    no registry, so deleting an old version file removes support without changing
    this dispatcher.

    Args:
        data: JSON produced by a supported ResponseStreamFilter version.

    Returns:
        The exact version model parsed by the selected module.

    Raises:
        TypeError: If the JSON root or version field has the wrong type.
    """
    payload = json.loads(data)
    if not isinstance(payload, dict):
        msg = "ResponseStreamFilter snapshot must be a JSON object"
        raise TypeError(msg)

    version = payload.get("version")
    if not isinstance(version, str):
        msg = "ResponseStreamFilter snapshot must include a string version"
        raise TypeError(msg)

    loader = _version_module(version).loads
    return cast(ResponseStreamFilterSnapshot, loader(data))


def dumps(snapshot: ResponseStreamFilterSnapshot) -> str:
    """Serialize filter state through the module that owns its version.

    Delegation lets a version module prohibit unsafe output until its migration is
    complete while the current module writes its native model. The shared dispatcher
    does not reinterpret or relabel snapshot versions.

    Args:
        snapshot: A snapshot model returned by ``loads`` or created by the filter.

    Returns:
        JSON emitted according to the snapshot's exact version contract.
    """
    dump = _version_module(snapshot.version).dumps
    return cast(str, dump(snapshot))


def for_graph(
    snapshot: ResponseStreamFilterSnapshot,
    graph: GraphProtocol,
) -> ResponseStreamFilterSnapshot:
    """Bind loaded filter state to a graph at the version boundary.

    Current snapshots are returned unchanged. Legacy modules may use the graph to
    translate persisted identifiers and return the current snapshot model. Keeping
    that work behind this dispatch prevents migration rules from entering the filter
    runtime.

    Args:
        snapshot: Exact version state previously returned by ``loads``.
        graph: Root graph that will own the restored filter.

    Returns:
        Snapshot state that the runtime can apply to the bound graph.
    """
    prepare = _version_module(snapshot.version).for_graph
    return cast(ResponseStreamFilterSnapshot, prepare(snapshot, graph))


def _version_module(version: str) -> ModuleType:
    """Resolve the implementation module encoded by a snapshot version.

    Versions use ``major.minor`` syntax and map to a sibling ``v{major}`` module.
    Each module validates its exact minor version. This naming rule is the only
    dispatch mechanism; no import-time registration or compatibility marker exists.

    Args:
        version: Persisted snapshot version such as ``"2.0"``.

    Returns:
        Imported module that owns parsing, serialization, and graph binding.

    Raises:
        ValueError: If the version syntax is invalid or its module is absent.
        ModuleNotFoundError: If the selected module has a missing dependency.
    """
    major, separator, minor = version.partition(".")
    if separator != "." or not major.isdecimal() or not minor.isdecimal():
        msg = f"Unsupported ResponseStreamFilter snapshot version: {version}"
        raise ValueError(msg)

    module_name = f"{__package__}.v{major}"
    try:
        return import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name != module_name:
            raise
        msg = f"Unsupported ResponseStreamFilter snapshot version: {version}"
        raise ValueError(msg) from exc
