"""Discover declared personal tool authorization without runtime or persistence dependencies."""

from collections.abc import Mapping
from typing import Any


def requires_end_user_connections(graph: Mapping[str, Any]) -> bool:
    """Read a workflow graph and report declared personal authentication without I/O.

    Incomplete declarations still require personal authentication. Reuse nodes
    delegate to their declaring node; configuration validation remains separate.
    Neither success nor failure changes the supplied graph or credential state.
    """
    return first_end_user_tool_node(graph) is not None


def first_end_user_tool_node(graph: Mapping[str, Any]) -> str | None:
    """Return the first declaring tool node ID, or None when no node declares it.

    Read graph node declarations without validating unfinished authentication
    settings or resolving credentials. Notes and other node kinds do not qualify.
    Preserve the existing "unknown" ID for a declaration without an identifier.
    """
    return next(
        (
            str(node.get("id", "unknown"))
            for node in graph.get("nodes", [])
            if (
                isinstance(node, Mapping)
                and node.get("type") != "custom-note"
                and isinstance(data := node.get("data"), Mapping)
                and data.get("type") == "tool"
                and data.get("credential_source") == "end_user"
            )
        ),
        None,
    )
