from uuid import uuid4

import pytest

from core.workflow.node_execution_process_data import (
    keep_agent_and_tool_ids,
    read_workflow_agent_session_policy,
)


def test_legacy_execution_policy_defaults_to_enabled_without_a_new_generation() -> None:
    assert read_workflow_agent_session_policy(None) == (True, "")
    assert read_workflow_agent_session_policy({"workflow_agent_binding_id": "binding-1"}) == (True, "")


def test_partial_node_event_keeps_frozen_settings_without_mutating_inputs() -> None:
    generation = str(uuid4())
    source = {"continue_agent_session": False, "agent_session_generation": generation}
    event = {"result": "done"}
    assert keep_agent_and_tool_ids(source, event) == {**event, **source}
    assert source == {"continue_agent_session": False, "agent_session_generation": generation}
    assert event == {"result": "done"}


@pytest.mark.parametrize(
    "values",
    [
        {"continue_agent_session": "false"},
        {"continue_agent_session": 0},
        {"continue_agent_session": None},
        {"agent_session_generation": None},
        {"agent_session_generation": 1},
        {"agent_session_generation": "not-a-uuid"},
        {"agent_session_generation": str(uuid4()).upper()},
    ],
)
def test_malformed_persisted_session_policy_is_rejected(values: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="must be"):
        read_workflow_agent_session_policy(values)
    with pytest.raises(ValueError, match="must be"):
        keep_agent_and_tool_ids(values, {})


@pytest.mark.parametrize("key", ["continue_agent_session", "agent_session_generation"])
def test_later_event_cannot_replace_persisted_session_settings(key: str) -> None:
    source = {"continue_agent_session": False, "agent_session_generation": str(uuid4())}
    changed = True if key == "continue_agent_session" else str(uuid4())
    with pytest.raises(ValueError, match="does not match"):
        keep_agent_and_tool_ids(source, {key: changed})
