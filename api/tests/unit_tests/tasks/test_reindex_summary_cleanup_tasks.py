"""Regression tests for summary cleanup in document reindex tasks."""

from contextlib import nullcontext
from unittest.mock import Mock, patch

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models import Account, Tenant
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from services.feature_service import FeatureModel
from tasks.retry_document_indexing_task import retry_document_indexing_task
from tasks.sync_website_document_indexing_task import sync_website_document_indexing_task


def _cleanup_rows() -> tuple[Dataset, Document, DocumentSegment]:
    dataset = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by="account-1",
    )
    document = Document(
        id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        indexing_status=IndexingStatus.ERROR,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="old content",
        word_count=2,
        tokens=2,
        created_by="account-1",
        index_node_id="node-1",
        status=SegmentStatus.COMPLETED,
    )
    segment.id = "segment-1"
    return dataset, document, segment


def _assert_scoped_summary_cleanup(
    *,
    processor: Mock,
    session: Mock,
    dataset: Dataset,
    segment: DocumentSegment,
) -> None:
    processor.clean.assert_called_once_with(
        dataset,
        [segment.index_node_id],
        with_keywords=True,
        delete_child_chunks=True,
        delete_summaries=True,
        segment_ids=[segment.id],
        session=session,
    )
    segment_queries = [str(call.args[0]) for call in session.scalars.call_args_list]
    delete_queries = [str(call.args[0]) for call in session.execute.call_args_list]
    assert "document_segments.dataset_id" in segment_queries[-1]
    assert "document_segments.dataset_id" in delete_queries[0]


def test_retry_document_cleanup_deletes_summary_vectors_with_dataset_scope() -> None:
    dataset, document, segment = _cleanup_rows()
    user = Account(name="User", email="user@example.com")
    user.id = "account-1"
    tenant = Tenant(name="Tenant")
    tenant.id = dataset.tenant_id

    session = Mock()
    session.scalar.side_effect = [dataset, user, tenant, document]
    segment_rows = Mock()
    segment_rows.all.return_value = [segment]
    session.scalars.return_value = segment_rows
    processor = Mock()

    with (
        patch(
            "tasks.retry_document_indexing_task.session_factory.create_session",
            return_value=nullcontext(session),
        ),
        patch(
            "tasks.retry_document_indexing_task.FeatureService.get_features",
            return_value=FeatureModel(),
        ),
        patch.object(Account, "set_current_tenant_with_session", autospec=True),
        patch("tasks.retry_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.retry_document_indexing_task.IndexingRunner"),
        patch("tasks.retry_document_indexing_task.redis_client"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

    _assert_scoped_summary_cleanup(
        processor=processor,
        session=session,
        dataset=dataset,
        segment=segment,
    )


def test_website_sync_cleanup_deletes_summary_vectors_with_dataset_scope() -> None:
    dataset, document, segment = _cleanup_rows()
    session = Mock()
    session.scalar.side_effect = [dataset, document]
    segment_rows = Mock()
    segment_rows.all.return_value = [segment]
    session.scalars.return_value = segment_rows
    processor = Mock()

    with (
        patch(
            "tasks.sync_website_document_indexing_task.session_factory.create_session",
            return_value=nullcontext(session),
        ),
        patch(
            "tasks.sync_website_document_indexing_task.FeatureService.get_features",
            return_value=FeatureModel(),
        ),
        patch("tasks.sync_website_document_indexing_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.sync_website_document_indexing_task.IndexingRunner"),
        patch("tasks.sync_website_document_indexing_task.redis_client"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        sync_website_document_indexing_task.run(dataset.id, document.id)

    _assert_scoped_summary_cleanup(
        processor=processor,
        session=session,
        dataset=dataset,
        segment=segment,
    )
