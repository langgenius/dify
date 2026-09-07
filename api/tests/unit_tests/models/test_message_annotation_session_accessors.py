"""Regression coverage for the ``@property``→session-parameter refactor on Message
feedback/annotation accessors.

Covers three of `api/models/model.py`'s legacy `@property` accessors that reached for the global
``db.session`` internally and have been removed in favour of their existing explicit-session
methods (per the pattern established in #40370/#40797/#41394/#41830, tracked in #40372):

- ``MessageFeedback.from_account_with_session``
- ``MessageAnnotation.account_with_session``
- ``MessageAnnotation.annotation_create_account_with_session``

Each accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual
query behaviour rather than a mock's recorded call.
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.account import Account
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import MessageAnnotation, MessageFeedback


def _persist_account(session: Session, *, email: str | None = None) -> Account:
    account = Account(name="Test Account", email=email or "test@example.com")
    session.add(account)
    session.flush()
    return account


def _persist_feedback(session: Session, *, app_id: str, from_account_id: str | None) -> MessageFeedback:
    feedback = MessageFeedback(
        app_id=app_id,
        conversation_id=str(uuid4()),
        message_id=str(uuid4()),
        rating=FeedbackRating.LIKE,
        from_source=FeedbackFromSource.USER,
        from_account_id=from_account_id,
    )
    session.add(feedback)
    session.flush()
    return feedback


def _persist_annotation(session: Session, *, app_id: str, account_id: str) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=app_id,
        conversation_id=None,
        message_id=None,
        question="What is AI?",
        content="AI stands for Artificial Intelligence.",
        account_id=account_id,
    )
    session.add(annotation)
    session.flush()
    return annotation


class TestMessageFeedbackFromAccount:
    def test_returns_the_feedback_author(self, sqlite_session: Session) -> None:
        account = _persist_account(sqlite_session)
        feedback = _persist_feedback(sqlite_session, app_id=str(uuid4()), from_account_id=account.id)

        result = feedback.from_account_with_session(session=sqlite_session)

        assert result is not None
        assert result.id == account.id

    def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
        feedback = _persist_feedback(sqlite_session, app_id=str(uuid4()), from_account_id=str(uuid4()))

        assert feedback.from_account_with_session(session=sqlite_session) is None


class TestMessageAnnotationAccount:
    def test_returns_the_annotation_creator(self, sqlite_session: Session) -> None:
        creator = _persist_account(sqlite_session, email="creator@example.com")
        annotation = _persist_annotation(sqlite_session, app_id=str(uuid4()), account_id=creator.id)

        result = annotation.account_with_session(session=sqlite_session)

        assert result is not None
        assert result.id == creator.id

    def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
        annotation = _persist_annotation(sqlite_session, app_id=str(uuid4()), account_id=str(uuid4()))

        assert annotation.account_with_session(session=sqlite_session) is None


class TestMessageAnnotationAnnotationCreateAccount:
    def test_returns_the_annotation_creator(self, sqlite_session: Session) -> None:
        creator = _persist_account(sqlite_session, email="creator2@example.com")
        annotation = _persist_annotation(sqlite_session, app_id=str(uuid4()), account_id=creator.id)

        result = annotation.annotation_create_account_with_session(session=sqlite_session)

        assert result is not None
        assert result.id == creator.id

    def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
        annotation = _persist_annotation(sqlite_session, app_id=str(uuid4()), account_id=str(uuid4()))

        assert annotation.annotation_create_account_with_session(session=sqlite_session) is None
