from decimal import Decimal

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from models.base import Base, TypeBase
from models.enums import ApiTokenType, ConversationFromSource, EndUserType
from models.model import ApiToken, App, AppMode, AppStar, Conversation, EndUser, Message

TARGET_MODELS = (App, AppStar, Conversation, Message, EndUser, ApiToken)


def test_app_conversation_models_use_typebase_registry() -> None:
    for model in TARGET_MODELS:
        mapper = inspect(model)
        assert mapper.registry is TypeBase.registry
        assert mapper.registry is not Base.registry


def test_generated_identifiers_and_collection_defaults_are_independent() -> None:
    first = Conversation(
        app_id="app-1",
        mode=AppMode.CHAT,
        name="First",
        from_source=ConversationFromSource.API,
    )
    second = Conversation(
        app_id="app-1",
        mode=AppMode.CHAT,
        name="Second",
        from_source=ConversationFromSource.API,
    )

    assert first.id != second.id
    assert first._inputs == second._inputs == {}
    assert first._inputs is not second._inputs


@pytest.mark.parametrize("sqlite_session", [TARGET_MODELS], indirect=True)
def test_app_conversation_models_persist_with_relationships(sqlite_session: Session) -> None:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Typed app",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )
    star = AppStar(id="star-1", tenant_id=app.tenant_id, app_id=app.id, account_id="account-1")
    conversation = Conversation(
        id="conversation-1",
        app_id=app.id,
        mode=AppMode.CHAT,
        name="Typed conversation",
        from_source=ConversationFromSource.API,
    )
    message = Message(
        id="message-1",
        app_id=app.id,
        conversation_id=conversation.id,
        query="hello",
        message={"role": "user"},
        answer="world",
        from_source=ConversationFromSource.API,
        total_price=Decimal(0),
    )
    end_user = EndUser(
        id="end-user-1",
        tenant_id=app.tenant_id,
        app_id=app.id,
        type=EndUserType.BROWSER,
        session_id="session-1",
    )
    token = ApiToken(
        id="token-1",
        app_id=app.id,
        tenant_id=app.tenant_id,
        type=ApiTokenType.APP,
        token="secret",
    )

    sqlite_session.add_all([app, star, conversation, message, end_user, token])
    sqlite_session.commit()

    persisted_conversation = sqlite_session.get(Conversation, conversation.id)
    assert persisted_conversation is not None
    assert [item.id for item in persisted_conversation.messages] == [message.id]
    assert sqlite_session.get(AppStar, star.id) is not None
    assert sqlite_session.get(EndUser, end_user.id) is not None
    assert sqlite_session.get(ApiToken, token.id) is not None
    assert message.created_at is not None
