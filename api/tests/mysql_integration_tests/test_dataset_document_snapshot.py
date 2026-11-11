import datetime
import json
from dataclasses import dataclass
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from enums.account import TenantAccountRole
from enums.creator import CreatorUserRole
from enums.knowledge import DocumentCreatedFrom, ProcessRuleMode
from extensions.storage.storage_type import StorageType
from models import Account
from models.account import AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.dataset import Dataset, DatasetProcessRule, Document
from models.enums import DataSourceType, IndexingStatus
from models.model import UploadFile
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.documents.contracts import (
    DocumentPersistenceDatasetNotFoundError,
    DocumentWriteConfig,
    DocumentWriteProcessRule,
    DocumentWriteSource,
)
from services.knowledge.entities.resource_scope import DatasetRef

FIXED_CREATED_AT = datetime.datetime(2024, 1, 1, 0, 0, 0)


@dataclass(frozen=True)
class DocumentCreationContext:
    account_id: str
    tenant_id: str
    dataset_id: str
    upload_file_id: str
    upload_file_name: str


def _create_document_context(session: Session) -> DocumentCreationContext:
    account = Account(
        email=f"owner-{uuid4()}@example.com",
        name="Owner",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    session.add_all([account, tenant])
    session.flush()
    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
    )
    dataset = Dataset(
        tenant_id=tenant.id,
        name=f"dataset-{uuid4()}",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="economy",
        created_by=account.id,
        maintainer=account.id,
    )
    upload_file = UploadFile(
        tenant_id=tenant.id,
        storage_type=StorageType.LOCAL,
        key=f"uploads/{uuid4()}",
        name="snapshot-race.txt",
        size=128,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account.id,
        created_at=FIXED_CREATED_AT,
        used=False,
    )
    session.add_all([dataset, upload_file])
    session.commit()
    return DocumentCreationContext(
        account_id=account.id,
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        upload_file_id=upload_file.id,
        upload_file_name=upload_file.name,
    )


def _create_document(session: Session, context: DocumentCreationContext) -> Document:
    document = Document(
        tenant_id=context.tenant_id,
        dataset_id=context.dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps({"upload_file_id": context.upload_file_id}),
        batch=f"batch-{uuid4()}",
        name=context.upload_file_name,
        created_from=DocumentCreatedFrom.WEB,
        created_by=context.account_id,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    document.indexing_status = IndexingStatus.COMPLETED
    document.enabled = True
    document.completed_at = FIXED_CREATED_AT
    session.add(document)
    session.commit()
    return document


def _creation_config(context: DocumentCreationContext) -> DocumentWriteConfig:
    return DocumentWriteConfig(
        original_document_id=None,
        duplicate=True,
        indexing_technique="economy",
        data_source=DocumentWriteSource("upload_file", file_ids=(context.upload_file_id,)),
        process_rule=DocumentWriteProcessRule(ProcessRuleMode.AUTOMATIC, None),
        retrieval_model=None,
        summary_index_setting=None,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        doc_language="English",
        embedding_model=None,
        embedding_model_provider=None,
        name=None,
        is_multimodal=False,
    )


def _repeatable_read_sessions(mysql_session: Session) -> sessionmaker[Session]:
    engine = mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ")
    return sessionmaker(bind=engine, expire_on_commit=False)


def test_document_repository_uses_a_current_session_after_the_creation_wait(mysql_session: Session) -> None:
    context = _create_document_context(mysql_session)
    sessions = _repeatable_read_sessions(mysql_session)
    repository = SQLAlchemyDocumentRepository(session_factory=sessions)

    with sessions() as stale_reader:
        document_count = select(func.count(Document.id)).where(Document.dataset_id == context.dataset_id)
        assert stale_reader.scalar(document_count) == 0

        with sessions() as writer:
            concurrent_document = _create_document(writer, context)

        result, jobs = repository.persist_creation(
            DatasetRef(context.tenant_id, context.dataset_id),
            _creation_config(context),
            actor_id=context.account_id,
            initialize=False,
            created_from=DocumentCreatedFrom.WEB,
            priority=False,
        )

        # The deliberately retained observer snapshot stays stale. Persistence
        # owns a fresh Session opened after the external creation-lock wait.
        assert stale_reader.scalar(document_count) == 0

    assert tuple(document.id for document in result.documents) == (concurrent_document.id,)
    assert jobs.created == ()
    assert jobs.duplicated == (concurrent_document.id,)
    with sessions() as verifier:
        assert verifier.scalar(select(func.count(Document.id)).where(Document.dataset_id == context.dataset_id)) == 1


def test_document_repository_revalidates_dataset_outside_a_stale_snapshot(mysql_session: Session) -> None:
    context = _create_document_context(mysql_session)
    sessions = _repeatable_read_sessions(mysql_session)
    repository = SQLAlchemyDocumentRepository(session_factory=sessions)

    with sessions() as stale_reader:
        dataset_query = select(Dataset.id).where(Dataset.id == context.dataset_id)
        assert stale_reader.scalar(dataset_query) == context.dataset_id

        with sessions.begin() as writer:
            writer.execute(
                delete(Dataset).where(
                    Dataset.id == context.dataset_id,
                    Dataset.tenant_id == context.tenant_id,
                )
            )

        assert stale_reader.scalar(dataset_query) == context.dataset_id
        with pytest.raises(DocumentPersistenceDatasetNotFoundError):
            repository.persist_creation(
                DatasetRef(context.tenant_id, context.dataset_id),
                _creation_config(context),
                actor_id=context.account_id,
                initialize=False,
                created_from=DocumentCreatedFrom.WEB,
                priority=False,
            )

    with sessions() as verifier:
        assert verifier.get(Dataset, context.dataset_id) is None
        assert verifier.scalar(select(func.count(Document.id)).where(Document.dataset_id == context.dataset_id)) == 0
        assert (
            verifier.scalar(
                select(func.count(DatasetProcessRule.id)).where(DatasetProcessRule.dataset_id == context.dataset_id)
            )
            == 0
        )
