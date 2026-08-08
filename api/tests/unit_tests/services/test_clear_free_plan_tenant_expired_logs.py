import datetime
import json
import logging
from collections.abc import Callable
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from enums.cloud_plan import CloudPlan
from graphon.file import FileTransferMethod, FileType
from models.account import Tenant
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    FeedbackFromSource,
    FeedbackRating,
    MessageChainType,
)
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppMode,
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.web import SavedMessage
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom
from services import clear_free_plan_tenant_expired_logs as service_module
from services.clear_free_plan_tenant_expired_logs import ClearFreePlanTenantExpiredLogs

REAL_DATETIME = datetime.datetime
SQLITE_MODELS = (
    Tenant,
    App,
    Conversation,
    Message,
    MessageFeedback,
    MessageFile,
    MessageAnnotation,
    MessageChain,
    MessageAgentThought,
    AppAnnotationHitHistory,
    SavedMessage,
    WorkflowAppLog,
)

pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


def _create_tenant(
    tenant_id: str,
    *,
    created_at: datetime.datetime | None = None,
) -> Tenant:
    """Create a tenant with a stable ID and optional batch-selection timestamp."""
    tenant = Tenant(name=f"Tenant {tenant_id}")
    tenant.id = tenant_id
    if created_at is not None:
        tenant.created_at = created_at
    return tenant


def _create_app(app_id: str, tenant_id: str) -> App:
    """Create a persisted app used to scope cleanup queries by tenant."""
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=f"App {app_id}",
        description="",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _create_conversation(
    conversation_id: str,
    app_id: str,
    *,
    updated_at: datetime.datetime,
) -> Conversation:
    """Create a conversation with the fields required by backup serialization."""
    conversation = Conversation(
        id=conversation_id,
        app_id=app_id,
        mode=AppMode.CHAT,
        name=f"Conversation {conversation_id}",
        status="normal",
        from_source=ConversationFromSource.API,
        from_end_user_id="end-user-1",
    )
    conversation._inputs = {}
    conversation.updated_at = updated_at
    return conversation


def _create_message(
    message_id: str,
    app_id: str,
    conversation_id: str,
    *,
    created_at: datetime.datetime,
) -> Message:
    """Create a message with the fields required by backup serialization."""
    message = Message(
        id=message_id,
        app_id=app_id,
        conversation_id=conversation_id,
        query="question",
        message={"role": "user", "content": "question"},
        answer="answer",
        message_unit_price=Decimal("0.0001"),
        answer_unit_price=Decimal("0.0002"),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    message._inputs = {}
    message.created_at = created_at
    message.updated_at = created_at
    return message


def _create_workflow_app_log(
    log_id: str,
    tenant_id: str,
    app_id: str,
    *,
    created_at: datetime.datetime,
) -> WorkflowAppLog:
    """Create a workflow app log eligible for retention cleanup."""
    log = WorkflowAppLog(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="workflow-1",
        workflow_run_id=f"run-{log_id}",
        created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    log.id = log_id
    log.created_at = created_at
    return log


def _create_related_records(message_id: str) -> list[object]:
    """Create one real row for every message-related table cleaned by the service."""
    return [
        MessageFeedback(
            app_id="app-1",
            conversation_id="conversation-1",
            message_id=message_id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.USER,
        ),
        MessageFile(
            message_id=message_id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
        ),
        MessageAnnotation(
            app_id="app-1",
            question="question",
            content="answer",
            account_id="account-1",
            message_id=message_id,
        ),
        MessageChain(message_id=message_id, type=MessageChainType.SYSTEM, input="input", output="output"),
        MessageAgentThought(
            message_id=message_id,
            position=1,
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
            tool_labels_str="{}",
            tool_meta_str="{}",
        ),
        AppAnnotationHitHistory(
            app_id="app-1",
            annotation_id="annotation-1",
            source="annotation",
            question="question",
            account_id="account-1",
            score=1.0,
            message_id=message_id,
            annotation_question="question",
            annotation_content="answer",
        ),
        SavedMessage(
            app_id="app-1",
            message_id=message_id,
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
        ),
    ]


class TestClearFreePlanTenantExpiredLogs:
    """Exercise message-related cleanup through a caller-owned SQLite transaction."""

    def test_empty_message_ids_returns_without_touching_persisted_rows(
        self,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        record = MessageChain(message_id="msg-1", type=MessageChainType.SYSTEM, input="input", output="output")
        sqlite_session.add(record)
        sqlite_session.commit()
        storage = MagicMock()
        monkeypatch.setattr(service_module, "storage", storage)

        ClearFreePlanTenantExpiredLogs._clear_message_related_tables(sqlite_session, "tenant-123", [])

        assert sqlite_session.get(MessageChain, record.id) is not None
        storage.save.assert_not_called()

    def test_no_related_records_skips_backup(
        self,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        storage = MagicMock()
        monkeypatch.setattr(service_module, "storage", storage)

        ClearFreePlanTenantExpiredLogs._clear_message_related_tables(sqlite_session, "tenant-123", ["missing-message"])

        storage.save.assert_not_called()

    def test_related_records_are_backed_up_and_deleted(
        self,
        sqlite_session: Session,
        sqlite_engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        records = _create_related_records("msg-1")
        sqlite_session.add_all(records)
        sqlite_session.commit()
        record_keys = [(type(record), record.id) for record in records]
        storage = MagicMock()
        monkeypatch.setattr(service_module, "storage", storage)

        ClearFreePlanTenantExpiredLogs._clear_message_related_tables(sqlite_session, "tenant-123", ["msg-1"])
        sqlite_session.commit()

        assert storage.save.call_count == len(records)
        backed_up_payloads = [json.loads(call.args[1]) for call in storage.save.call_args_list]
        assert all(payload for payload in backed_up_payloads)
        with Session(sqlite_engine) as verification_session:
            assert all(verification_session.get(model, record_id) is None for model, record_id in record_keys)

    def test_storage_failure_still_deletes_records(
        self,
        sqlite_session: Session,
        sqlite_engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        record = MessageChain(message_id="msg-1", type=MessageChainType.SYSTEM, input="input", output="output")
        sqlite_session.add(record)
        sqlite_session.commit()
        storage = MagicMock()
        storage.save.side_effect = RuntimeError("storage error")
        monkeypatch.setattr(service_module, "storage", storage)

        ClearFreePlanTenantExpiredLogs._clear_message_related_tables(sqlite_session, "tenant-123", ["msg-1"])
        sqlite_session.commit()

        with Session(sqlite_engine) as verification_session:
            assert verification_session.get(MessageChain, record.id) is None

    def test_serialization_failure_skips_backup_but_deletes_records(
        self,
        sqlite_session: Session,
        sqlite_engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        record = SavedMessage(
            app_id="app-1",
            message_id="msg-1",
            created_by_role=CreatorUserRole.END_USER,
            created_by="end-user-1",
        )
        sqlite_session.add(record)
        sqlite_session.commit()
        storage = MagicMock()
        monkeypatch.setattr(service_module, "storage", storage)
        monkeypatch.setattr(
            ClearFreePlanTenantExpiredLogs,
            "_serialize_record",
            MagicMock(side_effect=RuntimeError("serialization error")),
        )

        ClearFreePlanTenantExpiredLogs._clear_message_related_tables(sqlite_session, "tenant-123", ["msg-1"])
        sqlite_session.commit()

        storage.save.assert_not_called()
        with Session(sqlite_engine) as verification_session:
            assert verification_session.get(SavedMessage, record.id) is None

    def test_deletion_is_scoped_to_requested_message_ids(
        self,
        sqlite_session: Session,
        sqlite_engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        target = MessageChain(message_id="msg-1", type=MessageChainType.SYSTEM, input="input", output="output")
        retained = MessageChain(message_id="msg-2", type=MessageChainType.SYSTEM, input="input", output="output")
        sqlite_session.add_all([target, retained])
        sqlite_session.commit()
        monkeypatch.setattr(service_module, "storage", MagicMock())

        ClearFreePlanTenantExpiredLogs._clear_message_related_tables(sqlite_session, "tenant-123", ["msg-1"])
        sqlite_session.commit()

        with Session(sqlite_engine) as verification_session:
            assert verification_session.get(MessageChain, target.id) is None
            assert verification_session.get(MessageChain, retained.id) is not None


class _ImmediateFuture:
    """Run submitted test work synchronously while preserving the Future interface."""

    def __init__(self, fn: Callable[..., object], args: tuple[object, ...], kwargs: dict[str, object]) -> None:
        self._fn = fn
        self._args = args
        self._kwargs = kwargs

    def result(self) -> object:
        return self._fn(*self._args, **self._kwargs)


class _ImmediateExecutor:
    """Deterministic ThreadPoolExecutor replacement for orchestration tests."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.submitted: list[tuple[Callable[..., object], tuple[object, ...], dict[str, object]]] = []

    def submit(self, fn: Callable[..., object], *args: object, **kwargs: object) -> _ImmediateFuture:
        self.submitted.append((fn, args, kwargs))
        return _ImmediateFuture(fn, args, kwargs)


def _configure_process_boundaries(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> _ImmediateExecutor:
    """Bind service-owned sessions to SQLite and make thread scheduling deterministic."""
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=sqlite_engine))
    flask_app = service_module.Flask("test-app")
    monkeypatch.setattr(service_module, "current_app", SimpleNamespace(_get_current_object=lambda: flask_app))
    executor = _ImmediateExecutor()
    monkeypatch.setattr(service_module, "ThreadPoolExecutor", lambda **_kwargs: executor)
    monkeypatch.setattr(service_module.click, "style", lambda message, **_kwargs: message)
    return executor


def test_process_tenant_processes_and_persists_all_batches(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    flask_app = service_module.Flask("test-app")
    old = REAL_DATETIME.now() - datetime.timedelta(days=30)
    recent = REAL_DATETIME.now()
    sqlite_session.add_all(
        [
            _create_app("app-1", "tenant-1"),
            _create_app("app-2", "tenant-2"),
            _create_conversation("conversation-old", "app-1", updated_at=old),
            _create_conversation("conversation-recent", "app-1", updated_at=recent),
            _create_conversation("conversation-other", "app-2", updated_at=old),
            _create_message("message-old", "app-1", "conversation-old", created_at=old),
            _create_message("message-recent", "app-1", "conversation-recent", created_at=recent),
            _create_message("message-other", "app-2", "conversation-other", created_at=old),
            _create_workflow_app_log("log-old", "tenant-1", "app-1", created_at=old),
            _create_workflow_app_log("log-recent", "tenant-1", "app-1", created_at=recent),
            _create_workflow_app_log("log-other", "tenant-2", "app-2", created_at=old),
        ]
    )
    sqlite_session.commit()
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=sqlite_engine))
    storage = MagicMock()
    monkeypatch.setattr(service_module, "storage", storage)
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service_module.click, "style", lambda message, **_kwargs: message)
    clear_related = MagicMock()
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "_clear_message_related_tables", clear_related)

    node_execution = SimpleNamespace(id="node-execution-1")
    node_execution.__table__ = SimpleNamespace(columns=[SimpleNamespace(name="id")])
    node_repo = MagicMock()
    node_repo.get_expired_executions_batch.side_effect = [[node_execution], []]
    node_repo.delete_executions_by_ids.return_value = 1
    run_repo = MagicMock()
    run_repo.get_expired_runs_batch.side_effect = [
        [SimpleNamespace(id="workflow-run-1", to_dict=lambda: {"id": "workflow-run-1"})],
        [],
    ]
    run_repo.delete_runs_by_ids.return_value = 1
    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_node_execution_repository",
        lambda _session_maker: node_repo,
    )
    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda _session_maker: run_repo,
    )

    ClearFreePlanTenantExpiredLogs.process_tenant(
        flask_app,
        "tenant-1",
        days=7,
        batch=1,
        session=sqlite_session,
    )

    assert clear_related.call_count == 1
    related_session, related_tenant_id, message_ids = clear_related.call_args.args
    assert isinstance(related_session, Session)
    assert related_tenant_id == "tenant-1"
    assert message_ids == ["message-old"]
    assert storage.save.call_count == 5
    with Session(sqlite_engine) as verification_session:
        assert verification_session.get(Message, "message-old") is None
        assert verification_session.get(Conversation, "conversation-old") is None
        assert verification_session.get(WorkflowAppLog, "log-old") is None
        assert verification_session.get(Message, "message-recent") is not None
        assert verification_session.get(Message, "message-other") is not None
        assert verification_session.get(Conversation, "conversation-recent") is not None
        assert verification_session.get(Conversation, "conversation-other") is not None
        assert verification_session.get(WorkflowAppLog, "log-recent") is not None
        assert verification_session.get(WorkflowAppLog, "log-other") is not None


def test_serialize_record_falls_back_to_table_columns() -> None:
    record = SimpleNamespace(id="node-execution-1", node_id="node-1")
    record.__table__ = SimpleNamespace(
        columns=[
            SimpleNamespace(name="id"),
            SimpleNamespace(name="node_id"),
        ]
    )

    assert ClearFreePlanTenantExpiredLogs._serialize_record(record) == {
        "id": "node-execution-1",
        "node_id": "node-1",
    }


def test_process_with_tenant_ids_filters_by_plan_and_logs_errors(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    sqlite_session.add_all(
        [_create_tenant("tenant-sandbox"), _create_tenant("tenant-paid"), _create_tenant("tenant-fail")]
    )
    sqlite_session.commit()
    _configure_process_boundaries(monkeypatch, sqlite_engine)
    monkeypatch.setattr(service_module.click, "echo", MagicMock())
    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", True)

    def fake_get_info(tenant_id: str) -> dict[str, dict[str, str]]:
        if tenant_id == "tenant-sandbox":
            return {"subscription": {"plan": CloudPlan.SANDBOX}}
        if tenant_id == "tenant-fail":
            raise RuntimeError("billing failure")
        return {"subscription": {"plan": "team"}}

    monkeypatch.setattr(service_module.BillingService, "get_info", staticmethod(fake_get_info))
    process_tenant = MagicMock(side_effect=RuntimeError("cleanup failure"))
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", process_tenant)

    with caplog.at_level(logging.ERROR, logger=service_module.logger.name):
        ClearFreePlanTenantExpiredLogs.process(
            days=7,
            batch=10,
            tenant_ids=["tenant-sandbox", "tenant-paid", "tenant-fail"],
        )

    assert process_tenant.call_count == 1
    owned_session = process_tenant.call_args.args[4]
    assert isinstance(owned_session, Session)
    assert owned_session.get_bind() is sqlite_engine
    assert "Failed to process tenant tenant-sandbox" in caplog.messages
    assert "Failed to process tenant tenant-fail" in caplog.messages


def test_process_without_tenant_ids_batches_and_scales_interval(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    started_at = REAL_DATETIME(2023, 4, 3, 8, 59, 24)
    fixed_now = started_at + datetime.timedelta(hours=2)
    selected_tenants = [
        _create_tenant("tenant-a", created_at=started_at + datetime.timedelta(minutes=30)),
        _create_tenant("tenant-b", created_at=started_at + datetime.timedelta(hours=1)),
    ]
    future_tenants = [
        _create_tenant(f"future-{index}", created_at=started_at + datetime.timedelta(hours=4)) for index in range(100)
    ]
    sqlite_session.add_all([*selected_tenants, *future_tenants])
    sqlite_session.commit()

    class FixedDateTime(REAL_DATETIME):
        @classmethod
        def now(cls, tz: datetime.tzinfo | None = None) -> REAL_DATETIME:
            return fixed_now

    monkeypatch.setattr(service_module.datetime, "datetime", FixedDateTime)
    _configure_process_boundaries(monkeypatch, sqlite_engine)
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", False)
    process_tenant = MagicMock()
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", process_tenant)
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        ClearFreePlanTenantExpiredLogs.process(days=7, batch=10, tenant_ids=[])
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert {call.args[1] for call in process_tenant.call_args_list} == {"tenant-a", "tenant-b"}
    interval_counts = [
        statement
        for statement in statements
        if "count(tenants.id)" in statement.lower() and "between" in statement.lower()
    ]
    assert len(interval_counts) == 4
    assert all(isinstance(call.args[4], Session) for call in process_tenant.call_args_list)


def test_process_with_tenant_ids_emits_progress_every_100(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    tenant_ids = [f"tenant-{index}" for index in range(100)]
    sqlite_session.add_all([_create_tenant(tenant_id) for tenant_id in tenant_ids])
    sqlite_session.commit()
    _configure_process_boundaries(monkeypatch, sqlite_engine)
    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", False)
    echo = MagicMock()
    monkeypatch.setattr(service_module.click, "echo", echo)
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", MagicMock())

    ClearFreePlanTenantExpiredLogs.process(days=7, batch=10, tenant_ids=tenant_ids)

    assert any("Processed 100 tenants" in str(call.args[0]) for call in echo.call_args_list)


def test_process_without_tenant_ids_all_intervals_too_many_uses_min_interval(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    started_at = REAL_DATETIME(2023, 4, 3, 8, 59, 24)
    fixed_now = started_at + datetime.timedelta(minutes=30)
    sqlite_session.add(_create_tenant("tenant-in-range", created_at=started_at + datetime.timedelta(minutes=15)))
    sqlite_session.add_all(
        [
            _create_tenant(f"later-{index}", created_at=started_at + datetime.timedelta(minutes=45))
            for index in range(100)
        ]
    )
    sqlite_session.commit()

    class FixedDateTime(REAL_DATETIME):
        @classmethod
        def now(cls, tz: datetime.tzinfo | None = None) -> REAL_DATETIME:
            return fixed_now

    monkeypatch.setattr(service_module.datetime, "datetime", FixedDateTime)
    _configure_process_boundaries(monkeypatch, sqlite_engine)
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service_module.dify_config, "BILLING_ENABLED", False)
    process_tenant = MagicMock()
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "process_tenant", process_tenant)
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        ClearFreePlanTenantExpiredLogs.process(days=7, batch=10, tenant_ids=[])
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert [call.args[1] for call in process_tenant.call_args_list] == ["tenant-in-range"]
    interval_counts = [
        statement
        for statement in statements
        if "count(tenants.id)" in statement.lower() and "between" in statement.lower()
    ]
    assert len(interval_counts) == 5


def test_process_tenant_repo_loops_break_on_empty_second_batch(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    flask_app = service_module.Flask("test-app")
    sqlite_session.add(_create_app("app-1", "tenant-1"))
    sqlite_session.commit()
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr(service_module, "storage", MagicMock())
    monkeypatch.setattr(service_module.click, "echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service_module.click, "style", lambda message, **_kwargs: message)
    monkeypatch.setattr(ClearFreePlanTenantExpiredLogs, "_clear_message_related_tables", MagicMock())

    node_executions = [SimpleNamespace(id="node-1"), SimpleNamespace(id="node-2")]
    for node_execution in node_executions:
        node_execution.__table__ = SimpleNamespace(columns=[SimpleNamespace(name="id")])
    node_repo = MagicMock()
    node_repo.get_expired_executions_batch.side_effect = [node_executions, []]
    node_repo.delete_executions_by_ids.return_value = 2
    run_repo = MagicMock()
    run_repo.get_expired_runs_batch.side_effect = [
        [
            SimpleNamespace(id="run-1", to_dict=lambda: {"id": "run-1"}),
            SimpleNamespace(id="run-2", to_dict=lambda: {"id": "run-2"}),
        ],
        [],
    ]
    run_repo.delete_runs_by_ids.return_value = 2
    node_session_makers: list[object] = []
    run_session_makers: list[object] = []

    def create_node_repo(session_maker: object) -> MagicMock:
        node_session_makers.append(session_maker)
        return node_repo

    def create_run_repo(session_maker: object) -> MagicMock:
        run_session_makers.append(session_maker)
        return run_repo

    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_node_execution_repository",
        create_node_repo,
    )
    monkeypatch.setattr(
        service_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        create_run_repo,
    )

    ClearFreePlanTenantExpiredLogs.process_tenant(
        flask_app,
        "tenant-1",
        days=7,
        batch=2,
        session=sqlite_session,
    )

    assert node_repo.get_expired_executions_batch.call_count == 2
    assert run_repo.get_expired_runs_batch.call_count == 2
    assert node_session_makers[0].kw["bind"] is sqlite_engine
    assert run_session_makers[0].kw["bind"] is sqlite_engine
