"""Compose knowledge retrieval with the invocation's database."""

from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.knowledge.retrieval.adapters.threads import retrieval_thread
from services.knowledge.retrieval.dataset_retrieval import DatasetRetrieval
from services.knowledge.retrieval.ports import DatasetRetrievalFactory
from services.knowledge.retrieval.reranking import KnowledgeReranker


def build_dataset_retrieval(database_client: sessionmaker[Session]) -> DatasetRetrievalFactory:
    return partial(
        DatasetRetrieval,
        thread=retrieval_thread,
        records=KnowledgeRetrievalRepository(database_client),
        rerank=KnowledgeReranker(SQLAlchemyKnowledgeUploadRepository(session_factory=database_client)),
    )
