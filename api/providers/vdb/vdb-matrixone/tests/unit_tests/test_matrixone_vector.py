import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_mo_vector_modules():
    mo_vector = types.ModuleType("mo_vector")
    mo_vector.__path__ = []
    mo_vector_client = types.ModuleType("mo_vector.client")

    class MoVectorClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.create_full_text_index = MagicMock()
            self.insert = MagicMock()
            self.get = MagicMock(return_value=[])
            self.delete = MagicMock()
            self.query_by_metadata = MagicMock(return_value=[])
            self.query = MagicMock(return_value=[])
            self.full_text_query = MagicMock(return_value=[])

    mo_vector_client.MoVectorClient = MoVectorClient
    mo_vector.client = mo_vector_client
    return {"mo_vector": mo_vector, "mo_vector.client": mo_vector_client}


@pytest.fixture
def matrixone_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_mo_vector_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_matrixone.matrixone_vector as module

    return importlib.reload(module)


def _valid_config(module):
    return module.MatrixoneConfig(
        host="localhost",
        port=6001,
        user="dump",
        password="111",
        database="dify",
        metric="l2",
    )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("host", "", "config host is required"),
        ("port", 0, "config port is required"),
        ("user", "", "config user is required"),
        ("password", "", "config password is required"),
        ("database", "", "config database is required"),
    ],
)
def test_matrixone_config_validation(matrixone_module, field, value, message):
    values = _valid_config(matrixone_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        matrixone_module.MatrixoneConfig.model_validate(values)


def test_get_client_creates_full_text_index_when_cache_misses(matrixone_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(matrixone_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(matrixone_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(matrixone_module.redis_client, "set", MagicMock())

    vector = matrixone_module.MatrixoneVector("Collection_1", _valid_config(matrixone_module))
    client = vector._get_client(dimension=3, create_table=True)

    assert client.kwargs["table_name"] == "collection_1"
    client.create_full_text_index.assert_called_once()
    matrixone_module.redis_client.set.assert_called_once()


def test_get_client_skips_index_creation_when_cache_hits(matrixone_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(matrixone_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(matrixone_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(matrixone_module.redis_client, "set", MagicMock())

    vector = matrixone_module.MatrixoneVector("Collection_1", _valid_config(matrixone_module))
    client = vector._get_client(dimension=3, create_table=True)

    client.create_full_text_index.assert_not_called()
    matrixone_module.redis_client.set.assert_not_called()


def test_ensure_client_initializes_client_for_decorated_methods(matrixone_module):
    vector = matrixone_module.MatrixoneVector("collection_1", _valid_config(matrixone_module))
    vector.client = None
    fake_client = MagicMock()
    fake_client.get.return_value = [{"id": "seg-1"}]
    vector._get_client = MagicMock(return_value=fake_client)

    exists = vector.text_exists("seg-1")

    assert exists is True
    vector._get_client.assert_called_once_with(None, False)


def test_search_by_full_text_parses_metadata_and_applies_threshold(matrixone_module):
    vector = matrixone_module.MatrixoneVector("collection_1", _valid_config(matrixone_module))
    vector.client = MagicMock()
    vector.client.full_text_query.return_value = [
        SimpleNamespace(document="doc-a", metadata='{"doc_id":"1"}', distance=0.1),
        SimpleNamespace(document="doc-b", metadata={"doc_id": "2"}, distance=0.7),
    ]

    docs = vector.search_by_full_text("query", top_k=2, score_threshold=0.5, document_ids_filter=["doc-1"])

    assert len(docs) == 1
    assert docs[0].page_content == "doc-a"
    assert docs[0].metadata["doc_id"] == "1"
    assert docs[0].metadata["score"] == pytest.approx(0.9)
    assert vector.client.full_text_query.call_args.kwargs["filter"] == {"document_id": {"$in": ["doc-1"]}}


def test_get_type_and_create_delegate_to_add_texts(matrixone_module):
    vector = matrixone_module.MatrixoneVector("collection_1", _valid_config(matrixone_module))
    fake_client = MagicMock()
    vector._get_client = MagicMock(return_value=fake_client)
    vector.add_texts = MagicMock(return_value=["seg-1"])
    docs = [Document(page_content="hello", metadata={"doc_id": "seg-1"})]

    result = vector.create(docs, [[0.1, 0.2]])

    assert vector.get_type() == "matrixone"
    assert result == ["seg-1"]
    vector._get_client.assert_called_once_with(2, True)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])


def test_get_client_handles_full_text_index_creation_error(matrixone_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(matrixone_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(matrixone_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(matrixone_module.redis_client, "set", MagicMock())

    failing_client = MagicMock()
    failing_client.create_full_text_index.side_effect = RuntimeError("boom")
    monkeypatch.setattr(matrixone_module, "MoVectorClient", MagicMock(return_value=failing_client))

    vector = matrixone_module.MatrixoneVector("collection_1", _valid_config(matrixone_module))
    client = vector._get_client(dimension=3, create_table=True)

    assert client is failing_client
    matrixone_module.redis_client.set.assert_not_called()


def test_add_texts_generates_ids_and_inserts(matrixone_module, monkeypatch: pytest.MonkeyPatch):
    vector = matrixone_module.MatrixoneVector("collection_1", _valid_config(matrixone_module))
    vector.client = MagicMock()
    monkeypatch.setattr(matrixone_module.uuid, "uuid4", lambda: "generated-uuid")
    docs = [
        Document(page_content="a", metadata={"doc_id": "doc-a", "document_id": "d-1"}),
        Document(page_content="b", metadata={"document_id": "d-2"}),
        SimpleNamespace(page_content="c", metadata=None),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2], [0.3]])

    # For current prod code, only docs with metadata get ids, so only two ids
    assert ids == ["doc-a", "generated-uuid"]
    vector.client.insert.assert_called_once()
    insert_kwargs = vector.client.insert.call_args.kwargs
    # All lists passed to insert should be the same length
    texts = insert_kwargs["texts"]
    embeddings = insert_kwargs["embeddings"]
    metadatas = insert_kwargs["metadatas"]
    ids_insert = insert_kwargs["ids"]
    assert len(texts) == len(embeddings) == len(metadatas) == len(docs)
    # ids may be shorter than docs for current prod code, but should match number of docs with metadata
    assert ids_insert == ["doc-a", "generated-uuid"]


def test_delete_and_metadata_methods(matrixone_module):
    vector = matrixone_module.MatrixoneVector("collection_1", _valid_config(matrixone_module))
    vector.client = MagicMock()
    vector.client.query_by_metadata.return_value = [SimpleNamespace(id="seg-1"), SimpleNamespace(id="seg-2")]

    vector.delete_by_ids([])
    vector.client.delete.assert_not_called()

    vector.delete_by_ids(["seg-1"])
    vector.delete_by_metadata_field("document_id", "doc-1")
    ids = vector.get_ids_by_metadata_field("document_id", "doc-1")
    vector.delete()

    assert ids == ["seg-1", "seg-2"]
    assert vector.client.delete.call_count == 3


def test_search_by_vector_builds_documents(matrixone_module):
    vector = matrixone_module.MatrixoneVector("collection_1", _valid_config(matrixone_module))
    vector.client = MagicMock()
    vector.client.query.return_value = [
        SimpleNamespace(document="doc-a", metadata={"doc_id": "1"}),
        SimpleNamespace(document="doc-b", metadata={"doc_id": "2"}),
    ]

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, document_ids_filter=["d-1"])

    assert len(docs) == 2
    assert docs[0].page_content == "doc-a"
    assert docs[1].metadata["doc_id"] == "2"
    assert vector.client.query.call_args.kwargs["filter"] == {"document_id": {"$in": ["d-1"]}}


def test_matrixone_factory_uses_existing_or_generated_collection(matrixone_module, monkeypatch: pytest.MonkeyPatch):
    factory = matrixone_module.MatrixoneVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(matrixone_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(matrixone_module.dify_config, "MATRIXONE_HOST", "127.0.0.1")
    monkeypatch.setattr(matrixone_module.dify_config, "MATRIXONE_PORT", 6001)
    monkeypatch.setattr(matrixone_module.dify_config, "MATRIXONE_USER", "dump")
    monkeypatch.setattr(matrixone_module.dify_config, "MATRIXONE_PASSWORD", "111")
    monkeypatch.setattr(matrixone_module.dify_config, "MATRIXONE_DATABASE", "dify")
    monkeypatch.setattr(matrixone_module.dify_config, "MATRIXONE_METRIC", "l2")

    with patch.object(matrixone_module, "MatrixoneVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
