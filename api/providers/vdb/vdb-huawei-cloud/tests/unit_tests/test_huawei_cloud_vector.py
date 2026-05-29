import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_elasticsearch_modules():
    elasticsearch = types.ModuleType("elasticsearch")

    class Elasticsearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.index = MagicMock()
            self.exists = MagicMock(return_value=False)
            self.delete = MagicMock()
            self.search = MagicMock(return_value={"hits": {"hits": []}})
            self.indices = SimpleNamespace(
                refresh=MagicMock(), delete=MagicMock(), exists=MagicMock(return_value=False), create=MagicMock()
            )

    elasticsearch.Elasticsearch = Elasticsearch
    return {"elasticsearch": elasticsearch}


@pytest.fixture
def huawei_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_elasticsearch_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_huawei_cloud.huawei_cloud_vector as module

    return importlib.reload(module)


def _config(module):
    return module.HuaweiCloudVectorConfig(hosts="http://localhost:9200", username="user", password="pass")


def test_create_ssl_context(huawei_module):
    ctx = huawei_module.create_ssl_context()
    assert ctx.check_hostname is False
    assert ctx.verify_mode == huawei_module.ssl.CERT_NONE


def test_huawei_config_validation_and_params(huawei_module):
    with pytest.raises(ValidationError, match="HOSTS is required"):
        huawei_module.HuaweiCloudVectorConfig.model_validate({"hosts": ""})

    config = _config(huawei_module)
    params = config.to_elasticsearch_params()
    assert params["hosts"] == ["http://localhost:9200"]
    assert params["basic_auth"] == ("user", "pass")

    config = huawei_module.HuaweiCloudVectorConfig(hosts="host1,host2", username=None, password=None)
    params = config.to_elasticsearch_params()
    assert "basic_auth" not in params


def test_init_get_type_and_add_texts(huawei_module):
    vector = huawei_module.HuaweiCloudVector("COLLECTION", _config(huawei_module))

    assert vector._collection_name == "collection"
    assert vector.get_type() == huawei_module.VectorType.HUAWEI_CLOUD

    vector._get_uuids = MagicMock(return_value=["id-1", "id-2"])
    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2]])
    assert ids == ["id-1", "id-2"]
    assert vector._client.index.call_count == 2
    vector._client.indices.refresh.assert_called_once_with(index="collection")


def test_crud_methods(huawei_module):
    vector = huawei_module.HuaweiCloudVector("collection", _config(huawei_module))

    vector._client.exists.return_value = True
    assert vector.text_exists("id-1") is True

    vector.delete_by_ids([])
    vector._client.delete.assert_not_called()
    vector.delete_by_ids(["id-1"])
    vector._client.delete.assert_called_once_with(index="collection", id="id-1")

    vector._client.search.return_value = {"hits": {"hits": [{"_id": "id-1"}]}}
    vector.delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("doc_id", "x")
    vector.delete_by_ids.assert_called_once_with(["id-1"])

    vector.delete_by_ids.reset_mock()
    vector._client.search.return_value = {"hits": {"hits": []}}
    vector.delete_by_metadata_field("doc_id", "x")
    vector.delete_by_ids.assert_not_called()

    vector.delete()
    vector._client.indices.delete.assert_called_once_with(index="collection")


def test_search_by_vector_and_full_text(huawei_module):
    vector = huawei_module.HuaweiCloudVector("collection", _config(huawei_module))
    vector._client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_score": 0.9,
                    "_source": {
                        huawei_module.Field.CONTENT_KEY: "doc-a",
                        huawei_module.Field.VECTOR: [0.1],
                        huawei_module.Field.METADATA_KEY: {"doc_id": "1"},
                    },
                },
                {
                    "_score": 0.1,
                    "_source": {
                        huawei_module.Field.CONTENT_KEY: "doc-b",
                        huawei_module.Field.VECTOR: [0.2],
                        huawei_module.Field.METADATA_KEY: {"doc_id": "2"},
                    },
                },
            ]
        }
    }

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5)
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    query_body = vector._client.search.call_args.kwargs["body"]
    assert query_body["query"]["vector"][huawei_module.Field.VECTOR]["topk"] == 2

    vector._client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        huawei_module.Field.CONTENT_KEY: "text-hit",
                        huawei_module.Field.VECTOR: [0.3],
                        huawei_module.Field.METADATA_KEY: {"doc_id": "3"},
                    }
                }
            ]
        }
    }
    docs = vector.search_by_full_text("hello", top_k=3)
    assert len(docs) == 1
    assert docs[0].page_content == "text-hit"


def test_search_by_vector_skips_hits_without_metadata(huawei_module, monkeypatch: pytest.MonkeyPatch):
    class FakeDocument:
        def __init__(self, page_content, vector, metadata):
            self.page_content = page_content
            self.vector = vector
            self.metadata = None

    monkeypatch.setattr(huawei_module, "Document", FakeDocument)

    vector = huawei_module.HuaweiCloudVector("collection", _config(huawei_module))
    vector._client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_score": 0.9,
                    "_source": {
                        huawei_module.Field.CONTENT_KEY: "doc-a",
                        huawei_module.Field.VECTOR: [0.1],
                        huawei_module.Field.METADATA_KEY: {"doc_id": "1"},
                    },
                }
            ]
        }
    }

    docs = vector.search_by_vector([0.1, 0.2], top_k=1, score_threshold=0.5)

    assert docs == []


def test_create_and_create_collection_paths(huawei_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(huawei_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(huawei_module.redis_client, "set", MagicMock())

    vector = huawei_module.HuaweiCloudVector("collection", _config(huawei_module))
    vector.create_collection = MagicMock()
    vector.add_texts = MagicMock()

    docs = [Document(page_content="a", metadata={"doc_id": "1"})]
    vector.create(docs, [[0.1]])
    vector.create_collection.assert_called_once()
    vector.add_texts.assert_called_once_with(docs, [[0.1]])

    vector = huawei_module.HuaweiCloudVector("collection", _config(huawei_module))
    monkeypatch.setattr(huawei_module.redis_client, "get", MagicMock(return_value=1))
    vector.create_collection([[0.1, 0.2]], [{}])
    vector._client.indices.create.assert_not_called()

    monkeypatch.setattr(huawei_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.indices.exists.return_value = False
    vector.create_collection([[0.1, 0.2]], [{}])
    vector._client.indices.create.assert_called_once()

    kwargs = vector._client.indices.create.call_args.kwargs
    mappings = kwargs["mappings"]
    assert mappings["properties"][huawei_module.Field.VECTOR]["dimension"] == 2
    assert kwargs["settings"] == {"index.vector": True}
    huawei_module.redis_client.set.assert_called_once()


def test_huawei_factory_branches(huawei_module, monkeypatch: pytest.MonkeyPatch):
    factory = huawei_module.HuaweiCloudVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(huawei_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(huawei_module.dify_config, "HUAWEI_CLOUD_HOSTS", "http://huawei-es:9200")
    monkeypatch.setattr(huawei_module.dify_config, "HUAWEI_CLOUD_USER", "user")
    monkeypatch.setattr(huawei_module.dify_config, "HUAWEI_CLOUD_PASSWORD", "pass")

    with patch.object(huawei_module, "HuaweiCloudVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["index_name"] == "existing_collection"
    assert vector_cls.call_args_list[1].kwargs["index_name"] == "auto_collection"
    assert dataset_without_index.index_struct is not None
