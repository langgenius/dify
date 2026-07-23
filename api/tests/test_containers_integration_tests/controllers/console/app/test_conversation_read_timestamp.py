from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console.app.conversation import _get_conversation
from models.enums import ConversationFromSource
from models.model import AppMode, Conversation
from tests.test_containers_integration_tests.controllers.console.helpers import (
    create_console_account_and_tenant,
    create_console_app,
)


def test_get_conversation_mark_read_keeps_updated_at_unchanged(
    container_session: Session,
):
    account, tenant = create_console_account_and_tenant(container_session)
    app = create_console_app(container_session, tenant.id, account.id, AppMode.CHAT)

    original_updated_at = datetime(2026, 2, 8, 0, 0, 0)
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
    container_session.add(conversation)
    container_session.commit()

    read_at = datetime(2026, 2, 9, 0, 0, 0)

    with patch(
        "controllers.console.app.conversation.naive_utc_now",
        return_value=read_at,
        autospec=True,
    ):
        loaded = _get_conversation(container_session, account, app, conversation.id)

    container_session.refresh(conversation)

    assert loaded.id == conversation.id
    assert conversation.read_at == read_at
    assert conversation.read_account_id == account.id
    assert conversation.updated_at == original_updated_at


def test_get_conversation_raises_not_found_for_missing_conversation(
    container_session: Session,
):
    account, tenant = create_console_account_and_tenant(container_session)
    app = create_console_app(container_session, tenant.id, account.id, AppMode.CHAT)

    with pytest.raises(NotFound):
        _get_conversation(container_session, account, app, "00000000-0000-0000-0000-000000000000")
