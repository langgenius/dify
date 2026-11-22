"""Exercise Console log CSV exports with real conversation queries."""

import csv
import json
from datetime import datetime
from functools import partial
from io import StringIO
from typing import override

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from graphon.enums import WorkflowExecutionStatus
from machinery.context import RequestContext
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    EndUserType,
    FeedbackFromSource,
    FeedbackRating,
    InvokeFrom,
    WorkflowRunTriggeredFrom,
)
from models.model import AppMode, EndUser, MessageFeedback
from models.workflow import WorkflowRun, WorkflowType
from repositories import conversation_repository
from repositories.conversation_repository import ConversationRepository
from services.entities.conversation_entities import ConsoleConversationLogFilters
from services.retention import log_export_adapters
from services.retention.conversation.log_export_service import (
    ConversationLogExportService,
    ConversationLogExportTask,
)
from services.retention.log_export_task import LogExportKind
from services.retention.log_export_task_cache import RedisLogExportTasks
from tests.helpers.unit.log_export_fixtures import LogExportRedisIo, LogExportStorageIo
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_message


@pytest.fixture
def export(
    sqlite_session_factory: sessionmaker[Session], log_export_redis: LogExportRedisIo
) -> ConversationLogExportService:
    return ConversationLogExportService(
        conversations=ConversationRepository(session_factory=sqlite_session_factory),
        tasks=RedisLogExportTasks(
            redis=log_export_redis.client, task_type=ConversationLogExportTask, key_prefix="conversation_log_export"
        ),
        dispatch=partial(log_export_adapters.dispatch_log_export, export_kind=LogExportKind.CONVERSATION),
        store_csv=log_export_adapters.store_log_export_csv,
        open_csv=log_export_adapters.open_log_export_csv,
    )


def test_completion_csv_writes_saved_inputs_and_counts_each_generation_once(
    sqlite_session_factory: sessionmaker[Session],
    export: ConversationLogExportService,
) -> None:
    """Keep variable values and legacy prompts while matching the export row preview."""
    account = make_account(timezone="UTC")
    app = make_app(mode=AppMode.COMPLETION)
    conversation = make_conversation(
        app_id=app.id, mode=app.mode, from_source=ConversationFromSource.CONSOLE, from_account_id=account.id
    )
    variables: dict[str, object] = {"topic": "中文标题", "count": 0, "include_tags": False, "empty": None}
    generations: list[tuple[str, dict[str, object], str]] = [
        ("generation-1", variables, ""),
        ("generation-2", {}, "Legacy prompt"),
    ]
    messages = [
        make_message(
            message_id=message_id,
            app_id=app.id,
            conversation_id=conversation.id,
            inputs=inputs,
            query=query,
            answer="Generated result",
            from_source=ConversationFromSource.CONSOLE,
            created_at=datetime(2026, 1, 15, 6),
            currency="USD",
        )
        for message_id, inputs, query in generations
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([account, app, conversation, *messages])

    context = RequestContext(request_id="test", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id)
    filters = ConsoleConversationLogFilters(
        keyword="result", start=None, end=None, annotation_status="all", sort_by="-created_at"
    )
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    scope = export.get_scope(context, app.id)
    counts = repository.get_console_log_export_counts(scope=scope, filters=filters)
    assert counts is not None
    assert (counts.conversation_count, counts.message_count) == (1, 2)

    output = StringIO(newline="")
    assert export.write_csv(context, app.id, filters=filters, output=output) == counts.message_count
    reader = csv.DictReader(StringIO(output.getvalue().removeprefix("\ufeff")))
    assert reader.fieldnames == [
        "app_id",
        "app_type",
        "end_user_id",
        "account_id",
        "account_name",
        "message_id",
        "created_at",
        "user_input",
        "app_response",
        "feedback_rating",
        "feedback_content",
    ]
    first, second = reader
    assert first["app_type"] == "Text Generator"
    assert first["account_id"] == account.id
    assert first["message_id"] == "generation-1"
    assert json.loads(first["user_input"]) == variables
    assert first["app_response"] == "Generated result"
    assert second["message_id"] == "generation-2"
    assert second["user_input"] == "Legacy prompt"


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT])
def test_chat_csv_header_includes_conversation_and_message_ids_on_an_empty_export(
    sqlite_session_factory: sessionmaker[Session], mode: AppMode, export: ConversationLogExportService
) -> None:
    account = make_account(timezone="UTC")
    app = make_app(mode=mode)
    with sqlite_session_factory.begin() as session:
        session.add_all([account, app])
    context = RequestContext(request_id="test", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id)
    output = StringIO(newline="")
    filters = ConsoleConversationLogFilters(
        keyword=None, start=None, end=None, annotation_status="all", sort_by="-created_at"
    )

    assert export.write_csv(context, app.id, filters=filters, output=output) == 0
    (header,) = csv.reader(StringIO(output.getvalue().removeprefix("\ufeff")))
    assert {"conversation_id", "message_id"} <= set(header)
    assert {"agent_id", "run_id", "status", "trigger_by", "source"}.isdisjoint(header)


@pytest.mark.parametrize("outcome", ["claim_lost", "failed", "ready"])
def test_prepare_export_records_only_claimed_work(
    outcome: str,
    sqlite_session_factory: sessionmaker[Session],
    export: ConversationLogExportService,
    log_export_redis: LogExportRedisIo,
    log_export_storage: LogExportStorageIo,
) -> None:
    """Store a file only for the winning worker and publish its final state."""
    app = make_app()
    account = make_account(timezone="UTC")
    with sqlite_session_factory.begin() as session:
        session.add_all([app, account])
    task = ConversationLogExportTask.pending(
        tenant_id=app.tenant_id,
        app_id=app.id,
        requested_by=account.id,
        filters=ConsoleConversationLogFilters(
            keyword=None, start=None, end=None, annotation_status="all", sort_by="-updated_at"
        ),
    )
    current = task
    transitions: list[tuple[str, str]] = []

    def transition(*, keys: list[str], args: list[str]) -> int:
        """Apply the expected-state update at the Redis boundary."""
        nonlocal current
        assert keys == [f"conversation_log_export:{task.tenant_id}:{task.app_id}:{task.task_id}"]
        previous_status, raw = args
        candidate = ConversationLogExportTask.model_validate_json(raw)
        transitions.append((previous_status, candidate.status))
        if outcome == "claim_lost" or current.status != previous_status:
            return 0
        current = candidate
        log_export_redis.get.return_value = raw
        return 1

    log_export_redis.get.return_value = task.model_dump_json()
    log_export_redis.register_script.return_value = transition
    if outcome == "failed":
        log_export_storage.save_from_path.side_effect = OSError("upload failed")

    if outcome == "failed":
        with pytest.raises(OSError, match="upload failed"):
            export.prepare_task(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
    else:
        export.prepare_task(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)

    if outcome == "claim_lost":
        assert transitions == [("pending", "processing")]
        log_export_storage.save_from_path.assert_not_called()
    else:
        storage_key = f"conversation-log-exports/{task.tenant_id}/{task.app_id}/{task.task_id}.csv"
        assert transitions == [("pending", "processing"), ("processing", outcome)]
        assert log_export_storage.save_from_path.call_args.args[0] == storage_key
        assert current.status == outcome
        assert current.storage_key == (storage_key if outcome == "ready" else None)
        export.prepare_task(tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id)
        log_export_storage.save_from_path.assert_called_once()


def test_console_log_csv_exports_all_turns_of_matching_conversations_in_batches(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    export: ConversationLogExportService,
) -> None:
    """Check that CSV uses the Console filters and yields each message once across batch boundaries."""
    monkeypatch.setattr(conversation_repository, "_LOG_EXPORT_BATCH_SIZE", 1)
    account = make_account(timezone="Asia/Shanghai", name="Alex, Morgan")
    app = make_app(mode=AppMode.ADVANCED_CHAT)
    end_user = EndUser(
        id="user-1", tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.SERVICE_API, session_id="customer-42"
    )
    unmatched = make_conversation(
        conversation_id="conversation-0",
        mode=app.mode,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        invoke_from=InvokeFrom.SERVICE_API,
    )
    conversation = make_conversation(
        mode=app.mode,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        invoke_from=InvokeFrom.SERVICE_API,
    )
    account_conversation = make_conversation(
        conversation_id="conversation-2",
        mode=app.mode,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        invoke_from=InvokeFrom.EXPLORE,
    )
    debug = make_conversation(
        conversation_id="conversation-3",
        mode=app.mode,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    runs = [
        WorkflowRun(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id="workflow-1",
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=status,
            created_by_role=CreatorUserRole.END_USER,
            created_by=end_user.id,
        )
        for status in (WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.PAUSED)
    ]
    messages = [
        make_message(
            app_id=app.id,
            conversation_id=owner.id,
            from_source=owner.from_source,
            message_id=f"message-{index}",
            query=query,
            answer=answer,
            message=[],
            currency="USD",
            workflow_run_id=workflow_run_id,
            created_at=datetime(2026, 1, 15, 6, 30),
        )
        for index, (owner, query, answer, workflow_run_id) in enumerate(
            [
                (conversation, "Needle", "=answer,\n你好", runs[0].id),
                (conversation, "Follow-up", "Second answer", runs[1].id),
                (account_conversation, "Needle", "Account answer", None),
                (debug, "Needle", "Debug output", None),
                (unmatched, "Other topic", "Unmatched output", None),
            ],
            1,
        )
    ]
    feedback = MessageFeedback(
        app_id=app.id,
        conversation_id=conversation.id,
        message_id=messages[0].id,
        rating=FeedbackRating.DISLIKE,
        from_source=FeedbackFromSource.USER,
        content="Needs details",
    )
    admin_feedback = MessageFeedback(
        app_id=app.id,
        conversation_id=conversation.id,
        message_id=messages[0].id,
        rating=FeedbackRating.LIKE,
        from_source=FeedbackFromSource.ADMIN,
    )
    conversations = [unmatched, conversation, account_conversation, debug]
    for item in conversations:
        item.created_at = datetime(2026, 1, 15, 6)
    with sqlite_session_factory.begin() as session:
        session.add_all([account, app, end_user, *conversations, *runs, *messages])
        session.add_all([feedback, admin_feedback])

    context = RequestContext(request_id="test", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id)
    filters = ConsoleConversationLogFilters(
        keyword="needle",
        start=datetime(2026, 1, 15, 6),
        end=datetime(2026, 1, 15, 6),
        annotation_status="all",
        sort_by="-created_at",
        end_user_ids=(end_user.id,),
        account_ids=(account.id,),
    )
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)

    class Output(StringIO):
        @override
        def write(self, text: str, /) -> int:
            assert pool.checkedout() == 0
            return super().write(text)

    output = Output(newline="")

    assert export.write_csv(context, app.id, filters=filters, output=output) == 3
    scope = repository.get_console_scope(context, app.id, kind="chat")
    counts = repository.get_console_log_export_counts(scope=scope, filters=filters)
    assert counts is not None
    assert (counts.conversation_count, counts.message_count) == (2, 3)

    contents = output.getvalue()
    assert contents.startswith("\ufeff")
    reader = csv.DictReader(StringIO(contents.removeprefix("\ufeff")))
    assert reader.fieldnames == [
        "app_id",
        "app_type",
        "end_user_id",
        "account_id",
        "account_name",
        "conversation_id",
        "message_id",
        "created_at",
        "user_input",
        "app_response",
        "feedback_rating",
        "feedback_content",
        "status",
    ]
    first, second, account_row = list(reader)
    assert [first["message_id"], second["message_id"], account_row["message_id"]] == [
        "message-1",
        "message-2",
        "message-3",
    ]
    assert first["app_type"] == "Chatflow"
    assert first["end_user_id"] == "customer-42"
    assert first["app_response"] == "'=answer,\n你好"
    assert first["created_at"] == "2026-01-15T06:30:00+00:00"
    assert first["feedback_rating"] == "dislike"
    assert first["feedback_content"] == "Needs details"
    assert first["status"] == second["status"] == "paused"
    assert second["user_input"] == "Follow-up"
    assert account_row["account_id"] == account.id
    assert account_row["account_name"] == "Alex, Morgan"
    assert account_row["status"] == ""
