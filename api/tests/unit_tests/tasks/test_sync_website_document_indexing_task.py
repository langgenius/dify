import uuid
from unittest.mock import MagicMock, patch

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom
from tasks.sync_website_document_indexing_task import sync_website_document_indexing_task


def _dataset(tenant_id: str) -> Dataset:
    return Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Website dataset",
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        created_by=str(uuid.uuid4()),
    )


def _document(dataset: Dataset) -> Document:
    return Document(
        id=str(uuid.uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        batch="batch-1",
        name="Website document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=str(uuid.uuid4()),
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )


def _segment(*, tenant_id: str, dataset_id: str, document_id: str) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=str(uuid.uuid4()),
    )


def test_rejects_document_outside_dataset_before_side_effects(sqlite_session: Session) -> None:
    tenant_id = str(uuid.uuid4())
    requested_dataset = _dataset(tenant_id)
    foreign_dataset = _dataset(tenant_id)
    foreign_document = _document(foreign_dataset)
    sqlite_session.add_all([requested_dataset, foreign_dataset, foreign_document])
    sqlite_session.commit()

    with (
        patch("tasks.sync_website_document_indexing_task.FeatureService") as feature_service,
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
    ):
        sync_website_document_indexing_task(requested_dataset.id, foreign_document.id)

    feature_service.get_features.assert_not_called()
    processor_factory.assert_not_called()


def test_cleanup_is_owner_scoped_and_skips_empty_vector_ids(sqlite_session: Session) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = _dataset(tenant_id)
    document = _document(dataset)
    owned_segment = _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=document.id)
    other_dataset = _dataset(tenant_id)
    decoy_segments = [
        _segment(tenant_id=tenant_id, dataset_id=dataset.id, document_id=str(uuid.uuid4())),
        _segment(tenant_id=tenant_id, dataset_id=other_dataset.id, document_id=document.id),
        _segment(tenant_id=str(uuid.uuid4()), dataset_id=dataset.id, document_id=document.id),
    ]
    for index, segment in enumerate(decoy_segments):
        segment.index_node_id = f"decoy-node-{index}"
    sqlite_session.add_all([dataset, document, owned_segment, other_dataset, *decoy_segments])
    sqlite_session.commit()

    features = MagicMock()
    features.billing.enabled = False
    with (
        patch("tasks.sync_website_document_indexing_task.FeatureService.get_features", return_value=features),
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.sync_website_document_indexing_task.IndexingRunner") as indexing_runner,
        patch("tasks.sync_website_document_indexing_task.redis_client"),
    ):
        sync_website_document_indexing_task(dataset.id, document.id)

    processor_factory.return_value.init_index_processor.return_value.clean.assert_not_called()
    indexing_runner.return_value.run.assert_called_once()
    sqlite_session.expire_all()
    assert set(sqlite_session.scalars(select(DocumentSegment.id))) == {segment.id for segment in decoy_segments}
