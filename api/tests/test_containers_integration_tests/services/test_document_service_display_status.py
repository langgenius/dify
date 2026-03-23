import datetime
from uuid import uuid4

from sqlalchemy import select

from models.dataset import Dataset, Document
from services.dataset_service import DocumentService


def _create_dataset(db_session_with_containers) -> Dataset:
    dataset = Dataset(
        tenant_id=str(uuid4()),
        name=f"dataset-{uuid4()}",
        data_source_type="upload_file",
        created_by=str(uuid4()),
    )
    dataset.id = str(uuid4())
    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()
    return dataset


def _create_document(
    db_session_with_containers,
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
        data_source_type="upload_file",
        data_source_info="{}",
        batch=f"batch-{uuid4()}",
        name=f"doc-{uuid4()}",
        created_from="web",
        created_by=str(uuid4()),
        doc_form="text_model",
    )
    document.id = str(uuid4())
    document.indexing_status = indexing_status
    document.enabled = enabled
    document.archived = archived
    document.is_paused = is_paused
    if indexing_status == "completed":
        document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

    db_session_with_containers.add(document)
    db_session_with_containers.commit()
    return document


def test_build_display_status_filters_available(db_session_with_containers):
    dataset = _create_dataset(db_session_with_containers)
    available_doc = _create_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status="completed",
        enabled=True,
        archived=False,
        position=1,
    )
    _create_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status="completed",
        enabled=False,
        archived=False,
        position=2,
    )
    _create_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status="completed",
        enabled=True,
        archived=True,
        position=3,
    )

    filters = DocumentService.build_display_status_filters("available")
    assert len(filters) == 3
    for condition in filters:
        assert condition is not None

    rows = db_session_with_containers.scalars(select(Document).where(Document.dataset_id == dataset.id, *filters)).all()
    assert [row.id for row in rows] == [available_doc.id]


def test_apply_display_status_filter_applies_when_status_present(db_session_with_containers):
    dataset = _create_dataset(db_session_with_containers)
    waiting_doc = _create_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status="waiting",
        position=1,
    )
    _create_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status="completed",
        position=2,
    )

    query = select(Document).where(Document.dataset_id == dataset.id)
    filtered = DocumentService.apply_display_status_filter(query, "queuing")

    rows = db_session_with_containers.scalars(filtered).all()
    assert [row.id for row in rows] == [waiting_doc.id]


def test_apply_display_status_filter_returns_same_when_invalid(db_session_with_containers):
    dataset = _create_dataset(db_session_with_containers)
    doc1 = _create_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status="waiting",
        position=1,
    )
    doc2 = _create_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=dataset.tenant_id,
        indexing_status="completed",
        position=2,
    )

    query = select(Document).where(Document.dataset_id == dataset.id)
    filtered = DocumentService.apply_display_status_filter(query, "invalid")

    rows = db_session_with_containers.scalars(filtered).all()
    assert {row.id for row in rows} == {doc1.id, doc2.id}
