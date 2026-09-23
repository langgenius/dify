from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    FeedbackFromSource,
    FeedbackRating,
)
from models.model import App, AppMode, Message, MessageFeedback
from models.web import SavedMessage
from repositories.saved_message_repository import SQLAlchemySavedMessageRepository
from services.errors.message import LastMessageNotExistsError, MessageNotExistsError
from services.saved_message_service import SavedMessageActor

_APP_ID = "11111111-1111-4111-8111-111111111111"
_OTHER_APP_ID = "22222222-2222-4222-8222-222222222222"
_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333"
_END_USER_ID = "44444444-4444-4444-8444-444444444444"
_OTHER_ACCOUNT_ID = "66666666-6666-4666-8666-666666666666"


def _persist_app(session: Session, *, app_id: str = _APP_ID, mode: AppMode = AppMode.COMPLETION) -> App:
    app = App(
        id=app_id,
        tenant_id="55555555-5555-4555-8555-555555555555",
        name="Saved message app",
        description="",
        mode=mode,
        icon_type=None,
        icon=None,
        icon_background=None,
        enable_site=True,
        enable_api=True,
        is_public=True,
        max_active_requests=None,
    )
    session.add(app)
    session.flush()
    return app


def _persist_message(
    session: Session,
    *,
    app_id: str = _APP_ID,
    actor: SavedMessageActor,
    created_at: datetime,
    feedback: FeedbackRating | None = None,
) -> Message:
    message = Message(
        id=str(uuid4()),
        app_id=app_id,
        conversation_id=str(uuid4()),
        query="hello",
        message={"role": "user", "content": "hello"},
        answer="world",
        message_tokens=1,
        message_unit_price=Decimal(0),
        answer_tokens=1,
        answer_unit_price=Decimal(0),
        provider_response_latency=0,
        currency="USD",
        from_source=(ConversationFromSource.CONSOLE if actor.role == "account" else ConversationFromSource.API),
        from_end_user_id=actor.id if actor.role == "end_user" else None,
        from_account_id=actor.id if actor.role == "account" else None,
        app_mode=AppMode.COMPLETION,
    )
    message._inputs = {"topic": "test"}
    message.created_at = created_at
    session.add(message)
    session.flush()
    if feedback is not None:
        session.add(
            MessageFeedback(
                app_id=app_id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=feedback,
                from_source=FeedbackFromSource.USER,
                from_account_id=actor.id if actor.role == "account" else None,
                from_end_user_id=actor.id if actor.role == "end_user" else None,
            )
        )
    return message


def _save_message(session: Session, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None:
    session.add(
        SavedMessage(
            app_id=app_id,
            message_id=message_id,
            created_by_role=CreatorUserRole(actor.role),
            created_by=actor.id,
        )
    )
    session.flush()


def _repository(session_factory: sessionmaker[Session]) -> SQLAlchemySavedMessageRepository:
    return SQLAlchemySavedMessageRepository(session_factory=session_factory)


def test_list_returns_detached_records(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = SavedMessageActor.account(_ACCOUNT_ID)
    with sqlite_session_factory.begin() as session:
        _persist_app(session)
        oldest = _persist_message(session, actor=account, created_at=datetime(2026, 1, 1))
        middle = _persist_message(session, actor=account, created_at=datetime(2026, 1, 2))
        newest = _persist_message(
            session,
            actor=account,
            created_at=datetime(2026, 1, 3),
            feedback=FeedbackRating.LIKE,
        )
        for message in (oldest, middle, newest):
            _save_message(session, app_id=_APP_ID, actor=account, message_id=message.id)

    result = _repository(sqlite_session_factory).pagination_by_last_id(
        app_id=_APP_ID,
        actor=account,
        last_id=None,
        limit=2,
    )

    assert result.limit == 2
    assert result.has_more is True
    assert [record.id for record in result.data] == [newest.id, middle.id]
    assert result.data[0].inputs == {"topic": "test"}
    assert result.data[0].message_files == []
    assert result.data[0].user_feedback is not None
    assert result.data[0].user_feedback.rating == FeedbackRating.LIKE.value


@pytest.mark.parametrize(
    ("saved_app_id", "saved_actor"),
    [
        pytest.param(_OTHER_APP_ID, SavedMessageActor.account(_ACCOUNT_ID), id="app-id"),
        pytest.param(_APP_ID, SavedMessageActor.end_user(_ACCOUNT_ID), id="actor-role"),
        pytest.param(_APP_ID, SavedMessageActor.account(_OTHER_ACCOUNT_ID), id="actor-id"),
    ],
)
def test_list_excludes_saved_messages_outside_actor_scope(
    sqlite_session_factory: sessionmaker[Session],
    saved_app_id: str,
    saved_actor: SavedMessageActor,
) -> None:
    actor = SavedMessageActor.account(_ACCOUNT_ID)
    with sqlite_session_factory.begin() as session:
        _persist_app(session)
        if saved_app_id != _APP_ID:
            _persist_app(session, app_id=saved_app_id)
        owned = _persist_message(session, actor=actor, created_at=datetime(2026, 1, 1))
        out_of_scope = _persist_message(
            session,
            app_id=saved_app_id,
            actor=saved_actor,
            created_at=datetime(2026, 1, 2),
        )
        _save_message(session, app_id=_APP_ID, actor=actor, message_id=owned.id)
        _save_message(session, app_id=saved_app_id, actor=saved_actor, message_id=out_of_scope.id)

    result = _repository(sqlite_session_factory).pagination_by_last_id(
        app_id=_APP_ID,
        actor=actor,
        last_id=None,
        limit=20,
    )

    assert [record.id for record in result.data] == [owned.id]


def test_list_paginates_after_last_id(sqlite_session_factory: sessionmaker[Session]) -> None:
    actor = SavedMessageActor.account(_ACCOUNT_ID)
    with sqlite_session_factory.begin() as session:
        _persist_app(session)
        oldest = _persist_message(session, actor=actor, created_at=datetime(2026, 1, 1))
        middle = _persist_message(session, actor=actor, created_at=datetime(2026, 1, 2))
        newest = _persist_message(session, actor=actor, created_at=datetime(2026, 1, 3))
        for message in (oldest, middle, newest):
            _save_message(session, app_id=_APP_ID, actor=actor, message_id=message.id)

    result = _repository(sqlite_session_factory).pagination_by_last_id(
        app_id=_APP_ID,
        actor=actor,
        last_id=middle.id,
        limit=20,
    )

    assert result.has_more is False
    assert [record.id for record in result.data] == [oldest.id]


def test_list_rejects_last_id_outside_saved_set(sqlite_session_factory: sessionmaker[Session]) -> None:
    actor = SavedMessageActor.account(_ACCOUNT_ID)
    with sqlite_session_factory.begin() as session:
        _persist_app(session)
        saved = _persist_message(session, actor=actor, created_at=datetime(2026, 1, 1))
        not_saved = _persist_message(session, actor=actor, created_at=datetime(2026, 1, 2))
        _save_message(session, app_id=_APP_ID, actor=actor, message_id=saved.id)

    with pytest.raises(
        LastMessageNotExistsError,
        match=r"^The last_id cursor does not belong to the current saved messages\.$",
    ):
        _repository(sqlite_session_factory).pagination_by_last_id(
            app_id=_APP_ID,
            actor=actor,
            last_id=not_saved.id,
            limit=20,
        )


def test_list_with_no_saved_messages_ignores_last_id(sqlite_session_factory: sessionmaker[Session]) -> None:
    result = _repository(sqlite_session_factory).pagination_by_last_id(
        app_id=_APP_ID,
        actor=SavedMessageActor.account(_ACCOUNT_ID),
        last_id=str(uuid4()),
        limit=20,
    )

    assert result.data == ()
    assert result.has_more is False


@pytest.mark.parametrize(
    "actor",
    [
        pytest.param(SavedMessageActor.account(_ACCOUNT_ID), id="account"),
        pytest.param(SavedMessageActor.end_user(_END_USER_ID), id="end-user"),
    ],
)
def test_saved_message_lifecycle_is_actor_scoped_and_idempotent(
    sqlite_session_factory: sessionmaker[Session],
    actor: SavedMessageActor,
) -> None:
    with sqlite_session_factory.begin() as session:
        _persist_app(session)
        message = _persist_message(session, actor=actor, created_at=datetime(2026, 1, 1))

    repository = _repository(sqlite_session_factory)
    repository.save(app_id=_APP_ID, actor=actor, message_id=message.id)
    repository.save(app_id=_APP_ID, actor=actor, message_id=message.id)

    with sqlite_session_factory() as session:
        rows = session.scalars(select(SavedMessage)).all()
    assert [(row.created_by_role, row.created_by) for row in rows] == [(CreatorUserRole(actor.role), actor.id)]

    result = repository.pagination_by_last_id(app_id=_APP_ID, actor=actor, last_id=None, limit=20)
    assert [record.id for record in result.data] == [message.id]

    repository.delete(app_id=_APP_ID, actor=actor, message_id=message.id)
    repository.delete(app_id=_APP_ID, actor=actor, message_id=message.id)

    with sqlite_session_factory() as session:
        count = session.scalar(select(func.count()).select_from(SavedMessage))
    assert count == 0


def test_save_rejects_message_owned_by_another_actor(sqlite_session_factory: sessionmaker[Session]) -> None:
    owner = SavedMessageActor.account(_ACCOUNT_ID)
    other = SavedMessageActor.account(str(uuid4()))
    with sqlite_session_factory.begin() as session:
        _persist_app(session)
        message = _persist_message(session, actor=owner, created_at=datetime(2026, 1, 1))

    with pytest.raises(MessageNotExistsError):
        _repository(sqlite_session_factory).save(app_id=_APP_ID, actor=other, message_id=message.id)


@pytest.mark.parametrize(
    ("saved_app_id", "saved_actor"),
    [
        pytest.param(_OTHER_APP_ID, SavedMessageActor.account(_ACCOUNT_ID), id="app-id"),
        pytest.param(_APP_ID, SavedMessageActor.end_user(_ACCOUNT_ID), id="actor-role"),
        pytest.param(_APP_ID, SavedMessageActor.account(_OTHER_ACCOUNT_ID), id="actor-id"),
    ],
)
def test_delete_preserves_saved_messages_outside_actor_scope(
    sqlite_session_factory: sessionmaker[Session],
    saved_app_id: str,
    saved_actor: SavedMessageActor,
) -> None:
    actor = SavedMessageActor.account(_ACCOUNT_ID)
    with sqlite_session_factory.begin() as session:
        _persist_app(session)
        if saved_app_id != _APP_ID:
            _persist_app(session, app_id=saved_app_id)
        message = _persist_message(
            session,
            app_id=saved_app_id,
            actor=saved_actor,
            created_at=datetime(2026, 1, 1),
        )
        _save_message(session, app_id=saved_app_id, actor=saved_actor, message_id=message.id)

    repository = _repository(sqlite_session_factory)
    repository.delete(app_id=_APP_ID, actor=actor, message_id=message.id)

    with sqlite_session_factory() as session:
        rows = session.scalars(select(SavedMessage)).all()
    assert [(row.app_id, row.created_by_role, row.created_by) for row in rows] == [
        (saved_app_id, CreatorUserRole(saved_actor.role), saved_actor.id)
    ]
