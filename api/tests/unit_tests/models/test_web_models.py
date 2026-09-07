"""Regression coverage for ``models.web.SavedMessage.message`` accessor.

Ensures the property→method refactor (drop of ``db.session`` in favor of a caller-provided
``Session``) preserves query intent: the accessor forwards ``self.message_id`` to the
supplied session and returns the matching :class:`Message` (or ``None`` when absent).

The accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual
query behaviour rather than a mock's recorded call.
"""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy.orm import Session

from models.enums import CreatorUserRole
from models.model import ConversationFromSource, Message
from models.web import SavedMessage


def _persist_message(session: Session, *, app_id: str) -> Message:
    """Persist a minimal valid Message row and return it."""
    message = Message(
        app_id=app_id,
        conversation_id=str(uuid4()),
        inputs={},
        query="hello",
        message=[{"role": "user", "text": "hello"}],
        message_unit_price=Decimal(0),
        message_price_unit=Decimal(0),
        answer="hi",
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    session.add(message)
    session.flush()
    return message


def _saved_message(*, app_id: str, message_id: str) -> SavedMessage:
    """Construct a SavedMessage without touching the database."""
    return SavedMessage(
        app_id=app_id,
        message_id=message_id,
        created_by_role=CreatorUserRole.END_USER,
        created_by=str(uuid4()),
    )


def test_message_returns_persisted_message(sqlite_session: Session) -> None:
    app_id = str(uuid4())
    message = _persist_message(sqlite_session, app_id=app_id)
    saved = _saved_message(app_id=app_id, message_id=message.id)

    result = saved.message(session=sqlite_session)

    assert result is not None
    assert result.id == message.id


def test_message_returns_none_when_message_missing(sqlite_session: Session) -> None:
    saved = _saved_message(app_id=str(uuid4()), message_id=str(uuid4()))

    assert saved.message(session=sqlite_session) is None
