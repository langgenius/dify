"""Portable transaction contract for upload-backed document creation.

MySQL snapshot behavior is exercised in CI integration tests. These unit tests
keep the repository-facing transaction and current-read contract collectible
without restoring the removed ``DatasetService``/``DocumentService`` facade.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from enums.account import TenantAccountRole
from enums.knowledge import ProcessRuleMode
from models import TenantAccountJoin
from models.dataset import Dataset, DatasetProcessRule, Document
from models.enums import DocumentCreatedFrom
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.documents.contracts import (
    DocumentSourceFileNotFoundError,
    DocumentWriteConfig,
    DocumentWriteProcessRule,
    DocumentWriteSource,
)
from services.knowledge.entities.resource_scope import DatasetRef
from tests.unit_tests.model_factories import make_account, make_tenant, make_upload_file

TENANT_ID = "tenant"
DATASET_ID = "dataset"
ACTOR_ID = "actor"
FILE_ID = "file"


def _config(*, file_ids: tuple[str, ...] = (FILE_ID,)) -> DocumentWriteConfig:
    return DocumentWriteConfig(
        original_document_id=None,
        duplicate=False,
        indexing_technique="economy",
        data_source=DocumentWriteSource("upload_file", file_ids=file_ids),
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


def _seed_actor_and_dataset(session: Session) -> None:
    tenant = make_tenant(tenant_id=TENANT_ID, name="Tenant")
    account = make_account(account_id=ACTOR_ID, name="Actor", email="actor@example.com")
    session.add_all(
        [
            tenant,
            account,
            TenantAccountJoin(
                tenant_id=TENANT_ID,
                account_id=ACTOR_ID,
                role=TenantAccountRole.OWNER,
                current=True,
            ),
            Dataset(id=DATASET_ID, tenant_id=TENANT_ID, name="Dataset", created_by=ACTOR_ID),
        ]
    )


@pytest.fixture
def seeded_factory(sqlite_session_factory: sessionmaker[Session]) -> sessionmaker[Session]:
    with sqlite_session_factory.begin() as session:
        _seed_actor_and_dataset(session)
    return sqlite_session_factory


def _assert_no_creation_writes(session: Session) -> None:
    dataset = session.get_one(Dataset, DATASET_ID)
    assert dataset.data_source_type is None
    assert dataset.indexing_technique is None
    assert session.scalar(select(func.count()).select_from(DatasetProcessRule)) == 0
    assert session.scalar(select(func.count()).select_from(Document)) == 0


def test_empty_upload_file_id_is_rejected_before_creation(
    seeded_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDocumentRepository(session_factory=seeded_factory)

    with pytest.raises(DocumentSourceFileNotFoundError):
        repository.persist_creation(
            DatasetRef(TENANT_ID, DATASET_ID),
            _config(file_ids=("",)),
            actor_id=ACTOR_ID,
            initialize=False,
            created_from=DocumentCreatedFrom.API,
            priority=False,
        )

    with seeded_factory() as observer:
        _assert_no_creation_writes(observer)


def test_committed_upload_from_another_session_joins_atomic_creation(
    seeded_factory: sessionmaker[Session],
) -> None:
    with seeded_factory.begin() as uploader:
        uploader.add(
            make_upload_file(
                file_id=FILE_ID,
                tenant_id=TENANT_ID,
                name="guide.txt",
                created_by=ACTOR_ID,
            )
        )

    result, jobs = SQLAlchemyDocumentRepository(session_factory=seeded_factory).persist_creation(
        DatasetRef(TENANT_ID, DATASET_ID),
        _config(),
        actor_id=ACTOR_ID,
        initialize=False,
        created_from=DocumentCreatedFrom.API,
        priority=False,
    )

    assert result.batch
    assert [document.name for document in result.documents] == ["guide.txt"]
    assert len(jobs.created) == 1
    with seeded_factory() as observer:
        dataset = observer.get_one(Dataset, DATASET_ID)
        assert dataset.data_source_type == "upload_file"
        assert dataset.indexing_technique == "economy"
        document = observer.scalar(select(Document).where(Document.dataset_id == DATASET_ID))
        assert document is not None
        assert document.id == jobs.created[0]
        assert document.data_source_info_dict == {"upload_file_id": FILE_ID}


@pytest.mark.parametrize("file_tenant", [None, "other-tenant"])
def test_missing_or_foreign_upload_rolls_back_all_creation_writes(
    seeded_factory: sessionmaker[Session],
    file_tenant: str | None,
) -> None:
    if file_tenant is not None:
        with seeded_factory.begin() as uploader:
            uploader.add(make_upload_file(file_id=FILE_ID, tenant_id=file_tenant, created_by=ACTOR_ID))

    repository = SQLAlchemyDocumentRepository(session_factory=seeded_factory)
    with pytest.raises(DocumentSourceFileNotFoundError, match="One or more files not found"):
        repository.persist_creation(
            DatasetRef(TENANT_ID, DATASET_ID),
            _config(),
            actor_id=ACTOR_ID,
            initialize=False,
            created_from=DocumentCreatedFrom.API,
            priority=False,
        )

    with seeded_factory() as observer:
        _assert_no_creation_writes(observer)


def test_response_materialization_failure_rolls_back_the_creation_transaction(
    seeded_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with seeded_factory.begin() as uploader:
        uploader.add(make_upload_file(file_id=FILE_ID, tenant_id=TENANT_ID, created_by=ACTOR_ID))

    def fail_response(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise RuntimeError("response construction failed")

    monkeypatch.setattr("repositories.knowledge.document_repository._created_response", fail_response)

    with pytest.raises(RuntimeError, match="response construction failed"):
        SQLAlchemyDocumentRepository(session_factory=seeded_factory).persist_creation(
            DatasetRef(TENANT_ID, DATASET_ID),
            _config(),
            actor_id=ACTOR_ID,
            initialize=False,
            created_from=DocumentCreatedFrom.API,
            priority=False,
        )

    with seeded_factory() as observer:
        _assert_no_creation_writes(observer)
