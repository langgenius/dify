"""Composition root for the RAG pipeline application service."""

from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import get_session_maker
from repositories.knowledge.dataset_repository import SQLAlchemyRagPipelineDatasetUpdates
from services.knowledge.datasets.task_gateway import dispatch_dataset_index_update_after_commit
from services.rag_pipeline.rag_pipeline import RagPipelineService


def build_rag_pipeline_service(
    *,
    session: Session,
    database_client: sessionmaker[Session] | None = None,
) -> RagPipelineService:
    session_factory = database_client or get_session_maker()
    return RagPipelineService(
        session,
        session_maker=session_factory,
        datasets=SQLAlchemyRagPipelineDatasetUpdates(
            session_factory=session_factory,
            index_update_after_commit=dispatch_dataset_index_update_after_commit,
        ),
    )
