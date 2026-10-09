from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.entities import FormDefinition, ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.enums import FormInputType
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import HitlRequired, PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import Message
from models.enums import ConversationFromSource, CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm, HumanInputFormRecipient, RecipientType
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    WorkflowRunMessageRef,
    WorkflowRunPauseRecord,
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
    reason = _build_human_input_required_reason(
        _build_reason_model(),
        _build_form_model(),
        [
            _recipient(RecipientType.BACKSTAGE, "btok"),
            _recipient(RecipientType.CONSOLE, "ctok"),
        ],
    )

    assert reason.node_id == "node-1"
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
        type=WorkflowType.WORKFLOW,
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
