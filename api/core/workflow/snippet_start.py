"""Shared snippet virtual Start-node identifiers and compatibility helpers.

Snippet workflows do not persist a real canvas Start node, so the backend
injects one at runtime. Existing workflow references commonly use the public
selector shape ``#start.<var>#``; keep that contract stable by treating the
runtime-only snippet Start node as compatible with the legacy ``start`` id.
"""

from __future__ import annotations

LEGACY_START_NODE_ID = "start"
SNIPPET_VIRTUAL_START_NODE_ID = "__snippet_virtual_start__"


def get_compatible_start_aliases(*, workflow_kind: str | None, root_node_id: str | None) -> tuple[str, ...]:
    """Return additional selector ids that should mirror snippet Start inputs."""
    if workflow_kind == "snippet" and root_node_id == SNIPPET_VIRTUAL_START_NODE_ID:
        return (LEGACY_START_NODE_ID,)

    return ()
