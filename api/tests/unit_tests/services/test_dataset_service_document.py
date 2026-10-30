import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from enums.knowledge import ProcessRuleMode
from models.account import Account
from models.dataset import Dataset, DatasetProcessRule, Document
from models.enums import DocumentCreatedFrom
from repositories.knowledge.document_repository import save_prepared_documents
from services.knowledge.documents.contracts import (
    DocumentPersistenceDatasetNotFoundError,
    DocumentSourceFileNotFoundError,
    DocumentWriteConfig,
    DocumentWriteProcessRule,
    DocumentWriteSource,
)
from services.knowledge.entities.resource_scope import DatasetRef
from tests.helpers.unit.model_factories import make_account, make_tenant, make_upload_file

TENANT_ID = "tenant-1"
DATASET_ID = "dataset-1"
ACTOR_ID = "actor-1"
FILE_ID = "file-1"


def _account() -> Account:
    return make_account(
        account_id=ACTOR_ID,
        name="Actor",
        email="actor@example.com",
        tenant=make_tenant(tenant_id=TENANT_ID, name="Tenant"),
    )


def _config(*, duplicate: bool = False) -> DocumentWriteConfig:
    return DocumentWriteConfig(
        original_document_id=None,
        duplicate=duplicate,
        indexing_technique="economy",
        data_source=DocumentWriteSource("upload_file", file_ids=(FILE_ID,)),
        process_rule=DocumentWriteProcessRule(ProcessRuleMode.AUTOMATIC, None),
        retrieval_model=None,
        summary_index_setting=None,
        doc_form="text_model",
        doc_language="English",
        embedding_model=None,
        embedding_model_provider=None,
        name=None,
        is_multimodal=False,
    )


def _dataset() -> Dataset:
    return Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="Dataset",
        description="",
        provider="vendor",
        created_by=ACTOR_ID,
        maintainer=ACTOR_ID,
    )


def _seed_dataset_and_upload(session: Session, *, upload_tenant_id: str = TENANT_ID) -> Dataset:
    dataset = _dataset()
    session.add_all(
        [
            dataset,
            make_upload_file(
                file_id=FILE_ID,
                tenant_id=upload_tenant_id,
                name="guide.txt",
                created_by=ACTOR_ID,
            ),
        ]
    )
    session.commit()
    return dataset


def test_save_prepared_documents_returns_the_current_indexing_jobs_contract(sqlite_session: Session) -> None:
    dataset = _seed_dataset_and_upload(sqlite_session)

    documents, batch, jobs = save_prepared_documents(
        dataset,
        _config(),
        _account(),
        created_from=DocumentCreatedFrom.API,
        session=sqlite_session,
    )

    assert len(documents) == 1
    assert documents[0].name == "guide.txt"
    assert documents[0].data_source_info_dict == {"upload_file_id": FILE_ID}
    assert documents[0].batch == batch
    assert jobs.dataset == DatasetRef(TENANT_ID, DATASET_ID)
    assert jobs.created == (documents[0].id,)
    assert jobs.duplicated == ()
    assert jobs.updated is None


def test_save_prepared_documents_rolls_back_with_the_callers_transaction(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        dataset = _seed_dataset_and_upload(session)
        save_prepared_documents(
            dataset,
            _config(),
            _account(),
            created_from=DocumentCreatedFrom.API,
            session=session,
        )
        assert session.scalar(select(func.count()).select_from(Document)) == 1
        assert session.scalar(select(func.count()).select_from(DatasetProcessRule)) == 1
        session.rollback()

    with sqlite_session_factory() as observer:
        dataset = observer.get_one(Dataset, DATASET_ID)
        assert dataset.data_source_type is None
        assert dataset.indexing_technique is None
        assert observer.scalar(select(func.count()).select_from(Document)) == 0
        assert observer.scalar(select(func.count()).select_from(DatasetProcessRule)) == 0


def test_foreign_upload_rejection_leaves_no_partial_creation_writes(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as session:
        dataset = _seed_dataset_and_upload(session, upload_tenant_id="tenant-2")
        with pytest.raises(DocumentSourceFileNotFoundError, match="One or more files not found"):
            save_prepared_documents(
                dataset,
                _config(),
                _account(),
                created_from=DocumentCreatedFrom.API,
                session=session,
            )
        session.rollback()

    with sqlite_session_factory() as observer:
        dataset = observer.get_one(Dataset, DATASET_ID)
        assert dataset.data_source_type is None
        assert dataset.indexing_technique is None
        assert observer.scalar(select(func.count()).select_from(Document)) == 0
        assert observer.scalar(select(func.count()).select_from(DatasetProcessRule)) == 0


def test_duplicate_upload_reports_reindex_work_without_creating_another_document(sqlite_session: Session) -> None:
    dataset = _seed_dataset_and_upload(sqlite_session)
    created, _batch, _jobs = save_prepared_documents(
        dataset,
        _config(),
        _account(),
        created_from=DocumentCreatedFrom.API,
        session=sqlite_session,
    )
    sqlite_session.commit()

    duplicated, batch, jobs = save_prepared_documents(
        dataset,
        _config(duplicate=True),
        _account(),
        created_from=DocumentCreatedFrom.API,
        session=sqlite_session,
    )

    assert [document.id for document in duplicated] == [created[0].id]
    assert duplicated[0].batch == batch
    assert jobs.created == ()
    assert jobs.duplicated == (created[0].id,)
    assert sqlite_session.scalar(select(func.count()).select_from(Document)) == 1


def test_save_prepared_documents_rechecks_the_dataset_owner_chain(sqlite_session: Session) -> None:
    _seed_dataset_and_upload(sqlite_session)
    dataset = _dataset()
    dataset.tenant_id = "tenant-2"

    with pytest.raises(DocumentPersistenceDatasetNotFoundError):
        save_prepared_documents(
            dataset,
            _config(),
            _account(),
            created_from=DocumentCreatedFrom.API,
            session=sqlite_session,
        )
