from __future__ import annotations

from core.app.file_access.run_grants import FileAccessRunGrants
from core.app.file_access.scope import bind_file_access_run_grants
from graphon.runtime import GraphRuntimeState

_FILE_ACCESS_RUN_GRANTS_ATTR = "_dify_file_access_run_grants"


def attach_file_access_run_grants(graph_runtime_state: GraphRuntimeState) -> FileAccessRunGrants:
    """Attach (or reuse) run-scoped file grants on a workflow graph runtime state."""
    existing = getattr(graph_runtime_state, _FILE_ACCESS_RUN_GRANTS_ATTR, None)
    if not isinstance(existing, FileAccessRunGrants):
        existing = FileAccessRunGrants()
        setattr(graph_runtime_state, _FILE_ACCESS_RUN_GRANTS_ATTR, existing)
    bind_file_access_run_grants(existing)
    return existing
