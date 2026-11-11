"""MySQL regression tests for post-commit document status compensation."""

from datetime import datetime
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.entities.resource_scope import DatasetRef


def test_failed_status_dispatch_uses_database_normalized_timestamp(mysql_session: Session) -> None:
    sessions = sessionmaker(bind=mysql_session.get_bind(), expire_on_commit=False)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    actor_id = str(uuid4())
    with sessions.begin() as session:
        session.add(
            Dataset(
                id=dataset_id,
                tenant_id=tenant_id,
                name=f"status-compensation-{uuid4()}",
                data_source_type=DataSourceType.UPLOAD_FILE,
                indexing_technique="economy",
                created_by=actor_id,
            )
        )
        session.add(
            Document(
                id=document_id,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                position=1,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid4()),
                name="Document",
                created_from=DocumentCreatedFrom.WEB,
                created_by=actor_id,
                indexing_status=IndexingStatus.COMPLETED,
                doc_form="text_model",
                enabled=False,
                disabled_at=datetime(2026, 1, 1),
                disabled_by=actor_id,
            )
        )

    repository = SQLAlchemyDocumentRepository(session_factory=sessions)
    ref = DatasetRef(tenant_id, dataset_id)
    try:
        with patch(
            "repositories.knowledge.document_repository.naive_utc_now",
            return_value=datetime(2026, 10, 29, 12, 30, 45, 987654),
        ):
            mutation = repository.change_status(ref, (document_id,), action="enable", actor_id=actor_id)

        assert repository.rollback_status_change(ref, mutation.rollbacks) == (document_id,)
        with sessions() as session:
            document = session.get_one(Document, document_id)
            assert document.enabled is False
            assert document.disabled_at == datetime(2026, 1, 1)
            assert document.disabled_by == actor_id

        newer_mutation = repository.change_status(ref, (document_id,), action="enable", actor_id=actor_id)
        with sessions.begin() as session:
            document = session.get_one(Document, document_id)
            document.archived = True
            document.archived_at = datetime(2026, 10, 29, 12, 31)
            document.archived_by = actor_id
            document.updated_at = datetime(2026, 10, 29, 12, 31)

        assert repository.rollback_status_change(ref, newer_mutation.rollbacks) == ()
        with sessions() as session:
            document = session.get_one(Document, document_id)
            assert document.enabled is True
            assert document.archived is True
    finally:
        with sessions.begin() as session:
            session.execute(delete(Document).where(Document.id == document_id))
            session.execute(delete(Dataset).where(Dataset.id == dataset_id))
