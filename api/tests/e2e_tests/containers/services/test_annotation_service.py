"""Real database coverage for annotation runtime reads and hit recording."""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.enums import ConversationFromSource
from models.model import AppAnnotationHitHistory, MessageAnnotation
from services.annotation_service import AppAnnotationService


def _persist_annotation(session: Session) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=str(uuid4()), question="Runtime question", content="Runtime answer", account_id=str(uuid4())
    )
    session.add(annotation)
    session.flush()
    return annotation


def test_add_annotation_history_success(db_session_with_containers: Session) -> None:
    annotation = _persist_annotation(db_session_with_containers)
    initial_hit_count = annotation.hit_count
    message_id = str(uuid4())

    AppAnnotationService.add_annotation_history(
        annotation_id=annotation.id,
        app_id=annotation.app_id,
        annotation_question=annotation.question,
        annotation_content=annotation.content,
        query="User question",
        user_id=annotation.account_id,
        message_id=message_id,
        from_source=ConversationFromSource.CONSOLE,
        score=0.85,
        session=db_session_with_containers,
    )

    db_session_with_containers.refresh(annotation)
    assert annotation.hit_count == initial_hit_count + 1
    history = db_session_with_containers.scalar(
        select(AppAnnotationHitHistory).where(
            AppAnnotationHitHistory.annotation_id == annotation.id,
            AppAnnotationHitHistory.message_id == message_id,
        )
    )
    assert history is not None
    assert history.app_id == annotation.app_id
    assert history.account_id == annotation.account_id
    assert history.question == "User question"
    assert history.annotation_question == annotation.question
    assert history.annotation_content == annotation.content
    assert history.score == 0.85
    assert history.source == "console"


def test_get_annotation_by_id_success(db_session_with_containers: Session) -> None:
    annotation = _persist_annotation(db_session_with_containers)

    retrieved = AppAnnotationService.get_annotation_by_id(annotation.id, session=db_session_with_containers)

    assert retrieved is annotation
    assert retrieved.question == "Runtime question"
    assert retrieved.content == "Runtime answer"
    assert AppAnnotationService.get_annotation_by_id(str(uuid4()), session=db_session_with_containers) is None
