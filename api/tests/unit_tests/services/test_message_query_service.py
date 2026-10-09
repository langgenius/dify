from datetime import timedelta
from typing import Literal

import pytest
from pydantic import JsonValue
from sqlalchemy import delete, event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from models.enums import ConversationFromSource
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputFormStatus
from models.model import Message
from repositories.message_repository import MessageRepository
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.entities.message_entities import MessageAccount
from services.message_query_adapters import ExecutionExtraContentReader, MessageFileResolver
from services.message_query_service import MessageQueryService
from tests.test_containers_integration_tests.helpers.execution_extra_content import create_human_input_message_fixture


@pytest.mark.parametrize("query_kind", ["actor", "console", "detail"])
@pytest.mark.parametrize("submitted", [False, True], ids=["waiting", "submitted"])
def test_extra_contents_are_loaded_after_message_session_closes(
    sqlite_session_factory: sessionmaker[Session],
    query_kind: Literal["actor", "console", "detail"],
    submitted: bool,
) -> None:
    with sqlite_session_factory() as session:
        fixture = create_human_input_message_fixture(session)
        if not submitted:
            fixture.form.status = HumanInputFormStatus.WAITING
            fixture.form.selected_action_id = None
            fixture.form.submitted_at = None
            fixture.form.submitted_data = None
        app_id, tenant_id = fixture.app.id, fixture.app.tenant_id
        account_id, conversation_id = fixture.account.id, fixture.conversation.id
        message_id, form_id = fixture.message.id, fixture.form.id
        workflow_run_id = fixture.message.workflow_run_id
        expiration_time = int(fixture.form.expiration_time.timestamp())
        later = Message(
            app_id=app_id,
            conversation_id=conversation_id,
            inputs={},
            query="Later question",
            message={},
            answer="Later answer",
            message_unit_price=0,
            answer_unit_price=0,
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account_id,
            created_at=fixture.message.created_at + timedelta(seconds=1),
        )
        session.add(later)
        session.commit()
        later_id = later.id

    page_sessions: list[Session] = []
    content_sessions: list[Session] = []
    contents_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    def record_page_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        page_sessions.append(session)

    def check_page_closed(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert page_sessions
        assert all(not previous.in_transaction() and not previous.identity_map for previous in page_sessions)
        content_sessions.append(session)

    event.listen(sqlite_session_factory, "after_begin", record_page_session)
    event.listen(contents_factory, "after_begin", check_page_closed)
    service = MessageQueryService(
        messages=MessageRepository(session_factory=sqlite_session_factory),
        files=MessageFileResolver(),
        extra_contents=ExecutionExtraContentReader(
            repository=SQLAlchemyExecutionExtraContentRepository(session_maker=contents_factory)
        ),
    )
    try:
        if query_kind == "detail":
            records = (
                service.get_console_message(
                    app_id=app_id,
                    app_owner_tenant_id=tenant_id,
                    account_id=account_id,
                    message_id=message_id,
                ),
            )
        elif query_kind == "console":
            page = service.get_console_page(
                app_id=app_id,
                app_owner_tenant_id=tenant_id,
                account_id=account_id,
                conversation_id=conversation_id,
                first_id=None,
                limit=10,
            )
            records = page.data
        else:
            page = service.get_page(
                app_id=app_id,
                app_owner_tenant_id=tenant_id,
                actor=MessageAccount(account_id=account_id),
                conversation_id=conversation_id,
                first_id=None,
                limit=10,
            )
            records = page.data
    finally:
        event.remove(sqlite_session_factory, "after_begin", record_page_session)
        event.remove(contents_factory, "after_begin", check_page_closed)

    assert content_sessions
    assert all(not session.in_transaction() and not session.identity_map for session in content_sessions)
    expected_ids = [message_id] if query_kind == "detail" else [message_id, later_id]
    assert [message.id for message in records] == expected_ids
    expected_content: dict[str, JsonValue] = {
        "workflow_run_id": workflow_run_id,
        "type": "human_input",
        "submitted": submitted,
        "form_definition": {
            "form_id": form_id,
            "node_id": "node-id",
            "node_title": "Approval",
            "form_content": "Rendered block",
            "inputs": [],
            "actions": [{"id": "approve", "title": "Approve request", "button_style": "default"}],
            "display_in_ui": True,
            "resolved_default_values": {},
            "expiration_time": expiration_time,
        },
    }
    if submitted:
        expected_content["form_submission_data"] = {
            "node_id": "node-id",
            "node_title": "Approval",
            "rendered_content": "Rendered block",
            "action_id": "approve",
            "action_text": "Approve request",
            "submitted_data": {"name": "Alice"},
        }
    assert records[0].extra_contents == [expected_content]
    if query_kind != "detail":
        assert [message.extra_contents for message in records[1:]] == [[]]


def test_empty_page_does_not_open_extra_content_session(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory() as session:
        fixture = create_human_input_message_fixture(session)
        app_id, tenant_id = fixture.app.id, fixture.app.tenant_id
        account_id, conversation_id = fixture.account.id, fixture.conversation.id
        session.execute(delete(HumanInputContent).where(HumanInputContent.message_id == fixture.message.id))
        session.execute(delete(Message).where(Message.id == fixture.message.id))
        session.commit()

    content_sessions: list[Session] = []
    contents_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    def record_content_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        content_sessions.append(session)

    event.listen(contents_factory, "after_begin", record_content_session)
    try:
        page = MessageQueryService(
            messages=MessageRepository(session_factory=sqlite_session_factory),
            files=MessageFileResolver(),
            extra_contents=ExecutionExtraContentReader(
                repository=SQLAlchemyExecutionExtraContentRepository(session_maker=contents_factory)
            ),
        ).get_page(
            app_id=app_id,
            app_owner_tenant_id=tenant_id,
            actor=MessageAccount(account_id=account_id),
            conversation_id=conversation_id,
            first_id=None,
            limit=10,
        )
    finally:
        event.remove(contents_factory, "after_begin", record_content_session)

    assert page.data == ()
    assert page.has_more is False
    assert content_sessions == []
