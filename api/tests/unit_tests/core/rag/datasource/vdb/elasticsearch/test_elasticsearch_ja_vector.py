import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


def _build_fake_elasticsearch_modules():
    elasticsearch = types.ModuleType("elasticsearch")

    class ConnectionError(Exception):
        pass

    class Elasticsearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.ping = MagicMock(return_value=True)
            self.info = MagicMock(return_value={"version": {"number": "8.12.0"}})
            self.indices = SimpleNamespace(
                refresh=MagicMock(), delete=MagicMock(), exists=MagicMock(return_value=False), create=MagicMock()
            )

    elasticsearch.Elasticsearch = Elasticsearch
    elasticsearch.ConnectionError = ConnectionError
    return {"elasticsearch": elasticsearch}


@pytest.fixture
def elasticsearch_ja_module(monkeypatch):
    for name, module in _build_fake_elasticsearch_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.elasticsearch.elasticsearch_ja_vector as ja_module
    import core.rag.datasource.vdb.elasticsearch.elasticsearch_vector as base_module

    importlib.reload(base_module)
    return importlib.reload(ja_module)


def test_create_collection_cache_hit(elasticsearch_ja_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(elasticsearch_ja_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(elasticsearch_ja_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(elasticsearch_ja_module.redis_client, "set", MagicMock())

    vector = elasticsearch_ja_module.ElasticSearchJaVector.__new__(elasticsearch_ja_module.ElasticSearchJaVector)
    vector._collection_name = "test"
    vector._client = MagicMock()

    vector.create_collection([[0.1, 0.2]], [{}])

    vector._client.indices.create.assert_not_called()
    elasticsearch_ja_module.redis_client.set.assert_not_called()


def test_create_collection_create_and_exists_paths(elasticsearch_ja_module, monkeypatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(elasticsearch_ja_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(elasticsearch_ja_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(elasticsearch_ja_module.redis_client, "set", MagicMock())

    vector = elasticsearch_ja_module.ElasticSearchJaVector.__new__(elasticsearch_ja_module.ElasticSearchJaVector)
    vector._collection_name = "test"
    vector._client = MagicMock()

    vector._client.indices.exists.return_value = False
    vector.create_collection([[0.1, 0.2, 0.3]], [{}])

    vector._client.indices.create.assert_called_once()
    kwargs = vector._client.indices.create.call_args.kwargs
    assert kwargs["index"] == "test"
    assert kwargs["mappings"]["properties"][elasticsearch_ja_module.Field.VECTOR]["dims"] == 3
    elasticsearch_ja_module.redis_client.set.assert_called_once()

    vector._client.indices.create.reset_mock()
    elasticsearch_ja_module.redis_client.set.reset_mock()
    vector._client.indices.exists.return_value = True
    vector.create_collection([[0.1, 0.2]], [{}])

    vector._client.indices.create.assert_not_called()
    elasticsearch_ja_module.redis_client.set.assert_called_once()


def test_ja_factory_uses_existing_or_generated_collection(elasticsearch_ja_module, monkeypatch):
    factory = elasticsearch_ja_module.ElasticSearchJaVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(elasticsearch_ja_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(
        elasticsearch_ja_module,
        "current_app",
        SimpleNamespace(
            config={
                "ELASTICSEARCH_HOST": "localhost",
                "ELASTICSEARCH_PORT": 9200,
                "ELASTICSEARCH_USERNAME": "elastic",
                "ELASTICSEARCH_PASSWORD": "secret",
            }
        ),
    )

    with patch.object(elasticsearch_ja_module, "ElasticSearchJaVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["index_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["index_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
