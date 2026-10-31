"""Legacy annotation matching and hit history used by the generation runtime.

Management endpoints use the injected annotation query, command and job services.
"""

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from models.account import Account
from models.model import AppAnnotationHitHistory, MessageAnnotation


class AppAnnotationService:
    @classmethod
    def get_annotation_by_id(cls, annotation_id: str, session: Session) -> MessageAnnotation | None:
        annotation = session.get(MessageAnnotation, annotation_id)

        if not annotation:
            return None
        return annotation

    @classmethod
    def get_annotation_reply_by_id(
        cls, annotation_id: str, session: Session
    ) -> tuple[MessageAnnotation, str | None] | None:
        """Read a reply and its author together, retaining annotations whose account was deleted."""
        row = session.execute(
            select(MessageAnnotation, Account.name)
            .outerjoin(Account, Account.id == MessageAnnotation.account_id)
            .where(MessageAnnotation.id == annotation_id)
        ).one_or_none()
        return (row[0], row[1]) if row is not None else None

    @classmethod
    def add_annotation_history(
        cls,
        annotation_id: str,
        app_id: str,
        annotation_question: str,
        annotation_content: str,
        query: str,
        user_id: str,
        message_id: str,
        from_source: str,
        score: float,
        session: Session,
    ) -> None:
        # add hit count to annotation
        session.execute(
            update(MessageAnnotation)
            .where(MessageAnnotation.id == annotation_id)
            .values(hit_count=MessageAnnotation.hit_count + 1)
        )

        annotation_hit_history = AppAnnotationHitHistory(
            annotation_id=annotation_id,
            app_id=app_id,
            account_id=user_id,
            question=query,
            source=from_source,
            score=score,
            message_id=message_id,
            annotation_question=annotation_question,
            annotation_content=annotation_content,
        )
        session.add(annotation_hit_history)
        session.flush()
