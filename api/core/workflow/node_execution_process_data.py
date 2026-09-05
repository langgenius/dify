from collections.abc import Mapping
from typing import Any

WORKFLOW_AGENT_BINDING_ID_KEY = "workflow_agent_binding_id"
WORKFLOW_TOOL_INVOCATION_ID_KEY = "workflow_tool_invocation_id"


def preserve_workflow_agent_identity(
    identity_source: Mapping[str, Any] | None,
    process_data: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    """Keep persisted Agent participant identity through node event updates."""
    merged = dict(process_data or {})
    for key in (WORKFLOW_AGENT_BINDING_ID_KEY, WORKFLOW_TOOL_INVOCATION_ID_KEY):
        source_id = (identity_source or {}).get(key)
        target_id = (process_data or {}).get(key)
        for value in (source_id, target_id):
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{key} must be a string")
        if source_id is not None and target_id is not None and source_id != target_id:
            raise ValueError(f"{key} does not match")
        if source_id is not None:
            merged[key] = source_id
    return None if process_data is None and not merged else merged


def workflow_agent_workspace_scope_key(
    node_id: str, workflow_agent_binding_id: str, workflow_tool_invocation_id: str | None = None
) -> str:
    """Partition repeated Tool calls without splitting loop executions inside a call."""
    scope_key = f"{node_id}:{workflow_agent_binding_id}"
    if workflow_tool_invocation_id is not None:
        return f"workflow-tool:{workflow_tool_invocation_id}:{scope_key}"
    return scope_key


__all__ = [
    "WORKFLOW_AGENT_BINDING_ID_KEY",
    "WORKFLOW_TOOL_INVOCATION_ID_KEY",
    "preserve_workflow_agent_identity",
    "workflow_agent_workspace_scope_key",
]
