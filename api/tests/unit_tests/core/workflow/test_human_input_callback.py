from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphon.variables.factory import build_segment

from core.repositories.human_input_repository import FormCreateParams, HumanInputFormRepository
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import HumanInputNodeData, ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.session_binding import SessionBinding
from libs.datetime_utils import naive_utc_now


@dataclass(frozen=True, slots=True)
class _Context:
    workflow_execution_id: str
    node_id: str
    node_title: str = "Human Input"


def _ctx(workflow_execution_id: str, node_id: str, node_title: str = "Human Input") -> _Context:
    return _Context(workflow_execution_id=workflow_execution_id, node_id=node_id, node_title=node_title)


def test_session_binding_identity_mapping() -> None:
    binding = SessionBinding()

    assert binding.issue_session_id_for_form(form_id="form-1") == "form-1"
    assert binding.resolve_form_id_from_session_id(session_id="form-1") == "form-1"


def test_dify_hitl_callback_creates_pause_requested_for_new_form() -> None:
    repository = MagicMock(spec=HumanInputFormRepository)
    repository.get_form.return_value = None
    repository.create_form.return_value = SimpleNamespace(id="form-1")
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(
            title="Approval",
            form_content="Please approve",
            inputs=[ParagraphInputConfig(output_variable_name="answer")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        ),
        rendered_content="<p>Please approve</p>",
        resolved_default_values={},
        workflow_execution_id="run-1",
    )

    decision = callback(_ctx("run-1", "node-1"))

    assert decision == callback.pause_requested_type(session_id="form-1")
    params: FormCreateParams = repository.create_form.call_args.args[0]
    assert params.workflow_execution_id == "run-1"
    assert params.node_id == "node-1"


def test_dify_hitl_callback_returns_completed_for_submitted_form() -> None:
    repository = MagicMock(spec=HumanInputFormRepository)
    repository.get_form.return_value = SimpleNamespace(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id="approve",
        submitted_data={"answer": "yes"},
        submitted=True,
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=naive_utc_now() + timedelta(hours=1),
    )
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(
            title="Approval",
            form_content="Please approve",
            inputs=[ParagraphInputConfig(output_variable_name="answer")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        ),
        rendered_content="<p>Please approve</p>",
        resolved_default_values={},
    )

    decision = callback(_ctx("run-1", "node-1"))

    assert decision.selected_handle == "approve"
    assert decision.inputs == {"answer": build_segment("yes")}
    assert decision.outputs == {
        "answer": build_segment("yes"),
        "__action_id": build_segment("approve"),
        "__action_value": build_segment("Approve"),
        "__rendered_content": build_segment("<p>Please approve</p>"),
    }


def test_dify_hitl_callback_returns_timeout_for_explicit_timeout_form() -> None:
    repository = MagicMock(spec=HumanInputFormRepository)
    repository.get_form.return_value = SimpleNamespace(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        submitted=False,
        status=HumanInputFormStatus.TIMEOUT,
        created_at=naive_utc_now(),
        expiration_time=naive_utc_now() + timedelta(hours=1),
    )
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
        rendered_content="<p>Please approve</p>",
        resolved_default_values={},
    )

    decision = callback(_ctx("run-1", "node-1"))

    assert decision.selected_handle == "__timeout__"
    assert decision.outputs == {
        "__action_id": build_segment(""),
        "__action_value": build_segment(""),
        "__rendered_content": build_segment("<p>Please approve</p>"),
    }


def test_dify_hitl_callback_returns_timeout_for_waiting_form_past_node_deadline() -> None:
    repository = MagicMock(spec=HumanInputFormRepository)
    repository.get_form.return_value = SimpleNamespace(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        submitted=False,
        status=HumanInputFormStatus.WAITING,
        created_at=naive_utc_now(),
        expiration_time=naive_utc_now() - timedelta(minutes=1),
    )
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
        rendered_content="<p>Please approve</p>",
        resolved_default_values={},
    )

    decision = callback(_ctx("run-1", "node-1"))

    assert decision.selected_handle == "__timeout__"
    assert decision.outputs == {
        "__action_id": build_segment(""),
        "__action_value": build_segment(""),
        "__rendered_content": build_segment("<p>Please approve</p>"),
    }


def test_dify_hitl_callback_rejects_expired_form_as_invalid_resume_state() -> None:
    repository = MagicMock(spec=HumanInputFormRepository)
    repository.get_form.return_value = SimpleNamespace(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        submitted=False,
        status=HumanInputFormStatus.EXPIRED,
        created_at=naive_utc_now() - timedelta(days=8),
        expiration_time=naive_utc_now() + timedelta(hours=1),
    )
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
        rendered_content="<p>Please approve</p>",
        resolved_default_values={},
    )

    with pytest.raises(AssertionError, match="globally expired human input form"):
        callback(_ctx("run-1", "node-1"))


def test_dify_hitl_callback_rejects_waiting_form_past_global_deadline_as_invalid_resume_state() -> None:
    repository = MagicMock(spec=HumanInputFormRepository)
    repository.get_form.return_value = SimpleNamespace(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        submitted=False,
        status=HumanInputFormStatus.WAITING,
        created_at=naive_utc_now() - timedelta(days=8),
        expiration_time=naive_utc_now() + timedelta(hours=1),
    )
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
        rendered_content="<p>Please approve</p>",
        resolved_default_values={},
    )

    with pytest.raises(AssertionError, match="global timeout"):
        callback(_ctx("run-1", "node-1"))
