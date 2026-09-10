from datetime import timedelta

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from libs.datetime_utils import naive_utc_now
from models.human_input import HumanInputForm
from services.human_input_resume_coordinator import (
    all_hitl_forms_submitted,
    maybe_enqueue_resume_for_submitted_hitl_pause,
)


@pytest.fixture
def sqlite_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(sqlite_engine, expire_on_commit=False)


def _pause_reason(form_id: str) -> HumanInputRequired:
    return HumanInputRequired(
        form_id=form_id,
        form_content="Approve?",
        inputs=[],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="human-node",
        node_title="Human Input",
    )


def _persist_form(
    session_factory: sessionmaker[Session],
    *,
    form_id: str,
    submitted: bool,
) -> None:
    expiration_time = naive_utc_now() + timedelta(days=1)
    definition = HumanInputNodeData(
        title="Human Input",
        form_content="Approve?",
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )
    form = HumanInputForm(
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_run_id="workflow-run-id",
        node_id="human-node",
        form_definition=definition.model_dump_json(),
        rendered_content="Approve?",
        expiration_time=expiration_time,
        status=HumanInputFormStatus.SUBMITTED if submitted else HumanInputFormStatus.WAITING,
        submitted_at=naive_utc_now() if submitted else None,
        selected_action_id="approve" if submitted else None,
    )
    form.id = form_id
    with session_factory.begin() as session:
        session.add(form)


def test_all_hitl_forms_submitted_requires_every_form(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_form(sqlite_session_factory, form_id="form-1", submitted=True)
    _persist_form(sqlite_session_factory, form_id="form-2", submitted=False)

    with sqlite_session_factory() as session:
        assert all_hitl_forms_submitted(session, ["form-1", "form-2"]) is False
        assert all_hitl_forms_submitted(session, ["form-1"]) is True


def test_maybe_enqueue_resume_for_submitted_hitl_pause_skips_waiting_form(
    mocker: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_form(sqlite_session_factory, form_id="form-1", submitted=True)
    _persist_form(sqlite_session_factory, form_id="form-2", submitted=False)
    resume_task = mocker.patch("tasks.app_generate.workflow_execute_task.resume_app_execution")

    maybe_enqueue_resume_for_submitted_hitl_pause(
        workflow_run_id="workflow-run-id",
        pause_reasons=[_pause_reason("form-1"), _pause_reason("form-2")],
        session_factory=sqlite_session_factory,
    )

    resume_task.apply_async.assert_not_called()


def test_maybe_enqueue_resume_for_submitted_hitl_pause_enqueues_when_all_submitted(
    mocker: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_form(sqlite_session_factory, form_id="form-1", submitted=True)
    _persist_form(sqlite_session_factory, form_id="form-2", submitted=True)
    resume_task = mocker.patch("tasks.app_generate.workflow_execute_task.resume_app_execution")

    maybe_enqueue_resume_for_submitted_hitl_pause(
        workflow_run_id="workflow-run-id",
        pause_reasons=[_pause_reason("form-1"), _pause_reason("form-2")],
        session_factory=sqlite_session_factory,
    )

    resume_task.apply_async.assert_called_once_with(
        kwargs={"payload": {"workflow_run_id": "workflow-run-id"}},
    )
