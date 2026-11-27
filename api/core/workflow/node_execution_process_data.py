from collections.abc import Mapping
from re import fullmatch
from typing import Any

WORKFLOW_AGENT_BINDING_ID_KEY = "workflow_agent_binding_id"
WORKFLOW_TOOL_INVOCATION_ID_KEY = "workflow_tool_invocation_id"
WORKFLOW_TOOL_ROOT_APP_ID_KEY = "workflow_tool_root_app_id"
CONTINUE_AGENT_SESSION_KEY = "continue_agent_session"
AGENT_SESSION_GENERATION_KEY = "agent_session_generation"
AGENT_SESSION_BRANCH_KEY = "agent_session_branch"


def read_workflow_agent_session_branch(process_data: Mapping[str, Any] | None) -> str:
    """Validate the persisted branch namespace; legacy/root executions use empty.

    Pre: input belongs to the admitted execution. Post: return its frozen empty
    or SHA-256 branch key; malformed values raise ValueError without mutation.
    """
    branch = (process_data or {}).get(AGENT_SESSION_BRANCH_KEY, "")
    if not isinstance(branch, str) or not fullmatch(r"(?:[0-9a-f]{64})?", branch):
        raise ValueError("agent_session_branch must be a SHA-256 hex digest or empty")
    return branch


def read_workflow_agent_session_policy(process_data: Mapping[str, Any] | None) -> tuple[bool, str]:
    """Validate persisted run settings, retaining the legacy enabled generation.

    Pre: input is a caller row's process data, or absent for a legacy row.
    Post: return a strict boolean and a canonical UUID (or the legacy empty
    generation). Malformed persisted values raise ValueError without mutation.
    """
    values = process_data or {}
    enabled = values.get(CONTINUE_AGENT_SESSION_KEY, True)
    generation = values.get(AGENT_SESSION_GENERATION_KEY, "")
    if not isinstance(enabled, bool):
        raise ValueError("continue_agent_session must be a boolean")
    if not isinstance(generation, str) or not fullmatch(
        r"(?:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})?", generation
    ):
        raise ValueError("agent_session_generation must be a canonical UUID or empty")
    return enabled, generation


def keep_agent_and_tool_ids(
    source_process_data: Mapping[str, Any] | None,
    process_data: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    """Keep persisted caller identity and frozen Agent settings through updates.

    Pre: either event may omit already-persisted identity/settings.
    Post: persisted values survive partial updates; conflicting or malformed
    values raise ValueError and neither input mapping is changed.
    """
    updated_process_data = dict(process_data or {})
    for key in (
        WORKFLOW_AGENT_BINDING_ID_KEY,
        WORKFLOW_TOOL_INVOCATION_ID_KEY,
        WORKFLOW_TOOL_ROOT_APP_ID_KEY,
    ):
        source_id = (source_process_data or {}).get(key)
        target_id = (process_data or {}).get(key)
        for value in (source_id, target_id):
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{key} must be a string")
        if source_id is not None and target_id is not None and source_id != target_id:
            raise ValueError(f"{key} does not match")
        if source_id is not None:
            updated_process_data[key] = source_id
    read_workflow_agent_session_policy(source_process_data)
    read_workflow_agent_session_policy(process_data)
    read_workflow_agent_session_branch(source_process_data)
    read_workflow_agent_session_branch(process_data)
    for key in (CONTINUE_AGENT_SESSION_KEY, AGENT_SESSION_GENERATION_KEY, AGENT_SESSION_BRANCH_KEY):
        source = source_process_data or {}
        target = process_data or {}
        if key in source:
            if key in target and source[key] != target[key]:
                raise ValueError(f"{key} does not match")
            updated_process_data[key] = source[key]
    return None if process_data is None and not updated_process_data else updated_process_data


__all__ = [
    "AGENT_SESSION_BRANCH_KEY",
    "AGENT_SESSION_GENERATION_KEY",
    "CONTINUE_AGENT_SESSION_KEY",
    "WORKFLOW_AGENT_BINDING_ID_KEY",
    "WORKFLOW_TOOL_INVOCATION_ID_KEY",
    "WORKFLOW_TOOL_ROOT_APP_ID_KEY",
    "keep_agent_and_tool_ids",
    "read_workflow_agent_session_branch",
    "read_workflow_agent_session_policy",
]
