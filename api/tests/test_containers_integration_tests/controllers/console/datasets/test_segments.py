"""DB-backed integration tests for console dataset segment endpoints."""

from __future__ import annotations

from uuid import uuid4

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def test_list_segments_uses_real_db_query_and_console_response_shape(
    test_client_with_containers: FlaskClient,
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    dataset = Dataset(
        tenant_id=tenant.id,
        name=f"Console Segment Dataset {uuid4()}",
        description="Console segment integration dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=account.id,
        permission="only_me",
        provider="vendor",
    )
    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()

    document = Document(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch=f"batch-{uuid4()}",
        name="console-segment-doc.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=account.id,
        enabled=True,
        archived=False,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=3,
        tokens=4,
    )
    db_session_with_containers.add(document)
    db_session_with_containers.commit()

    segment = DocumentSegment(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="Console integration segment",
        word_count=3,
        tokens=4,
        keywords=["console", "integration"],
        status=SegmentStatus.COMPLETED,
        created_by=account.id,
    )
    db_session_with_containers.add(segment)
    db_session_with_containers.commit()
    segment_id = segment.id

    db_session_with_containers.add(
        DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content="Console DB summary",
            status=SummaryStatus.COMPLETED,
        )
    )
    db_session_with_containers.commit()

    response = test_client_with_containers.get(
        f"/console/api/datasets/{dataset.id}/documents/{document.id}/segments"
        "?page=1&limit=10&status=completed&keyword=integration&enabled=all",
        headers=authenticate_console_client(test_client_with_containers, account),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert set(body) == {"data", "limit", "total", "total_pages", "page"}
    assert body["limit"] == 10
    assert body["total"] == 1
    assert body["total_pages"] == 1
    assert "has_more" not in body
    assert body["data"][0]["id"] == segment_id
    assert body["data"][0]["summary"] == "Console DB summary"
