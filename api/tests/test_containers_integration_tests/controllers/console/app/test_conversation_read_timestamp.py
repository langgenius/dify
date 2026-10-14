"""Execute Console read-marker writes against PostgreSQL without replacing the clock."""

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.enums import ConversationFromSource
from models.model import AppMode, Conversation
from repositories.conversation_repository import ConversationRepository
from services.errors.conversation import ConversationNotExistsError
from tests.test_containers_integration_tests.controllers.console.helpers import (
    create_console_account_and_tenant,
    create_console_app,
)


def test_console_detail_then_mark_preserves_updated_at_and_the_first_reader(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    original_updated_at = datetime(2020, 2, 8)
    conversation = Conversation(
        app_id=app.id,
        name="read timestamp test",
        inputs={},
        status="normal",
        mode=AppMode.CHAT,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        updated_at=original_updated_at,
    )
    db_session_with_containers.add(conversation)
    db_session_with_containers.commit()
    context = RequestContext(
        request_id="postgres-read", trace_id=None, account_id=account.id, active_workspace_id=tenant.id
    )
    app_id, conversation_id = app.id, conversation.id
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    db_session_with_containers.rollback()
    repository = ConversationRepository(session_factory=sessions)

    loaded = repository.get_console_detail(context, app_id, conversation_id, kind="chat")
    assert loaded.record.id == conversation_id
    with sessions() as session:
        stored = session.get_one(Conversation, conversation_id)
        assert stored.read_at is None
        assert stored.read_account_id is None
        assert stored.updated_at == original_updated_at

    before = naive_utc_now()
    repository.mark_console_read(context, app_id, conversation_id, kind="chat")
    after = naive_utc_now()
    with sessions() as session:
        stored = session.get_one(Conversation, conversation_id)
        first_read_at = stored.read_at
        assert before <= first_read_at <= after
        assert stored.read_account_id == context.account_id
        assert stored.updated_at == original_updated_at

    second_reader = context._replace(account_id=str(uuid4()))
    repository.mark_console_read(second_reader, app_id, conversation_id, kind="chat")
    with sessions() as session:
        stored = session.get_one(Conversation, conversation_id)
        assert stored.read_at == first_read_at
        assert stored.read_account_id == context.account_id
        assert stored.updated_at == original_updated_at


def test_console_missing_detail_or_mark_does_not_mark_another_conversation(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.CHAT)
    conversation = Conversation(
        app_id=app.id,
        name="Untouched conversation",
        inputs={},
        mode=AppMode.CHAT,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    db_session_with_containers.add(conversation)
    db_session_with_containers.commit()
    context = RequestContext(
        request_id="postgres-read", trace_id=None, account_id=account.id, active_workspace_id=tenant.id
    )
    app_id, conversation_id = app.id, conversation.id
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    db_session_with_containers.rollback()
    repository = ConversationRepository(session_factory=sessions)
    missing_id = str(uuid4())
    with pytest.raises(ConversationNotExistsError):
        repository.get_console_detail(context, app_id, missing_id, kind="chat")
    with pytest.raises(ConversationNotExistsError):
        repository.mark_console_read(context, app_id, missing_id, kind="chat")
    with sessions() as session:
        stored = session.get_one(Conversation, conversation_id)
        assert stored.read_at is None
        assert stored.read_account_id is None
