"""Admission-to-persistence mappings reject client session generation authority."""

from uuid import UUID

import pytest
from pydantic import ValidationError

from models.agent_config_entities import WorkflowNodeJobConfig
from services.agent.session_policy import merge_workflow_agent_session_policy

_GENERATION = "00000000-0000-4000-8000-000000000001"
_FORGED_GENERATION = "00000000-0000-4000-8000-000000000002"


@pytest.mark.parametrize("invalid_mode", [None, "false", "true", 0, 1, [], {}])
def test_node_job_mode_requires_a_json_boolean(invalid_mode: object) -> None:
    with pytest.raises(ValidationError):
        WorkflowNodeJobConfig.model_validate({"continue_agent_session": invalid_mode})


def test_omitted_mode_preserves_saved_policy_and_discards_client_generation() -> None:
    previous = WorkflowNodeJobConfig(continue_agent_session=False, session_generation=_GENERATION)
    requested = WorkflowNodeJobConfig(workflow_prompt="Updated task", session_generation=_FORGED_GENERATION)
    result = merge_workflow_agent_session_policy(previous=previous, node_job=requested, requested_enabled=None)
    assert result.continue_agent_session is False
    assert result.session_generation == _GENERATION
    assert result.workflow_prompt == "Updated task"
    assert requested.session_generation == _FORGED_GENERATION


def test_policy_change_generates_a_new_uuid_without_accepting_the_echoed_value() -> None:
    result = merge_workflow_agent_session_policy(
        previous=WorkflowNodeJobConfig(session_generation=_GENERATION),
        node_job=WorkflowNodeJobConfig(continue_agent_session=False, session_generation=_FORGED_GENERATION),
        requested_enabled=False,
    )
    assert result.continue_agent_session is False
    assert str(UUID(result.session_generation)) == result.session_generation
    assert result.session_generation not in {_GENERATION, _FORGED_GENERATION}


def test_session_generation_is_documented_as_server_owned() -> None:
    properties = WorkflowNodeJobConfig.model_json_schema()["properties"]
    assert properties["continue_agent_session"]["default"] is True
    assert properties["session_generation"]["readOnly"] is True
