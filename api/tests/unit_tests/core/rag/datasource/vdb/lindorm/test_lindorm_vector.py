import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_opensearch_modules():
    opensearchpy = types.ModuleType("opensearchpy")
    opensearch_helpers = types.ModuleType("opensearchpy.helpers")

    class BulkIndexError(Exception):
        def __init__(self, errors):
            super().__init__("bulk error")
            self.errors = errors

    class OpenSearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.indices = SimpleNamespace(
                refresh=MagicMock(),
                exists=MagicMock(return_value=False),
                delete=MagicMock(),
                create=MagicMock(),
            )
            self.bulk = MagicMock(return_value={"errors": False, "items": []})
            self.search = MagicMock(return_value={"hits": {"hits": []}})
            self.delete_by_query = MagicMock()
            self.get = MagicMock(return_value={"_id": "id"})
            self.exists = MagicMock(return_value=True)

    opensearch_helpers.BulkIndexError = BulkIndexError
    opensearch_helpers.bulk = MagicMock()

    opensearchpy.OpenSearch = OpenSearch
    opensearchpy.helpers = opensearch_helpers

    return {
        "opensearchpy": opensearchpy,
        "opensearchpy.helpers": opensearch_helpers,
    }


@pytest.fixture
def lindorm_module(monkeypatch):
    for name, module in _build_fake_opensearch_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.lindorm.lindorm_vector as module

    return importlib.reload(module)


def _config(module):
    return module.LindormVectorStoreConfig(
        hosts="http://localhost:9200",
        username="user",
        password="pass",
        using_ugc=False,
        request_timeout=3.0,
    )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("hosts", None, "config URL is required"),
        ("username", None, "config USERNAME is required"),
        ("password", None, "config PASSWORD is required"),
    ],
)
def test_lindorm_config_validation(lindorm_module, field, value, message):
    values = _config(lindorm_module).model_dump()
    values[field] = value

    with pytest.raises(ValidationError, match=message):
        lindorm_module.LindormVectorStoreConfig.model_validate(values)


def test_to_opensearch_params_and_init(lindorm_module):
    cfg = _config(lindorm_module)
    params = cfg.to_opensearch_params()

    assert params["hosts"] == "http://localhost:9200"
    assert params["http_auth"] == ("user", "pass")

    vector = lindorm_module.LindormVectorStore("Collection", cfg, using_ugc=False)
    assert vector._collection_name == "collection"
    assert vector.get_type() == lindorm_module.VectorType.LINDORM

    with pytest.raises(ValueError, match="routing_value"):
        lindorm_module.LindormVectorStore("c", cfg, using_ugc=True)

    vector_ugc = lindorm_module.LindormVectorStore("c", cfg, using_ugc=True, routing_value="ROUTE")
    assert vector_ugc._routing == "route"


def test_create_refresh_and_add_texts_success(lindorm_module, monkeypatch):
    vector = lindorm_module.LindormVectorStore(
        "collection", _config(lindorm_module), using_ugc=True, routing_value="route"
    )
    vector.create_collection = MagicMock()
    vector.add_texts = MagicMock()

    docs = [Document(page_content="a", metadata={"doc_id": "id-1"})]
    vector.create(docs, [[0.1]])
    vector.create_collection.assert_called_once_with([[0.1]], [{"doc_id": "id-1"}])
    vector.add_texts.assert_called_once_with(docs, [[0.1]])

    vector = lindorm_module.LindormVectorStore(
        "collection", _config(lindorm_module), using_ugc=True, routing_value="route"
    )
    monkeypatch.setattr(lindorm_module.time, "sleep", MagicMock())

    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
        Document(page_content="c", metadata={"doc_id": "id-3"}),
    ]
    embeddings = [[0.1], [0.2], [0.3]]

    vector.add_texts(docs, embeddings, batch_size=2, timeout=9)

    assert vector._client.bulk.call_count == 2
    actions = vector._client.bulk.call_args_list[0].args[0]
    assert actions[0]["index"]["routing"] == "route"
    assert actions[1][lindorm_module.ROUTING_FIELD] == "route"
    vector.refresh()
    vector._client.indices.refresh.assert_called_once_with(index="collection")


def test_add_texts_error_paths(lindorm_module):
    vector = lindorm_module.LindormVectorStore("collection", _config(lindorm_module), using_ugc=False)
    vector._client.bulk.return_value = {"errors": True, "items": [{"index": {"error": "boom"}}]}

    docs = [Document(page_content="a", metadata={"doc_id": "id-1"})]
    with pytest.raises(Exception, match="RetryError"):
        vector.add_texts(docs, [[0.1]], batch_size=1)

    vector._client.bulk.side_effect = RuntimeError("bulk failed")
    with pytest.raises(Exception, match="RetryError"):
        vector.add_texts(docs, [[0.1]], batch_size=1)


def test_metadata_lookup_and_delete_by_metadata(lindorm_module):
    vector = lindorm_module.LindormVectorStore(
        "collection", _config(lindorm_module), using_ugc=True, routing_value="route"
    )
    vector._client.search.return_value = {"hits": {"hits": [{"_id": "id-1"}, {"_id": "id-2"}]}}

    ids = vector.get_ids_by_metadata_field("document_id", "doc-1")
    assert ids == ["id-1", "id-2"]
    query = vector._client.search.call_args.kwargs["body"]
    must_conditions = query["query"]["bool"]["must"]
    assert any("routing_field.keyword" in cond.get("term", {}) for cond in must_conditions)

    vector.delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector.delete_by_ids.assert_called_once_with(["id-1", "id-2"])

    vector._client.search.return_value = {"hits": {"hits": []}}
    vector.delete_by_ids.reset_mock()
    vector.delete_by_metadata_field("document_id", "doc-2")
    vector.delete_by_ids.assert_not_called()


def test_delete_by_ids_paths(lindorm_module):
    vector = lindorm_module.LindormVectorStore(
        "collection", _config(lindorm_module), using_ugc=True, routing_value="route"
    )

    vector.delete_by_ids([])
    vector._client.indices.exists.assert_not_called()

    vector._client.indices.exists.return_value = False
    vector.delete_by_ids(["id-1"])

    vector._client.indices.exists.return_value = True
    vector._client.exists.side_effect = [True, False]
    lindorm_module.helpers.bulk.reset_mock()
    vector.delete_by_ids(["id-1", "id-2"])
    lindorm_module.helpers.bulk.assert_called_once()
    actions = lindorm_module.helpers.bulk.call_args.args[1]
    assert len(actions) == 1
    assert actions[0]["routing"] == "route"

    lindorm_module.helpers.bulk.reset_mock()
    lindorm_module.helpers.bulk.side_effect = lindorm_module.BulkIndexError(
        errors=[
            {"delete": {"status": 404, "_id": "id-404"}},
            {"delete": {"status": 500, "_id": "id-500"}},
        ]
    )
    vector._client.exists.side_effect = [True]
    vector.delete_by_ids(["id-1"])


def test_delete_and_text_exists(lindorm_module):
    vector = lindorm_module.LindormVectorStore(
        "collection", _config(lindorm_module), using_ugc=True, routing_value="route"
    )
    vector.delete()
    vector._client.delete_by_query.assert_called_once()
    vector._client.indices.refresh.assert_called_once_with(index="collection")

    vector = lindorm_module.LindormVectorStore("collection", _config(lindorm_module), using_ugc=False)
    vector._client.indices.exists.return_value = True
    vector.delete()
    vector._client.indices.delete.assert_called_once_with(index="collection", params={"timeout": 60})

    vector._client.indices.delete.reset_mock()
    vector._client.indices.exists.return_value = False
    vector.delete()
    vector._client.indices.delete.assert_not_called()

    assert vector.text_exists("id-1") is True
    vector._client.get.side_effect = RuntimeError("missing")
    assert vector.text_exists("id-1") is False


def test_search_by_vector_validation_and_success(lindorm_module):
    vector = lindorm_module.LindormVectorStore(
        "collection", _config(lindorm_module), using_ugc=True, routing_value="route"
    )

    with pytest.raises(ValueError, match="should be a list"):
        vector.search_by_vector("bad")

    with pytest.raises(ValueError, match="should be floats"):
        vector.search_by_vector([0.1, "bad"])

    vector._client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_score": 0.9,
                    "_source": {
                        lindorm_module.Field.CONTENT_KEY: "doc-a",
                        lindorm_module.Field.VECTOR: [0.1],
                        lindorm_module.Field.METADATA_KEY: {"doc_id": "1", "document_id": "d-1"},
                    },
                },
                {
                    "_score": 0.2,
                    "_source": {
                        lindorm_module.Field.CONTENT_KEY: "doc-b",
                        lindorm_module.Field.VECTOR: [0.2],
                        lindorm_module.Field.METADATA_KEY: {"doc_id": "2", "document_id": "d-2"},
                    },
                },
            ]
        }
    }
    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5, document_ids_filter=["d-1"])
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    call_kwargs = vector._client.search.call_args.kwargs
    query = call_kwargs["body"]
    assert "ext" in query
    assert query["query"]["knn"][lindorm_module.Field.VECTOR]["filter"]["bool"]["must"]
    assert call_kwargs["params"]["routing"] == "route"

    vector._client.search.side_effect = RuntimeError("search failed")
    with pytest.raises(RuntimeError, match="search failed"):
        vector.search_by_vector([0.1])


def test_search_by_full_text_success_and_error(lindorm_module):
    vector = lindorm_module.LindormVectorStore(
        "collection", _config(lindorm_module), using_ugc=True, routing_value="route"
    )
    vector._client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        lindorm_module.Field.CONTENT_KEY: "doc-a",
                        lindorm_module.Field.VECTOR: [0.1],
                        lindorm_module.Field.METADATA_KEY: {"doc_id": "1"},
                    }
                }
            ]
        }
    }

    docs = vector.search_by_full_text("hello", top_k=2, document_ids_filter=["d-1"])
    assert len(docs) == 1
    assert docs[0].page_content == "doc-a"

    query = vector._client.search.call_args.kwargs["body"]
    assert query["query"]["bool"]["filter"]

    vector._client.search.side_effect = RuntimeError("full text failed")
    with pytest.raises(RuntimeError, match="full text failed"):
        vector.search_by_full_text("hello")


def test_create_collection_paths(lindorm_module, monkeypatch):
    vector = lindorm_module.LindormVectorStore("collection", _config(lindorm_module), using_ugc=False)

    with pytest.raises(ValueError, match="cannot be empty"):
        vector.create_collection([])

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(lindorm_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(lindorm_module.redis_client, "set", MagicMock())

    monkeypatch.setattr(lindorm_module.redis_client, "get", MagicMock(return_value=1))
    vector.create_collection([[0.1, 0.2]])
    vector._client.indices.create.assert_not_called()

    monkeypatch.setattr(lindorm_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.indices.exists.return_value = False
    vector.create_collection([[0.1, 0.2]], index_params={"index_type": "ivf", "space_type": "cosine"})
    vector._client.indices.create.assert_called_once()
    body = vector._client.indices.create.call_args.kwargs["body"]
    assert body["mappings"]["properties"][lindorm_module.Field.VECTOR]["method"]["name"] == "ivf"
    assert body["mappings"]["properties"][lindorm_module.Field.VECTOR]["method"]["space_type"] == "cosine"

    vector._client.indices.create.reset_mock()
    vector._client.indices.exists.return_value = True
    vector.create_collection([[0.1, 0.2]])
    vector._client.indices.create.assert_not_called()


def test_lindorm_factory_branches(lindorm_module, monkeypatch):
    factory = lindorm_module.LindormVectorStoreFactory()

    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_URL", "http://localhost:9200")
    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_USERNAME", "user")
    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_PASSWORD", "pass")
    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_QUERY_TIMEOUT", 3.0)
    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_INDEX_TYPE", "hnsw")
    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_DISTANCE_TYPE", "l2")
    monkeypatch.setattr(lindorm_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")

    dataset = SimpleNamespace(id="dataset-1", index_struct=None, index_struct_dict={})
    embeddings = SimpleNamespace(embed_query=lambda _q: [0.1, 0.2, 0.3])

    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_USING_UGC", None)
    with pytest.raises(ValueError, match="LINDORM_USING_UGC is not set"):
        factory.init_vector(dataset, attributes=[], embeddings=embeddings)

    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_USING_UGC", False)

    dataset_existing_plain = SimpleNamespace(
        id="dataset-1",
        index_struct="{}",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING"}, "using_ugc": False},
    )
    with patch.object(lindorm_module, "LindormVectorStore", return_value="vector") as store_cls:
        result = factory.init_vector(dataset_existing_plain, attributes=[], embeddings=embeddings)
    assert result == "vector"
    assert store_cls.call_args.args[0] == "existing"

    dataset_existing_ugc = SimpleNamespace(
        id="dataset-1",
        index_struct="{}",
        index_struct_dict={
            "vector_store": {"class_prefix": "ROUTING"},
            "using_ugc": True,
            "dimension": 1536,
            "index_type": "hnsw",
            "distance_type": "l2",
        },
    )
    with patch.object(lindorm_module, "LindormVectorStore", return_value="vector") as store_cls:
        factory.init_vector(dataset_existing_ugc, attributes=[], embeddings=embeddings)
    assert store_cls.call_args.args[0] == "ugc_index_1536_hnsw_l2"
    assert store_cls.call_args.kwargs["routing_value"] == "ROUTING"

    dataset_new = SimpleNamespace(id="dataset-2", index_struct=None, index_struct_dict={})

    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_USING_UGC", True)
    with patch.object(lindorm_module, "LindormVectorStore", return_value="vector") as store_cls:
        factory.init_vector(dataset_new, attributes=[], embeddings=embeddings)
    assert store_cls.call_args.args[0] == "ugc_index_3_hnsw_l2"
    assert store_cls.call_args.kwargs["routing_value"] == "auto_collection"
    assert dataset_new.index_struct is not None

    dataset_new_plain = SimpleNamespace(id="dataset-3", index_struct=None, index_struct_dict={})
    monkeypatch.setattr(lindorm_module.dify_config, "LINDORM_USING_UGC", False)
    with patch.object(lindorm_module, "LindormVectorStore", return_value="vector") as store_cls:
        factory.init_vector(dataset_new_plain, attributes=[], embeddings=embeddings)
    assert store_cls.call_args.args[0] == "auto_collection"
    assert store_cls.call_args.kwargs["routing_value"] is None
