from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.entities import FormDefinition, ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.enums import FormInputType, HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import HitlRequired, PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import Message
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm, HumanInputFormRecipient, RecipientType
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.api_workflow_run_repository import AppWorkflowRunStats
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    WorkflowRunMessageRef,
    WorkflowRunNotPausedError,
    WorkflowRunPauseRecord,
    WorkflowTaskOwnerMismatchError,
    _build_human_input_required_reason,
)


@pytest.fixture
def workflow_run(sqlite_session_factory: sessionmaker[Session]) -> WorkflowRun:
    run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="draft",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
    )
    with sqlite_session_factory.begin() as session:
        session.add(run)
    return run


@pytest.mark.parametrize("owner_scope", ["matching", "other_tenant", "other_app", "missing_run"])
def test_locked_workflow_run_read_requires_complete_owner_scope(
    sqlite_session_factory: sessionmaker[Session], workflow_run: WorkflowRun, owner_scope: str
) -> None:
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        run = repository.get_workflow_run_by_id_for_update(
            session,
            tenant_id=str(uuid4()) if owner_scope == "other_tenant" else workflow_run.tenant_id,
            app_id=str(uuid4()) if owner_scope == "other_app" else workflow_run.app_id,
            run_id=str(uuid4()) if owner_scope == "missing_run" else workflow_run.id,
        )
        if owner_scope != "matching":
            assert run is None
            return
        assert run is not None
        assert run.id == workflow_run.id
        assert run.status == WorkflowExecutionStatus.PAUSED


def test_locked_workflow_run_changes_follow_the_callers_rollback(
    sqlite_session_factory: sessionmaker[Session], workflow_run: WorkflowRun
) -> None:
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    with sqlite_session_factory() as session:
        session.begin()
        run = repository.get_workflow_run_by_id_for_update(
            session,
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
            run_id=workflow_run.id,
        )
        assert run is not None
        run.status = WorkflowExecutionStatus.STOPPED
        session.flush()
        session.rollback()

    with sqlite_session_factory() as session:
        persisted_run = session.get(WorkflowRun, workflow_run.id)
        assert persisted_run is not None
        assert persisted_run.status == WorkflowExecutionStatus.PAUSED


@pytest.mark.parametrize(
    ("pause_state", "owner_scope", "expected"),
    [
        ("active", "matching", True),
        ("resumed", "matching", False),
        ("missing", "matching", False),
        ("active", "other_tenant", False),
        ("active", "other_app", False),
        ("active", "missing_run", False),
    ],
)
def test_active_workflow_pause_requires_unresumed_pause_in_complete_owner_scope(
    sqlite_session_factory: sessionmaker[Session],
    workflow_run: WorkflowRun,
    pause_state: str,
    owner_scope: str,
    expected: bool,
) -> None:
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    with sqlite_session_factory() as session:
        if pause_state != "missing":
            session.add(
                WorkflowPause(
                    workflow_id=workflow_run.workflow_id,
                    workflow_run_id=workflow_run.id,
                    state_object_key="checkpoint.json",
                    resumed_at=datetime(2024, 1, 1) if pause_state == "resumed" else None,
                )
            )
            session.flush()
        assert (
            repository.has_active_workflow_pause(
                session,
                tenant_id=str(uuid4()) if owner_scope == "other_tenant" else workflow_run.tenant_id,
                app_id=str(uuid4()) if owner_scope == "other_app" else workflow_run.app_id,
                run_id=str(uuid4()) if owner_scope == "missing_run" else workflow_run.id,
            )
            is expected
        )
        session.rollback()

    with sqlite_session_factory() as session:
        assert not repository.has_active_workflow_pause(
            session,
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
            run_id=workflow_run.id,
        )


def _build_form_model() -> HumanInputForm:
    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    definition = FormDefinition(
        form_content="content",
        inputs=[ParagraphInputConfig(type=FormInputType.PARAGRAPH, output_variable_name="name")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="rendered",
        expiration_time=expiration_time,
        default_values={"name": "Alice"},
        node_title="Ask Name",
        display_in_ui=True,
    )
    form = HumanInputForm(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        form_definition=definition.model_dump_json(),
        rendered_content="rendered",
        expiration_time=expiration_time,
    )
    form.id = "form-1"
    return form


def _build_reason_model() -> WorkflowPauseReason:
    return WorkflowPauseReason(
        pause_id="pause-1",
        type_=PauseReasonType.HITL_REQUIRED,
        form_id="form-1",
        node_id="node-1",
    )


def _recipient(recipient_type: RecipientType, access_token: str) -> HumanInputFormRecipient:
    return HumanInputFormRecipient(
        form_id="form-1",
        delivery_id=f"delivery-{recipient_type.value}",
        recipient_type=recipient_type,
        recipient_payload="{}",
        access_token=access_token,
    )


def test_build_human_input_required_reason_prefers_standalone_web_app_token() -> None:
    reason = _build_human_input_required_reason(
        _build_reason_model(),
        _build_form_model(),
        [
            _recipient(RecipientType.BACKSTAGE, "btok"),
            _recipient(RecipientType.CONSOLE, "ctok"),
            _recipient(RecipientType.STANDALONE_WEB_APP, "wtok"),
        ],
    )

    assert reason.node_title == "Ask Name"
    assert reason.form_content == "rendered"
    assert reason.resolved_default_values == {"name": "Alice"}
    assert not hasattr(reason, "form_token")


def test_build_human_input_required_reason_falls_back_to_console_token() -> None:
    reason_model = _build_reason_model()
    reason_model.node_id = "workflow-tool-node"
    reason = _build_human_input_required_reason(
        reason_model,
        _build_form_model(),
        [
            _recipient(RecipientType.BACKSTAGE, "btok"),
            _recipient(RecipientType.CONSOLE, "ctok"),
        ],
    )

    assert reason.node_id == "workflow-tool-node"
    assert reason.actions[0].id == "approve"
    assert not hasattr(reason, "form_token")


def test_workflow_pause_reason_from_entity_persists_hitl_type_for_dify_human_input() -> None:
    reason_model = WorkflowPauseReason.from_entity(
        pause_id="pause-1",
        pause_reason=HumanInputRequired(
            form_id="form-1",
            form_content="content",
            inputs=[],
            actions=[],
            node_id="node-1",
            node_title="Ask Name",
        ),
    )

    assert reason_model.type_ == PauseReasonType.HITL_REQUIRED
    assert reason_model.form_id == "form-1"
    assert reason_model.node_id == "node-1"


def test_workflow_pause_reason_to_entity_restores_graphon_hitl_reason() -> None:
    reason_model = WorkflowPauseReason(
        pause_id="pause-1",
        type_=PauseReasonType.HITL_REQUIRED,
        form_id="form-1",
        node_id="node-1",
    )

    reason = reason_model.to_entity()

    assert isinstance(reason, HitlRequired)
    assert reason.TYPE == PauseReasonType.HITL_REQUIRED
    assert reason.session_id == "form-1"
    assert reason.node_id == "node-1"


@pytest.mark.parametrize(
    "reason",
    [
        HitlRequired(session_id="hitlv2:form-2", node_id="node-2", node_title="Approval"),
        HumanInputRequired(
            form_version="2", form_id="form-2", form_content="Approve", node_id="node-2", node_title="Approval"
        ),
    ],
)
def test_legacy_pause_reason_rejects_v2_references(reason) -> None:
    with pytest.raises(ValueError, match="only accepts HITL v1"):
        WorkflowPauseReason.from_entity(pause_id="pause-2", pause_reason=reason)


def _message(*, message_id: str, app_id: str, workflow_run_id: str, conversation_id: str) -> Message:
    message = Message(
        app_id=app_id,
        conversation_id=conversation_id,
        query="query",
        message={"role": "user", "content": "query"},
        answer="answer",
        message_unit_price=Decimal("0.0001"),
        answer_unit_price=Decimal("0.0001"),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    message.id = message_id
    message._inputs = {}
    message.workflow_run_id = workflow_run_id
    return message


def _workflow_run(*, run_id: str, tenant_id: str, status: WorkflowExecutionStatus) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id="app-1",
        workflow_id="workflow-1",
        type=ModelWorkflowType(WorkflowType.WORKFLOW),
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="1",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


def test_get_message_refs_filters_by_app_and_returns_lightweight_records(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add_all(
        [
            _message(message_id="msg-1", app_id="app-1", workflow_run_id="run-1", conversation_id="conv-1"),
            _message(message_id="msg-2", app_id="app-2", workflow_run_id="run-2", conversation_id="conv-2"),
        ]
    )
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    result = repository.get_message_refs(
        app_id="app-1",
        workflow_run_ids=["run-1", "run-2"],
    )

    assert result == {
        "run-1": WorkflowRunMessageRef(message_id="msg-1", conversation_id="conv-1"),
    }


def test_get_pause_record_scopes_the_workflow_run_to_the_workspace(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(
        _workflow_run(
            run_id="run-1",
            tenant_id="tenant-1",
            status=WorkflowExecutionStatus.SUCCEEDED,
        )
    )
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    assert repository.get_pause_record(sqlite_session, workspace_id="tenant-2", workflow_run_id="run-1") is None
    assert repository.get_pause_record(
        sqlite_session,
        workspace_id="tenant-1",
        workflow_run_id="run-1",
    ) == WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.SUCCEEDED,
        pause=None,
    )


def test_get_pause_record_returns_run_bound_checkpoint(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workflow_run = _workflow_run(
        run_id="run-1",
        tenant_id="tenant-1",
        status=WorkflowExecutionStatus.PAUSED,
    )
    pause = WorkflowPause(
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        state_object_key="pause-state",
    )
    pause.id = "pause-1"
    sqlite_session.add_all([workflow_run, pause])
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.load", lambda _key: b"checkpoint")
    result = repository.get_pause_record(sqlite_session, workspace_id="tenant-1", workflow_run_id="run-1")

    assert result is not None
    assert result.status == WorkflowExecutionStatus.PAUSED
    assert result.pause is not None
    assert result.pause.id == pause.id
    assert result.pause.workflow_execution_id == workflow_run.id
    assert result.pause.paused_at == pause.created_at
    assert result.pause.get_state() == b"checkpoint"


def test_delete_pause_model_deletes_record_when_state_object_delete_fails(
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
) -> None:
    pause_model = WorkflowPause(
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        state_object_key="workflow-state.json",
    )
    pause_model.id = "pause-1"
    session = sqlite_session
    session.add(pause_model)
    session.commit()

    with (
        patch(
            "repositories.sqlalchemy_api_workflow_run_repository.storage.delete",
            side_effect=PermissionError("DeleteObject denied"),
        ) as delete_state_object,
        caplog.at_level(logging.ERROR, logger="repositories.sqlalchemy_api_workflow_run_repository"),
    ):
        DifyAPISQLAlchemyWorkflowRunRepository._delete_pause_model(session, pause_model)

    delete_state_object.assert_called_once_with(pause_model.state_object_key)
    session.commit()
    assert session.get(WorkflowPause, "pause-1") is None
    assert "pause_id=pause-1" in caplog.text
    assert "workflow_run_id=run-1" in caplog.text
    assert "object_key=workflow-state.json" in caplog.text
    assert caplog.records[-1].exc_info is not None


def _app_run(
    *,
    tenant_id: str,
    app_id: str,
    status: WorkflowExecutionStatus,
    created_at: datetime,
    triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.APP_RUN,
) -> WorkflowRun:
    run = _workflow_run(run_id=str(uuid4()), tenant_id=tenant_id, status=status)
    run.app_id = app_id
    run.triggered_from = triggered_from
    run.created_at = created_at
    return run


def test_app_run_stats_scope_runs_by_app_tenant_source_and_window(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    since = datetime(2026, 10, 14, 12)
    sqlite_session.add_all(
        [
            _app_run(tenant_id="t-1", app_id="a-1", status=WorkflowExecutionStatus.SUCCEEDED, created_at=since),
            _app_run(
                tenant_id="t-1",
                app_id="a-1",
                status=WorkflowExecutionStatus.FAILED,
                created_at=datetime(2026, 10, 14, 13),
                triggered_from=WorkflowRunTriggeredFrom.WEBHOOK,
            ),
            # Before the window: neither counted nor newer than a-1's windowed runs.
            _app_run(
                tenant_id="t-1", app_id="a-1", status=WorkflowExecutionStatus.FAILED, created_at=datetime(2026, 1, 1)
            ),
            # Before the window: only the last-run lookup sees it.
            _app_run(
                tenant_id="t-1", app_id="a-2", status=WorkflowExecutionStatus.SUCCEEDED, created_at=datetime(2026, 1, 1)
            ),
            # Excluded source, even though it is the newest run.
            _app_run(
                tenant_id="t-1",
                app_id="a-2",
                status=WorkflowExecutionStatus.FAILED,
                created_at=datetime(2026, 10, 15),
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            ),
            # Another tenant's run for a requested app id is not that app's run.
            _app_run(
                tenant_id="t-2", app_id="a-1", status=WorkflowExecutionStatus.FAILED, created_at=datetime(2026, 10, 15)
            ),
        ]
    )
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)
    apps = {"a-1": "t-1", "a-2": "t-1"}
    sources = [WorkflowRunTriggeredFrom.APP_RUN, WorkflowRunTriggeredFrom.WEBHOOK]

    assert repository.get_stats_by_app_ids(apps, sources, since) == {
        "a-1": AppWorkflowRunStats(
            status_counts={WorkflowExecutionStatus.SUCCEEDED: 1, WorkflowExecutionStatus.FAILED: 1},
            last_created_at=datetime(2026, 10, 14, 13),
        ),
        # Only runs before the window: no counts, but still the newest run time.
        "a-2": AppWorkflowRunStats(status_counts={}, last_created_at=datetime(2026, 1, 1)),
    }
    assert repository.get_stats_by_app_ids({}, sources, since) == {}


@pytest.mark.parametrize(
    ("tenant_id", "app_id", "owner", "stopped"),
    [
        ("tenant-1", "app-1", None, True),
        ("tenant-1", "app-1", (CreatorUserRole.ACCOUNT, "account-1"), True),
        ("tenant-2", "app-1", None, False),
        ("tenant-1", "app-2", None, False),
    ],
)
def test_stop_paused_task_is_scoped_and_invalidates_pause_and_forms(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    tenant_id: str,
    app_id: str,
    owner: tuple[CreatorUserRole, str] | None,
    stopped: bool,
) -> None:
    run = _workflow_run(run_id="run-1", tenant_id="tenant-1", status=WorkflowExecutionStatus.PAUSED)
    run.task_id = "task-1"
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
    form = _build_form_model()
    message = _message(message_id="message-1", app_id="app-1", workflow_run_id=run.id, conversation_id="conv-1")
    foreign_message = _message(message_id="message-2", app_id="app-2", workflow_run_id=run.id, conversation_id="conv-2")
    message.status = foreign_message.status = MessageStatus.PAUSED
    sqlite_session.add_all([run, pause, form, message, foreign_message])
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    prior_pause = repository.get_workflow_pause(run.id)
    assert prior_pause is not None
    with patch("repositories.sqlalchemy_api_workflow_run_repository.storage.delete") as delete_state:
        result = repository.stop_paused_workflow_task(tenant_id=tenant_id, app_id=app_id, task_id="task-1", owner=owner)
    sqlite_session.expire_all()
    assert (result is not None) is stopped
    if stopped:
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert run.finished_at is not None
        assert form.status == HumanInputFormStatus.EXPIRED
        assert message.status == MessageStatus.NORMAL
        assert repository.get_workflow_pause(run.id) is None
        delete_state.assert_called_once_with("state")
        cancellation_resets: list[None] = []
        with pytest.raises(WorkflowRunNotPausedError):
            repository.resume_workflow_pause(
                run.id, prior_pause, before_resume=lambda: cancellation_resets.append(None)
            )
        assert cancellation_resets == []
        retried = repository.stop_paused_workflow_task(
            tenant_id=tenant_id, app_id=app_id, task_id="task-1", owner=owner
        )
        assert retried is not None
        assert retried.status == WorkflowExecutionStatus.STOPPED
    else:
        assert run.status == WorkflowExecutionStatus.PAUSED
        assert form.status == HumanInputFormStatus.WAITING
        assert message.status == MessageStatus.PAUSED
        delete_state.assert_not_called()
    assert foreign_message.status == MessageStatus.PAUSED


@pytest.mark.parametrize("owner", [(CreatorUserRole.ACCOUNT, "other-user"), (CreatorUserRole.END_USER, "account-1")])
def test_paused_task_cannot_be_stopped_by_another_user_or_role(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    owner: tuple[CreatorUserRole, str],
) -> None:
    run = _workflow_run(run_id="run-1", tenant_id="tenant-1", status=WorkflowExecutionStatus.PAUSED)
    run.task_id = "task-1"
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
    sqlite_session.add_all([run, pause])
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    with pytest.raises(WorkflowTaskOwnerMismatchError):
        repository.stop_paused_workflow_task(tenant_id="tenant-1", app_id="app-1", task_id="task-1", owner=owner)
    sqlite_session.expire_all()
    assert run.status == WorkflowExecutionStatus.PAUSED


def test_stop_after_resume_leaves_running_task_to_the_engine(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    run = _workflow_run(run_id="run-1", tenant_id="tenant-1", status=WorkflowExecutionStatus.PAUSED)
    run.task_id = "task-1"
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
    sqlite_session.add_all([run, pause])
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    entity = repository.get_workflow_pause(run.id)
    assert entity is not None
    cancellation_resets: list[None] = []
    repository.resume_workflow_pause(run.id, entity, before_resume=lambda: cancellation_resets.append(None))
    with pytest.raises(WorkflowRunNotPausedError):
        repository.resume_workflow_pause(run.id, entity, before_resume=lambda: cancellation_resets.append(None))
    assert cancellation_resets == [None]
    admitted = repository.stop_paused_workflow_task(tenant_id="tenant-1", app_id="app-1", task_id="task-1", owner=None)
    assert admitted is not None
    assert admitted.status == WorkflowExecutionStatus.RUNNING
    sqlite_session.expire_all()
    assert run.status == WorkflowExecutionStatus.RUNNING
