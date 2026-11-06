import importlib
import sys
from types import ModuleType
from unittest.mock import MagicMock

import pytest

from core.rag.datasource.vdb.vector_integration_test_support import FakeModule
from core.rag.models.document import Document


class _DXMTError(Exception):
    pass


def _build_fake_dxmt_modules() -> tuple[FakeModule, FakeModule]:
    dxmt = FakeModule("dxmt")
    exceptions = FakeModule("dxmt.exceptions")
    exceptions.DXMTError = _DXMTError

    class _Client:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs
            self.get_table = MagicMock(side_effect=_DXMTError("TABLE_NOT_FOUND"))
            self.create_table = MagicMock()
            self.delete_table = MagicMock()
            self.insert_records = MagicMock()
            self.delete_records = MagicMock()
            self.get_records = MagicMock(return_value=[])
            self.search = MagicMock(return_value=[])
            self.full_text_search = MagicMock(return_value=[])

    dxmt.DXMTClient = _Client
    return dxmt, exceptions


@pytest.fixture
def dxmt_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    fake_dxmt, fake_exceptions = _build_fake_dxmt_modules()
    monkeypatch.setitem(sys.modules, "dxmt", fake_dxmt)
    monkeypatch.setitem(sys.modules, "dxmt.exceptions", fake_exceptions)
    redis = MagicMock()
    redis.get.return_value = None
    redis.lock.return_value.__enter__ = MagicMock(return_value=None)
    redis.lock.return_value.__exit__ = MagicMock(return_value=False)
    monkeypatch.setattr("extensions.ext_redis.redis_client", redis)
    import dify_vdb_dxmt.dxmt_vector as module

    module = importlib.reload(module)
    monkeypatch.setattr(module, "redis_client", redis)
    return module


def _vector(module: ModuleType):
    return module.DXMTVector(
        collection_name="vector_index_test_node",
        config=module.DXMTVectorConfig(host="localhost", port=9999, api_key="k"),
    )


def _doc(doc_id: str, text: str = "hello") -> Document:
    return Document(page_content=text, metadata={"doc_id": doc_id, "document_id": "d1", "dataset_id": "s1"})


def test_create_makes_a_table_with_full_text_and_inserts(dxmt_module: ModuleType) -> None:
    v = _vector(dxmt_module)
    v.create(texts=[_doc("a")], embeddings=[[0.1, 0.2]])
    kwargs = v._client.create_table.call_args.kwargs
    assert kwargs["name"] == "vector_index_test_node"
    assert kwargs["dimension"] == 2
    assert kwargs["enable_full_text_search"] is True
    assert kwargs["text_fields"][0] == {
        "name": "content",
        "source": {"metadata_field": "page_content"},
        "analyzer": "standard",
        "boost": 1.0,
    }
    records = v._client.insert_records.call_args.args[1]
    assert records == [
        {
            "id": "a",
            "vector": [0.1, 0.2],
            "payload": {"page_content": "hello", "doc_id": "a", "document_id": "d1", "dataset_id": "s1"},
        }
    ]


def test_create_is_idempotent_when_the_table_exists(dxmt_module: ModuleType) -> None:
    v = _vector(dxmt_module)
    v._client.get_table = MagicMock(return_value={"dimension": 2})
    v.create(texts=[_doc("a")], embeddings=[[0.1, 0.2]])
    v._client.create_table.assert_not_called()
    v._client.insert_records.assert_called_once()


def test_search_by_vector_scores_filters_and_sorts(dxmt_module: ModuleType) -> None:
    v = _vector(dxmt_module)
    v._client.search.return_value = [
        {"id": "a", "score": 0.4, "payload": {"page_content": "low", "doc_id": "a"}},
        {"id": "b", "score": 0.9, "payload": {"page_content": "high", "doc_id": "b"}},
    ]
    docs = v.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["d1"])
    assert [d.page_content for d in docs] == ["high"]
    assert docs[0].metadata == {"doc_id": "b", "score": 0.9}
    kwargs = v._client.search.call_args.kwargs
    assert kwargs["k"] == 2
    assert kwargs["filter"] == {"must": [{"key": "document_id", "operation": {"type": "In", "value": ["d1"]}}]}


def test_search_by_full_text_uses_bm25(dxmt_module: ModuleType) -> None:
    v = _vector(dxmt_module)
    v._client.full_text_search.return_value = [
        {"id": "a", "score": 3.2, "payload": {"page_content": "t", "doc_id": "a"}}
    ]
    docs = v.search_by_full_text("t", top_k=3)
    assert docs[0].metadata["score"] == 3.2
    assert docs[0].page_content == "t"
    assert v._client.full_text_search.call_args.kwargs["k"] == 3


def test_deletes_go_to_the_server_and_a_missing_table_is_quiet(dxmt_module: ModuleType) -> None:
    v = _vector(dxmt_module)
    v.delete_by_ids(["a", "b"])
    v._client.delete_records.assert_called_once_with("vector_index_test_node", ["a", "b"])
    v.delete_by_metadata_field("document_id", "d1")
    assert v._client.delete_records.call_args.kwargs["filter"] == {
        "must": [{"key": "document_id", "operation": {"type": "Equal", "value": "d1"}}]
    }
    v._client.delete_table.side_effect = _DXMTError("TABLE_NOT_FOUND")
    v.delete()
    v._client.get_records.side_effect = _DXMTError("TABLE_NOT_FOUND")
    assert v.text_exists("a") is False


def test_get_ids_by_metadata_field_is_not_implemented(dxmt_module: ModuleType) -> None:
    v = _vector(dxmt_module)
    with pytest.raises(NotImplementedError):
        v.get_ids_by_metadata_field("k", "v")


def test_factory_names_the_table_after_the_dataset(dxmt_module: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    from configs import dify_config

    monkeypatch.setattr(dify_config, "DXMT_HOST", "dxmt-host")
    monkeypatch.setattr(dify_config, "DXMT_PORT", 19999)
    dataset = MagicMock()
    dataset.id = "11111111-2222-3333-4444-555555555555"
    dataset.index_struct_dict = None
    vector = dxmt_module.DXMTVectorFactory().init_vector(dataset, [], MagicMock(), session=None)
    assert vector.collection_name.endswith("_11111111_2222_3333_4444_555555555555_node")
    assert vector._client.kwargs["host"] == "dxmt-host"
    assert vector._client.kwargs["port"] == 19999
    assert '"type": "dxmt"' in dataset.index_struct
