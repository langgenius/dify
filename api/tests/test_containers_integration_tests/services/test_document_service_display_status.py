import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.dataset_service import DocumentService


def _create_dataset(container_session) -> Dataset:
    dataset = Dataset(
        tenant_id=str(uuid4()),
        name=f"dataset-{uuid4()}",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=str(uuid4()),
    )
    dataset.id = str(uuid4())
    container_session.add(dataset)
    container_session.commit()
    return dataset


def _create_document(
    container_session,
    *,
    dataset_id: str,
    tenant_id: str,
    indexing_status: str,
    enabled: bool = True,
    archived: bool = False,
    is_paused: bool = False,
    position: int = 1,
) -> Document:
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=position,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch=f"batch-{uuid4()}",
        name=f"doc-{uuid4()}",
        created_from=DocumentCreatedFrom.WEB,
        created_by=str(uuid4()),
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    document.id = str(uuid4())
    document.indexing_status = indexing_status
    document.enabled = enabled
    document.archived = archived
    document.is_paused = is_paused
    if indexing_status == IndexingStatus.COMPLETED:
        document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

    container_session.add(document)
    container_session.commit()
    return document


def test_build_display_status_filters_available(container_session: Session):
    dataset = _create_dataset(container_session)
    available_doc = _create_document(
        container_session,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        position=1,
    )
    _create_document(
        container_session,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=False,
        archived=False,
        position=2,
    )
    _create_document(
        container_session,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=True,
        position=3,
    )

    filters = DocumentService.build_display_status_filters("available")
    assert len(filters) == 3
    for condition in filters:
        assert condition is not None

    rows = container_session.scalars(select(Document).where(Document.dataset_id == dataset.id, *filters)).all()
    assert [row.id for row in rows] == [available_doc.id]


def test_apply_display_status_filter_applies_when_status_present(container_session: Session):
    dataset = _create_dataset(container_session)
    waiting_doc = _create_document(
        container_session,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status=IndexingStatus.WAITING,
        position=1,
    )
    _create_document(
        container_session,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status=IndexingStatus.COMPLETED,
        position=2,
    )

    query = select(Document).where(Document.dataset_id == dataset.id)
    filtered = DocumentService.apply_display_status_filter(query, "queuing")

    rows = container_session.scalars(filtered).all()
    assert [row.id for row in rows] == [waiting_doc.id]


def test_apply_display_status_filter_returns_same_when_invalid(container_session: Session):
    dataset = _create_dataset(container_session)
    doc1 = _create_document(
        container_session,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status=IndexingStatus.WAITING,
        position=1,
    )
    doc2 = _create_document(
        container_session,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status=IndexingStatus.COMPLETED,
        position=2,
    )

    query = select(Document).where(Document.dataset_id == dataset.id)
    filtered = DocumentService.apply_display_status_filter(query, "invalid")

    rows = container_session.scalars(filtered).all()
    assert {row.id for row in rows} == {doc1.id, doc2.id}


def test_normalize_display_status_alias_mapping():
    """Test that normalize_display_status maps aliases correctly."""
    assert DocumentService.normalize_display_status("ACTIVE") == "available"
    assert DocumentService.normalize_display_status("enabled") == "available"
    assert DocumentService.normalize_display_status("archived") == "archived"
    assert DocumentService.normalize_display_status("unknown") is None
