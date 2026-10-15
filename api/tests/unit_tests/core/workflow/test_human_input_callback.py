from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.human_input_repository import FormCreateParams, HumanInputFormRepositoryImpl
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.session_binding import SessionBinding
from enums.human_input import HumanInputFormStatus
from graphon.runtime import VariablePool
from graphon.variables.factory import build_segment
from libs.datetime_utils import naive_utc_now
from models.human_input import HumanInputForm
from models.human_input_entities import HumanInputNodeData, ParagraphInputConfig, UserActionConfig


@dataclass(frozen=True, slots=True)
class _Context:
    workflow_execution_id: str
    node_id: str
    node_title: str = "Human Input"
    variable_pool: VariablePool = field(default_factory=VariablePool)


def _ctx(workflow_execution_id: str, node_id: str, node_title: str = "Human Input") -> _Context:
    return _Context(workflow_execution_id=workflow_execution_id, node_id=node_id, node_title=node_title)


@pytest.fixture
def repository(
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
) -> HumanInputFormRepositoryImpl:
    mocker.patch(
        "core.repositories.human_input_repository.session_factory.create_session", side_effect=sqlite_session_factory
    )
    return HumanInputFormRepositoryImpl(tenant_id="tenant-1", app_id="app-1", workflow_execution_id="run-1")


def test_session_binding_identity_mapping() -> None:
    binding = SessionBinding()

    assert binding.issue_session_id_for_form(form_id="form-1") == "form-1"
    assert binding.resolve_form_id_from_session_id(session_id="form-1") == "form-1"


def test_dify_hitl_callback_creates_pause_requested_for_new_form(
    repository: HumanInputFormRepositoryImpl, mocker: MockerFixture
) -> None:
    create = mocker.spy(repository, "create_form")
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(
            title="Approval",
            form_content="Please approve",
            inputs=[ParagraphInputConfig(output_variable_name="answer")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        ),
        workflow_execution_id="run-1",
    )

    decision = callback(_ctx("run-1", "node-1"))

    assert decision == callback.pause_requested_type(session_id=create.spy_return.id)
    form = repository.get_form("node-1")
    assert form is not None
    assert form.id == decision.session_id
    params: FormCreateParams = create.call_args.args[0]
    assert params.workflow_execution_id == "run-1"
    assert params.node_id == "node-1"


def test_dify_hitl_callback_scopes_form_to_node_execution(
    repository: HumanInputFormRepositoryImpl, mocker: MockerFixture
) -> None:
    create = mocker.spy(repository, "create_form")
    lookup = mocker.spy(repository, "get_form")
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(
            title="Approval",
            form_content="Please approve",
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        ),
        execution_id_getter=lambda: "execution-1",
    )

    callback(_ctx("run-1", "node-1"))

    lookup.assert_called_once_with("node-1", form_id="execution-1")
    params: FormCreateParams = create.call_args.args[0]
    assert params.form_id == "execution-1"
    form = repository.get_form("node-1", form_id="execution-1")
    assert form is not None
    assert form.id == "execution-1"


def test_dify_hitl_callback_returns_completed_for_submitted_form(
    repository: HumanInputFormRepositoryImpl, sqlite_session: Session
) -> None:
    form = HumanInputForm(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id="approve",
        submitted_data=json.dumps({"answer": "yes"}),
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=naive_utc_now() + timedelta(hours=1),
        submitted_at=naive_utc_now(),
        created_at=naive_utc_now(),
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        form_definition="{}",
    )
    sqlite_session.add(form)
    sqlite_session.commit()
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(
            title="Approval",
            form_content="Please approve",
            inputs=[ParagraphInputConfig(output_variable_name="answer")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        ),
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


def test_dify_hitl_callback_returns_timeout_for_explicit_timeout_form(
    repository: HumanInputFormRepositoryImpl, sqlite_session: Session
) -> None:
    form = HumanInputForm(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        status=HumanInputFormStatus.TIMEOUT,
        created_at=naive_utc_now(),
        expiration_time=naive_utc_now() + timedelta(hours=1),
        submitted_at=None,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        form_definition="{}",
    )
    sqlite_session.add(form)
    sqlite_session.commit()
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
    )

    decision = callback(_ctx("run-1", "node-1"))

    assert decision.selected_handle == "__timeout"
    assert decision.outputs == {
        "__action_id": build_segment(""),
        "__action_value": build_segment(""),
        "__rendered_content": build_segment("<p>Please approve</p>"),
    }


def test_dify_hitl_callback_returns_timeout_for_waiting_form_past_node_deadline(
    repository: HumanInputFormRepositoryImpl, sqlite_session: Session
) -> None:
    form = HumanInputForm(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        status=HumanInputFormStatus.WAITING,
        created_at=naive_utc_now(),
        expiration_time=naive_utc_now() - timedelta(minutes=1),
        submitted_at=None,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        form_definition="{}",
    )
    sqlite_session.add(form)
    sqlite_session.commit()
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
    )

    decision = callback(_ctx("run-1", "node-1"))

    assert decision.selected_handle == "__timeout"
    assert decision.outputs == {
        "__action_id": build_segment(""),
        "__action_value": build_segment(""),
        "__rendered_content": build_segment("<p>Please approve</p>"),
    }


def test_dify_hitl_callback_rejects_expired_form_as_invalid_resume_state(
    repository: HumanInputFormRepositoryImpl, sqlite_session: Session
) -> None:
    form = HumanInputForm(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        status=HumanInputFormStatus.EXPIRED,
        created_at=naive_utc_now() - timedelta(days=8),
        expiration_time=naive_utc_now() + timedelta(hours=1),
        submitted_at=None,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        form_definition="{}",
    )
    sqlite_session.add(form)
    sqlite_session.commit()
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
    )

    with pytest.raises(AssertionError, match="globally expired human input form"):
        callback(_ctx("run-1", "node-1"))


def test_dify_hitl_callback_rejects_waiting_form_past_global_deadline_as_invalid_resume_state(
    repository: HumanInputFormRepositoryImpl, sqlite_session: Session
) -> None:
    form = HumanInputForm(
        id="form-1",
        rendered_content="<p>Please approve</p>",
        selected_action_id=None,
        submitted_data=None,
        status=HumanInputFormStatus.WAITING,
        created_at=naive_utc_now() - timedelta(days=8),
        expiration_time=naive_utc_now() + timedelta(hours=1),
        submitted_at=None,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        form_definition="{}",
    )
    sqlite_session.add(form)
    sqlite_session.commit()
    callback = DifyHITLCallback(
        form_repository=repository,
        node_data=HumanInputNodeData(title="Approval", form_content="Please approve"),
    )

    with pytest.raises(AssertionError, match="global timeout"):
        callback(_ctx("run-1", "node-1"))
