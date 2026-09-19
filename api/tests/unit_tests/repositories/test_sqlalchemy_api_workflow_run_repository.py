from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.entities import FormDefinition, ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.enums import FormInputType
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import HitlRequired, PauseReasonType, SchedulingPause
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import Message
from models.enums import ConversationFromSource, CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm, HumanInputFormRecipient, RecipientType
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    WorkflowRunMessageRef,
    WorkflowRunPauseRecord,
    _build_human_input_required_reason,
    _PrivateWorkflowPauseEntity,
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


def test_private_workflow_pause_entity_preserves_list_shaped_pause_reasons() -> None:
    pause_reasons = [
        HumanInputRequired(
            form_id="form-1",
            form_content="content",
            inputs=[],
            actions=[],
            node_id="node-1",
            node_title="Ask Name",
        )
    ]
    pause_model = WorkflowPause(
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        state_object_key="pause-state",
    )
    pause_model.id = "pause-1"
    entity = _PrivateWorkflowPauseEntity(
        pause_model=pause_model,
        reason_models=[],
        pause_reasons=pause_reasons,
    )

    result = entity.get_pause_reasons()

    assert isinstance(result, list)
    assert result == pause_reasons


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

    assert repository.get_pause_record(workspace_id="tenant-2", workflow_run_id="run-1") is None
    assert repository.get_pause_record(
        workspace_id="tenant-1",
        workflow_run_id="run-1",
    ) == WorkflowRunPauseRecord(
        status=WorkflowExecutionStatus.SUCCEEDED,
        paused_at=None,
        reasons=(),
        form_tokens={},
    )


def test_get_pause_record_loads_reasons_and_tokens_in_one_repository_call(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
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
    reason = WorkflowPauseReason(
        pause_id=pause.id,
        type_=PauseReasonType.HITL_REQUIRED,
        form_id="form-1",
        node_id="node-1",
    )
    recipient = HumanInputFormRecipient(
        form_id="form-1",
        delivery_id="delivery-1",
        recipient_type=RecipientType.CONSOLE,
        recipient_payload="{}",
        access_token="form-token",
    )
    sqlite_session.add_all([workflow_run, pause, reason, recipient])
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    result = repository.get_pause_record(workspace_id="tenant-1", workflow_run_id="run-1")

    assert result is not None
    assert result.status == WorkflowExecutionStatus.PAUSED
    assert result.paused_at == pause.created_at
    assert len(result.reasons) == 1
    assert isinstance(result.reasons[0], HumanInputRequired)
    assert result.reasons[0].form_id == "form-1"
    assert result.form_tokens == {"form-1": "form-token"}


def test_delete_pause_model_deletes_record_when_state_object_delete_fails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    pause_model = WorkflowPause(
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        state_object_key="workflow-state.json",
    )
    pause_model.id = "pause-1"
    session = Mock(spec=Session)

    with (
        patch(
            "repositories.sqlalchemy_api_workflow_run_repository.storage.delete",
            side_effect=PermissionError("DeleteObject denied"),
        ) as delete_state_object,
        caplog.at_level(logging.ERROR, logger="repositories.sqlalchemy_api_workflow_run_repository"),
    ):
        DifyAPISQLAlchemyWorkflowRunRepository._delete_pause_model(session, pause_model)

    delete_state_object.assert_called_once_with(pause_model.state_object_key)
    session.delete.assert_called_once_with(pause_model)
    assert "pause_id=pause-1" in caplog.text
    assert "workflow_run_id=run-1" in caplog.text
    assert "object_key=workflow-state.json" in caplog.text
    assert caplog.records[-1].exc_info is not None


_STORAGE_SAVE = "repositories.sqlalchemy_api_workflow_run_repository.storage.save"
_STORAGE_DELETE = "repositories.sqlalchemy_api_workflow_run_repository.storage.delete"


def _running_run(sqlite_session: Session) -> WorkflowRun:
    workflow_run = _workflow_run(run_id="run-1", tenant_id="tenant-1", status=WorkflowExecutionStatus.RUNNING)
    sqlite_session.add(workflow_run)
    sqlite_session.commit()
    return workflow_run


def _pause(
    repository: DifyAPISQLAlchemyWorkflowRunRepository,
    *,
    state: str,
    outputs: dict[str, object] | None,
    total_tokens: int = 0,
    total_steps: int = 0,
    exceptions_count: int = 0,
) -> WorkflowPauseEntity:
    return repository.pause_workflow_run(
        "run-1",
        "owner-1",
        state,
        [SchedulingPause(message="wait")],
        outputs=outputs,
        total_tokens=total_tokens,
        total_steps=total_steps,
        exceptions_count=exceptions_count,
    )


def test_pause_workflow_run_commits_the_run_transition_with_its_pause_record(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _running_run(sqlite_session)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    with patch(_STORAGE_SAVE) as save_state_object:
        pause_entity = _pause(
            repository,
            state='{"state": "snapshot"}',
            outputs={"answer": "paused"},
            total_tokens=7,
            total_steps=2,
            exceptions_count=1,
        )

    object_key = save_state_object.call_args.args[0]
    sqlite_session.expire_all()
    workflow_run = sqlite_session.get(WorkflowRun, "run-1")
    assert workflow_run is not None
    assert workflow_run.status == WorkflowExecutionStatus.PAUSED
    assert json.loads(workflow_run.outputs or "{}") == {"answer": "paused"}
    assert workflow_run.total_tokens == 7
    assert workflow_run.total_steps == 2
    assert workflow_run.exceptions_count == 1

    pause_model = sqlite_session.scalars(select(WorkflowPause)).one()
    assert pause_model.id == pause_entity.id
    # The committed reference points at the object that was written before the commit.
    assert pause_model.state_object_key == object_key
    reason_models = sqlite_session.scalars(select(WorkflowPauseReason)).all()
    assert [reason_model.message for reason_model in reason_models] == ["wait"]


def test_pause_workflow_run_leaves_the_run_untouched_when_the_snapshot_write_fails(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _running_run(sqlite_session)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    with patch(_STORAGE_SAVE, side_effect=OSError("storage backend down")):
        with pytest.raises(OSError, match="storage backend down"):
            _pause(repository, state="{}", outputs=None)

    sqlite_session.expire_all()
    workflow_run = sqlite_session.get(WorkflowRun, "run-1")
    assert workflow_run is not None
    assert workflow_run.status == WorkflowExecutionStatus.RUNNING
    assert sqlite_session.scalars(select(WorkflowPause)).all() == []


def test_pause_workflow_run_rolls_the_run_transition_back_when_the_commit_fails(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _running_run(sqlite_session)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    def _fail_insert(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("database commit failed")

    event.listen(WorkflowPause, "before_insert", _fail_insert)
    try:
        with patch(_STORAGE_SAVE) as save_state_object:
            with pytest.raises(RuntimeError, match="database commit failed"):
                _pause(repository, state='{"state": "snapshot"}', outputs={"answer": "paused"}, total_tokens=5)
    finally:
        event.remove(WorkflowPause, "before_insert", _fail_insert)

    sqlite_session.expire_all()
    workflow_run = sqlite_session.get(WorkflowRun, "run-1")
    assert workflow_run is not None
    assert workflow_run.status == WorkflowExecutionStatus.RUNNING
    assert json.loads(workflow_run.outputs or "{}") == {}
    assert workflow_run.total_tokens == 0
    assert sqlite_session.scalars(select(WorkflowPause)).all() == []
    # The written object is an orphan, which the storage consistency model allows:
    # no committed database reference ever pointed at it.
    assert save_state_object.call_count == 1


def test_pausing_twice_replaces_the_snapshot_when_the_superseded_object_survives_cleanup(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    _running_run(sqlite_session)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)

    with patch(_STORAGE_SAVE) as first_save:
        _pause(repository, state='{"v": 1}', outputs=None)
    superseded_key = first_save.call_args.args[0]

    with (
        caplog.at_level(logging.ERROR, logger="repositories.sqlalchemy_api_workflow_run_repository"),
        patch(_STORAGE_DELETE, side_effect=PermissionError("DeleteObject denied")),
        patch(_STORAGE_SAVE) as second_save,
    ):
        _pause(repository, state='{"v": 2}', outputs=None)

    pause_models = sqlite_session.scalars(select(WorkflowPause)).all()
    assert [pause_model.state_object_key for pause_model in pause_models] == [second_save.call_args.args[0]]
    assert second_save.call_args.args[0] != superseded_key
    assert "DeleteObject denied" in caplog.text
