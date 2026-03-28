import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_upstash_module():
    upstash_module = types.ModuleType("upstash_vector")

    class Vector:
        def __init__(self, id, vector, metadata, data):
            self.id = id
            self.vector = vector
            self.metadata = metadata
            self.data = data

    class Index:
        def __init__(self, url, token):
            self.url = url
            self.token = token
            self.info = MagicMock(return_value=SimpleNamespace(dimension=8))
            self.upsert = MagicMock()
            self.query = MagicMock(return_value=[])
            self.delete = MagicMock()
            self.reset = MagicMock()

    upstash_module.Vector = Vector
    upstash_module.Index = Index
    return upstash_module


@pytest.fixture
def upstash_module(monkeypatch):
    # Remove patched modules if present
    for modname in ["upstash_vector", "core.rag.datasource.vdb.upstash.upstash_vector"]:
        if modname in sys.modules:
            monkeypatch.delitem(sys.modules, modname, raising=False)
    monkeypatch.setitem(sys.modules, "upstash_vector", _build_fake_upstash_module())
    module = importlib.import_module("core.rag.datasource.vdb.upstash.upstash_vector")
    return module


def _config(module):
    return module.UpstashVectorConfig(url="https://upstash.example", token="token-123")


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("url", "", "Upstash URL is required"),
        ("token", "", "Upstash Token is required"),
    ],
)
def test_upstash_config_validation(upstash_module, field, value, message):
    values = _config(upstash_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        upstash_module.UpstashVectorConfig.model_validate(values)


def test_init_get_type_and_dimension(upstash_module, monkeypatch):
    vector = upstash_module.UpstashVector("collection_1", _config(upstash_module))

    assert vector.get_type() == upstash_module.VectorType.UPSTASH
    assert vector._table_name == "collection_1"
    assert vector._get_index_dimension() == 8

    vector.index.info.return_value = SimpleNamespace(dimension=None)
    assert vector._get_index_dimension() == 1536

    vector.index.info.return_value = None
    assert vector._get_index_dimension() == 1536

    monkeypatch.setattr(upstash_module, "uuid4", lambda: "generated-uuid")
    docs = [Document(page_content="hello", metadata={"doc_id": "id-1"})]
    vector.add_texts(docs, [[0.1, 0.2]])

    vector.index.upsert.assert_called_once()
    upsert_vectors = vector.index.upsert.call_args.kwargs["vectors"]
    assert upsert_vectors[0].id == "generated-uuid"


def test_create_text_exists_and_delete_by_ids(upstash_module):
    vector = upstash_module.UpstashVector("collection_1", _config(upstash_module))
    vector.add_texts = MagicMock()

    docs = [Document(page_content="hello", metadata={"doc_id": "id-1"})]
    vector.create(docs, [[0.1]])
    vector.add_texts.assert_called_once_with(docs, [[0.1]])

    vector.get_ids_by_metadata_field = MagicMock(return_value=["id-1"])
    assert vector.text_exists("doc-1") is True
    vector.get_ids_by_metadata_field.return_value = []
    assert vector.text_exists("doc-1") is False

    vector.get_ids_by_metadata_field = MagicMock(side_effect=[["item-1"], [], ["item-2"]])
    vector._delete_by_ids = MagicMock()
    vector.delete_by_ids(["doc-1", "doc-2", "doc-3"])
    vector._delete_by_ids.assert_called_once_with(ids=["item-1", "item-2"])


def test_delete_helpers_and_search(upstash_module):
    vector = upstash_module.UpstashVector("collection_1", _config(upstash_module))

    vector._delete_by_ids([])
    vector.index.delete.assert_not_called()
    vector._delete_by_ids(["a", "b"])
    vector.index.delete.assert_called_once_with(ids=["a", "b"])

    vector.index.query.return_value = [SimpleNamespace(id="x-1"), SimpleNamespace(id="x-2")]
    ids = vector.get_ids_by_metadata_field("doc_id", "doc-1")
    assert ids == ["x-1", "x-2"]
    query_kwargs = vector.index.query.call_args.kwargs
    assert query_kwargs["top_k"] == 1000
    assert query_kwargs["filter"] == "doc_id = 'doc-1'"

    vector._delete_by_ids = MagicMock()
    vector.get_ids_by_metadata_field = MagicMock(return_value=["x-1"])
    vector.delete_by_metadata_field("doc_id", "doc-1")
    vector._delete_by_ids.assert_called_once_with(["x-1"])

    vector._delete_by_ids.reset_mock()
    vector.get_ids_by_metadata_field.return_value = []
    vector.delete_by_metadata_field("doc_id", "doc-2")
    vector._delete_by_ids.assert_not_called()


def test_search_by_vector_filter_threshold_and_delete(upstash_module):
    vector = upstash_module.UpstashVector("collection_1", _config(upstash_module))
    vector.index.query.return_value = [
        SimpleNamespace(metadata={"document_id": "d-1"}, data="text-1", score=0.9),
        SimpleNamespace(metadata={"document_id": "d-2"}, data="text-2", score=0.3),
        SimpleNamespace(metadata=None, data="text-3", score=0.99),
        SimpleNamespace(metadata={"document_id": "d-4"}, data=None, score=0.99),
    ]

    docs = vector.search_by_vector(
        [0.1, 0.2],
        top_k=3,
        score_threshold=0.5,
        document_ids_filter=["d-1", "d-2"],
    )

    assert len(docs) == 1
    assert docs[0].page_content == "text-1"
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    search_kwargs = vector.index.query.call_args.kwargs
    assert search_kwargs["top_k"] == 3
    assert search_kwargs["filter"] == "document_id in ('d-1', 'd-2')"

    assert vector.search_by_full_text("query") == []

    vector.delete()
    vector.index.reset.assert_called_once()


def test_upstash_factory_uses_existing_or_generated_collection(upstash_module, monkeypatch):
    factory = upstash_module.UpstashVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(upstash_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(upstash_module.dify_config, "UPSTASH_VECTOR_URL", "https://upstash.example")
    monkeypatch.setattr(upstash_module.dify_config, "UPSTASH_VECTOR_TOKEN", "token-123")

    with patch.object(upstash_module, "UpstashVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None
