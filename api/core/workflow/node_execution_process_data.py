from collections.abc import Mapping
from typing import Any

WORKFLOW_AGENT_BINDING_ID_KEY = "workflow_agent_binding_id"


def preserve_workflow_agent_binding_id(
    identity_source: Mapping[str, Any] | None,
    process_data: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    source_id = (identity_source or {}).get(WORKFLOW_AGENT_BINDING_ID_KEY)
    target_id = (process_data or {}).get(WORKFLOW_AGENT_BINDING_ID_KEY)
    for value in (source_id, target_id):
        if value is not None and not isinstance(value, str):
            raise ValueError("workflow_agent_binding_id must be a string")
    if source_id is not None and target_id is not None and source_id != target_id:
        raise ValueError("workflow_agent_binding_id does not match")

    if process_data is None and source_id is None:
        return None
    merged = dict(process_data or {})
    if source_id is not None:
        merged[WORKFLOW_AGENT_BINDING_ID_KEY] = source_id
    return merged


__all__ = ["WORKFLOW_AGENT_BINDING_ID_KEY", "preserve_workflow_agent_binding_id"]
