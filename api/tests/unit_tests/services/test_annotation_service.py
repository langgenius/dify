"""SQLite-backed tests for annotation reply reads and runtime hit history."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Account
from models.model import AppAnnotationHitHistory, MessageAnnotation
from services.annotation_service import AppAnnotationService


def _persist_annotation(session: Session) -> MessageAnnotation:
    annotation = MessageAnnotation(app_id="app-1", question="question", content="answer", account_id="account-1")
    session.add(annotation)
    session.commit()
    return annotation


def test_get_annotation_by_id_uses_real_identity_lookup(sqlite_session: Session) -> None:
    annotation = _persist_annotation(sqlite_session)

    assert AppAnnotationService.get_annotation_by_id("missing", sqlite_session) is None
    assert AppAnnotationService.get_annotation_by_id(annotation.id, sqlite_session) is annotation


@pytest.mark.parametrize("author_exists", [True, False])
def test_get_annotation_reply_preserves_missing_author(sqlite_session: Session, author_exists: bool) -> None:
    if author_exists:
        author = Account(name="Annotation author", email="annotation@example.com")
        author.id = "account-1"
        sqlite_session.add(author)
    annotation = _persist_annotation(sqlite_session)

    assert AppAnnotationService.get_annotation_reply_by_id("missing", sqlite_session) is None
    reply = AppAnnotationService.get_annotation_reply_by_id(annotation.id, sqlite_session)
    assert reply is not None
    assert reply[0] is annotation
    assert reply[1] == ("Annotation author" if author_exists else None)


def test_add_history_increments_count_and_flushes_row(sqlite_session: Session) -> None:
    annotation = _persist_annotation(sqlite_session)

    AppAnnotationService.add_annotation_history(
        annotation_id=annotation.id,
        app_id=annotation.app_id,
        annotation_question="q",
        annotation_content="a",
        query="user q",
        user_id=annotation.account_id,
        message_id="msg-1",
        from_source="chat",
        score=0.8,
        session=sqlite_session,
    )

    sqlite_session.refresh(annotation)
    assert annotation.hit_count == 1
    history = sqlite_session.scalar(
        select(AppAnnotationHitHistory).where(AppAnnotationHitHistory.annotation_id == annotation.id)
    )
    assert history is not None
    assert (history.question, history.annotation_question, history.annotation_content, history.score) == (
        "user q",
        "q",
        "a",
        0.8,
    )
