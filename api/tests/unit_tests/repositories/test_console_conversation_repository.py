"""Exercise Console log queries and detached response snapshots against real SQL."""

import json
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from fields.conversation_fields import Conversation as CompletionResponse
from fields.conversation_fields import ConversationResponseSource, ConversationWithSummary
from graphon.enums import WorkflowExecutionStatus
from machinery.context import RequestContext
from models.account import Account
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    FeedbackFromSource,
    FeedbackRating,
    InvokeFrom,
    WorkflowRunTriggeredFrom,
)
from models.model import App, AppMode, Conversation, EndUser, Message, MessageAnnotation, MessageFeedback
from models.workflow import WorkflowRun, WorkflowType
from repositories.conversation_repository import ConversationRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import (
    ConsoleChatConversationRecord,
    ConsoleCompletionConversationRecord,
    ConsoleConversationFilters,
    ConsoleConversationKind,
    ConsoleConversationPage,
    ConsoleConversationScope,
    ConversationAnnotationStatus,
    ConversationSort,
)

_TIME = datetime(2026, 10, 13, 12, 30)
_FILTERS = ConsoleConversationFilters(
    keyword=None, start=None, end=None, annotation_status="all", sort_by="-updated_at", page=1, limit=20
)


@dataclass(frozen=True)
class ConsoleData:
    context: RequestContext
    app_id: str
    end_user_id: str


@pytest.fixture
def console_data(sqlite_session_factory: sessionmaker[Session]) -> ConsoleData:
    with sqlite_session_factory.begin() as session:
        account = Account(name="Maintainer", email="maintainer@example.com", timezone="Asia/Shanghai")
        app = App(tenant_id=str(uuid4()), name="Chat app", mode=AppMode.CHAT, enable_api=True, enable_site=True)
        session.add_all([account, app])
        session.flush()
        end_user = EndUser(tenant_id=app.tenant_id, app_id=app.id, type="browser", session_id="visitor-needle")
        session.add(end_user)
        session.flush()
        return ConsoleData(
            context=RequestContext(
                request_id="test", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id
            ),
            app_id=app.id,
            end_user_id=end_user.id,
        )


def _conversation(session: Session, data: ConsoleData, *, mode: AppMode = AppMode.CHAT) -> Conversation:
    conversation = Conversation(
        app_id=data.app_id,
        mode=mode,
        name="Conversation",
        inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=data.end_user_id,
        from_account_id=None,
        status="normal",
        created_at=_TIME,
        updated_at=_TIME,
        invoke_from=InvokeFrom.SERVICE_API,
        is_deleted=False,
    )
    session.add(conversation)
    session.flush()
    return conversation


def _message(session: Session, conversation: Conversation, *, query: str = "First query") -> Message:
    message = Message(
        app_id=conversation.app_id,
        conversation_id=conversation.id,
        inputs={"zero": 0, "empty": "", "none": None},
        query=query,
        message=[{"text": "Prompt text"}],
        message_unit_price=Decimal(0),
        answer="Answer",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=conversation.from_end_user_id,
        created_at=_TIME,
    )
    session.add(message)
    session.flush()
    return message


def _scope(
    factory: sessionmaker[Session], data: ConsoleData, *, kind: ConsoleConversationKind = "chat"
) -> ConsoleConversationScope:
    return ConversationRepository(session_factory=factory).get_console_scope(data.context, data.app_id, kind=kind)


def _page(
    factory: sessionmaker[Session], data: ConsoleData, *, filters: ConsoleConversationFilters = _FILTERS
) -> ConsoleConversationPage:
    return ConversationRepository(session_factory=factory).get_console_page(
        scope=_scope(factory, data), filters=filters
    )


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_chat_scope_allows_supported_modes_and_returns_account_timezone(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, mode: AppMode
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, console_data.app_id)
        app.mode = mode
    scope = _scope(sqlite_session_factory, console_data)
    assert scope == ConsoleConversationScope(
        app_id=console_data.app_id,
        tenant_id=console_data.context.active_workspace_id,
        app_mode=mode,
        timezone="Asia/Shanghai",
    )


@pytest.mark.parametrize("change", ["missing", "tenant", "status", "mode", "hidden_agent"])
def test_scope_rejects_unavailable_or_hidden_app(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, change: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, console_data.app_id)
        if change == "missing":
            session.delete(app)
        elif change == "tenant":
            app.tenant_id = str(uuid4())
        elif change == "status":
            session.execute(
                text("UPDATE apps SET status = :status WHERE id = :id"), {"status": "disabled", "id": app.id}
            )
        elif change == "mode":
            app.mode = AppMode.COMPLETION
        else:
            app.mode = AppMode.AGENT
            session.add(
                Agent(
                    tenant_id=app.tenant_id,
                    name="Hidden",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    backing_app_id=app.id,
                    status=AgentStatus.ARCHIVED,
                )
            )
    with pytest.raises(ConsoleAppNotFoundError) as error:
        _scope(sqlite_session_factory, console_data)
    assert str(error.value) == (
        "App mode is not in the supported list: ['advanced-chat', 'agent', 'agent-chat', 'chat']"
        if change == "mode"
        else "App not found."
    )


@pytest.mark.parametrize("change", ["missing", "tenant", "status", "mode", "hidden_agent"])
def test_page_rechecks_app_after_scope_resolution(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, change: str
) -> None:
    if change == "hidden_agent":
        with sqlite_session_factory.begin() as session:
            session.get_one(App, console_data.app_id).mode = AppMode.AGENT
    scope = _scope(sqlite_session_factory, console_data)
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, console_data.app_id)
        if change == "missing":
            session.delete(app)
        elif change == "tenant":
            app.tenant_id = str(uuid4())
        elif change == "status":
            session.execute(
                text("UPDATE apps SET status = :status WHERE id = :id"), {"status": "disabled", "id": app.id}
            )
        elif change == "mode":
            app.mode = AppMode.ADVANCED_CHAT
        else:
            session.add(
                Agent(
                    tenant_id=app.tenant_id,
                    name="Hidden",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    backing_app_id=app.id,
                )
            )
    with pytest.raises(ConsoleAppNotFoundError) as error:
        ConversationRepository(session_factory=sqlite_session_factory).get_console_page(scope=scope, filters=_FILTERS)
    assert str(error.value) == (
        "App mode changed from 'chat' to 'advanced-chat' after admission." if change == "mode" else "App not found."
    )


def test_console_page_spans_actors_but_excludes_deleted_and_other_apps(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    with sqlite_session_factory.begin() as session:
        first = _conversation(session, console_data)
        other_user = _conversation(session, console_data)
        other_user.from_end_user_id = str(uuid4())
        account = _conversation(session, console_data)
        account.from_source = ConversationFromSource.CONSOLE
        account.from_end_user_id = None
        account.from_account_id = console_data.context.account_id
        deleted = _conversation(session, console_data)
        deleted.is_deleted = True
        other_app = _conversation(session, console_data)
        other_app.app_id = str(uuid4())
    page = _page(sqlite_session_factory, console_data)
    assert {item.id for item in page.items} == {first.id, other_user.id, account.id}
    assert page.total == 3
    assert page.has_next is False
    assert page.tenant_id == console_data.context.active_workspace_id


@pytest.mark.parametrize("field", ["query", "answer", "name", "introduction", "end_user"])
def test_chat_keyword_matches_each_legacy_field_case_insensitively_without_duplicates(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, field: str
) -> None:
    with sqlite_session_factory.begin() as session:
        row = _conversation(session, console_data)
        message = _message(session, row, query="Other")
        _message(session, row, query="Other")
        if field == "query":
            message.query = "Some NEEDLE phrase"
        elif field == "answer":
            message.answer = "Some NEEDLE phrase"
        elif field == "name":
            row.name = "Some NEEDLE phrase"
        elif field == "introduction":
            row.introduction = "Some NEEDLE phrase"
        no_messages = _conversation(session, console_data)
        no_messages.name = "NEEDLE"
    page = _page(sqlite_session_factory, console_data, filters=replace(_FILTERS, keyword="needle"))
    assert [item.id for item in page.items] == [row.id]
    assert page.total == 1


@pytest.mark.parametrize("keyword", ["%", "_", "\\"])
def test_keyword_treats_wildcards_as_literal_characters(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, keyword: str
) -> None:
    with sqlite_session_factory.begin() as session:
        literal = _conversation(session, console_data)
        _message(session, literal, query=f"Literal {keyword}")
        ordinary = _conversation(session, console_data)
        _message(session, ordinary, query="Ordinary text")
    page = _page(sqlite_session_factory, console_data, filters=replace(_FILTERS, keyword=keyword))
    assert [item.id for item in page.items] == [literal.id]


def test_completion_keeps_message_join_duplicates_and_only_completion_rows(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(App, console_data.app_id).mode = AppMode.COMPLETION
        row = _conversation(session, console_data, mode=AppMode.COMPLETION)
        _message(session, row, query="Needle 1")
        _message(session, row, query="Needle 2")
        wrong_mode = _conversation(session, console_data)
        _message(session, wrong_mode, query="Needle")
    page = ConversationRepository(session_factory=sqlite_session_factory).get_console_page(
        scope=_scope(sqlite_session_factory, console_data, kind="completion"),
        filters=replace(_FILTERS, keyword="needle", limit=1),
    )
    assert [item.id for item in page.items] == [row.id]
    assert page.total == 2
    assert page.has_next is True


@pytest.mark.parametrize("annotation_status", ["all", "annotated", "not_annotated"])
def test_annotation_filter_and_pagination(
    sqlite_session_factory: sessionmaker[Session],
    console_data: ConsoleData,
    annotation_status: ConversationAnnotationStatus,
) -> None:
    with sqlite_session_factory.begin() as session:
        annotated = _conversation(session, console_data)
        plain = _conversation(session, console_data)
        session.add_all(
            [
                MessageAnnotation(
                    app_id=console_data.app_id,
                    conversation_id=annotated.id,
                    question="Question",
                    content="Answer",
                    account_id=console_data.context.account_id,
                ),
                MessageAnnotation(
                    app_id=console_data.app_id,
                    conversation_id=annotated.id,
                    question="Question 2",
                    content="Answer 2",
                    account_id=console_data.context.account_id,
                ),
            ]
        )
    page = _page(sqlite_session_factory, console_data, filters=replace(_FILTERS, annotation_status=annotation_status))
    expected = (
        {annotated.id, plain.id}
        if annotation_status == "all"
        else {annotated.id if annotation_status == "annotated" else plain.id}
    )
    assert {item.id for item in page.items} == expected
    assert page.total == len(expected)


@pytest.mark.parametrize("sort_by", ["created_at", "-created_at", "updated_at", "-updated_at"])
def test_time_filter_and_sort_use_the_same_column_and_include_end_minute(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, sort_by: ConversationSort
) -> None:
    with sqlite_session_factory.begin() as session:
        before = _conversation(session, console_data)
        before.created_at = _TIME - timedelta(seconds=1)
        before.updated_at = _TIME - timedelta(seconds=1)
        start = _conversation(session, console_data)
        end = _conversation(session, console_data)
        end.created_at = _TIME.replace(second=59)
        end.updated_at = _TIME.replace(second=59)
        after = _conversation(session, console_data)
        after.created_at = _TIME + timedelta(minutes=1)
        after.updated_at = _TIME + timedelta(minutes=1)
        other_column = _conversation(session, console_data)
        if "updated" in sort_by:
            other_column.updated_at = _TIME + timedelta(minutes=2)
        else:
            other_column.created_at = _TIME + timedelta(minutes=2)
    page = _page(
        sqlite_session_factory,
        console_data,
        filters=replace(_FILTERS, start=_TIME, end=_TIME.replace(second=59), sort_by=sort_by, limit=1),
    )
    assert page.total == 2
    assert page.has_next is True
    assert [item.id for item in page.items] == [end.id if sort_by.startswith("-") else start.id]
    next_page = _page(
        sqlite_session_factory,
        console_data,
        filters=replace(_FILTERS, start=_TIME, end=_TIME.replace(second=59), sort_by=sort_by, limit=1, page=2),
    )
    assert next_page.has_next is False
    assert [item.id for item in next_page.items] == [start.id if sort_by.startswith("-") else end.id]


def test_advanced_chat_hides_debugger_and_null_invoke_source(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(App, console_data.app_id).mode = AppMode.ADVANCED_CHAT
        visible = _conversation(session, console_data, mode=AppMode.ADVANCED_CHAT)
        debugger = _conversation(session, console_data, mode=AppMode.ADVANCED_CHAT)
        debugger.invoke_from = InvokeFrom.DEBUGGER
        legacy = _conversation(session, console_data, mode=AppMode.ADVANCED_CHAT)
        legacy.invoke_from = None
    assert [item.id for item in _page(sqlite_session_factory, console_data).items] == [visible.id]


@pytest.mark.parametrize("completion", [False, True])
def test_snapshots_match_existing_response_fields_and_close_all_read_sessions(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, console_data: ConsoleData, completion: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        mode = AppMode.COMPLETION if completion else AppMode.CHAT
        session.get_one(App, console_data.app_id).mode = mode
        row = _conversation(session, console_data, mode=mode)
        row.override_model_configs = json.dumps(
            {"model": {"name": "selected-model", "provider": "provider"}, "pre_prompt": "Prefix"}
        )
        first = _message(session, row)
        session.add(
            MessageAnnotation(
                app_id=console_data.app_id,
                conversation_id=row.id,
                question="Reviewed",
                content="Annotation",
                account_id=console_data.context.account_id,
            )
        )
        session.add(
            MessageFeedback(
                app_id=console_data.app_id,
                conversation_id=row.id,
                message_id=first.id,
                rating=FeedbackRating.LIKE,
                from_source=FeedbackFromSource.USER,
            )
        )
        session.add(
            MessageFeedback(
                app_id=console_data.app_id,
                conversation_id=row.id,
                message_id=first.id,
                rating=FeedbackRating.DISLIKE,
                from_source=FeedbackFromSource.ADMIN,
            )
        )
    response_type = CompletionResponse if completion else ConversationWithSummary
    with sqlite_session_factory() as session:
        row = session.get_one(Conversation, row.id)
        expected = response_type.model_validate(ConversationResponseSource(row, session=session)).model_dump(
            mode="json"
        )
    checkouts: list[int] = []
    checkins: list[int] = []

    def checked_out(_connection: object, _record: object, _proxy: object) -> None:
        checkouts.append(1)

    def checked_in(_connection: object, _record: object) -> None:
        checkins.append(1)

    event.listen(sqlite_engine, "checkout", checked_out)
    event.listen(sqlite_engine, "checkin", checked_in)
    try:
        scope = _scope(sqlite_session_factory, console_data, kind="completion" if completion else "chat")
        page = ConversationRepository(session_factory=sqlite_session_factory).get_console_page(
            scope=scope, filters=_FILTERS
        )
        assert len(checkouts) == len(checkins) == 2
        item = page.items[0]
        assert response_type.model_validate(item).model_dump(mode="json") == expected
        assert len(checkouts) == 2  # Detached serialization cannot execute SQL.
        assert item.model_config["model"] == expected["model_config"]["model"]
        if completion:
            assert isinstance(item, ConsoleCompletionConversationRecord)
            assert item.first_message is not None
            assert item.first_message.inputs == {"zero": 0, "empty": "", "none": None}
            assert item.annotation is not None
            assert item.annotation.account is not None
            assert item.annotation.account.email == "maintainer@example.com"
        else:
            assert isinstance(item, ConsoleChatConversationRecord)
            assert item.summary_or_query == "First query"
            assert item.message_count == 1
            assert item.annotated is True
    finally:
        event.remove(sqlite_engine, "checkout", checked_out)
        event.remove(sqlite_engine, "checkin", checked_in)


def test_empty_page_preserves_requested_page_and_limit(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    assert _page(
        sqlite_session_factory, console_data, filters=replace(_FILTERS, page=8, limit=5)
    ) == ConsoleConversationPage(
        tenant_id=console_data.context.active_workspace_id, page=8, per_page=5, total=0, has_next=False, items=()
    )


def test_completion_returns_raw_file_inputs_without_restoration(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    # An invalid/missing upload would fail file restoration. Persistence must only
    # snapshot it; the query service owns restoration after this session closes.
    raw_file = {
        "dify_model_identity": "__dify__file__",
        "transfer_method": "local_file",
        "upload_file_id": str(uuid4()),
    }
    with sqlite_session_factory.begin() as session:
        session.get_one(App, console_data.app_id).mode = AppMode.COMPLETION
        row = _conversation(session, console_data, mode=AppMode.COMPLETION)
        message = _message(session, row)
        message.inputs = {"attachment": raw_file}
    result = (
        ConversationRepository(session_factory=sqlite_session_factory)
        .get_console_page(scope=_scope(sqlite_session_factory, console_data, kind="completion"), filters=_FILTERS)
        .items[0]
    )
    assert isinstance(result, ConsoleCompletionConversationRecord)
    assert result.first_message is not None
    assert result.first_message.inputs == {"attachment": raw_file}


@pytest.mark.parametrize("completion", [False, True])
def test_empty_conversation_snapshot_preserves_nullable_and_zero_fields(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, completion: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        mode = AppMode.COMPLETION if completion else AppMode.CHAT
        session.get_one(App, console_data.app_id).mode = mode
        _conversation(session, console_data, mode=mode)
    record = (
        ConversationRepository(session_factory=sqlite_session_factory)
        .get_console_page(
            scope=_scope(sqlite_session_factory, console_data, kind="completion" if completion else "chat"),
            filters=_FILTERS,
        )
        .items[0]
    )
    assert record.read_at is None
    assert record.user_feedback_stats == record.admin_feedback_stats == {"like": 0, "dislike": 0}
    if completion:
        assert isinstance(record, ConsoleCompletionConversationRecord)
        assert record.first_message is None
        assert record.annotation is None
    else:
        assert isinstance(record, ConsoleChatConversationRecord)
        assert record.summary_or_query == ""
        assert record.message_count == 0
        assert record.annotated is False
        assert record.status_count is None


@pytest.mark.parametrize("foreign_app", [False, True])
def test_chat_status_counts_preserve_duplicate_messages_and_app_scope(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, foreign_app: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        row = _conversation(session, console_data)
        run = WorkflowRun(
            tenant_id=console_data.context.active_workspace_id,
            app_id=str(uuid4()) if foreign_app else console_data.app_id,
            workflow_id=str(uuid4()),
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_by_role=CreatorUserRole.END_USER,
            created_by=console_data.end_user_id,
        )
        session.add(run)
        session.flush()
        first = _message(session, row)
        first.workflow_run_id = run.id
        second = _message(session, row)
        second.workflow_run_id = run.id
        missing = _message(session, row)
        missing.workflow_run_id = str(uuid4())
    record = _page(sqlite_session_factory, console_data).items[0]
    assert isinstance(record, ConsoleChatConversationRecord)
    assert record.message_count == 3
    assert record.status_count == {"success": 0 if foreign_app else 2, "failed": 0, "partial_success": 0, "paused": 0}
