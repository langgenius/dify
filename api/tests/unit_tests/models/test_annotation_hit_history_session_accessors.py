"""Regression coverage for the ``@property``→session-parameter refactor on
``AppAnnotationHitHistory`` accessors.

Covers two of `api/models/model.py`'s legacy `@property` accessors that reached for the global
``db.session`` internally and have been converted to plain methods taking an explicit
``session: Session`` (per the pattern established in #40370/#40797/#41394/#41830, tracked in
#40372):

- ``AppAnnotationHitHistory.account`` (joins through ``MessageAnnotation.account_id``)
- ``AppAnnotationHitHistory.annotation_create_account`` (looks up ``self.account_id`` directly)

Each accessor is exercised against the real ``sqlite_session`` fixture (a genuine SQLAlchemy
``Session`` bound to a pristine full-schema SQLite database) so the assertions cover actual
query behaviour rather than a mock's recorded call.
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.account import Account
from models.model import AppAnnotationHitHistory, MessageAnnotation


def _persist_account(session: Session) -> Account:
    account = Account(name="Test Account", email="test@example.com")
    session.add(account)
    session.flush()
    return account


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


def _hit_history(*, app_id: str, annotation_id: str, account_id: str) -> AppAnnotationHitHistory:
    return AppAnnotationHitHistory(
        app_id=app_id,
        annotation_id=annotation_id,
        source="api",
        question="What is AI?",
        account_id=account_id,
        score=0.95,
        message_id=str(uuid4()),
        annotation_question="What is AI?",
        annotation_content="AI stands for Artificial Intelligence.",
    )


class TestAppAnnotationHitHistoryAccount:
    def test_returns_the_annotation_creator(self, sqlite_session: Session) -> None:
        app_id = str(uuid4())
        creator = _persist_account(sqlite_session)
        annotation = _persist_annotation(sqlite_session, app_id=app_id, account_id=creator.id)
        history = _hit_history(app_id=app_id, annotation_id=annotation.id, account_id=str(uuid4()))

        result = history.account(session=sqlite_session)

        assert result is not None
        assert result.id == creator.id

    def test_returns_none_when_annotation_missing(self, sqlite_session: Session) -> None:
        history = _hit_history(app_id=str(uuid4()), annotation_id=str(uuid4()), account_id=str(uuid4()))

        assert history.account(session=sqlite_session) is None


class TestAppAnnotationHitHistoryAnnotationCreateAccount:
    def test_returns_the_hit_requester(self, sqlite_session: Session) -> None:
        app_id = str(uuid4())
        requester = _persist_account(sqlite_session)
        annotation = _persist_annotation(sqlite_session, app_id=app_id, account_id=str(uuid4()))
        history = _hit_history(app_id=app_id, annotation_id=annotation.id, account_id=requester.id)

        result = history.annotation_create_account(session=sqlite_session)

        assert result is not None
        assert result.id == requester.id

    def test_returns_none_when_account_missing(self, sqlite_session: Session) -> None:
        history = _hit_history(app_id=str(uuid4()), annotation_id=str(uuid4()), account_id=str(uuid4()))

        assert history.annotation_create_account(session=sqlite_session) is None
