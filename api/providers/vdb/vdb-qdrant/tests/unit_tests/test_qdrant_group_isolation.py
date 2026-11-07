import importlib
import uuid
from types import ModuleType

import pytest
from qdrant_client.http import models

from core.rag.models.document import Document


@pytest.fixture
def qdrant_module() -> ModuleType:
    import dify_vdb_qdrant.qdrant_vector as module

    return importlib.reload(module)


@pytest.fixture
def shared_vector(qdrant_module: ModuleType):
    vector = qdrant_module.QdrantVector(
        collection_name="shared",
        group_id="dataset-a",
        config=qdrant_module.QdrantConfig(endpoint="http://unused.invalid"),
    )
    vector._client.close()
    vector._client = qdrant_module.qdrant_client.QdrantClient(location=":memory:")
    vector._client.create_collection(
        collection_name="shared",
        vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE),
    )
    try:
        yield vector
    finally:
        vector._client.close()


def _attachment(attachment_id: str, *, document_id: str | None = None) -> Document:
    return Document(
        page_content="attachment",
        metadata={
            "doc_id": attachment_id,
            "doc_type": "image",
            "document_id": document_id or attachment_id,
        },
    )


def test_shared_collection_namespaces_physical_ids_and_scopes_deletes(shared_vector) -> None:
    attachment_id = str(uuid.uuid4())

    assert shared_vector.add_texts([_attachment(attachment_id)], [[1.0, 0.0]]) == [attachment_id]
    dataset_a_point_id = shared_vector._physical_point_id(attachment_id)

    shared_vector._group_id = "dataset-b"
    assert shared_vector.add_texts([_attachment(attachment_id)], [[0.0, 1.0]]) == [attachment_id]
    dataset_b_point_id = shared_vector._physical_point_id(attachment_id)

    records = shared_vector._client.retrieve(
        collection_name="shared",
        ids=[dataset_a_point_id, dataset_b_point_id],
        with_payload=True,
    )
    assert {record.id for record in records} == {dataset_a_point_id, dataset_b_point_id}
    assert {record.payload["group_id"] for record in records if record.payload} == {"dataset-a", "dataset-b"}
    assert shared_vector.text_exists(attachment_id)

    shared_vector._group_id = "dataset-a"
    assert shared_vector.text_exists(attachment_id)
    shared_vector.delete_by_ids([attachment_id])
    assert not shared_vector.text_exists(attachment_id)

    shared_vector._group_id = "dataset-b"
    assert shared_vector.text_exists(attachment_id)
    hits = shared_vector.search_by_vector([0.0, 1.0], top_k=2)
    assert [hit.metadata["doc_id"] for hit in hits] == [attachment_id]


def test_legacy_points_are_read_and_deleted_only_by_their_own_group(shared_vector) -> None:
    attachment_id = str(uuid.uuid4())
    shared_vector._client.upsert(
        collection_name="shared",
        points=[
            models.PointStruct(
                id=attachment_id,
                vector=[1.0, 0.0],
                payload={
                    "group_id": "dataset-b",
                    "page_content": "legacy",
                    "metadata": _attachment(attachment_id).metadata,
                },
            )
        ],
    )

    assert not shared_vector.text_exists(attachment_id)
    shared_vector.delete_by_ids([attachment_id])
    assert shared_vector._client.retrieve(collection_name="shared", ids=[attachment_id])

    shared_vector._group_id = "dataset-b"
    assert shared_vector.text_exists(attachment_id)
    shared_vector.delete_by_ids([attachment_id])
    assert shared_vector._client.retrieve(collection_name="shared", ids=[attachment_id]) == []


def test_rewrite_migrates_only_the_current_groups_legacy_point(shared_vector) -> None:
    current_attachment_id = str(uuid.uuid4())
    other_attachment_id = str(uuid.uuid4())
    shared_vector._client.upsert(
        collection_name="shared",
        points=[
            models.PointStruct(
                id=current_attachment_id,
                vector=[1.0, 0.0],
                payload={
                    "group_id": "dataset-a",
                    "page_content": "legacy-a",
                    "metadata": _attachment(current_attachment_id).metadata,
                },
            ),
            models.PointStruct(
                id=other_attachment_id,
                vector=[0.0, 1.0],
                payload={
                    "group_id": "dataset-b",
                    "page_content": "legacy-b",
                    "metadata": _attachment(other_attachment_id).metadata,
                },
            ),
        ],
    )

    shared_vector.add_texts([_attachment(current_attachment_id)], [[0.5, 0.5]])

    assert shared_vector._client.retrieve(collection_name="shared", ids=[current_attachment_id]) == []
    assert shared_vector._client.retrieve(collection_name="shared", ids=[other_attachment_id])
    assert shared_vector.text_exists(current_attachment_id)


def test_metadata_delete_is_group_scoped(shared_vector) -> None:
    document_id = str(uuid.uuid4())
    dataset_a_attachment = str(uuid.uuid4())
    dataset_b_attachment = str(uuid.uuid4())
    shared_vector.add_texts([_attachment(dataset_a_attachment, document_id=document_id)], [[1.0, 0.0]])
    shared_vector._group_id = "dataset-b"
    shared_vector.add_texts([_attachment(dataset_b_attachment, document_id=document_id)], [[0.0, 1.0]])

    shared_vector._group_id = "dataset-a"
    shared_vector.delete_by_metadata_field("document_id", document_id)
    assert not shared_vector.text_exists(dataset_a_attachment)

    shared_vector._group_id = "dataset-b"
    assert shared_vector.text_exists(dataset_b_attachment)
