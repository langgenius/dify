"""DB-backed integration tests for console dataset segment endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import (
    CreatorUserRole,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SegmentType,
    SummaryStatus,
)
from models.model import UploadFile
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


@dataclass(frozen=True)
class ConsoleSegmentGraph:
    tenant_id: str
    account_id: str
    dataset_id: str
    document_id: str
    segment_id: str
    child_chunk_id: str
    headers: dict[str, str]


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


def _segment_contract(segment: DocumentSegment, *, summary: str | None) -> dict[str, object]:
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
        "child_chunks": [],
        "attachments": [],
        "summary": summary,
    }


@pytest.fixture
def console_segment_graph(
    container_client: FlaskClient,
    container_transaction: Session,
) -> ConsoleSegmentGraph:
    account, tenant = create_console_account_and_tenant(container_transaction)
    dataset = Dataset(
        tenant_id=tenant.id,
        name=f"Mutable Console Segment Dataset {uuid4()}",
        description="Console segment mutation dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=account.id,
        permission="only_me",
        provider="vendor",
    )
    container_transaction.add(dataset)
    container_transaction.commit()
    document = Document(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch=f"batch-{uuid4()}",
        name="mutable-segments.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=account.id,
        enabled=True,
        archived=False,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARENT_CHILD_INDEX,
        word_count=24,
        tokens=5,
    )
    container_transaction.add(document)
    container_transaction.commit()
    segment = DocumentSegment(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        document_id=document.id,
        index_node_id=str(uuid4()),
        position=1,
        content="Mutable parent segment",
        word_count=24,
        tokens=5,
        keywords=["mutable"],
        status=SegmentStatus.COMPLETED,
        created_by=account.id,
    )
    container_transaction.add(segment)
    container_transaction.commit()
    child_chunk = ChildChunk(
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        index_node_id=str(uuid4()),
        position=1,
        content="Initial child chunk",
        word_count=3,
        type=SegmentType.CUSTOMIZED,
        created_by=account.id,
    )
    container_transaction.add(child_chunk)
    container_transaction.commit()
    return ConsoleSegmentGraph(
        tenant_id=tenant.id,
        account_id=account.id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        child_chunk_id=child_chunk.id,
        headers=authenticate_console_client(container_client, account),
    )


def _segments_url(graph: ConsoleSegmentGraph) -> str:
    return f"/console/api/datasets/{graph.dataset_id}/documents/{graph.document_id}/segments"


def test_list_segments_uses_real_db_query_and_console_response_shape(
    container_client: FlaskClient,
    container_transaction: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(container_transaction)
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
    container_transaction.add(dataset)
    container_transaction.commit()

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
    container_transaction.add(document)
    container_transaction.commit()

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
        enabled=True,
        hit_count=3,
        created_by=account.id,
    )
    container_transaction.add(segment)
    container_transaction.commit()
    container_transaction.add(
        DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content="Console DB summary",
            status=SummaryStatus.COMPLETED,
        )
    )
    container_transaction.commit()

    segments_url = f"/console/api/datasets/{dataset.id}/documents/{document.id}/segments"
    response = container_client.get(
        segments_url,
        query_string={
            "page": 1,
            "limit": 10,
            "status": "completed",
            "keyword": "integration",
            "enabled": "all",
        },
        headers=authenticate_console_client(container_client, account),
    )
    hit_count_response = container_client.get(
        segments_url,
        query_string={"hit_count_gte": 3, "enabled": "true"},
        headers=authenticate_console_client(container_client, account),
    )
    disabled_response = container_client.get(
        segments_url,
        query_string={"enabled": "false"},
        headers=authenticate_console_client(container_client, account),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body == {
        "data": [_segment_contract(segment, summary="Console DB summary")],
        "limit": 10,
        "total": 1,
        "total_pages": 1,
        "page": 1,
    }
    assert hit_count_response.status_code == 200
    assert hit_count_response.get_json() == {
        "data": [_segment_contract(segment, summary="Console DB summary")],
        "limit": 20,
        "total": 1,
        "total_pages": 1,
        "page": 1,
    }
    assert disabled_response.status_code == 200
    assert disabled_response.get_json() == {"data": [], "limit": 20, "total": 0, "total_pages": 0, "page": 1}


def test_bulk_delete_segments_persists(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    with patch("services.dataset_service.delete_segment_from_index_task.delay") as delete_index:
        response = container_client.delete(
            f"{_segments_url(graph)}?segment_id={graph.segment_id}",
            headers=graph.headers,
        )

    assert response.status_code == 204
    assert container_state.count(DocumentSegment, DocumentSegment.id == graph.segment_id) == 0
    delete_index.assert_called_once()


@pytest.mark.requires_redis
def test_disable_and_enable_segment_persist_status(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    with patch("services.dataset_service.disable_segments_from_index_task.delay") as disable_index:
        response = container_client.patch(
            f"/console/api/datasets/{graph.dataset_id}/documents/{graph.document_id}/segment/disable"
            f"?segment_id={graph.segment_id}",
            headers=graph.headers,
        )

    assert response.status_code == 200
    assert container_state.one(DocumentSegment, DocumentSegment.id == graph.segment_id).enabled is False
    disable_index.assert_called_once()

    with patch("services.dataset_service.enable_segments_to_index_task.delay") as enable_index:
        enable_response = container_client.patch(
            f"/console/api/datasets/{graph.dataset_id}/documents/{graph.document_id}/segment/enable"
            f"?segment_id={graph.segment_id}",
            headers=graph.headers,
        )

    assert enable_response.status_code == 200
    assert container_state.one(DocumentSegment, DocumentSegment.id == graph.segment_id).enabled is True
    enable_index.assert_called_once_with([graph.segment_id], graph.dataset_id, graph.document_id)


@pytest.mark.requires_redis
def test_create_update_and_delete_segment_persist(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    with patch("services.dataset_service.VectorService.create_segments_vector"):
        create_response = container_client.post(
            f"/console/api/datasets/{graph.dataset_id}/documents/{graph.document_id}/segment",
            headers=graph.headers,
            json={"content": "Created through HTTP", "keywords": ["created"], "attachment_ids": []},
        )

    assert create_response.status_code == 200
    created_id = create_response.get_json()["data"]["id"]
    assert container_state.one(DocumentSegment, DocumentSegment.id == created_id).content == "Created through HTTP"

    with patch("services.dataset_service.VectorService.update_multimodel_vector"):
        update_response = container_client.patch(
            f"{_segments_url(graph)}/{created_id}",
            headers=graph.headers,
            json={
                "content": "Updated through HTTP",
                "keywords": ["updated"],
                "attachment_ids": [],
            },
        )

    assert update_response.status_code == 200
    assert container_state.one(DocumentSegment, DocumentSegment.id == created_id).content == "Updated through HTTP"

    with patch("services.dataset_service.delete_segment_from_index_task.delay") as delete_index:
        delete_response = container_client.delete(
            f"{_segments_url(graph)}/{created_id}",
            headers=graph.headers,
        )

    assert delete_response.status_code == 204
    assert container_state.count(DocumentSegment, DocumentSegment.id == created_id) == 0
    delete_index.assert_called_once()


@pytest.mark.requires_redis
def test_segment_index_failure_persists_error_state(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    with patch(
        "services.dataset_service.VectorService.create_segments_vector",
        side_effect=RuntimeError("index unavailable"),
    ):
        response = container_client.post(
            f"/console/api/datasets/{graph.dataset_id}/documents/{graph.document_id}/segment",
            headers=graph.headers,
            json={"content": "Persisted index failure", "attachment_ids": []},
        )

    assert response.status_code == 200
    segment = container_state.one(DocumentSegment, DocumentSegment.content == "Persisted index failure")
    assert segment.status == SegmentStatus.ERROR
    assert segment.enabled is False
    assert segment.error == "index unavailable"


@pytest.mark.requires_redis
def test_batch_import_start_and_status_use_real_redis_state(
    container_client: FlaskClient,
    container_transaction: Session,
    console_segment_graph: ConsoleSegmentGraph,
) -> None:
    graph = console_segment_graph
    upload_file = UploadFile(
        tenant_id=graph.tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"segment-import/{uuid4()}.csv",
        name="segments.csv",
        size=128,
        extension=".csv",
        mime_type="text/csv",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=graph.account_id,
        created_at=datetime.now(UTC),
        used=False,
    )
    container_transaction.add(upload_file)
    container_transaction.commit()
    upload_file_id = upload_file.id

    with patch("controllers.console.datasets.datasets_segments.batch_create_segment_to_index_task.delay") as batch_task:
        start_response = container_client.post(
            f"{_segments_url(graph)}/batch_import",
            headers=graph.headers,
            json={"upload_file_id": upload_file_id},
        )

    assert start_response.status_code == 200
    job_id = start_response.get_json()["job_id"]
    assert start_response.get_json()["job_status"] == "waiting"
    batch_task.assert_called_once()

    status_response = container_client.get(
        f"/console/api/datasets/batch_import_status/{job_id}",
        headers=graph.headers,
    )
    assert status_response.status_code == 200
    assert status_response.get_json() == {"job_id": job_id, "job_status": "waiting"}


@pytest.mark.requires_redis
def test_create_and_list_child_chunks_persist(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    child_url = f"{_segments_url(graph)}/{graph.segment_id}/child_chunks"
    with patch("services.dataset_service.VectorService.create_child_chunk_vector"):
        create_response = container_client.post(
            child_url,
            headers=graph.headers,
            json={"content": "Created child through HTTP"},
        )

    assert create_response.status_code == 200
    created_id = create_response.get_json()["data"]["id"]
    assert container_state.one(ChildChunk, ChildChunk.id == created_id).content == "Created child through HTTP"

    list_response = container_client.get(child_url, headers=graph.headers)
    assert list_response.status_code == 200
    payload = list_response.get_json()
    chunks = {item["id"]: item for item in payload.pop("data")}
    assert payload == {"total": 2, "total_pages": 1, "page": 1, "limit": 20}
    assert chunks == {
        graph.child_chunk_id: _child_chunk_contract(
            container_state.one(ChildChunk, ChildChunk.id == graph.child_chunk_id)
        ),
        created_id: _child_chunk_contract(container_state.one(ChildChunk, ChildChunk.id == created_id)),
    }


def test_batch_update_child_chunks_persists(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    child_url = f"{_segments_url(graph)}/{graph.segment_id}/child_chunks"
    with patch("services.dataset_service.VectorService.update_child_chunk_vector"):
        response = container_client.patch(
            child_url,
            headers=graph.headers,
            json={"chunks": [{"id": graph.child_chunk_id, "content": "Batch updated child"}]},
        )

    assert response.status_code == 200
    assert container_state.one(ChildChunk, ChildChunk.id == graph.child_chunk_id).content == "Batch updated child"


def test_update_and_delete_child_chunk_persist(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    child_url = f"{_segments_url(graph)}/{graph.segment_id}/child_chunks/{graph.child_chunk_id}"
    with patch("services.dataset_service.VectorService.update_child_chunk_vector"):
        update_response = container_client.patch(
            child_url,
            headers=graph.headers,
            json={"content": "Individually updated child"},
        )

    assert update_response.status_code == 200
    assert (
        container_state.one(ChildChunk, ChildChunk.id == graph.child_chunk_id).content == "Individually updated child"
    )

    with patch("services.dataset_service.VectorService.delete_child_chunk_vector"):
        delete_response = container_client.delete(child_url, headers=graph.headers)

    assert delete_response.status_code == 204
    assert container_state.count(ChildChunk, ChildChunk.id == graph.child_chunk_id) == 0


@pytest.mark.requires_redis
def test_child_chunk_index_failures_roll_back_all_mutations(
    container_client: FlaskClient,
    console_segment_graph: ConsoleSegmentGraph,
    container_state: DatabaseState,
) -> None:
    graph = console_segment_graph
    child_chunks_url = f"{_segments_url(graph)}/{graph.segment_id}/child_chunks"
    original_count = container_state.count(ChildChunk, ChildChunk.segment_id == graph.segment_id)

    with patch(
        "services.dataset_service.VectorService.create_child_chunk_vector",
        side_effect=RuntimeError("create index failed"),
    ):
        create_response = container_client.post(
            child_chunks_url,
            headers=graph.headers,
            json={"content": "Must roll back"},
        )

    assert create_response.status_code == 500
    assert container_state.count(ChildChunk, ChildChunk.segment_id == graph.segment_id) == original_count

    child_chunk_url = f"{child_chunks_url}/{graph.child_chunk_id}"
    with patch(
        "services.dataset_service.VectorService.update_child_chunk_vector",
        side_effect=RuntimeError("update index failed"),
    ):
        update_response = container_client.patch(
            child_chunk_url,
            headers=graph.headers,
            json={"content": "Must not persist"},
        )

    assert update_response.status_code == 500
    assert container_state.one(ChildChunk, ChildChunk.id == graph.child_chunk_id).content == "Initial child chunk"

    with patch(
        "services.dataset_service.VectorService.delete_child_chunk_vector",
        side_effect=RuntimeError("delete index failed"),
    ):
        delete_response = container_client.delete(child_chunk_url, headers=graph.headers)

    assert delete_response.status_code == 500
    assert container_state.count(ChildChunk, ChildChunk.id == graph.child_chunk_id) == 1
