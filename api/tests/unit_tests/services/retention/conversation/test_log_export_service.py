"""Exercise Console log CSV exports with real conversation queries."""

import csv
from datetime import datetime
from io import StringIO

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
from services.retention.conversation.log_export_service import ConversationLogExportService
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_message


def test_console_log_csv_exports_all_turns_of_matching_conversations_in_batches(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
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
    service = ConversationLogExportService(conversations=repository)
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)

    class Output(StringIO):
        def write(self, text: str, /) -> int:
            assert pool.checkedout() == 0
            return super().write(text)

    output = Output(newline="")

    assert service.write_csv(context, app.id, filters=filters, output=output) == 3
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
        "run_id",
        "message_id",
        "created_at",
        "user_input",
        "app_response",
        "feedback_rating",
        "feedback_content",
        "status",
        "trigger_by",
        "source",
        "agent_id",
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
