"""Container ownership rules used while materializing graph scopes."""

from collections.abc import Mapping
from typing import Any

from graphon.entities.base_node_data import BaseNodeData


def _container_candidates(  # ruff:ignore[complex-structure]
    node_config: Mapping[str, Any],
) -> tuple[str, ...]:
    """Return all possible direct owners encoded by one node configuration.

    New graphs have one authoritative ``data.container_id``. Older Dify graphs
    may instead use React Flow's top-level ``parentId`` or carry both a nearest
    Iteration ID and a nearest Loop ID. This function validates those trust-boundary
    fields without guessing which of two legacy containers is the direct owner.

    Args:
        node_config: Raw persisted node configuration.

    Returns:
        Zero, one, or two non-empty candidate container IDs in legacy field order.

    Raises:
        TypeError: If any ownership field has a non-string value.

    """
    node_id = node_config.get("id")
    node_label = repr(node_id) if isinstance(node_id, str) else "<unknown>"
    data = node_config.get("data")
    if isinstance(data, BaseNodeData):
        data = data.model_dump(mode="python", exclude_unset=True)
    elif not isinstance(data, Mapping):
        data = {}

    if "container_id" in data:
        container_id = data["container_id"]
        if not isinstance(container_id, str):
            msg = f"Node {node_label} data.container_id must be a string"
            raise TypeError(msg)
        return (container_id,) if container_id else ()

    parent_id = node_config.get("parentId")
    if parent_id is not None:
        if not isinstance(parent_id, str):
            msg = f"Node {node_label} parentId must be a string"
            raise TypeError(msg)
        if parent_id:
            return (parent_id,)

    candidates: list[str] = []
    for field in ("iteration_id", "loop_id"):
        owner = data.get(field)
        if owner is not None and not isinstance(owner, str):
            msg = f"Node {node_label} data.{field} must be a string"
            raise TypeError(msg)
        if isinstance(owner, str) and owner and owner not in candidates:
            candidates.append(owner)
    return tuple(candidates)


def resolve_container_id(  # ruff:ignore[complex-structure]
    node_config: Mapping[str, Any],
    *,
    nodes_by_id: Mapping[str, Mapping[str, Any]] | None = None,
) -> str:
    """Resolve the container that directly owns one persisted graph node.

    Explicit ``container_id`` and ``parentId`` values resolve immediately. When
    both legacy ``iteration_id`` and ``loop_id`` are present, their order cannot
    describe whether a Loop contains an Iteration or vice versa. The surrounding
    container configs do: the candidate that can reach the other through owner
    references is the inner, direct owner. A genuinely ambiguous legacy shape is
    rejected instead of being silently placed in the wrong execution frame.

    TODO: Remove the two-candidate inference after legacy Loop/Iteration fields
    are no longer accepted in persisted DSLs.

    Args:
        node_config: Raw persisted node configuration to resolve.
        nodes_by_id: All nodes visible in the graph config, required only when
            two different legacy owners must be ordered.

    Returns:
        The direct container ID, or ``""`` for a root node.

    Raises:
        ValueError: If two legacy owners cannot be ordered from the graph hierarchy.

    """
    candidates = _container_candidates(node_config)
    if len(candidates) <= 1:
        return candidates[0] if candidates else ""
    if nodes_by_id is None:
        msg = "Nested legacy containers require the surrounding graph config"
        raise ValueError(msg)

    first, second = candidates
    descendant_by_candidate: dict[str, bool] = {}
    for candidate, possible_ancestor in ((first, second), (second, first)):
        pending = [candidate]
        visited: set[str] = set()
        found = False
        while pending and not found:
            current = pending.pop()
            if current in visited:
                continue
            visited.add(current)
            current_config = nodes_by_id.get(current)
            if current_config is None:
                continue
            for owner in _container_candidates(current_config):
                if owner == possible_ancestor:
                    found = True
                    break
                if owner not in visited:
                    pending.append(owner)
        descendant_by_candidate[candidate] = found

    first_is_inner = descendant_by_candidate[first]
    second_is_inner = descendant_by_candidate[second]
    if first_is_inner != second_is_inner:
        return first if first_is_inner else second

    node_id = node_config.get("id")
    node_label = repr(node_id) if isinstance(node_id, str) else "<unknown>"
    msg = (
        f"Node {node_label} has ambiguous legacy container owners; "
        "set data.container_id"
    )
    raise ValueError(msg)
