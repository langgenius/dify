from __future__ import annotations

import uuid

import pytest
from sqlalchemy.orm import Session

import tasks.recover_document_indexing_task as task_module
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from tasks.recover_document_indexing_task import recover_document_indexing_task


@pytest.fixture
def task_harness(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> list[bool]:
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )
    service_builds: list[bool] = []

    def record_service_build(**_kwargs) -> None:
        service_builds.append(True)

    monkeypatch.setattr(task_module, "build_document_indexing_service", record_service_build)
    return service_builds


def _dataset_and_document(status: IndexingStatus = IndexingStatus.WAITING) -> tuple[Dataset, Document]:
    tenant_id = str(uuid.uuid4())
    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Recovery dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=str(uuid.uuid4()),
    )
    document = Document(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="recovery-batch",
        name="Recovery document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=dataset.created_by,
        indexing_status=status,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    return dataset, document


@pytest.mark.parametrize("dataset_exists", [False, True])
def test_recovery_skips_stale_queue_entries(
    sqlite_session: Session,
    task_harness: list[bool],
    dataset_exists: bool,
) -> None:
    dataset, document = _dataset_and_document()
    if dataset_exists:
        sqlite_session.add(dataset)
    sqlite_session.commit()

    recover_document_indexing_task(dataset.id, document.id)

    assert task_harness == []


def test_waiting_document_status_is_committed_before_recovery_runs(
    sqlite_session: Session,
    task_harness: list[bool],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document = _dataset_and_document()
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()

    def assert_parsing_status_is_persisted(**_kwargs) -> None:
        task_harness.append(True)
        with Session(sqlite_session.get_bind()) as observer:
            stored = observer.get(Document, document.id)
            assert stored is not None
            assert stored.indexing_status == IndexingStatus.PARSING
            assert stored.processing_started_at is not None
        raise RuntimeError("stop after verifying recovery admission")

    monkeypatch.setattr(task_module, "build_document_indexing_service", assert_parsing_status_is_persisted)
    recover_document_indexing_task(dataset.id, document.id)

    assert task_harness == [True]
