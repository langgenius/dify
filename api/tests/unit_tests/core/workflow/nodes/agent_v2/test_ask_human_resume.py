"""Unit tests for mapping a submitted/timed-out HITL form back to ask_human (ENG-638)."""

from __future__ import annotations

from datetime import datetime

import pytest
from dify_agent.layers.ask_human import AskHumanToolResult

from core.workflow.nodes.agent_v2.ask_human_resume import (
    build_deferred_tool_results,
    map_form_to_outcome,
)
from core.workflow.nodes.human_input.entities import FormDefinition, ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired


def _form_definition_json() -> str:
    return FormDefinition(
        form_content="Approve? {{#$output.note#}}",
        inputs=[ParagraphInputConfig(output_variable_name="note")],
        user_actions=[UserActionConfig(id="approve", title="Approve"), UserActionConfig(id="reject", title="Reject")],
        rendered_content="Approve? <input>",
        expiration_time=datetime(2026, 1, 1),
        default_values={"note": "default"},
        node_title="Budget review",
    ).model_dump_json()


def test_map_submitted_form_to_result() -> None:
    outcome = map_form_to_outcome(
        status=HumanInputFormStatus.SUBMITTED,
        selected_action_id="approve",
        submitted_data='{"note": "looks good"}',
        rendered_content="Approve? <input>",
        form_definition=_form_definition_json(),
        form_id="form-1",
        node_id="node-1",
    )

    assert outcome.repause is None
    result = outcome.deferred_result
    assert result is not None
    assert result.status == "submitted"
    assert result.action is not None
    assert result.action.id == "approve"
    assert result.action.label == "Approve"  # verbatim label recovered from the form
    assert result.values == {"note": "looks good"}
    assert result.rendered_content == "Approve? <input>"


def test_map_timeout_form_to_timeout_result() -> None:
    outcome = map_form_to_outcome(
        status=HumanInputFormStatus.TIMEOUT,
        selected_action_id=None,
        submitted_data=None,
        rendered_content="x",
        form_definition=_form_definition_json(),
        form_id="form-1",
        node_id="node-1",
    )
    assert outcome.deferred_result is not None
    assert outcome.deferred_result.status == "timeout"
    assert outcome.deferred_result.action is None


def test_map_expired_form_rejects_invalid_resume_state() -> None:
    with pytest.raises(AssertionError, match="globally expired ask_human form"):
        map_form_to_outcome(
            status=HumanInputFormStatus.EXPIRED,
            selected_action_id=None,
            submitted_data=None,
            rendered_content="x",
            form_definition=_form_definition_json(),
            form_id="form-1",
            node_id="node-1",
        )


def test_map_waiting_form_rebuilds_pause() -> None:
    outcome = map_form_to_outcome(
        status=HumanInputFormStatus.WAITING,
        selected_action_id=None,
        submitted_data=None,
        rendered_content="x",
        form_definition=_form_definition_json(),
        form_id="form-1",
        node_id="node-1",
    )

    assert outcome.deferred_result is None
    pause = outcome.repause
    assert isinstance(pause, HumanInputRequired)
    assert pause.form_id == "form-1"
    assert pause.node_id == "node-1"
    assert pause.node_title == "Budget review"
    assert [a.id for a in pause.actions] == ["approve", "reject"]
    assert [i.output_variable_name for i in pause.inputs] == ["note"]


def test_map_submitted_without_action_id() -> None:
    outcome = map_form_to_outcome(
        status=HumanInputFormStatus.SUBMITTED,
        selected_action_id=None,
        submitted_data="{}",
        rendered_content="x",
        form_definition=_form_definition_json(),
        form_id="form-1",
        node_id="node-1",
    )
    assert outcome.deferred_result is not None
    assert outcome.deferred_result.action is None
    assert outcome.deferred_result.values == {}


def test_build_deferred_tool_results_keys_by_tool_call_id() -> None:
    result = AskHumanToolResult(status="timeout")
    payload = build_deferred_tool_results(tool_call_id="call-42", result=result)
    assert set(payload.calls) == {"call-42"}
    assert payload.calls["call-42"] == result.model_dump(mode="json")
