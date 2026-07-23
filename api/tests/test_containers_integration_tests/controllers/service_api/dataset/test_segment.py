"""DB-backed integration tests for service API dataset segment endpoints."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions import ext_redis
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
from tests.test_containers_integration_tests.helpers import DatabaseState

pytestmark = pytest.mark.requires_redis


def _timestamp(value: datetime | None) -> int | None:
    return int(value.timestamp()) if value is not None else None


def _child_chunk_contract(child_chunk: ChildChunk) -> dict[str, object]:
    return {
        "id": child_chunk.id,
        "segment_id": child_chunk.segment_id,
        "content": child_chunk.content,
        "position": child_chunk.position,
        "word_count": child_chunk.word_count,
        "type": child_chunk.type.value,
        "created_at": _timestamp(child_chunk.created_at),
        "updated_at": _timestamp(child_chunk.updated_at),
    }


def _segment_contract(
    segment: DocumentSegment,
    *,
    summary: str | None,
    child_chunks: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "id": segment.id,
        "position": segment.position,
        "document_id": segment.document_id,
        "content": segment.content,
        "sign_content": segment.sign_content,
        "answer": segment.answer,
        "word_count": segment.word_count,
        "tokens": segment.tokens,
        "keywords": segment.keywords,
        "index_node_id": segment.index_node_id,
        "index_node_hash": segment.index_node_hash,
        "hit_count": segment.hit_count,
        "enabled": segment.enabled,
        "disabled_at": _timestamp(segment.disabled_at),
        "disabled_by": segment.disabled_by,
        "status": segment.status.value,
        "created_by": segment.created_by,
        "created_at": _timestamp(segment.created_at),
        "updated_at": _timestamp(segment.updated_at),
        "updated_by": segment.updated_by,
        "indexing_at": _timestamp(segment.indexing_at),
        "completed_at": _timestamp(segment.completed_at),
        "error": segment.error,
        "stopped_at": _timestamp(segment.stopped_at),
        "child_chunks": child_chunks or [],
        "attachments": [],
        "summary": summary,
    }


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
    token = db_session.scalars(
        select(ApiToken).where(ApiToken.tenant_id == dataset.tenant_id, ApiToken.type == ApiTokenType.DATASET)
    ).one()
    return {"Authorization": f"Bearer {token.token}"}


def test_list_segments_uses_real_services_and_service_api_shape(
    container_client: FlaskClient,
    container_transaction: Session,
) -> None:
    dataset, document, segment = _create_dataset_graph(container_transaction)

    response = container_client.get(
        f"/v1/datasets/{dataset.id}/documents/{document.id}/segments"
        "?page=1&limit=20&status=completed&keyword=integration",
        headers=_auth_headers(container_transaction, dataset),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body == {
        "data": [_segment_contract(segment, summary="DB summary")],
        "doc_form": "text_model",
        "total": 1,
        "has_more": False,
        "limit": 20,
        "page": 1,
    }


def test_list_child_chunks_uses_real_segment_service(
    container_client: FlaskClient,
    container_transaction: Session,
) -> None:
    dataset, document, segment = _create_dataset_graph(container_transaction)
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
    container_transaction.add(child_chunk)
    container_transaction.commit()

    response = container_client.get(
        f"/v1/datasets/{dataset.id}/documents/{document.id}/segments/{segment.id}/child_chunks"
        "?page=1&limit=20&keyword=integration",
        headers=_auth_headers(container_transaction, dataset),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body == {
        "data": [_child_chunk_contract(child_chunk)],
        "total": 1,
        "total_pages": 1,
        "page": 1,
        "limit": 20,
    }


def test_create_get_update_and_delete_segment_persist(
    container_client: FlaskClient,
    container_transaction: Session,
    container_state: DatabaseState,
) -> None:
    dataset, document, _segment = _create_dataset_graph(container_transaction)
    dataset_id = dataset.id
    document_id = document.id
    headers = _auth_headers(container_transaction, dataset)
    segments_url = f"/v1/datasets/{dataset_id}/documents/{document_id}/segments"

    with patch("services.dataset_service.VectorService.create_segments_vector"):
        create_response = container_client.post(
            segments_url,
            headers=headers,
            json={
                "segments": [
                    {
                        "content": "Service API created segment",
                        "keywords": ["service-api"],
                        "attachment_ids": [],
                    }
                ]
            },
        )

    assert create_response.status_code == 200
    created_id = create_response.get_json()["data"][0]["id"]
    created_segment = container_state.one(DocumentSegment, DocumentSegment.id == created_id)
    assert created_segment.content == "Service API created segment"
    segment_url = f"{segments_url}/{created_id}"

    get_response = container_client.get(segment_url, headers=headers)
    assert get_response.status_code == 200
    assert get_response.get_json() == {
        "data": _segment_contract(created_segment, summary=None),
        "doc_form": "text_model",
    }

    with (
        patch("services.dataset_service.VectorService.update_segment_vector"),
        patch("services.dataset_service.VectorService.update_multimodel_vector"),
    ):
        update_response = container_client.post(
            segment_url,
            headers=headers,
            json={
                "segment": {
                    "content": "Service API updated segment",
                    "keywords": ["updated"],
                    "attachment_ids": [],
                }
            },
        )

    assert update_response.status_code == 200
    assert (
        container_state.one(DocumentSegment, DocumentSegment.id == created_id).content == "Service API updated segment"
    )

    with patch("services.dataset_service.delete_segment_from_index_task.delay") as delete_index:
        delete_response = container_client.delete(segment_url, headers=headers)

    assert delete_response.status_code == 204
    assert container_state.count(DocumentSegment, DocumentSegment.id == created_id) == 0
    delete_index.assert_called_once()


def test_create_update_and_delete_child_chunk_persist(
    container_client: FlaskClient,
    container_transaction: Session,
    container_state: DatabaseState,
) -> None:
    dataset, document, segment = _create_dataset_graph(container_transaction)
    dataset_id = dataset.id
    document_id = document.id
    segment_id = segment.id
    headers = _auth_headers(container_transaction, dataset)
    child_chunks_url = f"/v1/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks"

    with patch("services.dataset_service.VectorService.create_child_chunk_vector"):
        create_response = container_client.post(
            child_chunks_url,
            headers=headers,
            json={"content": "Service API child chunk"},
        )

    assert create_response.status_code == 200
    child_chunk_id = create_response.get_json()["data"]["id"]
    assert container_state.one(ChildChunk, ChildChunk.id == child_chunk_id).content == "Service API child chunk"
    child_chunk_url = f"{child_chunks_url}/{child_chunk_id}"

    with patch("services.dataset_service.VectorService.update_child_chunk_vector"):
        update_response = container_client.patch(
            child_chunk_url,
            headers=headers,
            json={"content": "Service API updated child"},
        )

    assert update_response.status_code == 200
    assert container_state.one(ChildChunk, ChildChunk.id == child_chunk_id).content == "Service API updated child"

    with patch("services.dataset_service.VectorService.delete_child_chunk_vector"):
        delete_response = container_client.delete(child_chunk_url, headers=headers)

    assert delete_response.status_code == 204
    assert container_state.count(ChildChunk, ChildChunk.id == child_chunk_id) == 0


def test_update_keyword_status_and_index_failure_contracts(
    container_client: FlaskClient,
    container_transaction: Session,
    container_state: DatabaseState,
) -> None:
    dataset, document, segment = _create_dataset_graph(container_transaction)
    dataset_id = dataset.id
    document_id = document.id
    segment_id = segment.id
    original_content = segment.content
    headers = _auth_headers(container_transaction, dataset)
    segment_url = f"/v1/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}"

    with (
        patch("services.dataset_service.VectorService.update_segment_vector") as update_vector,
        patch("services.dataset_service.VectorService.update_multimodel_vector"),
    ):
        keyword_response = container_client.post(
            segment_url,
            headers=headers,
            json={"segment": {"content": original_content, "keywords": ["replacement"]}},
        )
    assert keyword_response.status_code == 200
    assert container_state.one(DocumentSegment, DocumentSegment.id == segment_id).keywords == ["replacement"]
    update_vector.assert_called_once()

    with patch("services.dataset_service.disable_segment_from_index_task.delay") as disable_index:
        disable_response = container_client.post(
            segment_url,
            headers=headers,
            json={"segment": {"enabled": False}},
        )
    assert disable_response.status_code == 200
    assert container_state.one(DocumentSegment, DocumentSegment.id == segment_id).enabled is False
    disable_index.assert_called_once_with(segment_id)

    blocked_enable_response = container_client.post(
        segment_url,
        headers=headers,
        json={"segment": {"enabled": True, "content": "Blocked by indexing lock"}},
    )
    assert blocked_enable_response.status_code == 400
    assert container_state.one(DocumentSegment, DocumentSegment.id == segment_id).enabled is False

    ext_redis.redis_client.delete(f"segment_{segment_id}_indexing")

    with (
        patch("services.dataset_service.VectorService.update_segment_vector"),
        patch("services.dataset_service.VectorService.update_multimodel_vector"),
    ):
        enable_response = container_client.post(
            segment_url,
            headers=headers,
            json={"segment": {"enabled": True, "content": "Re-enabled content"}},
        )
    assert enable_response.status_code == 200
    reenabled_segment = container_state.one(DocumentSegment, DocumentSegment.id == segment_id)
    assert reenabled_segment.enabled is True
    assert reenabled_segment.content == "Re-enabled content"

    with patch(
        "services.dataset_service.VectorService.update_segment_vector",
        side_effect=RuntimeError("update index unavailable"),
    ):
        failed_update_response = container_client.post(
            segment_url,
            headers=headers,
            json={"segment": {"content": "Persisted before index failure"}},
        )
    assert failed_update_response.status_code == 200
    failed_segment = container_state.one(DocumentSegment, DocumentSegment.id == segment_id)
    assert failed_segment.content == "Persisted before index failure"
    assert failed_segment.status == SegmentStatus.ERROR
    assert failed_segment.enabled is False
    assert failed_segment.error == "update index unavailable"


def test_create_preconditions_qa_and_batch_index_failure_contracts(
    container_client: FlaskClient,
    container_transaction: Session,
    container_state: DatabaseState,
) -> None:
    dataset, document, _segment = _create_dataset_graph(container_transaction)
    dataset_id = dataset.id
    document_id = document.id
    headers = _auth_headers(container_transaction, dataset)
    segments_url = f"/v1/datasets/{dataset_id}/documents/{document_id}/segments"

    document.indexing_status = IndexingStatus.INDEXING
    container_transaction.commit()
    incomplete_response = container_client.post(
        segments_url,
        headers=headers,
        json={"segments": [{"content": "Rejected while indexing"}]},
    )
    assert incomplete_response.status_code == 404

    persisted_document = container_state.one(Document, Document.id == document_id)
    persisted_document.indexing_status = IndexingStatus.COMPLETED
    persisted_document.enabled = False
    container_transaction.commit()
    disabled_response = container_client.post(
        segments_url,
        headers=headers,
        json={"segments": [{"content": "Rejected while disabled"}]},
    )
    assert disabled_response.status_code == 404

    persisted_document = container_state.one(Document, Document.id == document_id)
    persisted_document.enabled = True
    persisted_document.doc_form = IndexStructureType.QA_INDEX
    container_transaction.commit()
    with patch("services.dataset_service.VectorService.create_segments_vector"):
        qa_response = container_client.post(
            segments_url,
            headers=headers,
            json={"segments": [{"content": "QA question", "answer": "QA answer"}]},
        )
    assert qa_response.status_code == 200
    qa_segment_id = qa_response.get_json()["data"][0]["id"]
    qa_segment = container_state.one(DocumentSegment, DocumentSegment.id == qa_segment_id)
    assert qa_segment.answer == "QA answer"
    assert qa_segment.word_count == len("QA question") + len("QA answer")

    with patch(
        "services.dataset_service.VectorService.create_segments_vector",
        side_effect=RuntimeError("batch index unavailable"),
    ):
        failed_batch_response = container_client.post(
            segments_url,
            headers=headers,
            json={
                "segments": [
                    {"content": "Failed question one", "answer": "Answer one"},
                    {"content": "Failed question two", "answer": "Answer two"},
                ]
            },
        )
    assert failed_batch_response.status_code == 200
    failed_ids = [item["id"] for item in failed_batch_response.get_json()["data"]]
    failed_segments = container_state.all(DocumentSegment, DocumentSegment.id.in_(failed_ids))
    assert len(failed_segments) == 2
    assert all(segment.status == SegmentStatus.ERROR for segment in failed_segments)
    assert all(segment.enabled is False for segment in failed_segments)
    assert {segment.error for segment in failed_segments} == {"batch index unavailable"}


def test_resource_hierarchy_mismatches_are_not_found(
    container_client: FlaskClient,
    container_transaction: Session,
) -> None:
    dataset, document, segment = _create_dataset_graph(container_transaction)
    dataset_id = dataset.id
    document_id = document.id
    segment_id = segment.id
    headers = _auth_headers(container_transaction, dataset)
    unknown_id = uuid4()

    responses = [
        container_client.get(
            f"/v1/datasets/{unknown_id}/documents/{document_id}/segments",
            headers=headers,
        ),
        container_client.get(
            f"/v1/datasets/{dataset_id}/documents/{unknown_id}/segments",
            headers=headers,
        ),
        container_client.get(
            f"/v1/datasets/{dataset_id}/documents/{document_id}/segments/{unknown_id}",
            headers=headers,
        ),
        container_client.patch(
            f"/v1/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{unknown_id}",
            headers=headers,
            json={"content": "Unknown child"},
        ),
    ]

    assert [response.status_code for response in responses] == [404, 404, 404, 404]
