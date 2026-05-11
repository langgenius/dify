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

    class ConnectionError(Exception):
        pass

    class Elasticsearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.ping = MagicMock(return_value=True)
            self.info = MagicMock(return_value={"version": {"number": "8.12.0-SNAPSHOT"}})
            self.index = MagicMock()
            self.exists = MagicMock(return_value=False)
            self.delete = MagicMock()
            self.search = MagicMock(return_value={"hits": {"hits": []}})
            self.indices = SimpleNamespace(
                refresh=MagicMock(),
                delete=MagicMock(),
                exists=MagicMock(return_value=False),
                create=MagicMock(),
            )

    elasticsearch.Elasticsearch = Elasticsearch
    elasticsearch.ConnectionError = ConnectionError
    return {"elasticsearch": elasticsearch}


@pytest.fixture
def elasticsearch_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_elasticsearch_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_elasticsearch.elasticsearch_vector as module

    return importlib.reload(module)


def _regular_config(module, **overrides):
    values = {
        "host": "localhost",
        "port": 9200,
        "username": "elastic",
        "password": "secret",
        "verify_certs": False,
        "request_timeout": 10,
        "retry_on_timeout": True,
        "max_retries": 3,
    }
    values.update(overrides)
    return module.ElasticSearchConfig.model_validate(values)


def _cloud_config(module, **overrides):
    values = {
        "use_cloud": True,
        "cloud_url": "https://cloud.example:9243",
        "api_key": "api-key",
        "verify_certs": True,
        "ca_certs": "/tmp/ca.pem",
        "request_timeout": 10,
        "retry_on_timeout": True,
        "max_retries": 3,
    }
    values.update(overrides)
    return module.ElasticSearchConfig.model_validate(values)


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"use_cloud": True, "cloud_url": None, "api_key": "x"}, "cloud_url is required"),
        ({"use_cloud": True, "cloud_url": "https://cloud", "api_key": None}, "api_key is required"),
        ({"host": None, "port": 9200, "username": "u", "password": "p"}, "HOST is required"),
        ({"host": "h", "port": None, "username": "u", "password": "p"}, "PORT is required"),
        ({"host": "h", "port": 9200, "username": None, "password": "p"}, "USERNAME is required"),
        ({"host": "h", "port": 9200, "username": "u", "password": None}, "PASSWORD is required"),
    ],
)
def test_elasticsearch_config_validation(elasticsearch_module, values, message):
    with pytest.raises(ValidationError, match=message):
        elasticsearch_module.ElasticSearchConfig.model_validate(values)


def test_init_client_cloud_configuration(elasticsearch_module):
    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)
    client = MagicMock()
    client.ping.return_value = True

    with patch.object(elasticsearch_module, "Elasticsearch", return_value=client) as es_cls:
        result = vector._init_client(_cloud_config(elasticsearch_module))

    assert result is client
    kwargs = es_cls.call_args.kwargs
    assert kwargs["hosts"] == ["https://cloud.example:9243"]
    assert kwargs["api_key"] == "api-key"
    assert kwargs["verify_certs"] is True
    assert kwargs["ca_certs"] == "/tmp/ca.pem"


def test_init_client_regular_https_and_http_fallback(elasticsearch_module):
    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)
    client = MagicMock()
    client.ping.return_value = True

    with patch.object(elasticsearch_module, "Elasticsearch", return_value=client) as es_cls:
        vector._init_client(
            _regular_config(
                elasticsearch_module,
                host="https://es.example",
                port=9443,
                verify_certs=True,
                ca_certs="/tmp/ca.pem",
            )
        )
    kwargs = es_cls.call_args.kwargs
    assert kwargs["hosts"] == ["https://es.example:9443"]
    assert kwargs["verify_certs"] is True
    assert kwargs["ca_certs"] == "/tmp/ca.pem"

    with patch.object(elasticsearch_module, "Elasticsearch", return_value=client) as es_cls:
        vector._init_client(_regular_config(elasticsearch_module, host="es.internal", port=9200))
    kwargs = es_cls.call_args.kwargs
    assert kwargs["hosts"] == ["http://es.internal:9200"]
    assert "verify_certs" not in kwargs


def test_init_client_connection_failures(elasticsearch_module):
    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)

    client = MagicMock()
    client.ping.return_value = False
    with patch.object(elasticsearch_module, "Elasticsearch", return_value=client):
        with pytest.raises(ConnectionError, match="Failed to connect"):
            vector._init_client(_regular_config(elasticsearch_module))

    with patch.object(
        elasticsearch_module,
        "Elasticsearch",
        side_effect=elasticsearch_module.ElasticsearchConnectionError("boom"),
    ):
        with pytest.raises(ConnectionError, match="Vector database connection error"):
            vector._init_client(_regular_config(elasticsearch_module))

    with patch.object(elasticsearch_module, "Elasticsearch", side_effect=RuntimeError("oops")):
        with pytest.raises(ConnectionError, match="initialization failed"):
            vector._init_client(_regular_config(elasticsearch_module))


def test_init_get_version_and_check_version(elasticsearch_module):
    with (
        patch.object(elasticsearch_module.ElasticSearchVector, "_init_client", return_value=MagicMock()) as init_client,
        patch.object(elasticsearch_module.ElasticSearchVector, "_get_version", return_value="8.10.0") as get_version,
        patch.object(elasticsearch_module.ElasticSearchVector, "_check_version") as check_version,
    ):
        vector = elasticsearch_module.ElasticSearchVector(
            "collection_1", _regular_config(elasticsearch_module), attributes=["doc_id"]
        )

    init_client.assert_called_once()
    get_version.assert_called_once()
    check_version.assert_called_once()
    assert vector._attributes == ["doc_id"]

    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)
    vector._client = MagicMock()
    vector._client.info.return_value = {"version": {"number": "8.13.2-SNAPSHOT"}}
    assert vector._get_version() == "8.13.2"

    vector._version = "7.17.0"
    with pytest.raises(ValueError, match="greater than 8.0.0"):
        vector._check_version()

    vector._version = "8.0.0"
    vector._check_version()


def test_crud_methods_and_get_type(elasticsearch_module):
    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    vector._client.indices = SimpleNamespace(refresh=MagicMock(), delete=MagicMock())
    vector._get_uuids = MagicMock(return_value=["id-1", "id-2"])

    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
    ]

    ids = vector.add_texts(docs, [[0.1], [0.2]])
    assert ids == ["id-1", "id-2"]
    assert vector._client.index.call_count == 2
    vector._client.indices.refresh.assert_called_once_with(index="collection_1")

    vector._client.exists.return_value = True
    assert vector.text_exists("id-1") is True

    vector.delete_by_ids([])
    vector._client.delete.assert_not_called()
    vector.delete_by_ids(["id-1", "id-2"])
    assert vector._client.delete.call_count == 2

    vector._client.search.return_value = {"hits": {"hits": [{"_id": "id-1"}]}}
    vector.delete_by_ids = MagicMock()
    vector.delete_by_metadata_field("doc_id", "d1")
    vector.delete_by_ids.assert_called_once_with(["id-1"])

    vector.delete_by_ids.reset_mock()
    vector._client.search.return_value = {"hits": {"hits": []}}
    vector.delete_by_metadata_field("doc_id", "d2")
    vector.delete_by_ids.assert_not_called()

    vector.delete()
    vector._client.indices.delete.assert_called_once_with(index="collection_1")
    assert vector.get_type() == elasticsearch_module.VectorType.ELASTICSEARCH


def test_search_by_vector_and_full_text(elasticsearch_module):
    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()

    vector._client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_score": 0.8,
                    "_source": {
                        elasticsearch_module.Field.CONTENT_KEY: "doc-a",
                        elasticsearch_module.Field.VECTOR: [0.1],
                        elasticsearch_module.Field.METADATA_KEY: {"doc_id": "1", "document_id": "d-1"},
                    },
                },
                {
                    "_score": 0.2,
                    "_source": {
                        elasticsearch_module.Field.CONTENT_KEY: "doc-b",
                        elasticsearch_module.Field.VECTOR: [0.2],
                        elasticsearch_module.Field.METADATA_KEY: {"doc_id": "2", "document_id": "d-2"},
                    },
                },
            ]
        }
    }

    docs = vector.search_by_vector(
        [0.1, 0.2],
        top_k=2,
        score_threshold=0.5,
        document_ids_filter=["d-1", "d-2"],
    )
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.8)
    knn = vector._client.search.call_args.kwargs["knn"]
    assert knn["k"] == 2
    assert knn["num_candidates"] == 3
    assert "filter" in knn

    vector._client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        elasticsearch_module.Field.CONTENT_KEY: "text-hit",
                        elasticsearch_module.Field.VECTOR: [0.3],
                        elasticsearch_module.Field.METADATA_KEY: {"doc_id": "3"},
                    }
                }
            ]
        }
    }
    docs = vector.search_by_full_text("hello", top_k=3, document_ids_filter=["d-3"])
    assert len(docs) == 1
    assert docs[0].page_content == "text-hit"
    query = vector._client.search.call_args.kwargs["query"]
    assert "bool" in query


def test_create_and_create_collection_paths(elasticsearch_module, monkeypatch: pytest.MonkeyPatch):
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(elasticsearch_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(elasticsearch_module.redis_client, "set", MagicMock())

    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    vector._client.indices = SimpleNamespace(exists=MagicMock(return_value=False), create=MagicMock())

    vector.create_collection = MagicMock()
    vector.add_texts = MagicMock()
    docs = [Document(page_content="a", metadata={"doc_id": "1"})]
    vector.create(docs, [[0.1]])
    vector.create_collection.assert_called_once()
    vector.add_texts.assert_called_once_with(docs, [[0.1]])

    vector = elasticsearch_module.ElasticSearchVector.__new__(elasticsearch_module.ElasticSearchVector)
    vector._collection_name = "collection_1"
    vector._client = MagicMock()
    vector._client.indices = SimpleNamespace(exists=MagicMock(return_value=False), create=MagicMock())

    monkeypatch.setattr(elasticsearch_module.redis_client, "get", MagicMock(return_value=1))
    vector.create_collection([[0.1, 0.2]], [{}])
    vector._client.indices.create.assert_not_called()

    monkeypatch.setattr(elasticsearch_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.indices.exists.return_value = False
    vector.create_collection([[0.1, 0.2]], [{}])
    vector._client.indices.create.assert_called_once()
    mappings = vector._client.indices.create.call_args.kwargs["mappings"]
    assert mappings["properties"][elasticsearch_module.Field.VECTOR]["dims"] == 2
    elasticsearch_module.redis_client.set.assert_called_once()

    vector._client.indices.create.reset_mock()
    elasticsearch_module.redis_client.set.reset_mock()
    vector._client.indices.exists.return_value = True
    vector.create_collection([[0.1, 0.2]], [{}])
    vector._client.indices.create.assert_not_called()
    elasticsearch_module.redis_client.set.assert_called_once()


def test_elasticsearch_factory_branches(elasticsearch_module, monkeypatch: pytest.MonkeyPatch):
    factory = elasticsearch_module.ElasticSearchVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(elasticsearch_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")

    monkeypatch.setattr(
        elasticsearch_module,
        "current_app",
        SimpleNamespace(
            config={
                "ELASTICSEARCH_USE_CLOUD": False,
                "ELASTICSEARCH_HOST": "es-host",
                "ELASTICSEARCH_PORT": 9200,
                "ELASTICSEARCH_USERNAME": "elastic",
                "ELASTICSEARCH_PASSWORD": "secret",
                "ELASTICSEARCH_VERIFY_CERTS": False,
            }
        ),
    )

    with patch.object(elasticsearch_module, "ElasticSearchVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
    assert result_1 == "vector"
    cfg = vector_cls.call_args.kwargs["config"]
    assert cfg.use_cloud is False
    assert vector_cls.call_args.kwargs["index_name"] == "EXISTING_COLLECTION"

    monkeypatch.setattr(
        elasticsearch_module,
        "current_app",
        SimpleNamespace(
            config={
                "ELASTICSEARCH_USE_CLOUD": True,
                "ELASTICSEARCH_CLOUD_URL": "https://cloud.elastic",
                "ELASTICSEARCH_API_KEY": "api-key",
                "ELASTICSEARCH_VERIFY_CERTS": True,
            }
        ),
    )
    with patch.object(elasticsearch_module, "ElasticSearchVector", return_value="vector") as vector_cls:
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())
    assert result_2 == "vector"
    cfg = vector_cls.call_args.kwargs["config"]
    assert cfg.use_cloud is True
    assert cfg.cloud_url == "https://cloud.elastic"
    assert dataset_without_index.index_struct is not None

    monkeypatch.setattr(
        elasticsearch_module,
        "current_app",
        SimpleNamespace(
            config={
                "ELASTICSEARCH_USE_CLOUD": True,
                "ELASTICSEARCH_CLOUD_URL": None,
                "ELASTICSEARCH_HOST": "fallback-host",
                "ELASTICSEARCH_PORT": 9201,
                "ELASTICSEARCH_USERNAME": "elastic",
                "ELASTICSEARCH_PASSWORD": "secret",
            }
        ),
    )
    with patch.object(elasticsearch_module, "ElasticSearchVector", return_value="vector") as vector_cls:
        factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())
    cfg = vector_cls.call_args.kwargs["config"]
    assert cfg.use_cloud is False
    assert cfg.host == "fallback-host"
