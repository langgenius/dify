"""Verify that message pause persistence remains serialized with durable stop.

Each test begins with one app-owned message and workflow run. Successful pause
writes may leave the message PAUSED only while that run remains PAUSED; every
tested stop ordering must finish with the run STOPPED and message NORMAL.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import Select, event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.model import AppMode, Message
from models.workflow import WorkflowRun
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.app.generation_repository import AppGenerationRepository
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.app.generation.ports import MessageIdentity, MessageUpdate
from tests.helpers.unit.model_factories import make_app, make_conversation, make_message

type MessagePersistence = tuple[
    sessionmaker[Session],
    AppGenerationRepository,
    DifyAPISQLAlchemyWorkflowRunRepository,
    MessageIdentity,
]


def _workflow_run(
    *,
    run_id: str = "run-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    status: WorkflowExecutionStatus = WorkflowExecutionStatus.PAUSED,
) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="workflow-1",
        type=ModelWorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        task_id="task-1",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


@pytest.fixture
def message_persistence(sqlite_session_factory: sessionmaker[Session]) -> MessagePersistence:
    identity = MessageIdentity(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        message_id="message-1",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_app(app_id=identity.app_id, tenant_id=identity.tenant_id, mode=AppMode.ADVANCED_CHAT),
                make_conversation(
                    conversation_id=identity.conversation_id,
                    app_id=identity.app_id,
                    mode=AppMode.ADVANCED_CHAT,
                    inputs={},
                    from_source=ConversationFromSource.API,
                ),
                make_message(
                    message_id=identity.message_id,
                    app_id=identity.app_id,
                    conversation_id=identity.conversation_id,
                    inputs={},
                    query="question",
                    message={"role": "user", "content": "question"},
                    answer="",
                    status=MessageStatus.NORMAL,
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.API,
                    workflow_run_id="run-1",
                ),
                _workflow_run(),
            ]
        )
    return (
        sqlite_session_factory,
        AppGenerationRepository(sqlite_session_factory),
        DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory),
        identity,
    )


def _update(*, paused_workflow_run_id: str | None) -> MessageUpdate:
    return MessageUpdate(
        answer="partial answer",
        latency=1,
        metadata={},
        files=[],
        usage=None,
        paused_workflow_run_id=paused_workflow_run_id,
    )


def _message_status(sessions: sessionmaker[Session], message_id: str = "message-1") -> MessageStatus:
    with sessions() as session:
        status = session.scalar(select(Message.status).where(Message.id == message_id))
    assert status is not None
    return status


@pytest.mark.parametrize("initial_status", [MessageStatus.NORMAL, MessageStatus.ERROR])
def test_pause_save_marks_message_paused_only_while_workflow_run_is_paused(
    message_persistence: MessagePersistence,
    initial_status: MessageStatus,
) -> None:
    sessions, records, _, identity = message_persistence
    with sessions.begin() as session:
        message = session.get(Message, identity.message_id)
        assert message is not None
        message.status = initial_status

    saved = records.save_message(identity, _update(paused_workflow_run_id="run-1"))

    assert saved.status == MessageStatus.PAUSED
    assert _message_status(sessions) == MessageStatus.PAUSED


def test_late_pause_save_does_not_revive_message_after_workflow_run_stopped(
    message_persistence: MessagePersistence,
) -> None:
    sessions, records, _, identity = message_persistence
    with sessions.begin() as session:
        run = session.get(WorkflowRun, "run-1")
        assert run is not None
        run.status = WorkflowExecutionStatus.STOPPED

    saved = records.save_message(identity, _update(paused_workflow_run_id="run-1"))

    assert saved.status == MessageStatus.NORMAL
    assert _message_status(sessions) == MessageStatus.NORMAL


@pytest.mark.parametrize(
    ("run_id", "tenant_id", "app_id"),
    [
        ("missing-run", "tenant-1", "app-1"),
        ("run-1", "other-tenant", "app-1"),
        ("run-1", "tenant-1", "other-app"),
    ],
)
def test_pause_save_requires_workflow_run_in_complete_owner_scope(
    message_persistence: MessagePersistence,
    run_id: str,
    tenant_id: str,
    app_id: str,
) -> None:
    sessions, records, _, identity = message_persistence
    with sessions.begin() as session:
        run = session.get(WorkflowRun, "run-1")
        assert run is not None
        run.tenant_id = tenant_id
        run.app_id = app_id

    saved = records.save_message(identity, _update(paused_workflow_run_id=run_id))

    assert saved.status == MessageStatus.NORMAL
    assert _message_status(sessions) == MessageStatus.NORMAL


def test_ordinary_save_clears_a_previous_pause_status(message_persistence: MessagePersistence) -> None:
    sessions, records, _, identity = message_persistence
    with sessions.begin() as session:
        message = session.get(Message, identity.message_id)
        assert message is not None
        message.status = MessageStatus.PAUSED

    saved = records.save_message(identity, _update(paused_workflow_run_id=None))

    assert saved.status == MessageStatus.NORMAL
    assert _message_status(sessions) == MessageStatus.NORMAL


@pytest.mark.parametrize("event_order", ["pause_then_stop", "stop_then_late_pause"])
def test_durable_stop_wins_both_pause_persistence_orders(
    message_persistence: MessagePersistence,
    event_order: str,
) -> None:
    sessions, records, workflow_runs, identity = message_persistence
    if event_order == "pause_then_stop":
        records.save_message(identity, _update(paused_workflow_run_id="run-1"))
        assert _message_status(sessions) == MessageStatus.PAUSED
    else:
        with sessions.begin() as session:
            message = session.get(Message, identity.message_id)
            assert message is not None
            message.status = MessageStatus.PAUSED

    stopped = workflow_runs.stop_paused_workflow_task(
        tenant_id=identity.tenant_id,
        app_id=identity.app_id,
        task_id="task-1",
        owner=None,
    )
    assert stopped is not None
    assert stopped.status == WorkflowExecutionStatus.STOPPED
    assert _message_status(sessions) == MessageStatus.NORMAL

    if event_order == "stop_then_late_pause":
        records.save_message(identity, _update(paused_workflow_run_id="run-1"))
        assert _message_status(sessions) == MessageStatus.NORMAL


def test_pause_save_locks_workflow_run_before_message(message_persistence: MessagePersistence) -> None:
    _, records, _, identity = message_persistence
    locked_selects: list[str] = []

    def record_locked_select(state: ORMExecuteState) -> None:
        if not state.is_select:
            return
        assert isinstance(state.statement, Select)
        statement = str(state.statement.compile(dialect=postgresql.dialect())).lower()
        if "for update" in statement:
            locked_selects.append(statement)

    event.listen(Session, "do_orm_execute", record_locked_select)
    try:
        records.save_message(identity, _update(paused_workflow_run_id="run-1"))
    finally:
        event.remove(Session, "do_orm_execute", record_locked_select)

    assert len(locked_selects) == 2
    assert "from workflow_runs" in locked_selects[0]
    assert locked_selects[0].endswith("for update")
    assert "from messages" in locked_selects[1]
    assert locked_selects[1].endswith("for update of messages")
