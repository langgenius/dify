"""Compose annotation search with the application's database owner."""

from sqlalchemy.orm import Session, sessionmaker

from models.annotation_reply import AnnotationReplies


def build_annotation_replies(sessions: sessionmaker[Session]) -> AnnotationReplies:
    from repositories.annotation.reply_repository import AnnotationReplyRepository
    from services.annotation.reply_service import AnnotationReplyService
    from services.annotation.retrieval_gateway import AnnotationVectorRetrieval

    return AnnotationReplyService(AnnotationReplyRepository(sessions), AnnotationVectorRetrieval())
