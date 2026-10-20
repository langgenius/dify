import importlib.util
import sqlite3
import sys
from collections.abc import Callable, Iterator
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from uuid import uuid4

import pytest
from sqlalchemy import Connection, create_engine, event, select
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry

from graphon.entities.pause_reason import PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from graphon.file import FileTransferMethod, FileType
from models.base import Base
from models.enums import (
    AppTriggerType,
    ConversationFromSource,
    CreatorUserRole,
    ExecutionOffLoadType,
    FeedbackFromSource,
    FeedbackRating,
    MessageChainType,
    WorkflowRunTriggeredFrom,
    WorkflowTriggerStatus,
)
from models.model import (
    AppAnnotationHitHistory,
    AppMode,
    Conversation,
    DatasetRetrieverResource,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.trigger import WorkflowTriggerLog
from models.web import SavedMessage
from models.workflow import (
    ConversationVariable,
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)
from repositories.factory import DifyAPIRepositoryFactory

TABLES = [
    Base.metadata.tables[model.__tablename__]
    for model in (
        Conversation,
        Message,
        AppAnnotationHitHistory,
        DatasetRetrieverResource,
        MessageAgentThought,
        MessageChain,
        MessageFile,
        MessageAnnotation,
        MessageFeedback,
        SavedMessage,
        ConversationVariable,
        WorkflowRun,
        WorkflowNodeExecutionModel,
        WorkflowNodeExecutionOffload,
        WorkflowAppLog,
        WorkflowPause,
        WorkflowPauseReason,
        WorkflowTriggerLog,
    )
]


class _CeleryStub:
    def task(self, *_args: object, **_kwargs: object) -> Callable[[Callable[..., object]], Callable[..., object]]:
        def decorator(func: Callable[..., object]) -> Callable[..., object]:
            return func

        return decorator


class _AppStub(ModuleType):
    celery = _CeleryStub()


@pytest.fixture
def cleanup_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    # Load a private copy so the Celery stub cannot leak through the schedule package's import cache.
    path = Path(__file__).resolve().parents[3] / "schedule" / "clean_workflow_runlogs_precise.py"
    spec = importlib.util.spec_from_file_location("_test_clean_workflow_runlogs_precise", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    with monkeypatch.context() as patch:
        patch.setitem(sys.modules, "app", _AppStub("app"))
        spec.loader.exec_module(module)
    return module


@pytest.fixture
def session_maker() -> Iterator[sessionmaker[Session]]:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection: sqlite3.Connection, _record: ConnectionPoolEntry) -> None:
        connection.isolation_level = None
        connection.execute("PRAGMA foreign_keys=ON")

    @event.listens_for(engine, "begin")
    def begin_transaction(connection: Connection) -> None:
        # Python 3.12's SQLite legacy mode otherwise releases a savepoint outside the outer transaction.
        connection.exec_driver_sql("BEGIN")

    try:
        Base.metadata.create_all(engine, tables=TABLES)
        yield sessionmaker(bind=engine, expire_on_commit=False)
    finally:
        engine.dispose()


def _seed_batch(session: Session) -> WorkflowRun:
    tenant_id, app_id, workflow_id, user_id = (str(uuid4()) for _ in range(4))
    run_id, conversation_id, message_id, node_execution_id = (str(uuid4()) for _ in range(4))
    run = WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user_id,
    )
    conversation = Conversation(
        id=conversation_id,
        app_id=app_id,
        mode=AppMode.ADVANCED_CHAT,
        name="cleanup test",
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
    )
    session.add_all([run, conversation])
    session.flush()
    pause = WorkflowPause(workflow_id=workflow_id, workflow_run_id=run_id, state_object_key="pause-state")
    annotation = MessageAnnotation(
        app_id=app_id,
        question="question",
        content="answer",
        account_id=user_id,
        conversation_id=conversation_id,
        message_id=message_id,
    )
    session.add_all(
        [
            Message(
                id=message_id,
                app_id=app_id,
                conversation_id=conversation_id,
                workflow_run_id=run_id,
                inputs={},
                query="question",
                message={},
                answer="answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            ),
            annotation,
            AppAnnotationHitHistory(
                app_id=app_id,
                annotation_id=annotation.id,
                source="api",
                question="question",
                account_id=user_id,
                score=1.0,
                message_id=message_id,
                annotation_question="question",
                annotation_content="answer",
            ),
            DatasetRetrieverResource(
                message_id=message_id,
                position=1,
                dataset_id=str(uuid4()),
                dataset_name="dataset",
                document_id=None,
                document_name="document",
                data_source_type=None,
                segment_id=None,
                score=None,
                content="content",
                hit_count=None,
                word_count=None,
                segment_position=None,
                index_node_hash=None,
                retriever_from="dev",
                created_by=user_id,
            ),
            MessageAgentThought(
                message_id=message_id,
                position=1,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=user_id,
            ),
            MessageChain(message_id=message_id, type=MessageChainType.SYSTEM, input=None, output=None),
            MessageFile(
                message_id=message_id,
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.REMOTE_URL,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=user_id,
            ),
            MessageFeedback(
                app_id=app_id,
                conversation_id=conversation_id,
                message_id=message_id,
                rating=FeedbackRating.LIKE,
                from_source=FeedbackFromSource.ADMIN,
            ),
            SavedMessage(
                app_id=app_id,
                message_id=message_id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=user_id,
            ),
            ConversationVariable(id=str(uuid4()), conversation_id=conversation_id, app_id=app_id, data="{}"),
            WorkflowNodeExecutionModel(
                id=node_execution_id,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                workflow_run_id=run_id,
                index=1,
                node_id="start",
                node_type="start",
                title="Start",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=user_id,
            ),
            WorkflowNodeExecutionOffload(
                tenant_id=tenant_id,
                app_id=app_id,
                node_execution_id=node_execution_id,
                type_=ExecutionOffLoadType.INPUTS,
                file_id=str(uuid4()),
            ),
            WorkflowAppLog(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_run_id=run_id,
                created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=user_id,
            ),
            pause,
            WorkflowPauseReason(pause_id=pause.id, type_=PauseReasonType.SCHEDULED_PAUSE),
            WorkflowTriggerLog(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_run_id=run_id,
                root_node_id=None,
                trigger_metadata="{}",
                trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                trigger_data="{}",
                inputs="{}",
                outputs=None,
                status=WorkflowTriggerStatus.SUCCEEDED,
                error=None,
                queue_name="workflow",
                celery_task_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=user_id,
            ),
        ]
    )
    session.flush()
    return run


def _row_ids(session: Session) -> dict[str, set[str]]:
    return {table.name: set(session.scalars(select(table.c.id))) for table in TABLES}


@pytest.mark.parametrize("outcome", ["commit", "rollback", "failure"])
def test_delete_batch_keeps_cascade_in_caller_transaction(
    cleanup_module: ModuleType,
    session_maker: sessionmaker[Session],
    outcome: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with session_maker.begin() as session:
        _seed_batch(session)
        retained_rows = _row_ids(session)
        run = _seed_batch(session)
        original_rows = _row_ids(session)

    repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
    with session_maker() as session:
        if outcome == "failure":

            @event.listens_for(session, "do_orm_execute")
            def fail_run_deletion(state: ORMExecuteState) -> None:
                if state.is_delete and state.bind_mapper is not None and state.bind_mapper.class_ is WorkflowRun:
                    raise RuntimeError("Fail after deleting related rows")

        assert cleanup_module._delete_batch(session, repository, [run], attempt_count=0) is (outcome != "failure")
        assert session.in_transaction()
        assert not session.in_nested_transaction()
        assert _row_ids(session) == (original_rows if outcome == "failure" else retained_rows)
        if outcome == "failure":
            assert "Fail after deleting related rows" in caplog.text

        if outcome == "rollback":
            session.rollback()
        else:
            session.commit()

    with session_maker() as session:
        assert _row_ids(session) == (retained_rows if outcome == "commit" else original_rows)
