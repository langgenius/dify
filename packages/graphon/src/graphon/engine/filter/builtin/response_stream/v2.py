from __future__ import annotations

from typing import Literal

from graphon.runtime.runtime_state import GraphProtocol

from .snapshot import ResponseStreamFilterSnapshot


class Snapshot(ResponseStreamFilterSnapshot):
    """ResponseStreamFilter snapshot written by Graphon 0.8."""

    version: Literal["2.0"] = "2.0"


def loads(data: str) -> Snapshot:
    """Validate JSON against the exact current version 2 schema.

    Args:
        data: Serialized ResponseStreamFilter state whose version must be ``2.0``.

    Returns:
        Validated native version 2 state.
    """
    return Snapshot.model_validate_json(data)


def dumps(snapshot: ResponseStreamFilterSnapshot) -> str:
    """Serialize native version 2 state without compatibility metadata.

    Args:
        snapshot: State that must be an instance of this module's exact model.

    Returns:
        JSON with the unchanged ``2.0`` version tag and public edge IDs.

    Raises:
        TypeError: If another version model is passed to the v2 writer.
    """
    if not isinstance(snapshot, Snapshot):
        msg = "Expected a version 2 ResponseStreamFilter snapshot"
        raise TypeError(msg)
    return snapshot.model_dump_json()


def for_graph(
    snapshot: ResponseStreamFilterSnapshot,
    graph: GraphProtocol,
) -> Snapshot:
    """Confirm native version 2 state at graph-binding time.

    Version 2 already stores graph-scoped public IDs, so binding requires no graph
    rewrite. This function exists as the version module's uniform dispatch target.

    Args:
        snapshot: State that must be an instance of this module's exact model.
        graph: Bound graph; unused because v2 needs no migration.

    Returns:
        The same validated version 2 snapshot.

    Raises:
        TypeError: If another version model is passed to the v2 binder.
    """
    del graph
    if not isinstance(snapshot, Snapshot):
        msg = "Expected a version 2 ResponseStreamFilter snapshot"
        raise TypeError(msg)
    return snapshot
