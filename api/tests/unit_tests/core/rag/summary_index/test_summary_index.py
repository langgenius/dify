from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.summary_index.summary_index import SummaryIndex
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.dataset import Document as DatasetDocument
from models.enums import (
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SummaryStatus,
)


def test_preview_skips_segments_with_concrete_completed_summaries() -> None:
    tenant_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="preview dataset",
        created_by=account_id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        summary_index_setting={"enable": True},
    )
    dataset.id = str(uuid.uuid4())
    document = DatasetDocument(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="preview-batch",
        name="preview.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=account_id,
        enabled=True,
        archived=False,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=2,
        tokens=2,
    )
    document.id = str(uuid.uuid4())
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="preview content",
        word_count=2,
        tokens=2,
        created_by=account_id,
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    segment.id = str(uuid.uuid4())
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="completed preview summary",
        status=SummaryStatus.COMPLETED,
        enabled=True,
    )

    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    session.scalars.return_value.all.return_value = [segment]
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    session_context.__exit__.return_value = None

    with (
        patch(
            "core.rag.summary_index.summary_index.session_factory.create_session",
            return_value=session_context,
        ),
        patch(
            "core.rag.summary_index.summary_index.SummaryIndexService.get_segments_summaries",
            return_value={segment.id: summary},
        ) as get_summaries,
        patch("core.rag.summary_index.summary_index.generate_summary_index_task.delay") as publish_task,
    ):
        SummaryIndex().generate_and_vectorize_summary(
            dataset.id,
            document.id,
            is_preview=True,
        )

    get_summaries.assert_called_once_with([segment.id], dataset.id, session=session)
    publish_task.assert_not_called()
