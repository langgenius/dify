"""DB-backed integration tests for service API dataset segment endpoints."""

from __future__ import annotations

from uuid import uuid4

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import (
    ApiTokenType,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SegmentType,
    SummaryStatus,
)
from models.model import ApiToken
from tests.test_containers_integration_tests.controllers.console.helpers import create_console_account_and_tenant


def _create_dataset_graph(db_session: Session) -> tuple[Dataset, Document, DocumentSegment]:
    account, tenant = create_console_account_and_tenant(db_session)
    dataset = Dataset(
        tenant_id=tenant.id,
        name=f"Segment Dataset {uuid4()}",
        description="Segment integration dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=account.id,
        permission="only_me",
        provider="vendor",
        enable_api=True,
    )
    db_session.add(dataset)
    db_session.commit()

    document = Document(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch=f"batch-{uuid4()}",
        name="segment-doc.txt",
        created_from=DocumentCreatedFrom.API,
        created_by=account.id,
        enabled=True,
        archived=False,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=4,
        tokens=5,
    )
    db_session.add(document)
    db_session.commit()

    segment = DocumentSegment(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="Segment content for integration",
        word_count=4,
        tokens=5,
        keywords=["segment", "integration"],
        status=SegmentStatus.COMPLETED,
        created_by=account.id,
    )
    db_session.add(segment)
    db_session.commit()

    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="DB summary",
        status=SummaryStatus.COMPLETED,
    )
    db_session.add(summary)

    api_token = ApiToken(
        tenant_id=tenant.id,
        type=ApiTokenType.DATASET,
        token=f"dataset-{uuid4().hex}",
    )
    db_session.add(api_token)
    db_session.commit()
    return dataset, document, segment


def _auth_headers(db_session: Session, dataset: Dataset) -> dict[str, str]:
    token = db_session.query(ApiToken).filter_by(tenant_id=dataset.tenant_id, type=ApiTokenType.DATASET).one()
    return {"Authorization": f"Bearer {token.token}"}


def test_list_segments_uses_real_services_and_service_api_shape(
    test_client_with_containers: FlaskClient,
    db_session_with_containers: Session,
) -> None:
    dataset, document, segment = _create_dataset_graph(db_session_with_containers)
    segment_id = segment.id

    response = test_client_with_containers.get(
        f"/v1/datasets/{dataset.id}/documents/{document.id}/segments"
        "?page=1&limit=20&status=completed&keyword=integration",
        headers=_auth_headers(db_session_with_containers, dataset),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert set(body) == {"data", "doc_form", "total", "has_more", "limit", "page"}
    assert body["doc_form"] == "text_model"
    assert body["total"] == 1
    assert "total_pages" not in body
    assert body["data"][0]["id"] == segment_id
    assert body["data"][0]["summary"] == "DB summary"
    assert body["data"][0]["attachments"] == []
    assert body["data"][0]["child_chunks"] == []


def test_list_child_chunks_uses_real_segment_service(
    test_client_with_containers: FlaskClient,
    db_session_with_containers: Session,
) -> None:
    dataset, document, segment = _create_dataset_graph(db_session_with_containers)
    child_chunk = ChildChunk(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        position=1,
        content="Child integration content",
        word_count=3,
        type=SegmentType.CUSTOMIZED,
        created_by=document.created_by,
    )
    db_session_with_containers.add(child_chunk)
    db_session_with_containers.commit()

    response = test_client_with_containers.get(
        f"/v1/datasets/{dataset.id}/documents/{document.id}/segments/{segment.id}/child_chunks"
        "?page=1&limit=20&keyword=integration",
        headers=_auth_headers(db_session_with_containers, dataset),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert set(body) == {"data", "total", "total_pages", "page", "limit"}
    assert body["total"] == 1
    assert body["data"][0]["content"] == "Child integration content"
